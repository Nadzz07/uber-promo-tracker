import assert from 'node:assert/strict';
import {receiptInsightsModel,receiptInsightRecord,receiptPaymentRows,appliedReceiptOffer,receiptDateLabel,receiptOverviewMarkup,receiptDetailMarkup,receiptOverviewMetrics,receiptActivityBuckets,receiptPeriod} from './receipt-insights.js';
import {financialSummary} from './receipt-financials.js';
import {RICH_PALETTE,RICH_ACCENTS,richCssToken} from './theme-palette.js';
import {applyThemeTokens} from './appearance.js';
import {contrastRatio} from './liquid-glass.js';
import {colourRgb} from './theme-palette.js';
const now=new Date('2026-10-21T12:00:00Z'),base={accountRef:'A901',service:'Uber Eats',orderAt:'2026-10-14T17:24:00Z',orderDate:'2026-10-14',dateBasis:'receipt_order_date'};
const receipts=[
 {...base,receiptId:'insight-eats',orderId:'synthetic-order',subtotal:23,total:11,promotionDiscount:12,uberCashUsed:7,deliveryFee:0,serviceFee:0,smallOrderFee:0},
 {...base,receiptId:'insight-duplicate',orderId:'synthetic-order',subtotal:23,total:11,promotionDiscount:12,uberCashUsed:7,deliveryFee:0,serviceFee:0,smallOrderFee:0},
 {...base,receiptId:'insight-lime',service:'Uber',transportMode:'lime',orderAt:'2026-10-14T09:00:00Z',total:8,promotionDiscount:2,uberCashUsed:0},
 {...base,receiptId:'insight-zero',orderDate:'2026-10-13',orderAt:'2026-10-13T19:00:00Z',total:5,promotionDiscount:0,uberCashUsed:0},
 {...base,receiptId:'insight-missing',orderDate:'2026-10-12',orderAt:null,total:6},
 {...base,receiptId:'insight-old',orderDate:'2026-03-01',orderAt:null,total:10,promotionDiscount:90},
 {...base,receiptId:'insight-adjusted',orderDate:'2026-10-11',orderAt:null,total:0,promotionDiscount:20,financialReview:{reasons:['refund'],revision:'a'.repeat(64)}}
];
const data={receipts,accounts:[{accountRef:'A901'}],receiptMatchVersion:1,offerReceiptMatches:[{receiptId:'insight-duplicate',accountRef:'A901',offerId:'insights-offer',status:'confirmed'}]};
const model=receiptInsightsModel({data,now});
assert.deepEqual(model.counts,{all:5,eats:4,rides:1});
assert.equal(model.total,34);assert.equal(model.cash,7,'Cash remains a payment, not another discount');assert.equal(model.average,8.5,'Average excludes unknown values and labels its known-receipt scope');assert.equal(model.best.f.total,12,'Unreviewed adjustment excluded from best verified save');assert.equal(model.groups[0].rows.length,2);assert.equal(model.groups[0].saved,14);
assert.deepEqual(model.summary,financialSummary(model.rows.map(x=>x.receipt)),'Reuse existing ledger totals and categories');
assert.equal(receiptInsightsModel({data,now,service:'rides'}).total,2,'Lime included as Ride');
assert.equal(receiptInsightsModel({data,now,range:'all'}).count,6);assert.equal(receiptInsightsModel({data,now:new Date('2026-10-21'),range:'30'}).count,5);
const zero=receiptInsightRecord(receipts[3]);assert.equal(zero.f.total,0);assert.equal(zero.percent,0);
const unknown=receiptInsightRecord(receipts[4]);assert.equal(unknown.f.total,null);assert.equal(unknown.percent,null);assert.equal(receiptPaymentRows(unknown).cash,null);assert.equal(receiptPaymentRows(unknown).feeTotal,null);assert.equal(receiptPaymentRows(unknown).paid,null);
const known=receiptInsightRecord(receipts[0]);assert.equal(known.percent,52,'Cash payment does not inflate savings percentage');assert.equal(receiptPaymentRows(known).paid,4);assert.equal(receiptPaymentRows(known).feeTotal,0);
assert.equal(receiptInsightRecord(receipts.at(-1)).percent,null,'No misleading comparison before adjustment review');
assert.equal(receiptDateLabel(receipts[4]).includes('00:00'),false);assert.match(receiptDateLabel({...base,orderAt:null,orderDate:null,sentAt:base.orderAt,dateBasis:'email_fallback'}),/email date/);
const offers=[{id:'insights-offer',accountRef:'A901',discountType:'fixed',discount:12,minimumSpend:15,minimumSpendVerified:true,uses:5,usesVerified:true}];
assert.equal(appliedReceiptOffer(data,receipts[0],offers),null,'Equal discount and account do not establish a link');
assert.equal(appliedReceiptOffer(data,receipts[1],offers),offers[0]);
assert.equal(appliedReceiptOffer({...data,offerReceiptMatches:[...data.offerReceiptMatches,{receiptId:'insight-duplicate',accountRef:'A901',status:'ambiguous'}]},receipts[1],offers),null);
assert.match(receiptDetailMarkup(receiptInsightRecord(receipts[1]),{data,offers}),/£15.00 minimum met/);
assert.doesNotMatch(receiptDetailMarkup(unknown,{data,offers}),/Confirmed<|0% saved|£0.00/);
assert.equal(receiptInsightsModel({data,now,corrections:{'insight-zero':{total:3,breakdown:{eatsPromotions:3},source:'manually_reported_from_uber'}}}).total,37);
const publicModel=receiptInsightsModel({payload:{receiptActivity:{days:[{period:'2026-10-14',eats:2,rides:1,saved:18}]}},now});assert.equal(publicModel.count,3);assert.equal(publicModel.total,18);assert.equal(publicModel.cash,null);assert.equal(publicModel.best,null);
assert.equal(receiptInsightsModel({payload:{receiptActivity:{days:[{period:'2026-10-14',eats:2,rides:1,saved:18}]}},now,service:'eats'}).total,null,'Public combined totals cannot be attributed to one service');
const markup=receiptOverviewMarkup(model,{range:'90',service:'all',limit:1,full:true,metric:'orders',now});assert.equal((markup.match(/data-ri-receipt=/g)||[]).length,1);assert.match(markup,/Show more receipts/);assert.doesNotMatch(markup,/role="progressbar"|monthly-chart/);assert.match(markup,/ri-activity ri-card|ri-card ri-activity/);assert.match(markup,/Paid on receipts/);
for(const theme of ['#4da3ff','#c5a0ff','#9bea72']){const tokens=new Map();applyThemeTokens({style:{setProperty:(key,value)=>tokens.set(key,value)}},theme);for(const [key,value] of Object.entries(RICH_PALETTE))if(!RICH_ACCENTS.includes(key))assert.equal(tokens.get(richCssToken(key)),value);for(const bg of ['panelTop','panelBottom','sheetTop','sheetBottom','positiveFill'])for(const text of ['secondary','positive'])assert.ok(contrastRatio(colourRgb(RICH_PALETTE[bg]),colourRgb(RICH_PALETTE[text]))>=4.5,text+' readable on '+bg);}
console.log('✓ Receipt Insights: ledger parity, Cash separation, deduplication, date/service filters, unknown/zero/refund evidence, reliable offer links, pagination and scoped theme contrast.');

