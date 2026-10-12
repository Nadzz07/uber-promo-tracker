import {offerTime, ukDateKey} from './offer-time.js';

const monthNames=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const datePattern=/\b(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(20\d{2})(?:\s*,?\s*([01]?\d|2[0-3]):([0-5]\d)(?:\s*(AM|PM))?)?/gi;

// Receipt headers identify the purchase, not the later email delivery or a
// payment footer. Keep date-only evidence date-only; never invent an order time.
export function receiptOrderDate(body='') {
  const text=String(body), header=text.slice(0, Math.min(text.length, 1800));
  const matches=[...header.matchAll(datePattern)];
  const candidates=matches.map(m=>{
    const month=monthNames.indexOf(m[2].slice(0,3).toLowerCase());
    const date=m[3]+'-'+String(month+1).padStart(2,'0')+'-'+m[1].padStart(2,'0');
    if (!Number.isFinite(Date.parse(date+'T12:00:00Z')) || new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date) return null;
    let at=null;
    if(m[4]!=null){let hour=Number(m[4]);if(m[6]){if(hour<1||hour>12)return null;hour=hour%12+(m[6].toLowerCase()==='pm'?12:0);}
      const instant=offerTime(date+'T'+String(hour).padStart(2,'0')+':'+m[5]+':00');
      if(hour===1 && month===9 && instant!=null){const later=instant+3600000;if(ukDateKey(later)===date && new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(later)==='01:'+m[5])return {date,at:null,ambiguous:true};}
      if(instant==null)return {date,at:null,ambiguous:true};at=new Date(instant).toISOString();}
    return {date,at,source:m[0]};
  }).filter(Boolean);
  if(!candidates.length)return {orderDate:null,orderAt:null,dateBasis:'email_fallback'};
  // A sparse header often repeats the same date before its timed version.
  const first=candidates[0], same=candidates.filter(c=>c.date===first.date);
  const timed=same.find(c=>c.at);
  return {orderDate:first.date,orderAt:timed?.at||null,dateBasis:first.ambiguous?'order_date_time_needs_checking':'receipt_order_date',dateEvidence:timed?.source||first.source};
}

export function receiptWhen(receipt={}) {return receipt.orderAt||receipt.orderDate||receipt.sentAt||receipt.receivedAt||null;}
export function receiptDay(receipt={}) {return receipt.orderDate||ukDateKey(receipt.sentAt||receipt.receivedAt);}
