import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { discoverReceiptAccounts } from './account-discovery.js';
import { parseAccessList } from './access-list.js';
const alias='new@example.invalid';
const receipt={sender:'Uber Eats <receipts@uber.com>',recipient:alias,subject:'Your receipt from Example Kitchen',body:'Thanks for your order\nSubtotal £25.00\nPromotion -£10.00\nTotal £15.00',sentAt:'2026-10-09T12:00:00Z',receivedAt:'2026-10-09T12:00:00Z',messageId:'<new@uber.com>',originalHeaders:'From: Uber Eats <receipts@uber.com>\nTo: <new@example.invalid>\nMessage-ID: <new@uber.com>'};
let result=discoverReceiptAccounts([receipt,receipt],[],new Set());
assert.equal(result.accounts.length,1);assert.equal(result.accounts[0].canLogin,null);assert.equal(result.accounts[0].loginMethod,null);assert.equal(result.accounts[0].accountStatus,'active');
assert.equal(discoverReceiptAccounts([receipt],[alias]).accounts.length,0,'Existing/deactivated registry entries never change');
result=discoverReceiptAccounts([receipt],[],new Set([createHash('sha256').update(alias).digest('hex')]));
assert.equal(result.accounts.length,0);assert.equal(result.blocked[0].reason,'intentional_exclusion');
for(const change of [{originalHeaders:''},{originalHeaders:receipt.originalHeaders.replace(alias,'relay@example.invalid')},{originalHeaders:receipt.originalHeaders.replace('receipts@uber.com','receipts@evil.invalid')},{messageId:'<different@uber.com>'},{subject:'Fwd: Your receipt from Example Kitchen'}]) assert.equal(discoverReceiptAccounts([{...receipt,...change}],[]).accounts.length,0,'Uncorroborated or forwarded accounts need review');
assert.equal(discoverReceiptAccounts([{...receipt,subject:'£10 off',body:'Get £10 off your next order. Minimum spend £15.'}],[]).accounts.length,0,'Promo-only accounts are never discovered');
const parsed=parseAccessList('email,can_login,login_method,account_status\nnew@example.invalid,pending,,active\n');assert.equal(parsed[0].canLogin,null);assert.equal(parsed[0].loginMethod,null);
console.log('✓ Direct original receipt account discovery: pending access, exclusion protection, no relay/forward guesses and no promo-only additions');

// The real importer must preserve pending access through SQLite and public counters.
const {default:fs}=await import('node:fs');const {default:os}=await import('node:os');const {default:path}=await import('node:path');const {execFileSync}=await import('node:child_process');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tracker-pending-import-'));
try {
 const access=path.join(dir,'access.csv'),input=path.join(dir,'mail.json'),pub=path.join(dir,'promos.json'),history=path.join(dir,'history.json');
 fs.writeFileSync(access,'email,can_login,login_method,account_status\n'+alias+',pending,,active\n');
 const messages=Array.from({length:5},(_,i)=>({...receipt,messageId:'<pending-'+i+'@uber.com>',sentAt:new Date(Date.parse(receipt.sentAt)+i*60000).toISOString(),receivedAt:new Date(Date.parse(receipt.receivedAt)+i*60000).toISOString()}));
 messages.push({...receipt,messageId:'<pending-promo@uber.com>',subject:'£12 off on 5 orders',body:'Get £12 off each of your next 5 orders. Minimum spend £15. Valid until 14 October 2026.'});
 fs.writeFileSync(input,JSON.stringify({messages}));
 execFileSync(process.execPath,['generate-promos.js',input,pub,history,path.join(dir,'private.db')],{stdio:'pipe',env:{...process.env,TRACKER_ACCOUNT_ACCESS:access,TRACKER_ALLOW_UNKNOWN_ACCOUNTS:'0',TRACKER_PRIVATE_DB:path.join(dir,'private.db')}});
 const snapshot=JSON.parse(fs.readFileSync(pub));assert.equal(snapshot.accounts.length,1);const a=snapshot.accounts[0];assert.equal(a.canLogin,null);assert.equal(a.accessStatus,'pending');assert.equal(a.accountUsed,true);assert.equal(a.archived,false);assert.equal(a.recommendationEligible,false);assert.equal(snapshot.summary.pendingAccessAccounts,1);assert.equal(snapshot.summary.accessibleAccounts,0);assert.equal(snapshot.summary.inaccessibleAccounts,0);assert.equal(snapshot.summary.availableAccounts,0);assert.equal(snapshot.summary.trackedOrders,5);
 console.log('✓ Pending access survives the real Mail importer, completed account receipts and public export without granting access or archiving');
} finally {fs.rmSync(dir,{recursive:true,force:true});}
