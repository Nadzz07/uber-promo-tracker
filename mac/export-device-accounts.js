#!/usr/bin/env node
// Read-only export: do not openPrivateDb (which upgrades legacy schemas).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DEVICE_ACCOUNTS_KIND } from '../device-accounts.js';

let source = process.env.TRACKER_PRIVATE_DB || 'uber-tracker.local.db';
let output = 'device-accounts.local.json';
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--db') source = args[++i];
  else if (args[i] === '--output') output = args[++i];
  else throw new Error('Use --db and --output.');
}
if (!source || !output || !fs.existsSync(source)) throw new Error('An existing private database is required.');
source = path.resolve(source); output = path.resolve(output);
if (!/\.local\.json$/.test(output) || fs.existsSync(output)) throw new Error('Choose a NEW *.local.json file; existing exports are never overwritten.');
const db = new DatabaseSync(source, { readOnly: true });
let rows;
try { rows = db.prepare('SELECT account_ref AS accountRef, masked AS accountMasked, alias AS email FROM accounts ORDER BY account_ref').all(); }
finally { db.close(); }
const file = fs.openSync(output, 'wx', 0o600);
try { fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, kind: DEVICE_ACCOUNTS_KIND, accounts: rows }, null, 2) + '\n'); }
finally { fs.closeSync(file); }
console.log('Created private device export (' + rows.length + ' accounts). Keep this file off Git and import it in More → Login emails.');