const overview=receiptOverviewMetrics(model);assert.equal(overview.paid.value,30,'Receipt totals include Cash, without deducting it again');assert.equal(overview.average,6);assert.equal(overview.outOfPocket.value,17);assert.equal(overview.outOfPocket.known,3);assert.equal(overview.subtotal.value,23);assert.equal(overview.cash,7);assert.equal(overview.promos,34);assert.equal(overview.fees.complete,false,'Missing fee lines do not become a complete zero');
const monthRows=[4,5,3].flatMap((count,i)=>Array.from({length:count},(_,j)=>({...base,receiptId:'bucket-'+i+'-'+j,orderId:null,orderDate:'2026-10-'+['02','09','16'][i],orderAt:null,total:i+1,promotionDiscount:0})));
const month=receiptInsightsModel({data:{receipts:monthRows},now,range:'month'}),bars=receiptActivityBuckets(month,{range:'month',metric:'orders',now});
assert.deepEqual(bars.buckets.map(b=>b.value),[4,5,3]);assert.deepEqual(bars.buckets.map(b=>b.width),[80,100,60]);assert.equal(bars.title,'Monthly activity');assert.equal(bars.period.label,'1–21 Oct');assert.equal(bars.buckets.at(-1).end,'2026-10-21');assert.equal(bars.buckets.at(-1).incomplete,true);
assert.deepEqual(receiptActivityBuckets(month,{range:'month',metric:'paid',now}).buckets.map(b=>b.value),[4,10,9]);
assert.equal(receiptPeriod('lastMonth',now).start,'2026-09-01');assert.equal(receiptPeriod('lastMonth',now).end,'2026-09-30');
const missingBars=receiptActivityBuckets(receiptInsightsModel({data:{receipts:[receipts[4]]},range:'month',now}),{range:'month',metric:'cash',now});assert.equal(missingBars.buckets[1].value,null,'A receipt with unknown Cash is not a known zero');
console.log('✓ Latest overview: paid receipt totals, actual/partial fee and basket sums, period boundaries, service-consistent metrics and one shared zero-based 4/5/3 → 80/100/60 activity scale.');

for(const theme of ['#4da3ff','#c5a0ff','#9bea72','#ffc778','#ff9bb8']){const tokens=new Map();applyThemeTokens({style:{setProperty:(key,value)=>tokens.set(key,value)}},theme);for(const role of ['selectedTop','selectedBottom'])for(const text of ['secondary','positive'])assert.ok(contrastRatio(colourRgb(tokens.get(richCssToken(role))),colourRgb(tokens.get(richCssToken(text))))>=4.5,'Selected gradient contrast: '+theme+' '+role+' '+text);for(const role of ['buttonTop','buttonBottom'])assert.ok(contrastRatio(colourRgb(tokens.get(richCssToken(role))),colourRgb(tokens.get(richCssToken('onAccent'))))>=4.5,'Button gradient contrast: '+theme);}

assert.match(receiptInsightsModel({storeStatus:'error'}).unavailable,/could not load/);assert.match(receiptInsightsModel({storeStatus:'migration_required'}).unavailable,/one-time migration/);assert.match(receiptInsightsModel({storeStatus:'ready'}).unavailable,/not imported/);
