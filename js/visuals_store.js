// js/visuals_store.js
const DB_NAME = "dais-procpal";
const DB_VERSION = 1;
const STORE = "visuals";
const bc = "BroadcastChannel" in self ? new BroadcastChannel("dais-visuals") : null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id" });
        os.createIndex("createdAt", "createdAt");
        os.createIndex("updatedAt", "updatedAt");
        os.createIndex("pinned", "flags.pinned");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(storeMode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, storeMode);
    const s = t.objectStore(STORE);
    const done = () => resolve();
    t.oncomplete = done;
    t.onabort = () => reject(t.error);
    fn(s, resolve, reject);
  });
}

export const visualsStore = {
  async put(v) {
    const now = Date.now();
    const id = v.id || (crypto?.randomUUID?.() ?? String(now));
    const record = {
      id,
      createdAt: v.createdAt || now,
      updatedAt: now,
      spec: v.spec ?? null,
      meta: v.meta ?? {},
      dataRef: v.dataRef ?? {},
      assets: v.assets ?? {}, // {thumb: Blob, png: Blob}
      flags: v.flags ?? { pinned: false }
    };
    await tx("readwrite", (s) => { s.put(record); });
    bc?.postMessage({ type: "changed", id });
    window.dispatchEvent(new CustomEvent("visuals:changed", { detail: { id } }));
    return id;
  },

  async get(id) {
    return new Promise(async (resolve, reject) => {
      const db = await openDB();
      const t = db.transaction(STORE, "readonly");
      const s = t.objectStore(STORE);
      const r = s.get(id);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
  },

  async list({ limit = 50, order = "desc" } = {}) {
    const res = [];
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, "readonly");
      const s = t.objectStore(STORE).index("createdAt");
      const dir = order === "desc" ? "prev" : "next";
      const req = s.openCursor(null, dir);
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur || res.length >= limit) return resolve(res);
        res.push(cur.value);
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
  },

  async remove(id) {
    await tx("readwrite", (s) => { s.delete(id); });
    bc?.postMessage({ type: "changed", id });
    window.dispatchEvent(new CustomEvent("visuals:changed", { detail: { id } }));
  },

  watch(handler) {
    const h = () => handler();
    window.addEventListener("visuals:changed", h);
    bc?.addEventListener?.("message", h);
    return () => {
      window.removeEventListener("visuals:changed", h);
      bc?.removeEventListener?.("message", h);
    };
  },

  async estimate() {
    if (!navigator.storage?.estimate) return null;
    return navigator.storage.estimate();
  },
  async requestPersist() {
    if (!navigator.storage?.persist) return false;
    return navigator.storage.persist();
  }
};
