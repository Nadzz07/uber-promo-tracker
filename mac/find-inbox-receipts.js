import fs from "node:fs";
import { parseUberEatsReceipt } from "../receipt-parser.js";

const inputPath = process.argv[2] || "emails.local.json";
const outputPath = process.argv[3] || "receipt-moves.local.json";

const raw = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const messages = Array.isArray(raw) ? raw : raw.messages;

if (!Array.isArray(messages)) {
  throw new Error("Mail export must contain a message array.");
}

const messageIds = [];
const seen = new Set();

for (const email of messages) {
  if (String(email.sourceMailbox || "").toUpperCase() !== "INBOX") continue;

  const receipt = parseUberEatsReceipt(email);
  if (!receipt.isReceipt || !email.messageId) continue;

  const key = String(email.messageId).trim().toLowerCase();
  if (!key || seen.has(key)) continue;

  seen.add(key);
  messageIds.push(email.messageId);
}

fs.writeFileSync(
  outputPath,
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    sourceMailbox: "INBOX",
    count: messageIds.length,
    messageIds
  }, null, 2) + "\n"
);

console.log("Inbox receipts ready to move: " + messageIds.length);
