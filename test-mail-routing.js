import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uber-mail-routing-"));
const input = path.join(dir, "emails.json");
const output = path.join(dir, "moves.json");

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

  assert.equal(result.count, 1);
  assert.deepEqual(result.messageIds, ["<receipt-inbox@uber.com>"]);

  const exporterSource = fs.readFileSync("mac/export-uber-mail.js", "utf8");
  const moverSource = fs.readFileSync("mac/move-inbox-receipts.js", "utf8");
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
    commonSource.includes('APPLE_MAIL_MOVE_INBOX_RECEIPTS:-true'),
    true,
    "routine sync should safely file processed Inbox receipts by default"
  );
  assert.equal(
    exampleEnv.includes("APPLE_MAIL_MOVE_INBOX_RECEIPTS=true"),
    true,
    "example configuration should match the runtime receipt-filing default"
  );

  console.log("✓ Inbox receipt routing only selects parsed receipts");
  console.log("✓ Mail exporter and receipt mover avoid timeout-prone whose queries");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
