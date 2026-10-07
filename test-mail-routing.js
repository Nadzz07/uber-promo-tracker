import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openPrivateDb, setAccountAccess } from "./private-db.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uber-mail-routing-"));
const input = path.join(dir, "emails.json");
const output = path.join(dir, "moves.json");
const trashOutput = path.join(dir, "trash.json");
const dbPath = path.join(dir, "routing.db");

const messages = [
  {
    sender: "Uber Eats <receipts@uber.com>",
    recipient: "account-a@icloud.com",
    subject: "Your receipt from Example Kitchen",
    body: [
      "Thanks for your order",
      "Subtotal £25.00",
      "Promotion -£10.00",
      "Total £15.00"
    ].join("\n"),
    sentAt: "2026-10-05T18:00:00Z",
    receivedAt: "2026-10-05T18:00:10Z",
    messageId: "<receipt-inbox@uber.com>",
    mailbox: "promo",
    sourceMailbox: "INBOX"
  },
  {
    sender: "Uber Eats <offers@uber.com>",
    recipient: "account-a@icloud.com",
    subject: "40% off your next order",
    body: "Get 40% off your next order, up to £12. Minimum spend £20.",
    sentAt: "2026-10-05T17:00:00Z",
    receivedAt: "2026-10-05T17:00:10Z",
    messageId: "<promo-inbox@uber.com>",
    mailbox: "promo",
    sourceMailbox: "INBOX"
  },
  {
    sender: "Uber Eats <receipts@uber.com>",
    recipient: "account-c@icloud.com",
    subject: "Your receipt from Archived Kitchen",
    body: "Subtotal £20.00\nPromotion -£5.00\nTotal £15.00",
    sentAt: "2026-10-05T16:00:00Z",
    receivedAt: "2026-10-05T16:00:10Z",
    messageId: "<archived-receipt@uber.com>",
    mailbox: "promo",
    sourceMailbox: "INBOX"
  },
  {
    sender: "Uber Eats <offers@uber.com>",
    recipient: "account-c@icloud.com",
    subject: "£10 off your next order",
    body: "Get £10 off your next order. Minimum spend £15.",
    sentAt: "2026-10-05T15:00:00Z",
    receivedAt: "2026-10-05T15:00:10Z",
    messageId: "<archived-promo@uber.com>",
    mailbox: "promo",
    sourceMailbox: "INBOX"
  },
  {
    sender: "Uber Eats <receipts@uber.com>",
    recipient: "account-b@icloud.com",
    subject: "Your receipt from Another Kitchen",
    body: "Subtotal £20.00\nTotal £20.00",
    sentAt: "2026-10-04T18:00:00Z",
    receivedAt: "2026-10-04T18:00:10Z",
    messageId: "<receipt-already-filed@uber.com>",
    mailbox: "receipt",
    sourceMailbox: "Uber Receipts"
  }
];

fs.writeFileSync(input, JSON.stringify({ messages }, null, 2));

const db = openPrivateDb(dbPath);
try {
  setAccountAccess(db, "account-a@icloud.com", true, "iCloud");
  setAccountAccess(db, "account-c@icloud.com", false, "iCloud");
} finally {
  db.close();
}

try {
  execFileSync(process.execPath, [
    "mac/find-inbox-receipts.js",
    input,
    output
  ], {
    cwd: process.cwd(),
    stdio: "pipe"
  });

  const result = JSON.parse(fs.readFileSync(output, "utf8"));

  assert.equal(result.count, 2);
  assert.deepEqual(result.messageIds, ["<receipt-inbox@uber.com>", "<archived-receipt@uber.com>"]);

  execFileSync(process.execPath, [
    "mac/plan-inbox-routing.js",
    input,
    dbPath,
    output,
    trashOutput
  ], {
    cwd: process.cwd(),
    stdio: "pipe"
  });

  const routedReceipts = JSON.parse(fs.readFileSync(output, "utf8"));
  const routedTrash = JSON.parse(fs.readFileSync(trashOutput, "utf8"));
  assert.deepEqual(routedReceipts.messageIds, ["<receipt-inbox@uber.com>"]);
  assert.deepEqual(routedTrash.messageIds, ["<archived-receipt@uber.com>", "<archived-promo@uber.com>"]);

  const exporterSource = fs.readFileSync("mac/export-uber-mail.js", "utf8");
  const moverSource = fs.readFileSync("mac/move-inbox-receipts.js", "utf8");
  const trashSource = fs.readFileSync("mac/trash-archived-inbox.js", "utf8");
  const commonSource = fs.readFileSync("mac/common.sh", "utf8");
  const exampleEnv = fs.readFileSync("tracker.example.env", "utf8");

  assert.equal(
    exporterSource.includes(".whose("),
    false,
    "exporter must not reintroduce Mail whose queries on large mailboxes"
  );
  assert.equal(
    moverSource.includes(".whose("),
    false,
    "receipt mover must not reintroduce Mail whose queries on Inbox"
  );
  assert.equal(
    exporterSource.includes("box.messages.dateReceived()"),
    true,
    "exporter should bulk-fetch date metadata before opening message bodies"
  );

  assert.equal(
    commonSource.includes('MOVE_INBOX_RECEIPTS="${APPLE_MAIL_MOVE_INBOX_RECEIPTS:-true}"'),
    true,
    "routine sync should safely file processed Inbox receipts by default"
  );
  assert.equal(
    commonSource.includes('TRASH_ARCHIVED_MAIL="${APPLE_MAIL_TRASH_ARCHIVED:-true}"'),
    true,
    "routine sync should route archived-account Uber mail to Bin by default"
  );
  assert.equal(
    exampleEnv.includes("APPLE_MAIL_MOVE_INBOX_RECEIPTS=true"),
    true,
    "example configuration should match the runtime receipt-filing default"
  );
  assert.equal(
    trashSource.includes("Mail.delete(message)"),
    true,
    "archived mail should use Mail's recoverable delete-to-Bin action"
  );
  assert.equal(
    /Mail\.erase|expunge|Erase Deleted Items/i.test(trashSource),
    false,
    "archived routing must never permanently erase Bin contents"
  );

  console.log("✓ Inbox routing separates available receipts from archived-account mail");
  console.log("✓ Archived-account receipts are planned for Bin only after private import");
  console.log("✓ Mail exporter and routing avoid timeout-prone whose queries");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
