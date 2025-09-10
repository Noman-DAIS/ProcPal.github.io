// Fetch CSV and return parsed JSON
export async function loadCSVasJSON(url) {
  // Step 1: Fetch the raw CSV text
  const response = await fetch(url);
  const text = await response.text();

  // Step 2: Parse the CSV
  const [headerLine, ...lines] = text.trim().split("\n");
  const headers = headerLine.split(",").map(h => h.trim());

  const data = lines.map(line => {
    const values = line.split(",").map(v => v.trim());
    return Object.fromEntries(headers.map((h, i) => [h, values[i]]));
  });

  return data;
}
