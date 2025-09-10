// js/output_function.js
// Defines which columns drive the chart and titles
export function getChartSpec() {
  return {
    xKeyMain: "supplier_category",      // main view: categories on X
    yKey: "spend_anonymized",           // Y value is spend
    drillKey: "spend_year",             // drill by year
    titleMain: "Total Spend by Category",
    titleDrillPrefix: "Spend by Year — ",
    hoverUnits: "AED"
  };
}
