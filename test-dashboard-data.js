import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {backupPrivateDb,compressPrivateBackup} from './private-backup.js';
import { parseAccessList } from './access-list.js';
import { syncState, receiptActivity } from './dashboard-data.js';
import { openPrivateDb, setAccountAccess, getAccounts, upsertTransportReceipt, getTransportReceipts, reconcileTransportReceiptIdentities } from './private-db.js';
import { parseUberTransportReceipt } from './transport-receipt-parser.js';
import { classifyAccount, accountStatusLabel } from './account-state.js';
import { confirmedReceiptSaving, estimateReceiptSavings } from './savings-intelligence.js';

const now=Date.parse('2026-10-09T12:00:00Z');
assert.equal(syncState({}, {now}).label,'Snapshot');
assert.equal(syncState({lastSuccessfulMailScanAt:'2026-10-09T11:00:00Z'},{now}).label,'Up to date');
assert.equal(syncState({lastSuccessfulMailScanAt:'2026-10-09T08:00:00Z'},{now}).label,'Stale');
assert.equal(syncState({lastSuccessfulMailScanAt:'2026-10-10T12:00:00Z'},{now}).label,'Snapshot');
assert.equal(syncState({state:'syncing',startedAt:'2026-10-09T11:50:00Z'},{now}).label,'Syncing');
assert.equal(syncState({state:'syncing',startedAt:'2026-10-09T10:00:00Z'},{now}).label,'Snapshot');
assert.equal(syncState({state:'failed'},{now}).label,'Attention');
console.log('✓ Sync state uses actual Mail completion, handles stale/future times and never invents a live feed');

const rows=parseAccessList('email,can_login,account_status\nold@example.test,false,deactivated\ncurrent@example.test,true,active');
assert.equal(rows[0].accountStatus,'deactivated');
assert.throws(()=>parseAccessList('email,can_login,account_status\nold@example.test,true,deactivated'),/Deactivated/);
assert.throws(()=>parseAccessList('email,can_login,account_status\nold@example.test,false,deactivated\nold@example.test,false,active'),/Conflicting/);
const db=openPrivateDb(':memory:');
try {
  for(const row of rows) setAccountAccess(db,row.email,row.canLogin,row.loginMethod,row.accountStatus);
  const old=getAccounts(db).find(a=>a.deactivated);
  assert.equal(old.canLogin,false);
  assert.throws(()=>setAccountAccess(db,old.alias,true),/Deactivated/);
  const classified={...old,...classifyAccount({...old,orderCount:0,rideCount:0},[{trackingState:'available',usesRemaining:5}])};
  assert.equal(classified.accountState,'archived');
  assert.equal(classified.recommendationEligible,false);
  assert.match(accountStatusLabel(classified),/Deactivated/);
} finally { db.close(); }
console.log('✓ Restored deactivated accounts retain explicit status and cannot enter usable opportunities');

const eats=[{accountRef:'A001',receiptId:'e1',sentAt:'2026-09-01T12:00:00Z',promotionDiscount:12,reportedSavings:15,uberCashUsed:20,uberOneSignal:true}];
const rides=[{sentAt:'2026-09-02T12:00:00Z',promotionDiscount:5,transportMode:'bike'}];
const activity=receiptActivity(eats,rides,confirmedReceiptSaving);
assert.deepEqual(activity.months,[{period:'2026-09',eats:1,rides:1,saved:20}]);
const summary=estimateReceiptSavings(eats,{now:new Date(now)}).summary;
assert.equal(summary.totalSaved,15);
assert.equal(summary.uberOneEstimateModel.status,'insufficient_evidence');
assert.equal(summary.estimatedUberOneSavings,0);
assert.match(summary.uberOneEstimateModel.explanation,/does not mean no Uber One/);
console.log('✓ Activity includes Lime classification and counts combined savings once, excluding Cash payments');

