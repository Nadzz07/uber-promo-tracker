import { savingForSpend } from "./deal-intelligence.js";

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
  if (observed == null || observed <= 0) return;

  const candidates = tracked
    .map(promo => candidateMatch(promo, receipt, observed, mode))
    .filter(Boolean)
    .sort((a, b) => a.difference - b.difference);

  if (!candidates.length) return;

  const best = candidates[0];
  const second = candidates[1];
  const tolerance = Math.max(0.2, observed * 0.03);

  const uniqueEnough =
    !second ||
    second.difference > tolerance ||
    second.difference - best.difference >= 0.2;

  if (best.difference > tolerance || !uniqueEnough) {
    matches.push({
      receiptId: receipt.receiptId || receipt.id || null,
      offerId: null,
      accountRef: receipt.accountRef,
      observedSaving: observed,
      expectedSaving: best.expected,
      mode,
      status: "ambiguous"
    });
    return;
  }

  best.promo.receiptConfirmedUses += 1;
  best.promo.usesRemaining = Math.max(0, best.promo.usesRemaining - 1);
  best.promo.receiptState = best.promo.usesRemaining === 0 ? "used" : "partial";
  best.promo.lastUsedAt = receipt.sentAt || receipt.receivedAt || null;

  if (stats) stats.confirmedPromoUses += 1;

  matches.push({
    receiptId: receipt.receiptId || receipt.id || null,
    offerId: best.promo.offerId || best.promo.id || null,
    accountRef: receipt.accountRef,
    observedSaving: observed,
    expectedSaving: best.expected,
    mode,
    status: "confirmed"
  });
}

export function applyReceiptEvidence(promos = [], receipts = []) {
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

  const orderedReceipts = receipts
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

    consumeBestMatch({
      tracked,
      receipt,
      observed: promotion,
      mode: "promotion",
      matches,
      stats
    });

    consumeBestMatch({
      tracked,
      receipt,
      observed: cash,
      mode: "uberCash",
      matches,
      stats
    });
  }

  const feeSamples = receipts
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

  return {
    promos: tracked,
    matches,
    publicInsights: {
      receiptCount: receipts.length,
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
