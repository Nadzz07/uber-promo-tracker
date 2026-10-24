// Read-only projections of the existing ledger. No storage, new financial
// rules or inferred offer associations are introduced by these screens.
import {receiptFinancials,receiptPaymentAmount,financialSummary,moneyAmount} from './receipt-financials.js';
import {dedupeReceipts} from './receipt-identity.js';
import {receiptDay,receiptWhen} from './receipt-date.js';
import {ukDateKey} from './offer-time.js';
import {offerMatchedReceipts} from './account-sheet-data.js';
import {accountOfferKey} from './account-state.js';
import {offerScopeLabel} from './offer-preferences.js';
import {financeIcon as icon} from './finance-layout.js';
import {receiptAmountSummary,mergeReceiptAmounts,unknownReceiptAmounts} from './dashboard-data.js';

export const RECEIPT_RANGES=[['month','This month'],['lastMonth','Last month'],['90','Last 90 days'],['30','Last 30 days'],['365','Last year'],['all','All time']];
export const RECEIPT_METRICS=[['orders','Orders'],['paid','Receipt totals']];
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
const number=v=>{try{return moneyAmount(v);}catch{return null;}};
const currencyMoney=(v,currency='GBP')=>v==null?'—':new Intl.NumberFormat('en-GB',{style:'currency',currency:/^[A-Z]{3}$/.test(currency)?currency:'GBP'}).format(v);
const money=v=>currencyMoney(v);
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
 correction??=receipt.financialCorrection;
 const f=receiptFinancials(receipt,correction),receiptTotal=number(receipt.total),promoKey=receiptService(receipt)==='eats'?'eatsPromotions':'ridePromotions';
 const promoValue=correction?number(correction.breakdown?.[promoKey]):number(receipt.promotionDiscount);
 // Older supported transfers may retain refund/changed-total evidence without
 // the newer review revision. Keep their figures, but do not certify a saving
 // or derive a percentage from that incomplete adjustment history.
 const previous=number(receipt.previousTotal??receipt.financialEvidence?.previousTotal);
 const unverifiedAdjustment=f.source==='email_reported'&&([receipt.refundAmount,receipt.financialEvidence?.refund].some(v=>v!=null&&Number.isFinite(Number(v))&&Number(v)!==0)||previous!=null&&receiptTotal!=null&&Math.abs(previous-receiptTotal)>.011);
 const foreign=receipt.currency&&String(receipt.currency).toUpperCase()!=='GBP';
 const confirmed=!foreign&&f.source==='email_reported'&&!f.incomplete&&!f.conflict&&!f.needsAdjustmentReview&&!unverifiedAdjustment;
 // The receipt total includes Cash. Using out-of-pocket here would incorrectly
 // turn a payment source into a discount. Partial/reviewed evidence gets no %.
 const before=confirmed&&receiptTotal!=null&&f.total!=null?round(receiptTotal+f.total):null;
 return {receipt,id:receipt.receiptId||receipt.id,day:receiptDay(receipt),service:receiptService(receipt),f,confirmed,receiptTotal:foreign?null:receiptTotal,promoValue:foreign?null:promoValue,foreign,unverifiedAdjustment,payment:receiptPaymentAmount(receipt,correction),
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
 const rows=all.filter(r=>service==='all'||r.service===service),supported=rows.filter(r=>!r.foreign),summary=financialSummary(supported.map(r=>r.receipt),corrections);
 const amounts=receiptAmountSummary(supported.map(row=>row.receipt),corrections);for(const part of Object.values(amounts)){part.total=rows.length;if(!part.known&&rows.length)part.value=null;}
 const best=rows.filter(r=>r.confirmed&&r.f.total!=null).reduce((a,b)=>!a||b.f.total>a.f.total?b:a,null),groups=[];
 for(const row of rows){let group=groups.find(g=>g.day===row.day);if(!group){group={day:row.day,rows:[],saved:0,missing:0};groups.push(group);}group.rows.push(row);group.saved=round(group.saved+(row.foreign?0:row.f.total??0));group.missing+=row.foreign||row.f.total==null?1:0;}
 for(const g of groups)if(g.missing===g.rows.length)g.saved=null;
 const known=supported.filter(r=>r.f.total!=null).length,promo=round(summary.categories.eatsPromotions+summary.categories.ridePromotions);
 return {imported,counts,count:rows.length,rows,groups,amounts,total:known||!rows.length?summary.total:null,
   promo:amounts.promos.value,
   promoCount:supported.filter(r=>r.f.categories.eatsPromotions+r.f.categories.ridePromotions>0).length,
   cash:amounts.cash.value,cashCount:supported.filter(r=>r.f.cashUsed>0).length,
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
  feeTotal:fees.every(([,n])=>n!=null)?round(fees.reduce((n,[,v])=>n+v,0)):null,fees:fees.filter(([,n])=>n!=null),tip:number(r.tip),paid:record.payment};
}
const amount=(v,className='',currency='GBP')=>'<strong class="'+(v==null?className.replace(/\bri-green\b/g,'')+' ri-unknown':className)+'">'+e(currencyMoney(v,currency))+'</strong>';
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
  else{const values=rows.map(r=>r.foreign?null:metric==='paid'?r.receiptTotal:metric==='promos'?r.promoValue:metric==='cash'?number(r.receipt.uberCashUsed):r.f.total),v=sumKnown(values);value=v.value;partial=v.known!==v.total;}
  if(!model.imported&&model.coverageIncomplete){partial=true;if(!rows.length)value=null;}
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
 const fields=[metrics.paid,metrics.subtotal,metrics.fees,metrics.amounts.promos,metrics.amounts.cash,metrics.outOfPocket];
 if(fields.every(s=>!s.known))return 'Amounts aren’t available for these receipts.';
 return fields.every(s=>s.known===count)&&metrics.fees.complete===count?'':'Some receipt details are missing';
}
const partialAmount=s=>s.known>0&&(s.known<s.total||s.complete!=null&&s.complete<s.total);
const amountLabel=(s,label,partialLabel)=>partialAmount(s)?partialLabel:label;
const coverageLabel=s=>partialAmount(s)?'<small class="ri-coverage">'+s.known+' of '+s.total+' receipts'+(s.complete!=null&&s.complete<s.known?' · itemised fees':'')+'</small>':'';
export function receiptCoverageDetails(metrics){
 return [['Receipt totals',metrics.paid],['Basket subtotal',metrics.subtotal],['Fees',metrics.fees],['Promo discounts',metrics.amounts.promos],['Uber Cash used',metrics.amounts.cash],['Out-of-pocket spend',metrics.outOfPocket]].map(([label,s])=>label+': '+(!s.known&&s.total?'not recorded':s.known+' of '+s.total+' receipts')+(s.complete!=null&&s.complete<s.known?' (partly itemised)':'')).join('. ')+'. Credit is a payment, not a promo saving. Spend uses recorded non-credit payments, or compatible receipt totals minus recorded credit. Unresolved adjustments are not assumed to be final payments.';
}
export function receiptOverviewMarkup(model,state){
 const m=receiptOverviewMetrics(model),activity=receiptActivityBuckets(model,state),period=activity.period;
 const select=(cls,label,choices,value)=>'<span class="ri-select-wrap"><select class="'+cls+'" aria-label="'+label+'"'+(cls==='ri-metric-select'?' style="width:calc('+(choices.find(([key])=>key===value)?.[1].length||6)+'ch + 38px)"':'')+'>'+choices.map(([key,text])=>'<option value="'+key+'"'+(value===key?' selected':'')+'>'+text+'</option>').join('')+'</select>'+icon('chevron-down')+'</span>';
 const filters='<div class="ri-period">'+select('ri-range','Receipt date range',RECEIPT_RANGES,state.range)+'<span>'+e(period.label)+'</span></div><div class="ri-filters" role="group" aria-label="Receipt type">'+[['eats','Eats'],['rides','Rides'],['all','All']].map(([key,label])=>'<button type="button" data-ri-service="'+key+'" aria-pressed="'+(state.service===key)+'" aria-label="'+label+', '+model.counts[key]+' receipts">'+label+'</button>').join('')+'</div>';
 const coverage=receiptAmountCoverage(m,model.count),promos=m.amounts.promos,cash=m.amounts.cash;
 const hero='<section class="ri-paid-card ri-card" aria-label="Out-of-pocket spend"><div class="ri-paid-label">'+amountLabel(m.outOfPocket,'Out-of-pocket spend','Known out-of-pocket spend')+'</div>'+amount(m.outOfPocket.value,'ri-paid-total')+'<p>'+(m.outOfPocket.known||model.count)+' '+(state.service==='rides'?'rides':state.service==='all'?'receipts':'orders')+(m.outOfPocket.known&&m.outOfPocket.value!=null?' · '+e(money(round(m.outOfPocket.value/m.outOfPocket.known)))+' average'+(partialAmount(m.outOfPocket)?' across '+m.outOfPocket.known+' known payment'+(m.outOfPocket.known===1?'':'s'):''):'')+'</p>'+coverageLabel(m.outOfPocket)+'<p class="ri-payment-caption">Paid by other methods</p>'+icon('wallet')+(coverage?'<div class="ri-amount-status"><span>'+e(coverage)+'</span><details class="ri-coverage-info"><summary aria-label="About missing receipt details">'+icon('info')+'</summary><p>'+e(receiptCoverageDetails(m))+'</p></details></div>':'')+'</section>';
 const cards='<section class="ri-card ri-combined"><h2>'+icon('tag')+'Promos &amp; Uber Cash</h2><div class="ri-combined-values"><div><span>'+amountLabel(promos,'Promo discounts','Known promo discounts')+'</span>'+amount(m.promos,'ri-green ri-promo-value')+'</div><div><span>'+amountLabel(cash,'Uber Cash used','Known Uber Cash used')+'</span>'+amount(m.cash,'ri-green ri-cash-value')+'</div></div></section>';
 const chart='<section class="ri-card ri-activity"><div class="ri-section-head"><h2>'+e(activity.title)+'</h2>'+select('ri-metric-select','Activity metric',RECEIPT_METRICS.map(([key,label])=>[key,key==='orders'?(state.service==='rides'?'Rides':state.service==='eats'?'Orders':'Receipts'):label]),state.metric)+'</div><div class="ri-activity-rows">'+activity.buckets.map(b=>'<div class="ri-activity-row"><span>'+e(b.label)+'</span><span class="ri-activity-track" aria-hidden="true"><span style="width:'+b.width+'%"></span></span><strong'+(b.value==null?' class="ri-unknown"':'')+'>'+(b.value==null?'—':state.metric==='orders'?b.value:e(money(b.value)))+(b.partial&&b.value!=null?'*':'')+'</strong></div>').join('')+'</div><p class="ri-caption">Based on imported receipts'+(activity.buckets.some(b=>b.partial&&b.value!=null)?' · * partial amounts':'')+'</p></section>';
 const recent=receiptRecentMarkup(model,state);
 if(state.page==='savings')return savingsMarkup(model,state,{filters,recent});
 return '<div class="ri-overview">'+filters+hero+cards+chart+recent+'<button class="ri-breakdown ri-card" data-open-sheet="savings">'+icon('insights')+'<span>Savings breakdown</span>'+icon('chevron-right')+'</button></div>';
}
// Savings is a promo-only projection of the same filtered, deduplicated receipts.
export function savingsModel(model,{data,offers=[]}={}){
 const promo=model.amounts.promos,singleAggregate=!model.imported&&promo.known===1&&promo.value>0?promo.value:null,rows=(model.rows||[]).filter(r=>r.promoValue!=null),contributing=rows.filter(r=>r.promoValue>0);
 const top=new Map();
 for(const row of contributing){
  const offer=appliedReceiptOffer(data,row.receipt,offers.filter(p=>['fixed','percent'].includes(p.discountType))),key=offer?'offer:'+offer.service+':'+(accountOfferKey(offer)||offer.offerId||offer.id):'unmatched';
  let group=top.get(key);if(!group){group={key,title:offer?(offerScopeLabel(accountOfferKey(offer))||'Recorded promo'):'Unmatched promos',value:0,ids:[]};top.set(key,group);}
  group.value=round(group.value+row.promoValue);group.ids.push(row.id);
 }
 return {promo,contributing,known:rows.length,average:contributing.length?round(contributing.reduce((n,r)=>n+r.promoValue,0)/contributing.length):singleAggregate,best:contributing.length?Math.max(...contributing.map(r=>r.promoValue)):singleAggregate,
  top:[...top.values()].sort((a,b)=>b.value-a.value||a.key.localeCompare(b.key))};
}
function savingsMarkup(model,state,{filters,recent}){
 const stats=savingsModel(model,state.source),activity=receiptActivityBuckets(model,{...state,metric:'promos'}),unit=state.service==='rides'?'ride':state.service==='all'?'receipt':'order';
 if(state.savingsList){
  const chosen=stats.top.find(g=>g.key===state.savingsOffer),ids=chosen?new Set(chosen.ids):null;
  const rows=stats.contributing.filter(r=>!ids||ids.has(r.id));
  // Reuse the receipt rows and direct detail navigation, with a strictly
  // contributing set rather than the general recent-receipts feed.
  const section=receiptRecentMarkup({...model,rows,count:rows.length},{...state,full:true,limit:state.limit});
  return '<div class="ri-overview savings-page">'+filters+'<button class="ri-more" data-ri-savings-back>'+icon('chevron-left')+' Back to Savings</button><h2>'+e(chosen?.title||'Savings receipts')+'</h2>'+section.replace('Recent receipts','Savings receipts').replace(/<button data-ri-view-all>.*?<\/button>/,'')+'</div>';
 }
 const total=stats.promo,partial=partialAmount(total),contributorText=model.imported?stats.contributing.length+' '+unit+(stats.contributing.length===1?'':'s')+' with promo discounts':total.known+' receipt'+(total.known===1?'':'s')+' with recorded promo amounts';
 const coverage=partial||total.value==null?'Some receipt details are missing':'';
 const hero='<section class="ri-card ri-paid-card savings-hero"><div class="ri-paid-label">'+(partial?'Known promo discounts':'Saved with promos')+'</div>'+amount(total.value,'ri-paid-total ri-green')+'<p>'+ (total.value==null?'Promo amounts aren’t available for these receipts.':'Across '+contributorText)+'</p>'+coverageLabel(total)+icon('tag')+(coverage?'<p class="ri-caption">'+coverage+'</p>':'')+'</section>';
 const support='<div class="ri-two-cards savings-support"><section class="ri-card"><h2>'+icon('insights')+(partial&&stats.average!=null?'Known average saving':'Average saving')+'</h2>'+amount(stats.average,'ri-green')+'<small>per contributing '+unit+'</small></section><section class="ri-card"><h2>'+icon('star')+(partial&&stats.best!=null?'Known best saving':'Best saving')+'</h2>'+amount(stats.best,'ri-green')+'<small>on one '+unit+'</small></section></div>';
 const chart='<section class="ri-card ri-activity"><div class="ri-section-head"><h2>Savings over time</h2><span class="ri-caption">'+e(RECEIPT_RANGES.find(([key])=>key===state.range)?.[1]||'Selected period')+'</span></div><div class="ri-activity-rows">'+activity.buckets.map(b=>'<div class="ri-activity-row"><span>'+e(b.label)+'</span><span class="ri-activity-track" aria-hidden="true"><span style="width:'+b.width+'%"></span></span><strong'+(b.value==null?' class="ri-unknown"':'')+'>'+e(money(b.value))+(b.partial&&b.value!=null?'*':'')+'</strong></div>').join('')+'</div><p class="ri-caption">Promo discounts on receipts'+(activity.buckets.some(b=>b.partial)?' · * known amounts':'')+'</p></section>';
 const ranking='<section class="ri-card savings-ranking"><h2>Your top offers</h2>'+stats.top.map(g=>'<button data-ri-top-offer="'+e(g.key)+'">'+icon('tag')+'<span><strong>'+e(g.title)+'</strong><small>'+g.ids.length+' '+unit+(g.ids.length===1?'':'s')+'</small></span>'+amount(g.value,'ri-green')+'</button>').join('')+(!stats.top.length?(total.value>0?'<div class="savings-unattributed">'+icon('tag')+'<span><strong>Other promos</strong><small>'+total.known+' receipt'+(total.known===1?'':'s')+' with recorded amounts</small></span>'+amount(total.value,'ri-green')+'</div>':'<p class="ri-caption">No recorded promo savings in this period.</p>'):'')+'</section>';
 return '<div class="ri-overview savings-page">'+filters+hero+support+chart+ranking+'<button class="ri-breakdown ri-card" data-ri-savings-list>'+icon('receipt-slip')+'<span>View savings receipts</span>'+icon('chevron-right')+'</button><p class="ri-caption">Based on recorded promo discounts.</p></div>';
}

