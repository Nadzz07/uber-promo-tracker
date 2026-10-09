import { dedupeReceipts } from "./receipt-identity.js";
function number(value) {
  if (value == null || value === "") return 0;
  const result = Number(value);
  return Number.isFinite(result) ? Math.max(0, result) : 0;
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
    number(receipt.uberCashSavings) +
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
    number(receipt.uberCashSavings)
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
    uberCashConfirmedSavings: 0,
    uberOneConfirmedSavings: 0,
    otherConfirmedSavings: 0,
    confirmedSaved: 0,
    estimatedUberOneSavings: 0,
    estimatedTotalSaved: 0,
    lastOrderAt: null
  };
}

export function estimateReceiptSavings(receipts = [], { now = new Date(), service = "Uber Eats", estimateUberOne = true } = {}) {
  receipts = dedupeReceipts(receipts).filter(r => !r.service || r.service === service);
  const model = uberOneEstimateModel(estimateUberOne ? receipts : []);
  const byAccount = new Map();
  const summary = emptyStats();
  const recent = emptyStats();
  const nowTime = new Date(now).getTime();

  for (const receipt of receipts) {
    const promo = number(receipt.promotionDiscount);
    const cash = number(receipt.uberCashUsed);
    const uberOne = number(receipt.uberOneSavings);
    const cashSavings = number(receipt.uberCashSavings);
    const components = roundMoney(promo + cashSavings + uberOne);
    const confirmed = confirmedReceiptSaving(receipt);
    const otherConfirmed = roundMoney(Math.max(0, confirmed - components));
    const estimatedUberOne = missingUberOneEstimate(receipt, model);
    const estimatedTotal = roundMoney(confirmed + estimatedUberOne);
    const when = receipt.sentAt || receipt.receivedAt || null;

    const stats = receipt.accountRef
      ? (byAccount.get(receipt.accountRef) || emptyStats())
      : null;

    const time = new Date(when).getTime();
    const inRecent = Number.isFinite(time) && time <= nowTime && time >= nowTime - 30 * 86400000;
    for (const target of [summary, stats, inRecent ? recent : null].filter(Boolean)) {
      target.orderCount += 1;
      target.promoSavings += promo;
      target.uberCashUsed += cash;
      target.uberCashConfirmedSavings += cashSavings;
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

  for (const target of [summary, recent, ...byAccount.values()]) {
    for (const key of [
      "promoSavings",
      "uberCashUsed",
      "uberCashConfirmedSavings",
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
      recentDays: 30,
      recentOrders: recent.orderCount,
      recentConfirmedSaved: recent.confirmedSaved,
      recentEstimatedUberOneSavings: recent.estimatedUberOneSavings,
      recentEstimatedTotalSaved: recent.estimatedTotalSaved,
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
        confidence: model.confidence,
        status: model.sampleSize ? 'available' : 'insufficient_evidence',
        receiptsMentioningUberOne: receipts.filter(r=>r.uberOneSignal).length,
        explanation: model.sampleSize ? 'Conservative estimate learned from explicit Uber One receipt amounts. Already reported savings are not estimated again.' : 'Receipts do not separately state an Uber One saving or the undiscounted delivery and service fees. Combined savings remain in confirmed totals. A missing estimate does not mean no Uber One benefit.'
      }
    },
    byAccount
  };
}

// Transport receipt savings are confirmed only; the Eats Uber One model is not
// transferable to rides. Usage counters remain separate for the account rule.
export function combinedReceiptSavings(eats = [], rides = [], options = {}) {
  const food = estimateReceiptSavings(eats, options);
  const transport = estimateReceiptSavings(rides, { ...options, service: 'Uber', estimateUberOne: false });
  const fields = ['promoSavings', 'uberCashUsed', 'uberCashConfirmedSavings', 'uberOneConfirmedSavings', 'otherConfirmedSavings', 'confirmedSaved', 'estimatedTotalSaved'];
  const summary = { ...food.summary, eatsConfirmedSaved: food.summary.confirmedSaved, rideConfirmedSaved: transport.summary.confirmedSaved, trackedRides: transport.summary.orderCount };
  for (const field of fields) summary[field] = roundMoney(food.summary[field] + transport.summary[field]);
  summary.totalSaved = summary.confirmedSaved;
  summary.recentConfirmedSaved = roundMoney(food.summary.recentConfirmedSaved + transport.summary.recentConfirmedSaved);
  summary.recentEstimatedTotalSaved = roundMoney(food.summary.recentEstimatedTotalSaved + transport.summary.recentEstimatedTotalSaved);
  summary.recentRides = transport.summary.recentOrders;
  // Existing per-order average refers specifically to Eats orders.
  const byAccount = new Map([...food.byAccount].map(([ref, stats]) => [ref, { ...stats }]));
  for (const [ref, stats] of transport.byAccount) {
    const target = byAccount.get(ref) || emptyStats();
    target.rideConfirmedSaved = stats.confirmedSaved;
    for (const field of fields) target[field] = roundMoney(target[field] + stats[field]);
    byAccount.set(ref, target);
  }
  return { summary, byAccount };
}
