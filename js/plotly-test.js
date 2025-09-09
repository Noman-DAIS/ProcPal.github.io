// plotly-test.js (refactored)

// CONFIG — adjust these to match your CSV
const CONFIG = {
  csvUrl: "data/all_spend_anonymized.csv",
  columns: {
    category: "supplier_category",     // e.g., "supplier_category" or "Category"
    value: "spend_anonymized"          // e.g., "spend_anonymized" or "SpendAED"
  },
  brand: { bg: "#191919", fg: "#F9F3D9", accent: "#16AF8E" }
};

// Basic CSV loader (fine for simple data; switch to Papa Parse if fields get complex)
async function loadCSV(url) {
  const text = await fetch(url).then(r => r.text());
  const lines = text.trim().split(/\r?\n/).map(l => l.split(","));
  const header = lines.shift();
  return lines.map(row => Object.fromEntries(row.map((v,i) => [header[i], v])));
}

// Sum values by a key and return sorted arrays
function sumBy(rows, key, valKey) {
  const m = new Map();
  for (const r of rows) {
    const k = (r[key] || "Unknown").trim();
    const v = Number(r[valKey]) || 0;
    m.set(k, (m.get(k) || 0) + v);
  }
  const arr = [...m.entries()].sort((a,b) => b[1] - a[1]);
  return { labels: arr.map(d => d[0]), values: arr.map(d => d[1]) };
}

// DOM
const modalEl = document.getElementById("fullViewModal");
const fvContainer = document.getElementById("fvContainer");
const btnDownload = document.getElementById("fvDownload");
const btnFullscreen = document.getElementById("fvFullscreen");

let plotted = false;

// Render (idempotent): (re)build the chart each time the modal opens
async function renderChart() {
  const rows = await loadCSV(CONFIG.csvUrl);
  const { labels, values } = sumBy(rows, CONFIG.columns.category, CONFIG.columns.value);

  const data = [{
    x: labels,
    y: values,
    type: "bar",
    marker: { color: CONFIG.brand.accent }
  }];

  const layout = {
    paper_bgcolor: CONFIG.brand.bg,
    plot_bgcolor: CONFIG.brand.bg,
    font: { color: CONFIG.brand.fg },
    xaxis: { title: "Category" },
    yaxis: { title: "Spend (AED)", tickformat: ",.0f" },
    margin: { t: 40, l: 60, r: 20, b: 80 }
  };

  if (plotted) {
    await Plotly.react(fvContainer, data, layout, { responsive: true });
  } else {
    await Plotly.newPlot(fvContainer, data, layout, { responsive: true });
    plotted = true;
  }
}

// Open → render; Close → purge (cleanup)
modalEl.addEventListener("shown.bs.modal", renderChart);
modalEl.addEventListener("hidden.bs.modal", () => {
  if (plotted) { Plotly.purge(fvContainer); plotted = false; }
});

// Fullscreen toggle (+ resize after change)
btnFullscreen.addEventListener("click", () => {
  const el = fvContainer;
  if (document.fullscreenElement) document.exitFullscreen();
  else if (el.requestFullscreen) el.requestFullscreen();
});
["fullscreenchange","webkitfullscreenchange","mozfullscreenchange","MSFullscreenChange"]
  .forEach(evt => document.addEventListener(evt, () => {
    // small delay helps after transition
    setTimeout(() => Plotly.Plots.resize(fvContainer), 150);
  }));

// Download PNG
btnDownload.addEventListener("click", () => {
  Plotly.downloadImage(fvContainer, {
    format: "png",
    filename: "spend_by_category",
    width: 1280,
    height: 720
  });
});
