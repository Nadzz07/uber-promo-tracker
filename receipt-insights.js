// Read-only projections of the existing ledger. No storage, new financial
// rules or inferred offer associations are introduced by these screens.
import {receiptFinancials,financialSummary,moneyAmount} from './receipt-financials.js';
import {dedupeReceipts} from './receipt-identity.js';
import {receiptDay,receiptWhen} from './receipt-date.js';
import {ukDateKey} from './offer-time.js';
import {offerMatchedReceipts} from './account-sheet-data.js';
import {accountOfferKey} from './account-state.js';
import {offerScopeLabel} from './offer-preferences.js';
import {financeIcon as icon} from './finance-layout.js';
import {receiptAmountSummary,mergeReceiptAmounts,unknownReceiptAmounts} from './dashboard-data.js';

export const RECEIPT_RANGES=[['month','This month'],['lastMonth','Last month'],['90','Last 90 days'],['30','Last 30 days'],['365','Last year'],['all','All time']];
export const RECEIPT_METRICS=[['orders','Orders'],['paid','Paid on receipts'],['promos','Promo discounts'],['cash','Uber Cash used'],['saved','Recorded savings']];
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
const number=v=>{try{return moneyAmount(v);}catch{return null;}};
const money=v=>v==null?'—':new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(v);
const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateLabel=day=>day?new Date(day+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/London'}):'Date not recorded';
export const receiptService=r=>r.service==='Uber Eats'?'eats':'rides';
export function receiptDateLabel(r){
 const day=receiptDay(r),when=receiptWhen(r),timed=Boolean(r.orderAt||(!r.orderDate&&(r.sentAt||r.receivedAt)));
 const time=timed&&Number.isFinite(Date.parse(when))?new Date(when).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/London'}):'';
 return dateLabel(day)+(time?' · '+time:'')+(r.dateBasis==='email_fallback'||!r.orderAt&&!r.orderDate?' · email date':r.dateBasis==='order_date_time_needs_checking'?' · time unconfirmed':'');
}
export function receiptPeriod(range,now=new Date(),earliest=null){
 const today=ukDateKey(now),endDate=new Date(today+'T12:00:00Z'),startDate=new Date(endDate);
 let end=today,start;
 if(range==='month')start=today.slice(0,7)+'-01';
 else if(range==='lastMonth'){startDate.setUTCDate(1);startDate.setUTCMonth(startDate.getUTCMonth()-1);start=startDate.toISOString().slice(0,10);endDate.setUTCDate(0);end=endDate.toISOString().slice(0,10);}
 else if(range==='all')start=earliest||today;
 else{startDate.setUTCDate(startDate.getUTCDate()-Number(range)+1);start=startDate.toISOString().slice(0,10);}
 const short=day=>new Date(day+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'Europe/London'});
 return {start,end,label:(start.slice(0,7)===end.slice(0,7)?Number(start.slice(-2))+'–'+short(end):short(start)+' – '+short(end))+(start.slice(0,4)!==end.slice(0,4)?' '+end.slice(0,4):''),incomplete:range==='month'};
}
function inRange(day,range,now){
 if(range==='all')return true;if(!day)return false;
 const {start,end}=receiptPeriod(range,now);return day>=start&&day<=end;
}
export function receiptInsightRecord(receipt,correction){
 const f=receiptFinancials(receipt,correction),receiptTotal=number(receipt.total),promoKey=receiptService(receipt)==='eats'?'eatsPromotions':'ridePromotions';
 const promoValue=correction?number(correction.breakdown?.[promoKey]):number(receipt.promotionDiscount);
 // Older supported transfers may retain refund/changed-total evidence without
 // the newer review revision. Keep their figures, but do not certify a saving
 // or derive a percentage from that incomplete adjustment history.
 const previous=number(receipt.previousTotal??receipt.financialEvidence?.previousTotal);
 const unverifiedAdjustment=f.source==='email_reported'&&([receipt.refundAmount,receipt.financialEvidence?.refund].some(v=>v!=null&&Number.isFinite(Number(v))&&Number(v)!==0)||previous!=null&&receiptTotal!=null&&Math.abs(previous-receiptTotal)>.011);
 const confirmed=f.source==='email_reported'&&!f.incomplete&&!f.conflict&&!f.needsAdjustmentReview&&!unverifiedAdjustment;
 // The receipt total includes Cash. Using out-of-pocket here would incorrectly
 // turn a payment source into a discount. Partial/reviewed evidence gets no %.
 const before=confirmed&&receiptTotal!=null&&f.total!=null?round(receiptTotal+f.total):null;
 return {receipt,id:receipt.receiptId||receipt.id,day:receiptDay(receipt),service:receiptService(receipt),f,confirmed,receiptTotal,promoValue,unverifiedAdjustment,
   percent:before>0?Math.round(f.total/before*100):null,before};
}
export function receiptInsightsModel({data,corrections={},payload={},range='90',service='all',now=new Date(),storeStatus='ready'}={}){
 const imported=Boolean(data?.receipts?.length||data?.exportedAt);
 if(!imported){
  const days=(payload.receiptActivity?.days||[]).filter(d=>inRange(d.period,range,now)).sort((a,b)=>b.period.localeCompare(a.period));
  const counts={all:0,eats:0,rides:0};for(const d of days){counts.eats+=Number(d.eats)||0;counts.rides+=Number(d.rides)||0;}counts.all=counts.eats+counts.rides;
  const dailyCount=counts[service],period=receiptPeriod(range,now),publicMonths=(payload.receiptActivity?.months||[]).filter(m=>range==='all'||['month','lastMonth'].includes(range)&&m.period===period.start.slice(0,7));
  if(publicMonths.length){counts.eats=publicMonths.reduce((n,m)=>n+(Number(m.eats)||0),0);counts.rides=publicMonths.reduce((n,m)=>n+(Number(m.rides)||0),0);counts.all=counts.eats+counts.rides;}
  const publicAmounts=row=>{const selected=service==='all'?['eats','rides']:[service];return mergeReceiptAmounts(selected.map(key=>payload.receiptActivity?.amountVersion===1&&row.amounts?.[key]||unknownReceiptAmounts(Number(row[key])||0)));};
  const groups=days.filter(d=>service==='all'||Number(d[service])>0).map(d=>({day:d.period,count:service==='all'?Number(d.eats)+Number(d.rides):Number(d[service]),eats:d.eats,rides:d.rides,saved:service==='all'||!Number(d[service==='eats'?'rides':'eats'])?number(d.saved):null,amounts:publicAmounts(d),dateFallbacks:d.dateFallbacks||0}));
  const amounts=mergeReceiptAmounts((publicMonths.length?publicMonths:days).map(publicAmounts));
  const total=groups.every(d=>d.saved!=null)?round(groups.reduce((n,d)=>n+d.saved,0)):null;
  const unavailable={loading:'Loading receipt data…',migration_required:'Receipt data needs one-time migration in Sync & data.',error:'Receipt data could not load. Original data is preserved.'}[storeStatus]||'Receipt details not imported.';
  return {imported,unavailable,service,counts,count:counts[service],amountVersion:payload.receiptActivity?.amountVersion||0,publicMonths,publicAmounts,amounts,coverageIncomplete:publicMonths.length>0&&dailyCount!==counts[service],groups,total:days.length?total:null,promo:amounts.promos.value,cash:amounts.cash.value,average:null,best:null,missing:0};
 }
 const all=dedupeReceipts(data.receipts).filter(r=>inRange(receiptDay(r),range,now)).map(r=>receiptInsightRecord(r,corrections[r.receiptId||r.id]));
 all.sort((a,b)=>String(receiptWhen(b.receipt)||'').localeCompare(String(receiptWhen(a.receipt)||''))||String(a.id).localeCompare(String(b.id)));
 const counts={all:all.length,eats:all.filter(r=>r.service==='eats').length,rides:all.filter(r=>r.service==='rides').length};
 const rows=all.filter(r=>service==='all'||r.service===service),summary=financialSummary(rows.map(r=>r.receipt),corrections);
 const best=rows.filter(r=>r.confirmed&&r.f.total!=null).reduce((a,b)=>!a||b.f.total>a.f.total?b:a,null),groups=[];
 for(const row of rows){let group=groups.find(g=>g.day===row.day);if(!group){group={day:row.day,rows:[],saved:0,missing:0};groups.push(group);}group.rows.push(row);group.saved=round(group.saved+(row.f.total??0));group.missing+=row.f.total==null?1:0;}
 for(const g of groups)if(g.missing===g.rows.length)g.saved=null;
 const known=rows.filter(r=>r.f.total!=null).length,promo=round(summary.categories.eatsPromotions+summary.categories.ridePromotions);
 return {imported,counts,count:rows.length,rows,groups,amounts:receiptAmountSummary(rows.map(row=>row.receipt),corrections),total:known||!rows.length?summary.total:null,
   promo:rows.some(r=>r.promoValue!=null)?promo:null,
   promoCount:rows.filter(r=>r.f.categories.eatsPromotions+r.f.categories.ridePromotions>0).length,
   cash:rows.some(r=>number(r.receipt.uberCashUsed)!=null)?summary.cashUsed:null,cashCount:rows.filter(r=>r.f.cashUsed>0).length,
   average:known?round(summary.total/known):null,averageKnown:known,best,missing:summary.missing,
   otherSavings:round(summary.total-promo),summary};
}
export function appliedReceiptOffer(data,receipt,offers=[]){
 if(data?.receiptMatchVersion!==1)return null;
 const links=(data.offerReceiptMatches||[]).filter(m=>m.receiptId===receipt.receiptId&&m.accountRef===receipt.accountRef);
 if(links.some(m=>m.status==='ambiguous'))return null;
 const ids=new Set(links.filter(m=>m.status==='confirmed').map(m=>m.offerId)),matches=offers.filter(p=>p.accountRef===receipt.accountRef&&[p.id,p.offerId].some(id=>id&&ids.has(id)));
 const unique=[...new Map(matches.map(p=>[p.offerId||p.id,p])).values()];return unique.length===1?unique[0]:null;
}
export function receiptPaymentRows(record){
 const {receipt:r,f}=record,fees=[['Delivery',number(r.deliveryFee)],['Service',number(r.serviceFee)],['Small order',number(r.smallOrderFee)]];
 return {subtotal:number(r.subtotal),promo:record.promoValue,cash:number(r.uberCashUsed),
  feeTotal:fees.every(([,n])=>n!=null)?round(fees.reduce((n,[,v])=>n+v,0)):null,fees:fees.filter(([,n])=>n!=null),tip:number(r.tip),paid:f.outOfPocket};
}
const amount=(v,className='')=>'<strong class="'+(v==null?className.replace(/\bri-green\b/g,'')+' ri-unknown':className)+'">'+e(money(v))+'</strong>';
const serviceTitle=r=>r.service==='eats'?'Uber Eats':'Uber Ride';
const sumKnown=values=>{const known=values.filter(v=>v!=null);return {value:known.length?round(known.reduce((a,b)=>a+b,0)):values.length?null:0,known:known.length,total:values.length};};
export function receiptOverviewMetrics(model){
 const amounts=model.amounts||unknownReceiptAmounts(model.count),{paid,subtotal,fees,outOfPocket}=amounts;
 return {paid,subtotal,fees,outOfPocket,amounts,average:paid.known?Math.round(Math.round(paid.value*100)/paid.known)/100:null,promos:amounts.promos.value,cash:amounts.cash.value};
}
export function receiptActivityBuckets(model,{range='month',metric='orders',now=new Date()}={}){
 if(!model.imported&&range==='all'&&model.publicMonths?.length){
  const rows=model.publicMonths.slice().sort((a,b)=>a.period.localeCompare(b.period)),period=receiptPeriod(range,now,rows[0].period+'-01');
  const buckets=rows.map(r=>{const count=model.service==='all'?Number(r.eats)+Number(r.rides):Number(r[model.service]),amounts=model.publicAmounts(r),value=metric==='orders'?count:model.amountVersion===1?amounts[metric]?.value??(count?null:0):metric==='saved'?(model.service==='all'||!r[model.service==='eats'?'rides':'eats']?number(r.saved):null):count?null:0;return {label:new Date(r.period+'-01T12:00Z').toLocaleString('en-GB',{month:'short',year:'2-digit',timeZone:'Europe/London'}),value,partial:metric!=='orders'&&!(metric==='saved'&&model.amountVersion!==1)&&amounts[metric]?.known<count};});
  const max=Math.max(0,...buckets.map(b=>b.value??0));return {period,title:'Receipt activity',metric,buckets:buckets.map(b=>({...b,width:max>0&&b.value!=null?b.value/max*100:0}))};
 }
 const period=receiptPeriod(range,now,model.groups.map(g=>g.day).filter(Boolean).sort()[0]);
 const days=Math.round((Date.parse(period.end)-Date.parse(period.start))/86400000)+1,weekly=['month','lastMonth'].includes(range),yearly=days>730;
 const title=weekly?'Monthly activity':yearly?'Yearly activity':range==='all'?'Receipt activity':'Activity · '+(RECEIPT_RANGES.find(([key])=>key===range)?.[1].toLowerCase()||'selected period');
 const buckets=[];let start=period.start;
 while(start<=period.end&&buckets.length<160){const d=new Date(start+'T12:00:00Z');let end;
  if(weekly)d.setUTCDate(d.getUTCDate()+6);else if(yearly){d.setUTCMonth(11,31);}else{d.setUTCMonth(d.getUTCMonth()+1,0);}
  end=d.toISOString().slice(0,10);if(end>period.end)end=period.end;
  const rows=model.imported?model.rows.filter(r=>r.day>=start&&r.day<=end):model.groups.filter(r=>r.day>=start&&r.day<=end);
  let value,partial=false;
  if(metric==='orders'){value=model.imported?rows.length:rows.reduce((n,r)=>n+r.count,0);if(model.coverageIncomplete){partial=true;if(!rows.length)value=null;}}
  else if(!model.imported){const amounts=mergeReceiptAmounts(rows.map(r=>r.amounts)),v=amounts[metric];if(model.amountVersion===1||metric!=='saved'){value=v?.value??(rows.length?null:0);partial=Boolean(v&&v.known<v.total);}else{const known=sumKnown(rows.map(r=>r.saved));value=known.value;partial=known.known!==known.total;}}
  else{const values=rows.map(r=>metric==='paid'?r.receiptTotal:metric==='promos'?r.promoValue:metric==='cash'?number(r.receipt.uberCashUsed):r.f.total),v=sumKnown(values);value=v.value;partial=v.known!==v.total;}
  const monthEnd=new Date(end.slice(0,7)+'-01T12:00Z');monthEnd.setUTCMonth(monthEnd.getUTCMonth()+1,0);
  const partialPeriod=!weekly&&(yearly?(start.slice(5)!=='01-01'||end.slice(5)!=='12-31'):(start.slice(-2)!=='01'||end!==monthEnd.toISOString().slice(0,10)));
  const label=yearly?start.slice(0,4)+(partialPeriod?' · partial':''):weekly||partialPeriod?(Number(start.slice(-2))+'–'+Number(end.slice(-2))+' '+new Date(end+'T12:00Z').toLocaleString('en-GB',{month:'short',timeZone:'Europe/London'})):new Date(start+'T12:00Z').toLocaleString('en-GB',{month:'short',year:'2-digit',timeZone:'Europe/London'});
  buckets.push({start,end,label,value,partial,partialPeriod,incomplete:period.incomplete&&end===period.end});const next=new Date(end+'T12:00Z');next.setUTCDate(next.getUTCDate()+1);start=next.toISOString().slice(0,10);
 }
 const undated=model.imported?model.rows.filter(r=>!r.day):[];if(undated.length){const values=undated.map(r=>metric==='paid'?r.receiptTotal:metric==='promos'?r.promoValue:metric==='cash'?number(r.receipt.uberCashUsed):r.f.total),v=sumKnown(values);buckets.push({label:'Date unknown',value:metric==='orders'?undated.length:v.value,partial:metric!=='orders'&&v.known!==v.total});}
 const max=Math.max(0,...buckets.map(b=>b.value??0));return {period,title,metric,buckets:buckets.map(b=>({...b,width:max>0&&b.value!=null?b.value/max*100:0}))};
}
export function receiptAmountCoverage(metrics,count){
 if(!count)return '';
 const fields=[['totals',metrics.paid],['basket',metrics.subtotal],['fees',metrics.fees],['promos',metrics.amounts.promos],['credit',metrics.amounts.cash]];
 if(fields.every(([,s])=>!s.known))return 'Amounts aren’t available for these receipts.';
 if(fields.every(([,s])=>s.known===count)&&metrics.fees.complete===count)return '';
 const groups=new Map();for(const [label,s]of fields){if(!groups.has(s.known))groups.set(s.known,[]);groups.get(s.known).push(label);}
 const parts=[...groups].map(([known,labels])=>(labels.length===4?'other fields':labels.join(', '))+(known?' '+known+'/'+count:' unavailable'));
 return 'Partial amounts · '+parts.join('; ')+(metrics.fees.known>metrics.fees.complete?' · fees partly itemised':'')+'.';
}
export function receiptOverviewMarkup(model,state){
 const m=receiptOverviewMetrics(model),activity=receiptActivityBuckets(model,state),period=activity.period;
 const select=(cls,label,choices,value)=>'<span class="ri-select-wrap"><select class="'+cls+'" aria-label="'+label+'"'+(cls==='ri-metric-select'?' style="width:calc('+(choices.find(([key])=>key===value)?.[1].length||6)+'ch + 38px)"':'')+'>'+choices.map(([key,text])=>'<option value="'+key+'"'+(value===key?' selected':'')+'>'+text+'</option>').join('')+'</select>'+icon('chevron-down')+'</span>';
 const filters='<div class="ri-period">'+select('ri-range','Receipt date range',RECEIPT_RANGES,state.range)+'<span>'+e(period.label)+'</span></div><div class="ri-filters" role="group" aria-label="Receipt type">'+[['eats','Eats'],['rides','Rides'],['all','All']].map(([key,label])=>'<button type="button" data-ri-service="'+key+'" aria-pressed="'+(state.service===key)+'" aria-label="'+label+', '+model.counts[key]+' receipts">'+label+'</button>').join('')+'</div>';
 const coverage=receiptAmountCoverage(m,model.count);
 const hero='<section class="ri-paid-card ri-card"'+(m.paid.value!=null&&money(m.paid.value).length>10?' data-long-amount':'')+' aria-label="Receipt totals"><div class="ri-paid-label">Paid on receipts</div>'+amount(m.paid.value,'ri-paid-total')+'<p>'+model.count+' '+(state.service==='rides'?'rides':'orders')+(m.average!=null?' · '+e(money(m.average))+' average':'')+'</p>'+(m.promos!=null?'<p class="ri-green ri-promo-total">'+e(money(m.promos))+' in promo discounts</p>':'')+icon('receipt-slip')+'<div class="ri-paid-bottom"><div><span>Basket subtotal</span>'+amount(m.subtotal.value)+'</div><div><span>Fees</span>'+amount(m.fees.value)+'</div></div>'+(coverage?'<p class="ri-amount-status">'+e(coverage)+'</p>':'')+'</section>';
 const cards='<div class="ri-two-cards"'+([m.promos,m.cash].some(v=>v!=null&&money(v).length>9)?' data-long-amount':'')+'><section class="ri-card ri-promos-card">'+icon('tag')+'<div><span>Promo discounts</span>'+amount(m.promos,'ri-green')+'</div></section><section class="ri-card ri-cash-card">'+icon('wallet')+'<div><span>Uber Cash used</span>'+amount(m.cash,'ri-green')+(m.cash!=null?'<small>Paid with credit</small>':'')+'</div></section></div>';
 const chart='<section class="ri-card ri-activity"><div class="ri-section-head"><h2>'+e(activity.title)+'</h2>'+select('ri-metric-select','Activity metric',RECEIPT_METRICS,state.metric)+'</div><div class="ri-activity-rows">'+activity.buckets.map(b=>'<div class="ri-activity-row"><span>'+e(b.label)+'</span><span class="ri-activity-track" aria-hidden="true"><span style="width:'+b.width+'%"></span></span><strong'+(b.value==null?' class="ri-unknown"':'')+'>'+(b.value==null?'—':state.metric==='orders'?b.value:e(money(b.value)))+(b.partial&&b.value!=null?'*':'')+'</strong></div>').join('')+'</div><p class="ri-caption">Based on imported receipts'+(activity.buckets.some(b=>b.partial&&b.value!=null)?' · * partial amounts':'')+'</p></section>';
 const rows=model.imported?model.rows.slice(0,state.full?state.limit:2):[];
 const recent='<section class="ri-recent"><div class="ri-section-head"><h2>Recent receipts</h2>'+(model.imported&&model.count>2?'<button data-ri-view-all>'+ (state.full?'Show recent':'View all')+'</button>':'')+'</div><div class="ri-results" aria-live="polite">'+(rows.length?rows.map(row=>{const r=row.receipt,fees=receiptPaymentRows(row),feeParts=fees.fees.filter(([,v])=>v>0),breakdown=number(r.uberCashUsed)>0?'Includes '+money(number(r.uberCashUsed))+' Uber Cash':[number(r.subtotal)!=null?money(number(r.subtotal))+' basket':null,number(r.promotionDiscount)!=null?money(number(r.promotionDiscount))+' promo':null,fees.feeTotal!=null?money(fees.feeTotal)+' fees':feeParts.length?money(feeParts.reduce((n,[,v])=>n+v,0))+' known fees':null].filter(Boolean).join(' · ');
  return '<button class="ri-receipt-row ri-card" data-ri-receipt="'+e(row.id)+'">'+icon('receipt-slip')+'<span class="ri-row-copy"><span class="ri-row-title">'+serviceTitle(row)+' <small>· '+e(dateLabel(row.day).replace(/ 20\d\d$/,''))+'</small></span>'+(breakdown?'<small>'+e(breakdown)+'</small>':'')+'</span><span class="ri-row-amount">'+amount(row.receiptTotal)+'</span>'+icon('chevron-right')+'</button>';}).join(''):'<p class="ri-empty">'+(!model.imported?e(model.unavailable):'No receipts in this period.')+'</p>')+'</div>'+(state.full&&model.count>state.limit?'<button class="ri-more" data-ri-more>Show more receipts</button>':'')+'</section>';
 return '<div class="ri-overview">'+filters+hero+cards+chart+recent+'<button class="ri-breakdown ri-card" data-open-sheet="savings">'+icon('insights')+'<span>Savings breakdown</span>'+icon('chevron-right')+'</button></div>';
}
export function receiptDetailMarkup(record,{data,offers=[]}={}){
 if(!record)return '<p class="ri-empty">This receipt is no longer in the imported data.</p>';
 const {receipt:r,f,confirmed}=record,payment=receiptPaymentRows(record),offer=appliedReceiptOffer(data,r,offers);
 const line=(label,value,{deduction=false,positive=false}={})=>'<div class="ri-payment-line"><dt>'+e(label)+'</dt><dd class="'+(value==null?'ri-unknown':positive&&value>0?'ri-green':'')+'">'+(value==null?'—':(deduction&&value>0?'−':'')+e(money(value)))+'</dd></div>';
 let applied='<p class="ri-caption">'+(data?.receiptMatchVersion===1?'No reliably matched offer.':'Offer matching is not included in this import.')+'</p>';
 if(offer){const matches=offerMatchedReceipts(data,offer).slice().reverse(),index=matches.findIndex(x=>x.receiptId===r.receiptId),limit=offer.usesVerified===true&&Number.isInteger(offer.uses)&&offer.uses>0?offer.uses:null;
  const minimum=offer.minimumSpendVerified===true&&number(offer.minimumSpend)!=null&&payment.subtotal!=null?payment.subtotal>=offer.minimumSpend:null;
  applied='<div class="ri-applied-offer">'+icon('tag')+'<span><strong>'+e(offerScopeLabel(accountOfferKey(offer))||'Offer terms need checking')+'</strong><small>Used · '+e(dateLabel(record.day))+'</small></span>'+amount(number(r.promotionDiscount),'ri-green')+'</div><div class="ri-offer-facts">'+(minimum!=null?'<span class="ri-confirmed">'+icon(minimum?'check':'info')+e(money(offer.minimumSpend))+' minimum '+(minimum?'met':'not met')+'</span>':'')+(limit&&index>=0?'<span class="ri-use-chip">'+(index<limit?'Use '+(index+1)+' of '+limit:'Usage needs checking')+'</span>':'')+'</div>';
 }
 const comparison=record.percent!=null?'<div class="ri-comparison" role="img" aria-label="'+record.percent+' percent saved, excluding Uber Cash payment"><span style="width:'+record.percent+'%"></span></div><div class="ri-comparison-label"><span>'+record.percent+'% saved</span><span>of '+e(money(record.before))+' before savings</span></div>':'';
 const fees=payment.fees.length?'<p class="ri-fee-detail">'+payment.fees.map(([label,v])=>e(label)+' '+e(money(v))).join(' · ')+(payment.feeTotal==null?' · other fees not shown':'')+'</p>':'';
 const other=Object.entries(f.categories).filter(([key,v])=>!['eatsPromotions','ridePromotions'].includes(key)&&v>0),labels={explicitUberOne:'Uber One savings',combinedUberOnePromotions:'Uber One & promos',schedule:'Schedule saving',other:'Other recorded savings'};
 return '<div class="ri-detail"><section class="ri-receipt-summary ri-card"><div class="ri-receipt-heading"><span class="ri-service-icon '+record.service+'">'+icon(record.service==='eats'?'bag':'ride')+'</span><span><h2>'+serviceTitle(record)+'</h2><p>'+e(receiptDateLabel(r))+(r.transportMode==='Lime'?' · Lime':'')+'</p></span>'+(confirmed?'<span class="ri-confirmed">'+icon('check')+'Confirmed</span>':'')+'</div><div class="ri-saved-paid"><div><span>You saved</span>'+amount(f.total,'ri-green')+'</div><div><span>You paid</span>'+amount(payment.paid)+'</div></div>'+comparison+(f.needsAdjustmentReview?'<p class="ri-caption">Refund or adjustment needs review.</p>':f.incomplete?'<p class="ri-caption">Savings are not recorded on this receipt.</p>':f.source==='manually_reported_from_uber'?'<p class="ri-caption">Savings corrected from Uber.</p>':'')+'</section><section class="ri-card ri-payment"><h2>'+icon('receipt')+'Payment summary</h2><dl>'+line('Subtotal',payment.subtotal)+line('Promo discount',payment.promo,{deduction:true,positive:true})+other.map(([key,v])=>line(labels[key],v,{deduction:true,positive:true})).join('')+line('Uber Cash used',payment.cash,{deduction:true})+line('Fees',payment.feeTotal)+fees+(payment.tip!=null?line('Tip',payment.tip):'')+(payment.paid==null&&record.receiptTotal!=null?line('Receipt total',record.receiptTotal):'')+'<div class="ri-payment-total">'+line('Total paid',payment.paid)+'</div></dl><p class="ri-caption">Uber Cash is a payment, not a saving.</p></section><section class="ri-card ri-applied"><h2>'+icon('tag')+'Applied offer</h2>'+applied+'</section>'+(confirmed?'<p class="ri-sync">'+icon('info')+'Confirmed from imported receipt data on this device.</p>':'')+'</div>';
}

