import assert from 'node:assert/strict';
import {receiptOrderDate,receiptDay} from './receipt-date.js';
import {parseUberEatsReceipt} from './receipt-parser.js';
import {parseUberTransportReceipt} from './transport-receipt-parser.js';
import {receiptActivity} from './dashboard-data.js';
import {openPrivateDb,ensureAccount,upsertMessage,upsertReceipt,getReceipts} from './private-db.js';
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
