#!/usr/bin/env node
import fs from "node:fs";
import { parseAccessList } from "../access-list.js";
import { getAccounts, openPrivateDb, resetAccountAccess, setAccountAccess } from "../private-db.js";

try {
  const args = process.argv.slice(2);
  let reset = false, dbPath = process.env.TRACKER_PRIVATE_DB || "./uber-tracker.local.db", filePath;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--reset") reset = true;
    else if (args[i] === "--db") {
      dbPath = args[++i];
      if (!dbPath || dbPath.startsWith("--")) throw new Error("--db requires a path.");
    } else if (args[i].startsWith("--") || filePath) throw new Error("Unexpected import argument.");
    else filePath = args[i];
  }
  const records = parseAccessList(fs.readFileSync(filePath || "account-access.local.csv", "utf8"));
  const db = openPrivateDb(dbPath);
  try {
    db.exec("BEGIN IMMEDIATE");
    if (reset) resetAccountAccess(db);
    for (const row of records) setAccountAccess(db, row.email, row.canLogin, row.loginMethod);
    db.exec("COMMIT");
    const accounts = getAccounts(db);
    const usable = accounts.filter(a => a.canLogin).length;
    console.log("Updated " + records.length + " account access rows.");
    console.log("Known accounts: " + accounts.length);
    console.log("Can log in: " + usable);
    console.log("Can't log in: " + (accounts.length - usable));
    const methods = new Map();
    for (const account of accounts) {
      const method = account.loginMethod || "Unknown";
      methods.set(method, (methods.get(method) || 0) + 1);
    }
    console.log(
      "Login methods: " +
      [...methods].map(([method, count]) => method + "=" + count).join(", ")
    );
  } catch (error) {
    db.exec("ROLLBACK"); throw error;
  } finally { db.close(); }
} catch (error) {
  console.error("Access import failed: " + error.message);
  process.exitCode = 1;
}
