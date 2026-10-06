import { savingForSpend } from "./deal-intelligence.js";
import { applyOfferTrackingStates } from "./offer-state.js";

function number(value) {
  if (value == null || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function feeTotal(receipt) {
  return roundMoney(
    (number(receipt.deliveryFee) || 0) +
    (number(receipt.serviceFee) || 0) +
    (number(receipt.smallOrderFee) || 0)
  );
}

function timeOf(value) {
  if (!value) return null;
  const result = new Date(value).getTime();
  return Number.isNaN(result) ? null : result;
}

function receiptCanUsePromo(receipt, promo) {
  const receiptTime = timeOf(receipt.sentAt || receipt.receivedAt);
  if (receiptTime == null) return true;

  const promoTime = timeOf(promo.emailSentAt || promo.receivedAt);
  if (promoTime != null && receiptTime + 60 * 60 * 1000 < promoTime) {
    return false;
  }

  if (promo.expires) {
    const expiryTime = new Date(promo.expires + "T23:59:59").getTime();
    if (!Number.isNaN(expiryTime) && receiptTime > expiryTime) {
      return false;
    }
  }

  return true;
}

function candidateMatch(promo, receipt, observed, mode) {
  if (promo.accountRef !== receipt.accountRef) return null;
  if (promo.usesRemaining <= 0) return null;
  if (!receiptCanUsePromo(receipt, promo)) return null;

  if (mode === "uberCash" && promo.discountType !== "uberCash") return null;
  if (mode === "promotion" && promo.discountType === "uberCash") return null;

  const subtotal = number(receipt.subtotal);
  if (subtotal == null || subtotal <= 0) return null;

  const calculation = savingForSpend(promo, subtotal);
  if (!calculation.eligible || calculation.saving <= 0) return null;

  return {
    promo,
    expected: calculation.saving,
    difference: Math.abs(calculation.saving - observed)
  };
}

function consumeBestMatch({ tracked, receipt, observed, mode, matches, stats }) {
  if (observed == null || observed <= 0) {
    return { consumed: false, ambiguous: false, candidateOfferIds: [] };
  }

  const candidates = tracked
    .map(promo => candidateMatch(promo, receipt, observed, mode))
    .filter(Boolean)
    .sort((a, b) => a.difference - b.difference);

  if (!candidates.length) {
    return { consumed: false, ambiguous: false, candidateOfferIds: [] };
  }

  const best = candidates[0];
  const second = candidates[1];
  const tolerance = Math.max(0.2, observed * 0.03);

  const uniqueEnough =
    !second ||
    second.difference > tolerance ||
    second.difference - best.difference >= 0.2;

  if (best.difference > tolerance || !uniqueEnough) {
    const candidateOfferIds = candidates
      .map(candidate => candidate.promo.offerId || candidate.promo.id || null)
      .filter(Boolean);

    matches.push({
      receiptId: receipt.receiptId || receipt.id || null,
      offerId: null,
      accountRef: receipt.accountRef,
      observedSaving: observed,
      expectedSaving: best.expected,
      mode,
      status: "ambiguous",
      candidateOfferIds
    });

    return {
      consumed: false,
      ambiguous: true,
      candidateOfferIds
    };
  }

  best.promo.receiptConfirmedUses += 1;
  best.promo.usesRemaining = Math.max(0, best.promo.usesRemaining - 1);
  best.promo.receiptState = best.promo.usesRemaining === 0 ? "used" : "partial";
  best.promo.lastUsedAt = receipt.sentAt || receipt.receivedAt || null;

  if (stats) stats.confirmedPromoUses += 1;

  const offerId = best.promo.offerId || best.promo.id || null;

  matches.push({
    receiptId: receipt.receiptId || receipt.id || null,
    offerId,
    accountRef: receipt.accountRef,
    observedSaving: observed,
    expectedSaving: best.expected,
    mode,
    status: "confirmed"
  });

  return {
    consumed: true,
    ambiguous: false,
    candidateOfferIds: offerId ? [offerId] : []
  };
}

function receiptIdentity(receipt) {
  if (receipt.orderId) {
    return [
      "order",
      receipt.accountRef || "",
      String(receipt.orderId).trim().toLowerCase()
    ].join("|");
  }

  if (receipt.receiptId || receipt.id) {
    return "receipt|" + String(receipt.receiptId || receipt.id);
  }

  return [
    "fallback",
    receipt.accountRef || "",
    receipt.sentAt || receipt.receivedAt || "",
    receipt.subtotal ?? "",
    receipt.promotionDiscount ?? "",
    receipt.total ?? ""
  ].join("|");
}

function dedupeReceipts(receipts = []) {
  const seen = new Set();
  const result = [];

  for (const receipt of receipts) {
    const key = receiptIdentity(receipt);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(receipt);
  }

  return result;
}

function orderCountCandidates(tracked, receipt) {
  return tracked.filter(promo => {
    if (promo.service !== "Uber Eats") return false;
    if (Number(promo.uses || 1) <= 1) return false;
    if (promo.discountType === "uberCash") return false;
    if (promo.accountRef !== receipt.accountRef) return false;
    if (promo.usesRemaining <= 0) return false;
    if (!receiptCanUsePromo(receipt, promo)) return false;

    const subtotal = number(receipt.subtotal);
    if (subtotal == null || subtotal <= 0) return false;

    const calculation = savingForSpend(promo, subtotal);
    return Boolean(calculation.eligible);
  });
}

function consumeOrderCountUse({ tracked, receipt, matches, stats }) {
  const candidates = orderCountCandidates(tracked, receipt);

  if (candidates.length === 0) {
    return { consumed: false, ambiguous: false, candidateOfferIds: [] };
  }

  if (candidates.length > 1) {
    const candidateOfferIds = candidates
      .map(promo => promo.offerId || promo.id || null)
      .filter(Boolean);

    matches.push({
      receiptId: receipt.receiptId || receipt.id || null,
      offerId: null,
      accountRef: receipt.accountRef,
      observedSaving: number(receipt.promotionDiscount) || 0,
      expectedSaving: null,
      mode: "order_count",
      status: "ambiguous",
      candidateOfferIds
    });

    return {
      consumed: false,
      ambiguous: true,
      candidateOfferIds
    };
  }

  const promo = candidates[0];
  promo.receiptConfirmedUses += 1;
  promo.usesRemaining = Math.max(0, promo.usesRemaining - 1);
  promo.receiptState = promo.usesRemaining === 0 ? "used" : "partial";
  promo.lastUsedAt = receipt.sentAt || receipt.receivedAt || null;

  if (stats) stats.confirmedPromoUses += 1;

  const offerId = promo.offerId || promo.id || null;

  matches.push({
    receiptId: receipt.receiptId || receipt.id || null,
    offerId,
    accountRef: receipt.accountRef,
    observedSaving: number(receipt.promotionDiscount) || 0,
    expectedSaving: null,
    mode: "order_count",
    status: "confirmed"
  });

  return {
    consumed: true,
    ambiguous: false,
    candidateOfferIds: offerId ? [offerId] : []
  };
}

export function applyReceiptEvidence(promos = [], receipts = [], { now = new Date() } = {}) {
  const tracked = promos.map(promo => ({
    ...promo,
    receiptConfirmedUses: 0,
    usesRemaining: Math.max(0, Number(promo.uses || 1)),
    receiptState: null,
    lastUsedAt: null
  }));

  const accountStats = new Map();
  const matches = [];

  function statsFor(receipt) {
    const ref = receipt.accountRef || null;
    if (!ref) return null;

    if (!accountStats.has(ref)) {
      accountStats.set(ref, {
        accountRef: ref,
        accountMasked: receipt.accountMasked || null,
        canLogin: Boolean(receipt.canLogin),
        receiptOrderCount: 0,
        lastOrderAt: null,
        observedPromoSavings: 0,
        confirmedPromoUses: 0,
        uberCashUsed: 0,
        totalSaved: 0
      });
    }

    return accountStats.get(ref);
  }

  const orderedReceipts = dedupeReceipts(receipts)
    .filter(receipt => !receipt.service || receipt.service === "Uber Eats")
    .slice()
    .sort((a, b) =>
      String(a.sentAt || a.receivedAt || "")
        .localeCompare(String(b.sentAt || b.receivedAt || ""))
    );

  for (const receipt of orderedReceipts) {
    const stats = statsFor(receipt);
    const when = receipt.sentAt || receipt.receivedAt || null;
    const promotion = number(receipt.promotionDiscount) || 0;
    const cash = number(receipt.uberCashUsed) || 0;

    if (stats) {
      stats.receiptOrderCount += 1;
      if (!stats.lastOrderAt || String(when || "") > stats.lastOrderAt) {
        stats.lastOrderAt = when;
      }
      stats.observedPromoSavings = roundMoney(stats.observedPromoSavings + promotion);
      stats.uberCashUsed = roundMoney(stats.uberCashUsed + cash);
      stats.totalSaved = roundMoney(stats.totalSaved + promotion + cash);
    }

    if (!receipt.accountRef) continue;

    const promotionResult = consumeBestMatch({
      tracked,
      receipt,
      observed: promotion,
      mode: "promotion",
      matches,
      stats
    });

    const cashResult = consumeBestMatch({
      tracked,
      receipt,
      observed: cash,
      mode: "uberCash",
      matches,
      stats
    });

    const alreadyConsumed =
      Boolean(promotionResult?.consumed) ||
      Boolean(cashResult?.consumed);

    const ambiguous =
      Boolean(promotionResult?.ambiguous) ||
      Boolean(cashResult?.ambiguous);

    if (!alreadyConsumed && !ambiguous) {
      consumeOrderCountUse({
        tracked,
        receipt,
        matches,
        stats
      });
    }
  }

  const uniqueEatsReceipts = orderedReceipts;

  const feeSamples = uniqueEatsReceipts
    .map(receipt => ({
      fee: feeTotal(receipt),
      hasParsedFee:
        number(receipt.deliveryFee) != null ||
        number(receipt.serviceFee) != null ||
        number(receipt.smallOrderFee) != null
    }))
    .filter(sample => sample.hasParsedFee);

  const averageExtraOrderFees = feeSamples.length
    ? roundMoney(
        feeSamples.reduce((sum, sample) => sum + sample.fee, 0) / feeSamples.length
      )
    : null;

  const trackedWithState = applyOfferTrackingStates(tracked, matches, { now });

  return {
    promos: trackedWithState,
    matches,
    publicInsights: {
      receiptCount: uniqueEatsReceipts.length,
      feeModel: {
        sampleSize: feeSamples.length,
        averageExtraOrderFees
      },
      accounts: [...accountStats.values()]
        .sort((a, b) =>
          String(b.lastOrderAt || "").localeCompare(String(a.lastOrderAt || ""))
        )
    }
  };
}
