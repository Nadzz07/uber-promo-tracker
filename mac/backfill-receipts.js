#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const exporter = path.join(here, "export-uber-mail.js");
const generator = path.join(root, "generate-promos.js");

function positiveNumber(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(name + " must be a positive number.");
  }
  return parsed;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    ...options
  });

  if (result.stderr) process.stderr.write(result.stderr);

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(command + " exited with status " + result.status);
  }

  return result.stdout || "";
}

const receiptFolder =
  process.env.APPLE_MAIL_RECEIPT_FOLDER || "Uber Receipts";

const historyDays = positiveNumber(
  process.env.APPLE_MAIL_RECEIPT_HISTORY_DAYS ||
    process.env.APPLE_MAIL_RECEIPT_DAYS,
  3650,
  "APPLE_MAIL_RECEIPT_HISTORY_DAYS"
);

const recentDays = positiveNumber(
  process.env.APPLE_MAIL_RECEIPT_SYNC_DAYS,
  120,
  "APPLE_MAIL_RECEIPT_SYNC_DAYS"
);

const chunkDays = positiveNumber(
  process.env.APPLE_MAIL_RECEIPT_BACKFILL_CHUNK_DAYS,
  120,
  "APPLE_MAIL_RECEIPT_BACKFILL_CHUNK_DAYS"
);

const privateDb =
  process.env.TRACKER_PRIVATE_DB || "uber-tracker.local.db";

const dayMs = 24 * 60 * 60 * 1000;
const now = new Date();
const newestHistorical = new Date(now.getTime() - recentDays * dayMs);
const oldestHistorical = new Date(now.getTime() - historyDays * dayMs);

if (oldestHistorical >= newestHistorical) {
  console.log("No historical receipt window remains after the recent-sync range.");
  process.exit(0);
}

const totalChunks = Math.ceil(
  (newestHistorical.getTime() - oldestHistorical.getTime()) /
  (chunkDays * dayMs)
);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "uber-receipt-backfill-"));
const input = path.join(tempDir, "receipts.json");
const tempPromos = path.join(tempDir, "promos.json");
const tempHistory = path.join(tempDir, "history.json");

console.log("Uber Eats receipt history backfill");
console.log("Mailbox: " + receiptFolder);
console.log("History: " + Math.round(historyDays) + " days");
console.log("Recent range already handled by normal sync: " + Math.round(recentDays) + " days");
console.log("Chunk size: " + Math.round(chunkDays) + " days");
console.log("");

let cursorEnd = newestHistorical;
let chunk = 0;
let importedMessages = 0;

try {
  while (cursorEnd > oldestHistorical) {
    const candidateStart = new Date(
      cursorEnd.getTime() - chunkDays * dayMs
    );
    const cursorStart =
      candidateStart < oldestHistorical ? oldestHistorical : candidateStart;

    chunk += 1;

    const stdout = run("osascript", [
      "-l",
      "JavaScript",
      exporter,
      "1",
      "",
      "1",
      receiptFolder,
      "receipt-only",
      cursorStart.toISOString(),
      cursorEnd.toISOString()
    ]);

    fs.writeFileSync(input, stdout);

    let count = 0;
    try {
      const payload = JSON.parse(stdout);
      count = Array.isArray(payload.messages) ? payload.messages.length : 0;
    } catch (error) {
      throw new Error(
        "Receipt export returned invalid JSON for " +
        cursorStart.toISOString() +
        " → " +
        cursorEnd.toISOString()
      );
    }

    console.log(
      "[" + chunk + "/" + totalChunks + "] " +
      cursorStart.toISOString().slice(0, 10) +
      " → " +
      cursorEnd.toISOString().slice(0, 10) +
      ": " +
      count +
      " Uber message(s)"
    );

    if (count > 0) {
      run(process.execPath, [
        generator,
        input,
        tempPromos,
        tempHistory,
        privateDb
      ], { stdio: ["ignore", "ignore", "pipe"] });
      importedMessages += count;
    }

    cursorEnd = cursorStart;
  }

  console.log("");
  console.log("Historical backfill complete.");
  console.log("Messages processed: " + importedMessages);
  console.log("Private DB: " + privateDb);
  console.log("Run bash mac/update-promos.sh once to publish refreshed totals.");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
