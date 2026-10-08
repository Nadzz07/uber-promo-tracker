import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { parseUberPromo } from "./parser.js";
import { parseUberEatsReceipt } from "./receipt-parser.js";
import { toPublicPromo } from "./public-promo.js";
import { planBasketSplit } from "./deal-intelligence.js";
import { estimateReceiptSavings } from "./savings-intelligence.js";
import {
  ensureAccount,
  getAccounts,
  getOffers,
  getSavingsSummary,
  openPrivateDb,
  setAccountAccess,
  upsertOffer,
  upsertReceipt
} from "./private-db.js";
import {
  messageKey,
  offerFingerprint,
  receiptFingerprint
} from "./identity.js";

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("✓ " + name);
  } catch (error) {
    console.error("✗ " + name);
    throw error;
  }
}

const trusted = "Uber Eats <offers@uber.com>";

test("explicit expiry works without on/at and preserves midnight", () => {
  const promo = parseUberPromo({
    sender: trusted,
    recipient: "alpha@icloud.com",
    subject: "£15 off expires 20 Mar 2026 12:00AM",
    body: "Get £15 off your next order.",
    sentAt: "2026-03-10T12:00:00Z",
    receivedAt: "2026-03-10T12:00:10Z"
  });

  assert.equal(promo.expires, "2026-03-20");
  assert.equal(promo.expiresAt, "2026-03-20T00:00:00");
  assert.equal(promo.expiryStatus, "exact");
  assert.equal(promo.expiryBasis, "explicit_in_offer_terms");
  assert.ok(promo.evidence.expiry.includes("20 Mar 2026"));
});

test("explicit named date without time defaults to end of day", () => {
  const promo = parseUberPromo({
    sender: trusted,
    subject: "£12 off",
    body: "Expires on 1 December 2026.",
    sentAt: "2026-10-05T12:00:00Z"
  });

  assert.equal(promo.expires, "2026-12-01");
  assert.equal(promo.expiresAt, "2026-12-01T23:59:59");
});

test("valid until wording parses explicit time", () => {
  const promo = parseUberPromo({
    sender: trusted,
    subject: "£10 off your order",
    body: "Valid until 5 Nov 2026 11:00PM.",
    sentAt: "2026-10-05T12:00:00Z"
  });

  assert.equal(promo.expiresAt, "2026-11-05T23:00:00");
});

test("expires at wording parses a date", () => {
  const promo = parseUberPromo({
    sender: trusted,
    subject: "£10 off",
    body: "Expires at 25 Aug 2026.",
    sentAt: "2026-08-01T12:00:00Z"
  });

  assert.equal(promo.expires, "2026-08-25");
});

test("UK numeric expiry is day first", () => {
  const promo = parseUberPromo({
    sender: trusted,
    subject: "£10 off",
    body: "Expires on 10/11/2026.",
    sentAt: "2026-10-05T12:00:00Z"
  });

  assert.equal(promo.expires, "2026-11-10");
});

test("ordinary duration expiry is estimated from email date", () => {
  const promo = parseUberPromo({
    sender: trusted,
    subject: "£10 off your order",
    body: "This offer is valid for 14 days.",
    sentAt: "2026-10-04T14:16:00Z"
  });

  assert.equal(promo.expiryStatus, "estimated");
  assert.equal(promo.expiryBasis, "estimated_from_email_date");
  assert.equal(promo.expires, "2026-10-18");
});

test("account-activation duration stays unknown", () => {
  const promo = parseUberPromo({
    sender: trusted,
    subject: "You have £12 in Uber Cash",
    body: "Uber Cash is valid for 35 days since it was applied to the user's account.",
    sentAt: "2026-10-05T13:16:00Z"
  });

  assert.equal(promo.expires, null);
  assert.equal(promo.expiresAt, null);
  assert.equal(promo.expiryStatus, "unknown");
  assert.equal(promo.expiryBasis, null);
});

test("grocery subject is rejected separately from expiry logic", () => {
  const promo = parseUberPromo({
    sender: trusted,
    subject: "50% off groceries",
    body: "Get 50% off your next order.",
    sentAt: "2026-10-05T12:00:00Z"
  });

  assert.equal(promo.isPromo, false);
  assert.equal(promo.rejectionReason, "category_excluded");
});

