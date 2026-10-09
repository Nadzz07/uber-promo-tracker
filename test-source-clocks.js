// Full-source clock repairs use only synthetic messages in in-memory databases.
import assert from 'node:assert/strict';
import {
  openPrivateDb, ensureAccount, upsertMessage, upsertOffer, upsertReceipt,
  upsertTransportReceipt, reconcileOfferSources, getOffers
} from './private-db.js';
import { offerFingerprint } from './identity.js';
import { applyOfferExpiryPolicy, expiryEndTime } from './offer-time.js';

const seenAt = '2026-10-08T12:00:00.000Z';
const tables = ['meta', 'accounts', 'messages', 'offers', 'receipts', 'transport_receipts', 'receipt_offer_matches'];
const snapshot = db => {
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'offer_source_repairs'").get() ? [...tables, 'offer_source_repairs'] : tables;
  return Object.fromEntries(names.map(table => [table, db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()]));
};
const row = (db, id) => db.prepare('SELECT * FROM offers WHERE offer_id = ?').get(id);
let passed = 0;
function test(name, fn) {
  const db = openPrivateDb(':memory:');
  try {
    const account = ensureAccount(db, { alias: 'synthetic-clock@example.invalid', seenAt });
    fn(db, account.accountRef); passed++; console.log('✓ ' + name);
  } finally { db.close(); }
}
function offer(accountRef, messageKey, emailSentAt, overrides = {}) {
  const promo = {
    accountRef, messageKey, emailSentAt, receivedAt: emailSentAt,
    service: 'Uber Eats', offerType: 'fixed_discount', discountType: 'fixed', discount: 12,
    uses: 5, minimumSpend: 15, title: '£12 off on 5 orders',
    expires: null, expiresAt: null, expiryStatus: 'unknown', expiryBasis: null,
    expiryConfidence: null, classificationConfidence: 'high', evidence: { synthetic: true },
    source: 'live_mail', observedLive: true, ...overrides
  };
  return { ...promo, offerId: offerFingerprint(promo) };
}
function message(db, accountRef, key, sentAt, { accepted = true, kind = accepted ? 'promo' : 'other', body = 'Synthetic original offer terms are preserved.', subject = 'Synthetic coupon' } = {}) {
  upsertMessage(db, {
    messageKey: key, messageId: '<' + key + '@example.invalid>', accountRef, kind,
    mailbox: 'Synthetic', sender: 'offers@uber.com', subject, bodyText: body,
    sentAt, receivedAt: sentAt, parserVersion: 3, classification: kind,
    classificationConfidence: 'high', accepted, rejectionReason: accepted ? null : 'no_usable_promo_terms',
    evidence: { synthetic: true }, parsedAt: seenAt
  });
}
function coverage(db) { return new Set(db.prepare('SELECT message_key FROM messages').all().map(m => m.message_key)); }
function family(first, latest = first) { return { firstSentAt: first.emailSentAt, latest }; }

