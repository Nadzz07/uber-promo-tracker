// Public dashboard calculations use derived receipt totals and actual sync times.
import { expiryEndTime, ukDateKey } from './offer-time.js';
import {receiptFinancials,moneyAmount} from './receipt-financials.js';

// Numeric projections only: no receipt IDs, identities, source text or events.
// The same mapping feeds the device ledger view and sanitized activity totals.
export const RECEIPT_AMOUNT_KEYS=['paid','subtotal','fees','promos','cash','outOfPocket','saved'];
const rounded=n=>Math.round((n+Number.EPSILON)*100)/100;
const observed=v=>{try{return moneyAmount(v);}catch{return null;}};
export function unknownReceiptAmounts(total=0){return Object.fromEntries(RECEIPT_AMOUNT_KEYS.map(key=>[key,{value:total?null:0,known:0,total,...(key==='fees'?{complete:0}:{})}]));}
export function receiptAmountSummary(receipts=[],corrections={}){
 const result=unknownReceiptAmounts(receipts.length);
 for(const r of receipts){
  const correction=corrections[r.receiptId||r.id]??r.financialCorrection,f=receiptFinancials(r,correction);
  const feeParts=[r.deliveryFee,r.serviceFee,r.smallOrderFee].map(observed),knownFees=feeParts.filter(v=>v!=null);
  const promoKey=r.service==='Uber'?'ridePromotions':'eatsPromotions';
  const values={paid:observed(r.total),subtotal:observed(r.subtotal),fees:knownFees.length?rounded(knownFees.reduce((n,v)=>n+v,0)):null,
   promos:correction?observed(correction.breakdown?.[promoKey]):observed(r.promotionDiscount),cash:observed(r.uberCashUsed),outOfPocket:f.outOfPocket,saved:f.total};
  for(const key of RECEIPT_AMOUNT_KEYS)if(values[key]!=null){result[key].value=rounded((result[key].value??0)+values[key]);result[key].known++;}
  if(knownFees.length===feeParts.length)result.fees.complete++;
 }
 return result;
}
export function mergeReceiptAmounts(summaries=[]){
 const result=unknownReceiptAmounts();
 for(const summary of summaries)for(const key of RECEIPT_AMOUNT_KEYS){const part=summary[key],target=result[key];target.total+=part.total;target.known+=part.known;target.value=rounded((target.value??0)+(part.value??0));if(key==='fees')target.complete+=part.complete||0;}
 for(const key of RECEIPT_AMOUNT_KEYS)if(result[key].total&&!result[key].known)result[key].value=null;
 return result;
}
export function syncState(sync = {}, { now = Date.now(), error = false } = {}) {
  const checked = Date.parse(sync.lastSuccessfulMailScanAt || '');
  const started = Date.parse(sync.startedAt || '');
  if (error || sync.state === 'failed') return { label: 'Attention', className: 'stale' };
  if (sync.state === 'syncing' && Number.isFinite(started) && now >= started && now - started < 30 * 60000) return { label: 'Syncing', className: 'syncing' };
  if (!Number.isFinite(checked) || checked > now + 5 * 60000) return { label: 'Snapshot', className: 'setup' };
  return now - checked <= 2 * 3600000
    ? { label: 'Up to date', className: 'live' }
    : { label: 'Update due', className: 'stale' };
}

export function offerCountdown(promo, now = Date.now()) {
  const end = expiryEndTime(promo);
  if (end == null) return 'Expiry needs checking';
  const remaining = end - now;
  if (remaining <= 0) return 'Expired';
  const days = Math.ceil(remaining / 86400000);
  const hours = Math.ceil(remaining / 3600000);
  const time = days > 1 ? days + ' days left' : hours > 1 ? hours + ' hours left' : 'Under 1 hour left';
  return (promo.expiryStatus === 'estimated' ? '~' : '') + time;
}

export function receiptActivity(receipts = [], rides = [], saving, {includeAmounts=false}={}) {
  const days = new Map(), months = new Map();
  for (const [items, kind] of [[receipts, 'eats'], [rides, 'rides']]) for (const receipt of items) {
    // Do not load the private receipt parser on the public dashboard's cold
    // path. This projection uses the already verified purchase date only.
    const day = receipt.orderDate || ukDateKey(receipt.sentAt || receipt.receivedAt);
    if (!day) continue;
    const month = day.slice(0,7);
    for (const [map, key] of [[days, day], [months, month]]) {
      const row = map.get(key) || { period: key, eats: 0, rides: 0, saved: 0 };
      row[kind]++;
      if (!receipt.orderDate) row.dateFallbacks = (row.dateFallbacks || 0) + 1;
      row.saved = Math.round((row.saved + saving(receipt)) * 100) / 100;
      if(includeAmounts){row.amounts||={eats:unknownReceiptAmounts(),rides:unknownReceiptAmounts()};row.amounts[kind]=mergeReceiptAmounts([row.amounts[kind],receiptAmountSummary([receipt])]);}
      map.set(key, row);
    }
  }
  return {
    ...(includeAmounts?{amountVersion:1}:{}),
    days: [...days.values()].sort((a,b)=>b.period.localeCompare(a.period)),
    months: [...months.values()].sort((a,b)=>a.period.localeCompare(b.period))
  };
}
