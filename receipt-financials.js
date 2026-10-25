// Pure calculations shared by the private Mac ledger and encrypted device UI.
// This file contains no receipt data and performs no storage/network operations.
export const financialCategories = ['eatsPromotions','ridePromotions','explicitUberOne','combinedUberOnePromotions','schedule','other'];
export function moneyAmount(value) {
  if (value == null || value === '') return null;
  const n=Number(value);
  if (!Number.isFinite(n) || n<0 || n>1000000) throw new Error('Enter a valid non-negative amount.');
  return Math.round((n+Number.EPSILON)*100)/100;
}
// Historic parser fields may contain invalid values. They are not evidence of
// savings; manual input remains strictly validated above.
const observed=value=>{try{return moneyAmount(value);}catch{return null;}};
const amount=value=>observed(value)??0;
const rounded=value=>Math.round((value+Number.EPSILON)*100)/100;

export function validateFinancialCorrection(value) {
  const total=moneyAmount(value?.total);
  if(total==null&&value?.reviewKind!=='receipt-review-v1')throw new Error('Enter the total savings shown in Uber.');
  const breakdown={};
  for(const key of financialCategories)if(value.breakdown?.[key]!=null&&value.breakdown[key]!=='')breakdown[key]=moneyAmount(value.breakdown[key]);
  const itemized=Object.values(breakdown).reduce((n,v)=>n+v,0);
  if(total!=null&&itemized>total+.011)throw new Error('The breakdown exceeds the total savings.');
  if(total!=null&&Object.keys(breakdown).length&&Math.abs(itemized-total)>.011)throw new Error('The itemized breakdown must equal the total. Leave it blank if unavailable.');
  if(value.reviewedReceiptRevision!=null&&!/^[a-f0-9]{64}$/.test(value.reviewedReceiptRevision))throw Error('Invalid receipt review revision.');
  const review={};
  if(value?.reviewKind==='receipt-review-v1'){
    review.reviewKind=value.reviewKind;review.currency=String(value.currency||'GBP').toUpperCase();if(!/^[A-Z]{3}$/.test(review.currency))throw Error('Choose a valid receipt currency.');
    for(const key of ['receiptTotal','cashUsed','promoDiscount','refundAmount','refundToOther','refundToCash'])if(value[key]!=null&&value[key]!=='')review[key]=moneyAmount(value[key]);
    if(value.refundDestination!=null){if(!['unknown','other','uber_cash','split'].includes(value.refundDestination))throw Error('Choose a recorded refund destination.');review.refundDestination=value.refundDestination;}
    if(review.refundDestination==='split'&&review.refundAmount!=null&&review.refundToOther!=null&&review.refundToCash!=null&&Math.abs(review.refundAmount-review.refundToOther-review.refundToCash)>.011)throw Error('Refund components must equal the refund amount.');
    const cashRefund=review.refundDestination==null&&review.refundAmount==null?0:review.refundDestination==='uber_cash'?review.refundAmount:review.refundDestination==='split'?review.refundToCash:review.refundDestination==='other'?0:null;
    if(cashRefund!=null&&review.cashUsed!=null&&cashRefund>review.cashUsed+.011)throw Error('The Cash refund exceeds the Cash payment.');
    if(review.receiptTotal!=null&&review.cashUsed!=null&&value.outOfPocket!=null&&value.outOfPocket!==''&&cashRefund!=null&&Math.abs(moneyAmount(value.outOfPocket)+review.cashUsed-cashRefund-review.receiptTotal)>.011)throw Error('Final payment components do not match the final receipt charge. Check the amounts or leave uncertain fields blank.');
    if(total==null&&!['receiptTotal','cashUsed','promoDiscount','refundAmount','refundToOther','refundToCash'].some(k=>review[k]!=null)&&(value.outOfPocket==null||value.outOfPocket===''))throw Error('Enter at least one amount to correct.');
  }
  return {...(total!=null?{total}:{}),...review,breakdown,...(value.outOfPocket!=null?{outOfPocket:moneyAmount(value.outOfPocket)}:{}),...(value.reviewedReceiptRevision?{reviewedReceiptRevision:value.reviewedReceiptRevision}:{}),source:'manually_reported_from_uber',note:String(value.note||'').slice(0,500)};
}

