import assert from 'node:assert/strict';
import { parseUberPromoV2 } from './parser-v2/parser.js';
import { classifyOfferTrackingState } from './offer-state.js';
import { applyOfferExpiryPolicy } from './offer-time.js';
import { confirmedReceiptSaving } from './savings-intelligence.js';

const base = {
  sender: 'Uber Eats <offers@uber.com>',
  recipient: 'sample@example.com',
  sentAt: '2026-09-16T13:25:00Z',
  receivedAt: '2026-09-16T13:25:10Z'
};
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('✓ ' + name); }

test('food Cash remains an Eats offer when a membership upsell follows it', () => {
  const p = parseUberPromoV2({ ...base,
    subject: 'You have £12 in Uber Cash',
    body: 'Use your £12 in Uber Cash for an Uber Eats order. Try Uber One for savings on rides and deliveries.'
  });
  assert.equal(p.isPromo, true);
  assert.equal(p.service, 'Uber Eats');
  assert.equal(p.offerType, 'uber_cash');
  assert.equal(p.discount, 12);
});

test('ride-only Cash remains separate from food offers despite a membership footer', () => {
  const p = parseUberPromoV2({ ...base,
    subject: '£12 in Uber Cash for your next ride',
    body: 'Use £12 in Uber Cash on your next trip. Try Uber One for Uber Eats deliveries.'
  });
  assert.equal(p.isPromo, true);
  assert.equal(p.service, 'Uber');
});

test('unspecified Cash cannot invent a food entitlement', () => {
  const p = parseUberPromoV2({ ...base, sender: 'Uber <offers@uber.com>', subject: 'You have £12 in Uber Cash', body: 'You have £12 in Uber Cash waiting in your account.' });
  assert.equal(p.service, 'Uber');
  assert.equal(p.discount, 12);
});

test('membership trials remain subscription offers', () => {
  const p = parseUberPromoV2({ ...base, subject: 'Try Uber One free', body: 'Enjoy a free Uber One trial for one month. Save on eligible deliveries.' });
  assert.equal(p.isPromo, true);
  assert.equal(p.service, 'Uber One');
});

test('ordinary wallet purchases, top-ups and earned credits do not publish as promos', () => {
  for (const subject of ['You purchased £50 in Uber Cash', 'You topped up £20 in Uber Cash', 'You earned £3 in Uber Cash']) {
    const p = parseUberPromoV2({ ...base, subject, body: 'Your account has been updated.' });
    assert.equal(p.isPromo, false);
    assert.equal(p.rejectionReason, 'cash_balance_not_promo');
  }
});

test('conditional referral or future earning is not a ready Cash offer', () => {
  for (const subject of ['Earn £10 in Uber Cash when you refer a friend', 'Invite a friend to get £10 in Uber Cash']) {
    const p = parseUberPromoV2({ ...base, subject, body: 'Receive the reward after your friend completes a trip.' });
    assert.equal(p.isPromo, false);
    assert.equal(p.rejectionReason, 'cash_requires_action');
  }
});

test('legal purchase and reward wording does not suppress a genuine food Cash offer', () => {
  const p = parseUberPromoV2({ ...base, subject: 'You have £12 in Uber Cash',
    body: 'Use £12 in Uber Cash on an Uber Eats order. Promotional credit expires on 30 September 2026. Legal terms: purchased Cash is separate; earn rewards with Uber One.' });
  assert.equal(p.isPromo, true);
  assert.equal(p.service, 'Uber Eats');
  assert.equal(p.expires, '2026-09-30');
});

test('untrusted senders cannot make credited Cash into an offer', () => {
  const p = parseUberPromoV2({ ...base, sender: 'Uber Eats <offers@example.com>', subject: 'You have £12 in Uber Cash', body: 'Use it for an Uber Eats order.' });
  assert.equal(p.isPromo, false);
  assert.equal(p.rejectionReason, 'sender_not_uber');
});

test('account-applied duration does not fabricate the actual grant date', () => {
  const p = parseUberPromoV2({ ...base, subject: 'You have £12 in Uber Cash',
    body: "Use it for an Uber Eats order. Uber Cash is valid for 35 days since it was applied to the user's account." });
  assert.equal(p.expiryStatus, 'unknown');
  assert.equal(p.expiresAt, null);
  const current = { ...p, firstEmailSentAt: base.sentAt };
  const state = classifyOfferTrackingState(current, { now: new Date('2026-10-08T20:00:00Z') });
  assert.equal(state.trackingState, 'available');
  assert.equal(applyOfferExpiryPolicy(current).expiryBasis, 'tracker_35_day_rule');
  const reminder = { ...current, emailSentAt: '2026-10-08T12:00:00Z' };
  assert.equal(applyOfferExpiryPolicy(reminder).expiresAt, applyOfferExpiryPolicy(current).expiresAt);
  assert.equal(classifyOfferTrackingState(reminder, { now: new Date('2026-10-23T00:00:00Z') }).trackingState, 'expired');
});

test('Cash payment and an advertised amount do not increase confirmed receipt savings', () => {
  assert.equal(confirmedReceiptSaving({ uberCashUsed: 12 }), 0);
  assert.equal(confirmedReceiptSaving({ uberCashUsed: 12, promotionDiscount: 5, reportedSavings: 5 }), 5);
  assert.equal(confirmedReceiptSaving({ uberCashUsed: 12, uberCashSavings: 3, promotionDiscount: 5, reportedSavings: 8 }), 8);
});
console.log(`\n${passed} Cash regression groups passed.`);
