import { applyOfferExpiryPolicy, isOfferExpired } from './offer-time.js';
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
  const current = account.hasEligibleOffers ?? Number(account.activePromoCount) > 0;
  const visible = !used || current;
  return ({ all: visible, login: visible && account.canLogin === true, locked: visible && account.canLogin === false,
    pending: account.canLogin == null || account.accessStatus === 'pending',
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
  const available = offers.filter(p => offerEligible(p, now));
  const review = offers.filter(p => p.trackingState === 'needs_checking');
  const expired = offers.filter(p => p.trackingState === 'expired' || p.closedReason === 'expired');
  const finished = offers.filter(p => classifyOfferCompletion(p, now).fullyUsed);
  const state = archived ? 'archived' : account.accessStatus === 'pending' || account.canLogin == null ? 'pending_access' : !account.canLogin ? 'inaccessible' : usage.accountUsed ? 'used' : available.length ? 'available' : review.length ? 'needs_checking' : offers.length && expired.length === offers.length ? 'expired' : offers.length && finished.length === offers.length ? 'fully_used' : 'no_offers';
  return { ...usage, archived, accountStatus: account.deactivated || account.accountStatus === 'deactivated' ? 'deactivated' : archived ? 'archived' : 'active', accountState: state, activePromoCount: available.length, reviewOfferCount: review.length,
    fullyUsedOfferCount: finished.length, expiredUnusedOfferCount: offers.filter(p => classifyOfferCompletion(p, now).expiredUnused).length,
    hasEligibleOffers: available.length > 0,
    needsReview: state === 'needs_checking', recommendationEligible: account.canLogin === true && account.accessStatus !== 'pending' && !archived && available.length > 0 };
}

export function accountStatusLabel(account) {
  if (account.accessStatus === 'pending' || account.canLogin == null) return 'Login access pending verification';
  if (account.deactivated) return 'Deactivated · can’t log in';
  return { archived: 'Archived · outside active rotation', inaccessible: 'Can’t log in', used: 'Fully used account · receipt confirmed', available: 'Available', needs_checking: 'Offers need checking', expired: 'Offers expired', fully_used: 'Offers finished', no_offers: 'No current offers' }[account.accountState] || 'No current offers';
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
  if (account.canLogin === false) return 'Historical usage: ' + eats + ' Eats, ' + rides + ' Ride.' + ' This account cannot be used because you can’t log in.';
  if (accountUsage(account).accountUsed) return accountUsageDescription(account) + (Number(account.activePromoCount || 0) > 0 ? ' ' + account.activePromoCount + (Number(account.activePromoCount) === 1 ? ' offer is still available.' : ' offers are still available.') : '');
  if (rides > 0) return 'Receipt progress · ' + eats + ' Eats, ' + rides + ' Ride.' + ' One Eats receipt will complete this account.';
  if (eats > 0) return 'Receipt progress · ' + eats + ' of 5 Eats. Needs a Ride or ' + (5 - eats) + ' more Eats ' + (5 - eats === 1 ? 'receipt.' : 'receipts.');
  return 'No receipt usage yet. Account completion needs five Eats, or Eats plus a Ride.';
}

// Eligibility describes the offer evidence. Readiness describes account access.
// Recheck time even when a persisted tracking state has become stale.
export function offerEligible(promo = {}, now = Date.now()) {
  const scope = promo.offerScope || promo.evidence?.discountScope;
  return !promo.hiddenByPromoUse && !['product', 'uncertain'].includes(scope) && promo.trackingState === 'available' && promo.sourceEvidenceStatus !== 'missing' && promo.termsVerification !== 'needs_verification' && !promo.ignored && !promo.forceDone &&
    promo.receiptState !== 'used' && Number(promo.usesRemaining ?? promo.uses ?? 1) > 0 &&
    !isOfferExpired(applyOfferExpiryPolicy(promo), now) && !classifyOfferCompletion(promo, now).consumed;
}

export function eligibleAccountCounts(accounts = []) {
  let available = 0, ready = 0;
  for (const account of accounts) if (account.hasEligibleOffers ?? Number(account.activePromoCount) > 0) {
    available++;
    if (account.recommendationEligible) ready++;
  }
  return { available, ready, attention: available - ready };
}

export function matchesOfferScope(account, scope = 'ready') {
  if (!(account.hasEligibleOffers ?? Number(account.activePromoCount) > 0)) return false;
  return scope === 'all' || (scope === 'archived' ? accountArchived(account)
    : scope === 'attention' ? !account.recommendationEligible : account.recommendationEligible);
}

export function offerReadinessRank(account) {
  if (account.canLogin === true && account.accessStatus !== 'pending') return accountArchived(account) ? 1 : 0;
  return account.canLogin == null || account.accessStatus === 'pending' ? 2 : 3;
}

export function offerReadinessLabel(account) {
  const rank = offerReadinessRank(account);
  return rank === 0 ? (account.hasEligibleOffers ?? Number(account.activePromoCount) > 0) ? 'Ready to use · accessible' : 'Accessible · active rotation' : rank === 1 ? 'Accessible · archived'
    : rank === 2 ? 'Login access pending verification' : 'Can’t log in' + (accountArchived(account) ? ' · archived' : '');
}

// The directory and finder filter the same eligible offer projection. Provider
// membership is explicit metadata; an address domain never determines access.
export function accountOfferKey(promo = {}) {
  if (!['fixed', 'percent'].includes(promo.discountType) || !(Number(promo.discount) > 0)) return null;
  const minimum=Number(promo.minimumSpend), known=promo.minimumSpendVerified!==false&&promo.minimumSpend!=null&&Number.isFinite(minimum)&&(minimum>0||promo.minimumSpendVerified===true);
  return [promo.discountType, Number(promo.discount), known?Math.max(0,minimum):'unknown'].join(':');
}
export function accountOfferChoices(accounts = []) {
  const combinations = new Map();
  for (const account of accounts) for (const promo of account.promos || []) {
    const key = accountOfferKey(promo);
    if (key) combinations.set(key, {key, type:promo.discountType, discount:Number(promo.discount), minimum:key.endsWith(':unknown')?null:Math.max(0,Number(promo.minimumSpend))});
  }
  return [...combinations.values()].sort((a,b) => (a.minimum??0)-(b.minimum??0) || a.discount-b.discount || a.type.localeCompare(b.type));
}
export function accountMatchesOfferType(account, type = 'all') {
  const offers = account.promos || [], cash = offers.some(p => p.discountType === 'uberCash');
  return type === 'all' || (type === 'cash' ? cash : type === 'cash-promo' ? cash && offers.some(p => accountOfferKey(p)) : offers.some(p => accountOfferKey(p) === type));
}
export function accountMatchesLogin(account, login = 'all') {
  return login === 'all' || (login === 'login' ? account.canLogin === true && account.accessStatus !== 'pending' : account.canLogin === false && account.accessStatus !== 'pending');
}
export function accountMatchesProvider(account, provider = 'all') {
  const methods=new Set([...(Array.isArray(account.loginMethods)?account.loginMethods:[]),account.loginMethod]);
  if(methods.has('Both')){methods.add('iCloud');methods.add('Google');}
  return provider === 'all' || (Array.isArray(provider)?provider:[provider]).some(p=>methods.has(p));
}
