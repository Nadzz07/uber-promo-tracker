import {accountUsage} from './account-state.js';
import {promotionActivity,manualActivity,promoStateKey} from './manual-state.js';

export const ACTIVITY_STATUSES=[
 ['used','Fully used accounts','accounts'],['needs_checking','Needs checking','accounts'],
 ['partial','Partially used promotions','promotions'],['completed','Completed promotions','promotions'],
 ['finished_expired','Finished · Expired','promotions'],['expired_unused','Expired · Unused','promotions'],
 ['manual','Manually finished','promotions'],['ignored','Ignored offers','promotions']
].map(([key,label,entity])=>({key,label,entity}));
const latest=values=>values.filter(v=>v&&Number.isFinite(Date.parse(v))).sort((a,b)=>Date.parse(b)-Date.parse(a))[0]||null;
export function receiptUsageEvidence(account){
 const eats=Math.max(0,Number(account.orderCount)||0),rides=Math.max(0,Number(account.rideCount)||0);
 return rides>0&&eats>0?eats+' Eats + '+rides+' Ride':eats>0?eats+' Eats '+(eats===1?'order':'orders'):rides+' Ride '+(rides===1?'receipt':'receipts');
}
function uncertainty(promo,activity){
 if(activity.verificationConflict)return activity.verificationConflict;
 const labels={ambiguous_receipt_match:'Receipt could match more than one promotion',unverified_use_count:'Order allowance needs verification',unconfirmed_discount_scope:'Order or product scope needs checking',missing_offer_source:'Original offer evidence needs verification',missing_discount_terms:'Discount terms need checking',unknown_expiry:'Expiry is unknown',cash_balance_or_expiry_uncertain:'Cash remaining or expiry needs checking'};
 return (promo.reviewReasons||[]).map(r=>labels[r]).filter(Boolean).join(' · ')||'Offer evidence needs checking';
}
export function buildUsedActivity(accounts=[],promos=[],store={},reviewCount=()=>0){
 const offerText=new Map();
 for(const p of promos){const label=p.discountType==='uberCash'?'Uber Cash':p.discountType==='percent'?p.discount+'% off':'£'+p.discount+' off £'+p.minimumSpend;offerText.set(p.accountRef,[offerText.get(p.accountRef),p.title,p.code,label].filter(Boolean).join(' '));}
 const buckets=Object.fromEntries(ACTIVITY_STATUSES.map(s=>[s.key,[]])),byRef=new Map(accounts.map(a=>[a.accountRef,a])),review=new Map();
 const addReview=(account,text,at)=>{if(!account)return;if(!review.has(account.accountRef))review.set(account.accountRef,{key:'review:'+account.accountRef,account,entity:'account',evidence:[],at:null});const r=review.get(account.accountRef);r.evidence.push(text);r.at=latest([r.at,at]);};
 for(const account of accounts){
  if(accountUsage(account).accountUsed)buckets.used.push({key:'used:'+account.accountRef,account,entity:'account',evidence:receiptUsageEvidence(account),receiptRuleMet:true,at:latest([account.lastOrderAt,account.lastRideAt])});
  if(Number(account.sourceReviewCount)>0)addReview(account,account.sourceReviewCount+' receipt sources need original verification',null);
  const financial=reviewCount(account);if(financial>0)addReview(account,financial+' refunded or adjusted '+(financial===1?'receipt needs':'receipts need')+' final amounts checked',latest([account.lastOrderAt,account.lastRideAt]));
 }
 for(const promo of promos){
  const account=byRef.get(promo.accountRef);if(!account)continue;
  const activity=promotionActivity(store,promo),manual=manualActivity(store,promo);
  if(activity.bucket==='needs_checking'){addReview(account,uncertainty(promo,activity),latest([promo.lastUsedAt,promo.emailSentAt,manual.lastEvidenceUpdate]));continue;}
  if(!buckets[activity.bucket])continue;
  let evidence=activity.confirmedUses+'/'+activity.totalUses+' verified uses';
  if(activity.bucket==='finished_expired')evidence+=' · expired';
  if(activity.bucket==='expired_unused')evidence='Expired · no verified redemptions';
  if(activity.bucket==='manual')evidence=store.offers?.[promoStateKey(promo)]?.manualReason||store.offers?.[promoStateKey(promo)]?.reason||'Manually finished · usage unverified';
  if(activity.bucket==='ignored')evidence='Ignored · excluded from recommendations';
  buckets[activity.bucket].push({key:activity.bucket+':'+(promo.id||promo.offerId),account,promo,entity:'promotion',evidence,
   at:activity.bucket==='manual'?manual.manualFinishedAt||null:activity.bucket==='ignored'?store.offers?.[promoStateKey(promo)]?.updatedAt||manual.history?.filter(e=>e.type==='ignored').at(-1)?.at||null:latest([promo.lastUsedAt,promo.emailSentAt]),
   expiry:activity.bucket.includes('expired')?promo.expiresAt||promo.expires||null:null});
 }
 buckets.needs_checking=[...review.values()].map(r=>({...r,evidence:[...new Set(r.evidence)].join(' · ')}));
 buckets.expired=[...buckets.finished_expired,...buckets.expired_unused];
 for(const rows of Object.values(buckets))for(const r of rows)r.searchText=[r.account.email,r.account.accountEmail,r.account.fullEmail,r.account.loginMethod,r.promo?[r.promo.title,r.promo.code,r.promo.discountType==='percent'?r.promo.discount+'% off':'£'+r.promo.discount+' off £'+r.promo.minimumSpend].join(' '):offerText.get(r.account.accountRef)].filter(Boolean).join(' ');
 return {buckets,summary:{used:buckets.used.length,needs_checking:buckets.needs_checking.length,expired:buckets.expired.length}};
}
export function activityResults(model,{status='used',query='',sort='latest'}={},identity=a=>a.accountMasked||a.accountRef){
 const needle=query.trim().toLowerCase();
 return (model.buckets[status]||[]).filter(r=>!needle||[identity(r.account),r.account.accountRef,r.account.loginMethod,r.promo?.title,r.evidence,r.searchText].filter(Boolean).join(' ').toLowerCase().includes(needle)).slice().sort((a,b)=>sort==='email'?identity(a.account).localeCompare(identity(b.account))||a.key.localeCompare(b.key):(Date.parse(b.at)||-Infinity)-(Date.parse(a.at)||-Infinity)||identity(a.account).localeCompare(identity(b.account))||a.key.localeCompare(b.key));
}
