// js/output_renderer.js
import { loadCSVasJSON } from "./csv_parser.js";

/**
 * Generic, reusable Plotly renderer.
 * Pass a SPEC that describes the chart (mappings, type, aggregation, drilldown, labels).
 *
 * @param {object} spec - see examples in output_function.js
 * @param {string|HTMLElement} containerIdOrEl - target div or its id
 */
export async function renderFromSpec(spec, containerIdOrEl) {
  const container = typeof containerIdOrEl === "string"
    ? document.getElementById(containerIdOrEl)
    : containerIdOrEl;
  if (!container) throw new Error("Chart container not found");

  // ---------- Load data ----------
  let data = spec.data || [];
  if (!data.length && spec.dataUrl) data = await loadCSVasJSON(spec.dataUrl);

  // Optional: normalize/auto-type selected numeric fields
  if (Array.isArray(spec.numericFields)) {
    for (const d of data) for (const k of spec.numericFields) d[k] = +d[k] || 0;
  }

  // ---------- Helpers ----------
  const config = {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToAdd: ["v1hovermode", "toggleSpikelines"],
    toImageButtonOptions: { filename: spec.fileName || "chart" }
  };
  // NEW: state for extras
  let sortMode = "label";          // "label" | "value"
  let barmode = "group";           // "group" | "stack"
  const supportsHistory = !!(window?.history?.pushState);

  const baseLayout = (overrides = {}) => ({
    title: spec.format?.title || "",
    paper_bgcolor: "#191919",
    plot_bgcolor: "#191919",
    font: { color: "#F9F3D9" },
    hovermode: spec.interactions?.hoverMode || "x unified",
    xaxis: {
      title: spec.format?.xTitle || "",
      showspikes: true, spikemode: "across", spikecolor: "#777", spikethickness: 1,
      categoryorder: spec.format?.categoryOrder || "trace"
    },
    yaxis: {
      title: spec.format?.yTitle || "",
      showspikes: true, spikemode: "across", spikecolor: "#777", spikethickness: 1,
      tickprefix: spec.format?.yTickPrefix || (spec.format?.units ? spec.format.units + " " : ""),
      separatethousands: true,
      tickformat: spec.format?.yTickFormat || ",.0f"
    },
    updatemenus: spec.interactions?.typeSwitcher ? [{
      buttons: (spec.interactions.types || ["bar","line","pie"]).map(t => ({
        method: "restyle", args: ["type", t], label: t[0].toUpperCase() + t.slice(1)
      })),
      direction: "left", x: 0, y: 1.15, showactive: true, bgcolor: "#333", bordercolor: "#16AF8E"
    }] : [],
    annotations: [],
    ...overrides
  });

  // Aggregate by one or two keys (x and optional color)
  function aggregate(rows, { groupKeys, valueKey, op = "sum" }) {
    const keyFn = r => groupKeys.map(k => r[k]).join("||");
    const map = new Map();
    for (const r of rows) {
      const k = keyFn(r);
      const val = valueKey ? (+r[valueKey] || 0) : 1;
      if (!map.has(k)) map.set(k, { count: 0, sum: 0, min: +val, max: +val });
      const o = map.get(k);
      o.count += 1; o.sum += val; o.min = Math.min(o.min, +val); o.max = Math.max(o.max, +val);
    }
    const get = (o) => op === "mean" ? (o.sum / o.count) :
                        op === "count" ? o.count :
                        op === "min" ? o.min :
                        op === "max" ? o.max : o.sum;
    const out = [];
    for (const [k, o] of map.entries()) {
      const parts = k.split("||");
      const row = {};
      groupKeys.forEach((g, i) => row[g] = parts[i]);
      row.__value = get(o);
      out.push(row);
    }
    return out;
  }

  // Pivot triples (x,y,z) into heatmap matrix
  function pivotToMatrix(triples, xKey, yKey, zKey) {
    const xs = [...new Set(triples.map(d => String(d[xKey])))];
    const ys = [...new Set(triples.map(d => String(d[yKey])))];
    const xIndex = new Map(xs.map((v,i)=>[v,i]));
    const yIndex = new Map(ys.map((v,i)=>[v,i]));
    const z = Array.from({length: ys.length}, () => Array(xs.length).fill(0));
    for (const d of triples) {
      const xi = xIndex.get(String(d[xKey]));
      const yi = yIndex.get(String(d[yKey]));
      z[yi][xi] = +d[zKey] || 0;
    }
    return { xs, ys, z };
  }

  // Build Plotly traces for common types
  function buildTraces(type, shaped, spec) {
    const colorKey = spec.mappings.color;
    if (type === "pie") {
      return [{
        type: "pie",
        labels: shaped.x,
        values: shaped.y,
        textinfo: "label+percent",
        hovertemplate: `<b>%{label}</b><br>${spec.format?.units||""}: %{value:,}<extra></extra>`
      }];
    }
    if (type === "scatter" || type === "line") {
      // multiple series if color present
      if (shaped.series) {
        return shaped.series.map(s => ({
          type, mode: type === "line" ? "lines+markers" : "markers",
          name: s.name, x: shaped.x, y: s.y,
          hovertemplate: `<b>${colorKey||"Series"}: ${s.name}</b><br>%{x} — ${spec.format?.units||""} %{y:,}<extra></extra>`
        }));
      }
      return [{
        type, mode: type === "line" ? "lines+markers" : "markers",
        x: shaped.x, y: shaped.y
      }];
    }
    if (type === "heatmap") {
      return [{
        type: "heatmap",
        x: shaped.xs, y: shaped.ys, z: shaped.z,
        colorbar: { title: spec.format?.units || "" }
      }];
    }
    // default: bar
    if (shaped.series) {
      return shaped.series.map(s => ({
        type: "bar", name: s.name, x: shaped.x, y: s.y,
        hovertemplate: `<b>${colorKey||"Series"}: ${s.name}</b><br>%{x} — ${spec.format?.units||""} %{y:,}<extra></extra>`
      }));
    }
    return [{
      type: "bar",
      x: shaped.x, y: shaped.y,
      hovertemplate: `<b>%{x}</b><br>${spec.format?.units||""}: %{y:,}<extra></extra>`
    }];
  }
    // NEW: sort helper (single-series only)
  function applySort(shaped) {
    if (!shaped || shaped.series) return shaped; // keep simple for series
    if (sortMode === "value" && shaped.x && shaped.y) {
      const zipped = shaped.x.map((x,i)=>({x, y: shaped.y[i]})).sort((a,b)=>b.y-a.y);
      shaped.x = zipped.map(d=>d.x); shaped.y = zipped.map(d=>d.y);
    }
    return shaped;
  }

  // NEW: toolbar UI
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
    const btnSort  = mkBtn("Sort: A→Z","Toggle sort by value/label", ()=> { sortMode = (sortMode==="label"?"value":"label"); btnSort.textContent = sortMode==="label"?"Sort: A→Z":"Sort: Value"; redrawCurrent(); });
    const btnStack = mkBtn("Stack","Toggle group/stack", ()=> { barmode = (barmode==="group"?"stack":"group"); Plotly.relayout(gd, { barmode }); });
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
    // Single-series export of what’s on screen
    if (view.mode === "drill") {
      const key = spec.drilldown?.by || spec.mappings.x;
      const label = view.context?.x;
      if (shaped?.x && shaped?.y) {
        return shaped.x.map((x,i)=>({ [spec.drilldown?.filterKey||spec.mappings.x]: label, [key]: x, value: shaped.y[i] }));
      }
    } else {
      if (shaped?.x && shaped?.y) {
        return shaped.x.map((x,i)=>({ [spec.mappings.x]: x, value: shaped.y[i] }));
      }
    }
    return [];
  }
  function downloadVisible() {
    const shaped = lastShaped;
    const rows = visibleRowsForExport(shaped);
    download((spec.fileName||"chart") + (view.mode==="drill"?"_drill":"") + ".csv", toCSV(rows));
  }

  // Shape data according to type/mappings
  function shapeData(rows, spec) {
    const { x, y, color, yOp = "sum" } = spec.mappings;

    if (spec.chartType === "pie") {
      const agg = aggregate(rows, { groupKeys: [x], valueKey: y, op: yOp });
      const order = agg.map(a => String(a[x]));
      return { x: order, y: agg.map(a => a.__value) };
    }

    if (spec.chartType === "heatmap") {
      const { x: xKey, y: yKey, z, zOp = "sum" } = spec.mappings;
      const agg = aggregate(rows, { groupKeys: [xKey, yKey], valueKey: z, op: zOp });
      return pivotToMatrix(agg.map(a => ({ [xKey]: a[xKey], [yKey]: a[yKey], [z]: a.__value })), xKey, yKey, z);
    }

    // bar/line/scatter
    if (color) {
      // series per color
      const agg = aggregate(rows, { groupKeys: [x, color], valueKey: y, op: yOp });
      const xs = [...new Set(agg.map(a => String(a[x])))];
      const colors = [...new Set(agg.map(a => String(a[color])))];
      const series = colors.map(c => ({
        name: c,
        y: xs.map(xx => {
          const hit = agg.find(a => String(a[x]) === xx && String(a[color]) === c);
          return hit ? hit.__value : 0;
        })
      }));
      return { x: xs, series };
    } else {
      const agg = aggregate(rows, { groupKeys: [x], valueKey: y, op: yOp });
      const xs = agg.map(a => String(a[x]));
      const ys = agg.map(a => a.__value);
      return { x: xs, y: ys };
    }
  }

  // ---------- Drilldown state ----------
  let view = { mode: "main", context: null };
  let gd = null; // graph div
  let firstPlotDone = false;
  let lastShaped = null; // NEW: remember what’s on screen

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
      //view = { mode: "drill", context: { x: clickedX } };
      //drawDrill(clickedX);
      enterDrill(clickedX);
    });
    //// click "Back"
    //gd.on("plotly_clickannotation", () => {
    //  if (view.mode === "drill") {
    //    view = { mode: "main", context: null };
    //    drawMain();
    //  }
    //});
    gd.on("plotly_clickannotation", () => { if (view.mode === "drill") exitDrill(); });
    // NEW: keyboard + browser back
    window.addEventListener("keydown", (e) => {
      if (view.mode === "drill" && (e.key === "Escape" || e.key === "Backspace")) exitDrill();
    });
    if (supportsHistory) {
      window.addEventListener("popstate", () => {
        if (view.mode === "drill") exitDrill(false); // don’t push state again
      });
    }
    window.addEventListener("resize", () => gd && Plotly.Plots.resize(gd));
    ensureToolbar();
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

  // ---------- Views ----------
  async function drawMain() {
    //const shaped = shapeData(data, spec);
    let shaped = shapeData(data, spec);
    shaped = applySort(shaped);
    const traces = buildTraces(spec.chartType, shaped, spec);
    const layout = baseLayout({
      title: spec.format?.title || spec.titleMain,
      annotations: spec.drilldown ? [{
        text: spec.format?.tip || "Tip: click a bar to drill down",
        xref: "paper", yref: "paper", x: 0, y: 1.13,
        showarrow: false, align: "left", font: { size: 12, color: "#ccc" }
      }] : []
    });
    await plot(traces, layout);
    lastShaped = shaped;
    Plotly.relayout(gd, { barmode });
  }

  async function drawDrill(clickedX) {
    // If no drilldown spec, do nothing
    if (!spec.drilldown) return;
    const { filterKey = spec.mappings.x, by, yKey = spec.mappings.y, yOp = "sum" } = spec.drilldown;

    const subset = data.filter(d => String(d[filterKey]) === String(clickedX));
    // Build a temporary spec for the drill
    const drillSpec = {
      ...spec,
      chartType: spec.drilldown.chartType || "bar",
      mappings: { x: by, y: yKey, color: spec.drilldown.color }, // allow series at drill level
      format: {
        ...spec.format,
        title: `${spec.drilldown.titlePrefix || "Drill"} — ${clickedX}`,
        xTitle: spec.drilldown.xTitle || by,
        yTitle: spec.format?.yTitle || spec.format?.units || ""
      }
    };
    let shaped = shapeData(subset, drillSpec);
    shaped = applySort(shaped);
    const traces = buildTraces(drillSpec.chartType, shaped, drillSpec);
    const layout = baseLayout({
      title: drillSpec.format.title,
      annotations: [{
        text: "← Back",
        xref: "paper", yref: "paper", x: 0, y: 1.1,
        //showarrow: false, font: { color: "#16AF8E", size: 14 },
        showarrow: false, font: { color: "#16AF8E", size: 14 }, captureevents: true, // NEW
        bgcolor: "#333", bordercolor: "#16AF8E", borderpad: 4
      }]
    });
    await plot(traces, layout);
    lastShaped = shaped;
    Plotly.relayout(gd, { barmode });
  }

  // ---------- Go ----------
  await drawMain();
}

/**
 * Backward-compat convenience for your current chart.
 * (Reads a spec function and renders it.)
 */
export async function renderSpendChart(csvUrl, containerIdOrEl, getSpec) {
  const spec = (getSpec ? getSpec() : null) || {
    dataUrl: csvUrl,
    chartType: "bar",
    mappings: { x: "supplier_category", y: "spend_anonymized", color: null, yOp: "sum" },
    numericFields: ["spend_anonymized", "spend_year"],
    format: { title: "Total Spend by Category", xTitle: "Supplier Category", yTitle: "AED", units: "AED" },
    interactions: { typeSwitcher: true, types: ["bar", "line", "pie"] },
    drilldown: { filterKey: "supplier_category", by: "spend_year", titlePrefix: "Spend by Year" },
    fileName: "supplier_spend"
  };
  return renderFromSpec({ ...spec, dataUrl: csvUrl }, containerIdOrEl);
}
