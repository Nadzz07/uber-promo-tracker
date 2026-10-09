import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { extractOfferDetails } from './parser-v2/discount.js';
import { offerTitle, useCountNeedsReview } from './offer-details.js';
import { classifyOfferTrackingState } from './offer-state.js';
import { toPublicPromo } from './public-promo.js';
import { normaliseColour, themeTokens, colourHsl, hslColour, DEFAULT_COLOUR, normaliseLayout, resolveLayout } from './appearance.js';
import { parseDeviceAccounts, deviceEmail, DEVICE_ACCOUNTS_KIND } from './device-accounts.js';
import { openPrivateDb, ensureAccount, upsertOffer, getOffers } from './private-db.js';
import { offerFingerprint } from './identity.js';
import { parseUberPromo } from './parser.js';
import { accountUnfinished, accountProgressDescription } from './account-state.js';

const time = '2026-10-08T12:00:00Z';
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('✓ ' + name); }

test('Layout selection overrides screen size while Auto follows the responsive boundary', () => {
  for (const value of [null, undefined, '', 'other', 'AUTO', '<script>']) assert.equal(normaliseLayout(value), 'auto');
  assert.equal(normaliseLayout('mobile'), 'mobile'); assert.equal(normaliseLayout('desktop'), 'desktop');
  assert.equal(resolveLayout('auto', 979), 'mobile'); assert.equal(resolveLayout('auto', 980), 'desktop');
  assert.equal(resolveLayout('mobile', 1920), 'mobile'); assert.equal(resolveLayout('desktop', 320), 'desktop');
});

test('Unfinished follows account receipt completion, including one use left, no offers and expired offers', () => {
  for (const account of [
    { canLogin: true, orderCount: 0, rideCount: 0 },
    { canLogin: true, orderCount: 4, rideCount: 0, usesRemaining: 1 },
    { canLogin: true, orderCount: 0, rideCount: 1, accountState: 'expired' },
    { canLogin: true, orderCount: 2, rideCount: 0, accountState: 'fully_used' },
    { canLogin: true, orderCount: 4, rideCount: 1, activePromoCount: 1, usesRemaining: 1 },
    { canLogin: true, orderCount: 5, rideCount: 0, activePromoCount: 1 }
  ]) assert.equal(accountUnfinished(account), true);
  for (const account of [
    { canLogin: false, orderCount: 0, rideCount: 0 },
    { canLogin: true, orderCount: 5, rideCount: 0 },
    { canLogin: true, orderCount: 1, rideCount: 1 }
  ]) assert.equal(accountUnfinished(account), false);
  assert.match(accountProgressDescription({orderCount:4,rideCount:0}), /4 of 5 Eats.*1 more Eats receipt/);
  assert.match(accountProgressDescription({orderCount:0,rideCount:1}), /One Eats receipt/);
  assert.match(accountProgressDescription({orderCount:4,rideCount:1,activePromoCount:1}), /Usage complete.*1 offer is still available/);
});

test('Order counts require explicit offer wording and cannot come from a year, ID or footer', () => {
  for (const text of ['£15 off. © 1996 orders fulfilled.', '£15 off. © 2026 orders fulfilled.', '£15 off. Reference 12345696 orders.', '£15 off. Members completed 96 orders.']) {
    const parsed = extractOfferDetails(text);
    assert.equal(parsed.uses, 1, text); assert.equal(parsed.evidence.uses, null);
    assert.equal(parsed.evidence.usesBasis, 'single_use_default');
  }
  for (const text of ['£15 off your first 5 orders', '£15 off on 5 orders', '£15 off valid for 5 eligible orders', '£15 off 5 orders']) {
    const parsed = extractOfferDetails(text);
    assert.equal(parsed.uses, 5); assert.equal(parsed.maxTotalSaving, 75);
    assert.equal(parsed.evidence.usesBasis, 'explicit_offer_terms');
  }
  // A genuine explicit large count is preserved, never truncated to its last digits.
  assert.equal(extractOfferDetails('£2 off your next 196 orders').uses, 196);
});

test('Unverified legacy 96-use offers stay out of recommendations and retain their original evidence', () => {
  const bad = { service: 'Uber Eats', discountType: 'fixed', discount: 15, uses: 96, usesRemaining: 96, emailSentAt: time };
  assert.equal(useCountNeedsReview(bad), true);
  assert.equal(classifyOfferTrackingState(bad, { now: time }).trackingState, 'needs_checking');
  assert.equal(offerTitle(bad), '£15 off · order count needs checking');
  const projected = toPublicPromo(bad);
  assert.equal(projected.uses, 96); assert.equal(projected.usesVerified, false);
  assert.equal(projected.title, '£15 off · order count needs checking');
  const verified = { ...bad, evidence: { usesBasis: 'explicit_offer_terms' } };
  assert.equal(classifyOfferTrackingState(verified, { now: time }).trackingState, 'available');
  assert.equal(toPublicPromo(verified).usesVerified, true);
  assert.equal(offerTitle(verified), '£15 off on 96 orders');
});