test("supermarket marketing is rejected", () => {
  const promo = parseUberPromo({
    sender: trusted,
    subject: "Save £10 at the supermarket",
    body: "£10 off your next order.",
    sentAt: "2026-10-05T12:00:00Z"
  });

  assert.equal(promo.isPromo, false);
  assert.equal(promo.rejectionReason, "category_excluded");
});

test("Uber Cash is a structured offer type", () => {
  const promo = parseUberPromo({
    sender: trusted,
    recipient: "cash@icloud.com",
    subject: "You have £12 in Uber Cash",
    body: "You have £12 in Uber Cash waiting in your account.",
    sentAt: "2026-10-05T12:00:00Z"
  });

  assert.equal(promo.isPromo, true);
  assert.equal(promo.offerType, "uber_cash");
  assert.equal(promo.discountType, "uberCash");
  assert.equal(promo.discount, 12);
  assert.equal(promo.service, "Uber Eats");
});

test("ride percentage is classified as ride discount", () => {
  const promo = parseUberPromo({
    sender: "Uber <offers@uber.com>",
    subject: "20% off your next ride",
    body: "Save 20% off your next ride, up to £8.",
    sentAt: "2026-10-05T12:00:00Z"
  });

  assert.equal(promo.offerType, "ride_percentage_discount");
  assert.equal(promo.service, "Uber");
});

test("fixed ride offer is classified separately", () => {
  const promo = parseUberPromo({
    sender: "Uber <offers@uber.com>",
    subject: "£12 off your next Uber ride",
    body: "£12 off your next Uber ride.",
    sentAt: "2026-10-05T12:00:00Z"
  });

  assert.equal(promo.offerType, "ride_fixed_discount");
});

test("multi-order fixed offer is classified structurally", () => {
  const promo = parseUberPromo({
    sender: trusted,
    subject: "£15 off your first 5 orders",
    body: "Get £15 off your first 5 orders. £15 minimum spend.",
    sentAt: "2026-10-05T12:00:00Z"
  });

  assert.equal(promo.offerType, "multi_order_discount");
  assert.equal(promo.uses, 5);
  assert.equal(promo.maxTotalSaving, 75);
});

test("untrusted sender is rejected", () => {
  const promo = parseUberPromo({
    sender: "Not Uber <offers@example.com>",
    subject: "£15 off Uber Eats",
    body: "£15 off your next order.",
    sentAt: "2026-10-05T12:00:00Z"
  });

  assert.equal(promo.isPromo, false);
  assert.equal(promo.rejectionReason, "sender_not_uber");
});

test("Uber display name with an unrelated address is rejected", () => {
  const promo = parseUberPromo({
    sender: "Uber Eats <relay@example.invalid>",
    subject: "£15 off your order",
    body: "Get £15 off your next order.",
    sentAt: "2026-10-05T12:00:00Z"
  });

  assert.equal(promo.isPromo, false);
  assert.equal(promo.senderConfidence, "low");
});

test("receipt parser extracts reported and Uber One savings without losing fees", () => {
  const receipt = parseUberEatsReceipt({
    sender: "Uber Eats <receipts@uber.com>",
    recipient: "alpha@icloud.com",
    subject: "Your receipt from Example Kitchen",
    body: [
      "Thanks for your order",
      "Subtotal £25.00",
      "Promotion -£15.00",
      "Uber One savings £2.50",
      "You saved £17.50",
      "Delivery Fee £1.49",
      "Service Fee £1.00",
      "Total £12.49"
    ].join("\n"),
    sentAt: "2026-10-05T18:00:00Z"
  });

  assert.equal(receipt.isReceipt, true);
  assert.equal(receipt.subtotal, 25);
  assert.equal(receipt.promotionDiscount, 15);
  assert.equal(receipt.uberOneSavings, 2.5);
  assert.equal(receipt.uberOneSignal, true);
  assert.equal(receipt.reportedSavings, 17.5);
  assert.equal(receipt.deliveryFee, 1.49);
  assert.equal(receipt.serviceFee, 1);
  assert.ok(receipt.evidence.promotion.includes("Promotion"));
  assert.ok(receipt.evidence.uberOneSavings.includes("Uber One"));
});

