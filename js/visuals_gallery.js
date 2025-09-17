// js/visuals_gallery.js
import { visualsStore } from "./visuals_store.js";
import { renderFromSpec } from "./output_renderer.js";

const byId = (s) => document.getElementById(s);

function ensureModals() {
  if (byId("visualPreviewModal")) return;
  document.body.insertAdjacentHTML("beforeend", `
<div class="modal fade" id="visualPreviewModal" tabindex="-1" aria-hidden="true">
  <div class="modal-dialog modal-lg modal-dialog-centered">
    <div class="modal-content bg-dark text-light">
      <div class="modal-header border-0">
        <h5 class="modal-title" id="vpTitle">Preview</h5>
        <button class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
      </div>
      <div class="modal-body d-flex justify-content-center">
        <img id="vpImage" alt="visual" class="img-fluid rounded" />
      </div>
      <div class="modal-footer border-0 justify-content-between">
        <div class="text-muted small" id="vpMeta"></div>
        <div>
          <button id="vpFull" class="btn btn-primary me-2"><i class="bi bi-arrows-fullscreen me-1"></i> Full View Mode</button>
          <button id="vpSave" class="btn btn-outline-light me-2"><i class="bi bi-download me-1"></i> Save</button>
          <button id="vpReport" class="btn btn-outline-warning"><i class="bi bi-file-earmark-text me-1"></i> Generate Report</button>
        </div>
      </div>
    </div>
  </div>
</div>
<div class="modal fade" id="fullViewModal" tabindex="-1" aria-hidden="true">
  <div class="modal-dialog modal-fullscreen">
    <div class="modal-content bg-dark text-light">
      <div class="modal-header border-0">
        <h5 class="modal-title" id="fvTitle">Full View</h5>
        <button class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
      </div>
      <div class="modal-body"><div id="fvContainer" style="height:100%; min-height:70vh;"></div></div>
      <div class="modal-footer border-0">
        <button class="btn btn-outline-light" id="fvDownload"><i class="bi bi-download me-1"></i>Download PNG</button>
      </div>
    </div>
  </div>
</div>`);
}

function blobURL(blob) { return URL.createObjectURL(blob); }

async function renderGrid() {
  const wrap = document.querySelector(".vis-wrap");
  if (!wrap) return;
  const items = await visualsStore.list({ limit: 200, order: "desc" });

  wrap.innerHTML = `
    <div id="visualsGrid" class="row g-3">
      ${items.map(v => `
        <div class="col-6">
          <div class="card bg-transparent border-0">
            <div class="ratio ratio-16x9 rounded" style="background:#202020;">
              ${v?.assets?.thumb ? `<img class="img-fluid rounded" data-id="${v.id}" alt="" src="${blobURL(v.assets.thumb)}"/>`
                                  : `<div class="d-flex align-items-center justify-content-center text-muted">No preview</div>`}
            </div>
            <div class="small mt-2 text-truncate">${v?.meta?.title ?? "Untitled"}</div>
          </div>
        </div>`).join("")}
    </div>
  `;

  // bind clicks
  wrap.querySelectorAll("img[data-id]").forEach(img => {
    img.addEventListener("click", async () => {
      const id = img.getAttribute("data-id");
      const v = await visualsStore.get(id);
      ensureModals();
      const vpImg = byId("vpImage");
      const vpTitle = byId("vpTitle");
      const vpMeta = byId("vpMeta");
      vpImg.src = v?.assets?.png ? blobURL(v.assets.png) : blobURL(v.assets.thumb);
      vpTitle.textContent = v?.meta?.title ?? "Preview";
      vpMeta.textContent = `${v?.meta?.chartType ?? ""} • ${new Date(v.createdAt).toLocaleString()}`;

      const modal = new bootstrap.Modal(byId("visualPreviewModal"));
      modal.show();

      byId("vpSave").onclick = () => {
        const a = document.createElement("a");
        a.href = vpImg.src; a.download = `visual_${id}.png`; a.click();
      };
      byId("vpReport").onclick = () => {
        window.dispatchEvent(new CustomEvent("report:add", { detail: { id } }));
      };
      byId("vpFull").onclick = async () => {
        // open full view and render live Plotly chart from spec
        const fv = new bootstrap.Modal(byId("fullViewModal"));
        byId("fvTitle").textContent = v?.meta?.title ?? "Full View";
        fv.show();
        await renderFromSpec(v.spec, "#fvContainer");
        byId("fvDownload").onclick = async () => {
          const el = document.querySelector("#fvContainer > div:last-child");
          if (!el || !window.Plotly) return;
          const dataUrl = await Plotly.toImage(el, { format: "png" });
          const a = document.createElement("a"); a.href = dataUrl; a.download = `visual_${id}.png`; a.click();
        };
      };
    });
  });
}

async function captureAndSaveFromGraphDiv(graphDiv, spec) {
  if (!graphDiv || !window.Plotly) return;
  // Full PNG
  const dataUrl = await Plotly.toImage(graphDiv, { format: "png" });
  const pngBlob = await (await fetch(dataUrl)).blob();
  // Thumb (scale down via canvas)
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const maxW = 480, maxH = 270;
  const r = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * r);
  c.height = Math.round(img.naturalHeight * r);
  const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0, c.width, c.height);
  const thumbBlob = await new Promise(res => c.toBlob(res, "image/png", 0.9));

  const id = spec.id || (crypto?.randomUUID?.() ?? String(Date.now()));
  spec.id = id;
  await visualsStore.put({
    id,
    spec,
    meta: { title: spec?.format?.title || "Untitled", chartType: spec?.chartType || "chart" },
    assets: { thumb: thumbBlob, png: pngBlob }
  });
}

function wireAutoCapture() {
  // Fired by output_renderer after initial plot
  window.addEventListener("v
