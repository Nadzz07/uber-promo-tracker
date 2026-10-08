import { offerTitle } from './offer-details.js';
export function publicOfferTitle(promo) {
  // Validate previously verified snapshots without rewriting historical data.
  if (!Object.hasOwn(promo, 'usesVerified') && !promo.evidence?.usesBasis) {
    return offerTitle({ ...promo, usesVerified: true });
  }
  return offerTitle(promo);
}

export function toPublicPromo(promo) {
  return {
    id: promo.id || promo.offerId || null,
    service: promo.service,
    offerType: promo.offerType || null,
    title: offerTitle(promo),
    discountType: promo.discountType,
    discount: promo.discount,
    maxSaving: promo.maxSaving,
    perUseCap: promo.perUseCap,
    uses: promo.uses,
    usesVerified: promo.evidence?.usesBasis === 'explicit_offer_terms',
    usesRemaining:
      promo.usesRemaining == null
        ? promo.uses
        : promo.usesRemaining,
    maxTotalSaving: promo.maxTotalSaving,
    minimumSpend: promo.minimumSpend,
    sameAccountOfferCount: promo.sameAccountOfferCount || 1,
    hasCode: Boolean(promo.code || promo.hasCode),
    expires: promo.expires,
    expiresAt: promo.expiresAt || null,
    expiryStatus: promo.expiryStatus || (promo.expires ? "exact" : "unknown"),
    expiryBasis: ["explicit_in_offer_terms", "weekday_from_email_date", "relative_to_email_date", "estimated_from_email_date", "tracker_35_day_rule"].includes(promo.expiryBasis)
      ? promo.expiryBasis : null,
    classificationConfidence: promo.classificationConfidence || null,
    expiryConfidence: promo.expiryConfidence || null,
    accountRef: promo.accountRef || null,
    accountMasked: promo.accountMasked || null,
    canLogin: Boolean(promo.canLogin),
    loginMethod: ["iCloud", "Google", "Both"].includes(promo.loginMethod)
      ? promo.loginMethod
      : null,
    hasCompanionOffer: Boolean(promo.hasCompanionOffer),
    receiptState: promo.receiptState || null,
    trackingState: promo.trackingState || null,
    needsReview: Boolean(promo.needsReview),
    reviewReasons: Array.isArray(promo.reviewReasons) ? promo.reviewReasons : [],
    closedReason: promo.closedReason || null,
    receiptConfirmedUses: Number(promo.receiptConfirmedUses || 0),
    lastUsedAt: promo.lastUsedAt || null,
    firstEmailSentAt: promo.firstEmailSentAt || promo.emailSentAt || null,
    emailSentAt: promo.emailSentAt || null
  };
}
