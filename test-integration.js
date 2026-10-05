import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  getAccounts,
  openPrivateDb,
  setAccountAccess
} from "./private-db.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uber-tracker-integration-"));
const input = path.join(dir, "emails.json");
const output = path.join(dir, "promos.json");
const history = path.join(dir, "history.json");
const dbPath = path.join(dir, "tracker.db");

const messages = [
  {
    sender: "Uber Eats <offers@uber.com>",
    recipient: "account-a@icloud.com",
    subject: "£15 off your next order",
    body: "Get £15 off your next order. £15 minimum spend. Promo code PRIVATE15. Expires 20 Oct 2099.",
    sentAt: "2026-10-05T10:00:00Z",
    receivedAt: "2026-10-05T10:00:10Z",
    messageId: "<promo-a@uber.com>",
    mailbox: "promo"
  },
  {
    sender: "Uber Eats <receipts@uber.com>",
    recipient: "account-a@icloud.com",
    subject: "Your receipt from Example Kitchen",
    body: [
      "Thanks for your order",
      "Subtotal £25.00",
      "Promotion -£15.00",
      "Delivery Fee £1.49",
      "Service Fee £1.00",
      "Total £12.49"
    ].join("\n"),
    sentAt: "2026-10-05T18:00:00Z",
    receivedAt: "2026-10-05T18:00:10Z",
    messageId: "<receipt-a@uber.com>",
    mailbox: "receipt"
  },
  {
    sender: "Uber Eats <offers@uber.com>",
    recipient: "account-b@icloud.com",
    subject: "40% off your next order",
    body: "Get 40% off your next order, up to £12. Minimum spend £20. Expires 20 Oct 2099.",
    sentAt: "2026-10-05T11:00:00Z",
    receivedAt: "2026-10-05T11:00:10Z",
    messageId: "<promo-b@uber.com>",
    mailbox: "promo"
  }
];

fs.writeFileSync(input, JSON.stringify({ messages }, null, 2));

function generate() {
  execFileSync(process.execPath, [
    "generate-promos.js",
    input,
    output,
    history,
    dbPath
  ], {
    cwd: process.cwd(),
    stdio: "pipe"
  });

  return JSON.parse(fs.readFileSync(output, "utf8"));
}

try {
  let publicPayload = generate();

  assert.equal(publicPayload.schemaVersion, 3);
  assert.equal(publicPayload.summary.trackedOrders, 1);
  assert.equal(publicPayload.summary.promoSavings, 15);
  assert.equal(publicPayload.summary.totalSaved, 15);
  assert.equal(publicPayload.summary.estimatedTotalSaved, 15);
  assert.equal(publicPayload.accounts.length, 2);
  assert.equal(publicPayload.accounts.every(account => account.canLogin === false), true);

  const serialized = JSON.stringify(publicPayload);
  assert.equal(serialized.includes("account-a@icloud.com"), false);
  assert.equal(serialized.includes("account-b@icloud.com"), false);
  assert.equal(serialized.includes("PRIVATE15"), false);
  assert.equal(serialized.includes("Example Kitchen"), false);

  const db = openPrivateDb(dbPath);
  try {
    const account = getAccounts(db).find(row => row.alias === "account-a@icloud.com");
    assert.ok(account);
    assert.equal(setAccountAccess(db, "account-a@icloud.com", true), true);
  } finally {
    db.close();
  }

  publicPayload = generate();

  const accountA = publicPayload.accounts.find(account => account.canLogin === true);
  assert.ok(accountA, "access import state should survive subsequent Mail scans");

  const usedPromo = publicPayload.promos.find(promo =>
    promo.accountRef === accountA.accountRef &&
    promo.discountType === "fixed"
  );

  assert.ok(usedPromo);
  assert.equal(usedPromo.receiptState, "used");
  assert.equal(usedPromo.usesRemaining, 0);
  assert.equal(publicPayload.summary.totalSaved, 15, "rescans must not double-count receipts");
  assert.equal(publicPayload.summary.estimatedTotalSaved, 15, "rescans must not double-count estimated savings");

  console.log("✓ End-to-end Mail → SQLite → receipt → public JSON integration");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
