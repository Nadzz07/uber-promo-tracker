import {dedupeReceipts} from './receipt-identity.js';
import {receiptWhen} from './receipt-date.js';
import {getOfferManualState,promotionActivity,promoStateKey} from './manual-state.js';
import {classifyOfferTrackingState,classifyOfferCompletion} from './offer-state.js';
import {accountMatchesLogin,accountMatchesProvider,matchesAccountFilter,accountOfferKey,offerReadinessRank,offerInProgress,offerEligible} from './account-state.js';
import {hasCurrentCash,matchesDiscoveryScope,isPreferredPromo} from './offer-preferences.js';
import {expiryEndTime,isOfferExpired} from './offer-time.js';

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

// Match-schema support alone does not establish zero redemption. Compact Uber
// emails can contain only a total and a link to the full receipt. A positive
// assignment/aggregate remains usable, but these bodies cannot establish zero.
function incompleteUsageReceipts(data,promo) {
 const start=Date.parse(promo.firstEmailSentAt||promo.emailSentAt||''),end=expiryEndTime(promo);
 return (data.receipts||[]).some(r=>{
  if(r.accountRef!==promo.accountRef||r.service&&r.service!=='Uber Eats')return false;
  const at=Date.parse(receiptWhen(r)||'');
  if(Number.isFinite(at)&&(Number.isFinite(start)&&at<start||end!=null&&at>=end))return false;
  if(!Number.isFinite(at)||!Number.isFinite(r.promotionDiscount)||r.promotionDiscount<0)return true;
  return r.promotionDiscount>0&&(!Number.isFinite(r.subtotal)||r.subtotal<=0);
 });
}

// A sheet presentation decision, not an offer status or a recommendation rule.
// An explicit per-account Restore survives without editing global preferences.
export function preferredAccountOffers(promos,preferences,store={}) {
 const current=[],other=[];
 for(const p of promos){
  if(p.promoInUse||isPreferredPromo(p,preferences)||getOfferManualState(store,p).competitionRestored)current.push(p);
  else other.push({...p,hiddenByPreference:true});
 }
 return {current,other};
}

// Missing detail and known aggregate usage are independent. Older supported
// exports retain receipts; lack of link metadata cannot be repaired by guessing.
export function offerReceiptAvailability(data,promo,storeStatus='ready'){
 const rows=offerMatchedReceipts(data,promo);
 if(rows.length)return {status:'available',message:'',rows};
 if(storeStatus==='loading')return {status:'loading',message:'Loading receipt details.'};
 if(storeStatus==='migration_required')return {status:'migration_required',message:'Receipt data needs one-time migration in Sync & data.'};
 if(storeStatus==='error')return {status:'error',message:'Receipt data could not load. Original data is preserved.'};
 if(!data?.accounts?.some(a=>a.accountRef===promo.accountRef))return {status:'not_imported',message:'Receipt details not imported.'};
 if(data.receiptMatchVersion!==1)return {status:'outdated',message:'Receipt matching unavailable in this export.'};
 if(promo.reviewReasons?.includes('ambiguous_receipt_match')||(data.offerReceiptMatches||[]).some(m=>m.accountRef===promo.accountRef&&m.status==='ambiguous'&&(!m.offerId||[promo.id,promo.offerId].includes(m.offerId))))return {status:'unresolved',message:'Receipt matching needs checking.'};
 const confirmed=promo.receiptConfirmedUses;
 if(confirmed!=null&&Number(confirmed)>0)return {status:'missing_details',message:'Matching receipt details are not in this import.'};
 if(incompleteUsageReceipts(data,promo))return {status:'incomplete',message:'Confirmed usage unknown'};
 return {status:'no_matches',message:'No matching receipts.'};
}

