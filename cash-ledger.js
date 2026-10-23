import {expiryEndTime,applyOfferExpiryPolicy,offerTime,ukDateKey} from './offer-time.js';
import {receiptWhen} from './receipt-date.js';

const money=value=>Math.round((Number(value)+Number.EPSILON)*100)/100;
const time=value=>value?offerTime(value):null;
const amount=value=>value==null||value===''||!Number.isFinite(Number(value))?null:Math.max(0,money(value));
const grantKey=g=>g.grantRef||g.offerId||g.id||[g.accountRef,g.discount,g.firstEmailSentAt||g.emailSentAt,g.expiresAt||g.expires].join('|');

// Older supported summaries may predate the email-cutoff policy. Derive a view
// without rewriting a grant, its spending, or the verified wallet baseline.
function cashGrantWithDeadline(grant,offers=[]){
 if(time(grant.expiresAt)!=null)return grant;
 if(time(grant.issuedAt)==null)return grant;
 const source=offers.filter(p=>p.discountType==='uberCash'&&amount(p.discount)===amount(grant.issued)&&time(p.firstEmailSentAt||p.emailSentAt)===time(grant.issuedAt))
  .map(applyOfferExpiryPolicy).filter(p=>expiryEndTime(p)!=null).sort((a,b)=>Number(b.expiryStatus==='exact')-Number(a.expiryStatus==='exact'))[0];
 const policy=source||applyOfferExpiryPolicy({discountType:'uberCash',firstEmailSentAt:grant.issuedAt});
 return expiryEndTime(policy)==null?grant:{...grant,expiresAt:policy.expiresAt,expiryBasis:policy.expiryBasis};
}

// Pure reconstruction. Source references and allocations stay in the private
// ledger; only sanitised, explicitly estimated amounts may be exported.
export function dedupeCashGrants(sources=[]){
 const ordered=sources.filter(s=>s.discountType==='uberCash'&&amount(s.discount)>0).slice().sort((a,b)=>(time(a.firstEmailSentAt||a.emailSentAt)??Infinity)-(time(b.firstEmailSentAt||b.emailSentAt)??Infinity));
 const result=[],seen=new Set();
 for(const source of ordered){
  const sourceRef=source.messageKey||source.messageId||source.id||source.offerId;
  if(sourceRef&&seen.has(sourceRef))continue;if(sourceRef)seen.add(sourceRef);
  const at=time(source.firstEmailSentAt||source.emailSentAt),terms=source.cashTerms||source.evidence?.cashTerms||{};
  const explicitRef=terms.grantReference||source.grantRef;
  const normalised=applyOfferExpiryPolicy(source),end=expiryEndTime(normalised);
  let previous=result.find(g=>g.accountRef===source.accountRef&&g.service===source.service&&(!terms.explicitNewGrant||explicitRef||at===g.at)&&(
   explicitRef&&g.explicitRef===explicitRef||!explicitRef&&!g.explicitRef&&g.issued===amount(source.discount)&&
   (g.sourceOfferIds.includes(source.offerId||source.id)||terms.reminder===true||!terms.explicitNewGrant&&at!=null&&g.at!=null&&at>=g.at&&(g.end==null||at<=g.end))));
  if(previous){previous.sourceRefs.push(sourceRef);if(source.offerId||source.id)previous.sourceOfferIds.push(source.offerId||source.id);
   // Explicit later deadline evidence can refine a grant, never turn a reminder
   // into a new issue or re-anchor a duration to the reminder date.
   if(normalised.expiryStatus==='exact'&&end!=null&&(previous.end==null||previous.expiryBasis==='tracker_35_day_rule'||end<previous.end||terms.expiryExtension===true)){previous.end=end;previous.expiryBasis=normalised.expiryBasis;}
   continue;
  }
  previous={grantRef:grantKey(source),explicitRef:explicitRef||null,accountRef:source.accountRef,service:source.service,issued:amount(source.discount),minimumSpend:amount(source.minimumSpend)||0,at,end,
   expiryBasis:normalised.expiryBasis||null,sourceRefs:[sourceRef],sourceOfferIds:[source.offerId||source.id].filter(Boolean),terms,restrictions:source.restrictions||source.evidence?.restrictions||{},allocations:[]};
  result.push(previous);
 }
 return result;
}

