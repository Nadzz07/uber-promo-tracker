// Account usage is lifetime receipt evidence, independent of any individual offer.
export function accountUsage(account = {}) {
  const eats = Math.max(0, Number(account.orderCount) || 0);
  const rides = Math.max(0, Number(account.rideCount) || 0);
  const used = eats >= 5 || (eats >= 1 && rides >= 1);
  return { accountUsed: used, accountUsedReason: eats >= 5 ? 'five_eats_receipts' : used ? 'eats_and_ride_receipts' : null };
}

export function classifyAccount(account = {}, offers = []) {
  const usage = accountUsage(account);
  const available = offers.filter(p => p.trackingState === 'available');
  const review = offers.filter(p => p.trackingState === 'needs_checking');
  const expired = offers.filter(p => p.trackingState === 'expired' || p.closedReason === 'expired');
  const finished = offers.filter(p => p.closedReason === 'uses_finished' || (p.trackingState === 'used' && p.closedReason !== 'expired'));
  const state = !account.canLogin ? 'archived' : usage.accountUsed ? 'used' : available.length ? 'available' : review.length ? 'needs_checking' : offers.length && expired.length === offers.length ? 'expired' : finished.length ? 'fully_used' : 'no_offers';
  return { ...usage, accountState: state, activePromoCount: available.length, reviewOfferCount: review.length,
    needsReview: state === 'needs_checking', recommendationEligible: state === 'available' };
}

export function accountStatusLabel(account) {
  return { archived: 'Archived', used: 'Used · receipt confirmed', available: 'Available', needs_checking: 'Offers need checking', expired: 'Offers expired', fully_used: 'Offers fully used', no_offers: 'No current offers' }[account.accountState] || 'No current offers';
}
