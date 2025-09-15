// js/output_function.js
// Factory that returns the SPEC the renderer needs.
// Swap these fields to get a different chart without touching the renderer.
export function getChartSpec() {
  return {
    dataUrl: "./data/supplier_spend.csv",
    chartType: "bar",                           // "bar" | "line" | "scatter" | "pie" | "heatmap"
    mappings: {
      x: "supplier_category",                   // X dimension
      y: "spend_anonymized",                    // Y value
      color: null,                              // optional series/group
      yOp: "sum"                                // sum | mean | count | min | max
    },
    numericFields: ["spend_anonymized", "spend_year"],
    format: {
      title: "Total Spend by Category",
      xTitle: "Supplier Category",
      yTitle: "Spend (AED)",
      units: "AED",
      yTickPrefix: "AED ",
      yTickFormat: ",.0f",
      tip: "Tip: click a category bar to drill down by year"
    },
    interactions: {
      hoverMode: "x unified",
      typeSwitcher: true,                       // show Bar/Line/Pie switcher
      types: ["bar","line","pie"]
    },
    // Optional drilldown layer
    drilldown: {
      filterKey: "supplier_category",           // what we clicked on in main view
      by: "spend_year",                         // new X at drill
      chartType: "bar",
      titlePrefix: "Spend by Year"
      // color: "supplier_name"                 // (optional) make drill-down multi-series
    },
    fileName: "supplier_spend"
  };
}

// Example: a different chart (no code changes in renderer):
export function getTrendSpec() {
  return {
    dataUrl: "./data/supplier_spend.csv",
    chartType: "line",
    mappings: { x: "spend_year", y: "spend_anonymized", color: "supplier_category", yOp: "sum" },
    numericFields: ["spend_anonymized", "spend_year"],
    format: { title: "Spend Trend by Category", xTitle: "Year", yTitle: "Spend (AED)", units: "AED" },
    interactions: { typeSwitcher: true, types: ["line","bar","scatter"] },
    fileName: "spend_trend"
  };
}
