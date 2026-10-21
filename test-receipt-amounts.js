import assert from 'node:assert/strict';
import {receiptActivity,receiptAmountSummary} from './dashboard-data.js';
import {confirmedReceiptSaving} from './savings-intelligence.js';
import {receiptInsightsModel,receiptOverviewMetrics,receiptOverviewMarkup,receiptActivityBuckets} from './receipt-insights.js';
import {assertPublicSnapshot} from './public-snapshot.js';
const now=new Date('2026-10-21T12:00:00Z'),state={range:'month',service:'eats',metric:'orders',now};
const base={service:'Uber Eats',orderDate:'2026-10-02',total:4,subtotal:15,promotionDiscount:12,uberCashUsed:0,deliveryFee:0,serviceFee:1,smallOrderFee:0};
const eats=[{...base,receiptId:'synthetic-a',email:'private@example.invalid',body:'Never publish receipt text'},
 {...base,receiptId:'synthetic-b',orderDate:'2026-10-09',total:6,uberCashUsed:2},
 {...base,receiptId:'synthetic-c',orderDate:'2026-10-16',total:0,promotionDiscount:0,subtotal:0,serviceFee:0}];
const rides=[{...base,service:'Uber',receiptId:'synthetic-lime',orderDate:'2026-10-09',total:8,subtotal:10,promotionDiscount:2,serviceFee:0,transportMode:'Lime'}];
const activity=receiptActivity(eats,rides,confirmedReceiptSaving,{includeAmounts:true});
const payload={accounts:[],promos:[],summary:{trackedOrders:3,trackedRides:1,totalSaved:26},receiptActivity:JSON.parse(JSON.stringify(activity))};
assertPublicSnapshot(payload,{records:[]},['private@example.invalid','Never publish receipt text','synthetic-a']);
const local=receiptInsightsModel({data:{receipts:[...eats,...rides]},...state}),publicModel=receiptInsightsModel({payload,...state});
assert.deepEqual(receiptOverviewMetrics(publicModel),receiptOverviewMetrics(local),'Public numeric projection matches the persisted local ledger mapping');
assert.equal(receiptOverviewMetrics(publicModel).paid.value,10);
assert.equal(receiptOverviewMetrics(publicModel).cash,2);
assert.equal(receiptOverviewMetrics(publicModel).outOfPocket.value,8,'Cash deducted once, separate from savings');
assert.equal(receiptOverviewMetrics(publicModel).promos,24);
const halfPenny=receiptInsightsModel({data:{receipts:Array.from({length:12},(_,i)=>({...base,receiptId:'pence-'+i,total:i?4.5:4.8}))},...state});assert.equal(receiptOverviewMetrics(halfPenny).average,4.53,'Average rounds integer pennies without a floating-point half-penny loss');
const fullMarkup=receiptOverviewMarkup(publicModel,state);assert.doesNotMatch(fullMarkup,/Partial amounts|aren’t available|Not shown|\(known\)|0 totals/);assert.match(fullMarkup,/Promo discounts/);assert.match(fullMarkup,/Uber Cash used/);assert.doesNotMatch(fullMarkup,/ri-pocket-card/);
for(const service of ['eats','rides','all'])for(const range of ['month','90','all','lastMonth'])for(const metric of ['orders','paid','promos','cash','saved']){
 const filter={...state,service,range,metric},a=receiptInsightsModel({payload,...filter}),b=receiptInsightsModel({data:{receipts:[...eats,...rides]},...filter});
 assert.deepEqual(receiptOverviewMetrics(a),receiptOverviewMetrics(b),service+' '+range+' local/public financial parity');
 assert.deepEqual(receiptActivityBuckets(a,filter).buckets.map(x=>x.value),receiptActivityBuckets(b,filter).buckets.map(x=>x.value),service+' '+range+' '+metric+' chart parity');
}
const partialRows=[...eats,{receiptId:'missing',service:'Uber Eats',orderDate:'2026-10-16',total:null,promotionDiscount:null}];
const partialActivity=receiptActivity(partialRows,[],confirmedReceiptSaving,{includeAmounts:true});
const partial=receiptInsightsModel({payload:{receiptActivity:partialActivity},...state}),pm=receiptOverviewMetrics(partial),markup=receiptOverviewMarkup(partial,state);
assert.equal(pm.paid.value,10);assert.equal(pm.paid.known,3);assert.equal(pm.paid.total,4);assert.equal(pm.average,3.33);assert.match(markup,/Partial amounts · .*3\/4/);assert.equal((markup.match(/class="ri-amount-status"/g)||[]).length,1);
const unavailable=receiptInsightsModel({data:{receipts:[{receiptId:'unknown',service:'Uber Eats',orderDate:'2026-10-16'}]},...state}),missingMarkup=receiptOverviewMarkup(unavailable,state);
assert.equal(receiptOverviewMetrics(unavailable).paid.value,null);assert.equal((missingMarkup.match(/Amounts aren’t available for these receipts\./g)||[]).length,1);assert.doesNotMatch(missingMarkup,/Not shown|average|totals shown|\(known\)|ri-green[^>]*>—/);assert.equal(receiptOverviewMetrics(unavailable).promos,null);
const zero=receiptInsightsModel({data:{receipts:[eats[2]]},...state});assert.equal(receiptOverviewMetrics(zero).paid.value,0);assert.match(receiptOverviewMarkup(zero,state),/£0.00/);assert.doesNotMatch(receiptOverviewMarkup(zero,state),/aren’t available/);
const legacy=receiptInsightsModel({payload:{receiptActivity:{months:[{period:'2026-10',eats:3,rides:1,saved:26}],days:[]}},...state,range:'all',service:'all'});assert.deepEqual(receiptActivityBuckets(legacy,{...state,range:'all',metric:'saved'}).buckets.map(({value,partial})=>({value,partial})),[{value:26,partial:false}],'Legacy published savings are supported aggregates, not missing new-field coverage');
const feePartial=receiptAmountSummary([{...base,deliveryFee:null,smallOrderFee:null}]);assert.equal(feePartial.fees.value,1);assert.equal(feePartial.fees.complete,0,'A partial fee line is not an all-in fee total');
const corrected=receiptAmountSummary([{...base,financialCorrection:{total:3,breakdown:{eatsPromotions:3},outOfPocket:1}}]);assert.equal(corrected.promos.value,3);assert.equal(corrected.saved.value,3);assert.equal(corrected.outOfPocket.value,1);
for(const modify of [p=>{p.receiptActivity.days[0].amounts.eats.receiptId='secret';},p=>{p.receiptActivity.days[0].amounts.eats.paid.known=99;},p=>{p.receiptActivity.months[0].amounts.eats.paid.value+=1;},p=>{p.receiptActivity.days[0].amounts.eats.paid.value=null;}]){const invalid=structuredClone(payload);modify(invalid);assert.throws(()=>assertPublicSnapshot(invalid,{records:[]}));}
console.log('✓ Receipt financial projection: complete/partial/unavailable/zero, public/local field and filter parity, corrections, real fees, Cash separation, coverage, strict numeric privacy and monthly reconciliation.');
