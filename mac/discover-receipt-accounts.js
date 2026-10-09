#!/usr/bin/env node
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { parseAccessList } from '../access-list.js';
import { discoverReceiptAccounts } from '../account-discovery.js';
const [input, database, access, output, audit] = process.argv.slice(2);
if (![input,database,access,output,audit].every(Boolean) || !/\.local\.csv$/.test(output) || !/\.local\.json$/.test(audit)) throw new Error('Provide input, private DB, authoritative CSV, NEW *.local.csv registry and NEW *.local.json audit.');
if (fs.existsSync(output) || fs.existsSync(audit)) throw new Error('Existing private discovery files are preserved.');
const records = parseAccessList(fs.readFileSync(access,'utf8'));
const db = new DatabaseSync(database,{readOnly:true});
let historical, exclusions;
try { historical = db.prepare('SELECT alias FROM accounts').all().map(a=>a.alias); exclusions = db.prepare('SELECT alias_hash FROM deleted_accounts').all().map(a=>a.alias_hash); } finally { db.close(); }
const discovery = discoverReceiptAccounts(JSON.parse(fs.readFileSync(input)).messages, [...records.map(a=>a.email),...historical],new Set(exclusions));
const rows = [...records,...discovery.accounts];
const csv = 'email,can_login,login_method,account_status\n' + rows.map(a=>[a.email,a.canLogin === null ? 'pending' : String(a.canLogin),a.loginMethod || '',a.accountStatus || (a.canLogin ? 'active':'archived')].join(',')).join('\n')+'\n';
fs.writeFileSync(output,csv,{flag:'wx',mode:0o600});
fs.writeFileSync(audit,JSON.stringify({checkedAt:new Date().toISOString(),existingAccounts:records.length,historicalAccounts:historical.length,exclusionHashes:exclusions.length,...discovery},null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({newReceiptAccounts:discovery.accounts.length,pendingVerification:discovery.accounts.length,blockedForReview:discovery.blocked.length}));
