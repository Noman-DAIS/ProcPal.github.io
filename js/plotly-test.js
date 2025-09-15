// js/plotly-test.js
import { renderSpendChart } from "./output_renderer.js";

const CSV_URL = "./data/supplier_spend.csv";
const chartSel = "#fvContainer";
const modalSel = "#fullViewModal";
let rendered = false;

function logEnv() {
  console.group("[plotly-test]");
  console.log("CSV_URL:", CSV_URL);
  console.log("#fullViewModal exists:", !!document.querySelector(modalSel));
  console.log("#fvContainer exists:", !!document.querySelector(chartSel));
  console.groupEnd();
}

async function renderChart() {
  try {
    await renderSpendChart({ csvUrl: CSV_URL, containerIdOrEl: chartSel });
    rendered = true;
  } catch (err) {
    console.error("[plotly-test] render failed:", err);
  }
}

function onShown() {
  if (!rendered) {
    renderChart();
  } else {
    const gd = document.querySelector(`${chartSel} > div`);
    if (gd && window.Plotly) Plotly.Plots.resize(gd);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  logEnv();

  const modal = document.querySelector(modalSel);
  if (modal) {
    modal.addEventListener("shown.bs.modal", onShown);
  } else {
    renderChart();
  }
});
