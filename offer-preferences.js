import {accountOfferKey} from './account-state.js';

export const OFFER_PREFERENCES_KEY='uber-eats-promo-tracker:offer-preferences:v1';
export const DEFAULT_PREFERRED_PROMOS=['fixed:10:15','fixed:12:15','fixed:15:15'];
const scopes=new Set(['preferred','all','cash','cash-promo']);
export function validOfferSelection(value){return typeof value==='string'&&(scopes.has(value)||/^(fixed|percent):\d+(?:\.\d+)?:((?:\d+(?:\.\d+)?)|unknown)$/.test(value));}
export function normaliseOfferPreferences(input={}){
 const chosen=Array.isArray(input.preferredPromos)?[...new Set(input.preferredPromos.filter(v=>validOfferSelection(v)&&!scopes.has(v)))]:[...DEFAULT_PREFERRED_PROMOS];
 return {version:1,defaultView:input.defaultView==='all'?'all':'preferred',preferredPromos:chosen,includeCash:input.includeCash!==false,anyPromoWithCash:input.anyPromoWithCash!==false,
  selection:validOfferSelection(input.selection)?input.selection:null,plannerSelection:validOfferSelection(input.plannerSelection)?input.plannerSelection:null};
}
export function readOfferPreferences(storage){try{return normaliseOfferPreferences(JSON.parse(storage.getItem(OFFER_PREFERENCES_KEY)||'{}'));}catch{return normaliseOfferPreferences();}}
export function saveOfferPreferences(storage,value){const next=normaliseOfferPreferences(value);storage.setItem(OFFER_PREFERENCES_KEY,JSON.stringify(next));return next;}
export function selectedOfferScope(preferences,context='discovery'){return (context==='planner'?preferences.plannerSelection:null)||preferences.selection||preferences.defaultView;}
export function offerScopeLabel(key){
 if(key==='preferred')return 'All preferred offers';if(key==='all')return 'All offers';if(key==='cash')return 'Uber Cash';if(key==='cash-promo')return 'Uber Cash + promo';
 const [type,discount,minimum]=String(key).split(':');
 return type==='fixed'?'£'+discount+' off'+(minimum==='unknown'?' · minimum not shown':' £'+minimum):discount+'% off'+(minimum==='unknown'?' · minimum not shown':' £'+minimum);
}
export function mainOfferChoices(preferences={}){return [{key:'preferred',label:'All preferred offers'},...normaliseOfferPreferences(preferences).preferredPromos.map(key=>({key,label:offerScopeLabel(key)})),{key:'cash',label:'Uber Cash'},{key:'cash-promo',label:'Uber Cash + promo'},{key:'other',label:'Other offers…'}];}
export function hasCurrentCash(account){const cash=account.cashPosition||account.cashSummary;return cash?cash.remaining!=null&&Number(cash.remaining)>0&&['estimated','verified','verified_reconciled'].includes(cash.status):false;}
export function isPreferredPromo(promo,preferences){return !promo.hiddenByPromoUse&&promo.discountType!=='uberCash'&&promo.minimumSpendVerified!==false&&preferences.preferredPromos.includes(accountOfferKey(promo));}
function cashCanPair(account){const cash=account.cashPosition||account.cashSummary;return hasCurrentCash(account)&&cash.stacking!=='unsupported'&&(!cash.grants?.length||cash.grants.some(g=>g.remaining>0&&g.restrictions?.stacking!=='no_other_promotions'));}
export function matchesDiscoveryScope(account,selection,preferences){
 const offers=(account.promos||[]).filter(p=>!p.hiddenByPromoUse&&p.discountType!=='uberCash'),cash=hasCurrentCash(account);
 // Historical accounts remain reachable; readiness is an independent filter.
 if(selection==='all')return true;
 if(selection==='cash')return cash;
 if(selection==='cash-promo')return cashCanPair(account)&&offers.some(p=>p.restrictions?.stacking!=='no_other_promotions');
 if(selection==='preferred')return offers.some(p=>isPreferredPromo(p,preferences))||(preferences.includeCash&&cash);
 return offers.some(p=>accountOfferKey(p)===selection);
}
export function plannerOffersForScope(promos,accounts,selection,preferences){
 promos=promos.filter(p=>!p.hiddenByPromoUse);
 if(selection==='all')return promos;
 const byRef=new Map(accounts.map(a=>[a.accountRef,a]));
 return promos.filter(p=>{
  const cash=hasCurrentCash(byRef.get(p.accountRef)||{});
  if(selection==='cash')return p.discountType==='uberCash';
  if(selection==='cash-promo')return cash;
  if(selection==='preferred')return p.discountType==='uberCash'?preferences.includeCash:isPreferredPromo(p,preferences)||(preferences.includeCash&&preferences.anyPromoWithCash&&cashCanPair(byRef.get(p.accountRef)||{})&&p.restrictions?.stacking!=='no_other_promotions');
  return accountOfferKey(p)===selection;
 });
}