export function createReceiptInsights({host,detailHost=host,getSource,onHeading,onOpenReceipt,getScroll=()=>host.scrollTop,setScroll=value=>{host.scrollTop=value;}}){
 const defaults={range:'month',service:'eats',metric:'orders',full:false,limit:80,receiptId:null,scroll:0,focusId:null};
 let saved={};try{saved=JSON.parse(sessionStorage.getItem('uber-tracker-receipt-view:v1')||'{}');}catch{}
 const state={...defaults,...(RECEIPT_RANGES.some(([key])=>key===saved.range)?{range:saved.range}:{}),...(['all','eats','rides'].includes(saved.service)?{service:saved.service}:{}),...(RECEIPT_METRICS.some(([key])=>key===saved.metric)?{metric:saved.metric}:{})};
 const persist=()=>{try{sessionStorage.setItem('uber-tracker-receipt-view:v1',JSON.stringify({range:state.range,service:state.service,metric:state.metric}));}catch{}};
 const render=({restore=false}={})=>{
  const source=getSource(),target=state.receiptId?detailHost:host;onHeading(state.receiptId?'Receipt':'Receipt insights',state);
  const receipt=state.receiptId?source.data?.receipts?.find(r=>(r.receiptId||r.id)===state.receiptId):null;
  target.innerHTML=state.receiptId?receiptDetailMarkup(receipt?receiptInsightRecord(receipt,source.corrections?.[receipt.receiptId]):null,source):receiptOverviewMarkup(receiptInsightsModel({...source,...state}),state);
  if(restore){setScroll(state.scroll);host.querySelector('[data-ri-receipt="'+CSS.escape(state.focusId||'')+'"]')?.focus({preventScroll:true});}
 };
 const click=event=>{const target=event.target.closest('[data-ri-service],[data-ri-receipt],[data-ri-more],[data-ri-view-all]');if(!target)return;
  if(target.dataset.riService){state.service=target.dataset.riService;state.limit=80;persist();render();host.querySelector('[data-ri-service="'+state.service+'"]').focus({preventScroll:true});}
  else if(target.dataset.riReceipt){state.scroll=getScroll();state.focusId=target.dataset.riReceipt;onOpenReceipt(target.dataset.riReceipt);}
  else if(target.hasAttribute('data-ri-view-all')){state.full=!state.full;render();host.querySelector('[data-ri-view-all]')?.focus({preventScroll:true});}
  else{state.limit+=80;const scroll=getScroll();render();setScroll(scroll);host.querySelector('[data-ri-more]')?.focus({preventScroll:true});}
 };
 const change=event=>{if(event.target.matches('.ri-range')){state.range=event.target.value;state.limit=80;persist();render();host.querySelector('.ri-range').focus({preventScroll:true});}else if(event.target.matches('.ri-metric-select')){state.metric=event.target.value;persist();render();host.querySelector('.ri-metric-select').focus({preventScroll:true});}};
 host.addEventListener('click',click);host.addEventListener('change',change);
 return {state,render,openReceipt(id){state.receiptId=id;render();detailHost.scrollTop=0;},back(){state.receiptId=null;render({restore:true});},refresh(){const scroll=state.receiptId?detailHost.scrollTop:getScroll();render();if(state.receiptId)detailHost.scrollTop=scroll;else setScroll(scroll);},destroy(){host.removeEventListener('click',click);host.removeEventListener('change',change);}};
}
