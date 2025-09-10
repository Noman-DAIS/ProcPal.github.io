// js/csv-loader.js
export async function loadCSVasJSON(url, { autoType = true } = {}) {
  const res = await fetch(url);
  const textRaw = await res.text();
  const text = textRaw.replace(/^\uFEFF/, ""); // strip BOM if present

  const rows = parseCSV(text);
  if (rows.length === 0) return [];

  const headers = rows[0];
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

// Parses CSV into array-of-arrays. Handles quotes, commas, CRLF.
function parseCSV(str) {
  const out = [];
  let row = [];
  let field = "";
  let i = 0, inQuotes = false;

  while (i < str.length) {
    const c = str[i];

    if (inQuotes) {
      if (c === '"') {
        const next = str[i + 1];
        if (next === '"') { field += '"'; i += 2; continue; } // escaped quote
        inQuotes = false; i++; continue;
      } else {
        field += c; i++; continue;
      }
    } else {
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === ",") { row.push(field); field = ""; i++; continue; }
      if (c === "\n") { row.push(field); out.push(row); row = []; field = ""; i++; continue; }
      if (c === "\r") { // handle CRLF or solo CR
        const next = str[i + 1];
        if (next === "\n") i++;
        row.push(field); out.push(row); row = []; field = ""; i++; continue;
      }
      field += c; i++; continue;
    }
  }
  // flush last field/row
  row.push(field);
  out.push(row);
  // trim trailing empty row if any
  if (out.length && out[out.length - 1].length === 1 && out[out.length - 1][0] === "") out.pop();
  return out;
}

function autoTypeValue(v) {
  const s = String(v).trim();
  if (s === "" || s.toLowerCase() === "null" || s === "NA") return null;
  if (/^(true|false)$/i.test(s)) return /^true$/i.test(s);
  if (/^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(s)) return Number(s);
  return s;
}
