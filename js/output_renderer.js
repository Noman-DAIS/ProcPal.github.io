// js/output_renderer.js
import { loadCSVasJSON } from "./csv_parser.js";
import { getChartSpec } from "./output_function.js";

export async function renderSpendChart(csvUrl, containerIdOrEl) {
  const container = typeof containerIdOrEl === "string"
    ? document.getElementById(containerIdOrEl)
    : containerIdOrEl;
  if (!container) throw new Error("Chart container not found");

  const spec = getChartSpec();
  const raw = await loadCSVasJSON(csvUrl);

  // Normalize types
  const data = raw.map(d => ({
    ...d,
    [spec.yKey]: Number(d[spec.yKey]) || 0,
    [spec.drillKey]:
      typeof d[spec.drillKey] === "number"
        ? d[spec.drillKey]
        : Number(d[spec.drillKey]) || d[spec.drillKey]
  }));

  // ----- helpers -----
  const groupSum = (rows, key, valueKey) => {
    const m = new Map();
    rows.forEach(r => m.set(r[key], (m.get(r[key]) || 0) + (Number(r[valueKey]) || 0)));
    return { keys: [...m.keys()], values: [...m.values()] };
  };

  const cfg = {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToAdd: ["v1hovermode", "toggleSpikelines"],
    toImageButtonOptions: { filename: "supplier_spend" }
  };

  const baseLayout = (overrides = {}) => ({
    paper_bgcolor: "#191919",
    plot_bgcolor: "#191919",
    font: { color: "#F9F3D9" },
    hovermode: "x unified",
    xaxis: { showspikes: true, spikemode: "across", spikecolor: "#777", spikethickness: 1 },
    yaxis: {
      showspikes: true, spikemode: "across", spikecolor: "#777", spikethickness: 1,
      tickprefix: "AED ", separatethousands: true, tickformat: ",.0f"
    },
    ...overrides
  });

  // ----- state -----
  let view = { mode: "main", category: null };
  let gd = null;           // <- the graph div returned by Plotly
  let eventsBound = false; // <- bind handlers once

  // Centralized plot function that returns the graph div
  async function plot(traces, layout) {
    gd = await Plotly.newPlot(container, traces, layout, cfg);
    if (!eventsBound) {
      bindHandlers(); // bind once to current gd
      eventsBound = true;
    }
    return gd;
  }

  function bindHandlers() {
    if (!gd || !gd.on) return;

    // Click bar → drill (main view only)
    gd.on("plotly_click", (ev) => {
      if (view.mode !== "main") return;
      const category = ev?.points?.[0]?.x;
      if (category != null) drawDrill(category);
    });

    // Click "Back" annotation → main
    gd.on("plotly_clickannotation", () => {
      if (view.mode === "drill") drawMain();
    });

    // Keep responsive
    window.addEventListener("resize", () => {
      if (gd) Plotly.Plots.resize(gd);
    });
  }

  // ----- views -----
  async function drawMain() {
    view = { mode: "main", category: null };
    const { keys: cats, values: totals } = groupSum(data, spec.xKeyMain, spec.yKey);

    const traces = [{
      type: "bar",
      x: cats,
      y: totals,
      marker: { color: "#16AF8E" },
      hovertemplate: `<b>%{x}</b><br>${spec.hoverUnits}: %{y:,}<extra></extra>`
    }];

    const layout = baseLayout({
      title: spec.titleMain,
      xaxis: { ...baseLayout().xaxis, title: "Supplier Category" },
      yaxis: { ...baseLayout().yaxis, title: spec.hoverUnits },
      updatemenus: [{
        buttons: [
          { method: "restyle", args: ["type", "bar"],  label: "Bar"  },
          { method: "restyle", args: ["type", "line"], label: "Line" },
          { method: "restyle", args: ["type", "pie"],  label: "Pie"  }
        ],
        direction: "left", x: 0.0, y: 1.15, showactive: true,
        bgcolor: "#333", bordercolor: "#16AF8E"
      }],
      annotations: [{
        text: "Tip: click a category bar to drill down by year",
        xref: "paper", yref: "paper", x: 0, y: 1.13,
        showarrow: false, align: "left",
        font: { size: 12, color: "#ccc" }
      }]
    });

    await plot(traces, layout);
  }

  async function drawDrill(category) {
    view = { mode: "drill", category };
    const subset = data.filter(d => d[spec.xKeyMain] === category);
    const { keys: years, values: spends } = groupSum(subset, spec.drillKey, spec.yKey);

    const traces = [{
      type: "bar",
      x: years,
      y: spends,
      marker: { color: "#F9B73F" },
      hovertemplate: `<b>${category}</b><br>Year: %{x}<br>${spec.hoverUnits}: %{y:,}<extra></extra>`
    }];

    const layout = baseLayout({
      title: `${spec.titleDrillPrefix}${category}`,
      xaxis: { ...baseLayout().xaxis, title: "Year" },
      yaxis: { ...baseLayout().yaxis, title: spec.hoverUnits },
      updatemenus: [{
        buttons: [
          { method: "restyle", args: ["type", "bar"],  label: "Bar"  },
          { method: "restyle", args: ["type", "line"], label: "Line" },
          { method: "restyle", args: ["type", "pie"],  label: "Pie"  }
        ],
        direction: "left", x: 0.0, y: 1.15, showactive: true,
        bgcolor: "#333", bordercolor: "#16AF8E"
      }],
      annotations: [{
        text: "← Back to categories",
        xref: "paper", yref: "paper", x: 0, y: 1.1,
        showarrow: false,
        font: { color: "#16AF8E", size: 14 },
        bgcolor: "#333", bordercolor: "#16AF8E", borderpad: 4
      }]
    });

    await plot(traces, layout); // reuse same gd; handlers already bound
  }

  // initial render
  await drawMain();
}