function uniqueReceipts(receipts){
 const map=new Map();
 for(const r of receipts){const id=r.orderId||r.tripId||r.receiptId||r.id||r.messageKey;if(!id)continue;
  const key=r.accountRef+'|'+String(id).trim().toUpperCase(),old=map.get(key);
  if(!old||(time(r.receivedAt||r.sentAt)??0)>(time(old.receivedAt||old.sentAt)??0))map.set(key,r);
 }
 return [...map.values()].sort((a,b)=>(time(receiptWhen(a))??Infinity)-(time(receiptWhen(b))??Infinity));
}
function cashPayment(receipt){
 const correction=receipt.financialCorrection;
 const value=amount(correction?.uberCashUsed??receipt.uberCashUsed);
 const text=String(receipt.cashUsageKind||receipt.evidence?.uberCash||receipt.financialEvidence?.uberCash||'');
 return {value,ambiguous:!Object.hasOwn(correction||{},'uberCashUsed')&&(receipt.cashUsageAmbiguous===true||/uber credits?|credit used/i.test(text)&&!/uber cash/i.test(text))};
}
export function reconcileCashGrants(sources=[],receipts=[],{now=Date.now()}={}){
 const nowTime=time(now)??Number(now),grants=dedupeCashGrants(sources).map(g=>({...g,remaining:g.issued,uncertain:false,allocations:[]})),unallocated=[];
 for(const receipt of uniqueReceipts(receipts)){
  const payment=cashPayment(receipt),at=time(receiptWhen(receipt)),restored=amount(receipt.cashRefundRestored);if(!(payment.value>0)&&!(restored>0))continue;
  if(at!=null&&at>nowTime){unallocated.push({accountRef:receipt.accountRef,receiptRef:receipt.receiptId,amount:payment.value,reason:'future_purchase_time'});continue;}
  const candidates=grants.filter(g=>g.accountRef===receipt.accountRef&&g.at!=null&&at!=null&&at>=g.at&&(g.end==null||at<g.end)&&g.remaining>0&&
   (g.service!=='Uber Eats'||!receipt.service||receipt.service==='Uber Eats'));
  if(at==null){for(const g of grants.filter(g=>g.accountRef===receipt.accountRef))g.uncertain=true;unallocated.push({accountRef:receipt.accountRef,receiptRef:receipt.receiptId,amount:payment.value,reason:'unknown_purchase_time'});continue;}
  let left=payment.value||0;
  const explicit=receipt.cashGrantRef;
  if(payment.ambiguous)for(const g of candidates)g.uncertain=true;
  if(/^\d{4}-\d{2}-\d{2}$/.test(receiptWhen(receipt)||'')){const boundaries=grants.filter(g=>g.accountRef===receipt.accountRef&&(ukDateKey(g.at)===receiptWhen(receipt)||ukDateKey(g.end)===receiptWhen(receipt)));if(boundaries.length){for(const g of boundaries)g.uncertain=true;unallocated.push({accountRef:receipt.accountRef,receiptRef:receipt.receiptId,amount:left,reason:'date_only_grant_boundary'});continue;}}
  if(left>0&&explicit&&!candidates.some(g=>g.grantRef===explicit||g.explicitRef===explicit)){
   for(const g of candidates)g.uncertain=true;unallocated.push({accountRef:receipt.accountRef,receiptRef:receipt.receiptId,amount:left,reason:'different_or_missing_grant_reference'});continue;
  }
  for(const g of candidates.filter(g=>!explicit||g.grantRef===explicit||g.explicitRef===explicit).sort((a,b)=>a.at-b.at)){
   if(left<=0)break;const used=money(Math.min(left,g.remaining));g.remaining=money(g.remaining-used);left=money(left-used);
   g.uncertain ||=payment.ambiguous;
   g.allocations.push({receiptRef:receipt.receiptId||receipt.id,at:new Date(at).toISOString(),amount:used,basis:explicit?'explicit_grant':'chronological_estimate',ambiguous:payment.ambiguous});
  }
  if(left>0)unallocated.push({accountRef:receipt.accountRef,receiptRef:receipt.receiptId,amount:left,reason:'usage_exceeds_known_grants'});
  // A refund total alone is not evidence of restored wallet credit.
  if(restored>0&&explicit){const g=grants.find(g=>g.accountRef===receipt.accountRef&&(g.grantRef===explicit||g.explicitRef===explicit));if(g&&at>=g.at){g.remaining=money(Math.min(g.issued,g.remaining+restored));g.allocations.push({receiptRef:receipt.receiptId,amount:-restored,basis:'explicit_cash_refund'});}}
 }
 for(const g of grants){g.status=g.end!=null&&nowTime>=g.end?'expired':g.at==null||g.at>nowTime||g.end==null||g.uncertain?'needs_checking':g.remaining<=0?'exhausted':'estimated';g.spendable=['estimated'].includes(g.status)?g.remaining:0;}
 return {grants,unallocated,at:new Date(nowTime).toISOString()};
}
export function publicCashEstimate(grant){
 return {issuedAt:grant.at==null?null:new Date(grant.at).toISOString(),status:grant.status,remaining:grant.status==='needs_checking'?null:grant.status==='expired'?0:grant.remaining,issued:grant.issued,
  recordedUsed:grant.uncertain?null:money(Math.max(0,grant.issued-grant.remaining)),
  expiresAt:grant.end==null?null:new Date(grant.end).toISOString(),allocation:grant.allocations?.length?'inferred_from_receipts':'no_recorded_usage'};
}
export function summariseCash(grants=[]){
 const current=grants.filter(g=>g.status==='estimated'),remaining=money(current.reduce((n,g)=>n+g.remaining,0));
 return {status:remaining>0?'estimated':grants.some(g=>g.status==='needs_checking')?'needs_checking':grants.some(g=>g.status==='exhausted')?'exhausted':grants.length?'expired':'none',remaining:remaining>0?remaining:grants.some(g=>g.status==='needs_checking')?null:0,
  expiresAt:current.length?new Date(Math.min(...current.map(g=>g.end))).toISOString():null,hasUncertainty:grants.some(g=>g.status==='needs_checking'),
  grants:grants.map(g=>({...publicCashEstimate(g),minimumSpend:amount(g.minimumSpend??g.terms.minimumSpend)||0,excludesFees:Boolean(g.terms.excludesFees),restrictions:{stacking:g.restrictions.stacking||null}}))};
}

