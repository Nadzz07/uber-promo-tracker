#!/usr/bin/env node
import fs from "node:fs";
import {
  getAccounts,
  openPrivateDb,
  resetAccountAccess,
  setAccountAccess
} from "../private-db.js";

const args = process.argv.slice(2);
const reset = args.includes("--reset");
const filePath = args.find(arg => !arg.startsWith("--")) || "account-access.local.csv";
const dbArgIndex = args.indexOf("--db");
const dbPath = dbArgIndex >= 0 ? args[dbArgIndex + 1] : "./uber-tracker.local.db";

if (!fs.existsSync(filePath)) {
  console.error("Access file not found: " + filePath);
  process.exit(1);
}

const db = openPrivateDb(dbPath);

try {
  if (reset) resetAccountAccess(db);

  const text = fs.readFileSync(filePath, "utf8");
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith("#"));

  let changed = 0;

  for (const line of lines) {
    if (/^email\s*,/i.test(line)) continue;

    const parts = line.split(",").map(part => part.trim());
    const email = parts[0];

    if (!/@/.test(email)) continue;

    let canLogin = true;

    if (parts.length > 1) {
      canLogin = /^(?:1|true|yes|y|can\s*login|usable)$/i.test(parts[1]);
    }

    if (setAccountAccess(db, email, canLogin)) changed++;
  }

  const accounts = getAccounts(db);
  const usable = accounts.filter(account => account.canLogin).length;

  console.log("Updated " + changed + " account access rows.");
  console.log("Known accounts: " + accounts.length);
  console.log("Can log in: " + usable);
  console.log("Can't log in: " + (accounts.length - usable));
} finally {
  db.close();
}
