export function toPublicPromo(promo) {
  return {
    service: promo.service,
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
    hasCode: Boolean(promo.code),
    expires: promo.expires,
    expiryBasis: promo.expiryBasis,
    accountRef: promo.accountRef || null,
    accountMasked: promo.accountMasked || null,
    hasCompanionOffer: Boolean(promo.hasCompanionOffer),
    receiptState: promo.receiptState || null,
    receiptConfirmedUses: Number(promo.receiptConfirmedUses || 0),
    lastUsedAt: promo.lastUsedAt || null
  };
}
