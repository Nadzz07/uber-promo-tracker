#!/usr/bin/env node
// Called under the sync lock. Only original-header-verified receipt accounts
// enter the private registry, with pending access and an unset login method.
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {parseAccessList} from '../access-list.js';
import {discoverReceiptAccounts} from '../account-discovery.js';
process.umask(0o077);
const [input,database,access]=process.argv.slice(2);
if(!input||!database||!access||!fs.existsSync(database)||!fs.existsSync(access))throw Error('Existing private input, database and authoritative access list are required.');
const original=fs.readFileSync(access),text=original.toString('utf8'),records=parseAccessList(text);
const db=new DatabaseSync(database,{readOnly:true});let historical,deleted;
try{historical=db.prepare('SELECT alias FROM accounts').all().map(a=>a.alias);deleted=db.prepare('SELECT alias_hash FROM deleted_accounts').all().map(a=>a.alias_hash);}finally{db.close();}
const result=discoverReceiptAccounts(JSON.parse(fs.readFileSync(input)).messages,[...records.map(a=>a.email),...historical],new Set(deleted));
if(result.accounts.length||result.blocked.length){
 const dir=fs.mkdtempSync(path.join(path.dirname(path.resolve(access)),'receipt-discovery.local.'));fs.chmodSync(dir,0o700);
 fs.writeFileSync(path.join(dir,'review.local.json'),JSON.stringify({checkedAt:new Date().toISOString(),...result},null,2),{mode:0o600});
 if(result.accounts.length){
  // Preserve existing rows, notes and column order verbatim. Unsupported CSV
  // headers stop discovery rather than rewriting the user's registry.
  const header=text.replace(/^\uFEFF/,'').split(/\r?\n/).find(line=>line.trim()&&!line.startsWith('#'));
  const columns=header.split(',').map(s=>s.trim().replace(/^"|"$/g,'').toLowerCase());
  if(!columns.includes('email')||!columns.some(c=>c==='can_login'||c==='login status'))throw Error('Account discovery requires a named CSV header.');
  const rows=result.accounts.map(a=>columns.map(c=>c==='email'?a.email:c==='can_login'||c==='login status'?'pending':c==='account_status'||c==='account status'?'active':'').join(','));
  const updated=text+(text.endsWith('\n')?'':'\n')+rows.join('\n')+'\n';const checked=parseAccessList(updated);
  if(checked.length!==records.length+result.accounts.length||JSON.stringify(checked.slice(0,records.length))!==JSON.stringify(records))throw Error('Discovery changed existing access classifications.');
  fs.writeFileSync(path.join(dir,'account-access-before.local.csv'),original,{mode:0o600});
  if(!fs.readFileSync(access).equals(original))throw Error('Account registry changed concurrently.');
  const temporary=path.join(dir,'account-access-next.local.csv');fs.writeFileSync(temporary,updated,{mode:0o600});fs.renameSync(temporary,access);
 }
}
console.log(JSON.stringify({newReceiptAccounts:result.accounts.length,pendingVerification:result.accounts.length,blockedForReview:result.blocked.length}));
