import {dedupeReceipts} from './receipt-identity.js';
import {receiptWhen} from './receipt-date.js';
import {promotionActivity,promoStateKey} from './manual-state.js';
import {classifyOfferTrackingState} from './offer-state.js';

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
// The device-local transfer may be newer than the public snapshot. Derive a view,
// without rewriting either source or counting an expanded list a second time.
export function offerWithPrivateReceiptUses(promo,data) {
  if(promo.discountType==='uberCash'||data?.receiptMatchVersion!==1||!data.offerReceiptMatches?.some(m=>m.status==='confirmed'&&m.accountRef===promo.accountRef&&[promo.id,promo.offerId].includes(m.offerId)))return promo;
  const matched=offerMatchedReceipts(data,promo).length;
  const published=promo.receiptConfirmedUses==null?null:Number(promo.receiptConfirmedUses);
  if(!matched||published!=null&&matched<=published)return promo;
  const total=Number(promo.uses),known=Number.isInteger(total)&&total>0&&promo.usesVerified===true;
  const view={...promo,receiptConfirmedUses:matched,
    usesRemaining:known?Math.max(0,total-matched):promo.usesRemaining,
    receiptState:known&&matched>=total?'used':'partial'};
  if(known&&matched>total)return {...view,receiptState:null,trackingState:'needs_checking',usageEvidenceConflict:true};
  return {...view,...classifyOfferTrackingState(view,{reviewReasons:view.reviewReasons||[]})};
}
export function plannerAccountChoices(context,offers,accounts,wallets) {
  if(!context)return {offers,accounts,wallets};
  return {offers:context.promoKey?offers.filter(p=>p.accountRef===context.accountRef&&(p.id===context.promoKey||p.offerId===context.promoKey)):[],accounts:accounts.filter(a=>a.accountRef===context.accountRef),wallets:context.includeCash&&wallets[context.accountRef]?{[context.accountRef]:wallets[context.accountRef]}:{}};
}

// Missing detail and known aggregate usage are independent. Older supported
// exports retain receipts; lack of link metadata cannot be repaired by guessing.
export function offerReceiptAvailability(data,promo,storeStatus='ready'){
 const rows=offerMatchedReceipts(data,promo);
 if(rows.length)return {status:'available',message:'',rows};
 if(storeStatus==='loading')return {status:'loading',message:'Loading receipt details.'};
 if(storeStatus==='migration_required')return {status:'migration_required',message:'Receipt data needs one-time migration in Sync & data.'};
 if(storeStatus==='error')return {status:'error',message:'Receipt data could not load. Original data is preserved.'};
 if(!data?.receipts?.length)return {status:'not_imported',message:'Receipt details not imported.'};
 if(data.receiptMatchVersion!==1)return {status:'outdated',message:'Receipt matching unavailable in this export.'};
 if(promo.reviewReasons?.includes('ambiguous_receipt_match')||(data.offerReceiptMatches||[]).some(m=>m.accountRef===promo.accountRef&&m.status==='ambiguous'&&(!m.offerId||[promo.id,promo.offerId].includes(m.offerId))))return {status:'unresolved',message:'Receipt matching needs checking.'};
 const confirmed=promo.receiptConfirmedUses;
 if(confirmed!=null&&Number(confirmed)>0)return {status:'missing_details',message:'Matching receipt details are not in this import.'};
 return {status:'no_matches',message:'No matching receipts.'};
}

// A single primary classification per record. Completed is receipt-verified;
// manual completion and exhausted credit must never inflate that category.
export function accountHistoryGroups(promos=[],grants=[],store={},now=new Date()){
 const definitions=[['completed','Completed'],['expired','Expired'],['ignored','Ignored'],['manual','Manually finished'],['exhausted','Exhausted credit'],['other','Other history']];
 const groups=definitions.map(([key,label])=>({key,label,records:[]})),byKey=new Map(groups.map(g=>[g.key,g])),seen=new Set();
 for(const promo of promos){const key=promoStateKey(promo);if(seen.has(key))continue;seen.add(key);const activity=promotionActivity(store,promo,now);
  if(['available','partial','needs_checking'].includes(activity.bucket))continue;
  const group=activity.bucket==='completed'?'completed':activity.bucket==='ignored'?'ignored':activity.bucket.includes('expired')?'expired':activity.bucket==='manual'?'manual':'other';
  byKey.get(group).records.push({kind:'promo',key,promo,activity});
 }
 for(const grant of grants){if(!['expired','exhausted'].includes(grant.status))continue;const key='credit:'+JSON.stringify([grant.issuedAt,grant.issued,grant.expiresAt]);if(seen.has(key))continue;seen.add(key);byKey.get(grant.status==='expired'?'expired':'exhausted').records.push({kind:'cash',key,grant});}
 return groups;
}
