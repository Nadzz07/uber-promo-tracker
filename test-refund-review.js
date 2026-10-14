import assert from 'node:assert/strict';
import {receiptReviewEvidence} from './receipt-review-evidence.js';
import {receiptFinancials,financialSummary,financialEditHistory} from './receipt-financials.js';
import {openPrivateDb,ensureAccount,upsertMessage,upsertReceipt,upsertTransportReceipt,getReceipts,getTransportReceipts} from './private-db.js';
import {PrivateFinanceVault,decryptFinance} from './private-finance-vault.js';
import {mergeFinancialEvents,readFinancialEvents} from './financial-ledger.js';
import {assertPublicSnapshot} from './public-snapshot.js';

const original='Total £4.33\nMeal fare £15.40\nPromotion -£12.00';
const adjusted='Adjusted receipt\nYour refund has been applied.\nMeal fare £15.40\nPromotion -£12.00\nRefund adjustment -£4.33\nPrevious total £4.33\nRefund -£4.33\nNew Total £0.00';
const evidence=receiptReviewEvidence([{body:original},{body:adjusted}]);
assert.deepEqual(evidence.reasons,['adjusted_receipt','changed_total','refund']);
assert.equal(receiptReviewEvidence([{body:'Total £0.00\nCongrats! You have £10 off on your first ride\nTrip fare £7.94\nPromotion -£7.94'}]),null,'An offer ceiling is not an adjustment or extra saving');
assert.equal(receiptReviewEvidence([{body:'Total £5.62\nFor a refund, please contact support.'}]),null,'Generic refund help does not flag a receipt');
assert.deepEqual(receiptReviewEvidence([{body:'Total £5.62'},{body:'Total £0.00'}]).reasons,['changed_total']);
assert.equal(receiptReviewEvidence([{body:original},{body:adjusted},{body:'<div>'+adjusted.replaceAll('\n','</div><div>')+'</div>'}]).revision,evidence.revision,'Duplicate presentation does not reopen a reviewed financial revision');
const receipt={receiptId:'review-receipt',accountRef:'A001',service:'Uber Eats',promotionDiscount:12,total:0,financialReview:evidence};
const reviewed={total:12,outOfPocket:0,reviewedReceiptRevision:evidence.revision};
assert.equal(receiptFinancials(receipt).total,12);
assert.equal(receiptFinancials(receipt).needsAdjustmentReview,true);
assert.equal(receiptFinancials(receipt,{total:12,outOfPocket:0}).needsAdjustmentReview,true,'Older corrections cannot silently resolve new refund evidence');
assert.equal(receiptFinancials(receipt,{total:12,reviewedReceiptRevision:evidence.revision}).needsAdjustmentReview,true,'Final payment is required');
assert.equal(receiptFinancials(receipt,reviewed).needsAdjustmentReview,false,'A known final £0 is valid');
assert.equal(receiptFinancials({...receipt,financialReview:{...evidence,revision:'b'.repeat(64)}},reviewed).needsAdjustmentReview,true,'New financial evidence reopens review');
const unknown={...receipt,receiptId:'unknown-review',promotionDiscount:null};
const summary=financialSummary([receipt,unknown,receipt]);
assert.equal(summary.missing,2);assert.equal(summary.missingSavings,1);assert.equal(summary.adjustmentsNeedingReview,2);assert.equal(summary.total,12,'Review flags never change savings');
assert.equal(receiptFinancials(unknown).outOfPocket,null,'Missing payment details remain unknown');
assert.throws(()=>assertPublicSnapshot({promos:[],accounts:[],financialReview:evidence},{records:[]}),/private field/);

const db=openPrivateDb(':memory:');
try {
 const account=ensureAccount(db,{alias:'test@example.invalid'});
 for(const [kind,write,read,identity] of [['receipt',upsertReceipt,getReceipts,'orderId'],['transport_receipt',upsertTransportReceipt,getTransportReceipts,'tripId']]){
  const record={...receipt,financialReview:undefined,receiptId:kind+'-test',accountRef:account.accountRef,[identity]:kind+'-original',receivedAt:'2026-10-01T12:00:00Z'};
  for(const [key,body,accepted] of [['original',original,true],['adjusted',adjusted,true],['untrusted','Refund -£99.00',false]]) {
   upsertMessage(db,{messageKey:kind+key,accountRef:account.accountRef,kind,sender:'receipts@uber.com',subject:'Your receipt',bodyText:body,accepted,parsedAt:'2026-10-01T12:00:00Z'});
   write(db,{...record,messageKey:kind+key,reparsedSource:true});
  }
  // Restore the current trusted source; old trusted projections remain reviewable.
  write(db,{...record,messageKey:kind+'original',reparsedSource:true});
  assert.deepEqual(read(db)[0].financialReview,evidence);
  assert.equal(read(db)[0].promotionDiscount,12);
 }
 assert.equal(db.prepare('SELECT COUNT(*) n FROM messages').get().n,6);
 assert.equal(db.prepare("SELECT body_text FROM messages WHERE message_key='receiptadjusted'").get().body_text,adjusted,'Review never rewrites originals');
} finally {db.close();}

