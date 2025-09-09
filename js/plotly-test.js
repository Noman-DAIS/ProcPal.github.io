// js/plotly-test.js

// CONFIG — adjust if you rename/move the CSV
const CONFIG = {
  csvUrl: "data/supplier_spend.csv",
  brand: { bg: "#191919", fg: "#F9F3D9", accent: "#16AF8E" }
};

// Basic CSV loader (fine for your current data)
async function loadCSV(url) {
  const text = await fetch(url).then(r => {
    if (!r.ok) throw new Error(`Failed to load ${url} (${r.status})`);
    return r.text();
  });
  const lines = text.trim().split(/\r?\n/).map(l => l.split(","));
  const header = lines.shift();
  return lines.map(row => Object.fromEntries(row.map((v,i) => [header[i], v])));
}

// Aggregate spend by supplier_name × spend_year (sum duplicates safely)
function aggregateBySupplierYear(rows) {
  // Prefer supplier_name; fallback to supplier_id when missing
  const keyOf = r => (r.supplier_name && r.supplier_name.trim()) || (r.supplier_id || "").trim() || "Unknown";
  const years = [...new Set(rows.map(r => (r.spend_year || "").trim()))].filter(Boolean).sort();
  const suppliers = [...new Set(rows.map(keyOf))];

  // Build matrix supplier x year
  const sum = new Map(); // key "supplier|year" -> total
  for (const r of rows) {
    const s = keyOf(r);
    const y = (r.spend_year || "").trim();
    const amt = Number(r.spend_anonymized) || 0;
    if (!y) continue;
    const k = `${s}|${y}`;
    sum.set(k, (sum.get(k) || 0) + amt);
  }

  // Sort suppliers by total desc (exec-friendly)
  const totals = suppliers.map(s => ({
    s,
    total: years.reduce((acc,y) => acc + (sum.get(`${s}|${y}`) || 0), 0)
  }));
  totals.sort((a,b) => b.total - a.total);
  const sortedSuppliers = totals.map(t => t.s);

  // Build traces (one per year)
  const traces = years.map(y => ({
    x: sortedSuppliers,
    y: sortedSuppliers.map(s => sum.get(`${s}|${y}`) || 0),
    name: y,
    type: "bar"
  }));

  return { traces, suppliers: sortedSuppliers, years };
}

const modalEl = document.getElementById("fullViewModal");
const fvContainer = document.getElementById("fvContainer");
const btnDownload = document.getElementById("fvDownload");
const btnFullscreen = document.getElementById("fvFullscreen");

let plotted = false;

async function renderChart() {
  const rows = await loadCSV(CONFIG.csvUrl);
  const { traces } = aggregateBySupplierYear(rows);

  const layout = {
    barmode: "stack",
    paper_bgcolor: CONFIG.brand.bg,
    plot_bgcolor: CONFIG.brand.bg,
    font: { color: CONFIG.brand.fg },
    xaxis: { title: "Supplier" },
    yaxis: { title: "Spend (AED)", tickformat: ",.0f" },
    margin: { t: 40, l: 70, r: 24, b: 100 }
  };

  // Use a consistent accent for better brand feel; Plotly will auto-color per trace as needed
  traces.forEach(tr => (tr.marker = tr.marker || {color: CONFIG.brand.accent}));

  if (plotted) {
    await Plotly.react(fvContainer, traces, layout, { responsive: true });
  } else {
    await Plotly.newPlot(fvContainer, traces, layout, { responsive: true });
    plotted = true;
  }
}

// Open → render; Close → purge for clean re-opens
modalEl.addEventListener("shown.bs.modal", renderChart);
modalEl.addEventListener("hidden.bs.modal", () => {
  if (plotted) { Plotly.purge(fvContainer); plotted = false; }
});

// Fullscreen + resize after transition
btnFullscreen.addEventListener("click", () => {
  const el = fvContainer;
  if (document.fullscreenElement) document.exitFullscreen();
  else el.requestFullscreen?.();
});
["fullscreenchange","webkitfullscreenchange","mozfullscreenchange","MSFullscreenChange"]
  .forEach(evt => document.addEventListener(evt, () => setTimeout(() => Plotly.Plots.resize(fvContainer), 120)));

// Download PNG
btnDownload.addEventListener("click", () => {
  Plotly.downloadImage(fvContainer, {
    format: "png",
    filename: "supplier_spend_analysis",
    width: 1280,
    height: 720
  });
});
