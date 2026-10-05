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

function accountKey(item) {
  return item.accountRef || null;
}

export function applyReceiptEvidence(promos = [], receipts = []) {
  const tracked = promos.map((promo, index) => ({
    ...promo,
    _receiptIndex: index,
    receiptConfirmedUses: 0,
    usesRemaining: Math.max(0, Number(promo.uses || 1)),
    receiptState: null,
    lastUsedAt: null
  }));

  const accountStats = new Map();
  const matches = [];

  function statsFor(receipt) {
    const ref = accountKey(receipt);
    if (!ref) return null;

    if (!accountStats.has(ref)) {
      accountStats.set(ref, {
        accountRef: ref,
        accountMasked: receipt.accountMasked || null,
        receiptOrderCount: 0,
        lastOrderAt: null,
        observedPromoSavings: 0,
        confirmedPromoUses: 0,
        uberCashUsed: 0
      });
    }

    return accountStats.get(ref);
  }

  const orderedReceipts = receipts
    .slice()
    .sort((a, b) => String(a.receivedAt || "").localeCompare(String(b.receivedAt || "")));

  for (const receipt of orderedReceipts) {
    const stats = statsFor(receipt);

    if (stats) {
      stats.receiptOrderCount += 1;
      if (!stats.lastOrderAt || String(receipt.receivedAt || "") > stats.lastOrderAt) {
        stats.lastOrderAt = receipt.receivedAt || null;
      }
      stats.observedPromoSavings = roundMoney(
        stats.observedPromoSavings + (number(receipt.promotionDiscount) || 0)
      );
      stats.uberCashUsed = roundMoney(
        stats.uberCashUsed + (number(receipt.uberCashUsed) || 0)
      );
    }

    const observed = number(receipt.promotionDiscount);
    const subtotal = number(receipt.subtotal);

    if (observed == null || observed <= 0 || subtotal == null || subtotal <= 0) continue;
    if (!receipt.accountRef) continue;

    const receiptTime = receipt.receivedAt ? new Date(receipt.receivedAt).getTime() : null;

    const candidates = tracked
      .filter(promo => promo.accountRef === receipt.accountRef)
      .filter(promo => promo.usesRemaining > 0)
      .filter(promo => {
        if (receiptTime == null || Number.isNaN(receiptTime)) return true;

        if (promo.receivedAt) {
          const promoTime = new Date(promo.receivedAt).getTime();
          if (!Number.isNaN(promoTime) && receiptTime + 60 * 60 * 1000 < promoTime) {
            return false;
          }
        }

        if (promo.expires) {
          const expiryTime = new Date(promo.expires + "T23:59:59").getTime();
          if (!Number.isNaN(expiryTime) && receiptTime > expiryTime) {
            return false;
          }
        }

        return true;
      })
      .map(promo => {
        const calculation = savingForSpend(promo, subtotal);
        if (!calculation.eligible || calculation.saving <= 0) return null;

        return {
          promo,
          expected: calculation.saving,
          difference: Math.abs(calculation.saving - observed)
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.difference - b.difference);

    if (!candidates.length) continue;

    const best = candidates[0];
    const second = candidates[1];
    const tolerance = Math.max(0.2, observed * 0.03);
    const uniqueEnough =
      !second ||
      second.difference > tolerance ||
      second.difference - best.difference >= 0.2;

    if (best.difference > tolerance || !uniqueEnough) {
      matches.push({
        receiptId: receipt.id || null,
        accountRef: receipt.accountRef,
        observedSaving: observed,
        status: "ambiguous"
      });
      continue;
    }

    best.promo.receiptConfirmedUses += 1;
    best.promo.usesRemaining = Math.max(0, best.promo.usesRemaining - 1);
    best.promo.receiptState = best.promo.usesRemaining === 0 ? "used" : "partial";
    best.promo.lastUsedAt = receipt.receivedAt || null;

    if (stats) stats.confirmedPromoUses += 1;

    matches.push({
      receiptId: receipt.id || null,
      accountRef: receipt.accountRef,
      observedSaving: observed,
      matchedPromoIndex: best.promo._receiptIndex,
      expectedSaving: best.expected,
      status: "confirmed"
    });
  }

  const publicPromos = tracked.map(promo => {
    const { _receiptIndex, ...safe } = promo;
    return safe;
  });

  const feeSamples = receipts
    .map(receipt => ({
      receipt,
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

  const accountInsights = [...accountStats.values()]
    .sort((a, b) => String(b.lastOrderAt || "").localeCompare(String(a.lastOrderAt || "")));

  return {
    promos: publicPromos,
    matches,
    publicInsights: {
      receiptCount: receipts.length,
      feeModel: {
        sampleSize: feeSamples.length,
        averageExtraOrderFees
      },
      accounts: accountInsights
    }
  };
}