export function validateCashEntry(value={}) {
 if(value.receiptCount!=null&&(!Number.isInteger(value.receiptCount)||value.receiptCount<0||value.receiptCount>1000000))throw Error('Invalid receipt evidence count.');const balance=moneyAmount(value.balance);if(balance==null)throw Error('Enter the current balance shown in Uber. An email Cash offer is not a balance.');const stacking=value.stacking||'unknown';if(!['unknown','supported','unsupported'].includes(stacking))throw Error('Invalid stacking evidence.');const fees=moneyAmount(value.checkoutFees),basket=moneyAmount(value.basketSubtotal);if((fees!=null||basket!=null)&&(fees==null||basket==null||basket<=0||basket>1000))throw Error('Record both the checkout fees and the matching basket subtotal.');return {balance,stacking,...(value.receiptCount!=null?{receiptCount:value.receiptCount}:{}),source:'manually_verified_in_uber',note:String(value.note||'').slice(0,500),...(fees!=null?{checkoutFees:fees,basketSubtotal:basket}:{})};
}

// Read-only overrides. Original imported records remain unchanged.
export function correctedReceipt(receipt={},correction=receipt.financialCorrection){
 if(correction?.reviewKind!=='receipt-review-v1')return receipt;
 const result={...receipt};for(const [key,target]of [['receiptTotal','total'],['cashUsed','uberCashUsed'],['promoDiscount','promotionDiscount'],['refundAmount','refundAmount']])if(correction[key]!=null)result[target]=correction[key];
 if(correction.refundDestination){result.refundMethod={other:'Other payment methods',uber_cash:'Uber Cash',split:'Split payment methods',unknown:''}[correction.refundDestination];if(correction.refundDestination==='other')result.cashRefundRestored=0;if(correction.refundDestination==='uber_cash'&&correction.refundAmount!=null)result.cashRefundRestored=correction.refundAmount;}
 return result;
}
export function receiptRefundParts(receipt={},correction=receipt.financialCorrection){
 const r=correctedReceipt(receipt,correction),refund=(r.refundAmount??r.financialEvidence?.refund)==null?null:observed(Math.abs(Number(r.refundAmount??r.financialEvidence?.refund))),restored=observed(r.cashRefundRestored),target=String(correction?.reviewKind==='receipt-review-v1'&&correction.refundDestination==='unknown'?'':r.refundMethod||r.financialEvidence?.refundMethod||''),cash=/^(?:uber[ _-]?(?:cash|credit)|account[ _-]?credit)$/i.test(target),other=!/uber[ _-]?cash|account[ _-]?credit/i.test(target)&&/visa|mastercard|amex|paypal|apple pay|google pay|bank|debit|card|non[ _-]?(?:cash|credit)|other payment methods/i.test(target);
 if(correction?.reviewKind==='receipt-review-v1'&&correction.refundDestination==='split')return [{method:'Other payment methods',value:observed(correction.refundToOther),cash:false,unallocated:correction.refundToOther==null},{method:'Uber Cash',value:observed(correction.refundToCash),cash:true,unallocated:correction.refundToCash==null}];
 const parts=[];if(restored>0)parts.push({method:'Uber Cash',value:cash&&refund!=null&&Math.abs(refund-restored)>.011?null:restored,cash:true,unallocated:false});
 if(refund!=null&&refund>0&&!(cash&&restored>0))parts.push({method:cash?'Uber Cash':target||'Refund method not recorded',value:!cash&&!other&&restored>0?null:refund,cash,unallocated:!cash&&!other});
 if(!parts.length&&receipt.financialReview?.reasons?.includes('refund'))parts.push({method:'Refund method not recorded',value:refund===0?0:null,cash:false,unallocated:refund!==0});
 return parts;
}
export function receiptReviewState(receipt={},correction=receipt.financialCorrection){
 const r=correctedReceipt(receipt,correction),f=receiptFinancials(receipt,correction),parts=receiptRefundParts(receipt,correction),issues=[];
 if(parts.some(p=>p.value==null))issues.push('Refund amount missing');if(parts.some(p=>p.unallocated&&p.value!==0))issues.push('Refund destination unknown');
 if(observed(r.total)==null)issues.push('Receipt charge missing');if(receiptPaymentAmount(receipt,correction)==null)issues.push('Final payment needs checking');if(observed(r.uberCashUsed)==null)issues.push('Uber Cash payment unknown');if(observed(r.promotionDiscount)==null&&f.incomplete)issues.push('Promo amount missing');
 if(f.needsAdjustmentReview&&!issues.length)issues.push('Adjustment needs checking');
 return {needsChecking:issues.length>0,issues,refund:parts.length>0,manuallyCorrected:Boolean(correction),receipt:r,financial:f};
}

