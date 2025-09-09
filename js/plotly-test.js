// Helper: parse CSV into JSON
async function loadCSV(url) {
  const text = await fetch(url).then(r => r.text());
  const [header, ...rows] = text.trim().split(/\r?\n/).map(r => r.split(","));
  return rows.map(r => Object.fromEntries(r.map((v,i) => [header[i], v])));
}

const modalEl = document.getElementById("fullViewModal");
const fvContainer = document.getElementById("fvContainer");
const btnDownload = document.getElementById("fvDownload");
const btnFullscreen = document.getElementById("fvFullscreen");

let chartMounted = false;

modalEl.addEventListener("shown.bs.modal", async () => {
  if(chartMounted) return;
  const rows = await loadCSV("data/all_spend_anonymized.csv");
  const categories = rows.map(r => r.Category);
  const values = rows.map(r => +r.SpendAED);

  const data = [{
    x: categories,
    y: values,
    type: "bar",
    marker: { color: "#16AF8E" } // Teal Core
  }];

  const layout = {
    paper_bgcolor: "#191919",
    plot_bgcolor: "#191919",
    font: { color: "#F9F3D9" },
    xaxis: { title: "Category" },
    yaxis: { title: "Spend (AED)" },
    margin: { t:40, l:60, r:20, b:60 }
  };

  await Plotly.newPlot(fvContainer, data, layout, { responsive:true });
  chartMounted = true;
});

// Fullscreen toggle
btnFullscreen.addEventListener("click", () => {
  const el = fvContainer;
  if(document.fullscreenElement) {
    document.exitFullscreen();
  } else if(el.requestFullscreen) {
    el.requestFullscreen();
  }
});

// Download PNG
btnDownload.addEventListener("click", () => {
  Plotly.downloadImage(fvContainer, {
    format:"png",
    filename:"spend_by_category",
    width:1280,
    height:720
  });
});
