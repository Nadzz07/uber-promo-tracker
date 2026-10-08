import assert from "node:assert/strict";

import { parseUberPromo } from "./parser.js";
import { parseUberTransportReceipt } from "./transport-receipt-parser.js";
import { applyReceiptEvidence } from "./receipt-intelligence.js";
import { classifyOfferTrackingState } from "./offer-state.js";

const trusted = "Uber Eats <offers@uber.com>";

{
  const promo = parseUberPromo({
    sender: trusted,
    recipient: "alpha@icloud.com",
    subject: "£12 off your first 3 orders",
    body: "Get £12 off your first 3 orders. £15 minimum spend. Expires 20 Oct 2026.",
    sentAt: "2026-10-01T09:00:00Z"
  });

  assert.equal(promo.service, "Uber Eats");
  assert.equal(promo.uses, 3);
  assert.equal(promo.offerType, "multi_order_discount");
  console.log("✓ First 3 / first 5 order wording drives the real usage limit");
}

{
  const promo = {
    offerId: "off-five",
    service: "Uber Eats",
    offerType: "multi_order_discount",
    title: "£15 off your first 5 orders",
    discountType: "fixed",
    discount: 15,
    minimumSpend: 15,
    uses: 5,
    accountRef: "A001",
    receivedAt: "2026-10-01T09:00:00Z",
    expires: "2026-10-20",
    expiryStatus: "exact"
  };

  const receipts = [
    {
      receiptId: "copy-a",
      orderId: "EATS-001",
      service: "Uber Eats",
      accountRef: "A001",
      subtotal: 25,
      promotionDiscount: 0,
      total: 25,
      sentAt: "2026-10-02T18:00:00Z"
    },
    {
      receiptId: "copy-b",
      orderId: "EATS-002",
      service: "Uber Eats",
      accountRef: "A001",
      subtotal: 22,
      promotionDiscount: 0,
      total: 22,
      sentAt: "2026-10-03T18:00:00Z"
    },
    {
      receiptId: "duplicate-copy",
      orderId: "EATS-002",
      service: "Uber Eats",
      accountRef: "A001",
      subtotal: 22,
      promotionDiscount: 0,
      total: 22,
      sentAt: "2026-10-03T18:02:00Z"
    },
    {
      receiptId: "ride-001",
      orderId: "RIDE-001",
      service: "Uber",
      accountRef: "A001",
      subtotal: 18,
      promotionDiscount: 0,
      total: 18,
      sentAt: "2026-10-04T18:00:00Z"
    }
  ];

  const result = applyReceiptEvidence([promo], receipts, {
    now: "2026-10-05T12:00:00Z"
  });

  assert.equal(result.publicInsights.receiptCount, 2);
  assert.equal(result.promos[0].receiptConfirmedUses, 2);
  assert.equal(result.promos[0].usesRemaining, 3);
  assert.equal(result.promos[0].trackingState, "available");

  console.log("✓ Two unique Eats orders leave 3 of 5 uses; duplicate and ride receipts do not count");
}

{
  const expired = classifyOfferTrackingState({
    service: "Uber Eats",
    uses: 5,
    usesRemaining: 3,
    expires: "2026-10-04",
    expiryStatus: "exact"
  }, {
    now: "2026-10-05T12:00:00Z"
  });

  assert.equal(expired.trackingState, "expired");
  assert.equal(expired.closedReason, "expired");

  console.log("✓ Passed expiry is separate from confirmed use");
}

{
  const unknown = classifyOfferTrackingState({
    service: "Uber Eats",
    uses: 5,
    usesRemaining: 3,
    expires: null,
    expiryStatus: "unknown"
  }, {
    now: "2026-10-05T12:00:00Z"
  });

  assert.equal(unknown.trackingState, "needs_checking");
  assert.equal(unknown.needsReview, true);
  assert.deepEqual(unknown.reviewReasons, ["unknown_expiry"]);

  console.log("✓ Unknown expiry with remaining uses is flagged Needs checking");
}

{
  const promos = [
    {
      offerId: "off-a",
      service: "Uber Eats",
      offerType: "multi_order_discount",
      title: "£10 off first 5 orders",
      discountType: "fixed",
      discount: 10,
      minimumSpend: 15,
      uses: 5,
      accountRef: "A002",
      receivedAt: "2026-10-01T09:00:00Z",
      expires: "2026-10-20",
      expiryStatus: "exact"
    },
    {
      offerId: "off-b",
      service: "Uber Eats",
      offerType: "multi_order_discount",
      title: "£8 off first 5 orders",
      discountType: "fixed",
      discount: 8,
      minimumSpend: 15,
      uses: 5,
      accountRef: "A002",
      receivedAt: "2026-10-01T10:00:00Z",
      expires: "2026-10-20",
      expiryStatus: "exact"
    }
  ];

  const result = applyReceiptEvidence(promos, [{
    receiptId: "ambiguous-order",
    orderId: "EATS-AMB-1",
    service: "Uber Eats",
    accountRef: "A002",
    subtotal: 25,
    promotionDiscount: 0,
    total: 25,
    sentAt: "2026-10-02T18:00:00Z"
  }], {
    now: "2026-10-05T12:00:00Z"
  });

  assert.equal(result.promos.every(promo => promo.trackingState === "needs_checking"), true);
  assert.equal(
    result.promos.every(promo => promo.reviewReasons.includes("ambiguous_receipt_match")),
    true
  );

  console.log("✓ Ambiguous Eats receipt usage is flagged instead of guessed");
}

{
  const ride = parseUberTransportReceipt({
    sender: "Uber <receipts@uber.com>",
    recipient: "alpha@icloud.com",
    subject: "Your Sunday evening trip with Uber",
    body: "Thanks for riding with Uber. Trip total £14.62.",
    sentAt: "2026-10-05T20:00:00Z"
  });

  assert.equal(ride.isReceipt, true);
  assert.equal(ride.service, "Uber");
  assert.equal(ride.transportMode, "ride");
  assert.equal(ride.total, 14.62);

  console.log("✓ Ride receipts are recognised separately from Uber Eats orders");
}

console.log("Offer usage-state rules: 6 tests passed.");
