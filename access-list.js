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

export function normaliseLoginMethod(value) {
  const method = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ");

  if (!method) return null;
  if (/^(icloud|apple|apple id|hide my email)$/.test(method)) return "iCloud";
  if (/^(google|gmail|google account)$/.test(method)) return "Google";
  if (/^(both|icloud\s*\+\s*google|google\s*\+\s*icloud|icloud\s*&\s*google|google\s*&\s*icloud)$/.test(method)) {
    return "Both";
  }
  throw new Error("Unknown login method.");
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
  const methodIndex = hasHeader
    ? (() => {
        const direct = header.findIndex(c => c === "login method" || c === "login_method");
        if (direct >= 0) return direct;
        // Backwards compatibility: the old private spreadsheet used Provider
        // for the iCloud / Google / iCloud + Google login route.
        return header.indexOf("provider");
      })()
    : -1;

  if (hasHeader && statusIndex < 0) {
    throw new Error("CSV needs a can_login or Login status column.");
  }

  const records = new Map();

  for (const [index, row] of rows.slice(hasHeader ? 1 : 0).entries()) {
    const email = String(row[emailIndex] || "").trim().toLowerCase();
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) {
      throw new Error("Invalid account email on data row " + (index + 1) + ".");
    }

    let canLogin = true;
    if (statusIndex >= 0) {
      const state = String(row[statusIndex] ?? "")
        .trim()
        .toLowerCase()
        .replace(/[’‘]/g, "'");
      if (/^(true|1|yes|y|can\s*log\s*in|usable)$/.test(state)) canLogin = true;
      else if (/^(false|0|no|n|can't\s*log\s*in|cannot\s*log\s*in|unusable)$/.test(state)) canLogin = false;
      else throw new Error("Unknown login status on data row " + (index + 1) + ".");
    }

    let loginMethod = null;
    if (methodIndex >= 0 && String(row[methodIndex] ?? "").trim()) {
      try {
        loginMethod = normaliseLoginMethod(row[methodIndex]);
      } catch {
        throw new Error("Unknown login method on data row " + (index + 1) + ".");
      }
    }

    const previous = records.get(email);
    if (previous && previous.canLogin !== canLogin) {
      throw new Error("Conflicting login states on data row " + (index + 1) + ".");
    }
    if (previous?.loginMethod && loginMethod && previous.loginMethod !== loginMethod) {
      throw new Error("Conflicting login methods on data row " + (index + 1) + ".");
    }

    records.set(email, {
      canLogin,
      loginMethod: loginMethod || previous?.loginMethod || null
    });
  }

  if (!records.size) throw new Error("Access list contains no accounts; no accounts were changed.");

  return [...records].map(([email, value]) => ({
    email,
    canLogin: value.canLogin,
    loginMethod: value.loginMethod
  }));
}
