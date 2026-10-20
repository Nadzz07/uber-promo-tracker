import assert from 'node:assert/strict';
import {receiptOrderDate,receiptDay} from './receipt-date.js';
import {parseUberEatsReceipt} from './receipt-parser.js';
import {parseUberTransportReceipt} from './transport-receipt-parser.js';
import {receiptActivity} from './dashboard-data.js';
import {receiptFingerprint} from './identity.js';
import {appendFinancialEvent,readFinancialEvents} from './financial-ledger.js';
import {reconcileEatsReceiptSources,openPrivateDb,ensureAccount,upsertMessage,upsertReceipt,getReceipts} from './private-db.js';
const input={sender:'Uber <receipts@uber.com>',recipient:'test@example.invalid',subject:'Your order with Uber Eats'};
const first=parseUberEatsReceipt({...input,body:'Uber Eats. 28 Sept 2026, 15:25. Thanks for ordering. Total £2.47. £15.79 Uber One savings and other promotions applied.',sentAt:'2026-09-29T01:26:00Z',receivedAt:'2026-09-29T01:26:04Z'});
const second=parseUberEatsReceipt({...input,body:'Uber Eats. 29 Sept 2026, 23:52. Thanks for ordering. Total £11.91. £14.79 Uber One savings and other promotions applied.',sentAt:'2026-09-29T23:26:00Z',receivedAt:'2026-09-29T23:26:04Z'});
assert.equal(first.orderAt,'2026-09-28T14:25:00.000Z');
assert.equal(second.orderAt,'2026-09-29T22:52:00.000Z');
assert.deepEqual(receiptActivity([first,second],[],r=>r.reportedSavings).days,[{period:'2026-09-29',eats:1,rides:0,saved:14.79},{period:'2026-09-28',eats:1,rides:0,saved:15.79}]);
assert.equal(receiptOrderDate('28 Oct 2026, 15:25.').orderAt,'2026-10-28T15:25:00.000Z');
assert.equal(receiptOrderDate('29 March 2026, 01:30.').dateBasis,'order_date_time_needs_checking');
assert.equal(receiptOrderDate('25 October 2026, 01:30.').dateBasis,'order_date_time_needs_checking');
assert.equal(receiptOrderDate('31 February 2026.').dateBasis,'email_fallback');
assert.equal(receiptOrderDate('No order date stated.').orderDate,null);
assert.equal(receiptDay({sentAt:'2026-09-29T23:26:00Z'}),'2026-09-30','Fallback uses UK day rather than UTC day');
const ride=parseUberTransportReceipt({...input,subject:'Your trip with Uber',body:'Thanks for riding with Uber. 28 Sept 2026. 23:50 pickup. 23:59 drop off. Total £8.',sentAt:'2026-09-30T12:00:00Z'});
assert.equal(ride.orderDate,'2026-09-28');assert.equal(ride.orderAt,null,'Date-only evidence never gains an invented time');
const db=openPrivateDb(':memory:');try{
 const account=ensureAccount(db,{alias:input.recipient});
 const save=(r,key)=>{upsertMessage(db,{messageKey:key,accountRef:account.accountRef,kind:'receipt',accepted:true,parsedAt:first.receivedAt});upsertReceipt(db,{...r,receiptId:'receipt-preserved',accountRef:account.accountRef,messageKey:key});};
 save(first,'original');save({...first,receivedAt:'2026-09-30T12:00:00Z',orderDate:null,orderAt:null},'sparse');
 const receipt=getReceipts(db)[0];assert.equal(receipt.orderDate,'2026-09-28');assert.equal(receipt.sentAt,first.sentAt);assert.equal(receipt.receivedAt,'2026-09-30T12:00:00Z');
 save({...first,orderDate:'2026-09-27'},'conflict');assert.equal(getReceipts(db)[0].dateBasis,'conflicting_order_dates');
}finally{db.close();}
console.log('✓ Purchase dates, separate Mail timestamps, UK DST, fallback flags, sparse copies and conflicts');

