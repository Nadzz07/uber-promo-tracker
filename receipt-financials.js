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
  if(total==null)throw new Error('Enter the total savings shown in Uber.');
  const breakdown={};
  for(const key of financialCategories)if(value.breakdown?.[key]!=null&&value.breakdown[key]!=='')breakdown[key]=moneyAmount(value.breakdown[key]);
  const itemized=Object.values(breakdown).reduce((n,v)=>n+v,0);
  if(itemized>total+.011)throw new Error('The breakdown exceeds the total savings.');
  if(Object.keys(breakdown).length&&Math.abs(itemized-total)>.011)throw new Error('The itemized breakdown must equal the total. Leave it blank if unavailable.');
  if(value.reviewedReceiptRevision!=null&&!/^[a-f0-9]{64}$/.test(value.reviewedReceiptRevision))throw Error('Invalid receipt review revision.');
  return {total,breakdown,...(value.outOfPocket!=null?{outOfPocket:moneyAmount(value.outOfPocket)}:{}),...(value.reviewedReceiptRevision?{reviewedReceiptRevision:value.reviewedReceiptRevision}:{}),source:'manually_reported_from_uber',note:String(value.note||'').slice(0,500)};
}

export function validateCashEntry(value={}) {
 if(value.receiptCount!=null&&(!Number.isInteger(value.receiptCount)||value.receiptCount<0||value.receiptCount>1000000))throw Error('Invalid receipt evidence count.');const balance=moneyAmount(value.balance);if(balance==null)throw Error('Enter the current balance shown in Uber. An email Cash offer is not a balance.');const stacking=value.stacking||'unknown';if(!['unknown','supported','unsupported'].includes(stacking))throw Error('Invalid stacking evidence.');const fees=moneyAmount(value.checkoutFees),basket=moneyAmount(value.basketSubtotal);if((fees!=null||basket!=null)&&(fees==null||basket==null||basket<=0||basket>1000))throw Error('Record both the checkout fees and the matching basket subtotal.');return {balance,stacking,...(value.receiptCount!=null?{receiptCount:value.receiptCount}:{}),source:'manually_verified_in_uber',note:String(value.note||'').slice(0,500),...(fees!=null?{checkoutFees:fees,basketSubtotal:basket}:{})};
}

export function receiptFinancials(receipt={},correction=receipt.financialCorrection||null) {
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
  const outOfPocket=explicitPayment??(paid!=null&&cash!=null&&paid>=cash?rounded(paid-cash):null);
  const needsAdjustmentReview=Boolean(receipt.financialReview?.reasons?.length&&receipt.financialReview?.revision);
  const result={total:stated?total:null,categories,source:stated?'email_reported':'incomplete',incomplete:!stated,needsAdjustmentReview,conflict,cashUsed:cash??0,outOfPocket};
  if(!correction)return result;
  const manual=validateFinancialCorrection(correction);
  return {...result,total:manual.total,categories:Object.keys(manual.breakdown).length?{...Object.fromEntries(financialCategories.map(k=>[k,0])),...manual.breakdown}:{...Object.fromEntries(financialCategories.map(k=>[k,0])),other:manual.total},source:manual.source,outOfPocket:manual.outOfPocket??result.outOfPocket,incomplete:false,needsAdjustmentReview:needsAdjustmentReview&&(manual.reviewedReceiptRevision!==receipt.financialReview.revision||manual.outOfPocket==null),conflict:stated&&Math.abs(total-manual.total)>.011,emailTotal:result.total,manualUpdatedAt:correction.at||null};
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
