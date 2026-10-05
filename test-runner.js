import assert from "node:assert/strict";
import { parseUberPromo } from "./parser.js";
import { buildPromoList } from "./processor.js";
import { toPublicPromo } from "./public-promo.js";
import { mergeHistory } from "./history.js";
import { accountIdForAlias } from "./account-id.js";

const parserCases = [
  {
    name: "Trusted sender can carry an offer without Uber in the subject",
    email: {
      sender: "Uber Eats <offers@uber.com>",
      recipient: "Hide My Email <alpha-test@icloud.com>",
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
      accountAlias: "alpha-test@icloud.com"
    }
  },
  {
    name: "Uber Cash is recognised as value",
    email: {
      sender: "Uber Eats <ubereats_at_uber_com_abc@icloud.com>",
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
      senderVerified: true
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

const emails = [
  parserCases[0].email,
  parserCases[0].email,
  parserCases[1].email,
  parserCases[2].email,
  parserCases[3].email,
  parserCases[5].email,
  parserCases[7].email,
  parserCases[8].email,
  {
    subject: "50% off Uber",
    body: "50% off your next trip, up to £4. Expires 4 October 2026.",
    receivedAt: "2026-10-01"
  }
];

const promos = buildPromoList(emails, { now: "2026-10-05" });

assert.equal(
  promos.length,
  4,
  "processor should deduplicate and remove expired, untrusted and non-promo email"
);

assert.equal(
  promos[0].maxTotalSaving,
  75,
  "five uses of a £15 fixed offer should rank as £75 potential value"
);

assert.ok(
  promos.some(promo => promo.service === "Uber Eats"),
  "Uber Eats promo should remain"
);

console.log("✓ Processor filtering, deduplication, expiry and ranking");

const privatePromo = {
  ...promos[0],
  code: "PRIVATE123",
  rawEmail: "private mailbox content"
};

const publicPromo = toPublicPromo(privatePromo);

assert.equal(
  publicPromo.hasCode,
  true,
  "public output should record that a code exists"
);

assert.equal(
  "code" in publicPromo,
  false,
  "public output must never contain the actual promo code"
);

assert.equal(
  "rawEmail" in publicPromo,
  false,
  "public output must never contain raw email content"
);

console.log("✓ Public promo output strips private data");

const firstHistory = mergeHistory(
  { records: [] },
  [publicPromo],
  "2026-10-05T10:00:00.000Z"
);

assert.equal(firstHistory.records.length, 1);
assert.equal(firstHistory.records[0].scansSeen, 1);

const secondHistory = mergeHistory(
  firstHistory,
  [publicPromo],
  "2026-10-05T11:00:00.000Z"
);

assert.equal(
  secondHistory.records[0].scansSeen,
  2,
  "repeat scans should update the same history record"
);

assert.equal(
  secondHistory.records[0].firstSeenAt,
  "2026-10-05T10:00:00.000Z",
  "history should preserve first seen time"
);

assert.equal(
  "code" in secondHistory.records[0],
  false,
  "history must not expose promo codes"
);

console.log("✓ Sanitised promo history persists across scans");

const accountEmails = [
  {
    sender: "Uber Eats <offers@uber.com>",
    recipient: "Hide My Email <account-a@icloud.com>",
    subject: "£5 off your next order",
    body: "£5 off your next order. Expires 12 Oct 2026.",
    receivedAt: "2026-10-05"
  },
  {
    sender: "Uber Eats <offers@uber.com>",
    recipient: "Hide My Email <account-a@icloud.com>",
    subject: "20% off your next order",
    body: "20% off your next order, up to £6. Expires 12 Oct 2026.",
    receivedAt: "2026-10-05"
  },
  {
    sender: "Uber Eats <offers@uber.com>",
    recipient: "Hide My Email <account-b@icloud.com>",
    subject: "£5 off your next order",
    body: "£5 off your next order. Expires 12 Oct 2026.",
    receivedAt: "2026-10-05"
  }
];

const accountPromos = buildPromoList(accountEmails, { now: "2026-10-05" });
assert.equal(accountPromos.length, 3, "same offer on different recipient aliases must stay separate");

const accountA = accountPromos.filter(promo => promo.accountAlias === "account-a@icloud.com");
const accountB = accountPromos.filter(promo => promo.accountAlias === "account-b@icloud.com");

assert.equal(accountA.length, 2);
assert.ok(accountA.every(promo => promo.sameAccountOfferCount === 2));
assert.equal(accountB.length, 1);
assert.equal(accountB[0].sameAccountOfferCount, 1);
console.log("✓ Account-aware deduplication keeps aliases separate");

const secret = "test-secret-that-is-long-enough-for-stable-account-ids";
const accountAId = accountIdForAlias("account-a@icloud.com", secret);
const accountAIdAgain = accountIdForAlias("ACCOUNT-A@ICLOUD.COM", secret);
const accountBId = accountIdForAlias("account-b@icloud.com", secret);

assert.equal(accountAId, accountAIdAgain, "account IDs should be stable and case-insensitive");
assert.notEqual(accountAId, accountBId, "different aliases should get different anonymous IDs");

const anonymousPublicPromo = toPublicPromo(accountA[0], { accountId: accountAId });
assert.equal(anonymousPublicPromo.accountId, accountAId);
assert.equal("accountAlias" in anonymousPublicPromo, false, "public promo must not expose recipient alias");
assert.equal(anonymousPublicPromo.sameAccountOfferCount, 2);
console.log("✓ Recipient aliases become stable anonymous public account IDs");

const accountHistory = mergeHistory(
  { records: [] },
  [
    toPublicPromo(accountA[0], { accountId: accountAId }),
    toPublicPromo(accountB[0], { accountId: accountBId })
  ],
  "2026-10-05T12:00:00.000Z"
);

assert.equal(accountHistory.records.length, 2, "history must keep identical-looking offers separate by anonymous account");
assert.ok(accountHistory.records.every(record => !("accountAlias" in record)));
console.log("✓ History remains account-aware without exposing aliases");

console.log("All " + (parserCases.length + 6) + " automated tests passed.");