// A database default of zero is not evidence that matching was available.
// Positive published aggregates remain usable without exposing private rows.
export function offerUsageEvidence(data,promo,storeStatus='ready') {
 const evidence=offerReceiptAvailability(data,promo,storeStatus),rows=offerMatchedReceipts(data,promo);
 const raw=promo.receiptConfirmedUses,aggregate=raw!=null&&Number.isInteger(Number(raw))&&Number(raw)>=0?Number(raw):null;
 const unresolved=promo.reviewReasons?.includes('ambiguous_receipt_match')||(data?.offerReceiptMatches||[]).some(m=>m.accountRef===promo.accountRef&&m.status==='ambiguous'&&(!m.offerId||[promo.id,promo.offerId].includes(m.offerId)));
 if(promo.usageEvidenceUnavailable||promo.usageEvidenceConflict)return {confirmed:null,partial:false,evidence};
 const confirmed=rows.length||aggregate>0?Math.max(rows.length,aggregate||0):aggregate===0&&evidence.status==='no_matches'?0:null;
 return {confirmed,partial:Boolean(unresolved&&confirmed!=null),evidence};
}

// A single primary classification per record. Completed is receipt-verified;
// manual completion and exhausted credit must never inflate that category.
export function accountHistoryGroups(promos=[],grants=[],store={},now=new Date()){
 const definitions=[['completed','Completed'],['expired','Expired'],['ignored','Ignored'],['manual','Manually finished'],['exhausted','Exhausted credit'],['other','Other offers']];
 const groups=definitions.map(([key,label])=>({key,label,records:[]})),byKey=new Map(groups.map(g=>[g.key,g])),seen=new Set();
 for(const promo of promos){const key=promoStateKey(promo);if(seen.has(key))continue;seen.add(key);const activity=promotionActivity(store,promo,now);
  if(!promo.hiddenByPromoUse&&!promo.hiddenByPreference&&['available','partial','needs_checking'].includes(activity.bucket))continue;
  const group=activity.bucket==='completed'?'completed':activity.bucket==='ignored'?'ignored':activity.bucket.includes('expired')?'expired':activity.bucket==='manual'?'manual':'other';
  byKey.get(group).records.push({kind:'promo',key,promo,activity});
 }
 for(const grant of grants){const states=(grant.offers||[]).map(p=>getOfferManualState(store,p)),group=states.some(s=>s.ignored)?'ignored':states.some(s=>s.forceDone)?'manual':grant.status==='expired'?'expired':grant.status==='exhausted'?'exhausted':null;if(!group)continue;const key='credit:'+JSON.stringify([grant.issuedAt,grant.issued,grant.expiresAt]);if(seen.has(key))continue;seen.add(key);byKey.get(group).records.push({kind:'cash',key,grant});}
 return groups;
}

