// js/output_renderer.js
// Renderer with auto-drill. Requires window.Plotly and ./csv_parser.js
import { loadCSVasJSON } from "./csv_parser.js";

/**
 * Render a chart from a spec into a container.
 * Auto-infers drill path if spec.drilldown?.path is missing.
 * @param {Object} spec
 * @param {string|HTMLElement} containerIdOrEl
 */
export async function renderFromSpec(spec, containerIdOrEl) {
  // ----- Container -----
  const container = typeof containerIdOrEl === "string"
    ? (containerIdOrEl.startsWith("#") ? document.querySelector(containerIdOrEl)
                                       : document.getElementById(containerIdOrEl))
    : containerIdOrEl;
  if (!container) throw new Error("Container not found");

  // ----- Data -----
  let data = Array.isArray(spec?.data) && spec.data.length ? spec.data : [];
  const csvUrl = spec?.dataUrl || spec?.csvUrl || spec?.url;
  if (!data.length && csvUrl) {
    data = await loadCSVasJSON(csvUrl);
  }
  if (!Array.isArray(data) || !data.length) {
    container.innerHTML = `<div class="text-danger p-3">No data to render.</div>`;
    return;
  }

  // ----- State -----
  const SORT_KEY = "dais.sortMode";
  let sortMode = (localStorage.getItem(SORT_KEY) || "label");
  let barmode = spec?.format?.barmode || "group";
  let gd = null;                // Plotly graph div
  let lastShaped = null;        // shaped data for export

  // ----- Drill path inference -----
  const MAX_CATS = spec?.drillMaxCats ?? 30;

  function profileFields(rows) {
    const sample = rows.slice(0, 5000);
    const fields = Object.keys(sample[0] || {});
    const uniq = Object.fromEntries(fields.map(f => [f, new Set()]));
    for (const r of sample) for (const f of fields) uniq[f].add(r[f]);
    const meta = {};
    for (const f of fields) {
      const u = uniq[f].size;
      const allNum = sample.every(r => typeof r[f] === "number" && Number.isFinite(r[f]));
      const looksYear = allNum && u <= 50 && /(year|yr)$/i.test(f);
      const temporal = looksYear || /(date|month|quarter)/i.test(f);
      const categorical = !allNum || u <= MAX_CATS;
      meta[f] = { uniq: u, allNum, temporal, categorical };
    }
    return meta;
  }

  const fieldMeta = profileFields(data);

  function computeAutoPath() {
    const used = new Set();
    const path = [];
    const x0 = spec?.mappings?.x;
    if (x0) { path.push(x0); used.add(x0); }
    const addIf = (pred) => {
      Object.entries(fieldMeta)
        .filter(([f,m]) => !used.has(f) && pred(f,m))
        .sort((a,b) => a[1].uniq - b[1].uniq)
        .forEach(([f]) => { path.push(f); used.add(f); });
    };
    // Prefer temporal categoricals first
    addIf((f,m) => m.temporal && m.categorical && m.uniq >= 2);
    // Then color if exists and reasonable
    const color = spec?.mappings?.color;
    if (color && !used.has(color) && fieldMeta[color]?.categorical) {
      path.push(color); used.add(color);
    }
    // Then remaining categoricals
    addIf((f,m) => m.categorical && m.uniq >= 2);
    return path.filter((f, i, a) => a.indexOf(f) === i);
  }

  const drillPath = spec?.drilldown?.path?.length ? spec.drilldown.path : computeAutoPath();

  let view = { level: 0, filters: [] }; // filters[i] = selected value for drillPath[i]

  function currentX(level) { return drillPath[level]; }

  function filteredRowsFor(level) {
    let rows = data;
    for (let i = 0; i < level; i++) {
      const f = drillPath[i];
      const v = view.filters[i];
      rows = rows.filter(r => String(r[f]) === String(v));
    }
    return rows;
  }

  // ----- Aggregation helpers -----
  function aggregator(yOp) {
    switch (yOp) {
      case "count":
        return {
          init: () => 0,
          add: (s, _) => s + 1,
          value: (s) => s
        };
      case "mean":
        return {
          init: () => ({ s: 0, n: 0 }),
          add: (st, v) => ({ s: st.s + (Number(v) || 0), n: st.n + 1 }),
          value: (st) => st.n ? st.s / st.n : 0
        };
      case "min":
        return {
          init: () => Infinity,
          add: (s, v) => Math.min(s, Number(v) || 0),
          value: (s) => (s === Infinity ? 0 : s)
        };
      case "max":
        return {
          init: () => -Infinity,
          add: (s, v) => Math.max(s, Number(v) || 0),
          value: (s) => (s === -Infinity ? 0 : s)
        };
      case "sum":
      default:
        return {
          init: () => 0,
          add: (s, v) => s + (Number(v) || 0),
          value: (s) => s
        };
    }
  }

  function shapeData(rows, specLike) {
    const xKey = specLike?.mappings?.x;
    const yKey = specLike?.mappings?.y;
    const colorKey = specLike?.mappings?.color;
    const yOp = specLike?.mappings?.yOp || "sum";
    const agg = aggregator(yOp);

    if (!xKey) return { x: [], y: [] };

    if (colorKey) {
      const seriesMap = new Map(); // color -> Map(x -> agg_state)
      const xSet = new Set();
      for (const r of rows) {
        const xVal = r[xKey];
        const cVal = r[colorKey];
        xSet.add(xVal);
        if (!seriesMap.has(cVal)) seriesMap.set(cVal, new Map());
        const m = seriesMap.get(cVal);
        const cur = m.has(xVal) ? m.get(xVal) : agg.init();
        m.set(xVal, agg.add(cur, yKey ? r[yKey] : 1));
      }
      const xs = Array.from(xSet);
      const series = Array.from(seriesMap.entries()).map(([name, m]) => {
        const y = xs.map(xv => agg.value(m.has(xv) ? m.get(xv) : agg.init()));
        return { name, y };
      });
      return { x: xs, series };
    } else {
      const map = new Map(); // x -> agg_state
      for (const r of rows) {
        const xVal = r[xKey];
        const cur = map.has(xVal) ? map.get(xVal) : agg.init();
        map.set(xVal, agg.add(cur, yKey ? r[yKey] : 1));
      }
      const xs = Array.from(map.keys());
      const ys = xs.map(x => agg.value(map.get(x)));
      return { x: xs, y: ys };
    }
  }

  function applySort(shaped) {
    if (!shaped) return shaped;
    if (shaped.series?.length) {
      // sort x by label or by total value across series
      const totals = shaped.x.map((_, i) =>
        shaped.series.reduce((s, srs) => s + (Number(srs.y[i]) || 0), 0)
      );
      const idx = shaped.x.map((_, i) => i);
      idx.sort((a,b) => {
        if (sortMode === "label") {
          const la = String(shaped.x[a]).localeCompare(String(shaped.x[b]));
          return la;
        } else {
          return totals[b] - totals[a]; // value desc
        }
      });
      shaped.x = idx.map(i => shaped.x[i]);
      for (const s of shaped.series) {
        s.y = idx.map(i => s.y[i]);
      }
      return shaped;
    } else if (shaped.x?.length) {
      const idx = shaped.x.map((_, i) => i);
      idx.sort((a,b) => {
        if (sortMode === "label") {
          return String(shaped.x[a]).localeCompare(String(shaped.x[b]));
        } else {
          return (Number(shaped.y[b]) || 0) - (Number(shaped.y[a]) || 0);
        }
      });
      shaped.x = idx.map(i => shaped.x[i]);
      shaped.y = idx.map(i => shaped.y[i]);
      return shaped;
    }
    return shaped;
  }

  function buildTraces(type, shaped, specLike) {
    const traces = [];
    if (type === "pie") {
      if (shaped.series?.length) {
        // collapse x; pie by series totals
        const labels = shaped.series.map(s => s.name);
        const values = shaped.series.map(s => s.y.reduce((a,b) => a + (Number(b)||0), 0));
        traces.push({ type: "pie", labels, values, hole: specLike?.format?.donut ? 0.4 : 0 });
      } else {
        traces.push({ type: "pie", labels: shaped.x, values: shaped.y, hole: specLike?.format?.donut ? 0.4 : 0 });
      }
      return traces;
    }
    // bar/line/scatter
    const base = { type: type === "scatter" ? "scatter" : type, mode: type === "line" || type === "scatter" ? "lines+markers" : undefined };
    if (shaped.series?.length) {
      for (const s of shaped.series) {
        traces.push({ ...base, name: s.name, x: shaped.x, y: s.y });
      }
    } else {
      traces.push({ ...base, name: specLike?.format?.seriesName || "", x: shaped.x, y: shaped.y });
    }
    return traces;
  }

  function baseLayout(overrides = {}) {
    return {
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
        categoryorder: "array",
        categoryarray: []
      },
      yaxis: {
        title: spec?.format?.yTitle || "",
        gridcolor: "#2a2a2a",
        zerolinecolor: "#2a2a2a",
        separatethousands: true
      },
      barmode,
      ...overrides
    };
  }

  // ----- Toolbar -----
  function ensureToolbar(container) {
    let bar = container.querySelector(":scope > .dais-toolbar");
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "dais-toolbar d-flex gap-2 align-items-center p-2";
      bar.innerHTML = `
        <button class="btn btn-sm btn-outline-light" data-act="back" title="Back">&larr; Back</button>
        <button class="btn btn-sm btn-outline-light" data-act="sort" title="Toggle sort">Sort</button>
        <button class="btn btn-sm btn-outline-light" data-act="mode" title="Group/Stack">Bars</button>
        <button class="btn btn-sm btn-outline-light" data-act="reset" title="Reset zoom">Reset</button>
        <button class="btn btn-sm btn-outline-light" data-act="csv" title="Download CSV">CSV</button>
      `;
      container.innerHTML = "";
      container.appendChild(bar);
      const div = document.createElement("div");
      div.style.width = "100%";
      div.style.height = "100%";
      div.style.minHeight = "65vh";
      container.appendChild(div);
      gd = div;
    }
    return bar;
  }

  function updateToolbar() {
    const bar = ensureToolbar(container);
    const backBtn = bar.querySelector('[data-act="back"]');
    backBtn.style.display = view.level > 0 ? "" : "none";
    const sortBtn = bar.querySelector('[data-act="sort"]');
    sortBtn.innerHTML = `Sort: <b>${sortMode}</b>`;
    const modeBtn = bar.querySelector('[data-act="mode"]');
    modeBtn.innerHTML = `Bars: <b>${barmode}</b>`;
  }

  function toCSV(rows) {
    if (!rows?.length) return "";
    const cols = Object.keys(rows[0]);
    const escape = s => `"${String(s).replaceAll('"','""')}"`;
    return [cols.join(","), ...rows.map(r=>cols.map(c=>escape(r[c]??"")).join(","))].join("\n");
  }

  function visibleRowsForExport(shaped, xLabel) {
    const out = [];
    if (!shaped) return out;
    if (shaped.series?.length) {
      for (const s of shaped.series) {
        for (let i = 0; i < shaped.x.length; i++) {
          out.push({ [xLabel]: shaped.x[i], series: s.name, value: s.y[i] });
        }
      }
    } else if (shaped.x?.length) {
      for (let i = 0; i < shaped.x.length; i++) {
        out.push({ [xLabel]: shaped.x[i], value: shaped.y[i] });
      }
    }
    return out;
  }

  function bindToolbarEvents() {
    const bar = ensureToolbar(container);
    bar.onclick = (e) => {
      const act = e.target?.getAttribute?.("data-act");
      if (!act) return;
      if (act === "back") stepBack();
      if (act === "sort") { sortMode = (sortMode === "label" ? "value" : "label"); localStorage.setItem(SORT_KEY, sortMode); drawLevel(view.level); }
      if (act === "mode") { barmode = (barmode === "group" ? "stack" : "group"); drawLevel(view.level); }
      if (act === "reset" && gd && window.Plotly) Plotly.relayout(gd, { "xaxis.autorange": true, "yaxis.autorange": true });
      if (act === "csv") {
        const xLabel = currentX(view.level) || (spec.mappings?.x || "x");
        const rows = visibleRowsForExport(lastShaped, xLabel);
        const name = (spec?.fileName || "chart_data") + ".csv";
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([toCSV(rows)], { type: "text/csv;charset=utf-8" }));
        a.download = name; a.click(); URL.revokeObjectURL(a.href);
      }
    };
    updateToolbar();
  }

  // ----- Drill handlers -----
  function canGoDeeper() { return view.level < drillPath.length - 1; }

  function stepIn(clickedX) {
    if (!canGoDeeper()) return;
    view.filters[view.level] = clickedX;
    view.level += 1;
    drawLevel(view.level);
  }

  function stepBack() {
    if (view.level === 0) return;
    view.level -= 1;
    view.filters = view.filters.slice(0, view.level);
    drawLevel(view.level);
  }

  function bindPlotHandlers() {
    if (!gd || !window.Plotly) return;
    gd.on?.("plotly_click", (ev) => {
      const p = ev?.points?.[0]; if (!p) return;
      if (canGoDeeper()) stepIn(p.x);
    });
  }

  // ----- Draw -----
  function drawLevel(level) {
    ensureToolbar(container);
    const rows = filteredRowsFor(level);
    const xField = currentX(level) || spec?.mappings?.x;
    if (!xField) return;

    const specLike = { ...spec, mappings: { ...spec.mappings, x: xField } };
    const type = (specLike.chartType || "bar").toLowerCase();

    let shaped = shapeData(rows, specLike);
    shaped = applySort(shaped);

    const titleBase = spec?.format?.title || "";
    const crumb = view.filters.slice(0, level)
      .map((v, i) => `${drillPath[i]}: ${v}`)
      .join(" • ");
    const titleText = crumb ? `${titleBase} — ${crumb}` : titleBase;

    const traces = buildTraces(type, shaped, specLike);
    const layout = baseLayout({ title: { text: titleText, x: 0, xanchor: "left" } });
    // set x category order explicitly
    layout.xaxis.categoryarray = shaped.x || [];

    if (gd && gd.parentElement === container.querySelector(":scope > div:last-child")) {
      Plotly.react(gd, traces, layout, { displaylogo: false, responsive: true });
    } else {
      gd = container.querySelector(":scope > div:last-child");
      Plotly.newPlot(gd, traces, layout, { displaylogo: false, responsive: true });
    }
    lastShaped = shaped;
    bindPlotHandlers();
    bindToolbarEvents();
    updateToolbar();
  }

  window.addEventListener("resize", () => {
    const graphDiv = gd || container.querySelector(":scope > div:last-child");
    if (graphDiv && window.Plotly) Plotly.Plots.resize(graphDiv);
  });

  // Kick off
  drawLevel(0);
}

/**
 * Convenience wrapper for demo usage (kept for backward compatibility).
 * Builds a default spend chart spec and calls renderFromSpec.
 */
export async function renderSpendChart({ csvUrl, containerIdOrEl = "#fvContainer" }) {
  const spec = {
    dataUrl: csvUrl,
    chartType: "bar",
    mappings: { x: "supplier_category", y: "spend_anonymized", yOp: "sum" },
    format: { title: "Total Spend by Category", xTitle: "Supplier Category", yTitle: "Spend (AED)" },
    fileName: "supplier_spend"
  };
  return renderFromSpec(spec, containerIdOrEl);
}
