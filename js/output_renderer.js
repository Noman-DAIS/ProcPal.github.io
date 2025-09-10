// js/output_renderer.js
import { loadCSVasJSON } from "./csv_parser.js";
import { getChartSpec } from "./output_function.js";

// Public API
export async function renderSpendChart(csvUrl, containerIdOrEl) {
  const el = typeof containerIdOrEl === "string"
    ? document.getElementById(containerIdOrEl)
    : containerIdOrEl;
  if (!el) throw new Error("Chart container not found");

  const spec = getChartSpec();
  const raw = await loadCSVasJSON(csvUrl);

  // Normalize required fields
  const data = raw.map(d => ({
    ...d,
    [spec.yKey]: Number(d[spec.yKey]) || 0,
    [spec.drillKey]: typeof d[spec.drillKey] === "number" ? d[spec.drillKey] : Number(d[spec.drillKey]) || d[spec.drillKey]
  }));

  // Helpers
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
    yaxis: { showspikes: true, spikemode: "across", spikecolor: "#777", spikethickness: 1, tickformat: ",.0f" },
    ...overrides
  });

  // View state
  let view = { mode: "main", category: null };

  function drawMain() {
    view = { mode: "main", category: null };
    const { keys: cats, values: totals } = groupSum(data, spec.xKeyMain, spec.yKey);

    const trace = {
      type: "bar",
      x: cats,
      y: totals,
      marker: { color: "#16AF8E" },
      hovertemplate: `<b>%{x}</b><br>${spec.hoverUnits}: %{y:,}<extra></extra>`
    };

    const layout = baseLayout({
      title: spec.titleMain,
      xaxis: { ...baseLayout().xaxis, title: "Supplier Category" },
      yaxis: { ...baseLayout().yaxis, title: `${spec.hoverUnits}` },
      updatemenus: [{
        buttons: [
          { method: "restyle", args: ["type", "bar"],  label: "Bar"  },
          { method: "restyle", args: ["type", "line"], label: "Line" },
          { method: "restyle", args: ["type", "pie"],  label: "Pie"  }
        ],
        direction: "left",
        x: 0.0, y: 1.15, showactive: true,
        bgcolor: "#333", bordercolor: "#16AF8E"
      }],
      annotations: [{
        text: "Tip: click a category bar to drill down by year",
        xref: "paper", yref: "paper", x: 0, y: 1.13,
        showarrow: false, align: "left",
        font: { size: 12, color: "#ccc" }
      }]
    });

    Plotly.newPlot(el, [trace], layout, cfg);
  }

  function drawDrill(category) {
    view = { mode: "drill", category };
    const subset = data.filter(d => d[spec.xKeyMain] === category);
    const { keys: years, values: spends } = groupSum(subset, spec.drillKey, spec.yKey);

    const trace = {
      type: "bar",
      x: years,
      y: spends,
      marker: { color: "#F9B73F" },
      hovertemplate: `<b>${category}</b><br>Year: %{x}<br>${spec.hoverUnits}: %{y:,}<extra></extra>`
    };

    const layout = baseLayout({
      title: `${spec.titleDrillPrefix}${category}`,
      xaxis: { ...baseLayout().xaxis, title: "Year" },
      yaxis: { ...baseLayout().yaxis, title: `${spec.hoverUnits}` },
      annotations: [{
        text: "← Back to categories",
        xref: "paper", yref: "paper", x: 0, y: 1.1,
        showarrow: false,
        font: { color: "#16AF8E", size: 14 },
        bgcolor: "#333", bordercolor: "#16AF8E", borderpad: 4
      }],
      updatemenus: [{
        buttons: [
          { method: "restyle", args: ["type", "bar"],  label: "Bar"  },
          { method: "restyle", args: ["type", "line"], label: "Line" },
          { method: "restyle", args: ["type", "pie"],  label: "Pie"  }
        ],
        direction: "left",
        x: 0.0, y: 1.15, showactive: true,
        bgcolor: "#333", bordercolor: "#16AF8E"
      }]
    });

    Plotly.newPlot(el, [trace], layout, cfg);
  }

  // Wire events
  el.on("plotly_click", ev => {
    if (view.mode !== "main") return;
    const clickedX = ev?.points?.[0]?.x;
    if (clickedX != null) drawDrill(clickedX);
  });
  el.on("plotly_clickannotation", () => {
    if (view.mode === "drill") drawMain();
  });
  window.addEventListener("resize", () => Plotly.Plots.resize(el));

  // First render
  drawMain();
}
