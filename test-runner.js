import assert from "node:assert/strict";
import { parseUberPromo } from "./parser.js";
import { buildPromoList, estimatedValue } from "./processor.js";
import { toPublicPromo } from "./public-promo.js";
import { mergeHistory, toPublicHistory } from "./history.js";
import { assignAccountRefs } from "./account-map.js";
import { migrateLegacyRows } from "./legacy-migration.js";
import { savingForSpend, rankPromosForSpend, planBasketSplit } from "./deal-intelligence.js";
import { maskAccountAlias } from "./account-map.js";
import { parseUberEatsReceipt } from "./receipt-parser.js";
import { applyReceiptEvidence } from "./receipt-intelligence.js";

const parserCases = [
  {
    name: "Trusted sender can carry an offer without Uber in the subject",
    email: {
      sender: "Uber Eats <offers@uber.com>",
      recipient: "account-a@icloud.com",
      subject: "Want £15 off 5 orders?",
      body: "Enjoy £15 off your next 5 orders. £15 minimum spend. Use promo code EATSUK15NEWBIESTSE. Offer available until 7 Oct 2026 3:00AM.",
      receivedAt: "2026-10-05"
    },
    expected: {
      isPromo: true,
      service: "Uber Eats",
      discountType: "fixed",
      discount: 15,
      uses: 5,
      maxTotalSaving: 75,
      minimumSpend: 15,
      expires: "2026-10-07",
      senderVerified: true,
      accountAlias: "account-a@icloud.com"
    }
  },
  {
    name: "Uber Cash is recognised as value",
    email: {
      sender: "Uber Eats <ubereats_at_uber_com_abc@icloud.com>",
      recipient: "account-b@icloud.com",
      subject: "Want £10 in Uber Cash off your first order?",
      body: "Get £10 in Uber Cash off. Uber Cash expires on 03/10/2026.",
      receivedAt: "2026-10-01"
    },
    expected: {
      isPromo: true,
      service: "Uber Eats",
      discountType: "uberCash",
      discount: 10,
      maxTotalSaving: 10,
      expires: "2026-10-03",
      senderVerified: true,
      accountAlias: "account-b@icloud.com"
    }
  },
  {
    name: "Untrusted sender is rejected when sender data is available",
    email: {
      sender: "Not Uber <offers@example.com>",
      subject: "Uber 50% off",
      body: "Get 50% off your next ride, up to £10.",
      receivedAt: "2026-10-05"
    },
    expected: {
      isPromo: false,
      senderVerified: false,
      rejectionReason: "sender_not_uber"
    }
  },
  {
    name: "Activation-based duration expiry stays unknown",
    email: {
      sender: "Uber Eats <offers@uber.com>",
      subject: "You have £12 in Uber Cash waiting in your account",
      body: "You have £12 in Uber Cash. Uber Cash is valid for 35 days since it was applied to the user's account.",
      receivedAt: "2026-10-05"
    },
    expected: {
      isPromo: true,
      discountType: "uberCash",
      discount: 12,
      expires: null,
      expiryBasis: null
    }
  },
  {
    name: "Uber ride percentage offer",
    email: {
      subject: "40% off your next Uber trip",
      body: "Save 40% off your next ride, up to £10. Valid until 12 October 2026.",
      receivedAt: "2026-10-05"
    },
    expected: {
      service: "Uber",
      discount: 40,
      maxSaving: 10,
      maxTotalSaving: 10,
      expires: "2026-10-12"
    }
  },
  {
    name: "Uber Eats offer",
    email: {
      subject: "25% off Uber Eats",
      body: "Get 25% off your next order. Minimum spend £15. Maximum discount £8. Use code EATS25. Expires 9 Oct 2026.",
      receivedAt: "2026-10-05"
    },
    expected: {
      service: "Uber Eats",
      discount: 25,
      maxSaving: 8,
      minimumSpend: 15,
      code: "EATS25",
      expires: "2026-10-09"
    }
  },
  {
    name: "Fixed discount",
    email: {
      subject: "Save £5 with Uber",
      body: "Save £5 off when you spend £15. Use by 6/10/2026.",
      receivedAt: "2026-10-05"
    },
    expected: {
      service: "Uber",
      discountType: "fixed",
      discount: 5,
      minimumSpend: 15,
      expires: "2026-10-06"
    }
  },
  {
    name: "Receipt is not a promo",
    email: {
      subject: "Your Sunday evening trip with Uber",
      body: "Thanks for riding with Uber. Your trip total was £14.62.",
      receivedAt: "2026-10-05"
    },
    expected: { isPromo: false }
  },
  {
    name: "Multi-trip per-use cap",
    email: {
      subject: "40% off your next 5 Uber trips",
      body: "Get 40% off your next 5 Uber trips, up to £10 per trip. Valid until 19 October 2026.",
      receivedAt: "2026-10-05"
    },
    expected: {
      uses: 5,
      perUseCap: 10,
      maxSaving: 10,
      maxTotalSaving: 50,
      expires: "2026-10-19"
    }
  },
  {
    name: "Weekday expiry",
    email: {
      subject: "25% off with Uber Eats",
      body: "Get 25% off your next order, up to £8. Valid through Sunday.",
      receivedAt: "2026-10-05"
    },
    expected: {
      service: "Uber Eats",
      expires: "2026-10-11"
    }
  }
];

