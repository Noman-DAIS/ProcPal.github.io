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

  // Optional numeric coercion (kept for back-compat if you still pass numericFields)
  if (spec?.numericFields?.length && data?.length) {
    for (const r of data) {
      for (const f of spec.numericFields) if (r[f] != null) r[f] = +r[f];
    }
  }

  // Local UI state
  const supportsHistory = !!(window?.history?.pushState);
  const SORT_KEY = "plotly-demo-sort-mode";
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
    xaxis: {
      title: spec?.format?.xTitle || "",
      gridcolor: "#2a2a2a",
      zerolinecolor: "#2a2a2a",
      tickangle: spec?.format?.xTickAngle ?? 0,
      categoryorder: spec?.format?.categoryOrder || "trace"
    },
    yaxis: {
      title: spec?.format?.yTitle || "",
      gridcolor: "#2a2a2a",
      zerolinecolor: "#2a2a2a",
      separatethousands: true,
      tickprefix: spec?.format?.yTickPrefix || (spec?.format?.units ? spec.format.units + " " : ""),
      tickformat: spec?.format?.yTickFormat || ",.0f"
    },
    title: { text: spec?.format?.title || "", x: 0, xanchor: "left" },
    ...overrides
  });

  const config = {
    responsive: true,
    displaylogo: false,
    toImageButtonOptions: {
      filename: spec?.fileName || (spec?.format?.title?.replace(/\s+/g, "_") || "chart")
    },
    modeBarButtonsToAdd: ["v1hovermode", "hovercompare", "togglespikelines"]
  };

  const aggregator = (op) => {
    if (op === "count") return {
      init: () => ({ count: 0 }),
      add: (s, v) => (s.count++, s),
      finish: (s) => s.count
    };
    if (op === "mean") return {
      init: () => ({ sum: 0, n: 0 }),
      add: (s, v) => ((s.sum += +v || 0), s.n++, s),
      finish: (s) => (s.n ? s.sum / s.n : 0)
    };
    if (op === "min") return {
      init: () => ({ v: +Infinity }),
      add: (s, v) => ((s.v = Math.min(s.v, +v || 0)), s),
      finish: (s) => (isFinite(s.v) ? s.v : 0)
    };
    if (op === "max") return {
      init: () => ({ v: -Infinity }),
      add: (s, v) => ((s.v = Math.max(s.v, +v || 0)), s),
      finish: (s) => (isFinite(s.v) ? s.v : 0)
    };
    // default sum
    return {
      init: () => ({ sum: 0 }),
      add: (s, v) => ((s.sum += +v || 0), s),
      finish: (s) => s.sum
    };
  };

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
        const x = String(r[xKey]);
        const c = String(r[colorKey]);
        const y = yKey ? r[yKey] : 1;
        if (!seriesMap.has(c)) seriesMap.set(c, new Map());
        const m = seriesMap.get(c);
        if (!m.has(x)) m.set(x, agg.init());
        agg.add(m.get(x), y);
      }
      // unify X across all series, maintain insertion order
      const allX = Array.from(new Set([].concat(...Array.from(seriesMap.values()).map(m => Array.from(m.keys())))));
      const series = [];
      for (const [name, m] of seriesMap.entries()) {
        const y = allX.map(xv => (m.has(xv) ? agg.finish(m.get(xv)) : 0));
        series.push({ name, y });
      }
      return { x: allX, series };
    }

    // single-series
    const xMap = new Map(); // x -> agg_state
    for (const r of rows) {
      const x = String(r[xKey]);
      const y = yKey ? r[yKey] : 1;
      if (!xMap.has(x)) xMap.set(x, agg.init());
      agg.add(xMap.get(x), y);
    }
    const xs = Array.from(xMap.keys());
    const ys = xs.map(x => agg.finish(xMap.get(x)));
    return { x: xs, y: ys };
  }

  // Heatmap pivot helper
  function pivotToMatrix(rows, xKey, yKey, zKey, yOp = "sum") {
    const agg = aggregator(yOp);
    const table = new Map(); // x -> (y -> state)
    const xsSet = new Set();
    const ysSet = new Set();
    for (const r of rows) {
      const x = String(r[xKey]);
      const y = String(r[yKey]);
      const z = zKey ? r[zKey] : 1;
      xsSet.add(x); ysSet.add(y);
      if (!table.has(x)) table.set(x, new Map());
      const rowMap = table.get(x);
      if (!rowMap.has(y)) rowMap.set(y, agg.init());
      agg.add(rowMap.get(y), z);
    }
    const xs = Array.from(xsSet), ys = Array.from(ysSet);
    const z = ys.map(() => Array(xs.length).fill(0));
    ys.forEach((y, yi) => {
      xs.forEach((x, xi) => {
        const rowMap = table.get(x);
        z[yi][xi] = rowMap && rowMap.has(y) ? agg.finish(rowMap.get(y)) : 0;
      });
    });
    return { xs, ys, z };
  }

  // Sorting (only for single-series)
  function applySort(shaped) {
    if (!shaped || shaped.series) return shaped;
    if (sortMode === "value" && shaped.x && shaped.y) {
      const pairs = shaped.x.map((x, i) => ({ x, y: shaped.y[i] }));
      pairs.sort((a, b) => b.y - a.y);
      shaped.x = pairs.map(p => p.x);
      shaped.y = pairs.map(p => p.y);
    } else if (sortMode === "label" && shaped.x) {
      const pairs = shaped.x.map((x, i) => ({ x, y: shaped.y[i] }));
      pairs.sort((a, b) => String(a.x).localeCompare(String(b.x)));
      shaped.x = pairs.map(p => p.x);
      shaped.y = pairs.map(p => p.y);
    }
    return shaped;
  }

  // Build Plotly traces
  function buildTraces(type, shaped, specLike) {
    const units = specLike?.format?.units || "";
    if (type === "pie") {
      return [{
        type: "pie",
        labels: shaped.x,
        values: shaped.y,
        textinfo: "label+percent",
        hovertemplate: "<b>%{label}</b><br>" + units + " %{value:,}<extra></extra>",
        hole: specLike?.format?.donut ? 0.5 : 0
      }];
    }
    if (type === "heatmap") {
      return [{
        type: "heatmap",
        x: shaped.xs, y: shaped.ys, z: shaped.z,
        colorbar: { title: units || "Value" }
      }];
    }
    if (shaped.series?.length) {
      // multi-series (bar/line/scatter)
      const colorKey = specLike?.mappings?.color || "Series";
      return shaped.series.map(s => ({
        type,
        name: s.name,
        x: shaped.x,
        y: s.y,
        hovertemplate: `<b>${colorKey}: ${s.name}</b><br>%{x} — ${units} %{y:,}<extra></extra>`
      }));
    }
    // single-series
    return [{
      type,
      x: shaped.x,
      y: shaped.y,
      hovertemplate: `<b>%{x}</b><br>${units}: %{y:,}<extra></extra>`
    }];
  }

  // Toolbar overlay
  function ensureToolbar(containerEl) {
    let bar = containerEl.querySelector(".chart-toolbar");
    if (bar) return bar;
    bar = document.createElement("div");
    bar.className = "chart-toolbar";
    bar.style.cssText = "display:flex;gap:.5rem;align-items:center;position:absolute;top:8px;right:8px;z-index:3;background:#1b1b1b;border:1px solid #333;border-radius:8px;padding:6px 8px;";
    bar.innerHTML = `
      <button data-act="back" title="Back" style="display:none">← Back</button>
      <button data-act="reset" title="Reset view">Reset</button>
      <button data-act="sort"  title="Toggle sort">Sort: <b>${sortMode}</b></button>
      <button data-act="mode"  title="Group/Stack">Bars: <b>${barmode}</b></button>
      <button data-act="csv"   title="Export visible CSV">Export CSV</button>
    `;
    containerEl.style.position = "relative";
    containerEl.appendChild(bar);
    return bar;
  }

  function updateToolbar() {
    const bar = ensureToolbar(container);
    bar.querySelector('[data-act="sort"]').innerHTML = `Sort: <b>${sortMode}</b>`;
    bar.querySelector('[data-act="mode"]').innerHTML = `Bars: <b>${barmode}</b>`;
    bar.querySelector('[data-act="back"]').style.display = view.mode === "drill" ? "" : "none";
  }

  function toCSV(rows) {
    if (!rows?.length) return "";
    const cols = Object.keys(rows[0]);
    const escape = s => `"${String(s).replaceAll('"','""')}"`;
    return [cols.join(","), ...rows.map(r=>cols.map(c=>escape(r[c]??"")).join(","))].join("\n");
  }
  function visibleRowsForExport(shaped) {
    const out = [];
    if (!shaped) return out;
    if (shaped.series?.length) {
      for (const s of shaped.series) {
        for (let i = 0; i < shaped.x.length; i++) {
          out.push({ [spec.mappings?.x || "x"]: shaped.x[i], series: s.name, value: s.y[i] });
        }
      }
    } else if (shaped.x?.length) {
      for (let i = 0; i < shaped.x.length; i++) {
        out.push({ [spec.mappings?.x || "x"]: shaped.x[i], value: shaped.y[i] });
      }
    }
    return out;
  }

  function bindToolbarEvents() {
    const bar = ensureToolbar(container);
    bar.onclick = (e) => {
      const act = e.target?.getAttribute?.("data-act");
      if (!act) return;
      if (act === "reset" && gd) Plotly.relayout(gd, { "xaxis.autorange": true, "yaxis.autorange": true });
      if (act === "sort") {
        sortMode = sortMode === "label" ? "value" : "label";
        localStorage.setItem(SORT_KEY, sortMode);
        drawCurrent();
      }
      if (act === "mode") {
        barmode = barmode === "group" ? "stack" : "group";
        drawCurrent();
      }
      if (act === "csv") {
        const csv = toCSV(visibleRowsForExport(lastShaped));
        const name = (spec?.fileName || "chart_data") + ".csv";
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
      }
      if (act === "back" && view.mode === "drill") {
        exitDrill();
      }
    };
    updateToolbar();
  }

  // ----- Views -----
  function drawMain() {
    const type = (spec?.chartType || "bar");
    let shaped;
    if (type === "heatmap") {
      const x = spec?.mappings?.x, y = spec?.mappings?.y, color = spec?.mappings?.color;
      const { xs, ys, z } = pivotToMatrix(data, x, y, color, spec?.mappings?.yOp || "sum");
      shaped = { xs, ys, z };
    } else if (type === "pie") {
      shaped = shapeData(data, spec);
    } else {
      shaped = applySort(shapeData(data, spec));
    }

    const traces = buildTraces(type, shaped, spec);
    const layout = baseLayout({
      barmode,
      title: { text: spec?.format?.title || "", x: 0, xanchor: "left" }
    });

    if (!gd) {
      gd = document.createElement("div");
      container.innerHTML = "";
      container.appendChild(gd);
      firstPlotDone = true;
      Plotly.newPlot(gd, traces, layout, config);
    } else {
      Plotly.react(gd, traces, layout, config);
    }

    lastShaped = shaped;
    bindHandlersForDrill();
    bindToolbarEvents();
    updateToolbar();
  }

  function makeBreadcrumbTitle(root, clickedX) {
    const base = root?.format?.title || "";
    const sep = base ? " — " : "";
    return `${base}${sep}${root?.mappings?.x || "X"}: ${clickedX}`;
  }

  function enterDrill(clickedX) {
    view = { mode: "drill", context: { x: clickedX } };
    if (supportsHistory) history.pushState({ drill: clickedX }, "", "#drill");
    const root = spec;
    const drillSpec = {
      ...clone(root),
      data: data.filter(r => String(r[root?.mappings?.x]) === String(clickedX)),
      format: { ...(root.format || {}), title: makeBreadcrumbTitle(root, clickedX) },
      chartType: root?.drilldown?.chartType || root?.chartType || "bar",
      mappings: {
        ...clone(root.mappings),
        x: root?.drilldown?.x || root?.mappings?.x,
        y: root?.drilldown?.y || root?.mappings?.y,
        color: root?.drilldown?.color || root?.mappings?.color,
        yOp: root?.drilldown?.yOp || root?.mappings?.yOp || "sum",
      }
    };
    drawDrill(drillSpec);
    updateToolbar();
  }

  function exitDrill() {
    view = { mode: "main", context: null };
    if (supportsHistory) history.pushState({}, "", "#");
    drawMain();
    updateToolbar();
  }

  function drawDrill(drillSpec) {
    const type = drillSpec?.chartType || "bar";
    let shaped;
    if (type === "heatmap") {
      const x = drillSpec?.mappings?.x, y = drillSpec?.mappings?.y, color = drillSpec?.mappings?.color;
      const { xs, ys, z } = pivotToMatrix(drillSpec.data, x, y, color, drillSpec?.mappings?.yOp || "sum");
      shaped = { xs, ys, z };
    } else if (type === "pie") {
      shaped = shapeData(drillSpec.data, drillSpec);
    } else {
      shaped = applySort(shapeData(drillSpec.data, drillSpec));
    }

    const traces = buildTraces(type, shaped, drillSpec);
    const layout = baseLayout({
      barmode,
      title: { text: drillSpec?.format?.title || "", x: 0, xanchor: "left" }
    });

    Plotly.react(gd, traces, layout, config);
    lastShaped = shaped;
  }

  function drawCurrent() {
    if (view.mode === "drill") {
      // rebuild a drillSpec from current spec + context
      const root = spec;
      const clickedX = view.context?.x;
      const drillSpec = {
        ...clone(root),
        data: data.filter(r => String(r[root?.mappings?.x]) === String(clickedX)),
        format: { ...(root.format || {}), title: makeBreadcrumbTitle(root, clickedX) },
        chartType: root?.drilldown?.chartType || root?.chartType || "bar",
        mappings: {
          ...clone(root.mappings),
          x: root?.drilldown?.x || root?.mappings?.x,
          y: root?.drilldown?.y || root?.mappings?.y,
          color: root?.drilldown?.color || root?.mappings?.color,
          yOp: root?.drilldown?.yOp || root?.mappings?.yOp || "sum",
        }
      };
      drawDrill(drillSpec);
    } else {
      drawMain();
    }
  }

  function bindHandlersForDrill() {
    if (!gd) return;
    gd.on("plotly_click", (ev) => {
      const p = ev?.points?.[0];
      if (!p) return;
      const clickedX = p.x;
      if (spec?.drilldown) enterDrill(clickedX);
    });
  }
  window.addEventListener("resize", () => { if (gd) Plotly.Plots.resize(gd); });
  if (supportsHistory) {
    window.addEventListener("popstate", () => {
      if (location.hash === "#drill" && view.mode !== "drill") {
        // ignore spurious
      } else if (location.hash !== "#drill" && view.mode === "drill") {
        exitDrill();
      }
    });
  }

  function clone(o) { return JSON.parse(JSON.stringify(o || {})); }

  // Kick off
  drawMain();
}

// Optional convenience wrapper (legacy) — build a common spend chart spec and render
export async function renderSpendChart({ csvUrl, containerIdOrEl }) {
  const spec = {
    dataUrl: csvUrl,
    chartType: "bar",
    mappings: { x: "supplier_category", y: "spend_anonymized", yOp: "sum" },
    format: { title: "Total Spend by Category", xTitle: "Category", yTitle: "Spend (AED)", units: "AED" },
    drilldown: { x: "spend_year", y: "spend_anonymized", yOp: "sum" }
  };
  return renderFromSpec(spec, containerIdOrEl);
}