test('Rejected footer donors cannot falsely expire a corrected primary coupon; receipts, usage and private history survive', (db, ref) => {
  const donor = offer(ref, 'rejected-footer', '2026-06-01T12:00:00.000Z', { service: 'Uber One', offerType: 'membership', discountType: 'percent', discount: 10, uses: 1 });
  const current = offer(ref, 'primary-coupon', '2026-09-18T12:00:00.000Z');
  message(db, ref, donor.messageKey, donor.emailSentAt, { accepted: false });
  message(db, ref, current.messageKey, current.emailSentAt);
  message(db, ref, 'receipt-source', '2026-09-19T12:00:00.000Z', { kind: 'receipt' });
  message(db, ref, 'ride-source', '2026-09-20T12:00:00.000Z', { kind: 'transport_receipt' });
  upsertOffer(db, donor, seenAt); upsertOffer(db, current, seenAt);
  db.prepare("UPDATE offers SET status = 'parser_superseded' WHERE offer_id = ?").run(donor.offerId);
  db.prepare("UPDATE offers SET first_sent_at = ?, uses_remaining = 3, receipt_confirmed_uses = 2, receipt_state = 'partial', last_used_at = ? WHERE offer_id = ?")
    .run(donor.emailSentAt, '2026-09-19T12:00:00.000Z', current.offerId);
  upsertReceipt(db, { receiptId: 'synthetic-eats', accountRef: ref, messageKey: 'receipt-source', sentAt: '2026-09-19T12:00:00.000Z', orderId: 'SYNTHETIC-EATS', total: 3, promotionDiscount: 12 }, seenAt);
  upsertTransportReceipt(db, { receiptId: 'synthetic-bike', accountRef: ref, messageKey: 'ride-source', sentAt: '2026-09-20T12:00:00.000Z', tripId: 'SYNTHETIC-BIKE', transportMode: 'bike', total: 2, promotionDiscount: 5 }, seenAt);
  db.prepare('INSERT INTO receipt_offer_matches(receipt_id, offer_id, status, expected_saving, observed_saving, matched_at) VALUES(?,?,?,?,?,?)')
    .run('synthetic-eats', current.offerId, 'confirmed', 12, 12, seenAt);
  const before = snapshot(db), historical = row(db, donor.offerId), usage = row(db, current.offerId);
  const families = new Map([[current.offerId, family(current)]]);
  const result = reconcileOfferSources(db, { processedMessageKeys: coverage(db), families });
  assert.equal(result.coveredMessages, 4); assert.equal(result.sourceFamilies, 1); assert.ok(result.repairedClocks >= 1);
  const repaired = row(db, current.offerId);
  assert.equal(repaired.first_sent_at, current.emailSentAt);
  assert.equal(repaired.last_sent_at, current.emailSentAt); assert.equal(repaired.message_key, current.messageKey);
  for (const field of ['uses_remaining', 'receipt_confirmed_uses', 'receipt_state', 'last_used_at', 'first_seen_at', 'last_seen_at']) assert.equal(repaired[field], usage[field], 'Repair must retain ' + field);
  assert.deepEqual(row(db, donor.offerId), historical, 'Superseded evidence must remain intact');
  const after = snapshot(db);
  for (const table of tables.filter(t => t !== 'offers')) assert.deepEqual(after[table], before[table], 'Repair must preserve ' + table);
  assert.equal(after.offers.length, before.offers.length, 'Repair must retain every historical offer row');
  const evidence = db.prepare('SELECT * FROM offer_source_repairs WHERE offer_id = ?').all(current.offerId);
  assert.equal(evidence.length, 1, 'The prior derived clock must remain available as private repair evidence');
  assert.equal(evidence[0].previous_first_sent_at, donor.emailSentAt);
  assert.equal(evidence[0].canonical_first_sent_at, current.emailSentAt);
  const publicCandidate = getOffers(db).find(p => p.offerId === current.offerId);
  assert.equal(applyOfferExpiryPolicy(publicCandidate).expiresAt, '2026-10-23T12:00:00.000Z', 'Corrected coupon uses its own first accepted source');
  const stable = snapshot(db);
  assert.equal(reconcileOfferSources(db, { processedMessageKeys: coverage(db), families }).repairedClocks, 0);
  assert.deepEqual(snapshot(db), stable, 'Repeated complete-source repair must be idempotent');
});

test('Equal discount values from a different service do not donate an earlier campaign clock', (db, ref) => {
  const ride = offer(ref, 'ride-coupon', '2026-07-02T10:00:00.000Z', { service: 'Uber', offerType: 'ride_discount' });
  const eats = offer(ref, 'eats-coupon', '2026-09-16T10:00:00.000Z');
  for (const promo of [ride, eats]) { message(db, ref, promo.messageKey, promo.emailSentAt); upsertOffer(db, promo, seenAt); }
  db.prepare('UPDATE offers SET first_sent_at = ? WHERE offer_id = ?').run(ride.emailSentAt, eats.offerId);
  reconcileOfferSources(db, { processedMessageKeys: coverage(db), families: new Map([[ride.offerId, family(ride)], [eats.offerId, family(eats)]]) });
  assert.equal(row(db, eats.offerId).first_sent_at, eats.emailSentAt);
  assert.equal(row(db, ride.offerId).first_sent_at, ride.emailSentAt);
  assert.equal(applyOfferExpiryPolicy(getOffers(db).find(p => p.offerId === eats.offerId)).expiresAt, '2026-10-21T10:00:00.000Z');
});

