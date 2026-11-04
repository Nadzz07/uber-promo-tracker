import {classifyAccount,eligibleAccountCounts} from './account-state.js';
import {classifyOfferCompletion} from './offer-state.js';
// A replacement roster controls account selection. Historical receipt totals
// remain separate, so removing a login identity never erases recorded savings.
export function applyAccountRoster(payload,history,refs){
 if(!Array.isArray(refs)||!refs.length||new Set(refs).size!==refs.length)throw Error('Invalid replacement account roster.');
 const wanted=new Set(refs),all=payload.accounts;
 if(refs.some(ref=>!all.some(a=>a.accountRef===ref)))throw Error('Replacement roster contains an unknown account.');
 const historical=new Map((payload.historicalAccounts||[]).map(a=>[a.accountRef,a]));
 for(const a of all)if(!wanted.has(a.accountRef))historical.set(a.accountRef,Object.fromEntries(['accountRef','orderCount','rideCount','totalSaved','estimatedUberOneSavings','estimatedTotalSaved','receiptReviewCount'].map(k=>[k,a[k]??0])));
 for(const ref of refs)historical.delete(ref);
 payload.historicalAccounts=[...historical.values()];payload.accounts=all.filter(a=>wanted.has(a.accountRef));payload.promos=payload.promos.filter(p=>wanted.has(p.accountRef));
 payload.accounts=payload.accounts.map(a=>({...a,...classifyAccount(a,payload.promos.filter(p=>p.accountRef===a.accountRef),payload.generatedAt)}));
 const eligible=new Set(payload.accounts.filter(a=>a.recommendationEligible).map(a=>a.accountRef));for(const p of payload.promos)p.recommendationEligible=eligible.has(p.accountRef);
 const s=payload.summary,a=payload.accounts,e=eligibleAccountCounts(a);Object.assign(s,{knownAccounts:a.length,accessibleAccounts:a.filter(a=>a.canLogin===true).length,inaccessibleAccounts:a.filter(a=>a.canLogin===false).length,pendingAccessAccounts:a.filter(a=>a.canLogin==null).length,availableAccounts:e.available,readyToUseAccounts:e.ready,offerAttentionAccounts:e.attention,usedAccounts:a.filter(a=>a.accountUsed).length,fullyUsedAccounts:a.filter(a=>a.accountUsed).length,completedUsageAccounts:a.filter(a=>a.accountUsed).length,usedAccessibleAccounts:a.filter(a=>a.accountUsed&&a.canLogin).length,partialUsageAccounts:a.filter(a=>a.canLogin&&a.partialUsage).length,expiredAccounts:a.filter(a=>a.accountState==='expired').length,archivedAccounts:a.filter(a=>a.archived).length,deactivatedAccounts:a.filter(a=>a.deactivated).length,needsCheckingAccounts:a.filter(a=>a.accountState==='needs_checking').length,activePromoAccounts:new Set(payload.promos.filter(p=>p.trackingState==='available'&&eligible.has(p.accountRef)).map(p=>p.accountRef)).size,archivedConfirmedSaved:Math.round(a.filter(a=>a.archived).reduce((n,a)=>n+Number(a.totalSaved||0),0)*100)/100,deactivatedConfirmedSaved:Math.round(a.filter(a=>a.deactivated).reduce((n,a)=>n+Number(a.totalSaved||0),0)*100)/100,receiptSourcesNeedingReview:a.reduce((n,a)=>n+Number(a.sourceReviewCount||0),0)});
 const completions=payload.promos.map(p=>classifyOfferCompletion(p,payload.generatedAt));for(const [k,test]of [['fullyUsedOffers','fullyUsed'],['finishedExpiredOffers','finishedExpired'],['fullyConsumedOffers','consumed'],['expiredUnusedOffers','expiredUnused'],['partiallyUsedOffers','partiallyUsed']])s[k]=completions.filter(c=>c[test]).length;s.completedPromotions=completions.filter(c=>c.consumed).length;
 // Keep historical offers in history, never as selectable accounts/offers.
 for(const p of history.records)if(!wanted.has(p.accountRef))p.recommendationEligible=false;
 return payload;
}
