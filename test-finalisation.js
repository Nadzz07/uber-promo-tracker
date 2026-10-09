import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { accountUsage, classifyAccount } from './account-state.js';
import { applyOfferExpiryPolicy, expiryEndTime } from './offer-time.js';
import { applyOfferTrackingStates } from './offer-state.js';
import { applyReceiptEvidence } from './receipt-intelligence.js';
import { estimateReceiptSavings, confirmedReceiptSaving, combinedReceiptSavings } from './savings-intelligence.js';
import { parseUberEatsReceipt } from './receipt-parser.js';
import { parseUberTransportReceipt } from './transport-receipt-parser.js';
import { analyseSender } from './parser-v2/sender.js';
import { asDate, extractAccountAlias } from './parser-v2/utils.js';
import { ensureAccount, openPrivateDb, deleteAccountsPermanently, upsertMessage, upsertReceipt, upsertTransportReceipt, getReceipts, getTransportReceipts } from './private-db.js';
import { backupPrivateDb } from './private-backup.js';
import { assertPublicSnapshot } from './public-snapshot.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('✓ ' + name); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-finalisation-'));
const now = '2026-10-08T12:00:00Z';
const offer = { id: 'offer-one', offerId: 'offer-one', service: 'Uber Eats', accountRef: 'A001', discountType: 'fixed', discount: 10, minimumSpend: 15, uses: 5, emailSentAt: '2026-10-01T12:00:00Z', expiryStatus: 'unknown', canLogin: true };
const email = { sender: 'receipts@uber.com', recipient: 'alpha@example.invalid', subject: 'Your receipt from Test Kitchen', body: 'Thanks for your order\nOrder ID: UNIQUE-001\nSubtotal £20\nPromotion -£10\nTotal £10', sentAt: '2026-10-02T12:00:00Z', receivedAt: '2026-10-02T12:00:01Z', messageId: '<receipt-one@uber.com>' };
try {
  test('Account use requires five Eats, or one Eats plus one ride/bike; access and expiry are independent', () => {
    for (const [eats, rides, expected] of [[0,0,false],[1,0,false],[4,0,false],[0,5,false],[1,1,true],[5,0,true],[5,9,true]]) assert.equal(accountUsage({ orderCount: eats, rideCount: rides }).accountUsed, expected);
    const active = applyOfferTrackingStates([offer], [], { now });
    assert.equal(classifyAccount({ canLogin: true, orderCount: 1, rideCount: 0 }, active).accountState, 'available');
    assert.equal(classifyAccount({ canLogin: true, orderCount: 1, rideCount: 1 }, active).accountState, 'used');
    assert.equal(classifyAccount({ canLogin: false, orderCount: 5 }, active).accountState, 'archived');
    assert.equal(classifyAccount({ canLogin: true }, []).accountState, 'no_offers');
    assert.equal(classifyAccount({ canLogin: true }, [...active, { trackingState: 'needs_checking' }]).needsReview, false, 'A reviewable offer cannot make a usable account Needs checking');
    assert.equal(classifyAccount({ canLogin: true }, [{ trackingState: 'expired', closedReason: 'expired' }]).accountState, 'expired');
    assert.equal(classifyAccount({ canLogin: true }, [{ trackingState: 'expired', closedReason: 'expired' }, { trackingState: 'used', closedReason: 'uses_finished' }]).accountState, 'no_offers', 'Mixed expired and consumed offers are not all consumed');
    assert.equal(accountUsage({ orderCount: 1, rideCount: 0 }).partialUsage, true);
    assert.equal(accountUsage({ orderCount: 0, rideCount: 0 }).partialUsage, false);
    assert.equal(accountUsage({ orderCount: 1, rideCount: 1 }).partialUsage, false);
  });
  test('Transport totals prefer the final discounted charge over the pre-discount fare', () => {
    const ride = { ...email, subject: 'Your trip with Uber', body: 'Thanks for riding with Uber\nFare £11.91\nPromotion -£10.00\nTotal £1.91' };
    assert.equal(parseUberTransportReceipt(ride).total, 1.91);
    assert.equal(parseUberTransportReceipt({ ...ride, body: 'Thanks for riding with Uber\nFare £7.95\nPromotion -£7.95\nTotal £0.00' }).total, 0);
    assert.equal(parseUberTransportReceipt({ ...ride, body: ride.body + '\nNew total £1.50' }).total, 1.50);
    assert.equal(parseUberTransportReceipt({ ...ride, body: 'Thanks for riding with Uber\nFare £4.00' }).total, 4);
  });
  test('Large Mail formatting gaps cannot stall monetary parsing or invent a discount', () => {
    const program = String.raw`import { moneyForLabel } from './receipt-text.js';
      const gap = ' \n'.repeat(4000);
      const result = moneyForLabel('Promotion' + gap + 'No discount applied\nTotal £4', ['promotion']);
      if (result.value !== null) throw new Error('Invented promotion');
      if (moneyForLabel('Promotion: \n - \n £10', ['promotion']).value !== 10) throw new Error('Lost multiline amount');`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', program], { encoding: 'utf8', timeout: 2000 });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
  });
  test('35-day policy uses the earliest offer, preserves earlier explicit terms, and never invents usage', () => {
    const capped = applyOfferExpiryPolicy({ ...offer, firstEmailSentAt: '2026-09-01T12:00:00Z', emailSentAt: '2026-10-01T12:00:00Z' });
    assert.equal(capped.expiresAt, '2026-10-06T12:00:00.000Z');
    const expired = applyOfferTrackingStates([capped], [], { now })[0];
    assert.equal(expired.trackingState, 'expired'); assert.equal(expired.receiptConfirmedUses || 0, 0);
    const earlier = { ...offer, expiresAt: '2026-10-03T12:00:00Z', expiryStatus: 'exact' };
    assert.equal(expiryEndTime(applyOfferExpiryPolicy(earlier)), Date.parse(earlier.expiresAt));
    assert.equal(applyOfferTrackingStates([offer], [], { now })[0].trackingState, 'available');
    const boundary = applyOfferTrackingStates([offer], [], { now: '2026-11-05T12:00:00Z' })[0];
    assert.equal(boundary.trackingState, 'expired');
    assert.equal(applyOfferTrackingStates([{ ...offer, emailSentAt: null }], [], { now })[0].trackingState, 'needs_checking');
  });
  test('Unmatched discounts do not flag unrelated offers; ambiguity involves only plausible matches', () => {
    const single = { ...offer, uses: 1 };
    const r = { accountRef: 'A001', orderId: 'ABC-001', subtotal: 30, promotionDiscount: 2, sentAt: '2026-10-02T12:00:00Z' };
    const unmatched = applyReceiptEvidence([single], [r], { now });
    assert.equal(unmatched.promos[0].trackingState, 'available'); assert.equal(unmatched.promos[0].receiptConfirmedUses, 0);
    const ambiguous = applyReceiptEvidence([single, { ...single, id: 'two', offerId: 'two' }, { ...single, id: 'three', offerId: 'three', discount: 25 }], [{ ...r, promotionDiscount: 10 }], { now });
    assert.equal(ambiguous.promos[2].trackingState, 'available');
    assert.deepEqual(ambiguous.matches[0].candidateOfferIds, ['offer-one', 'two']);
  });
  test('Savings dedupe identities, separate balance payments, and reconcile account/lifetime/recent totals', () => {
    const receipts = [
      { accountRef: 'A001', orderId: 'ORDER-A', sentAt: '2026-10-02T12:00:00Z', promotionDiscount: 10, uberCashUsed: 5, uberOneSavings: 2, reportedSavings: 12 },
      { accountRef: 'A001', orderId: ' order-a ', sentAt: '2026-10-02T12:00:00Z', promotionDiscount: 10, uberCashUsed: 5, uberOneSavings: 2, reportedSavings: 12 },
      { accountRef: 'A002', orderId: 'ORDER-B', sentAt: '2026-08-02T12:00:00Z', promotionDiscount: 4, uberCashUsed: 3, uberCashSavings: 3, reportedSavings: 7 }
    ];
    const result = estimateReceiptSavings(receipts, { now });
    assert.equal(result.summary.trackedOrders, 2); assert.equal(result.summary.totalSaved, 19);
    assert.equal(result.summary.recentConfirmedSaved, 12); assert.equal(result.summary.recentOrders, 1);
    assert.equal(result.summary.uberCashUsed, 8); assert.equal(result.summary.uberCashConfirmedSavings, 3);
    assert.equal([...result.byAccount.values()].reduce((s,a) => s+a.confirmedSaved,0), 19);
    assert.equal(confirmedReceiptSaving({ uberCashUsed: 100 }), 0);
    assert.equal(confirmedReceiptSaving({ promotionDiscount: 10, uberOneSavings: 2, reportedSavings: 12 }), 12);
    assert.equal(confirmedReceiptSaving({ promotionDiscount: -10, reportedSavings: -10 }), 0);
    assert.equal(parseUberEatsReceipt({ ...email, body: email.body + '\nUber Cash discount -£3' }).uberCashSavings, 3);
    assert.equal(parseUberEatsReceipt({ ...email, body: email.body + '\nJoin Uber One today to save' }).uberOneSignal, false);
  });
  test('Sender domains, iCloud relay and Lime are recognised without trusting spoofed display names', () => {
    for (const sender of ['Uber Eats <evil@invalid.example>', 'Uber <receipts@uber.com.evil.example>', 'Lime <x@li.me.evil.example>']) assert.equal(parseUberEatsReceipt({ ...email, sender }).isReceipt, false);
    for (const sender of ['noreply_at_uber_com_abc@icloud.com', 'no_reply_at_mail_uber_com_abc@icloud.com', 'Uber Eats <receipts@email.uber.com>']) assert.equal(analyseSender(sender).trusted, true);
    const lime = { ...email, sender: 'Lime <receipts@li.me>', subject: 'Your Lime ride receipt', body: 'Thanks for riding with Lime\nRide total £4\nTrip ID: LIME-001' };
    assert.equal(parseUberTransportReceipt(lime).isReceipt, true); assert.equal(parseUberTransportReceipt(lime).transportMode, 'bike');
    assert.equal(parseUberEatsReceipt(lime).isReceipt, false);
    assert.equal(parseUberTransportReceipt({ ...lime, sender: 'Lime <evil@li.me.evil.example>' }).isReceipt, false);
  });
  test('Historical ride/Lime savings contribute once without changing Eats usage or inventing Uber One estimates', () => {
    const ride = parseUberTransportReceipt({ ...email, sender: 'receipts@li.me', subject: 'Your Lime ride receipt', body: 'Thanks for riding with Lime\nRide total £4\nPromotion -£2\nYou saved £2\nTrip ID: LIME-123' });
    assert.equal(ride.promotionDiscount, 2); assert.equal(ride.reportedSavings, 2);
    const summary = combinedReceiptSavings([{ accountRef: 'A001', orderId: 'EATS-1', promotionDiscount: 10, sentAt: now }], [{ ...ride, accountRef: 'A001' }, { ...ride, accountRef: 'A001' }], { now });
    assert.equal(summary.summary.totalSaved, 12); assert.equal(summary.summary.rideConfirmedSaved, 2);
    assert.equal(summary.summary.trackedOrders, 1); assert.equal(summary.summary.trackedRides, 1);
    assert.equal(summary.byAccount.get('A001').confirmedSaved, 12); assert.equal(summary.byAccount.get('A001').orderCount, 1);
    assert.equal(summary.summary.estimatedUberOneSavings, 0);
  });
  test('Malformed dates and multiple recipients never become invented current receipt evidence', () => {
    assert.throws(() => asDate('nonsense')); assert.throws(() => asDate('2026-02-31')); assert.throws(() => asDate(null));
    assert.throws(() => parseUberEatsReceipt({ ...email, sentAt: 'nonsense' }));
    assert.equal(extractAccountAlias('Alpha <a@example.invalid>, Beta <b@example.invalid>'), null);
    assert.equal(extractAccountAlias('Alpha <a@example.invalid>'), 'a@example.invalid');
  });
  test('Deleted accounts stay deleted even without an access list; untrusted Mail cannot create accounts', () => {
    const db = openPrivateDb(':memory:'); ensureAccount(db, { alias: email.recipient });
    deleteAccountsPermanently(db, [email.recipient]);
    assert.equal(ensureAccount(db, { alias: email.recipient, kind: 'receipt' }), null);
    assert.equal(ensureAccount(db, { alias: email.recipient, kind: 'promo' }), null);
    db.close();
  });
  test('Older duplicate receipts cannot replace newer charges, discounts or source evidence', () => {
    const db = openPrivateDb(':memory:'); const a = ensureAccount(db, { alias: email.recipient });
    const latest = { accountRef: a.accountRef, messageKey: 'new-source', sentAt: '2026-10-02T12:00:00Z', receivedAt: '2026-10-02T12:00:00Z', total: 0, promotionDiscount: 0, uberCashUsed: 0, uberCashSavings: 0, reportedSavings: 0, uberOneSavings: 0 };
    const older = { ...latest, messageKey: 'older-source', sentAt: '2026-10-01T12:00:00Z', receivedAt: '2026-10-01T12:00:00Z', total: 5, promotionDiscount: 5, uberCashUsed: 5, uberCashSavings: 5, reportedSavings: 5, uberOneSavings: 5 };
    upsertReceipt(db, { ...latest, receiptId: 'eats-new', orderId: 'ORDER-1' });
    upsertReceipt(db, { ...older, receiptId: 'eats-old', orderId: 'ORDER-1' });
    upsertTransportReceipt(db, { ...latest, receiptId: 'ride-new', tripId: 'TRIP-1', transportMode: 'bike' });
    upsertTransportReceipt(db, { ...older, receiptId: 'ride-old', tripId: 'TRIP-1', transportMode: 'ride' });
    for (const table of ['receipts', 'transport_receipts']) {
      const rows = db.prepare('SELECT * FROM ' + table).all(); assert.equal(rows.length, 1);
      assert.equal(rows[0].message_key, 'new-source');
      for (const field of ['total', 'promotion_discount', 'uber_cash_used', 'uber_cash_savings', 'reported_savings', 'uber_one_savings']) assert.equal(rows[0][field], 0, table + ' ' + field);
    }
    assert.equal(db.prepare('SELECT transport_mode FROM transport_receipts').get().transport_mode, 'bike');
    db.close();
  });
  test('Transport parser upgrades and sparse copies reuse durable identities and preserve amounts', () => {
    const db = openPrivateDb(':memory:'); const a = ensureAccount(db, { alias: email.recipient });
    const r = { receiptId: 'first', accountRef: a.accountRef, messageKey: 'trip-key', tripId: 'TRIP-1', sentAt: '2026-10-01T12:00:00Z', receivedAt: '2026-10-01T12:00:00Z', total: 4, transportMode: 'bike' };
    upsertTransportReceipt(db, r);
    upsertTransportReceipt(db, { ...r, receiptId: 'changed-fingerprint', tripId: ' trip-1 ', sentAt: '2026-10-01T14:00:00Z', receivedAt: '2026-10-01T14:00:00Z', total: null });
    assert.equal(getTransportReceipts(db).length, 1); assert.equal(getTransportReceipts(db)[0].total, 4);
    assert.equal(getTransportReceipts(db)[0].sentAt, r.sentAt);
    db.close();
  });
  test('Reclassified untrusted receipt stays in private history but is excluded from confirmed counts', () => {
    const db = openPrivateDb(':memory:'); const a = ensureAccount(db, { alias: email.recipient });
    const message = { messageKey: 'evidence', messageId: 'old', accountRef: a.accountRef, kind: 'receipt', accepted: true, parsedAt: now };
    upsertMessage(db, message); upsertReceipt(db, { receiptId: 'kept', accountRef: a.accountRef, messageKey: 'evidence', sentAt: now, promotionDiscount: 10 });
    assert.equal(getReceipts(db).length, 1);
    upsertMessage(db, { ...message, kind: 'other', accepted: false });
    assert.equal(getReceipts(db).length, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM receipts').get().n, 1, 'Historical row is retained');
    db.close();
  });
  test('Reparsing the original source clears old false financial extractions instead of preserving them', () => {
    const db = openPrivateDb(':memory:'); const account = ensureAccount(db, { alias: email.recipient });
    const receipt = { receiptId: 'stale', accountRef: account.accountRef, messageKey: 'same-source', sentAt: now, promotionDiscount: 999, uberOneSignal: true };
    upsertReceipt(db, receipt);
    upsertReceipt(db, { ...receipt, reparsedSource: true, promotionDiscount: null, uberOneSignal: false });
    assert.equal(getReceipts(db)[0].promotionDiscount, null); assert.equal(getReceipts(db)[0].uberOneSignal, false);
    db.close();
  });
  test('Database backup includes committed WAL evidence and has owner-only permissions', () => {
    const file = path.join(tmp, 'wal.db'); const db = openPrivateDb(file);
    ensureAccount(db, { alias: email.recipient });
    const backup = backupPrivateDb(file); const copy = new DatabaseSync(backup, { readOnly: true });
    assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM accounts').get().n, 1); copy.close(); db.close();
    assert.equal(fs.statSync(backup).mode & 0o777, 0o600);
  });
  test('Private validation reparses a backed-up copy twice, preserves the original and checks public sums', () => {
    const file = path.join(tmp, 'validate.db'), input = path.join(tmp, 'input.json'), access = path.join(tmp, 'access.csv');
    const date = new Date(Date.now() - 86400000).toISOString();
    fs.writeFileSync(input, JSON.stringify({ messages: [{ ...email, sentAt: date, receivedAt: date }] }));
    fs.writeFileSync(access, 'Email,Login status\nalpha@example.invalid,Can log in\n');
    execFileSync(process.execPath, ['generate-promos.js', input, path.join(tmp, 'pub.json'), path.join(tmp, 'hist.json'), file], { stdio: 'pipe', env: { ...process.env, TRACKER_ACCOUNT_ACCESS: access } });
    // Reproduce a pre-transport Mac schema, including an older account column.
    const legacy = new DatabaseSync(file);
    legacy.exec('DROP TABLE transport_receipts; ALTER TABLE accounts DROP COLUMN login_method; PRAGMA wal_checkpoint(TRUNCATE)');
    legacy.close();
    const before = fs.readFileSync(file);
    const output = path.join(tmp, 'verified');
    execFileSync(process.execPath, ['mac/validate-private-data.js', '--db', file, '--access', access, '--output-dir', output], { stdio: 'pipe' });
    assert.deepEqual(fs.readFileSync(file), before);
    const p = JSON.parse(fs.readFileSync(path.join(output, 'promos.json'))), h = JSON.parse(fs.readFileSync(path.join(output, 'history.json')));
    assertPublicSnapshot(p, h); assert.equal(p.summary.totalSaved, 10); assert.equal(p.summary.trackedOrders, 1);
    const broken = structuredClone(p); broken.summary.availableAccounts = 100; assert.throws(() => assertPublicSnapshot(broken, h));
    const report = JSON.parse(fs.readFileSync(path.join(output, 'report.json'))); assert.equal(report.idempotent, true); assert.equal(report.sourceDatabaseUnchanged, true);
    assert.equal(spawnSync(process.execPath, ['mac/validate-private-data.js', '--db', file, '--access', access, '--output-dir', output], { stdio: 'pipe' }).status, 1, 'Cannot overwrite a prior validation');
  });
  test('Routine Inbox discovery covers receipt ages beyond the 35-day promo window without duplicate imports', () => {
    const dir = path.join(tmp, 'mail-window'); fs.mkdirSync(dir);
    const oldReceipt = { ...email, messageId: '<older-inbox@uber.com>', sourceMailbox: 'INBOX', sentAt: '2026-08-01T12:00:00Z' };
    const recentReceipt = { ...email, sourceMailbox: 'INBOX' };
    const initial = JSON.stringify({ messages: [recentReceipt] });
    const extended = JSON.stringify({ messages: [recentReceipt, oldReceipt] });
    const shell = 'set -euo pipefail; source mac/common.sh; TMP_DIR="' + dir + '"; PROMO_DAYS=35; PROMO_FOLDERS=INBOX; RECEIPT_DAYS=90; RECEIPT_FOLDER="Uber Receipts"; osascript(){ if [[ "$4" == 90 && "$5" == INBOX ]]; then cat "' + dir + '/extended.json"; else cat "' + dir + '/initial.json"; fi; }; export_recent_mail';
    fs.writeFileSync(path.join(dir,'initial.json'), initial); fs.writeFileSync(path.join(dir,'extended.json'), extended);
    fs.symlinkSync(path.resolve('mac'), path.join(dir, 'mac'), 'dir');
    fs.symlinkSync(path.resolve('identity.js'), path.join(dir, 'identity.js'));
    execFileSync('bash', ['-c', shell], { cwd: dir, stdio: 'pipe' });
    const result = JSON.parse(fs.readFileSync(path.join(dir, 'emails.local.json')));
    assert.equal(result.messages.length, 2); assert.ok(result.messages.some(m => m.messageId === oldReceipt.messageId));
  });
  test('Preview and legacy automation configurations cannot route Mail by default; deploy requires explicit verification', () => {
    const preview = fs.readFileSync('mac/preview-sync.sh','utf8'); assert.equal(preview.includes('\nfile_imported_receipts\n'), false);
    const result = execFileSync('bash', ['-c', 'set -euo pipefail; source mac/common.sh; MOVE_INBOX_RECEIPTS=true; TRASH_ARCHIVED_MAIL=true; osascript(){ echo unsafe >&2; return 99; }; file_imported_receipts'], { encoding: 'utf8' }); assert.equal(result, '');
    const workflow = fs.readFileSync('.github/workflows/pages.yml','utf8'); assert.match(workflow, /private_data_verified/); assert.match(workflow, /accountStatusVersion !== 2/); assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  });
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log('Finalisation: ' + passed + ' regression groups passed.');
