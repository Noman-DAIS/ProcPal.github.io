// js/plotly-renderer.js
import { loadCSVasJSON } from "./csv_parser.js";

export async function renderSpendChart(csvUrl, containerIdOrEl) {
  const container = typeof containerIdOrEl === "string"
    ? document.getElementById(containerIdOrEl)
    : containerIdOrEl;

  if (!container) throw new Error("Container not found");

  // Load + normalize
  const data = await loadCSVasJSON(csvUrl);
  data.forEach(d => {
    d.spend_anonymized = Number(d.spend_anonymized) || 0;
    d.spend_year = Number(d.spend_year) || d.spend_year;
  });

  // Small utilities
  const groupSum = (rows, key, valueKey) => {
    const map = new Map();
    rows.forEach(r => map.set(r[key], (map.get(r[key]) || 0) + (Number(r[valueKey]) || 0)));
    return { keys: [...map.keys()], values: [...map.values()] };
  };

  let view = { mode: "main", category: null };

  function config() {
    return {
      responsive: true,
      displaylogo: false,
      modeBarButtonsToAdd: ["v1hovermode", "toggleSpikelines"],
      toImageButtonOptions: { filename: "supplier_spend" }
    };
  }

  function baseLayout(overrides = {}) {
    return {
      paper_bgcolor: "#191919",
      plot_bgcolor: "#191919",
      font: { color: "#F9F3D9" },
      hovermode: "x unified",
      xaxis: { showspikes: true, spikemode: "across", spikecolor: "#888", spikethickness: 1 },
      yaxis: { showspikes: true, spikemode: "across", spikecolor: "#888", spikethickness: 1 },
      ...overrides
    };
  }

  function drawMain() {
    view = { mode: "main", category: null };
    const { keys: categories, values: totals } = groupSum(data, "supplier_category", "spend_anonymized");

    const trace = {
      type: "bar",
      x: categories,
      y: totals,
      marker: { color: "#16AF8E" },
      hovertemplate: "<b>%{x}</b><br>Spend: %{y}<extra></extra>"
    };

    const layout = baseLayout({
      title: "Total Spend by Category",
      xaxis: { ...baseLayout().xaxis, title: "Supplier Category" },
      yaxis: { ...baseLayout().yaxis, title: "Spend (AED)" },
      updatemenus: [{
        buttons: [
          { method: "restyle", args: ["type", "bar"], label: "Bar" },
          { method: "restyle", args: ["type", "line"], label: "Line" },
          { method: "restyle", args: ["type", "pie"], label: "Pie" }
        ],
        direction: "left",
        x: 0.0, y: 1.15, showactive: true,
        bgcolor: "#333", bordercolor: "#16AF8E"
      }],
      annotations: [
        {
          text: "Tip: click a category bar to drill down by year",
          xref: "paper", yref: "paper", x: 0, y: 1.13,
          showarrow: false, align: "left",
          font: { size: 12, color: "#ccc" }
        }
      ]
    });

    Plotly.newPlot(container, [trace], layout, config());
  }

  function drawDrill(category) {
    view = { mode: "drill", category };
    const filtered = data.filter(d => d.supplier_category === category);
    const { keys: years, values: spends } = groupSum(filtered, "spend_year", "spend_anonymized");

    const trace = {
      type: "bar",
      x: years,
      y: spends,
      marker: { color: "#F9B73F" },
      hovertemplate: `<b>${category}</b><br>Year: %{x}<br>Spend: %{y}<extra></extra>`
    };

    const layout = baseLayout({
      title: `Spend by Year — ${category}`,
      xaxis: { ...baseLayout().xaxis, title: "Year" },
      yaxis: { ...baseLayout().yaxis, title: "Spend (AED)" },
      annotations: [
        {
          text: "← Back to categories",
          xref: "paper", yref: "paper",
          x: 0, y: 1.1, showarrow: false,
          font: { color: "#16AF8E", size: 14 },
          bgcolor: "#333", bordercolor: "#16AF8E", borderpad: 4
        }
      ],
      updatemenus: [{
        buttons: [
          { method: "restyle", args: ["type", "bar"], label: "Bar" },
          { method: "restyle", args: ["type", "line"], label: "Line" },
          { method: "restyle", args: ["type", "pie"], label: "Pie" }
        ],
        direction: "left",
        x: 0.0, y: 1.15, showactive: true,
        bgcolor: "#333", bordercolor: "#16AF8E"
      }]
    });

    Plotly.newPlot(container, [trace], layout, config());
  }

  // Wire up interactions
  container.on("plotly_click", ev => {
    if (view.mode === "main") {
      const category = ev?.points?.[0]?.x;
      if (category) drawDrill(category);
    }
  });
  container.on("plotly_clickannotation", () => {
    if (view.mode === "drill") drawMain();
  });

  window.addEventListener("resize", () => Plotly.Plots.resize(container));

  // First paint
  drawMain();
}
