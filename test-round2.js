import assert from "node:assert/strict";

import {
  consumeManualUse,
  effectivePromoState,
  effectiveRemainingUses,
  getOfferManualState,
  isAccountDone,
  manualActivity,
  normaliseManualStore,
  pendingManualUses,
  promoForDecision,
  setAccountDone,
  setOfferDone,
  setOfferIgnored,
  undoManualUse
} from "./manual-state.js";

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

function promo(overrides = {}) {
  return {
    id: "multi-5",
    accountRef: "A001",
    service: "Uber Eats",
    title: "£12 off £15 on 5 orders",
    discountType: "fixed",
    discount: 12,
    minimumSpend: 15,
    uses: 5,
    usesRemaining: 5,
    receiptConfirmedUses: 0,
    receiptState: null,
    ...overrides
  };
}

test("manual use turns 5 remaining into 4", () => {
  const offer = promo();
  let store = normaliseManualStore();

  store = consumeManualUse(store, offer, "2026-10-05T20:00:00Z");

  assert.equal(pendingManualUses(store, offer), 1);
  assert.equal(effectiveRemainingUses(store, offer), 4);
  assert.equal(effectivePromoState(store, offer), "active");
});

test("receipt confirmation reconciles a pending manual use without double counting", () => {
  const before = promo();
  let store = consumeManualUse(
    normaliseManualStore(),
    before,
    "2026-10-05T20:00:00Z"
  );

  const afterReceipt = promo({
    usesRemaining: 4,
    receiptConfirmedUses: 1,
    receiptState: "partial"
  });

  assert.equal(pendingManualUses(store, afterReceipt), 0);
  assert.equal(effectiveRemainingUses(store, afterReceipt), 4);
});

test("a new manual use after receipt reconciliation becomes the only pending use", () => {
  const before = promo();
  let store = consumeManualUse(normaliseManualStore(), before);

  const afterReceipt = promo({
    usesRemaining: 4,
    receiptConfirmedUses: 1,
    receiptState: "partial"
  });

  store = consumeManualUse(store, afterReceipt, "2026-10-06T20:00:00Z");

  assert.equal(pendingManualUses(store, afterReceipt), 1);
  assert.equal(effectiveRemainingUses(store, afterReceipt), 3);
});

test("undo only reverses an unconfirmed manual use", () => {
  const receiptPromo = promo({
    usesRemaining: 4,
    receiptConfirmedUses: 1,
    receiptState: "partial"
  });

  let store = consumeManualUse(
    normaliseManualStore(),
    receiptPromo,
    "2026-10-06T20:00:00Z"
  );

  store = undoManualUse(store, receiptPromo, "2026-10-06T20:05:00Z");

  assert.equal(pendingManualUses(store, receiptPromo), 0);
  assert.equal(effectiveRemainingUses(store, receiptPromo), 4);

  const secondUndo = undoManualUse(store, receiptPromo);
  assert.equal(effectiveRemainingUses(secondUndo, receiptPromo), 4);
});

test("all remaining uses consumed makes the promo used", () => {
  const offer = promo({ usesRemaining: 2, receiptConfirmedUses: 3 });
  let store = normaliseManualStore();

  store = consumeManualUse(store, offer);
  store = consumeManualUse(store, offer);

  assert.equal(effectiveRemainingUses(store, offer), 0);
  assert.equal(effectivePromoState(store, offer), "used");
});

test("ignore hides an offer without consuming uses", () => {
  const offer = promo();
  let store = setOfferIgnored(normaliseManualStore(), offer, true);

  assert.equal(effectivePromoState(store, offer), "ignored");
  assert.equal(effectiveRemainingUses(store, offer), 0);

  store = setOfferIgnored(store, offer, false);
  assert.equal(effectivePromoState(store, offer), "active");
  assert.equal(effectiveRemainingUses(store, offer), 5);
});

test("mark fully used can be restored", () => {
  const offer = promo();
  let store = setOfferDone(normaliseManualStore(), offer, true);

  assert.equal(effectivePromoState(store, offer), "used");
  assert.equal(effectiveRemainingUses(store, offer), 0);

  store = setOfferDone(store, offer, false);
  assert.equal(effectivePromoState(store, offer), "active");
  assert.equal(effectiveRemainingUses(store, offer), 5);
});

test("mark account done is separate from offer usage", () => {
  let store = setAccountDone(normaliseManualStore(), "A001", true);

  assert.equal(isAccountDone(store, "A001"), true);
  assert.equal(getOfferManualState(store, promo()).forceDone, false);

  store = setAccountDone(store, "A001", false);
  assert.equal(isAccountDone(store, "A001"), false);
});

test("decision clone uses effective remaining count", () => {
  const offer = promo({
    usesRemaining: 4,
    receiptConfirmedUses: 1,
    receiptState: "partial"
  });

  let store = consumeManualUse(normaliseManualStore(), offer);
  const decision = promoForDecision(store, offer);

  assert.equal(decision.usesRemaining, 3);
  assert.notEqual(decision.receiptState, "used");
});

test("activity exposes pending use and remaining count", () => {
  const offer = promo();
  const store = consumeManualUse(
    normaliseManualStore(),
    offer,
    "2026-10-05T20:00:00Z"
  );

  const activity = manualActivity(store, offer);

  assert.equal(activity.pendingManualUses, 1);
  assert.equal(activity.effectiveRemaining, 4);
  assert.equal(activity.lastManualUseAt, "2026-10-05T20:00:00Z");
});

console.log("Round-2 manual usage: " + passed + " tests passed.");