for (const test of parserCases) {
  const result = parseUberPromo(test.email);

  for (const [key, value] of Object.entries(test.expected)) {
    assert.deepEqual(
      result[key],
      value,
      test.name + ": expected " + key + "=" + value + ", got " + result[key]
    );
  }

  console.log("✓ " + test.name);
}

const samePercentOffer = {
  sender: "Uber Eats <offers@uber.com>",
  subject: "50% off your next 5 orders",
  body: "Get 50% off your next 5 orders. Maximum discount £12. Minimum spend £15. Expires 20 Oct 2026.",
  receivedAt: "2026-10-05"
};

const fixedCompanion = {
  sender: "Uber Eats <offers@uber.com>",
  recipient: "account-a@icloud.com",
  subject: "£15 off your next order",
  body: "Get £15 off your next order. Minimum spend £15. Expires 20 Oct 2026.",
  receivedAt: "2026-10-05"
};

const accountAwareEmails = [
  { ...samePercentOffer, recipient: "account-a@icloud.com" },
  { ...samePercentOffer, recipient: "account-a@icloud.com" },
  { ...samePercentOffer, recipient: "account-b@icloud.com" },
  fixedCompanion,
  parserCases[7].email,
  {
    sender: "Uber <offers@uber.com>",
    recipient: "account-a@icloud.com",
    subject: "50% off Uber",
    body: "50% off your next trip, up to £4. Expires 4 October 2026.",
    receivedAt: "2026-10-01"
  }
];

const promos = buildPromoList(accountAwareEmails, { now: "2026-10-05" });

assert.equal(
  promos.length,
  3,
  "same offer should dedupe within one account but remain separate across accounts"
);

const accountAPercentage = promos.find(
  promo =>
    promo.accountAlias === "account-a@icloud.com" &&
    promo.discountType === "percent"
);

const accountBPercentage = promos.find(
  promo =>
    promo.accountAlias === "account-b@icloud.com" &&
    promo.discountType === "percent"
);

assert.equal(
  accountAPercentage?.hasCompanionOffer,
  true,
  "percentage offer should detect a companion on the same account"
);

assert.equal(
  accountBPercentage?.hasCompanionOffer,
  false,
  "companion on a different account must not match"
);

assert.equal(
  estimatedValue(promos[0]),
  15,
  "the £15 fixed companion should rank above the capped percentage offer"
);

console.log("✓ Account-aware deduplication and companion matching");

const firstAssignment = assignAccountRefs(
  promos,
  { version: 1, nextNumber: 1, accounts: {} },
  "2026-10-05T10:00:00.000Z"
);

const refs = new Set(
  firstAssignment.promos.map(promo => promo.accountRef).filter(Boolean)
);

assert.equal(refs.size, 2, "two private aliases should become two anonymous account refs");
assert.ok(refs.has("A001"));
assert.ok(refs.has("A002"));

const secondAssignment = assignAccountRefs(
  [
    {
      ...promos[0],
      accountAlias: "account-a@icloud.com"
    }
  ],
  firstAssignment.state,
  "2026-10-05T11:00:00.000Z"
);

assert.equal(
  secondAssignment.promos[0].accountRef,
  "A001",
  "anonymous account refs must remain stable between scans"
);

console.log("✓ Private aliases map to stable anonymous account refs");

const privatePromo = {
  ...firstAssignment.promos[0],
  code: "PRIVATE123",
  rawEmail: "private mailbox content"
};

const publicPromo = toPublicPromo(privatePromo);

assert.equal(publicPromo.hasCode, true);
assert.equal("code" in publicPromo, false, "public output must never contain actual promo code");
assert.equal("rawEmail" in publicPromo, false, "public output must never contain raw email content");
assert.equal("accountAlias" in publicPromo, false, "public output must never contain the real account alias");
assert.ok(/^A\d{3,}$/.test(publicPromo.accountRef), "public output should contain only anonymous account ref");

console.log("✓ Public promo output strips mailbox and account secrets");

const firstHistory = mergeHistory(
  { records: [] },
  [publicPromo],
  "2026-10-05T10:00:00.000Z"
);

const secondHistory = mergeHistory(
  firstHistory,
  [publicPromo],
  "2026-10-05T11:00:00.000Z"
);