test('Reparsing changed terms supersedes the old fingerprint without deleting history or resetting the first offer date', () => {
  const db = openPrivateDb(':memory:');
  try {
    const account = ensureAccount(db, { alias: 'alpha@example.invalid', seenAt: time, kind: 'promo' });
    const original = { accountRef: account.accountRef, messageKey: 'msg-one', emailSentAt: '2026-10-01T12:00:00Z', service: 'Uber Eats', discountType: 'fixed', discount: 15, uses: 96, observedLive: true };
    original.offerId = offerFingerprint(original); upsertOffer(db, original, time);
    // The retained source is a reminder for a campaign first seen in September.
    db.prepare('UPDATE offers SET first_sent_at = ? WHERE offer_id = ?').run('2026-09-10T12:00:00Z', original.offerId);
    const corrected = { ...original, uses: 5, evidence: { usesBasis: 'explicit_offer_terms' } };
    corrected.offerId = offerFingerprint(corrected); upsertOffer(db, corrected, time); upsertOffer(db, corrected, time);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM offers').get().n, 2);
    assert.equal(db.prepare('SELECT status FROM offers WHERE offer_id = ?').get(original.offerId).status, 'parser_superseded');
    for (const includeHistorical of [false, true]) {
      const offers = getOffers(db, { includeHistorical });
      assert.equal(offers.length, 1); assert.equal(offers[0].uses, 5);
      assert.equal(offers[0].firstEmailSentAt, '2026-09-10T12:00:00Z');
    }
    const other = { ...original, messageKey: 'msg-unrelated', uses: 3 };
    other.offerId = offerFingerprint(other); upsertOffer(db, other, time);
    assert.equal(getOffers(db).length, 2, 'An unrelated source must remain a separate offer');
  } finally { db.close(); }
});

test('A corrected primary discount cannot inherit an unrelated footer family clock', () => {
  const db = openPrivateDb(':memory:');
  try {
    const a = ensureAccount(db, {alias:'alpha@example.invalid',seenAt:time,kind:'promo'});
    const old = {accountRef:a.accountRef,messageKey:'msg-primary',service:'Uber One',discountType:'percent',discount:3,uses:1,emailSentAt:'2026-10-04T12:00:00Z',observedLive:true};
    old.offerId=offerFingerprint(old);upsertOffer(db,old,time);
    db.prepare('UPDATE offers SET first_sent_at = ? WHERE offer_id = ?').run('2026-04-05T12:00:00Z',old.offerId);
    const primary={...old,service:'Uber Eats',discountType:'fixed',discount:5};
    primary.offerId=offerFingerprint(primary);upsertOffer(db,primary,time);
    assert.equal(db.prepare('SELECT first_sent_at FROM offers WHERE offer_id = ?').get(primary.offerId).first_sent_at,'2026-10-04T12:00:00Z');
    const earlier={...primary,messageKey:'msg-first-primary',emailSentAt:'2026-10-01T12:00:00Z'};
    upsertOffer(db,earlier,time);upsertOffer(db,{...primary,emailSentAt:'2026-10-06T12:00:00Z'},time);
    assert.equal(db.prepare('SELECT first_sent_at FROM offers WHERE offer_id = ?').get(primary.offerId).first_sent_at,'2026-10-01T12:00:00Z');
    assert.equal(db.prepare('SELECT status FROM offers WHERE offer_id = ?').get(old.offerId).status,'parser_superseded');
    const changedValue={...primary,discount:12};changedValue.offerId=offerFingerprint(changedValue);upsertOffer(db,changedValue,time);
    assert.equal(db.prepare('SELECT first_sent_at FROM offers WHERE offer_id = ?').get(changedValue.offerId).first_sent_at,'2026-10-04T12:00:00Z');
  } finally {db.close();}
});