test('The true earliest accepted reminder stays earliest while a rejected latest pointer and stale terms are repaired', (db, ref) => {
  const first = offer(ref, 'cash-first', '2026-06-03T17:05:15.000Z', { discountType: 'uberCash', offerType: 'uber_cash', uses: 1, minimumSpend: 0, code: 'SYNTHETIC-CASH' });
  const reminder = offer(ref, 'cash-reminder', '2026-09-16T13:25:01.000Z', { ...first, messageKey: 'cash-reminder', emailSentAt: '2026-09-16T13:25:01.000Z', receivedAt: '2026-09-16T13:25:01.000Z', title: 'Your £12 Uber Cash reminder', expires: '2026-09-30', expiresAt: '2026-09-30T23:59:59', expiryStatus: 'exact', expiryBasis: 'explicit_date' });
  assert.equal(first.offerId, reminder.offerId);
  for (const promo of [first, reminder]) { message(db, ref, promo.messageKey, promo.emailSentAt); upsertOffer(db, promo, seenAt); }
  message(db, ref, 'rejected-newer', '2026-10-01T12:00:00.000Z', { accepted: false });
  db.prepare("UPDATE offers SET message_key = 'rejected-newer', last_sent_at = '2026-10-01T12:00:00.000Z', title = 'Stale rejected terms', expires_at = '2026-12-31T23:59:59', expiry_status = 'estimated' WHERE offer_id = ?").run(first.offerId);
  assert.equal(getOffers(db).length, 0, 'The fixture must reproduce a valid family hidden behind a rejected source pointer');
  reconcileOfferSources(db, { processedMessageKeys: coverage(db), families: new Map([[first.offerId, family(first, reminder)]]) });
  const repaired = row(db, first.offerId);
  assert.equal(repaired.first_sent_at, first.emailSentAt); assert.equal(repaired.last_sent_at, reminder.emailSentAt);
  assert.equal(repaired.message_key, reminder.messageKey); assert.equal(repaired.title, reminder.title);
  assert.equal(repaired.expires_at, reminder.expiresAt); assert.equal(repaired.expiry_status, 'exact');
  const candidate = getOffers(db).find(p => p.offerId === first.offerId);
  assert.ok(candidate, 'Accepted reminder must restore the family to the read model');
  assert.equal(applyOfferExpiryPolicy(candidate).expiresAt, '2026-07-08T17:05:15.000Z', 'September reminder must not restart the June clock');
});

test('A rejected stale explicit deadline cannot survive a latest accepted source with unknown expiry', (db, ref) => {
  const current = offer(ref, 'unknown-expiry-source', '2026-09-18T12:00:00.000Z');
  message(db, ref, current.messageKey, current.emailSentAt); upsertOffer(db, current, seenAt);
  db.prepare("UPDATE offers SET expires = '2026-06-30', expires_at = '2026-06-30T23:59:59', expiry_status = 'exact', expiry_basis = 'old_footer', expiry_confidence = 'high' WHERE offer_id = ?").run(current.offerId);
  reconcileOfferSources(db, { processedMessageKeys: coverage(db), families: new Map([[current.offerId, family(current)]]) });
  const repaired = row(db, current.offerId);
  for (const field of ['expires', 'expires_at', 'expiry_basis', 'expiry_confidence']) assert.equal(repaired[field], null, 'The source no longer supports ' + field);
  assert.equal(repaired.expiry_status, 'unknown');
  assert.equal(applyOfferExpiryPolicy(getOffers(db)[0]).expiresAt, '2026-10-23T12:00:00.000Z');
});

