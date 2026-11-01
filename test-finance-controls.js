import assert from 'node:assert/strict';
import {receiptInsightsModel,receiptOverviewMarkup,receiptInsightRecord,receiptDetailMarkup} from './receipt-insights.js';
const now=new Date('2026-10-25T12:00:00Z'),base={accountRef:'A1',service:'Uber Eats',total:4,subtotal:15,promotionDiscount:12,uberCashUsed:0,serviceFee:1,deliveryFee:0,smallOrderFee:0},rows=[{...base,receiptId:'review',orderDate:'2026-10-20',financialReview:{reasons:['adjustment'],revision:'a'.repeat(64)}},{...base,receiptId:'corrected',orderDate:'2026-10-21'},{...base,receiptId:'past',orderDate:'2026-09-01'}],corrections={corrected:{total:12,outOfPocket:4},past:{total:12,outOfPocket:4}};
const source={data:{receipts:rows},corrections,range:'month',service:'all',now};
for(const filter of [{},{reviewOnly:true},{correctedOnly:true}]){const m=receiptInsightsModel({...source,...filter});assert.equal(m.reviewCount,1);assert.equal(m.correctedCount,1);assert.equal(m.count,Object.keys(filter).length?1:2);}
assert.equal(receiptInsightsModel({...source,range:'all',correctedOnly:true}).count,2);
assert.equal(receiptInsightsModel({...source,service:'rides',correctedOnly:true}).count,0);
const partial={...corrections,review:{reviewKind:'receipt-review-v1',currency:'GBP',receiptTotal:4,promoDiscount:12}};
const m=receiptInsightsModel({...source,corrections:partial,correctedOnly:true});assert.equal(m.correctedCount,2);assert.equal(m.reviewCount,1,'A partial manual correction does not clear unresolved review');
const html=receiptOverviewMarkup(m,{page:'receipts',full:true,reviewHub:true,correctedOnly:true,reviewOnly:false,range:'month',service:'all',metric:'orders',limit:80,now});assert.match(html,/Corrected · 2/);assert.doesNotMatch(html,/All receipts<\/button>/);assert.doesNotMatch(html,/ri-paid-card|Receipt totals/);
assert.match(receiptDetailMarkup(receiptInsightRecord(rows[1],corrections.corrected)),/Manually corrected/);
console.log('✓ Receipt review counts share period/service/dedup scope; corrected and unresolved may overlap; two-view review flow preserves partial corrections.');

for (const correction of [null, corrections.corrected]) { const detail=receiptDetailMarkup(receiptInsightRecord(rows[1],correction)); assert.match(detail,/>Edit details<\/span>/); assert.match(detail,/data-finance-target="check"/); assert.match(detail,/data-finance-receipt="corrected"/); assert.doesNotMatch(detail,/Private finances|Unlock/); }
