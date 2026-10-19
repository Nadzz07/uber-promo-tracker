import {dedupeReceipts} from './receipt-identity.js';
import {receiptWhen} from './receipt-date.js';

// Receipt identities and link evidence stay in the encrypted private transfer.
// Never infer an offer link from the discount amount or account alone.
export function validateOfferReceiptLinks(data) {
  if(data.receiptMatchVersion==null && data.offerReceiptMatches==null)return;
  if(data.receiptMatchVersion!==1 || !Array.isArray(data.offerReceiptMatches) || data.offerReceiptMatches.length>100000)throw Error('Unsupported private receipt links.');
  const receipts=new Map(data.receipts.map(r=>[r.receiptId,r]));
  for(const link of data.offerReceiptMatches){const receipt=receipts.get(link.receiptId);
    if(!receipt || receipt.accountRef!==link.accountRef || !['confirmed','ambiguous'].includes(link.status) || link.status==='confirmed'&&(!link.offerId||typeof link.offerId!=='string'||link.offerId.length>256) || link.observedSaving!=null&&(!Number.isFinite(link.observedSaving)||link.observedSaving<0))throw Error('Receipt links do not match the private evidence.');
  }
}
export function mergeOfferReceiptLinks(current,incoming) {
  const hasCurrent=current.receiptMatchVersion===1,hasIncoming=incoming.receiptMatchVersion===1;
  if(!hasCurrent&&!hasIncoming)return {};
  const oldAt=current.receiptMatchExportedAt||current.exportedAt,newAt=incoming.receiptMatchExportedAt||incoming.exportedAt;
  const replace=hasIncoming&&(!hasCurrent||(Date.parse(newAt)||0)>=(Date.parse(oldAt)||0));
  const incomingIds=new Set(incoming.receipts.map(r=>r.receiptId));
  const links=replace?[...(current.offerReceiptMatches||[]).filter(m=>!incomingIds.has(m.receiptId)),...incoming.offerReceiptMatches]:(current.offerReceiptMatches||[]);
  return {receiptMatchVersion:1,receiptMatchExportedAt:(replace?newAt:oldAt)||null,offerReceiptMatches:[...new Map(links.map(m=>[[m.receiptId,m.offerId,m.status].join('|'),m])).values()]};
}
export function offerMatchedReceipts(data,promo) {
  if(data?.receiptMatchVersion!==1)return [];
  const ids=new Set([promo.id,promo.offerId].filter(Boolean));
  const receipts=new Map((data.receipts||[]).filter(r=>r.accountRef===promo.accountRef).map(r=>[r.receiptId,r]));
  const rows=(data.offerReceiptMatches||[]).filter(m=>m.status==='confirmed'&&m.accountRef===promo.accountRef&&ids.has(m.offerId)&&receipts.has(m.receiptId)).map(m=>({...receipts.get(m.receiptId),match:m}));
  return dedupeReceipts(rows).sort((a,b)=>String(receiptWhen(b)||'').localeCompare(String(receiptWhen(a)||''))||a.receiptId.localeCompare(b.receiptId));
}
export function plannerAccountChoices(context,offers,accounts,wallets) {
  if(!context)return {offers,accounts,wallets};
  return {offers:context.promoKey?offers.filter(p=>p.accountRef===context.accountRef&&(p.id===context.promoKey||p.offerId===context.promoKey)):[],accounts:accounts.filter(a=>a.accountRef===context.accountRef),wallets:context.includeCash&&wallets[context.accountRef]?{[context.accountRef]:wallets[context.accountRef]}:{}};
}
