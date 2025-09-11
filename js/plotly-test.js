// js/plotly-test.js
import { renderSpendChart } from "./output_renderer.js";
//import { renderFromSpec as renderSpendChart } from './output_renderer.js';

const CSV_URL = "./data/supplier_spend.csv"; // <-- update if your CSV lives elsewhere

const modalEl = document.getElementById("fullViewModal");
const chartEl = document.getElementById("fvContainer");
const dlBtn   = document.getElementById("fvDownload");
const fsBtn   = document.getElementById("fvFullscreen");

let rendered = false;

function safeLogEnv() {
  console.group("[plotly-test]");
  console.log("CSV_URL:", CSV_URL);
  console.log("#fullViewModal exists:", !!modalEl);
  console.log("#fvContainer exists:", !!chartEl);
  console.log("#fvDownload exists:", !!dlBtn);
  console.log("#fvFullscreen exists:", !!fsBtn);
  console.groupEnd();
}

async function safeRender() {
  try {
    await renderSpendChart(CSV_URL, chartEl);
  } catch (err) {
    console.error("[plotly-test] CSV render failed, using inline sample:", err);
    const sample = [
      "supplier_id,supplier_name,supplier_location,spend_year,supplier_category,supplier_subcategory,spend_anonymized",
      "S0001,Supplier_0001,,2022,Electronics,,38747.0",
      "S0002,Supplier_0003,,2023,Metal Components,Sub-contracting,2852.9",
      "S0004,Supplier_0004,,2023,Electronics,,3155.52",
      "S0005,Supplier_0005,,2022,Electronics,,39780.0"
    ].join("\n");
    const blob = new Blob([sample], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    try { await renderSpendChart(url, chartEl); }
    finally { URL.revokeObjectURL(url); }
  }
}

function ensureRendered() {
  if (rendered || !chartEl) return;
  // render after modal is visible so the plot gets real dimensions
  requestAnimationFrame(async () => {
    await safeRender();
    setTimeout(() => window.Plotly?.Plots.resize(chartEl), 60);
    rendered = true;
  });
}

// Bootstrap modal lifecycle
modalEl?.addEventListener("shown.bs.modal", ensureRendered);

// Buttons
dlBtn?.addEventListener("click", () => {
  window.Plotly?.downloadImage(chartEl, { format: "png", filename: "supplier_spend" });
});
fsBtn?.addEventListener("click", async () => {
  try {
    if (!document.fullscreenElement) await chartEl?.requestFullscreen?.();
    else await document.exitFullscreen?.();
  } catch (e) { console.error("Fullscreen error:", e); }
});

// Optional immediate render if you want the chart even without opening the modal.
// ensureRendered();

document.addEventListener("DOMContentLoaded", safeLogEnv);
