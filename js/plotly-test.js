// js/plotly-test.js
import { renderSpendChart } from "./output_renderer.js";

// CHANGE THIS to your CSV path
const CSV_URL = "./data/supplier_spend.csv";

const modalEl = document.getElementById("fullViewModal");
const chartEl = document.getElementById("fvContainer");
const dlBtn = document.getElementById("fvDownload");
const fsBtn = document.getElementById("fvFullscreen");

let rendered = false;

function ensureRendered() {
  if (!rendered) {
    renderSpendChart(CSV_URL, chartEl);
    rendered = true;
  }
}

// Bootstrap modal event: render when shown
modalEl?.addEventListener("shown.bs.modal", ensureRendered);

// Download PNG
dlBtn?.addEventListener("click", () => {
  Plotly.downloadImage(chartEl, { format: "png", filename: "supplier_spend" });
});

// Toggle Fullscreen
fsBtn?.addEventListener("click", async () => {
  const el = chartEl;
  if (!document.fullscreenElement) {
    await el.requestFullscreen?.();
  } else {
    await document.exitFullscreen?.();
  }
});

// Optional: render immediately (if you want chart even before modal opens)
// ensureRendered();
