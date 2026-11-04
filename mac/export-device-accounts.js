#!/usr/bin/env node
// Read-only export: do not openPrivateDb (which upgrades legacy schemas).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DEVICE_ACCOUNTS_KIND } from '../device-accounts.js';
import { keyedPublicOfferId } from '../identity.js';

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
let rows, offerIdMigrations = [];
try {
  const columns=new Set(db.prepare('PRAGMA table_info(accounts)').all().map(r=>r.name));
  rows=db.prepare("SELECT account_ref AS accountRef, masked AS accountMasked, alias AS email,"+(columns.has('login_access')?" CASE WHEN login_access='pending' THEN NULL ELSE can_login END":" NULL")+" AS canLogin,"+(columns.has('login_method')?'login_method':'NULL')+" AS loginMethod FROM accounts ORDER BY account_ref").all();
  const roster=db.prepare("SELECT value FROM meta WHERE key='account_roster_refs_v1'").get()?.value;
  if(roster){const wanted=new Set(JSON.parse(roster));rows=rows.filter(a=>wanted.has(a.accountRef));if(rows.length!==wanted.size)throw Error('Replacement account identities are incomplete.');}
  const hasEvidence=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='account_login_fields'").get();
  for(const row of rows){row.canLogin=row.canLogin==null?null:Boolean(row.canLogin);if(hasEvidence){row.loginReview=Object.fromEntries(db.prepare('SELECT field,status,source,confirmed_at AS confirmedAt,recorded_at AS recordedAt FROM account_login_fields WHERE account_ref=?').all(row.accountRef).map(({field,...record})=>[field,record]));}else{row.loginReview={access:{status:'pending',rawValue:row.canLogin},method:{status:'pending',rawValue:row.loginMethod}};row.canLogin=null;row.loginMethod=null;}}
  const key = db.prepare("SELECT value FROM meta WHERE key='public_offer_identity_key'").get()?.value;
  if (key) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid publication key.');
    offerIdMigrations = db.prepare('SELECT offer_id FROM offers').all().map(r => ({from:r.offer_id,to:keyedPublicOfferId(key,r.offer_id)}));

  }
}
finally { db.close(); }
const file = fs.openSync(output, 'wx', 0o600);
try { fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, kind: DEVICE_ACCOUNTS_KIND, accounts: rows, offerIdMigrations }, null, 2) + '\n'); }
finally { fs.closeSync(file); }
console.log('Created private device export (' + rows.length + ' accounts). Keep this file off Git and import it in More → Login emails.');