test("estimated savings only fills missing Uber One from explicit receipt samples", () => {
  const savings = estimateReceiptSavings([
    {
      accountRef: "A001",
      subtotal: 20,
      promotionDiscount: 10,
      uberCashUsed: 0,
      reportedSavings: 10,
      uberOneSavings: 2,
      uberOneSignal: true
    },
    {
      accountRef: "A001",
      subtotal: 20,
      promotionDiscount: 5,
      uberCashUsed: 0,
      reportedSavings: 5,
      uberOneSavings: 3,
      uberOneSignal: true
    },
    {
      accountRef: "A001",
      subtotal: 20,
      promotionDiscount: 0,
      uberCashUsed: 0,
      reportedSavings: 4,
      uberOneSavings: 4,
      uberOneSignal: true
    },
    {
      accountRef: "A001",
      subtotal: 20,
      promotionDiscount: 5,
      uberCashUsed: 0,
      reportedSavings: 5,
      uberOneSavings: null,
      uberOneSignal: true
    },
    {
      accountRef: "A001",
      subtotal: 20,
      promotionDiscount: 5,
      uberCashUsed: 0,
      reportedSavings: 8,
      uberOneSavings: null,
      uberOneSignal: true
    }
  ]);

  assert.equal(savings.model.sampleSize, 3);
  assert.equal(savings.model.baselinePerEligibleOrder, 3);
  assert.equal(savings.summary.totalSaved, 37);
  assert.equal(savings.summary.estimatedUberOneSavings, 3);
  assert.equal(savings.summary.estimatedTotalSaved, 40);

  const account = savings.byAccount.get("A001");
  assert.equal(account.confirmedSaved, 37);
  assert.equal(account.estimatedTotalSaved, 40);
});

test("message identity prefers stable Message-ID", () => {
  const a = messageKey({
    messageId: "<same@uber.com>",
    subject: "one"
  });
  const b = messageKey({
    messageId: "<same@uber.com>",
    subject: "different"
  });
  assert.equal(a, b);
});

test("offer family identity ignores changed expiry reminder", () => {
  const base = {
    accountRef: "A001",
    service: "Uber Eats",
    offerType: "fixed_order_discount",
    discountType: "fixed",
    discount: 15,
    minimumSpend: 15,
    uses: 1,
    code: "ABC123"
  };

  assert.equal(
    offerFingerprint({ ...base, expires: "2026-10-10" }),
    offerFingerprint({ ...base, expires: "2026-10-12" })
  );
});

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "uber-tracker-v2-"));
const dbPath = path.join(tempDir, "tracker.db");
const db = openPrivateDb(dbPath);

