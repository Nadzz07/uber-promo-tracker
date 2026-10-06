#!/usr/bin/env node
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import {
  dedupeMboxMessages,
  looksLikeUberMail,
  parseMboxStream
} from "../mbox-import.js";

function usage() {
  console.error("Usage: node mac/import-mbox.js <archive.mbox|archive.zip> [emails.local.json]");
  process.exit(2);
}

function zipEntries(inputPath) {
  const result = spawnSync("unzip", ["-Z1", inputPath], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error("Could not inspect ZIP archive with unzip.");
  }
  return String(result.stdout || "")
    .split(/\r?\n/)
    .map(value => value.trim())
    .filter(Boolean);
}

function chooseMboxEntry(entries) {
  const candidates = entries.filter(entry =>
    !entry.startsWith("__MACOSX/") &&
    (/(^|\/)mbox$/i.test(entry) || /\.mbox$/i.test(entry))
  );
  if (candidates.length === 1) return candidates[0];
  if (!candidates.length) {
    throw new Error("ZIP does not contain an Apple Mail mbox payload.");
  }
  const exact = candidates.find(entry => /(^|\/)mbox$/i.test(entry));
  if (exact) return exact;
  throw new Error("ZIP contains multiple MBOX candidates; extract the wanted mailbox first.");
}

function openInput(inputPath) {
  if (/\.zip$/i.test(inputPath)) {
    const entry = chooseMboxEntry(zipEntries(inputPath));
    const child = spawn("unzip", ["-p", inputPath, entry], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => { stderr += chunk; });
    const completed = new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", code => {
        if (code === 0) resolve();
        else reject(new Error("Could not extract MBOX from ZIP" + (stderr ? ": " + stderr.trim() : ".")));
      });
    });
    return { stream: child.stdout, completed, sourceMailbox: entry };
  }

  return {
    stream: fs.createReadStream(inputPath),
    completed: Promise.resolve(),
    sourceMailbox: path.basename(inputPath)
  };
}

async function writeAtomic(outputPath, payload) {
  const resolved = path.resolve(outputPath);
  const temporary = resolved + ".tmp-" + process.pid;
  await fsp.writeFile(temporary, JSON.stringify(payload, null, 2) + "\n", { mode: 0o600 });
  await fsp.chmod(temporary, 0o600);
  await fsp.rename(temporary, resolved);
  await fsp.chmod(resolved, 0o600);
}

async function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3] || "emails.local.json";
  if (!inputPath) usage();

  const input = openInput(inputPath);
  const parsed = await parseMboxStream(input.stream, {
    mailbox: "receipt",
    sourceMailbox: input.sourceMailbox
  });
  await input.completed;

  const uberMessages = dedupeMboxMessages(parsed.filter(looksLikeUberMail));
  const forwarded = uberMessages.filter(message => message.forwardedByUser).length;

  await writeAtomic(outputPath, {
    exportedAt: new Date().toISOString(),
    source: "private-mbox-import",
    messages: uberMessages
  });

  console.log("MBOX messages read: " + parsed.length);
  console.log("Uber messages exported: " + uberMessages.length);
  console.log("Forwarded Uber copies normalised: " + forwarded);
  console.log("Private JSON written: " + path.resolve(outputPath));
}

main().catch(error => {
  console.error("Could not import MBOX:");
  console.error(error.message);
  process.exit(1);
});