export function reconcileVerifiedCash(wallet,receipts=[],{account={},now=Date.now(),completeEvidence=false}={}){
 if(!wallet||amount(wallet.balance)==null||time(wallet.at)==null||(time(now)??Number(now))<time(wallet.at))return null;
 const cutoff=time(wallet.at),seen=new Set();let remaining=amount(wallet.balance),spent=0,uncertain=false,issuedSinceVerification=0;
 for(const original of account.cashSummary?.grants||[]){const g=cashGrantWithDeadline(original),issuedAt=time(g.issuedAt),end=time(g.expiresAt);if(end!=null&&end>cutoff&&end<=(time(now)??Number(now))&&remaining>0)uncertain=true;if(issuedAt>cutoff&&issuedAt<=(time(now)??Number(now))){if(end==null||end<=(time(now)??Number(now)))uncertain=true;else issuedSinceVerification=money(issuedSinceVerification+g.issued);}}
 remaining=money(remaining+issuedSinceVerification);
 const count=Number(account.orderCount||0)+Number(account.rideCount||0);
 completeEvidence=completeEvidence&&uniqueReceipts(receipts.filter(r=>r.accountRef===account.accountRef)).length===count;
 if(!completeEvidence&&((wallet.receiptCount!=null&&count!==wallet.receiptCount)||[account.lastOrderAt,account.lastRideAt].some(at=>time(at)>cutoff)))uncertain=true;
 for(const r of uniqueReceipts(receipts).filter(r=>r.accountRef===account.accountRef)){
  const when=receiptWhen(r),at=time(when),payment=cashPayment(r);
  if(/^\d{4}-\d{2}-\d{2}$/.test(when||'')&&ukDateKey(wallet.at)===when){uncertain=true;continue;}
  if(at==null){if(payment.value>0||payment.value==null)uncertain=true;continue;}if(at<=cutoff||at>(time(now)??Number(now)))continue;
  if(payment.value==null){uncertain=true;continue;}
  const key=r.receiptId||r.id;if(seen.has(key))continue;seen.add(key);
  if(payment.ambiguous){uncertain=true;continue;}spent=money(spent+payment.value);
  remaining=money(Math.max(0,remaining-payment.value));
  if(amount(r.cashRefundRestored)>0)remaining=money(remaining+amount(r.cashRefundRestored));
 }
 return {...wallet,status:uncertain?'needs_checking':spent||issuedSinceVerification?'verified_reconciled':'verified',remaining:uncertain?null:remaining,balance:uncertain?null:remaining,verifiedAt:wallet.at,spentSinceVerification:spent,issuedSinceVerification,estimated:spent>0||issuedSinceVerification>0,uncertain};
}

