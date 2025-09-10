import { loadCSVasJSON } from "./csv-loader.js";

/**
 * Render supplier spend chart with interactivity
 * @param {string} url - Path to CSV file
 * @param {string} containerId - ID of chart container div
 */
export async function renderSpendChart(url, containerId) {
  const container = document.getElementById(containerId);

  // Load + clean data
  const data = await loadCSVasJSON(url);
  data.forEach(d => {
    d.spend_anonymized = +d.spend_anonymized;
    d.spend_year = +d.spend_year;
  });

  // Helper: group by a key
  function groupBy(data, key, valueKey) {
    const grouped = {};
    data.forEach(d => {
      if (!grouped[d[key]]) grouped[d[key]] = 0;
      grouped[d[key]] += d[valueKey];
    });
    return grouped;
  }

  // Initial view: spend by category
  function drawMain() {
    const grouped = groupBy(data, "supplier_category", "spend_anonymized");

    const categories = Object.keys(grouped);
    const totals = Object.values(grouped);

    const trace = {
      type: "bar",
      x: categories,
      y: totals,
      marker: { color: "#16AF8E" },
      hovertemplate: "<b>%{x}</b><br>Spend: %{y}<extra></extra>"
    };

    const layout = {
      title: "Total Spend by Category",
      xaxis: { title: "Supplier Category" },
      yaxis: { title: "Spend (AED)" },
      paper_bgcolor: "#191919",
      plot_bgcolor: "#191919",
      font: { color: "#F9F3D9" },
      updatemenus: [
        {
          buttons: [
            { method: "restyle", args: ["type", "bar"], label: "Bar" },
            { method: "restyle", args: ["type", "line"], label: "Line" },
            { method: "restyle", args: ["type", "pie"], label: "Pie" }
          ],
          direction: "left",
          x: 0.0, y: 1.15,
          showactive: true,
          bgcolor: "#333", bordercolor: "#16AF8E"
        }
      ]
    };

    Plotly.newPlot(containerId, [trace], layout, { responsive: true });

    // Drill-down on click
    container.on("plotly_click", evt => {
      const category = evt.points[0].x;
      drawDrilldown(category);
    });
  }

  // Drill-down view: spend by year for a category
  function drawDrilldown(category) {
    const filtered = data.filter(d => d.supplier_category === category);
    const grouped = groupBy(filtered, "spend_year", "spend_anonymized");

    const years = Object.keys(grouped);
    const spends = Object.values(grouped);

    const trace = {
      type: "bar",
      x: years,
      y: spends,
      marker: { color: "#F9B73F" },
      hovertemplate: `<b>${category}</b><br>Year: %{x}<br>Spend: %{y}<extra></extra>`
    };

    const layout = {
      title: `Spend by Year — ${category}`,
      xaxis: { title: "Year" },
      yaxis: { title: "Spend (AED)" },
      paper_bgcolor: "#191919",
      plot_bgcolor: "#191919",
      font: { color: "#F9F3D9" },
      annotations: [
        {
          text: "← Back",
          xref: "paper", yref: "paper",
          x: 0, y: 1.1, showarrow: false,
          font: { color: "#16AF8E", size: 14 },
          align: "left",
          bgcolor: "#333", bordercolor: "#16AF8E",
          borderpad: 4,
          clicktoshow: "onoff"
        }
      ]
    };

    Plotly.newPlot(containerId, [trace], layout, { responsive: true });

    // Custom back button click (using annotation workaround)
    container.on("plotly_clickannotation", () => {
      drawMain();
    });
  }

  // Add export as PNG
  function addExportButton() {
    const btn = document.createElement("button");
    btn.textContent = "Download PNG";
    btn.style.cssText =
      "margin:10px;padding:6px 12px;border:none;border-radius:6px;background:#16AF8E;color:#fff;cursor:pointer;";
    container.parentNode.insertBefore(btn, container);
    btn.addEventListener("click", () => {
      Plotly.downloadImage(container, { format: "png", filename: "supplier_spend" });
    });
  }

  // Run
  drawMain();
  addExportButton();
}
