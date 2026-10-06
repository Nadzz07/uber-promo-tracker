// Synthetic regression fixtures only. This file is never included in the site build.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { parseAccessList } from './access-list.js';
import { parseUberPromo } from './parser.js';
import { parseUberEatsReceipt } from './receipt-parser.js';
import { parseUberTransportReceipt } from './transport-receipt-parser.js';
import { analyseSender } from './parser-v2/sender.js';
import { applyReceiptEvidence } from './receipt-intelligence.js';
import { classifyOfferTrackingState } from './offer-state.js';
import { isOfferExpired, offerTime } from './offer-time.js';
import { publicOfferTitle, toPublicPromo } from './public-promo.js';
import { assertPublicSnapshot } from './public-snapshot.js';
import { planBasketSplit, rankPromosForSpend } from './deal-intelligence.js';
import { messageKey, receiptFingerprint } from './identity.js';
import { openPrivateDb, ensureAccount, setAccountAccess, getAccounts, getPublicAccountInsights, upsertOffer, getOffers, upsertReceipt, getReceipts, upsertTransportReceipt, getSavingsSummary, upsertMessage } from './private-db.js';

let passed = 0;
function test(name, fn) { fn(); console.log('✓ ' + name); passed++; }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-audit-'));
const base = { offerId: 'off-audit', id: 'off-audit', accountRef: 'A001', service: 'Uber Eats', discountType: 'fixed', discount: 10, minimumSpend: 15, uses: 5, usesRemaining: 5, canLogin: true, expires: '2099-10-20', expiryStatus: 'exact', emailSentAt: '2026-10-01T09:00:00Z' };
const receipt = { accountRef: 'A001', subtotal: 20, promotionDiscount: 10, total: 10, sentAt: '2026-10-02T18:00:00Z', receivedAt: '2026-10-02T18:00:01Z', orderId: 'AUDIT-001' };
try {
  test('Access CSV accepts spreadsheet headers, quotes, BOM and curly apostrophes', () => {
    assert.deepEqual(parseAccessList('\uFEFFEmail,Provider,Login status,Notes\r\n"alpha@example.invalid",iCloud,Can log in,"two, notes"\r\nbeta@example.invalid,Google,Can’t log in,\n').map(r => r.canLogin), [true, false]);
    assert.equal(parseAccessList('alpha@example.invalid\nalpha@example.invalid\n').length, 1);
    for (const text of ['email,can_login\n', 'a@example.invalid,maybe', 'a@example.invalid,true\na@example.invalid,false', 'not-an-email,true', '"broken']) assert.throws(() => parseAccessList(text));
  });
  test('Login method is explicit and independent of email domain', () => {
    const rows = parseAccessList(
      'Email,Provider,Login status,Notes\n' +
      'apple-route@icloud.com,iCloud,Can log in,\n' +
      'google-route@icloud.com,Google,Can log in,\n' +
      'both-route@icloud.com,iCloud + Google,Can log in,\n'
    );
    assert.deepEqual(rows.map(row => row.loginMethod), ['iCloud', 'Google', 'Both']);

    const db = openPrivateDb(':memory:');
    setAccountAccess(db, 'google-route@icloud.com', true, 'Google');
    const account = getAccounts(db)[0];
    assert.equal(account.loginMethod, 'Google');

    upsertTransportReceipt(db, {
      receiptId: 'bike-login-method',
      accountRef: account.accountRef,
      sentAt: '2026-10-06T12:00:00Z',
      receivedAt: '2026-10-06T12:00:01Z',
      transportMode: 'bike',
      total: 0
    });
    const publicAccount = getPublicAccountInsights(db)[0];
    assert.equal(publicAccount.loginMethod, 'Google');
    assert.equal(publicAccount.rideCount, 1, 'bike receipts count under Ride history');
    db.close();
  });
  test('Invalid --reset access import leaves existing access intact', () => {
    const dbPath = path.join(tmp, 'access.db'); let db = openPrivateDb(dbPath);
    setAccountAccess(db, 'alpha@example.invalid', true); db.close();
    const file = path.join(tmp, 'invalid.csv'); fs.writeFileSync(file, 'email,can_login\nalpha@example.invalid,typo\n');
    const run = spawnSync(process.execPath, ['mac/import-account-access.js', file, '--reset', '--db', dbPath], { encoding: 'utf8' });
    assert.notEqual(run.status, 0);
    assert.equal(run.stderr.includes('alpha@'), false);
    db = openPrivateDb(dbPath); assert.equal(getAccounts(db)[0].canLogin, true); db.close();
    assert.equal(fs.statSync(dbPath).mode & 0o777, 0o600);
  });
  test('Reminder dates do not erase earlier receipt usage', () => {
    const db = openPrivateDb(':memory:');
    const account = ensureAccount(db, { alias: 'alpha@example.invalid' });
    upsertOffer(db, { ...base, accountRef: account.accountRef });
    upsertOffer(db, { ...base, accountRef: account.accountRef, emailSentAt: '2026-10-05T12:00:00Z' });
    const offer = getOffers(db)[0];
    assert.equal(offer.firstEmailSentAt, base.emailSentAt);
    assert.equal(applyReceiptEvidence([offer], [receipt]).promos[0].usesRemaining, 4);
    db.close();
  });
  test('Receipts before offer start or after exact midnight expiry never consume uses', () => {
    const before = { ...receipt, sentAt: '2026-10-01T08:59:59Z' };
    assert.equal(applyReceiptEvidence([base], [before]).promos[0].usesRemaining, 5);
    const promo = { ...base, expires: '2026-10-03', expiresAt: '2026-10-03T00:00:00' };
    const after = { ...receipt, sentAt: '2026-10-03T12:00:00Z' };
    assert.equal(applyReceiptEvidence([promo], [after]).promos[0].receiptConfirmedUses, 0);
  });
  test('UK expiry is independent of browser timezone and rejects invalid dates', () => {
    assert.equal(offerTime('2026-10-03T00:00:00'), Date.parse('2026-10-02T23:00:00Z'));
    assert.equal(offerTime('2026-12-03T00:00:00'), Date.parse('2026-12-03T00:00:00Z'));
    assert.equal(isOfferExpired({ expiresAt: '2026-10-03T00:00:00' }, '2026-10-02T23:00:00Z'), true);
    assert.equal(classifyOfferTrackingState({ ...base, expires: '2026-02-31' }).trackingState, 'needs_checking');
    assert.equal(offerTime('2026-03-29T01:30:00'), null);
  });
  test('24-hour expiry and activation-based uncertainty are parsed conservatively', () => {
    const parse = body => parseUberPromo({ sender: 'offers@uber.com', subject: '£10 off your order', body, sentAt: '2026-10-01T09:00:00Z' });
    assert.equal(parse('Expires 20 Oct 2026 at 18:30.').expiresAt, '2026-10-20T18:30:00');
    assert.equal(parse('Expires 20 Oct 2026 13:00PM.').expires, null);
    assert.equal(parse('Valid for 14 days after activation.').expiryStatus, 'unknown');
  });
  test('Public titles contain offer facts instead of personalised email text', () => {
    const publicPromo = toPublicPromo({ ...base, title: 'Private Person alpha@example.invalid use SECRET10', code: 'SECRET10', expiresAt: '2099-10-20T00:00:00' });
    assert.equal(publicPromo.title, publicOfferTitle(base));
    assert.equal(publicPromo.expiresAt, '2099-10-20T00:00:00');
    const payload = { accounts: [], promos: [publicPromo] }; const history = { records: [] };
    assertPublicSnapshot(payload, history, ['alpha@example.invalid', 'SECRET10']);
    assert.throws(() => assertPublicSnapshot({ ...payload, sender: 'hidden' }, history));
    assert.throws(() => assertPublicSnapshot({ ...payload, accounts: [{ accountMasked: 'alpha@example.invalid' }] }, history));
  });
  test('Sender domain suffix lookalikes are rejected', () => {
    for (const value of ['offers@uber.com.evil.invalid', 'Uber Eats <offers@uber.com.evil.invalid>', 'uber_at_uber_com@icloud.com.evil.invalid']) assert.equal(analyseSender(value).trusted, false);
    assert.equal(analyseSender('Uber Eats <offers@email.uber.com>').trusted, true);
  });
  test('Receipt money labels do not confuse total savings with amount charged', () => {
    const value = parseUberEatsReceipt({ sender: 'receipts@uber.com', subject: 'Your receipt from Test Kitchen', body: '<div>Order ID: AUDIT-123</div><div>Subtotal &pound;1,234.50</div><div>Total savings £10.00</div><div>Total £1,224.50</div>' });
    assert.equal(value.isReceipt, true); assert.equal(value.subtotal, 1234.50); assert.equal(value.total, 1224.50); assert.equal(value.orderId, 'AUDIT-123');
  });
  test('Ride receipts with an Eats footer stay transport-only', () => {
    const email = { sender: 'receipts@uber.com', subject: 'Your trip with Uber receipt', body: 'Thanks for riding with Uber.\nTrip total £20.00\nTry Uber Eats for your next order. Subtotal £20.00' };
    assert.equal(parseUberEatsReceipt(email).isReceipt, false);
    assert.equal(parseUberTransportReceipt(email).isReceipt, true);
  });
  test('Uber Cash payment does not hide a first-N Eats order', () => {
    const cash = { ...base, id: 'cash', offerId: 'cash', discountType: 'uberCash', uses: 1 };
    const result = applyReceiptEvidence([base, cash], [{ ...receipt, promotionDiscount: 0, uberCashUsed: 10 }]);
    assert.equal(result.promos[0].usesRemaining, 4); assert.equal(result.promos[1].usesRemaining, 0);
  });
  test('Receipt identity normalises order IDs and scopes shared Message-ID to recipient', () => {
    assert.equal(receiptFingerprint(receipt), receiptFingerprint({ ...receipt, orderId: ' audit-001 ' }));
    assert.notEqual(messageKey({ messageId: '<shared>', recipient: 'a@example.invalid' }), messageKey({ messageId: '<shared>', recipient: 'b@example.invalid' }));
  });
  test('Sparse duplicate receipt cannot erase known amounts or dilute fee estimates', () => {
    const db = openPrivateDb(':memory:'); ensureAccount(db, { alias: 'alpha@example.invalid' });
    upsertReceipt(db, { ...receipt, receiptId: 'r1', serviceFee: 2, deliveryFee: 1 });
    upsertReceipt(db, { ...receipt, receiptId: 'r1', subtotal: null, promotionDiscount: null, receivedAt: '2026-10-03T18:00:00Z' });
    upsertReceipt(db, { ...receipt, receiptId: 'r2', orderId: 'AUDIT-002' });
    assert.equal(getReceipts(db)[0].promotionDiscount, 10);
    assert.equal(getSavingsSummary(db).averageExtraOrderFees, 3);
    db.close();
  });
  test('Parser upgrades reuse old receipt rows and remove corrected transport misclassification', () => {
    const db = openPrivateDb(':memory:'); ensureAccount(db, { alias: 'alpha@example.invalid' });
    const message = { messageKey: 'legacy-key', messageId: '<upgrade@example.invalid>', accountRef: 'A001', kind: 'receipt', parsedAt: '2026-10-01T00:00:00Z' };
    upsertMessage(db, message);
    upsertReceipt(db, { ...receipt, receiptId: 'old-receipt', orderId: null, messageKey: 'legacy-key' });
    upsertMessage(db, { ...message, messageKey: 'new-key' });
    upsertReceipt(db, { ...receipt, receiptId: 'new-receipt', messageKey: 'new-key' });
    assert.equal(getReceipts(db).length, 1);
    assert.equal(getReceipts(db)[0].receiptId, 'old-receipt');
    assert.equal(getReceipts(db)[0].orderId, 'AUDIT-001');
    upsertMessage(db, { ...message, messageKey: 'new-key', kind: 'transport_receipt' });
    assert.equal(getReceipts(db).length, 0);
    db.close();
  });
  test('Planner refuses review/expired offers and supports penny minimums', () => {
    assert.equal(rankPromosForSpend([{ ...base, trackingState: 'needs_checking' }], 25).length, 0);
    assert.equal(planBasketSplit([{ ...base, expires: '2000-01-01' }], 25).eligible, false);
    const plan = planBasketSplit([{ ...base, minimumSpend: 15.25 }], 15.25);
    assert.equal(plan.eligible, true); assert.equal(plan.netSaving, 10); assert.equal(plan.orders[0].subtotal, 15.25);
    assert.equal(planBasketSplit([base], 1e9).eligible, false);
  });
  test('Zero backfill chunks and overlapping syncs stop before doing work', () => {
    const common = path.resolve('mac/common.sh');
    const env = { ...process.env, COMMON: common };
    assert.notEqual(spawnSync('bash', ['-c', 'source "$COMMON"; positive_days 0 CHUNK'], { env, cwd: tmp }).status, 0);
    const lock = spawnSync('bash', ['-c', 'source "$COMMON"; acquire_sync_lock; bash -c \'source "$COMMON"; acquire_sync_lock\''], { env, cwd: tmp });
    assert.notEqual(lock.status, 0); assert.equal(fs.existsSync(path.join(tmp, '.tracker-sync.lock')), false);
  });
  test('Failed Mail export keeps the last good export and cleans the sync lock', () => {
    const dir = path.join(tmp, 'sync'); fs.mkdirSync(path.join(dir, 'mac'), { recursive: true }); fs.mkdirSync(path.join(dir, 'bin'));
    for (const file of ['preview-sync.sh', 'common.sh']) fs.copyFileSync('mac/' + file, path.join(dir, 'mac', file));
    fs.writeFileSync(path.join(dir, 'emails.local.json'), 'previous-good-export');
    for (const [name, body] of [['npm', 'exit 0'], ['osascript', 'printf broken; exit 7']]) fs.writeFileSync(path.join(dir, 'bin', name), '#!/bin/bash\n' + body + '\n', { mode: 0o755 });
    const result = spawnSync('bash', ['mac/preview-sync.sh'], { cwd: dir, env: { ...process.env, PATH: path.join(dir, 'bin') + ':' + process.env.PATH } });
    assert.notEqual(result.status, 0);
    assert.equal(fs.readFileSync(path.join(dir, 'emails.local.json'), 'utf8'), 'previous-good-export');
    assert.equal(fs.existsSync(path.join(dir, '.tracker-sync.lock')), false);
  });
  test('Generator rejects malformed records without partial DB imports or output loss', () => {
    const dbPath = path.join(tmp, 'rollback.db'), input = path.join(tmp, 'mail.json'), output = path.join(tmp, 'public.json'), history = path.join(tmp, 'history.json');
    let db = openPrivateDb(dbPath); db.close();
    fs.writeFileSync(input, JSON.stringify({ messages: [{ sender: 'offers@uber.com', recipient: 'a@example.invalid', subject: '£10 off your order', body: 'Expires 20 Oct 2099.', sentAt: '2026-10-01T12:00:00Z' }, null] }));
    fs.writeFileSync(output, 'last-good');
    assert.notEqual(spawnSync(process.execPath, ['generate-promos.js', input, output, history, dbPath]).status, 0);
    assert.equal(fs.readFileSync(output, 'utf8'), 'last-good'); db = openPrivateDb(dbPath); assert.equal(getAccounts(db).length, 0); db.close();
  });
  console.log('Engineering audit: ' + passed + ' regression groups passed.');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