test('Colour selections preserve valid colours, round trip HSL and keep all accents readable on dark glass', () => {
  assert.equal(normaliseColour('#FF00cc'), '#ff00cc');
  for (const input of ['red', '#123', 'url(evil)', '#zzzzzz']) assert.equal(normaliseColour(input), DEFAULT_COLOUR);
  for (const input of ['#000000', '#0000ff', '#ffffff', '#123456', DEFAULT_COLOUR]) {
    const hsl = colourHsl(input); assert.equal(hslColour(hsl.hue, hsl.saturation, hsl.lightness), input);
    const rgb = themeTokens(input).rgb.split(',').map(Number);
    const luminance = values => values.map(v => v/255 <= .04045 ? v/255/12.92 : ((v/255+.055)/1.055)**2.4).reduce((s,v,i) => s+v*[.2126,.7152,.0722][i],0);
    assert.ok((luminance(rgb)+.05)/(luminance([12,19,17])+.05) >= 7);
  }
});

const account = { accountRef: 'A001', accountMasked: 'a…a@example.invalid' };
const file = { schemaVersion: 1, kind: DEVICE_ACCOUNTS_KIND, accounts: [{ ...account, email: 'alpha@example.invalid' }] };
test('Marketing without usable promo terms stays private and unpriced reminders cannot become available deals', () => {
  const source = { subject: 'Discover restaurants with Uber Eats', body: 'Order dinner today. Browse the latest offer in the app.', sender: 'Uber <noreply@uber.com>', recipient: 'alpha@example.invalid', sentAt: time };
  const marketing = parseUberPromo(source);
  assert.equal(marketing.isPromo, false);
  assert.equal(marketing.rejectionReason, 'no_usable_promo_terms');
  const actual = parseUberPromo({ ...source, body: 'Get £12 off on 5 orders over £15.' });
  assert.equal(actual.isPromo, true); assert.equal(actual.discount, 12); assert.equal(actual.uses, 5);
  const reminder = parseUberPromo({ ...source, body: 'Reminder: you still have a promo waiting in your account.' });
  assert.equal(reminder.isPromo, true);
  const state = classifyOfferTrackingState({ ...reminder, emailSentAt: time }, { now: time });
  assert.equal(state.trackingState, 'needs_checking');
  assert.ok(state.reviewReasons.includes('missing_discount_terms'));
  assert.equal(offerTitle(reminder), 'Promo terms need checking');
});
test('Device emails match stable references and masks; stale, duplicate and invalid exports cannot invent identities', () => {
  const mapping = parseDeviceAccounts(file, [account]);
  assert.equal(deviceEmail(mapping, account), 'alpha@example.invalid');
  assert.equal(deviceEmail(mapping, { ...account, accountMasked: 'be…ta@example.invalid' }), null);
  assert.throws(() => parseDeviceAccounts({ ...file, accounts: [...file.accounts, ...file.accounts] }, [account]));
  assert.throws(() => parseDeviceAccounts({ ...file, accounts: [{ ...file.accounts[0], email: '<script>@example.invalid' }] }, [account]));
  assert.throws(() => parseDeviceAccounts({ ...file, accounts: [{ ...file.accounts[0], email: 'different@example.invalid' }] }, [account]));
  assert.throws(() => parseDeviceAccounts(file, [{ ...account, accountMasked: 'be…ta@example.invalid' }]));
  const extra = { accountRef: 'removed', accountMasked: 'de…ed@example.invalid', email: 'deleted@example.invalid' };
  assert.equal(Object.keys(parseDeviceAccounts({ ...file, accounts: [...file.accounts, extra] }, [account])).length, 1);
  assert.throws(() => parseDeviceAccounts(file, []));
});

test('Private device export reads the database without changing it, creates an owner-only ignored file and never overwrites exports', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-ui-'));
  try {
    const source = path.join(temp, 'source.local.db'), output = path.join(temp, 'device-accounts.local.json');
    const db = openPrivateDb(source); ensureAccount(db, { alias: 'alpha@example.invalid', seenAt: time, kind: 'promo' }); db.close();
    const hash = () => createHash('sha256').update(fs.readFileSync(source)).digest('hex');
    const before = hash();
    execFileSync(process.execPath, ['mac/export-device-accounts.js', '--db', source, '--output', output], { stdio: 'pipe' });
    assert.equal(hash(), before);
    assert.equal(fs.statSync(output).mode & 0o777, 0o600);
    const exported = JSON.parse(fs.readFileSync(output));
    assert.equal(exported.accounts[0].email, 'alpha@example.invalid');
    const again = spawnSync(process.execPath, ['mac/export-device-accounts.js', '--db', source, '--output', output], { stdio: 'pipe' });
    assert.notEqual(again.status, 0); assert.equal(hash(), before);
    assert.equal(execFileSync('git', ['check-ignore', 'device-accounts.local.json'], { encoding: 'utf8' }).trim(), 'device-accounts.local.json');
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
console.log('UI and private identity: ' + passed + ' regression groups passed.');