function receiptRecentMarkup(model,state){
 const rows=model.imported?model.rows.slice(0,state.full?state.limit:2):[];
 return '<section class="ri-recent"><div class="ri-section-head"><h2>Recent receipts</h2>'+(model.imported&&model.count>2?'<button data-ri-view-all>'+ (state.full?'Show recent':'View all')+'</button>':'')+'</div><div class="ri-results ri-recent-list ri-card" aria-live="polite">'+(rows.length?rows.map(row=>{const r=row.receipt,money=v=>currencyMoney(v,String(r.currency||'GBP').toUpperCase()),fees=receiptPaymentRows(row),feeParts=fees.fees.filter(([,v])=>v>0),breakdown=number(r.uberCashUsed)>0?'Includes '+money(number(r.uberCashUsed))+' Uber Cash':[number(r.subtotal)!=null?money(number(r.subtotal))+' basket':null,number(r.promotionDiscount)!=null?money(number(r.promotionDiscount))+' promo':null,fees.feeTotal!=null?money(fees.feeTotal)+' fees':feeParts.length?money(feeParts.reduce((n,[,v])=>n+v,0))+' known fees':null].filter(Boolean).join(' · ');
  return '<button class="ri-receipt-row" data-ri-receipt="'+e(row.id)+'">'+icon('receipt-slip')+'<span class="ri-row-copy"><span class="ri-row-title">'+serviceTitle(row)+' <small>· '+e(dateLabel(row.day).replace(/ 20\d\d$/,''))+'</small></span>'+'<small>'+e(r.accountMasked||r.accountRef||'Account not recorded')+'</small>'+'</span><span class="ri-row-amount">'+amount(row.foreign?number(r.total):row.receiptTotal,'',String(r.currency||'GBP').toUpperCase())+'</span>'+icon('chevron-right')+'</button>';}).join(''):'<p class="ri-empty">'+(!model.imported?e(model.unavailable):'No receipts in this period.')+'</p>')+'</div>'+(state.full&&model.count>state.limit?'<button class="ri-more" data-ri-more>Show more receipts</button>':'')+'</section>';
}
export function receiptDetailMarkup(record,{data,offers=[]}={}){
 if(!record)return '<p class="ri-empty">This receipt is no longer in the imported data.</p>';
 const {receipt:r,f,confirmed}=record,currency=String(r.currency||'GBP').toUpperCase(),money=v=>currencyMoney(v,currency),detailAmount=(v,cls='')=>amount(v,cls,currency),payment=receiptPaymentRows(record.foreign?{...record,promoValue:number(r.promotionDiscount)}:record),offer=record.foreign?null:appliedReceiptOffer(data,r,offers);
 const line=(label,value,{deduction=false,positive=false}={})=>'<div class="ri-payment-line"><dt>'+e(label)+'</dt><dd class="'+(value==null?'ri-unknown':positive&&value>0?'ri-green':'')+'">'+(value==null?'—':(deduction&&value>0?'−':'')+e(money(value)))+'</dd></div>';
 let applied='<p class="ri-caption">'+(record.foreign?'This '+currency+' receipt stays separate from GBP totals.':data?.receiptMatchVersion===1?'No reliably matched offer.':'No reliably matched offer.')+'</p>';
 if(offer){const matches=offerMatchedReceipts(data,offer).slice().reverse(),index=matches.findIndex(x=>x.receiptId===r.receiptId),limit=offer.usesVerified===true&&Number.isInteger(offer.uses)&&offer.uses>0?offer.uses:null;
  const minimum=offer.minimumSpendVerified===true&&number(offer.minimumSpend)!=null&&payment.subtotal!=null?payment.subtotal>=offer.minimumSpend:null;
  applied='<div class="ri-applied-offer">'+icon('tag')+'<span><strong>'+e(offerScopeLabel(accountOfferKey(offer))||'Offer terms need checking')+'</strong><small>Used · '+e(dateLabel(record.day))+'</small></span>'+detailAmount(number(r.promotionDiscount),'ri-green')+'</div><div class="ri-offer-facts">'+(minimum!=null?'<span class="ri-confirmed">'+icon(minimum?'check':'info')+e(money(offer.minimumSpend))+' minimum '+(minimum?'met':'not met')+'</span>':'')+(limit&&index>=0?'<span class="ri-use-chip">'+(index<limit?'Use '+(index+1)+' of '+limit:'Usage needs checking')+'</span>':'')+'</div>';
 }
 const comparison=record.percent!=null?'<div class="ri-comparison" role="img" aria-label="'+record.percent+' percent saved, excluding Uber Cash payment"><span style="width:'+record.percent+'%"></span></div><div class="ri-comparison-label"><span>'+record.percent+'% saved</span><span>of '+e(money(record.before))+' before savings</span></div>':'';
 const fees=payment.fees.length?'<p class="ri-fee-detail">'+payment.fees.map(([label,v])=>e(label)+' '+e(money(v))).join(' · ')+(payment.feeTotal==null?' · other fees not shown':'')+'</p>':'';
 const other=Object.entries(f.categories).filter(([key,v])=>!['eatsPromotions','ridePromotions'].includes(key)&&v>0),labels={explicitUberOne:'Uber One savings',combinedUberOnePromotions:'Uber One & promos',schedule:'Schedule saving',other:'Other recorded savings'};
 return '<div class="ri-detail"><section class="ri-receipt-summary ri-card"><div class="ri-receipt-heading"><span class="ri-service-icon '+record.service+'">'+icon(record.service==='eats'?'bag':'ride')+'</span><span><h2>'+serviceTitle(record)+'</h2><p>'+e(receiptDateLabel(r))+(r.transportMode==='Lime'?' · Lime':'')+'</p></span>'+(confirmed?'<span class="ri-confirmed">'+icon('check')+'Confirmed</span>':'')+'</div><div class="ri-saved-paid"><div><span>You saved</span>'+detailAmount(f.total,'ri-green')+'</div><div><span>You paid</span>'+detailAmount(payment.paid)+'</div></div>'+comparison+(f.needsAdjustmentReview?'<p class="ri-caption">Refund or adjustment needs review.</p>':f.incomplete?'<p class="ri-caption">Savings are not recorded on this receipt.</p>':f.source==='manually_reported_from_uber'?'<p class="ri-caption">Savings corrected from Uber.</p>':'')+'</section><section class="ri-card ri-payment"><h2>'+icon('receipt')+'Payment summary</h2><dl>'+line('Subtotal',payment.subtotal)+line('Promo discount',payment.promo,{deduction:true,positive:true})+other.map(([key,v])=>line(labels[key],v,{deduction:true,positive:true})).join('')+line('Uber Cash used',payment.cash,{deduction:true})+line('Fees',payment.feeTotal)+fees+(payment.tip!=null?line('Tip',payment.tip):'')+(payment.paid==null&&record.receiptTotal!=null?line('Receipt total',record.receiptTotal):'')+'<div class="ri-payment-total">'+line('Total paid',payment.paid)+'</div></dl><p class="ri-caption">Uber Cash is a payment, not a saving.</p></section><section class="ri-card ri-applied"><h2>'+icon('tag')+'Applied offer</h2>'+applied+'</section>'+(confirmed?'<p class="ri-sync">'+icon('info')+'Confirmed from imported receipt data on this device.</p>':'')+'</div>';
}