export function receiptFinancials(receipt={},correction=receipt.financialCorrection||null) {
  receipt=correctedReceipt(receipt,correction);
  const categories=Object.fromEntries(financialCategories.map(k=>[k,0]));
  const metadata=receipt.financialEvidence||{};
  const promo=amount(receipt.promotionDiscount),one=amount(receipt.uberOneSavings),cashSaving=amount(receipt.uberCashSavings),schedule=amount(metadata.scheduleSavings??receipt.scheduleSavings);
  const reported=observed(receipt.reportedSavings);
  const reportedKind=metadata.reportedKind||'total';
  const components=rounded(promo+one+cashSaving);
  const total=rounded(Math.max(components+schedule,reported??0));
  const stated=[receipt.promotionDiscount,receipt.uberOneSavings,receipt.uberCashSavings,receipt.reportedSavings,metadata.scheduleSavings,receipt.scheduleSavings].some(v=>observed(v)!=null);
  const conflict=reported!=null&&components+schedule>reported+.011;
  categories[receipt.service==='Uber'?'ridePromotions':'eatsPromotions']=promo;
  categories.explicitUberOne=one;categories.schedule=schedule;categories.other=cashSaving;
  categories[reportedKind==='combined'?'combinedUberOnePromotions':'other']+=Math.max(0,total-components-schedule);
  for(const k of financialCategories)categories[k]=rounded(categories[k]);
  const cash=observed(receipt.uberCashUsed),paid=observed(receipt.total);
  const explicitPayment=observed(metadata.outOfPocket);
  // A confirmed zero charge needs no payment allocation. Positive charges
  // still require Cash evidence; adjustment review is enforced by the caller.
  const zeroCharge=paid===0&&(cash==null||cash===0)&&!receipt.financialReview?.reasons?.length&&!([receipt.refundAmount,metadata.refund].some(v=>observed(v)!=null&&Number(v)!==0))&&!(observed(receipt.previousTotal??metadata.previousTotal)>0);
  const outOfPocket=explicitPayment??(zeroCharge?0:paid!=null&&cash!=null&&paid>=cash?rounded(paid-cash):null);
  const needsAdjustmentReview=Boolean(receipt.financialReview?.reasons?.length&&receipt.financialReview?.revision);
  const result={total:stated?total:null,categories,source:stated?'email_reported':'incomplete',incomplete:!stated,needsAdjustmentReview,conflict,cashUsed:cash??0,outOfPocket};
  if(!correction)return result;
  const manual=validateFinancialCorrection(correction);
  return {...result,total:manual.total??result.total,categories:manual.total==null?result.categories:Object.keys(manual.breakdown).length?{...Object.fromEntries(financialCategories.map(k=>[k,0])),...manual.breakdown}:{...Object.fromEntries(financialCategories.map(k=>[k,0])),other:manual.total},source:manual.source,outOfPocket:manual.outOfPocket??result.outOfPocket,incomplete:manual.total==null?result.incomplete:false,needsAdjustmentReview:needsAdjustmentReview&&(manual.reviewedReceiptRevision!==receipt.financialReview.revision||manual.outOfPocket==null),conflict:manual.total!=null&&stated&&Math.abs(total-manual.total)>.011,emailTotal:result.total,manualUpdatedAt:correction.at||null};
}

// Availability for receipt projections, without changing the stored ledger or
// savings. A changed receipt can retain an older credit/payment allocation.
// Only a correction reviewed against that revision establishes final spend.
export function receiptPaymentAmount(receipt={},correction=receipt.financialCorrection||null){
 const f=receiptFinancials(receipt,correction),previous=observed(receipt.previousTotal??receipt.financialEvidence?.previousTotal),paid=observed(receipt.total);
 const legacyAdjustment=[receipt.refundAmount,receipt.financialEvidence?.refund].some(v=>v!=null&&Number.isFinite(Number(v))&&Number(v)!==0)||previous!=null&&paid!=null&&Math.abs(previous-paid)>.011;
 const reviewed=correction?.outOfPocket!=null&&(!receipt.financialReview?.revision||correction.reviewedReceiptRevision===receipt.financialReview.revision);
 if((f.needsAdjustmentReview||legacyAdjustment)&&!reviewed)return null;
 return f.outOfPocket;
}

