// Legacy snapshots did not distinguish an explicit count from a regex guess.
// Large legacy counts stay reviewable until the original message is reparsed.
export function useCountNeedsReview(promo = {}) {
  const uses = Number(promo.uses ?? 1);
  return !Number.isInteger(uses) || uses < 1 ||
    (uses > 10 && promo.usesVerified !== true && promo.evidence?.usesBasis !== 'explicit_offer_terms');
}

export function offerTitle(promo = {}) {
  const amount = Number(promo.discount);
  if (!Number.isFinite(amount) || amount <= 0) return 'Uber Eats offer';
  const value = promo.discountType === 'percent' ? amount + '% off'
    : '£' + amount + (promo.discountType === 'uberCash' ? ' Uber Cash' : ' off');
  if (useCountNeedsReview(promo)) return value + ' · order count needs checking';
  const uses = Number(promo.uses ?? 1);
  return value + (uses > 1 ? ' on ' + uses + ' orders' : '');
}