const saved=new Map(),storage={getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)};
const vault=new PrivateFinanceVault(storage),data={kind:'uber-tracker-private-finance',schemaVersion:1,receiptReviewVersion:1,accounts:[{accountRef:'A001'}],receipts:[receipt],events:[]};
await vault.unlock('test passphrase only');await vault.import(data);
const set=(kind,value)=>vault.append({kind,recordId:kind==='receipt'?receipt.receiptId:'A001',accountRef:'A001',action:'set',value});
await set('receipt',{total:10});await set('receipt',reviewed);await set('cash',{balance:12});
await vault.changeHistory('receipt',receipt.receiptId,'undo');assert.equal(vault.current().corrections[receipt.receiptId].total,10);assert.equal(receiptFinancials(receipt,vault.current().corrections[receipt.receiptId]).needsAdjustmentReview,true);
await vault.changeHistory('receipt',receipt.receiptId,'redo');assert.equal(vault.current().corrections[receipt.receiptId].total,12);assert.equal(vault.current().wallets.A001.balance,12);
vault.lock();await vault.unlock('test passphrase only');await vault.changeHistory('receipt',receipt.receiptId,'undo');await vault.changeHistory('receipt',receipt.receiptId,'undo');assert.equal(vault.current().corrections[receipt.receiptId],undefined);
await vault.changeHistory('receipt',receipt.receiptId,'redo');assert.equal(vault.current().corrections[receipt.receiptId].total,10);
await set('receipt',{total:11});assert.equal(vault.editHistory('receipt',receipt.receiptId).redo,null,'A new edit clears that record’s redo');
const verifiedCashAt=vault.current().wallets.A001.at;await vault.changeHistory('cash','A001','undo');assert.equal(vault.current().wallets.A001,undefined);await vault.changeHistory('cash','A001','redo');assert.equal(vault.current().wallets.A001.balance,12);assert.equal(vault.current().wallets.A001.at,verifiedCashAt,'Undo/redo never renews Cash verification');
const ledger=openPrivateDb(':memory:');try{const account=ensureAccount(ledger,{alias:'test@example.invalid'});assert.equal(account.accountRef,'A001');upsertReceipt(ledger,{receiptId:receipt.receiptId,accountRef:'A001'});mergeFinancialEvents(ledger,vault.data.events);assert.deepEqual(readFinancialEvents(ledger),vault.data.events,'Undo/redo metadata survives Mac transfer');assert.deepEqual(financialEditHistory(readFinancialEvents(ledger),'receipt',receipt.receiptId),vault.editHistory('receipt',receipt.receiptId));mergeFinancialEvents(ledger,vault.data.events);}finally{ledger.close();}
const before=vault.data,ciphertext=vault.encryptedBackup();vault.storage={...storage,setItem(){throw Error('quota');}};await assert.rejects(()=>vault.resetReceiptCorrections(),/quota/);assert.equal(vault.data,before);assert.equal(vault.encryptedBackup(),ciphertext);
vault.storage=storage;await vault.resetReceiptCorrections();assert.ok(vault.data.events.every(e=>e.kind==='cash'));assert.deepEqual(vault.data.receipts,data.receipts);assert.deepEqual(vault.data.accounts,data.accounts);assert.equal(vault.current().wallets.A001.balance,12);assert.equal(vault.current().corrections[receipt.receiptId],undefined);
await vault.import({...data,receiptReviewVersion:undefined,receipts:[{...receipt,financialReview:undefined}]});assert.deepEqual(vault.data.receipts[0].financialReview,evidence,'An older transfer cannot discard refund review flags');
assert.deepEqual((await decryptFinance(JSON.parse(vault.encryptedBackup()),'test passphrase only')).events,vault.data.events);
vault.lock();await assert.rejects(()=>vault.resetReceiptCorrections(),/Unlock/);
console.log('✓ Refund/adjusted evidence, trusted source history, stable review revisions, known final payment, unchanged financial totals, private metadata; durable undo/redo, Mac round-trip and receipt-only encrypted reset');
