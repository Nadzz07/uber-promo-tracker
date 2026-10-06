#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_PRIVATE_DB,
  deleteAccountsPermanently,
  openPrivateDb
} from "../private-db.js";

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  let dbPath = process.env.TRACKER_PRIVATE_DB || DEFAULT_PRIVATE_DB;
  let listPath = null;
  let eraseList = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--db") {
      dbPath = argv[++i];
      if (!dbPath || dbPath.startsWith("--")) fail("--db requires a path.");
    } else if (arg === "--erase-list") {
      eraseList = true;
    } else if (arg.startsWith("--") || listPath) {
      fail("Unexpected purge argument.");
    } else {
      listPath = arg;
    }
  }

  return {
    dbPath,
    listPath: listPath || "remove-accounts.local.txt",
    eraseList
  };
}

function loadAliases(listPath) {
  const text = fs.readFileSync(listPath, "utf8").replace(/^\uFEFF/, "");
  const aliases = [];
  const seen = new Set();

  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const value = raw.trim().toLowerCase();
    if (!value || value.startsWith("#")) continue;
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(value)) {
      fail("Invalid email on list line " + (index + 1) + ".");
    }
    if (!seen.has(value)) {
      seen.add(value);
      aliases.push(value);
    }
  }

  if (!aliases.length) fail("Removal list contains no accounts.");
  return aliases;
}

try {
  const { dbPath, listPath, eraseList } = parseArgs(process.argv.slice(2));
  const aliases = loadAliases(listPath);
  const db = openPrivateDb(dbPath);

  let totals;
  try {
    db.exec("BEGIN IMMEDIATE");
    totals = deleteAccountsPermanently(db, aliases);
    db.exec("COMMIT");

    // Make deleted private rows non-recoverable through ordinary SQLite pages/WAL.
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    db.exec("VACUUM");
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  } finally {
    db.close();
  }

  if (eraseList) fs.rmSync(listPath, { force: true });

  console.log("Permanent private account cleanup complete.");
  console.log("Requested accounts: " + totals.requested);
  console.log("Accounts deleted: " + totals.accounts);
  console.log("Messages deleted: " + totals.messages);
  console.log("Offers deleted: " + totals.offers);
  console.log("Eats receipts deleted: " + totals.receipts);
  console.log("Ride receipts deleted: " + totals.transportReceipts);
  console.log("Receipt matches deleted: " + totals.receiptMatches);
  console.log("SQLite WAL truncated and database vacuumed.");
  if (eraseList) console.log("Private removal list erased.");
  else console.log("Removal list retained at: " + path.resolve(listPath));
} catch (error) {
  console.error("Private account cleanup failed: " + error.message);
  process.exitCode = 1;
}