assert.equal(secondHistory.records.length, 1);
assert.equal(secondHistory.records[0].scansSeen, 2);
assert.equal(secondHistory.records[0].accountRef, publicPromo.accountRef);
assert.equal("accountAlias" in secondHistory.records[0], false);
assert.equal("code" in secondHistory.records[0], false);

console.log("✓ Sanitised account-aware history persists across scans");

const migrated = migrateLegacyRows({
  rows: [
    {
      account_alias: "legacy-account@icloud.com",
      platform: "Uber Eats",
      has_code: 1,
      discount_value: "£10 off your first 2 orders",
      minimum_spend: "£15 minimum spend",
      expiry_timestamp: "2026-10-20 23:59:59",
      expiry_basis: "explicit_in_offer_terms"
    },
    {
      account_alias: "legacy-account@icloud.com",
      platform: "Uber Eats",
      has_code: 1,
      discount_value: "£10 off your first 2 orders",
      minimum_spend: "£15 minimum spend",
      expiry_timestamp: "2026-10-20 23:59:59",
      expiry_basis: "explicit_in_offer_terms"
    }
  ],
  accountState: {
    version: 1,
    nextNumber: 1,
    accounts: {}
  },
  privateHistory: {
    updatedAt: null,
    records: []
  },
  importedAt: "2026-10-05T12:00:00.000Z"
});

assert.equal(
  migrated.importedRows,
  2,
  "both accepted legacy rows should be processed privately"
);

assert.equal(
  migrated.dedupedLegacyRecords,
  1,
  "duplicate legacy campaign rows should collapse into one private history record"
);

assert.equal(
  migrated.privateHistory.records.length,
  1,
  "legacy history should be preserved locally"
);

assert.equal(
  migrated.privateHistory.records[0].legacyOccurrences,
  2,
  "legacy duplicate count should be retained privately"
);

assert.equal(
  migrated.publicHistory.records.length,
  0,
  "legacy-only records must not be published"
);

assert.equal(
  "account_alias" in migrated.publicHistory,
  false,
  "public history payload must never expose a real alias"
);

const legacyRef = migrated.privateHistory.records[0].accountRef;
assert.ok(/^A\d{3,}$/.test(legacyRef));

const matchingLivePrivate = {
  ...parseUberPromo({
    sender: "Uber Eats <offers@uber.com>",
    recipient: "legacy-account@icloud.com",
    subject: "£10 off your first 2 orders",
    body: "Get £10 off your first 2 orders. £15 minimum spend. Expires 20 Oct 2026.",
    receivedAt: "2026-10-05"
  }),
  accountRef: legacyRef
};

const matchingLivePublic = toPublicPromo(matchingLivePrivate);

const historyAfterLiveScan = mergeHistory(
  migrated.privateHistory,
  [matchingLivePublic],
  "2026-10-05T13:00:00.000Z"
);

const publicAfterLiveScan = toPublicHistory(historyAfterLiveScan);

assert.equal(
  publicAfterLiveScan.records.length,
  1,
  "a migrated offer may become public only after a real live scan sees it"
);

assert.equal(
  publicAfterLiveScan.records[0].accountRef,
  legacyRef,
  "live scan should reuse the anonymous account ref from private migration"
);

assert.equal(
  "accountAlias" in publicAfterLiveScan.records[0],
  false,
  "public migrated history must never contain the real account alias"
);

console.log("✓ Legacy database migration stays private until live re-observation");

const percentageSpendPromo = {
  service: "Uber Eats",
  discountType: "percent",
  discount: 25,
  maxSaving: 8,
  perUseCap: null,
  minimumSpend: 15,
  uses: 1,
  accountRef: "A001"
};

assert.deepEqual(
  savingForSpend(percentageSpendPromo, 10).eligible,
  false,
  "minimum spend should make a too-small order ineligible"
);

assert.equal(
  savingForSpend(percentageSpendPromo, 20).saving,
  5,
  "25% of £20 should save £5"
);

assert.equal(
  savingForSpend(percentageSpendPromo, 40).saving,
  8,
  "percentage saving should respect the £8 cap"
);

const multiRideSpendPromo = {
  service: "Uber",
  discountType: "percent",
  discount: 40,
  perUseCap: 10,
  maxSaving: 10,
  maxTotalSaving: 50,
  minimumSpend: 0,
  uses: 5,
  accountRef: "A001"
};

assert.equal(
  savingForSpend(multiRideSpendPromo, 40).saving,
  10,
  "spend intelligence must use one-use saving, not the £50 total across five rides"
);

const fixedSpendPromo = {
  service: "Uber Eats",
  discountType: "fixed",
  discount: 15,
  minimumSpend: 15,
  uses: 5,
  accountRef: "A001"
};

