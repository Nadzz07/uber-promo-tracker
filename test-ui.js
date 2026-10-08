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

const time = '2026-10-08T12:00:00Z';
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('✓ ' + name); }

test('Layout selection overrides screen size while Auto follows the responsive boundary', () => {
  for (const value of [null, undefined, '', 'other', 'AUTO', '<script>']) assert.equal(normaliseLayout(value), 'auto');
  assert.equal(normaliseLayout('mobile'), 'mobile'); assert.equal(normaliseLayout('desktop'), 'desktop');
  assert.equal(resolveLayout('auto', 979), 'mobile'); assert.equal(resolveLayout('auto', 980), 'desktop');
  assert.equal(resolveLayout('mobile', 1920), 'mobile'); assert.equal(resolveLayout('desktop', 320), 'desktop');
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
