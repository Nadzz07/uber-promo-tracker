import { expiryEndTime, applyOfferExpiryPolicy } from "./offer-time.js";
import { useCountNeedsReview } from './offer-details.js';

function timeOf(value) {
  if (!value) return null;
  const result = new Date(value).getTime();
  return Number.isNaN(result) ? null : result;
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
      needsReview: false,
      reviewReasons: [],
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