const rankedForSpend = rankPromosForSpend(
  [percentageSpendPromo, fixedSpendPromo],
  25,
  { service: "Uber Eats", accountRef: "A001" }
);

assert.equal(
  rankedForSpend[0].promo.discountType,
  "fixed",
  "£15 fixed off should beat 25% off a £25 order"
);

assert.equal(
  rankedForSpend[0].calculation.saving,
  15,
  "planner should show the actual £15 transaction saving"
);

console.log("✓ Spend-specific deal intelligence");

assert.equal(
  maskAccountAlias("nadzz07-private@icloud.com"),
  "na…te@icloud.com",
  "public account identity should be recognisable but masked"
);

console.log("✓ Account email masking");

const parsedReceipt = parseUberEatsReceipt({
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
  receivedAt: "2026-10-05T18:00:00.000Z"
});

assert.equal(parsedReceipt.isReceipt, true);
assert.equal(parsedReceipt.accountAlias, "account-a@icloud.com");
assert.equal(parsedReceipt.subtotal, 25);
assert.equal(parsedReceipt.promotionDiscount, 15);
assert.equal(parsedReceipt.deliveryFee, 1.49);
assert.equal(parsedReceipt.serviceFee, 1);

const receiptEvidence = applyReceiptEvidence(
  [{
    service: "Uber Eats",
    title: "£15 off",
    discountType: "fixed",
    discount: 15,
    minimumSpend: 15,
    uses: 1,
    accountRef: "A001",
    accountMasked: "ac…-a@icloud.com"
  }],
  [{
    ...parsedReceipt,
    id: "receipt-test-1",
    accountRef: "A001",
    accountMasked: "ac…-a@icloud.com"
  }]
);

assert.equal(receiptEvidence.promos[0].receiptState, "used");
assert.equal(receiptEvidence.promos[0].usesRemaining, 0);
assert.equal(receiptEvidence.publicInsights.accounts[0].receiptOrderCount, 1);
assert.equal(receiptEvidence.publicInsights.feeModel.averageExtraOrderFees, 2.49);

console.log("✓ Receipt evidence confirms promo usage and fee model");

const chronologicalEvidence = applyReceiptEvidence(
  [{
    service: "Uber Eats",
    title: "£15 off",
    discountType: "fixed",
    discount: 15,
    minimumSpend: 15,
    uses: 1,
    receivedAt: "2026-10-06T09:00:00.000Z",
    expires: "2026-10-12",
    accountRef: "A001"
  }],
  [{
    ...parsedReceipt,
    id: "receipt-before-promo",
    receivedAt: "2026-10-05T18:00:00.000Z",
    accountRef: "A001"
  }]
);

assert.equal(
  chronologicalEvidence.promos[0].usesRemaining,
  1,
  "a receipt from before the promo email must not consume the new offer"
);

console.log("✓ Receipt chronology prevents false consumption");

const splitPromos = [
  {
    id: "split-a",
    service: "Uber Eats",
    title: "£15 off £15",
    discountType: "fixed",
    discount: 15,
    minimumSpend: 15,
    uses: 1,
    usesRemaining: 1,
    accountRef: "A001",
    accountMasked: "a…1@icloud.com",
    canLogin: true
  },
  {
    id: "split-b",
    service: "Uber Eats",
    title: "£10 Uber Cash",
    discountType: "uberCash",
    discount: 10,
    minimumSpend: 0,
    uses: 1,
    usesRemaining: 1,
    accountRef: "A002",
    accountMasked: "a…2@icloud.com",
    canLogin: true
  },
  {
    id: "split-c",
    service: "Uber Eats",
    title: "40% off up to £12",
    discountType: "percent",
    discount: 40,
    maxSaving: 12,
    perUseCap: 12,
    minimumSpend: 20,
    uses: 1,
    usesRemaining: 1,
    accountRef: "A003",
    accountMasked: "a…3@icloud.com",
    canLogin: true
  }
];

const splitPlan = planBasketSplit(splitPromos, 50, {
  service: "Uber Eats",
  maxOrders: 3,
  extraOrderFee: 2.49
});

assert.equal(splitPlan.eligible, true);
assert.equal(splitPlan.orderCount, 3);
assert.equal(splitPlan.accountCount, 3);
assert.ok(splitPlan.netSaving > 27);
assert.ok(splitPlan.benefitVsSingle > 10);

const expensiveSplit = planBasketSplit(splitPromos, 50, {
  service: "Uber Eats",
  maxOrders: 3,
  extraOrderFee: 20
});

assert.equal(
  expensiveSplit.orderCount,
  1,
  "large extra-order fees should make a single order optimal"
);

console.log("✓ Fee-aware multi-account basket splitting");

console.log("All " + (parserCases.length + 10) + " automated tests passed.");
