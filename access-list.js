// Validate the entire local CSV/text file before resetting any access state.
function csvRows(text) {
  const rows = []; let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else if (quoted || field === "") quoted = !quoted;
      else throw new Error("Invalid CSV quoting.");
    } else if (c === "," && !quoted) { row.push(field); field = ""; }
    else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (quoted) throw new Error("Unclosed CSV quote.");
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()) && !r[0].trim().startsWith("#"));
}

export function parseAccessList(text) {
  const rows = csvRows(String(text).replace(/^\uFEFF/, ""));
  if (!rows.length) throw new Error("Access list is empty; no accounts were changed.");
  const header = rows[0].map(c => c.trim().toLowerCase());
  const hasHeader = header.includes("email");
  const emailIndex = hasHeader ? header.indexOf("email") : 0;
  const statusIndex = hasHeader
    ? header.findIndex(c => c === "can_login" || c === "login status")
    : rows[0].length > 1 ? 1 : -1;
  if (hasHeader && statusIndex < 0) throw new Error("CSV needs a can_login or Login status column.");
  const records = new Map();
  for (const [index, row] of rows.slice(hasHeader ? 1 : 0).entries()) {
    const email = String(row[emailIndex] || "").trim().toLowerCase();
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) {
      throw new Error("Invalid account email on data row " + (index + 1) + ".");
    }
    let canLogin = true;
    if (statusIndex >= 0) {
      const state = String(row[statusIndex] ?? "").trim().toLowerCase().replace(/[’‘]/g, "'");
      if (/^(true|1|yes|y|can\s*log\s*in|usable)$/.test(state)) canLogin = true;
      else if (/^(false|0|no|n|can't\s*log\s*in|cannot\s*log\s*in|unusable)$/.test(state)) canLogin = false;
      else throw new Error("Unknown login status on data row " + (index + 1) + ".");
    }
    if (records.has(email) && records.get(email) !== canLogin) {
      throw new Error("Conflicting login states on data row " + (index + 1) + ".");
    }
    records.set(email, canLogin);
  }
  if (!records.size) throw new Error("Access list contains no accounts; no accounts were changed.");
  return [...records].map(([email, canLogin]) => ({ email, canLogin }));
}
