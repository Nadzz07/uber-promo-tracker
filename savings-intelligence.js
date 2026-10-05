function number(value) {
  if (value == null || value === "") return 0;
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function median(values) {
  const sorted = values
    .map(Number)
    .filter(value => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);

  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function observedComponents(receipt) {
  return roundMoney(
    number(receipt.promotionDiscount) +
    number(receipt.uberCashUsed) +
    number(receipt.uberOneSavings)
  );
}

export function confirmedReceiptSaving(receipt = {}) {
  return roundMoney(
    Math.max(
      observedComponents(receipt),
      number(receipt.reportedSavings)
    )
  );
}

function uberOneEstimateModel(receipts = []) {
  const explicit = receipts
    .map(receipt => number(receipt.uberOneSavings))
    .filter(value => value > 0);

  if (!explicit.length) {
    return {
      sampleSize: 0,
      baselinePerEligibleOrder: 0,
      confidence: "none"
    };
  }

  const observedMedian = median(explicit);
  const confidence = explicit.length >= 3 ? "strong" : "limited";

  // Be deliberately conservative until there are enough explicit receipt samples.
  const discountedMedian = explicit.length >= 3
    ? observedMedian
    : observedMedian * 0.75;

  return {
    sampleSize: explicit.length,
    baselinePerEligibleOrder: roundMoney(Math.min(discountedMedian, 6)),
    confidence
  };
}

function missingUberOneEstimate(receipt, model) {
  if (!receipt.uberOneSignal) return 0;
  if (number(receipt.uberOneSavings) > 0) return 0;
  if (model.baselinePerEligibleOrder <= 0) return 0;

  const promoAndCash = roundMoney(
    number(receipt.promotionDiscount) +
    number(receipt.uberCashUsed)
  );

  // If Uber already reports extra savings beyond promo/cash, count that as
  // confirmed instead of adding another estimated Uber One amount.
  if (number(receipt.reportedSavings) > promoAndCash + 0.01) return 0;

  const subtotal = number(receipt.subtotal);
  const subtotalCap = subtotal > 0 ? subtotal * 0.25 : model.baselinePerEligibleOrder;

  return roundMoney(
    Math.max(
      0,
      Math.min(model.baselinePerEligibleOrder, subtotalCap, 6)
    )
  );
}

function emptyStats() {
  return {
    orderCount: 0,
    promoSavings: 0,
    uberCashUsed: 0,
    uberOneConfirmedSavings: 0,
    otherConfirmedSavings: 0,
    confirmedSaved: 0,
    estimatedUberOneSavings: 0,
    estimatedTotalSaved: 0,
    lastOrderAt: null
  };
}

export function estimateReceiptSavings(receipts = []) {
  const model = uberOneEstimateModel(receipts);
  const byAccount = new Map();
  const summary = emptyStats();

  for (const receipt of receipts) {
    const promo = number(receipt.promotionDiscount);
    const cash = number(receipt.uberCashUsed);
    const uberOne = number(receipt.uberOneSavings);
    const components = roundMoney(promo + cash + uberOne);
    const confirmed = confirmedReceiptSaving(receipt);
    const otherConfirmed = roundMoney(Math.max(0, confirmed - components));
    const estimatedUberOne = missingUberOneEstimate(receipt, model);
    const estimatedTotal = roundMoney(confirmed + estimatedUberOne);
    const when = receipt.sentAt || receipt.receivedAt || null;

    const stats = receipt.accountRef
      ? (byAccount.get(receipt.accountRef) || emptyStats())
      : null;

    for (const target of [summary, stats].filter(Boolean)) {
      target.orderCount += 1;
      target.promoSavings += promo;
      target.uberCashUsed += cash;
      target.uberOneConfirmedSavings += uberOne;
      target.otherConfirmedSavings += otherConfirmed;
      target.confirmedSaved += confirmed;
      target.estimatedUberOneSavings += estimatedUberOne;
      target.estimatedTotalSaved += estimatedTotal;

      if (!target.lastOrderAt || String(when || "") > target.lastOrderAt) {
        target.lastOrderAt = when;
      }
    }

    if (stats) byAccount.set(receipt.accountRef, stats);
  }

  for (const target of [summary, ...byAccount.values()]) {
    for (const key of [
      "promoSavings",
      "uberCashUsed",
      "uberOneConfirmedSavings",
      "otherConfirmedSavings",
      "confirmedSaved",
      "estimatedUberOneSavings",
      "estimatedTotalSaved"
    ]) {
      target[key] = roundMoney(target[key]);
    }
  }

  return {
    model,
    summary: {
      ...summary,
      trackedOrders: summary.orderCount,
      totalSaved: summary.confirmedSaved,
      averageSavedPerOrder: summary.orderCount
        ? roundMoney(summary.confirmedSaved / summary.orderCount)
        : 0,
      estimatedAverageSavedPerOrder: summary.orderCount
        ? roundMoney(summary.estimatedTotalSaved / summary.orderCount)
        : 0,
      uberOneEstimateModel: {
        sampleSize: model.sampleSize,
        baselinePerEligibleOrder: model.baselinePerEligibleOrder,
        confidence: model.confidence
      }
    },
    byAccount
  };
}
