import assert from 'node:assert/strict';
import {classifyAccount, eligibleAccountCounts, matchesOfferScope, offerReadinessRank, offerEligible} from './account-state.js';
import {applyOfferExpiryPolicy} from './offer-time.js';
import {normaliseManualStore,setOfferDone,setOfferIgnored,promoForDecision,effectivePromoState} from './manual-state.js';
const now='2026-10-10T18:00:00Z';
const offer={id:'current',service:'Uber Eats',discountType:'fixed',discount:12,minimumSpend:15,uses:5,usesVerified:true,usesRemaining:5,receiptConfirmedUses:0,trackingState:'available',firstEmailSentAt:'2026-10-08T12:00:00Z',emailSentAt:'2026-10-09T12:00:00Z',expiresAt:'2026-11-01T12:00:00Z',expiryStatus:'exact'};
const records=[
 {accountRef:'ready',canLogin:true,accountStatus:'active',orderCount:1,rideCount:1},
 {accountRef:'archived',canLogin:true,accountStatus:'archived'},
 {accountRef:'pending',canLogin:null,accessStatus:'pending',accountStatus:'active'},
 {accountRef:'locked',canLogin:false,accountStatus:'active'},
 {accountRef:'closed',canLogin:true,accountStatus:'active'}
];
const projected=records.map((a,i)=>({...a,...classifyAccount(a,i===4?[{...offer,usesRemaining:0,receiptConfirmedUses:5}]:[offer,{...offer,id:'another'}],now)}));
assert.equal(projected[0].accountUsed,true,'Receipt-used account can have a current offer');
assert.deepEqual(eligibleAccountCounts(projected),{available:4,ready:1,attention:3},'Multiple offers count each account once');
for(const [scope,refs] of [['ready',['ready']],['all',['ready','archived','pending','locked']],['archived',['archived']],['attention',['archived','pending','locked']]])assert.deepEqual(projected.filter(a=>matchesOfferScope(a,scope)).map(a=>a.accountRef),refs);
assert.deepEqual([...projected.slice(0,4)].reverse().sort((a,b)=>offerReadinessRank(a)-offerReadinessRank(b)).map(a=>a.accountRef),['ready','archived','pending','locked']);
for(const a of records)assert.equal(a.hasEligibleOffers,undefined,'Account inputs must not be mutated');
for(const p of [{...offer,usesRemaining:0},{...offer,receiptConfirmedUses:5},{...offer,receiptState:'used'},{...offer,trackingState:'needs_checking'},{...offer,offerScope:'product'},{...offer,offerScope:'uncertain'},{...offer,ignored:true},{...offer,forceDone:true}])assert.equal(offerEligible(p,now),false);
const old={...offer,expiresAt:null,expires:null,expiryStatus:'unknown',firstEmailSentAt:'2026-09-01T12:00:00Z',emailSentAt:'2026-10-09T12:00:00Z'};
assert.equal(applyOfferExpiryPolicy(old).expiresAt,'2026-10-06T12:00:00.000Z');
assert.equal(classifyAccount(records[0],[old],now).hasEligibleOffers,false,'Persisted available state and recent reminder cannot override expiry');
for(const action of [setOfferDone,setOfferIgnored]){
 const store=action(normaliseManualStore({}),offer,true,now),effective={...promoForDecision(store,offer),trackingState:effectivePromoState(store,offer)==='active'?'available':effectivePromoState(store,offer)};
 assert.equal(classifyAccount(records[0],[effective],now).hasEligibleOffers,false,'Manual finish and ignore suppress eligibility');
}
assert.equal(classifyAccount(records[0],[old,offer],now).hasEligibleOffers,true,'Another eligible offer survives expiry');
console.log('✓ Offer eligibility separate from access, archive and receipt usage; deduped account counters, ready-first scopes, expired/reminder/manual/ignored/completed exclusions');