export function financialSummary(receipts=[],corrections={}) {
  const categories=Object.fromEntries(financialCategories.map(k=>[k,0]));
  let total=0,missing=0,missingSavings=0,adjustmentsNeedingReview=0,conflicting=0,cashUsed=0,outOfPocket=0,paymentKnown=0,manual=0;
  const seen=new Set();
  for(const receipt of receipts){const id=receipt.receiptId||receipt.id;if(!id||seen.has(id))continue;seen.add(id);
    const f=receiptFinancials(receipt,corrections[id]);total+=f.total??0;missing+=f.incomplete||f.needsAdjustmentReview?1:0;missingSavings+=f.incomplete?1:0;adjustmentsNeedingReview+=f.needsAdjustmentReview?1:0;conflicting+=f.conflict?1:0;cashUsed+=f.cashUsed;
    if(f.outOfPocket!=null){outOfPocket+=f.outOfPocket;paymentKnown++;}if(f.source==='manually_reported_from_uber')manual++;
    for(const k of financialCategories)categories[k]+=f.categories[k];
  }
  for(const k of financialCategories)categories[k]=rounded(categories[k]);
  return {total:rounded(total),categories,missing,missingSavings,adjustmentsNeedingReview,conflicting,cashUsed:rounded(cashUsed),outOfPocket:rounded(outOfPocket),paymentKnown,receipts:seen.size,manual};
}

// Events are append-only. Undo removes the correction, never the email evidence.
export function currentFinancialEvents(events=[]) {
  const corrections=Object.create(null),wallets=Object.create(null);
  // Stable sort preserves append order when two actions share a millisecond.
  const ordered=[...events].sort((a,b)=>String(a.at).localeCompare(String(b.at)));
  const seen=new Set();
  for(const event of ordered){if(seen.has(event.id))continue;seen.add(event.id);
    const target=event.kind==='receipt'?corrections:wallets;
    if(event.action==='undo')delete target[event.recordId];else target[event.recordId]={...event.value,at:event.historyValueAt||event.at,eventId:event.id};
  }
  return {corrections,wallets};
}

// Compensating events retain the audit trail. A new edit clears redo for that
// record only; navigating, importing and reloading retain its undo history.
export function financialEditHistory(events=[],kind,recordId) {
  const undo=[],redo=[],seen=new Set();let value=null,valueAt=null;
  for(const event of [...events].sort((a,b)=>String(a.at).localeCompare(String(b.at)))) {
    if(event.kind!==kind||event.recordId!==recordId||seen.has(event.id))continue;
    seen.add(event.id);
    const after=event.action==='undo'?null:event.value;
    const afterAt=after===null?null:event.historyValueAt||event.at;
    if(event.historyAction==='undo'&&undo.at(-1)?.event.id===event.historyTargetId)redo.push(undo.pop());
    else if(event.historyAction==='redo'&&redo.at(-1)?.event.id===event.historyTargetId)undo.push(redo.pop());
    else {undo.push({event,before:value,beforeAt:valueAt,after,afterAt});redo.length=0;}
    value=after;valueAt=afterAt;
  }
  return {undo:undo.at(-1)||null,redo:redo.at(-1)||null};
}

export function financialHistoryMetadata(event) {
  if(event.historyAction==null&&event.historyTargetId==null&&event.historyValueAt==null)return {};
  if(!['undo','redo'].includes(event.historyAction)||!/^[a-z0-9-]{8,80}$/i.test(event.historyTargetId||''))throw Error('Invalid financial undo/redo history.');
  if(event.historyValueAt!=null&&(!Number.isFinite(Date.parse(event.historyValueAt))||Date.parse(event.historyValueAt)>Date.parse(event.at)))throw Error('Invalid restored financial evidence date.');
  return {historyAction:event.historyAction,historyTargetId:event.historyTargetId,...(event.historyValueAt?{historyValueAt:event.historyValueAt}:{})};
}