export function createReceiptInsights({host,detailHost=host,getSource,onHeading,onOpenReceipt,getScroll=()=>host.scrollTop,setScroll=value=>{host.scrollTop=value;}}){
 const defaults={page:'receipts',savingsList:false,savingsOffer:null,range:'month',service:'eats',metric:'orders',full:false,limit:80,receiptId:null,scroll:0,focusId:null};
 let saved={};try{saved=JSON.parse(sessionStorage.getItem('uber-tracker-receipt-view:v1')||'{}');}catch{}
 const state={...defaults,...(RECEIPT_RANGES.some(([key])=>key===saved.range)?{range:saved.range}:{}),...(['all','eats','rides'].includes(saved.service)?{service:saved.service}:{}),...(RECEIPT_METRICS.some(([key])=>key===saved.metric)?{metric:saved.metric}:{})};
 const persist=()=>{try{sessionStorage.setItem('uber-tracker-receipt-view:v1',JSON.stringify({range:state.range,service:state.service,metric:state.metric}));}catch{}};
 const render=({restore=false}={})=>{
  const source=getSource(),target=state.receiptId?detailHost:host;onHeading(state.receiptId?'Receipt':state.page==='savings'?'Savings':'Receipt insights',state);
  const receipt=state.receiptId?source.data?.receipts?.find(r=>(r.receiptId||r.id)===state.receiptId):null;
  target.innerHTML=state.receiptId?receiptDetailMarkup(receipt?receiptInsightRecord(receipt,source.corrections?.[receipt.receiptId]):null,source):receiptOverviewMarkup(receiptInsightsModel({...source,...state}),{...state,source});
  if(restore){setScroll(state.scroll);host.querySelector('[data-ri-receipt="'+CSS.escape(state.focusId||'')+'"]')?.focus({preventScroll:true});}
 };
 const click=event=>{if(event.target.closest('[data-ri-savings-back]')){state.savingsList=false;state.savingsOffer=null;render();setScroll(state.savingsScroll||0);host.querySelector('[data-ri-savings-list]')?.focus({preventScroll:true});return;}const target=event.target.closest('[data-ri-service],[data-ri-receipt],[data-ri-more],[data-ri-view-all],[data-ri-savings-list],[data-ri-top-offer]');if(!target)return;
  if(target.hasAttribute('data-ri-savings-list')||target.hasAttribute('data-ri-top-offer')){state.savingsScroll=getScroll();state.savingsList=true;state.savingsOffer=target.dataset.riTopOffer??null;render();setScroll(0);host.querySelector('[data-ri-savings-back]')?.focus({preventScroll:true});}
  else if(target.dataset.riService){state.service=target.dataset.riService;state.savingsOffer=null;state.limit=80;persist();render();host.querySelector('[data-ri-service="'+state.service+'"]').focus({preventScroll:true});}
  else if(target.dataset.riReceipt){state.scroll=getScroll();state.focusId=target.dataset.riReceipt;onOpenReceipt(target.dataset.riReceipt);}
  else if(target.hasAttribute('data-ri-view-all')){state.full=!state.full;render();host.querySelector('[data-ri-view-all]')?.focus({preventScroll:true});}
  else{state.limit+=80;const scroll=getScroll();render();setScroll(scroll);host.querySelector('[data-ri-more]')?.focus({preventScroll:true});}
 };
 const change=event=>{if(event.target.matches('.ri-range')){state.range=event.target.value;state.savingsOffer=null;state.limit=80;persist();render();host.querySelector('.ri-range').focus({preventScroll:true});}else if(event.target.matches('.ri-metric-select')){state.metric=event.target.value;persist();render();host.querySelector('.ri-metric-select').focus({preventScroll:true});}};
 host.addEventListener('click',click);host.addEventListener('change',change);
 return {state,render,openReceipt(id){state.receiptId=id;render();detailHost.scrollTop=0;},back(){state.receiptId=null;render({restore:true});},refresh(){const scroll=state.receiptId?detailHost.scrollTop:getScroll();render();if(state.receiptId)detailHost.scrollTop=scroll;else setScroll(scroll);},destroy(){host.removeEventListener('click',click);host.removeEventListener('change',change);}};
}
