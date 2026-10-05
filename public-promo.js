export function toPublicPromo(promo) {
  return {
    id: promo.id || promo.offerId || null,
    service: promo.service,
    offerType: promo.offerType || null,
    title: promo.title,
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
    expiryStatus: promo.expiryStatus || (promo.expires ? "exact" : "unknown"),
    expiryBasis: promo.expiryBasis || null,
    classificationConfidence: promo.classificationConfidence || null,
    expiryConfidence: promo.expiryConfidence || null,
    accountRef: promo.accountRef || null,
    accountMasked: promo.accountMasked || null,
    canLogin: Boolean(promo.canLogin),
    hasCompanionOffer: Boolean(promo.hasCompanionOffer),
    receiptState: promo.receiptState || null,
    receiptConfirmedUses: Number(promo.receiptConfirmedUses || 0),
    lastUsedAt: promo.lastUsedAt || null,
    emailSentAt: promo.emailSentAt || null
  };
}
