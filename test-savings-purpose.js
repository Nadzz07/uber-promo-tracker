import assert from 'node:assert/strict';
import {receiptInsightsModel,receiptOverviewMarkup,savingsModel,receiptActivityBuckets,receiptDetailMarkup} from './receipt-insights.js';
const now=new Date('2026-10-24T12:00:00Z'),state={range:'month',service:'all',metric:'orders',now,limit:80};
const receipt=(id,date,promo,extra={})=>({receiptId:id,orderId:id,accountRef:'A1',service:'Uber Eats',orderDate:date,promotionDiscount:promo,total:10,uberCashUsed:2,subtotal:20,deliveryFee:0,serviceFee:0,smallOrderFee:0,...extra});
const rows=[receipt('a','2026-10-02',12),receipt('b','2026-10-09',8),receipt('c','2026-10-16',0),receipt('d','2026-10-17',null,{uberCashUsed:null}),receipt('ride','2026-10-20',4,{service:'Uber',transportMode:'Lime'}),receipt('usd','2026-10-21',100,{currency:'USD'}),receipt('refund','2026-10-22',2,{previousTotal:18,refundAmount:8})];
const offer={id:'offer1',accountRef:'A1',service:'Uber Eats',discountType:'fixed',discount:12,minimumSpend:15};
const data={exportedAt:now.toISOString(),receiptMatchVersion:1,receipts:[...rows,{...rows[0],receiptId:'duplicate',receivedAt:'2026-10-24'}],offerReceiptMatches:[{receiptId:'b',accountRef:'A1',offerId:'offer1',status:'confirmed'},{receiptId:'ride',accountRef:'A1',offerId:'offer1',status:'ambiguous'}]};
const model=receiptInsightsModel({data,...state}),source={data,offers:[offer]},stats=savingsModel(model,source);
assert.equal(model.count,7,'Duplicate email/order is only counted once');
assert.equal(model.amounts.promos.value,26,'Known promos retained, foreign currency excluded');
assert.equal(model.amounts.outOfPocket.value,32,'No unknown-credit or unresolved-refund payment inferred');
assert.equal(stats.contributing.length,4);assert.equal(stats.average,6.5);assert.equal(stats.best,12);
assert.equal(stats.top.find(g=>g.key==='unmatched').value,18,'Equal advertised amount does not attribute an offer');assert.equal(stats.top.find(g=>g.key!=='unmatched').value,8,'Only confirmed receipt/account link attributes savings');
const savings=receiptOverviewMarkup(model,{...state,page:'savings',source}),insights=receiptOverviewMarkup(model,state);
assert.match(savings,/Savings over time/);assert.match(savings,/Your top offers/);assert.doesNotMatch(savings,/Out-of-pocket|Basket subtotal|Uber Cash used|Recent receipts/);
assert.match(insights,/Known spend/);assert.equal((insights.match(/ri-card ri-combined/g)||[]).length,1);assert.doesNotMatch(insights,/Your top offers|Best saving|Average saving/);
const buckets=receiptActivityBuckets(model,{...state,metric:'promos'});assert.equal(buckets.buckets.reduce((n,b)=>n+(b.value??0),0),26);const max=Math.max(...buckets.buckets.map(b=>b.value??0));for(const b of buckets.buckets)assert.equal(b.width,(b.value??0)/max*100);
for(const service of ['eats','rides','all']){const filtered=receiptInsightsModel({data,...state,service});assert.equal(savingsModel(filtered,source).promo.value,filtered.amounts.promos.value);}
const unknown=receiptInsightsModel({data:{exportedAt:now.toISOString(),receipts:[receipt('u','2026-10-02',null,{total:null,uberCashUsed:null})]},...state});assert.equal(savingsModel(unknown).promo.value,null);assert.equal(unknown.amounts.outOfPocket.value,null);assert.doesNotMatch(receiptOverviewMarkup(unknown,{...state,page:'savings'}),/ri-green[^>]*>—/);
const empty=receiptInsightsModel({data:{exportedAt:now.toISOString(),receipts:[]},...state});assert.equal(empty.amounts.promos.value,0);assert.equal(savingsModel(empty).average,null);
const list=receiptOverviewMarkup(model,{...state,page:'savings',savingsList:true,source});assert.equal((list.match(/data-ri-receipt=/g)||[]).length,4);assert.doesNotMatch(list,/ri-paid-card|ri-activity/);
console.log('Savings/spending purpose regressions passed: dedupe, parity, attribution, currencies, refund/credit availability, average/best, proportional bars and receipt subsets.');

const usd=model.rows.find(r=>r.id==='usd');assert.match(receiptDetailMarkup(usd),/US\$8\.00/);assert.doesNotMatch(receiptDetailMarkup(usd),/£/);

const foreignOnly=receiptInsightsModel({data:{exportedAt:now.toISOString(),receipts:[rows[5]]},...state});assert.equal(foreignOnly.promo,null);assert.equal(foreignOnly.cash,null);
const cashOffer={...offer,id:'cash-only-link',discountType:'uberCash'};const cashData={...data,offerReceiptMatches:[{receiptId:'a',accountRef:'A1',offerId:cashOffer.id,status:'confirmed'}]};assert.equal(savingsModel(receiptInsightsModel({data:cashData,...state}),{data:cashData,offers:[cashOffer]}).top.length,1,'A credit-payment link cannot attribute promo savings to Uber Cash');

const sparse={...model,imported:false,coverageIncomplete:true,amountVersion:1,service:'all',groups:[{day:'2026-10-02',count:1,amounts:model.amounts}],publicMonths:[]};const sparseBars=receiptActivityBuckets(sparse,{...state,metric:'promos'}).buckets;assert.ok(sparseBars.every(b=>b.partial));assert.equal(sparseBars[1].value,null,'Missing daily coverage cannot establish a zero savings bucket');