// Synthetic separate purchases can share pickup/delivery windows. A source
// reparse must recover the missing order without losing the old record/history.
{
 const fixture=time=>parseUberEatsReceipt({...input,body:`17 Oct 2026, 13:${time}. Thanks for ordering. Total £${time==='00'?'7':'8'}. Order details. 14:00 pickup. 14:20 delivery.`,sentAt:`2026-10-18T00:${time}:00Z`,receivedAt:`2026-10-18T00:${time}:01Z`});
 const a=fixture('00'),b=fixture('05');assert.notEqual(a.orderKey,b.orderKey);assert.equal(fixture('00').orderKey,a.orderKey);
 const db=openPrivateDb(':memory:');try{const account=ensureAccount(db,{alias:'distinct-orders@example.invalid'}),legacyKey=a.orderKey.replace(/^placed=[^|]+\|/,'');
 const source=(r,key)=>{upsertMessage(db,{messageKey:key,accountRef:account.accountRef,sender:input.sender,subject:input.subject,bodyText:'Synthetic receipt without adjustment',sentAt:r.sentAt,receivedAt:r.receivedAt,kind:'receipt',accepted:true,parsedAt:r.receivedAt});return {...r,accountRef:account.accountRef,messageKey:key,reparsedSource:true}};
 const first=source(a,'first'),second=source(b,'second');upsertReceipt(db,{...first,receiptId:'legacy',orderKey:legacyKey});upsertReceipt(db,{...second,receiptId:'legacy',orderKey:legacyKey});assert.equal(getReceipts(db).length,1);
 appendFinancialEvent(db,{kind:'receipt',recordId:'legacy',accountRef:account.accountRef,action:'set',value:{total:2,breakdown:{eatsPromotions:2}}});const history=JSON.stringify(readFinancialEvents(db));
 const assigned=[first,second].map(r=>({...r,receiptId:upsertReceipt(db,{...r,receiptId:receiptFingerprint(r)})}));
 const copy=source({...a,receivedAt:'2026-10-19T00:00:00Z'},'copy');copy.receiptId=upsertReceipt(db,{...copy,receiptId:receiptFingerprint(copy)});assigned.push(copy);
 assert.throws(()=>reconcileEatsReceiptSources(db,new Set(['first']),assigned),/Complete/);
 const result=reconcileEatsReceiptSources(db,new Set(['first','second','copy']),assigned);assert.equal(result.reassignedSources,1);assert.equal(getReceipts(db).length,2);assert.deepEqual(getReceipts(db).map(r=>r.total).sort(),[7,8]);assert.equal(db.prepare('SELECT total FROM receipts WHERE receipt_id=?').get('legacy').total,8);assert.equal(JSON.stringify(readFinancialEvents(db)),history,'Existing correction history keeps its durable record');assert.equal(db.prepare('SELECT COUNT(*) n FROM eats_receipt_source_repairs').get().n,1);assert.equal(reconcileEatsReceiptSources(db,new Set(['first','second','copy']),assigned).reassignedSources,0);
 }finally{db.close()}
}
console.log('✓ Distinct purchase times separate equal delivery windows; duplicate copies, legacy record IDs, source journals and financial history survive complete idempotent reconstruction.');

{
 const db=openPrivateDb(':memory:');try{const account=ensureAccount(db,{alias:'legacy-copy@example.invalid'}),body='17 Oct 2026, 12:10. Thanks for ordering. Total £9. Order details. 13:00 pickup. 13:20 delivery.',parsed=parseUberEatsReceipt({...input,body,sentAt:'2026-10-18T00:00:00Z'}),sources=[];
 for(const key of ['original-copy','later-copy']){upsertMessage(db,{messageKey:key,accountRef:account.accountRef,sender:input.sender,subject:input.subject,bodyText:body,sentAt:parsed.sentAt,receivedAt:parsed.receivedAt,kind:'receipt',accepted:true,parsedAt:parsed.receivedAt});const r={...parsed,accountRef:account.accountRef,messageKey:key,reparsedSource:true};sources.push(r);upsertReceipt(db,{...r,receiptId:'durable-copy',orderKey:r.orderKey.replace(/^placed=[^|]+\|/,'')});}
 for(const r of sources)r.receiptId=upsertReceipt(db,{...r,receiptId:receiptFingerprint(r)});
 assert.equal(reconcileEatsReceiptSources(db,new Set(sources.map(r=>r.messageKey)),sources).reassignedSources,0);assert.equal(getReceipts(db).length,1,'The stronger key never duplicates legacy copies of one purchase');assert.equal(getReceipts(db)[0].receiptId,'durable-copy');
 }finally{db.close()}
}
console.log('✓ Legacy duplicate copies retain one durable receipt when the parsed purchase time agrees.');

assert.equal(receiptDay({orderAt:'2026-10-09T23:30:00Z',sentAt:'2026-10-12T12:00:00Z'}),'2026-10-10','An imported order timestamp supplies the UK receipt day before a later email timestamp');
