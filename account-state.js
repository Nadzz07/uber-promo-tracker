// Account usage is lifetime receipt evidence, independent of any individual offer.
export function accountUsage(account = {}) {
  const eats = Math.max(0, Number(account.orderCount) || 0);
  const rides = Math.max(0, Number(account.rideCount) || 0);
  const used = eats >= 5 || (eats >= 1 && rides >= 1);
  return { accountUsed: used, partialUsage: !used && (eats > 0 || rides > 0), accountUsedReason: eats >= 5 ? 'five_eats_receipts' : used ? 'eats_and_ride_receipts' : null };
}

export function classifyAccount(account = {}, offers = []) {
  const usage = accountUsage(account);
  const available = offers.filter(p => p.trackingState === 'available');
  const review = offers.filter(p => p.trackingState === 'needs_checking');
  const expired = offers.filter(p => p.trackingState === 'expired' || p.closedReason === 'expired');
  const finished = offers.filter(p => p.closedReason === 'uses_finished' || (p.trackingState === 'used' && p.closedReason !== 'expired'));
  const state = !account.canLogin ? 'archived' : usage.accountUsed ? 'used' : available.length ? 'available' : review.length ? 'needs_checking' : offers.length && expired.length === offers.length ? 'expired' : offers.length && finished.length === offers.length ? 'fully_used' : 'no_offers';
  return { ...usage, accountState: state, activePromoCount: available.length, reviewOfferCount: review.length,
    needsReview: state === 'needs_checking', recommendationEligible: state === 'available' };
}

export function accountStatusLabel(account) {
  return { archived: 'Archived', used: 'Used · receipt confirmed', available: 'Available', needs_checking: 'Offers need checking', expired: 'Offers expired', fully_used: 'Offers fully used', no_offers: 'No current offers' }[account.accountState] || 'No current offers';
}

export function accountUsageDescription(account = {}) {
  const usage = accountUsage(account);
  if (usage.accountUsedReason === 'five_eats_receipts') return 'Usage complete: five Eats receipts confirmed.';
  if (usage.accountUsed) return 'Usage complete: Eats and ride/bike receipts confirmed.';
  if (usage.partialUsage) return 'Partial usage: complete at five Eats receipts, or Eats plus a ride/bike receipt.';
  return 'No receipt usage recorded. Offer expiry is separate from account usage.';
}

// Receipt completion and remaining offers are separate reasons to keep an account visible.
export function accountUnfinished(account = {}) {
  return account.canLogin === true && (!accountUsage(account).accountUsed || Number(account.activePromoCount || 0) > 0);
}

export function accountProgressDescription(account = {}) {
  const eats = Math.max(0, Number(account.orderCount) || 0);
  const rides = Math.max(0, Number(account.rideCount) || 0);
  if (accountUsage(account).accountUsed) return accountUsageDescription(account) + (Number(account.activePromoCount || 0) > 0 ? ' ' + account.activePromoCount + (Number(account.activePromoCount) === 1 ? ' offer is still available.' : ' offers are still available.') : '');
  if (rides > 0) return 'Not finished · ' + eats + ' Eats, ' + rides + ' ride/bike. One Eats receipt will complete this account.';
  if (eats > 0) return 'Not finished · ' + eats + ' of 5 Eats. Needs a ride/bike or ' + (5 - eats) + ' more Eats ' + (5 - eats === 1 ? 'receipt.' : 'receipts.');
  return 'Not started · needs five Eats, or one Eats plus one ride/bike.';
}
