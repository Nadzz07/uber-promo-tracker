export function publicOfferTitle(promo) {
  const amount = Number(promo.discount);
  if (!Number.isFinite(amount) || amount <= 0) return "Uber Eats offer";
  const value = promo.discountType === "percent" ? amount + "% off"
    : "£" + amount + (promo.discountType === "uberCash" ? " Uber Cash" : " off");
  const uses = Number(promo.uses || 1);
  return value + (uses > 1 ? " on " + uses + " orders" : "");
}

export function toPublicPromo(promo) {
  return {
    id: promo.id || promo.offerId || null,
    service: promo.service,
    offerType: promo.offerType || null,
    title: publicOfferTitle(promo),
    discountType: promo.discountType,
    discount: promo.discount,
    maxSaving: promo.maxSaving,
    perUseCap: promo.perUseCap,
    uses: promo.uses,
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
