import assert from "node:assert/strict";
import { parseUberPromo } from "./parser.js";
import { buildPromoList } from "./processor.js";
import { toPublicPromo } from "./public-promo.js";
import { mergeHistory } from "./history.js";

const parserCases = [
  {
    name: "Trusted sender can carry an offer without Uber in the subject",
    email: {
      sender: "Uber Eats <offers@uber.com>",
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
      senderVerified: true
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

console.log("All " + (parserCases.length + 3) + " automated tests passed.");
