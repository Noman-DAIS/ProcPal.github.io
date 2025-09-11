// output_renderer.js — consolidated renderer
import { loadCSVasJSON } from "./csv_parser.js";
export async function renderFromSpec(spec, containerIdOrEl) {
  // ----- Setup -----
  const container = typeof containerIdOrEl === "string"
    ? (containerIdOrEl.startsWith("#")
        ? document.querySelector(containerIdOrEl)
        : document.getElementById(containerIdOrEl))
    : containerIdOrEl;
  if (!container) throw new Error("Container not found");
  // Load data from spec; prefer inline `spec.data`, else CSV via csv_parser.js
  let data = Array.isArray(spec?.data) && spec.data.length ? spec.data : [];
  if (!data.length && spec?.dataUrl) {
    // csv_parser auto-types by default; no need to pass numeric fields unless you want to override
    data = await loadCSVasJSON(spec.dataUrl);
  }
  // Pass populated data forward so the rest of the renderer doesn’t care about CSV loading
  spec = { ...spec, data };
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
    updatemenus: buildTypeMenu(spec),
    annotations: [],
    ...overrides
  });

  function buildTypeMenu(spec) {
    if (!spec.interactions?.typeSwitcher) return [];
    const types = spec.interactions.types || ["bar","line","pie"];
    return [{
      buttons: types.map(t => {
        const label = t[0].toUpperCase() + t.slice(1);
        // For Pie, avoid invalid restyle; use a no-op relayout and handle via buttonclicked
        if (t.toLowerCase() === "pie") return { method: "relayout", args: [{}], label };
        return { method: "restyle", args: ["type", t], label };
      }),
      direction: "left", x: 0, y: 1.18, showactive: true, bgcolor: "#222", bordercolor: "#16AF8E"
    }];
  }

  function clone(obj) { return JSON.parse(JSON.stringify(obj || {})); }

  // Aggregators for yOp: sum | avg/mean | count | min | max
  function aggregator(op) {
    switch (String(op || "sum").toLowerCase()) {
      case "sum":  return { init: 0, add: (a,b)=>a+b, finish: a=>a };
      case "avg":
      case "mean": return { init: {s:0,c:0}, add: (a,b)=>({s:a.s+b,c:a.c+1}), finish: a=>(a.c? a.s/a.c : 0) };
      case "count":return { init: 0, add: (a,_b)=>a+1, finish: a=>a };
      case "min":  return { init: +Infinity, add: (a,b)=>Math.min(a,b), finish: a=>(Number.isFinite(a)?a:0) };
      case "max":  return { init: -Infinity, add: (a,b)=>Math.max(a,b), finish: a=>(Number.isFinite(a)?a:0) };
      default:     return { init: 0, add: (a,b)=>a+b, finish: a=>a };
    }
  }

  // Shape rows into {x[], y[]} or {x[], series:[{name,y[]}]} honoring mappings and yOp
  function shapeData(rows, specLike) {
    const xKey = specLike?.mappings?.x;
    const yKey = specLike?.mappings?.y;
    const colorKey = specLike?.mappings?.color;
    const yOp = specLike?.mappings?.yOp || "sum";
    const agg = aggregator(yOp);

    if (!xKey) return { x: [], y: [] };

    if (colorKey) {
      const seriesMap = new Map(); // color -> Map(x -> agg_state)
      for (const r of rows) {
        const c = safeVal(r[colorKey]);
        const x = safeVal(r[xKey]);
        const y = toNum(yKey ? r[yKey] : 1);
        if (!seriesMap.has(c)) seriesMap.set(c, new Map());
        const inner = seriesMap.get(c);
        inner.set(x, agg.add(inner.has(x) ? inner.get(x) : agg.init, y));
      }
      const allX = Array.from(new Set([].concat(...Array.from(seriesMap.values()).map(m => Array.from(m.keys())))));
      const series = Array.from(seriesMap.entries()).map(([name, m]) => ({
        name,
        y: allX.map(x => agg.finish(m.has(x) ? m.get(x) : agg.init))
      }));
      return { x: allX, series, colorKey, yOp };
    }

    const map = new Map(); // x -> agg_state
    for (const r of rows) {
      const x = safeVal(r[xKey]);
      const y = toNum(yKey ? r[yKey] : 1);
      map.set(x, agg.add(map.has(x) ? map.get(x) : agg.init, y));
    }
    const x = Array.from(map.keys());
    const y = x.map(k => agg.finish(map.get(k)));
    return { x, y, yOp };
  }

  function buildTraces(chartType, shaped, specLike) {
    const units = specLike?.format?.units || "";
    const colorKey = shaped.colorKey || specLike?.mappings?.color;
    const type = (chartType || "bar").toLowerCase();

    // Pie (single- or multi-series collapsed to totals)
    if (type === "pie") {
      let labels = [];
      let values = [];
      if (shaped.series) {
        labels = shaped.x.slice();
        const totals = new Array(labels.length).fill(0);
        for (const s of shaped.series) for (let i=0;i<labels.length;i++) totals[i] += Number(s.y[i] || 0);
        values = totals;
      } else { labels = shaped.x; values = shaped.y; }
      return [{
        type: "pie",
        labels, values,
        textinfo: "label+percent",
        hovertemplate: `<b>%{label}</b><br>${units}: %{value:,}<extra></extra>`
      }];
    }

    // Multi-series bar/line/scatter
    if (shaped.series && (type === "bar" || type === "line" || type === "scatter")) {
      return shaped.series.map(s => ({
        type, name: s.name, x: shaped.x, y: s.y,
        hovertemplate: colorKey
          ? `<b>${escapeHtml(colorKey)}: ${escapeHtml(s.name)}</b><br>%{x} — ${units} %{y:,}<extra></extra>`
          : `<b>%{x}</b><br>${units}: %{y:,}<extra></extra>`
      }));
    }

    // Single-series bar/line/scatter
    return [{
      type, x: shaped.x, y: shaped.y,
      hovertemplate: `<b>%{x}</b><br>${units}: %{y:,}<extra></extra>`
    }];
  }

  // Sorting (single-series only)
  function applySort(shaped) {
    if (!shaped || shaped.series) return shaped;
    if (sortMode === "value" && shaped.x && shaped.y) {
      const zipped = shaped.x.map((x,i)=>({x, y: shaped.y[i]})).sort((a,b)=>b.y-a.y);
      shaped.x = zipped.map(d=>d.x); shaped.y = zipped.map(d=>d.y);
    } else if (sortMode === "label" && shaped.x) {
      const zipped = shaped.x.map((x,i)=>({x, y: shaped.y[i]})).sort((a,b)=> String(a.x).localeCompare(String(b.x)));
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

    const btnReset = mkBtn("Reset","Reset chart", ()=> redrawCurrent(true));

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
    const out = [];
    if (!shaped) return out;

    if (shaped.series) {
      // multi-series long format
      for (const s of shaped.series) {
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
      const ys = ev.points.map(p => (typeof p.y === "number" ? p.y : (typeof p.value === "number" ? p.value : 0)));
      const n = ys.length;
      const sum = ys.reduce((a,b)=>a+b,0);
      const avg = n ? (sum / n) : 0;
      showSummary(`Selected: ${n} • Sum: ${fmt(sum)} • Avg: ${fmt(avg)}`);
    });
    gd.on("plotly_deselect", hideSummary);

    window.addEventListener("resize", () => gd && Plotly.Plots.resize(gd));

    ensureToolbar();
    ensureSummaryPill();

    // Handle type switcher button clicks (including Pie) by redrawing
    if (spec.interactions?.typeSwitcher) {
      gd.on("plotly_buttonclicked", (ev) => {
        const lbl = ev?.button?.label?.toLowerCase?.();
        if (!lbl) return;
        if (["bar","line","scatter","pie"].includes(lbl)) {
          spec.chartType = lbl;
          redrawCurrent(true);
        }
      });
    }
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
    return {
      ...clone(root),
      chartType: (d.chartType || root.chartType || "bar"),
      format: { ...(root.format || {}), title: makeBreadcrumbTitle(root, clickedX) },
      mappings: {
        ...clone(root.mappings),
        x: d.by || root.mappings?.x,                 // break down by
        y: d.yKey || root.mappings?.y,               // measure key
        color: d.color || root.mappings?.color,      // optional series
        yOp: root.mappings?.yOp || "sum"             // preserve aggregation
      }
    };
  }

  function makeBreadcrumbTitle(root, clickedX) {
    const rootTitle = root.format?.title || root.titleMain || root.title || "Details";
    const label = root.drilldown?.title || root.mappings?.x || "Group";
    return `${rootTitle} ▸ ${label}: ${clickedX}`;
  }

  // ----- Utils -----
  function safeVal(v) { if (v == null) return "(blank)"; return String(v); }
  function toNum(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
  function fmt(n) { try { return new Intl.NumberFormat().format(n); } catch { return String(n); } }

  // ----- Initial draw -----
  await drawMain();
}

// Flexible exports
//export { renderFromSpec };
export { renderFromSpec as renderSpendChart };
//export default renderFromSpec;
