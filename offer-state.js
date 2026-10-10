import { expiryEndTime, applyOfferExpiryPolicy } from "./offer-time.js";
import { useCountNeedsReview } from './offer-details.js';

function timeOf(value) {
  if (!value) return null;
  const result = new Date(value).getTime();
  return Number.isNaN(result) ? null : result;
}

// Finished describes closure, never a claim that unused orders were redeemed.
export function offerFinishedReason(promo, now = new Date()) {
  const completion = classifyOfferCompletion(promo, now);
  return completion.consumed ? 'Fully consumed' : completion.finishedExpired || completion.expiredUnused ? 'Expired' : null;
}

export function offerClosureLabel(promo, now = new Date()) {
  const completion = classifyOfferCompletion(promo, now);
  if (completion.fullyUsed || completion.expiredUnused) return completion.displayStatus;
  const state = classifyOfferTrackingState(promo, { now, reviewReasons: promo.reviewReasons || [] });
  if (state.trackingState === 'used') return 'Finished · Usage needs checking';
  return null;
}

export function classifyOfferCompletion(promo = {}, now = new Date()) {
  const normalized = applyOfferExpiryPolicy(promo);
  const total = Math.max(1, Number(normalized.uses) || 1);
  const confirmed = Math.max(0, Number(normalized.receiptConfirmedUses) || 0);
  const end = expiryEndTime(normalized), nowTime = timeOf(now) ?? Date.now();
  const consumed = !useCountNeedsReview(normalized) && confirmed >= total;
  const expired = end != null && nowTime >= end;
  const finishedExpired = expired && confirmed > 0 && !consumed;
  const fullyUsed = consumed || finishedExpired;
  const state = classifyOfferTrackingState(normalized, { now, reviewReasons: normalized.reviewReasons || [] });
  return { fullyUsed, consumed, finishedExpired, expiredUnused: expired && confirmed === 0,
    partiallyUsed: !expired && !consumed && confirmed > 0 && state.trackingState === 'available',
    confirmedUses: confirmed, totalUses: total,
    displayStatus: consumed ? 'Completed · Verified' : finishedExpired ? 'Finished · Expired'
      : expired ? 'Expired · Unused' : state.trackingState === 'needs_checking' ? 'Needs checking'
      : confirmed > 0 ? 'Partially used' : 'Available' };
}

export function classifyOfferTrackingState(
  promo = {},
  {
    now = new Date(),
    reviewReasons = []
  } = {}
) {
  promo = applyOfferExpiryPolicy(promo);
  const total = Math.max(1, Number(promo.uses || 1));
  const remaining = Math.max(
    0,
    Number(
      promo.usesRemaining == null
        ? total
        : promo.usesRemaining
    )
  );

  const reasons = new Set(
    Array.isArray(reviewReasons) ? reviewReasons.filter(reason => reason && reason !== "unknown_expiry") : []
  );
  if (useCountNeedsReview(promo)) reasons.add('unverified_use_count');
  if (!['fixed', 'percent', 'uberCash'].includes(promo.discountType) ||
      !Number.isFinite(Number(promo.discount)) || Number(promo.discount) <= 0) {
    reasons.add('missing_discount_terms');
  }

  if (promo.receiptState === "used" || remaining <= 0) {
    return {
      trackingState: "used",
      needsReview: false,
      reviewReasons: [],
      closedReason: "uses_finished"
    };
  }

  const nowTime = timeOf(now) ?? Date.now();
  const expiryTime = expiryEndTime(promo);

  if (expiryTime != null && nowTime >= expiryTime) {
    return {
      trackingState: "expired",
      needsReview: reasons.size > 0,
      reviewReasons: [...reasons],
      closedReason: "expired"
    };
  }

  if (expiryTime == null || promo.expiryStatus === "unknown") {
    reasons.add("unknown_expiry");
  }

  if (reasons.size > 0) {
    return {
      trackingState: "needs_checking",
      needsReview: true,
      reviewReasons: [...reasons],
      closedReason: null
    };
  }

  return {
    trackingState: "available",
    needsReview: false,
    reviewReasons: [],
    closedReason: null
  };
}

export function applyOfferTrackingStates(
  promos = [],
  matches = [],
  { now = new Date() } = {}
) {
  const reasonsByOffer = new Map();

  function addReason(offerId, reason) {
    if (!offerId || !reason) return;
    if (!reasonsByOffer.has(offerId)) reasonsByOffer.set(offerId, new Set());
    reasonsByOffer.get(offerId).add(reason);
  }

  for (const match of matches || []) {
    if (match.status !== "ambiguous") continue;

    for (const offerId of match.candidateOfferIds || []) {
      addReason(offerId, "ambiguous_receipt_match");
    }
  }

  return promos.map(source => {
    const promo = applyOfferExpiryPolicy(source);
    const offerId = promo.offerId || promo.id || null;
    const state = classifyOfferTrackingState(promo, {
      now,
      reviewReasons: offerId
        ? [...(reasonsByOffer.get(offerId) || [])]
        : []
    });

    return {
      ...promo,
      ...state
    };
  });
}
