import { loadCSVasJSON } from "./csv-loader.js";

/**
 * Render supplier spend chart
 * @param {string} url - Path to CSV file
 * @param {string} containerId - ID of the chart container div
 */
export async function renderSpendChart(url, containerId) {
  // Load data from CSV
  const data = await loadCSVasJSON(url);

  // Convert numeric values
  data.forEach(d => {
    d.spend_anonymized = +d.spend_anonymized;
    d.spend_year = +d.spend_year;
  });

  // Step 1: Group spend by category (initial view)
  const grouped = {};
  data.forEach(d => {
    if (!grouped[d.supplier_category]) grouped[d.supplier_category] = 0;
    grouped[d.supplier_category] += d.spend_anonymized;
  });

  const categories = Object.keys(grouped);
  const spendTotals = Object.values(grouped);

  // Step 2: Render initial bar chart
  const trace = {
    type: "bar",
    x: categories,
    y: spendTotals,
    marker: { color: "teal" },
    hovertemplate: "Category: %{x}<br>Spend: %{y}<extra></extra>"
  };

  const layout = {
    title: "Total Spend by Category",
    xaxis: { title: "Supplier Category" },
    yaxis: { title: "Spend (AED)" },
    paper_bgcolor: "#191919",
    plot_bgcolor: "#191919",
    font: { color: "#f9f3d9" }
  };

  Plotly.newPlot(containerId, [trace], layout, { responsive: true });

  // Step 3: Drill-down on click (category → spend_year)
  const container = document.getElementById(containerId);
  container.on("plotly_click", function(evt) {
    const clickedCategory = evt.points[0].x;

    // Filter data by category
    const filtered = data.filter(d => d.supplier_category === clickedCategory);

    // Group by spend_year
    const byYear = {};
    filtered.forEach(d => {
      if (!byYear[d.spend_year]) byYear[d.spend_year] = 0;
      byYear[d.spend_year] += d.spend_anonymized;
    });

    const years = Object.keys(byYear);
    const spends = Object.values(byYear);

    // Update chart with drill-down
    const drillTrace = {
      type: "bar",
      x: years,
      y: spends,
      marker: { color: "orange" },
      hovertemplate: "Year: %{x}<br>Spend: %{y}<extra></extra>"
    };

    const drillLayout = {
      title: `Spend by Year — ${clickedCategory}`,
      xaxis: { title: "Year" },
      yaxis: { title: "Spend (AED)" },
      paper_bgcolor: "#191919",
      plot_bgcolor: "#191919",
      font: { color: "#f9f3d9" }
    };

    Plotly.newPlot(containerId, [drillTrace], drillLayout, { responsive: true });
  });
}
