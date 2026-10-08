#!/usr/bin/env node
// This command reads the real source, backs it up, and reparses only a COPY.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { backupPrivateDb } from '../private-backup.js';
import { openPrivateDb, getReceipts, getTransportReceipts, getAccounts } from '../private-db.js';
import { assertPublicSnapshot } from '../public-snapshot.js';

const args = process.argv.slice(2);
let source = process.env.TRACKER_PRIVATE_DB || 'uber-tracker.local.db';
let output = 'tracker-validation.local.' + new Date().toISOString().replace(/[:.]/g, '-');
let access = process.env.TRACKER_ACCOUNT_ACCESS || 'account-access.local.csv';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--db') source = args[++i];
  else if (args[i] === '--output-dir') output = args[++i];
  else if (args[i] === '--access') access = args[++i];
  else throw new Error('Use --db, --output-dir and --access; no other arguments are supported.');
}
if (!source || !output || !access || !fs.existsSync(source)) throw new Error('An existing private database is required.');
if (!fs.existsSync(access)) throw new Error('An authoritative private account access CSV is required; this prevents recreating removed accounts.');
source = path.resolve(source); output = path.resolve(output); access = path.resolve(access);
if (fs.existsSync(output)) throw new Error('Output directory already exists; choose a new path to preserve prior verification.');
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const sourceDb = new DatabaseSync(source, { readOnly: true });
let messages, before, missingEvidence;
try {
  if (sourceDb.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Source database integrity check failed; no import performed.');
  before = { eats: sourceDb.prepare('SELECT COUNT(*) AS n FROM receipts').get().n, rides: sourceDb.prepare('SELECT COUNT(*) AS n FROM transport_receipts').get().n };
  messages = sourceDb.prepare(`SELECT m.subject, m.sender, a.alias AS recipient, m.body_text AS body,
    m.sent_at AS sentAt, m.received_at AS receivedAt, m.message_id AS messageId, m.mailbox
    FROM messages m JOIN accounts a ON a.account_ref = m.account_ref
    WHERE m.body_text IS NOT NULL AND m.sender IS NOT NULL`).all();
  missingEvidence = sourceDb.prepare(`SELECT COUNT(*) AS n FROM (
    SELECT message_key FROM receipts UNION ALL SELECT message_key FROM transport_receipts
  ) r LEFT JOIN messages m ON m.message_key = r.message_key
  WHERE m.message_key IS NULL OR m.body_text IS NULL OR m.sender IS NULL`).get().n;
} finally { sourceDb.close(); }
const backup = backupPrivateDb(source);
const copy = path.join(output, 'verification.local.db');
fs.copyFileSync(backup, copy); fs.chmodSync(copy, 0o600);
const exported = path.join(output, 'emails.local.json');
fs.writeFileSync(exported, JSON.stringify({ messages }), { mode: 0o600 });
const promosPath = path.join(output, 'promos.json'), historyPath = path.join(output, 'history.json');
const run = () => execFileSync(process.execPath, ['generate-promos.js', exported, promosPath, historyPath, copy], {
  cwd: path.resolve(import.meta.dirname, '..'), stdio: 'pipe',
  env: { ...process.env, TRACKER_ACCOUNT_ACCESS: access, TRACKER_ALLOW_UNKNOWN_ACCOUNTS: '0' }
});
run();
const first = JSON.parse(fs.readFileSync(promosPath));
run();
const second = JSON.parse(fs.readFileSync(promosPath));
const history = JSON.parse(fs.readFileSync(historyPath));
assertPublicSnapshot(second, history);
if (JSON.stringify(first.accounts) !== JSON.stringify(second.accounts) || first.summary.totalSaved !== second.summary.totalSaved || first.summary.trackedOrders !== second.summary.trackedOrders) throw new Error('Reprocessing is not idempotent.');
const checked = openPrivateDb(copy);
let counts;
try {
  const eats = getReceipts(checked), rides = getTransportReceipts(checked), accounts = getAccounts(checked);
  counts = { eats: eats.length, rides: rides.length, accounts: accounts.length };
  for (const account of second.accounts) {
    if (account.orderCount !== eats.filter(r => r.accountRef === account.accountRef).length || account.rideCount !== rides.filter(r => r.accountRef === account.accountRef).length) throw new Error('Account receipt counter disagrees with SQLite evidence.');
  }
} finally { checked.close(); }
const report = { verifiedAt: new Date().toISOString(), sourceDatabaseUnchanged: true, backupCreated: true,
  storedBefore: before, afterReprocessing: counts, sourceMessagesReparsed: messages.length,
  receiptsWithoutReparseableEvidence: missingEvidence, idempotent: true, publicPrivacyPassed: true,
  confirmedSaved: second.summary.totalSaved, estimatedUberOneSavings: second.summary.estimatedUberOneSavings,
  accountStates: Object.fromEntries(['available', 'used', 'archived', 'expired', 'fully_used', 'needs_checking', 'no_offers'].map(state => [state, second.accounts.filter(a => a.accountState === state).length])),
  limitations: ['Only receipts already stored can be checked here. Missing Mail receipts require read-only recent scan/backfill.', 'Check known order/ride counts and representative savings against original receipts before release.'] };
fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
console.log('Private validation artifacts: ' + output);
console.log('Original private database was not modified. Backup retained.');
if (missingEvidence) { console.error('Release blocked: some historical receipts lack reparseable evidence. Supply the corresponding read-only Mail/MBOX export before release.'); process.exitCode = 1; }