try {
  test("private DB has receipt savings evidence columns", () => {
    const columns = new Set(
      db.prepare("PRAGMA table_info(receipts)").all().map(row => row.name)
    );

    assert.ok(columns.has("reported_savings"));
    assert.ok(columns.has("uber_one_savings"));
    assert.ok(columns.has("uber_one_signal"));
  });

  test("newly discovered account defaults to active", () => {
    const account = ensureAccount(db, {
      alias: "first@icloud.com",
      seenAt: "2026-10-01T10:00:00Z",
      kind: "promo"
    });

    assert.equal(account.canLogin, true);
    assert.equal(getAccounts(db).length, 1);
  });

  test("account access can be marked usable", () => {
    assert.equal(setAccountAccess(db, "first@icloud.com", true), true);
    const account = getAccounts(db).find(row => row.alias === "first@icloud.com");
    assert.equal(account.canLogin, true);
  });

  test("newer email deterministically updates the durable offer", () => {
    const account = getAccounts(db)[0];

    const promo = {
      offerId: "off_test",
      accountRef: account.accountRef,
      service: "Uber Eats",
      offerType: "fixed_order_discount",
      title: "Older title",
      discountType: "fixed",
      discount: 15,
      uses: 1,
      minimumSpend: 15,
      expiryStatus: "unknown",
      emailSentAt: "2026-10-01T10:00:00Z",
      source: "live_mail",
      observedLive: true
    };

    upsertOffer(db, promo, "2026-10-01T10:01:00Z");
    upsertOffer(db, {
      ...promo,
      title: "Newer title",
      emailSentAt: "2026-10-03T10:00:00Z"
    }, "2026-10-03T10:01:00Z");

    upsertOffer(db, {
      ...promo,
      title: "Very old title",
      emailSentAt: "2026-09-20T10:00:00Z"
    }, "2026-10-04T10:01:00Z");

    const stored = getOffers(db, { service: "Uber Eats" })
      .find(row => row.offerId === "off_test");

    assert.equal(stored.title, "Newer title");
    assert.equal(stored.emailSentAt, "2026-10-03T10:00:00Z");
  });

  test("legacy-only offer stays historical", () => {
    const account = getAccounts(db)[0];

    upsertOffer(db, {
      offerId: "off_legacy",
      accountRef: account.accountRef,
      service: "Uber Eats",
      offerType: "fixed_order_discount",
      title: "Legacy",
      discountType: "fixed",
      discount: 10,
      uses: 1,
      minimumSpend: 15,
      expiryStatus: "unknown",
      emailSentAt: "2025-01-01T10:00:00Z",
      source: "legacy_db",
      observedLive: false
    }, "2026-10-05T10:00:00Z");

    const historical = getOffers(db, {
      service: "Uber Eats",
      includeHistorical: true
    }).find(row => row.offerId === "off_legacy");

    assert.equal(historical.status, "historical");
    assert.equal(historical.observedLive, false);
  });

  test("receipt savings feed lifetime summary", () => {
    const account = getAccounts(db)[0];
    const receipt = {
      accountRef: account.accountRef,
      sentAt: "2026-10-05T18:00:00Z",
      receivedAt: "2026-10-05T18:00:10Z",
      subtotal: 25,
      promotionDiscount: 15,
      uberCashUsed: 5,
      deliveryFee: 1.5,
      serviceFee: 1,
      smallOrderFee: 0,
      total: 7.5
    };

    receipt.receiptId = receiptFingerprint(receipt);
    upsertReceipt(db, receipt, "2026-10-05T18:01:00Z");

    const summary = getSavingsSummary(db);
    assert.equal(summary.trackedOrders, 1);
    assert.equal(summary.promoSavings, 15);
    assert.equal(summary.uberCashUsed, 5);
    assert.equal(summary.totalSaved, 15, "Cash balance payment is not confirmed promotional saving");
    assert.equal(summary.estimatedTotalSaved, 15);
    assert.equal(summary.estimatedUberOneSavings, 0);
    assert.equal(summary.averageSavedPerOrder, 15);
    assert.equal(summary.estimatedAverageSavedPerOrder, 15);
  });

  test("basket splitter excludes inaccessible accounts by default", () => {
    const plan = planBasketSplit([
      {
        id: "locked",
        service: "Uber Eats",
        discountType: "fixed",
        discount: 15,
        minimumSpend: 15,
        uses: 1,
        usesRemaining: 1,
        accountRef: "A100",
        accountMasked: "lo…ed@icloud.com",
        canLogin: false
      },
      {
        id: "usable",
        service: "Uber Eats",
        discountType: "fixed",
        discount: 10,
        minimumSpend: 15,
        uses: 1,
        usesRemaining: 1,
        accountRef: "A101",
        accountMasked: "us…le@icloud.com",
        canLogin: true
      }
    ], 20);

    assert.equal(plan.eligible, true);
    assert.equal(plan.orders[0].accountRef, "A101");
    assert.equal(plan.orders[0].saving, 10);
  });

  test("public promo projection strips secrets and evidence", () => {
    const safe = toPublicPromo({
      id: "off_safe",
      service: "Uber Eats",
      title: "£15 off",
      offerType: "fixed_order_discount",
      discountType: "fixed",
      discount: 15,
      uses: 1,
      minimumSpend: 15,
      code: "SECRET123",
      evidence: { discount: "private source text" },
      accountAlias: "full-private@icloud.com",
      accountRef: "A001",
      accountMasked: "fu…te@icloud.com",
      canLogin: true
    });

    assert.equal(safe.hasCode, true);
    assert.equal("code" in safe, false);
    assert.equal("evidence" in safe, false);
    assert.equal("accountAlias" in safe, false);
    assert.equal(safe.canLogin, true);
  });
} finally {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log("Parser/SQLite v2: " + passed + " tests passed.");
