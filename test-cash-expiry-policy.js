import assert from 'node:assert/strict';
import {applyOfferExpiryPolicy} from './offer-time.js';
import {cashCreditHistory,currentCashPosition,reconcileCashGrants,publicCashEstimate} from './cash-ledger.js';
import {accountPromoUseProjection,consumeManualUse,normaliseManualStore} from './manual-state.js';
import {hasCurrentCash,matchesDiscoveryScope,normaliseOfferPreferences,plannerOffersForScope} from './offer-preferences.js';
import {cashForOrder} from './cash-planner.js';

const now='2026-10-23T12:00:00Z',issuedAt='2026-05-15T08:38:46.000Z',cutoff='2026-06-19T08:38:46.000Z';
const offer={id:'cash-may',accountRef:'A1',service:'Uber Eats',discountType:'uberCash',discount:12,firstEmailSentAt:issuedAt,emailSentAt:'2026-10-22T12:00:00Z',expiryStatus:'unknown',cashTerms:{duration:35,unit:'days',anchor:'activation'}};
const before=JSON.stringify(offer),applied=applyOfferExpiryPolicy(offer);
assert.equal(applied.expiresAt,cutoff);assert.equal(applied.expiryStatus,'estimated');assert.equal(applied.expiryBasis,'tracker_35_day_rule');assert.equal(applied.expiryConfidence,'policy');
assert.equal(applyOfferExpiryPolicy({...offer,emailSentAt:now}).expiresAt,cutoff,'Reminders cannot restart the cutoff');
assert.equal(applyOfferExpiryPolicy({...offer,firstEmailSentAt:null,emailSentAt:null}).expiresAt,null,'No original date stays unknown');
assert.equal(applyOfferExpiryPolicy({...offer,expiryStatus:'exact',expiresAt:'2026-12-01T00:00:00Z'}).expiresAt,'2026-12-01T00:00:00Z','Explicit expiry wins even when later than the cutoff');
assert.equal(applyOfferExpiryPolicy({...offer,cashTerms:{anchor:'original_email',duration:28,unit:'days'}}).expiresAt,'2026-06-12T08:38:46.000Z','A source duration anchored to the original email wins');
assert.equal(JSON.stringify(offer),before,'Source evidence remains unchanged');

const old={issued:12,issuedAt,status:'needs_checking',remaining:null,expiresAt:null,recordedUsed:4};
const account={accountRef:'A1',canLogin:true,orderCount:0,cashSummary:{grants:[old]}},original=JSON.stringify(account);
const position=currentCashPosition(account,[offer],null,[],{now});
assert.equal(position.status,'expired');assert.equal(position.remaining,0);assert.equal(hasCurrentCash({...account,cashPosition:position}),false);
assert.equal(cashForOrder(position,null,15,0,1,{now}).used,0);
const history=cashCreditHistory(account,[{...offer,cashEstimate:old},{...offer,id:'reminder',cashEstimate:old}],now);
assert.equal(history.length,1);assert.equal(history[0].status,'expired');assert.equal(history[0].expiresAt,cutoff);assert.equal(history[0].recordedUsed,4,'Expiry does not invent spending');
assert.equal(history[0].expiryBasis,'tracker_35_day_rule');assert.equal(JSON.stringify(account),original);
const dateOnly=cashCreditHistory(account,[{...offer,expiryStatus:'exact',expires:'2026-12-01',expiresAt:null}],now);
assert.equal(dateOnly[0].expiresAt,'2026-12-01T23:59:59.999Z','An explicit date-only source remains the end-of-day deadline');
const checked=currentCashPosition(account,[offer],{balance:9,at:'2026-10-22T12:00:00Z',receiptCount:0},[],{now,completeEvidence:true});
assert.equal(checked.status,'verified');assert.equal(checked.remaining,9,'A later verified balance takes priority');
const current={issued:6,issuedAt:'2026-10-20T12:00:00Z',status:'estimated',remaining:6,expiresAt:'2026-11-20T12:00:00Z'};
assert.equal(currentCashPosition({...account,cashSummary:{grants:[old,current]}},[offer],null,[],{now}).remaining,6,'Old credit cannot obscure current credit');
assert.equal(currentCashPosition({...account,cashSummary:{grants:[{...old,issuedAt:null}]}},[],null,[],{now}).status,'needs_checking');
const reconstructed=reconcileCashGrants([offer],[{accountRef:'A1',receiptId:'r1',service:'Uber Eats',orderAt:'2026-05-20T12:00:00Z',uberCashUsed:4}],{now});
assert.equal(reconstructed.grants[0].status,'expired');assert.equal(publicCashEstimate(reconstructed.grants[0]).recordedUsed,4);
const refined=reconcileCashGrants([offer,{...offer,id:'explicit-reminder',expiryStatus:'exact',expiryBasis:'explicit_date',expiresAt:'2026-12-01T00:00:00Z',cashTerms:{reminder:true}}],[],{now});
assert.equal(refined.grants.length,1);assert.equal(refined.grants[0].end,Date.parse('2026-12-01T00:00:00Z'),'Later reliable source expiry replaces a policy estimate without adding a grant');

const primary={id:'twelve',accountRef:'A1',service:'Uber Eats',discountType:'fixed',discount:12,minimumSpend:15,uses:5,usesVerified:true,usesRemaining:5,receiptConfirmedUses:0,canLogin:true,trackingState:'available',expiresAt:'2026-11-15T12:00:00Z',expiryStatus:'exact'};
const percent={...primary,id:'thirty',discountType:'percent',discount:30},cash={...primary,id:'cash-current',discountType:'uberCash',discount:6};
for(const manual of [false,true]){
 const source=[{...primary,receiptConfirmedUses:manual?0:1},percent,cash],store=manual?consumeManualUse(normaliseManualStore(),primary):{};
 const view=accountPromoUseProjection(store,source);assert.deepEqual(view.map(p=>p.hiddenByPromoUse),[false,true,false]);
 const preferences=normaliseOfferPreferences({preferredPromos:['percent:30:15'],includeCash:false});
 assert.equal(matchesDiscoveryScope({promos:view},'preferred',preferences),false);
 assert.deepEqual(plannerOffersForScope(view,[],'all',preferences).map(p=>p.id),['twelve','cash-current']);
}
console.log('✓ Cash first-email +35-day estimated cutoff, explicit terms, reminders, legacy history, spending, later verification and unknown dates; 30% suppression for manual and confirmed £12 use with Cash exempt.');
