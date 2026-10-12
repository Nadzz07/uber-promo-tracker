import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {openPrivateDb,ensureAccount,upsertMessage,upsertReceipt,getReceipts,upsertTransportReceipt,getTransportReceipts} from './private-db.js';
import {offerFingerprint,publicOfferIdentity} from './identity.js';
import {migratePrivateOfferIds} from './manual-state.js';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tracker-security-'));
try {
  const db=openPrivateDb(path.join(dir,'private.db'));
  const one=offerFingerprint({accountRef:'A001',discountType:'fixed',discount:12,code:'GUESS'});
  const two=offerFingerprint({accountRef:'A001',discountType:'fixed',discount:12,code:'OTHER'});
  const publicId=publicOfferIdentity(db,one);
  assert.match(publicId,/^pub_[a-f0-9]{32}$/);
  assert.notEqual(publicId,one);
  assert.notEqual(publicId,publicOfferIdentity(db,two));
  assert.equal(publicOfferIdentity(db,one),publicId);
  const account=ensureAccount(db,{alias:'legacy@example.invalid'});
  const forwardedBody='<---------- Forwarded message --------->\nFrom: receipts@uber.com\nTo: legacy@example.invalid\nThanks for your order\nSubtotal £25\nTotal £15';
  for (const [key,body] of [['forwarded',forwardedBody],['direct','Thanks for your order\nSubtotal £25\nTotal £15']]) {
    upsertMessage(db,{messageKey:key,accountRef:account.accountRef,kind:'receipt',subject:'Your order with Uber Eats',bodyText:body,sender:'receipts@uber.com',accepted:true,parsedAt:'2026-10-01T12:00:00Z'});
    upsertReceipt(db,{receiptId:'rcp_'+key,messageKey:key,accountRef:account.accountRef,total:15,sentAt:'2026-10-01T12:00:00Z'});
  }
  db.prepare("DELETE FROM meta WHERE key='forwarded_boundary_v1'").run();
  db.close();
  const reopened=openPrivateDb(path.join(dir,'private.db'));
  assert.equal(publicOfferIdentity(reopened,one),publicId);
  assert.equal(getReceipts(reopened).length,1);
  assert.equal(reopened.prepare('SELECT COUNT(*) n FROM receipts').get().n,2);
  assert.equal(reopened.prepare('SELECT COUNT(*) n FROM source_boundary_reviews').get().n,1);
  for(const [table,kind,write,read,idField,id] of [
    ['receipts','receipt',upsertReceipt,getReceipts,'orderId','order-original'],
    ['transport_receipts','transport_receipt',upsertTransportReceipt,getTransportReceipts,'tripId','trip-original']]){
    const recordId='restored-'+kind;
    upsertMessage(reopened,{messageKey:'unverified-'+kind,accountRef:account.accountRef,kind,subject:'Historical forwarded receipt',sender:'receipts@uber.com',bodyText:forwardedBody,accepted:false,rejectionReason:'forwarded_source_needs_review',parsedAt:'2026-10-10T12:00:00Z'});
    write(reopened,{receiptId:recordId,messageKey:'unverified-'+kind,accountRef:account.accountRef,[idField]:id,promotionDiscount:99,total:9,sentAt:'2026-10-10T12:00:00Z',receivedAt:'2026-10-10T12:00:00Z'});
    assert.equal(read(reopened).some(r=>r.receiptId===recordId),false);
    upsertMessage(reopened,{messageKey:'original-'+kind,accountRef:account.accountRef,kind,subject:'Original receipt',sender:'receipts@uber.com',bodyText:'Independently obtained original',accepted:true,parsedAt:'2026-10-12T12:00:00Z'});
    write(reopened,{receiptId:'new-id-'+kind,messageKey:'original-'+kind,accountRef:account.accountRef,[idField]:id,promotionDiscount:12,total:3,sentAt:'2026-10-01T12:00:00Z',receivedAt:'2026-10-01T12:00:00Z',reparsedSource:true});
    const restored=read(reopened).find(r=>r.receiptId===recordId);assert.equal(restored.promotionDiscount,12);assert.equal(restored.messageKey,'original-'+kind);assert.equal(restored.sentAt,'2026-10-01T12:00:00Z');assert.equal(reopened.prepare('SELECT original_row_json FROM receipt_source_restorations WHERE receipt_id=?').get(recordId).original_row_json.includes('99'),true);
  }
  for(const key of ['rich-copy','sparse-copy'])upsertMessage(reopened,{messageKey:key,accountRef:account.accountRef,kind:'receipt',sender:'receipts@uber.com',subject:'Your receipt',bodyText:'Original duplicate',accepted:true,parsedAt:'2026-10-12T12:00:00Z'});
  const rich={receiptId:'source-pool',messageKey:'rich-copy',accountRef:account.accountRef,orderId:'shared-order',reportedSavings:12.89,uberCashUsed:12,total:13.53,receivedAt:'2026-10-01T12:00:00Z',evidence:{financial:{reportedKind:'combined',outOfPocket:1.53}},reparsedSource:true};
  const sparse={...rich,messageKey:'sparse-copy',reportedSavings:null,uberCashUsed:null,receivedAt:'2026-10-02T12:00:00Z',evidence:{financial:{reportedKind:'total',outOfPocket:null}}};
  for(const sequence of [[rich,sparse],[sparse,rich],[sparse]]){for(const r of sequence)upsertReceipt(reopened,r);const row=getReceipts(reopened).find(r=>r.receiptId==='source-pool');assert.equal(row.reportedSavings,12.89);assert.equal(row.financialEvidence.reportedKind,'combined');assert.equal(row.financialEvidence.outOfPocket,1.53);}
  upsertReceipt(reopened,{...rich,reportedSavings:null,uberCashUsed:null,evidence:{financial:{reportedKind:'total',outOfPocket:null}}});const corrected=getReceipts(reopened).find(r=>r.receiptId==='source-pool');assert.equal(corrected.reportedSavings,null,'The same original can correct an unsupported extraction');assert.equal(corrected.financialEvidence.reportedKind,undefined);
  reopened.close();
  const old={offers:{[one]:{forceDone:true,manualFinishedAt:'2026-10-10T12:00:00Z',history:[{action:'manual_finished'}]}}};
  const migrated=migratePrivateOfferIds(old,[{from:one,to:publicId}]);
  assert.deepEqual(migrated.offers[one],old.offers[one]);
  assert.equal(migrated.offers[publicId].forceDone,true);
  assert.equal(migrated.offers[publicId].manualFinishedAt,old.offers[one].manualFinishedAt);
  assert.equal(migratePrivateOfferIds(migrated,[{from:one,to:publicId}]).offers[publicId].history.length,2);
  const mixed=migratePrivateOfferIds({offers:{...old.offers,[publicId]:{forceDone:false,history:[{action:'undo_manual_finish'}]}}},[{from:one,to:publicId}]);
  assert.equal(mixed.offers[publicId].history.length,3);assert.ok(mixed.offers[publicId].verificationConflict);
  assert.equal(mixed.offers[publicId].forceDone,true);
  const input=path.join(dir,'rows.json'),privateHistory=path.join(dir,'history.local.json'),accounts=path.join(dir,'accounts.local.json');
  fs.writeFileSync(input,'[]');fs.writeFileSync(privateHistory,'{}',{mode:0o644});fs.writeFileSync(accounts,'{}',{mode:0o644});
  const prior=process.umask(0o022);
  try{execFileSync(process.execPath,['migrate-legacy-history.js',input,privateHistory,accounts,path.join(dir,'history.json')],{stdio:'pipe'});}finally{process.umask(prior);}
  assert.equal(fs.statSync(privateHistory).mode&0o777,0o600);assert.equal(fs.statSync(accounts).mode&0o777,0o600);
  let calls=0;
  const context=vm.createContext({Application:()=>{calls++;throw Error('Mail must not be opened');}});
  vm.runInContext(fs.readFileSync('mac/move-inbox-receipts.js','utf8').replace(/^#!.*\n/,''),context);
  assert.throws(()=>context.run(['legacy-plan']),/disabled/);assert.equal(calls,0);
  const common=fs.readFileSync('mac/common.sh','utf8');
  assert.doesNotMatch(common.slice(common.indexOf('file_imported_receipts()')),/osascript|Mail\.move/);
  console.log('✓ Private publication IDs, durable manual-history migration, owner-only legacy outputs and disabled unqualified Mail mutation');
} finally {fs.rmSync(dir,{recursive:true,force:true});}

const {assertPublicSnapshot}=await import('./public-snapshot.js');for(const field of ['financialCorrection','financialEvents','financialEvidence','financial_evidence_json','wallet','wallets','balance','note'])assert.throws(()=>assertPublicSnapshot({promos:[],accounts:[],[field]:{}},{records:[]}),/private field/);console.log('✓ Private financial records, source metadata, notes and wallet balances cannot enter public snapshots');
