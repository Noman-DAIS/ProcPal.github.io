// output_renderer.js — drop-in renderer with robust Back, fullscreen, sort persist, breadcrumbs, and lasso selection summary.

export async function renderFromSpec(spec, containerIdOrEl) {
  // ----- Setup -----
  const container = typeof containerIdOrEl === "string" ? document.querySelector(containerIdOrEl) : containerIdOrEl;
  if (!container) throw new Error("Container not found");
  const data = Array.isArray(spec?.data) ? spec.data : [];
  const supportsHistory = !!(window?.history?.pushState);
  const SORT_KEY = "pp.sortMode";

  // UI/config
  const config = {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToAdd: ["v1hovermode", "toggleSpikelines", "select2d", "lasso2d"],
    toImageButtonOptions: { filename: spec.fileName || "chart" }
  };

  // Persistent state
  let sortMode = localStorage.getItem(SORT_KEY) || "label"; // "label" | "value"
  let barmode = "group";                                     // "group" | "stack"
  let view = { mode: "main", context: null };                // { mode: "main"|"drill", context: { x } }
  let gd = null;                                             // Plotly graph div
  let lastShaped = null;                                     // last shaped data for export/summary
  let firstPlotDone = false;

  // ----- Helpers -----
  const baseLayout = (overrides = {}) => ({
    paper_bgcolor: "#111",
    plot_bgcolor: "#111",
    font: { color: "#e6e6e6" },
    margin: { t: 70, r: 20, b: 50, l: 60 },
    hovermode: "closest",
    legend: { orientation: "h", y: -0.2 },
    updatemenus: spec.interactions?.typeSwitcher ? [{
      buttons: (spec.interactions.types || ["bar","line","pie"]).map(t => ({
        method: "restyle",
        args: ["type", t],
        label: t[0].toUpperCase() + t.slice(1)
      })),
      direction: "left", x: 0, y: 1.18, showactive: true, bgcolor: "#222", bordercolor: "#16AF8E"
    }] : [],
    annotations: [],
    ...overrides
  });

  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  // Generic shaper:
  // - single-series: groups by mappings.x, sums mappings.y
  // - multi-series (optional): if mappings.color present, create series per color
  function shapeData(rows, specLike) {
    const xKey = specLike?.mappings?.x;
    const yKey = specLike?.mappings?.y;
    const colorKey = specLike?.mappings?.color;
    if (!xKey || !yKey) return { x: [], y: [] };

    if (colorKey) {
      // series by color
      const groups = new Map(); // color -> Map(x -> sum)
      for (const r of rows) {
        const c = safeVal(r[colorKey]);
        const x = safeVal(r[xKey]);
        const y = toNum(r[yKey]);
        if (!groups.has(c)) groups.set(c, new Map());
        const inner = groups.get(c);
        inner.set(x, (inner.get(x) || 0) + y);
      }
      // union X across series, preserve insertion order
      const allX = Array.from(new Set([].concat(...Array.from(groups.values()).map(m => Array.from(m.keys())))));
      const series = Array.from(groups.entries()).map(([name, m]) => ({
        name,
        y: allX.map(x => m.get(x) || 0)
      }));
      return { x: allX, series, colorKey };
    }

    // single series
    const agg = new Map(); // x -> sum(y)
    for (const r of rows) {
      const x = safeVal(r[xKey]);
      const y = toNum(r[yKey]);
      agg.set(x, (agg.get(x) || 0) + y);
    }
    const x = Array.from(agg.keys());
    const y = x.map(k => agg.get(k));
    return { x, y };
  }

  function buildTraces(chartType, shaped, specLike) {
    const units = specLike?.format?.units || "";
    const colorKey = shaped.colorKey || specLike?.mappings?.color;
    const type = (chartType || "bar");

    // Multi-series (bar/line)
    if (shaped.series && (type === "bar" || type === "line")) {
      return shaped.series.map(s => ({
        type,
        name: s.name,
        x: shaped.x,
        y: s.y,
        hovertemplate: colorKey
          ? `<b>${escapeHtml(colorKey)}: ${escapeHtml(s.name)}</b><br>%{x} — ${units} %{y:,}<extra></extra>`
          : `<b>%{x}</b><br>${units}: %{y:,}<extra></extra>`
      }));
    }

    // Pie
    if (type === "pie") {
      return [{
        type: "pie",
        labels: shaped.x,
        values: shaped.y,
        textinfo: "label+percent",
        hovertemplate: `<b>%{label}</b><br>${units}: %{value:,}<extra></extra>`
      }];
    }

    // Single-series bar/line
    return [{
      type,
      x: shaped.x,
      y: shaped.y,
      hovertemplate: `<b>%{x}</b><br>${units}: %{y:,}<extra></extra>`
    }];
  }

  // Sorting (only for single-series to keep it simple)
  function applySort(shaped) {
    if (!shaped || shaped.series) return shaped;
    if (sortMode === "value" && shaped.x && shaped.y) {
      const zipped = shaped.x.map((x,i)=>({x, y: shaped.y[i]})).sort((a,b)=>b.y-a.y);
      shaped.x = zipped.map(d=>d.x); shaped.y = zipped.map(d=>d.y);
    }
    return shaped;
  }

  // Drill helpers
  function filterForDrill(rows, clickedX, rootSpec) {
    const filterKey = rootSpec?.drilldown?.filterKey || rootSpec?.mappings?.x;
    return rows.filter(r => safeVal(r[filterKey]) === clickedX);
  }

  // ----- Toolbar / UI -----
  function ensureToolbar() {
    if (container.querySelector(".pp-toolbar")) return;
    container.style.position = container.style.position || "relative";

    const bar = document.createElement("div");
    bar.className = "pp-toolbar";
    bar.style.cssText = "position:absolute;top:8px;left:8px;display:flex;gap:6px;z-index:10";

    const mkBtn = (label, title, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn-sm btn-outline-light";
      b.style.cssText = "padding:2px 8px;border-radius:10px;background:#222;color:#eee;border:1px solid #555";
      b.textContent = label; b.title = title; b.onclick = fn; return b;
    };

    const btnBack  = mkBtn("← Back","Return to main view", ()=> exitDrill());
    btnBack.dataset.role = "pp-back";

    const btnFull  = mkBtn("⛶ Full","Toggle fullscreen", ()=> toggleFull());

    const btnReset = mkBtn("Reset","Reset chart axes", ()=> redrawCurrent(true));

    const btnSort  = mkBtn(sortMode==="label"?"Sort: A→Z":"Sort: Value","Toggle sort", ()=> {
      sortMode = (sortMode==="label"?"value":"label");
      localStorage.setItem(SORT_KEY, sortMode);
      btnSort.textContent = sortMode==="label"?"Sort: A→Z":"Sort: Value";
      redrawCurrent();
    });

    const btnStack = mkBtn("Stack","Toggle group/stack bars", ()=> {
      barmode = (barmode==="group"?"stack":"group");
      Plotly.relayout(gd, { barmode });
    });

    const btnCSV   = mkBtn("CSV","Download visible data", ()=> downloadVisible());

    bar.append(btnBack, btnFull, btnReset, btnSort, btnStack, btnCSV);
    container.appendChild(bar);
    updateToolbar();
  }

  function updateToolbar() {
    const back = container.querySelector('[data-role="pp-back"]');
    if (back) back.style.display = (view.mode === "drill") ? "inline-block" : "none";
  }

  async function toggleFull() {
    if (!document.fullscreenElement) { await container.requestFullscreen?.(); }
    else { await document.exitFullscreen?.(); }
  }

  // Selection summary pill
  function ensureSummaryPill() {
    if (container.querySelector(".pp-sel-pill")) return;
    const pill = document.createElement("div");
    pill.className = "pp-sel-pill";
    pill.style.cssText = "position:absolute;left:8px;bottom:8px;background:#222;border:1px solid #555;color:#eee;padding:6px 10px;border-radius:12px;font-size:12px;z-index:10;display:none";
    pill.textContent = "Selected: 0 • Sum: 0";
    container.appendChild(pill);
  }
  function showSummary(text) {
    const pill = container.querySelector(".pp-sel-pill");
    if (!pill) return;
    pill.style.display = "inline-block";
    pill.textContent = text;
  }
  function hideSummary() {
    const pill = container.querySelector(".pp-sel-pill");
    if (pill) pill.style.display = "none";
  }

  // CSV helpers
  function toCSV(rows) {
    if (!rows?.length) return "";
    const cols = Object.keys(rows[0]);
    const escape = s => `"${String(s).replaceAll('"','""')}"`;
    return [cols.join(","), ...rows.map(r=>cols.map(c=>escape(r[c]??"")).join(","))].join("\n");
  }
  function download(name, text) {
    const blob = new Blob([text], {type:"text/csv;charset=utf-8"});
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
  }
  function visibleRowsForExport(shaped) {
    // long format export of what's on screen
    const out = [];
    if (!shaped) return out;

    if (shaped.series) {
      // multi-series long
      for (let si=0; si<shaped.series.length; si++) {
        const s = shaped.series[si];
        for (let i=0; i<shaped.x.length; i++) {
          out.push({ [spec.mappings?.x || "x"]: shaped.x[i], series: s.name, value: s.y[i] });
        }
      }
      return out;
    }

    // single-series
    for (let i=0; i<shaped.x.length; i++) {
      if (view.mode === "drill") {
        const label = view.context?.x;
        out.push({ [spec.drilldown?.filterKey || spec.mappings?.x || "group"]: label, [spec.drilldown?.by || "x"]: shaped.x[i], value: shaped.y[i] });
      } else {
        out.push({ [spec.mappings?.x || "x"]: shaped.x[i], value: shaped.y[i] });
      }
    }
    return out;
  }
  function downloadVisible() {
    const rows = visibleRowsForExport(lastShaped);
    download((spec.fileName||"chart") + (view.mode==="drill"?"_drill":"") + ".csv", toCSV(rows));
  }

  // ----- Plot lifecycle -----
  async function plot(traces, layout) {
    if (!firstPlotDone) {
      gd = await Plotly.newPlot(container, traces, layout, config);
      firstPlotDone = true;
      bindHandlers(); // attach once
    } else {
      await Plotly.react(gd, traces, layout, config);
    }
    return gd;
  }

  function bindHandlers() {
    if (!gd || !gd.on) return;

    // click to drill
    gd.on("plotly_click", (ev) => {
      if (!spec.drilldown || view.mode !== "main") return;
      const clickedX = ev?.points?.[0]?.x;
      if (clickedX == null) return;
      enterDrill(clickedX);
    });

    // annotation back
    gd.on("plotly_clickannotation", () => { if (view.mode === "drill") exitDrill(); });

    // keyboard back
    window.addEventListener("keydown", (e) => {
      if (view.mode === "drill" && (e.key === "Escape" || e.key === "Backspace")) exitDrill();
    });

    // browser back
    if (supportsHistory) {
      window.addEventListener("popstate", () => {
        if (view.mode === "drill") exitDrill(false); // don’t push state again
      });
    }

    // selection summary (lasso/box)
    gd.on("plotly_selected", (ev) => {
      if (!ev?.points?.length) { hideSummary(); return; }
      const pts = ev.points;
      // Try y, fallback to value (pie)
      const ys = pts.map(p => (typeof p.y === "number" ? p.y : (typeof p.value === "number" ? p.value : 0)));
      const n = ys.length;
      const sum = ys.reduce((a,b)=>a+b,0);
      const avg = n ? (sum / n) : 0;
      showSummary(`Selected: ${n} • Sum: ${fmt(sum)} • Avg: ${fmt(avg)}`);
    });
    gd.on("plotly_deselect", hideSummary);

    window.addEventListener("resize", () => gd && Plotly.Plots.resize(gd));

    ensureToolbar();
    ensureSummaryPill();
  }

  function enterDrill(clickedX) {
    view = { mode: "drill", context: { x: clickedX } };
    if (supportsHistory) history.pushState({ drill: clickedX }, "", `#drill=${encodeURIComponent(clickedX)}`);
    drawDrill(clickedX);
    updateToolbar();
  }

  function exitDrill(pushHistory = true) {
    view = { mode: "main", context: null };
    if (pushHistory && supportsHistory) history.pushState({}, "", location.pathname + location.search);
    drawMain();
    updateToolbar();
  }

  function redrawCurrent(resetAxes = false) {
    if (view.mode === "main") drawMain().then(() => resetAxes && autoRange());
    else drawDrill(view.context?.x).then(() => resetAxes && autoRange());
  }

  function autoRange() {
    if (!gd) return;
    Plotly.relayout(gd, { "xaxis.autorange": true, "yaxis.autorange": true });
  }

  // ----- Views -----
  async function drawMain() {
    let shaped = shapeData(data, spec);
    shaped = applySort(shaped);
    const traces = buildTraces(spec.chartType, shaped, spec);

    const title = spec.format?.title || spec.titleMain || spec.title || "";
    const layout = baseLayout({
      title,
      annotations: spec.drilldown ? [{
        text: spec.format?.tip || "Tip: click a bar to drill down",
        xref: "paper", yref: "paper", x: 0, y: 1.12,
        showarrow: false, align: "left", font: { size: 12, color: "#ccc" }
      }] : []
    });

    await plot(traces, layout);
    lastShaped = shaped;
    Plotly.relayout(gd, { barmode });
    hideSummary();
  }

  async function drawDrill(clickedX) {
    const subset = filterForDrill(data, clickedX, spec);
    const drillSpec = createDrillSpec(spec, clickedX);
    let shaped = shapeData(subset, drillSpec);
    shaped = applySort(shaped);
    const traces = buildTraces(drillSpec.chartType, shaped, drillSpec);

    const layout = baseLayout({
      title: makeBreadcrumbTitle(spec, clickedX),
      annotations: [{
        text: "← Back",
        xref: "paper", yref: "paper", x: 0, y: 1.08,
        showarrow: false, font: { color: "#16AF8E", size: 14 }, captureevents: true,
        bgcolor: "#333", bordercolor: "#16AF8E", borderpad: 4
      }]
    });

    await plot(traces, layout);
    lastShaped = shaped;
    Plotly.relayout(gd, { barmode });
    hideSummary();
  }

  // ----- Drill spec + breadcrumb -----
  function createDrillSpec(root, clickedX) {
    const d = root?.drilldown || {};
    // inherit mappings.y; drill by d.by (e.g., "month", "supplier")
    return {
      ...clone(root),
      chartType: d.chartType || root.chartType || "bar",
      format: {
        ...(root.format || {}),
        title: makeBreadcrumbTitle(root, clickedX)
      },
      mappings: {
        ...clone(root.mappings),
        x: d.by || root.mappings?.x,  // what to break down by in drill view
        // y remains same
      }
    };
  }

  function makeBreadcrumbTitle(root, clickedX) {
    const rootTitle = root.format?.title || root.titleMain || root.title || "Details";
    const label = root.drilldown?.title || root.mappings?.x || "Group";
    return `${rootTitle} ▸ ${label}: ${clickedX}`;
  }

  // ----- Utils -----
  function safeVal(v) {
    if (v == null) return "(blank)";
    return String(v);
  }
  function toNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  function fmt(n) {
    try { return new Intl.NumberFormat().format(n); } catch { return String(n); }
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  // ----- Initial draw -----
  await drawMain();
}
export { renderFromSpec as renderSpendChart };