export function currentCashPosition(account,offers=[],wallet=null,receipts=[],{now=Date.now(),completeEvidence=false,ignoredEstimates=[]}={}){
 const verified=reconcileVerifiedCash(wallet,receipts,{account,now,completeEvidence});
 // A manual verification remains the reconciliation baseline. If later
 // evidence is incomplete, an older email estimate cannot replace it.
 if(verified)return {...verified,verificationNeedsChecking:Boolean(verified.uncertain)};
 const nowTime=time(now)??Number(now),summary=account.cashSummary;
 const key=g=>[g.issuedAt||'',g.issued,g.expiresAt||''].join('|'),ignored=new Set(ignoredEstimates.map(key));
 const source=(summary?.grants?.length?summary.grants:offers.filter(p=>p.discountType==='uberCash').map(p=>({...creditFromOffer(p),minimumSpend:p.minimumSpend||0,excludesFees:p.cashTerms?.excludesFees,restrictions:p.restrictions||{}}))).filter(g=>!ignored.has(key(g)));
 const normalised=source.map(g=>cashGrantWithDeadline(g,offers)).map(g=>({...g,status:cashGrantState(g,nowTime)}));
 const current=normalised.filter(g=>g.status==='estimated'&&g.remaining>0&&time(g.expiresAt)>nowTime);
 const remaining=money(current.reduce((sum,g)=>sum+g.remaining,0));
 const unknown=normalised.some(g=>g.status==='needs_checking');
 return {status:remaining>0?'estimated':unknown?'needs_checking':normalised.some(g=>g.status==='exhausted')?'exhausted':source.length?'expired':'none',remaining:remaining>0?remaining:unknown?null:0,
  balance:remaining>0?remaining:unknown?null:0,grants:current,at:new Date(nowTime).toISOString(),estimated:true,verificationNeedsChecking:Boolean(verified?.uncertain),
  stacking:current.some(g=>g.restrictions?.stacking==='no_other_promotions')?'restricted':'unknown'};
}

function creditFromOffer(p){
 if(p.cashEstimate)return cashGrantWithDeadline(p.cashEstimate,[p]);
 const end=expiryEndTime(applyOfferExpiryPolicy(p));
 return {issued:p.discount,issuedAt:p.firstEmailSentAt||p.emailSentAt,expiresAt:end==null?null:new Date(end).toISOString(),status:'needs_checking',remaining:null};
}

// Re-evaluate deadlines at render/calculation time, including stale exports.
export function cashGrantState(grant,now=Date.now()){
 grant=cashGrantWithDeadline(grant);
 const end=time(grant.expiresAt),clock=time(now)??Number(now);
 if(end!=null&&end<=clock)return 'expired';
 if(grant.status==='duplicate')return 'duplicate';
 if(grant.status==='exhausted')return 'exhausted';
 if(grant.status==='expired')return 'expired';
 if(grant.status==='estimated'&&amount(grant.remaining)===0)return 'exhausted';
 if(grant.status==='estimated'&&end!=null&&amount(grant.remaining)>0)return 'estimated';
 return 'needs_checking';
}

// The summary is the deduplicated credit ledger. Offer rows only supply terms
// and actions; reminders must not add another balance or another history row.
export function cashCreditHistory(account,offers=[],now=Date.now()){
 const records=(account.cashSummary?.grants||[]).map(g=>({...cashGrantWithDeadline(g,offers),offers:[]}));
 const same=(a,b)=>a.issuedAt===b.issuedAt&&a.issued===b.issued&&a.expiresAt===b.expiresAt;
 for(const p of offers.filter(p=>p.discountType==='uberCash')){
  const g=creditFromOffer(p);
  if(g.status==='duplicate')continue;
  let record=records.find(r=>same(r,g));
  if(!record){record={...g,offers:[]};records.push(record);}
  record.offers.push(p);
 }
 return records.map(g=>({...g,status:cashGrantState(g,now)})).sort((a,b)=>(time(b.issuedAt)||0)-(time(a.issuedAt)||0));
}

export function cashCalculationState(wallet,promo=null){
 const positive=amount(wallet?.remaining??wallet?.balance)>0&&['estimated','verified','verified_reconciled'].includes(wallet?.status);
 if(!positive){
  const closed=['none','expired','exhausted','duplicate'].includes(wallet?.status);
  return {usable:false,reason:wallet&&!closed&&(wallet.status==='needs_checking'||amount(wallet.remaining??wallet.balance)==null)?'Balance needs checking':'No available Uber Cash'};
 }
 const restricted=promo&&(wallet.stacking==='unsupported'||promo.restrictions?.stacking==='no_other_promotions'||wallet.stacking==='restricted'&&wallet.grants?.length&&wallet.grants.every(g=>g.restrictions?.stacking==='no_other_promotions'));
 if(restricted)return {usable:false,reason:'Cannot combine with this promo'};
 return {usable:true,reason:promo&&wallet.stacking!=='supported'?'Cash compatibility not verified':null};
}