const plain='Thanks for riding with Uber. 4 Jul 2026. 17:45 pickup. 18:07 drop off. 3.49 miles. 13 minutes. Total £9.95.';
const repeated=plain.replace('17:45 pickup.','17:45 pickup. 17:45 pickup.');
const message={subject:'Your trip with Uber',sender:'Uber <receipts@uber.com>',recipient:'rider@example.test',receivedAt:'2026-07-04T18:10:00Z'};
assert.equal(parseUberTransportReceipt({...message,body:plain}).tripKey,parseUberTransportReceipt({...message,body:repeated}).tripKey);
assert.equal(parseUberTransportReceipt({...message,body:plain}).tripKey,parseUberTransportReceipt({...message,body:plain.replace('4 Jul 2026','Saturday, 4 July 2026')}).tripKey);
const identityDb=openPrivateDb(':memory:');
try {
 setAccountAccess(identityDb,message.recipient,true);
 const account=getAccounts(identityDb)[0];
 const trip={accountRef:account.accountRef,tripKey:'date=4 jul 2026|startTime=17:45|endTime=18:07|distance=3.49 miles|duration=13 min',sentAt:'2026-07-04T18:10:00Z',receivedAt:'2026-07-04T18:10:01Z',total:9.95};
 upsertTransportReceipt(identityDb,{...trip,receiptId:'legacy',messageKey:'first'});
 upsertTransportReceipt(identityDb,{...trip,receiptId:'changed-rendering',messageKey:'second'});
 assert.equal(identityDb.prepare('SELECT COUNT(*) AS n FROM transport_receipts').get().n,1);
 // Model two rows retained from a pre-fix database; only complete evidence can merge them.
 identityDb.prepare("UPDATE transport_receipts SET trip_key=NULL,message_key='first'").run();
 upsertTransportReceipt(identityDb,{...trip,receiptId:'duplicate',messageKey:'second'});
 identityDb.prepare('UPDATE transport_receipts SET trip_key=?').run(trip.tripKey);
 assert.throws(()=>reconcileTransportReceiptIdentities(identityDb,new Set(['first'])),/coverage/);
 assert.equal(identityDb.prepare('SELECT COUNT(*) AS n FROM transport_receipts').get().n,2);
 assert.equal(reconcileTransportReceiptIdentities(identityDb,new Set(['first','second'])).mergedDerivedRows,1);
 assert.equal(identityDb.prepare('SELECT COUNT(*) AS n FROM receipt_identity_repairs').get().n,1);
 assert.equal(reconcileTransportReceiptIdentities(identityDb,new Set(['first','second'])).mergedDerivedRows,0);
 const sources=[
  {...trip,service:'Uber',messageKey:'first',promotionDiscount:10,receivedAt:'2026-07-04T18:10:01Z'},
  {...trip,service:'Uber',messageKey:'second',promotionDiscount:null,receivedAt:'2026-07-04T18:10:02Z'}
 ];
 identityDb.prepare('UPDATE transport_receipts SET uber_cash_savings=99').run();
 reconcileTransportReceiptIdentities(identityDb,new Set(['first','second']),sources);
 assert.equal(getTransportReceipts(identityDb)[0].promotionDiscount,10,'A sparse later copy must preserve explicitly evidenced savings');
 assert.equal(getTransportReceipts(identityDb)[0].uberCashSavings,null,'Unsupported stale components must be cleared');
 sources.push({...trip,service:'Uber',messageKey:'third',promotionDiscount:0,receivedAt:'2026-07-04T18:10:03Z'});
 reconcileTransportReceiptIdentities(identityDb,new Set(['first','second','third']),sources);
 assert.equal(getTransportReceipts(identityDb)[0].promotionDiscount,0,'An explicit later zero must override earlier savings');
} finally { identityDb.close(); }
console.log('✓ Repeated HTML times match plain receipts; legacy duplicates require complete evidence and retain a recovery journal');

const folder=fs.mkdtempSync(path.join(os.tmpdir(),'tracker-backup-compression-'));
try {
 const source=path.join(folder,'private.db'),live=openPrivateDb(source);
 try {setAccountAccess(live,'synthetic@example.test',false);} finally {live.close();}
 const original=fs.readFileSync(source),backup=backupPrivateDb(source),snapshot=fs.readFileSync(backup);
 const compressed=await compressPrivateBackup(backup);
 assert.deepEqual(gunzipSync(fs.readFileSync(compressed)),snapshot);
 assert.deepEqual(fs.readFileSync(source),original);
 assert.equal(fs.existsSync(backup),false);
 assert.equal(fs.statSync(compressed).mode&0o777,0o600);
 await assert.rejects(compressPrivateBackup(source),/generated backup/);
 assert.deepEqual(fs.readFileSync(source),original);
} finally {fs.rmSync(folder,{recursive:true,force:true});}
console.log('✓ Backup compression is lossless, owner-only and cannot replace the source database');
