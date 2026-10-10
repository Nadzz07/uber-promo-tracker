// Legacy snapshots did not distinguish an explicit count from a regex guess.
// Large legacy counts stay reviewable until the original message is reparsed.
export function useCountNeedsReview(promo = {}) {
  const uses = Number(promo.uses ?? 1);
  return !Number.isInteger(uses) || uses < 1 ||
    (uses > 10 && promo.usesVerified !== true && promo.evidence?.usesBasis !== 'explicit_offer_terms');
}

export function offerTitle(promo = {}) {
  const amount = Number(promo.discount);
  if (!Number.isFinite(amount) || amount <= 0) return 'Promo terms need checking';
  const value = promo.discountType === 'percent' ? amount + '% off'
    : '£' + amount + (promo.discountType === 'uberCash' ? ' Uber Cash' : ' off');
  if (useCountNeedsReview(promo)) return value + ' · order count needs checking';
  const uses = Number(promo.uses ?? 1);
  return value + (uses > 1 ? ' on ' + uses + ' orders' : '');
}

// A derived percentage never changes the advertised title or discount type.
export function effectiveDiscountPercent(promo, spend) {
  const basket = Number(spend), amount = Number(promo.discount);
  if (!Number.isFinite(basket) || basket <= 0 || basket < Number(promo.minimumSpend || 0) || !Number.isFinite(amount) || amount <= 0 || !['fixed','percent'].includes(promo.discountType)) return null;
  let saving = promo.discountType === 'fixed' ? amount : basket * amount / 100;
  if (promo.discountType === 'percent' && (promo.perUseCap ?? promo.maxSaving) != null) saving = Math.min(saving, Number(promo.perUseCap ?? promo.maxSaving));
  return Math.round(Math.min(saving, basket) / basket * 10000) / 100;
}
