export function toPublicPromo(promo) {
  return {
    service: promo.service,
    title: promo.title,
    discountType: promo.discountType,
    discount: promo.discount,
    maxSaving: promo.maxSaving,
    perUseCap: promo.perUseCap,
    uses: promo.uses,
    maxTotalSaving: promo.maxTotalSaving,
    minimumSpend: promo.minimumSpend,
    sameAccountOfferCount: promo.sameAccountOfferCount || 1,
    hasCode: Boolean(promo.code),
    expires: promo.expires,
    expiryBasis: promo.expiryBasis,
    accountRef: promo.accountRef || null,
    hasCompanionOffer: Boolean(promo.hasCompanionOffer)
  };
}
