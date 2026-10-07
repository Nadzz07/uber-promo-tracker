import fs from "node:fs";
import { parseUberPromo } from "../parser.js";
import { parseUberEatsReceipt } from "../receipt-parser.js";
import { parseUberTransportReceipt } from "../transport-receipt-parser.js";
import { getAccounts, openPrivateDb } from "../private-db.js";

const [inputPath = "emails.local.json", dbPath = "uber-tracker.local.db", receiptOutput = "receipt-moves.local.json", trashOutput = "archived-trash.local.json"] = process.argv.slice(2);

const raw = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const messages = Array.isArray(raw) ? raw : raw.messages;
if (!Array.isArray(messages)) throw new Error("Mail export must contain a message array.");

const db = openPrivateDb(dbPath);
let accounts;
try { accounts = getAccounts(db); } finally { db.close(); }
const access = new Map(accounts.map(account => [String(account.alias).trim().toLowerCase(), account]));

const receiptIds = [];
const trashIds = [];
const seenReceipt = new Set();
const seenTrash = new Set();
let archivedWithoutMessageId = 0;

function pushUnique(list, seen, value) {
  const key = String(value || "").trim().toLowerCase();
  if (!key || seen.has(key)) return;
  seen.add(key);
  list.push(value);
}

for (const email of messages) {
  if (String(email.sourceMailbox || "").toUpperCase() !== "INBOX") continue;

  const eats = parseUberEatsReceipt(email);
  const transport = eats.isReceipt ? null : parseUberTransportReceipt(email);
  const isReceipt = eats.isReceipt || Boolean(transport?.isReceipt);
  const promo = isReceipt ? null : parseUberPromo(email);
  const alias = String(
    eats.isReceipt ? eats.accountAlias :
    transport?.isReceipt ? transport.accountAlias :
    promo?.accountAlias || email.recipient || ""
  ).trim().toLowerCase();

  const account = access.get(alias);
  if (account && !account.canLogin) {
    if (email.messageId) pushUnique(trashIds, seenTrash, email.messageId);
    else archivedWithoutMessageId++;
    continue;
  }

  if (isReceipt && email.messageId) {
    pushUnique(receiptIds, seenReceipt, email.messageId);
  }
}

const generatedAt = new Date().toISOString();
fs.writeFileSync(receiptOutput, JSON.stringify({
  generatedAt,
  sourceMailbox: "INBOX",
  action: "file_receipt",
  count: receiptIds.length,
  messageIds: receiptIds
}, null, 2) + "\n");

fs.writeFileSync(trashOutput, JSON.stringify({
  generatedAt,
  sourceMailbox: "INBOX",
  action: "trash_archived",
  count: trashIds.length,
  messageIds: trashIds
}, null, 2) + "\n");

console.log("Available-account Inbox receipts ready to file: " + receiptIds.length);
console.log("Archived-account Inbox messages ready for Bin: " + trashIds.length);
if (archivedWithoutMessageId) {
  console.warn("Archived Inbox messages left in place because Message-ID was unavailable: " + archivedWithoutMessageId);
}