// Filter the complete account projection before pagination. All offer predicates
// are evaluated on one candidate collection, never unrelated headline offers.
export function directoryAccounts(accounts,filters,preferences,{emailFor=a=>a.accountMasked||'',valueFor=()=>null,now=Date.now()}={}) {
 const query=String(filters.search||'').trim().toLocaleLowerCase('en-GB'),management=filters.management||'all',availability=filters.availability||'any';
 const selections=Array.isArray(filters.type)?filters.type:[filters.type||'all'];
 const historical=['finished','expired-unused','expired','review'].includes(management);
 const typeMatches=(p,type)=>type==='all'||type==='cash'&&p.discountType==='uberCash'||type==='preferred'&&isPreferredPromo(p,preferences)||accountOfferKey(p)===type;
 const results=[];
 for(const account of new Map(accounts.map(a=>[a.accountRef,a])).values()) {
  if(!accountMatchesLogin(account,filters.login)||!accountMatchesProvider(account,filters.provider))continue;
  if(query&&![emailFor(account),account.accountMasked,account.accountRef,account.loginMethod,...(account.loginMethods||[])].some(v=>String(v||'').toLocaleLowerCase('en-GB').includes(query)))continue;
  const cash=hasCurrentCash(account),revealed=!historical&&(query||selections.some(t=>/^(fixed|percent):/.test(t)))?(account.allOffers||[]).filter(p=>p.hiddenByPromoUse&&offerEligible({...p,hiddenByPromoUse:false},now)):[],source=historical?(account.allOffers||account.promos||[]):[...(account.promos||[]),...revealed];
  let candidates=source.filter(p=>p.discountType!=='uberCash'||historical&&management!=='finished');
  if(management==='finished')candidates=candidates.filter(p=>classifyOfferCompletion(p,now).fullyUsed);
  if(management==='expired-unused')candidates=candidates.filter(p=>classifyOfferCompletion(p,now).expiredUnused);
  if(management==='expired')candidates=candidates.filter(p=>isOfferExpired(p,now));
  const accountReview=Number(account.sourceReviewCount||0)>0||Number(account.receiptReviewCount||0)>0;
  if(management==='review'&&!accountReview)candidates=candidates.filter(p=>p.trackingState==='needs_checking'||p.needsReview);
  if(management==='unfinished')candidates=candidates.filter(p=>offerInProgress(p,now));
  if(management==='expiring')candidates=candidates.filter(p=>{const end=expiryEndTime(p);return end!=null&&end>now&&end-now<=7*86400000;});
  candidates=candidates.filter(p=>selections.some(type=>type==='cash-promo'?offerEligible(p,now)&&matchesDiscoveryScope({...account,promos:[p]},'cash-promo',preferences):typeMatches(p,type)));
  const qualifyingCash=cash&&(!historical||management==='review'&&accountReview)&&selections.some(t=>['all','cash','cash-promo'].includes(t)||t==='preferred'&&preferences.includeCash);
  const scoped={...account,promos:candidates,hasEligibleOffers:candidates.some(p=>offerEligible(p,now))||qualifyingCash};
  scoped.recommendationEligible=scoped.hasEligibleOffers&&account.canLogin===true&&account.accessStatus!=='pending'&&!account.archived;
  const cashOnlyMatch=selections.some(type=>type==='cash'&&cash||type==='preferred'&&preferences.includeCash&&cash);
  if(!selections.includes('all')&&!candidates.length&&!cashOnlyMatch)continue;
  if(selections.includes('cash')&&selections.length===1&&!cash&&!historical)continue;
  if(selections.includes('cash-promo')&&selections.length===1&&!matchesDiscoveryScope(scoped,'cash-promo',preferences))continue;
  if(['finished','expired-unused','expired','unfinished','expiring'].includes(management)&&!candidates.length)continue;
  if(management==='review'&&!candidates.length&&!accountReview)continue;
  if(management==='offers'&&!candidates.length&&!cash)continue;
  if(!['tracked','finished','expired-unused','expired','review','offers','unfinished','expiring'].includes(management)&&!matchesAccountFilter({...account,hasEligibleOffers:scoped.hasEligibleOffers||candidates.some(p=>p.hiddenByPromoUse)},management))continue;
  if(availability!=='any'&&(!scoped.hasEligibleOffers||availability==='ready'&&!scoped.recommendationEligible||availability==='archived'&&!account.archived||availability==='attention'&&scoped.recommendationEligible))continue;
  const values=candidates.map(valueFor).filter(v=>v!=null&&Number.isFinite(v));
  candidates.sort((a,b)=>Number(Boolean(a.hiddenByPromoUse))-Number(Boolean(b.hiddenByPromoUse))||(valueFor(b)??-Infinity)-(valueFor(a)??-Infinity)||String(a.id||a.offerId).localeCompare(String(b.id||b.offerId)));
  results.push({...account,directoryOffers:candidates,directoryValue:values.length?Math.max(...values):null});
 }
 const identity=(a,b)=>String(emailFor(a)).localeCompare(String(emailFor(b)),'en-GB',{sensitivity:'base'})||String(a.accountRef).localeCompare(String(b.accountRef));
 return results.sort((a,b)=>{
  if(filters.sort==='email')return identity(a,b);
  const readiness=(filters.type!=='all'||availability!=='any'||['offers','unfinished','expiring'].includes(management))?offerReadinessRank(a)-offerReadinessRank(b):0;
  if(readiness)return readiness;
  if(a.directoryValue==null||b.directoryValue==null)return Number(a.directoryValue==null)-Number(b.directoryValue==null)||identity(a,b);
  return b.directoryValue-a.directoryValue||identity(a,b);
 });
}