test('A coded unknown-date reminder retains the accepted July deadline and the latest reminder identity', (db, ref) => {
  const known = offer(ref, 'coded-known-deadline', '2026-06-07T12:00:00.000Z', {
    code: 'SYNTHETIC-JULY', expires: '2026-07-03', expiresAt: '2026-07-03T23:59:59',
    expiryStatus: 'exact', expiryBasis: 'explicit_date', expiryConfidence: 'high'
  });
  const reminder = offer(ref, 'coded-unknown-reminder', '2026-08-03T12:00:00.000Z', {
    code: known.code, title: 'Latest reminder of your £12 coupon', evidence: { synthetic: true, latestReminder: true }
  });
  assert.equal(known.offerId, reminder.offerId, 'The known deadline and reminder must belong to the same coded family');
  for (const promo of [known, reminder]) { message(db, ref, promo.messageKey, promo.emailSentAt); upsertOffer(db, promo, seenAt); }
  db.prepare("UPDATE offers SET expires = '2026-12-31', expires_at = '2026-12-31T23:59:59', expiry_basis = 'stale_footer' WHERE offer_id = ?").run(known.offerId);
  const families = new Map([[known.offerId, { firstSentAt: known.emailSentAt, latest: reminder, latestExpiry: known }]]);
  reconcileOfferSources(db, { processedMessageKeys: coverage(db), families });
  const repaired = row(db, known.offerId);
  assert.equal(repaired.first_sent_at, known.emailSentAt); assert.equal(repaired.last_sent_at, reminder.emailSentAt);
  assert.equal(repaired.message_key, reminder.messageKey); assert.equal(repaired.title, reminder.title);
  for (const [field, expected] of [['expires', known.expires], ['expires_at', known.expiresAt], ['expiry_status', known.expiryStatus], ['expiry_basis', known.expiryBasis], ['expiry_confidence', known.expiryConfidence]]) assert.equal(repaired[field], expected, 'Retain accepted known deadline field ' + field);
  const evidence = JSON.parse(repaired.evidence_json);
  for (const [field, expected] of Object.entries(reminder.evidence)) assert.deepEqual(evidence[field], expected, 'Primary evidence still comes from the latest accepted reminder');
  assert.equal(evidence.expirySourceMessageKey, known.messageKey, 'Private evidence identifies the original accepted deadline source');
  const candidate = getOffers(db)[0], effective = applyOfferExpiryPolicy(candidate);
  assert.equal(effective.expiresAt, known.expiresAt);
  assert.ok(expiryEndTime(effective) < Date.parse('2026-07-12T12:00:00.000Z'), 'Explicit July 3 deadline must win over the July 12 35-day cap');
  const stable = snapshot(db);
  reconcileOfferSources(db, { processedMessageKeys: coverage(db), families });
  assert.deepEqual(snapshot(db), stable, 'Retaining an accepted deadline must remain idempotent');
});

test('Missing, rejected or different-family explicit-expiry donors fail before any database changes', (db, ref) => {
  const known = offer(ref, 'accepted-expiry-source', '2026-06-07T12:00:00.000Z', { code: 'SYNTHETIC-EXPIRY-GATE', expires: '2026-07-03', expiresAt: '2026-07-03T23:59:59', expiryStatus: 'exact' });
  const latest = offer(ref, 'accepted-unknown-source', '2026-08-03T12:00:00.000Z', { code: known.code });
  for (const promo of [known, latest]) { message(db, ref, promo.messageKey, promo.emailSentAt); upsertOffer(db, promo, seenAt); }
  message(db, ref, 'rejected-expiry-source', '2026-06-08T12:00:00.000Z', { accepted: false });
  const different = offer(ref, 'different-expiry-family', '2026-06-08T12:00:00.000Z', { code: known.code, discount: 15, expires: known.expires, expiresAt: known.expiresAt, expiryStatus: 'exact' });
  message(db, ref, different.messageKey, different.emailSentAt); upsertOffer(db, different, seenAt);
  const before = snapshot(db);
  for (const [scenario, invalid] of [
    ['missing', { ...known, messageKey: 'expiry-source-that-does-not-exist' }],
    ['rejected', { ...known, messageKey: 'rejected-expiry-source' }],
    ['different-family', different]
  ]) {
    const families = new Map([[latest.offerId, { firstSentAt: known.emailSentAt, latest, latestExpiry: invalid }], [different.offerId, { firstSentAt: different.emailSentAt, latest: different, latestExpiry: different }]]);
    assert.throws(() => reconcileOfferSources(db, { processedMessageKeys: coverage(db), families }), scenario + ': invalid deadline donor must fail the source gate');
    assert.deepEqual(snapshot(db), before, scenario + ': invalid deadline donor must not change any stored data');
  }
});

