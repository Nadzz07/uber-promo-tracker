import { isOfferExpired } from './offer-time.js';
import { classifyOfferCompletion } from './offer-state.js';

// Explicit rotation status takes precedence over access. The fallback reads older
// snapshots; newly exported accounts always carry an explicit status.
export function accountArchived(account = {}) {
  if (account.deactivated || account.accountStatus === 'deactivated') return true;
  if (['active', 'archived'].includes(account.accountStatus)) return account.accountStatus === 'archived';
  if (typeof account.archived === 'boolean') return account.archived;
  return account.canLogin === false;
}

export function matchesAccountFilter(account, filter) {
  const used = accountUsage(account).accountUsed, archived = accountArchived(account);
  return ({ all: true, login: account.canLogin === true, locked: account.canLogin === false,
    used, 'used-login': used && account.canLogin === true, 'used-locked': used && account.canLogin === false,
    archived, 'archived-login': archived && account.canLogin === true,
    'archived-locked': archived && account.canLogin === false })[filter] ?? true;
}

// Account usage is lifetime receipt evidence, independent of any individual offer.
export function accountUsage(account = {}) {
  const eats = Math.max(0, Number(account.orderCount) || 0);
  const rides = Math.max(0, Number(account.rideCount) || 0);
  const used = eats >= 5 || (eats >= 1 && rides >= 1);
  return { accountUsed: used, partialUsage: !used && (eats > 0 || rides > 0), accountUsedReason: eats >= 5 ? 'five_eats_receipts' : used ? 'eats_and_ride_receipts' : null };
}

export function classifyAccount(account = {}, offers = [], now = Date.now()) {
  const usage = accountUsage(account);
  const archived = accountArchived(account);
  const available = offers.filter(p => p.trackingState === 'available');
  const review = offers.filter(p => p.trackingState === 'needs_checking');
  const expired = offers.filter(p => p.trackingState === 'expired' || p.closedReason === 'expired');
  const finished = offers.filter(p => classifyOfferCompletion(p, now).fullyUsed);
  const state = archived ? 'archived' : !account.canLogin ? 'inaccessible' : usage.accountUsed ? 'used' : available.length ? 'available' : review.length ? 'needs_checking' : offers.length && expired.length === offers.length ? 'expired' : offers.length && finished.length === offers.length ? 'fully_used' : 'no_offers';
  return { ...usage, archived, accountStatus: account.deactivated || account.accountStatus === 'deactivated' ? 'deactivated' : archived ? 'archived' : 'active', accountState: state, activePromoCount: available.length, reviewOfferCount: review.length,
    fullyUsedOfferCount: finished.length, expiredUnusedOfferCount: offers.filter(p => classifyOfferCompletion(p, now).expiredUnused).length,
    needsReview: state === 'needs_checking', recommendationEligible: state === 'available' };
}

export function accountStatusLabel(account) {
  if (account.deactivated) return 'Deactivated · can’t log in';
  return { archived: 'Archived · outside active rotation', inaccessible: 'Can’t log in', used: 'Used · receipt confirmed', available: 'Available', needs_checking: 'Offers need checking', expired: 'Offers expired', fully_used: 'Offers fully used', no_offers: 'No current offers' }[account.accountState] || 'No current offers';
}

export function accountUsageDescription(account = {}) {
  const usage = accountUsage(account);
  if (usage.accountUsedReason === 'five_eats_receipts') return 'Usage complete: five Eats receipts confirmed.';
  if (usage.accountUsed) return 'Usage complete: Eats and Ride receipts confirmed.';
  if (usage.partialUsage) return 'Partial usage: complete at five Eats receipts, or Eats plus a Ride receipt.';
  return 'No receipt usage recorded. Offer expiry is separate from account usage.';
}

// A started, still usable promo is independent of lifetime account receipt usage.
export function offerInProgress(promo = {}, now = Date.now()) {
  const total = Number(promo.uses || 1);
  const remaining = Number(promo.usesRemaining ?? total);
  return promo.service === 'Uber Eats' && promo.trackingState === 'available' &&
    !isOfferExpired(promo, now) && remaining > 0 && remaining < total;
}

export function accountUnfinished(account = {}, offers = account.promos || [], now = Date.now()) {
  return account.canLogin === true && !accountArchived(account) && offers.some(promo => offerInProgress(promo, now));
}

export function accountProgressDescription(account = {}) {
  const eats = Math.max(0, Number(account.orderCount) || 0);
  const rides = Math.max(0, Number(account.rideCount) || 0);
  if (account.canLogin === false) return 'Historical usage: ' + eats + ' Eats, ' + rides + (rides === 1 ? ' Ride.' : ' Rides.') + ' This account cannot be used because you can’t log in.';
  if (accountUsage(account).accountUsed) return accountUsageDescription(account) + (Number(account.activePromoCount || 0) > 0 ? ' ' + account.activePromoCount + (Number(account.activePromoCount) === 1 ? ' offer is still available.' : ' offers are still available.') : '');
  if (rides > 0) return 'Receipt progress · ' + eats + ' Eats, ' + rides + (rides===1 ? ' Ride.' : ' Rides.') + ' One Eats receipt will complete this account.';
  if (eats > 0) return 'Receipt progress · ' + eats + ' of 5 Eats. Needs a Ride or ' + (5 - eats) + ' more Eats ' + (5 - eats === 1 ? 'receipt.' : 'receipts.');
  return 'No receipt usage yet. Account completion needs five Eats, or Eats plus a Ride.';
}
