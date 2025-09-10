// js/csv_parser.js
export async function loadCSVasJSON(url, { autoType = true } = {}) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CSV fetch failed: ${res.status} ${res.statusText}`);
  const textRaw = await res.text();
  const text = textRaw.replace(/^\uFEFF/, ""); // strip BOM

  const rows = parseCSV(text);
  if (!rows.length) return [];

  const headers = rows[0].map(h => String(h).trim());
  const dataRows = rows.slice(1);

  return dataRows.map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      const raw = row[i] ?? "";
      obj[h] = autoType ? autoTypeValue(raw) : raw;
    });
    return obj;
  });
}

// --- helpers ---
function parseCSV(str) {
  const out = [];
  let row = [], field = "", i = 0, q = false;

  while (i < str.length) {
    const c = str[i];
    if (q) {
      if (c === '"') {
        if (str[i + 1] === '"') { field += '"'; i += 2; continue; }
        q = false; i++; continue;
      }
      field += c; i++; continue;
    } else {
      if (c === '"') { q = true; i++; continue; }
      if (c === ",") { row.push(field); field = ""; i++; continue; }
      if (c === "\n") { row.push(field); out.push(row); row = []; field = ""; i++; continue; }
      if (c === "\r") { if (str[i + 1] === "\n") i++; row.push(field); out.push(row); row = []; field = ""; i++; continue; }
      field += c; i++; continue;
    }
  }
  row.push(field); out.push(row);
  if (out.length && out[out.length - 1].every(v => v === "")) out.pop();
  return out;
}

function autoTypeValue(v) {
  const s = String(v).trim();
  if (s === "" || /^null$/i.test(s) || s === "NA") return null;
  if (/^(true|false)$/i.test(s)) return /^true$/i.test(s);
  if (/^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(s)) return Number(s);
  return s;
}