test('Incremental reimports after complete repair cannot borrow a retained superseded service or count clock', (db, ref) => {
  for (const [scenario, donorTerms] of [
    ['wrong-service', { service: 'Uber', offerType: 'ride_discount' }],
    ['wrong-count', { uses: 96 }]
  ]) {
    const first = offer(ref, scenario + '-first', '2026-09-01T12:00:00.000Z', { code: 'SYNTHETIC-' + scenario });
    const reminder = { ...first, messageKey: scenario + '-reminder', emailSentAt: '2026-09-20T12:00:00.000Z', receivedAt: '2026-09-20T12:00:00.000Z' };
    const donor = offer(ref, reminder.messageKey, '2026-07-01T12:00:00.000Z', { code: first.code, ...donorTerms });
    message(db, ref, first.messageKey, first.emailSentAt);
    message(db, ref, reminder.messageKey, reminder.emailSentAt);
    upsertOffer(db, first, seenAt); upsertOffer(db, donor, seenAt); upsertOffer(db, reminder, seenAt);
    // Reproduce the old derived clock already present in a database being repaired.
    db.prepare('UPDATE offers SET first_sent_at = ? WHERE offer_id = ?').run(donor.emailSentAt, first.offerId);
    assert.equal(row(db, donor.offerId).status, 'parser_superseded');
    const history = row(db, donor.offerId);
    const families = new Map(getOffers(db).map(promo => [promo.offerId, { firstSentAt: promo.firstEmailSentAt, latest: promo }]));
    families.set(first.offerId, family(first, reminder));
    reconcileOfferSources(db, { processedMessageKeys: coverage(db), families });
    assert.equal(row(db, first.offerId).first_sent_at, first.emailSentAt, scenario + ': full repair must first remove the borrowed clock');

    // The hourly incremental path reparses the same late source without reconstruction.
    upsertOffer(db, reminder, '2026-10-09T12:00:00.000Z');
    const retained = row(db, first.offerId);
    assert.equal(retained.first_sent_at, first.emailSentAt, scenario + ': same-source incremental import must retain the canonical first date');
    assert.equal(retained.last_sent_at, reminder.emailSentAt);
    assert.equal(retained.message_key, reminder.messageKey);
    assert.deepEqual(row(db, donor.offerId), history, scenario + ': retained wrong-family evidence must not change');
    assert.equal(applyOfferExpiryPolicy(getOffers(db).find(p => p.offerId === first.offerId)).expiresAt, '2026-10-06T12:00:00.000Z');
    const stable = snapshot(db);
    upsertOffer(db, reminder, '2026-10-09T12:00:00.000Z');
    assert.deepEqual(snapshot(db), stable, scenario + ': another identical incremental import must remain idempotent');
  }
});

test('Partial coverage fails without changing even the first repairable family', (db, ref) => {
  const current = offer(ref, 'covered-current', '2026-09-18T12:00:00.000Z');
  message(db, ref, current.messageKey, current.emailSentAt); upsertOffer(db, current, seenAt);
  message(db, ref, 'unprocessed-other', '2026-06-01T12:00:00.000Z', { accepted: false });
  db.prepare('UPDATE offers SET first_sent_at = ? WHERE offer_id = ?').run('2026-06-01T12:00:00.000Z', current.offerId);
  const before = snapshot(db);
  assert.throws(() => reconcileOfferSources(db, { processedMessageKeys: new Set([current.messageKey]), families: new Map([[current.offerId, family(current)]]) }));
  assert.deepEqual(snapshot(db), before, 'A partial import must never run a source-clock repair');
});

test('Missing preserved body is a failed source gate, with no database changes', (db, ref) => {
  const current = offer(ref, 'missing-body', '2026-09-18T12:00:00.000Z');
  message(db, ref, current.messageKey, current.emailSentAt, { body: null }); upsertOffer(db, current, seenAt);
  db.prepare('UPDATE offers SET first_sent_at = ? WHERE offer_id = ?').run('2026-06-01T12:00:00.000Z', current.offerId);
  const before = snapshot(db);
  assert.throws(() => reconcileOfferSources(db, { processedMessageKeys: coverage(db), families: new Map([[current.offerId, family(current)]]) }));
  assert.deepEqual(snapshot(db), before);
});

test('A missing latest source after a valid family fails atomically and cannot leave a partial repair', (db, ref) => {
  const first = offer(ref, 'valid-first', '2026-09-18T12:00:00.000Z');
  const second = offer(ref, 'valid-second', '2026-09-19T12:00:00.000Z', { discount: 15 });
  for (const promo of [first, second]) { message(db, ref, promo.messageKey, promo.emailSentAt); upsertOffer(db, promo, seenAt); }
  db.prepare('UPDATE offers SET first_sent_at = ?').run('2026-06-01T12:00:00.000Z');
  const missing = { ...second, messageKey: 'source-that-does-not-exist' }, before = snapshot(db);
  assert.throws(() => reconcileOfferSources(db, { processedMessageKeys: coverage(db), families: new Map([[first.offerId, family(first)], [second.offerId, { firstSentAt: second.emailSentAt, latest: missing }]]) }));
  assert.deepEqual(snapshot(db), before, 'A failed later family must roll back any earlier updates');
});

console.log(`\n${passed} complete-source clock regression groups passed.`);
