// js/app.js
import { VISUALS, BRAND } from './visuals.js';

const grid = document.getElementById('visualsGrid');
const modalEl = document.getElementById('fullViewModal');
const modal = new bootstrap.Modal(modalEl);
const fvTitle = document.getElementById('fvTitle');
const fvContainer = document.getElementById('fvContainer');
const btnFS = document.getElementById('fvFullscreen');
const btnDL = document.getElementById('fvDownload');
const btnZoom = document.getElementById('fvZoom');
const btnSave = document.getElementById('fvSave');

let current = { visual:null, api:null }; // api = { destroy, downloadPNG, toggleZoom }

// ---------- helpers ----------
async function fetchCSV(url){
  const text = await fetch(url).then(r => r.text());
  const [header, ...rows] = text.trim().split(/\r?\n/).map(r => r.split(','));
  return rows.map(r => Object.fromEntries(r.map((v,i)=>[header[i], v])));
}

function injectScript(src){
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

function clearContainer(el){
  el.innerHTML = '';
  const mount = document.createElement('div');
  mount.style.width = '100%';
  mount.style.height = '72vh';
  el.appendChild(mount);
  return mount;
}

// ---------- renderers ----------
const renderers = {
  echarts: {
    ensure: async () => { if(window.echarts) return; await injectScript('https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js'); },
    render: async (mount, visual) => {
      const data = visual.data ? await fetchCSV(visual.data) : [];
      const chart = echarts.init(mount, null, { renderer: 'canvas' });
      chart.setOption(visual.build(data));
      const resize = () => chart.resize();
      window.addEventListener('resize', resize);
      return {
        destroy(){ window.removeEventListener('resize', resize); chart.dispose(); },
        downloadPNG(){
          const url = chart.getDataURL({ type:'png', pixelRatio:2, backgroundColor: BRAND.shale });
          const a = Object.assign(document.createElement('a'), { href: url, download: `${visual.id}.png` });
          a.click();
        },
        toggleZoom(){
          const opt = chart.getOption();
          const dz = opt.dataZoom || [];
          const showing = dz.length && (dz[0].show ?? true);
          chart.setOption({ dataZoom: dz.map(z => ({...z, show: !showing})) });
        }
      };
    }
  },
  plotly: {
    ensure: async () => { if(window.Plotly) return; await injectScript('https://cdn.jsdelivr.net/npm/plotly.js-dist-min@2.35.2/plotly.min.js'); },
    render: async (mount, visual) => {
      const spec = visual.build(); // inline dummy data
      await Plotly.newPlot(mount, spec.data, spec.layout, spec.config);
      const onResize = () => Plotly.Plots.resize(mount);
      window.addEventListener('resize', onResize);
      return {
        destroy(){ window.removeEventListener('resize', onResize); Plotly.purge(mount); },
        downloadPNG(){ Plotly.downloadImage(mount, {format:'png', filename: visual.id, height:720, width:1280}); },
        toggleZoom(){
          // toggle dragmode between 'zoom' and 'lasso'
          const currentMode = mount.layout?.dragmode || 'zoom';
          const next = currentMode === 'zoom' ? 'lasso' : 'zoom';
          Plotly.relayout(mount, { dragmode: next });
        }
      };
    }
  }
};

// ---------- gallery ----------
function cardHTML(v){
  return `
    <div class="col-12">
      <div class="card h-100">
        <div class="card-body d-flex justify-content-between align-items-center">
          <div>
            <div class="fw-bold">${v.title}</div>
            <div class="small text-muted">${v.lib} • ${v.tags?.join(' • ') ?? 'visual'}</div>
          </div>
          <button class="btn btn-sm btn-outline-light" data-open="${v.id}">
            <i class="bi bi-arrows-fullscreen me-1"></i>Open
          </button>
        </div>
      </div>
    </div>`;
}
grid.innerHTML = VISUALS.map(cardHTML).join('');

// ---------- full view open ----------
async function openFullView(visualId){
  const v = VISUALS.find(x => x.id === visualId);
  if(!v) return;
  fvTitle.textContent = v.title;

  // dispose previous
  if(current.api){ try{ current.api.destroy(); }catch{} current.api=null; }
  const mount = clearContainer(fvContainer);

  // lazy-load renderer if needed, render, bind toolbar
  const r = renderers[v.lib];
  await r.ensure();
  current.api = await r.render(mount, v);
  current.visual = v;

  modal.show();
}

// gallery clicks
grid.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-open]');
  if(btn){ openFullView(btn.getAttribute('data-open')); }
});

// toolbar
btnDL.addEventListener('click', () => current.api?.downloadPNG());
btnZoom.addEventListener('click', () => current.api?.toggleZoom());
btnFS.addEventListener('click', () => {
  const root = document.querySelector('#fullViewModal .modal-content');
  if(document.fullscreenElement){ document.exitFullscreen(); } else { root.requestFullscreen?.(); }
});
btnSave.addEventListener('click', () => {
  if(!current.visual) return;
  const key = 'dais_saved_visuals';
  const saved = new Set(JSON.parse(localStorage.getItem(key) || '[]'));
  saved.has(current.visual.id) ? saved.delete(current.visual.id) : saved.add(current.visual.id);
  localStorage.setItem(key, JSON.stringify([...saved]));
  btnSave.classList.toggle('btn-outline-light');
  btnSave.classList.toggle('btn-warning');
});

// dispose on close
modalEl.addEventListener('hidden.bs.modal', () => {
  if(current.api){ try{ current.api.destroy(); }catch{} current.api=null; }
});

// optional deep link ?visual=...
const params = new URLSearchParams(location.search);
if(params.get('visual')) openFullView(params.get('visual'));

// tiny mock chat
document.getElementById('sendBtn')?.addEventListener('click', () => {
  const inp = document.getElementById('chatInput');
  const v = (inp.value || '').trim();
  if(!v) return;
  const feed = document.getElementById('chatFeed');
  feed.insertAdjacentHTML('beforeend', `<div><strong>You:</strong> ${v}</div>`);
  inp.value = '';
  setTimeout(()=> feed.insertAdjacentHTML('beforeend', `<div class="text-muted small">AI: (dummy) Generated insight & optional visual.</div>`), 600);
  feed.scrollTop = feed.scrollHeight;
});
