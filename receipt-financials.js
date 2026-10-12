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
  return {total,breakdown,...(value.outOfPocket!=null?{outOfPocket:moneyAmount(value.outOfPocket)}:{}),source:'manually_reported_from_uber',note:String(value.note||'').slice(0,500)};
}

export function validateCashEntry(value={}) {
 const balance=moneyAmount(value.balance);if(balance==null)throw Error('Enter the current balance shown in Uber. An email Cash offer is not a balance.');const stacking=value.stacking||'unknown';if(!['unknown','supported','unsupported'].includes(stacking))throw Error('Invalid stacking evidence.');const fees=moneyAmount(value.checkoutFees),basket=moneyAmount(value.basketSubtotal);if((fees!=null||basket!=null)&&(fees==null||basket==null||basket<=0||basket>1000))throw Error('Record both the checkout fees and the matching basket subtotal.');return {balance,stacking,source:'manually_verified_in_uber',note:String(value.note||'').slice(0,500),...(fees!=null?{checkoutFees:fees,basketSubtotal:basket}:{})};
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
  const result={total:stated?total:null,categories,source:stated?'email_reported':'incomplete',incomplete:!stated,conflict,cashUsed:cash??0,outOfPocket};
  if(!correction)return result;
  const manual=validateFinancialCorrection(correction);
  return {...result,total:manual.total,categories:Object.keys(manual.breakdown).length?{...Object.fromEntries(financialCategories.map(k=>[k,0])),...manual.breakdown}:{...Object.fromEntries(financialCategories.map(k=>[k,0])),other:manual.total},source:manual.source,outOfPocket:manual.outOfPocket??result.outOfPocket,incomplete:false,conflict:stated&&Math.abs(total-manual.total)>.011,emailTotal:result.total,manualUpdatedAt:correction.at||null};
}

export function financialSummary(receipts=[],corrections={}) {
  const categories=Object.fromEntries(financialCategories.map(k=>[k,0]));
  let total=0,missing=0,conflicting=0,cashUsed=0,outOfPocket=0,paymentKnown=0,manual=0;
  const seen=new Set();
  for(const receipt of receipts){const id=receipt.receiptId||receipt.id;if(!id||seen.has(id))continue;seen.add(id);
    const f=receiptFinancials(receipt,corrections[id]);total+=f.total??0;missing+=f.incomplete?1:0;conflicting+=f.conflict?1:0;cashUsed+=f.cashUsed;
    if(f.outOfPocket!=null){outOfPocket+=f.outOfPocket;paymentKnown++;}if(f.source==='manually_reported_from_uber')manual++;
    for(const k of financialCategories)categories[k]+=f.categories[k];
  }
  for(const k of financialCategories)categories[k]=rounded(categories[k]);
  return {total:rounded(total),categories,missing,conflicting,cashUsed:rounded(cashUsed),outOfPocket:rounded(outOfPocket),paymentKnown,receipts:seen.size,manual};
}

// Events are append-only. Undo removes the correction, never the email evidence.
export function currentFinancialEvents(events=[]) {
  const corrections=Object.create(null),wallets=Object.create(null);
  // Stable sort preserves append order when two actions share a millisecond.
  const ordered=[...events].sort((a,b)=>String(a.at).localeCompare(String(b.at)));
  const seen=new Set();
  for(const event of ordered){if(seen.has(event.id))continue;seen.add(event.id);
    const target=event.kind==='receipt'?corrections:wallets;
    if(event.action==='undo')delete target[event.recordId];else target[event.recordId]={...event.value,at:event.at,eventId:event.id};
  }
  return {corrections,wallets};
}
