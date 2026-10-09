import assert from 'node:assert/strict';
import {accountArchived,accountUsage,classifyAccount,matchesAccountFilter,accountUnfinished} from './account-state.js';
import {applyOfferExpiryPolicy} from './offer-time.js';
import {classifyOfferTrackingState,offerFinishedReason,offerClosureLabel,classifyOfferCompletion} from './offer-state.js';
import {openPrivateDb,setAccountAccess,getPublicAccountInsights} from './private-db.js';
const now='2026-10-09T12:00:00Z',offer={discountType:'fixed',discount:12,uses:5,usesRemaining:5,service:'Uber Eats',emailSentAt:'2026-09-01T12:00:00Z',firstEmailSentAt:'2026-09-01T12:00:00Z',expiresAt:'2026-11-01T12:00:00Z',expiryStatus:'exact'};
for(const confirmed of [0,1,5]){
 const value={...offer,usesRemaining:5-confirmed,receiptConfirmedUses:confirmed,receiptState:confirmed===5?'used':'partial'};
 const state=classifyOfferTrackingState(value,{now});
 assert.equal(offerFinishedReason(value,now),confirmed===5?'Fully consumed':'Expired');
 assert.equal(state.trackingState,confirmed===5?'used':'expired');
 assert.equal(offerClosureLabel(value,now),confirmed===5?'Finished · Fully consumed':confirmed?'Finished · Expired':'Expired · Unused');
 assert.equal(value.usesRemaining,5-confirmed,'Expiry preserves unredeemed orders');
 const reminder={...value,emailSentAt:'2026-10-08T12:00:00Z'};
 assert.equal(applyOfferExpiryPolicy(reminder).expiresAt,'2026-10-06T12:00:00.000Z','Reminder cannot restart first qualifying offer clock');
 assert.equal(classifyAccount({canLogin:true,accountStatus:'active'},[{...value,...state}]).recommendationEligible,false);
}

const scenarios=[
 {confirmed:0,expired:false,label:'Available',fullyUsed:false},
 {confirmed:1,expired:false,label:'Partially used',fullyUsed:false},
 {confirmed:0,expired:true,label:'Expired · Unused',fullyUsed:false},
 {confirmed:1,expired:true,label:'Finished · Expired',fullyUsed:true},
 {confirmed:2,expired:true,label:'Finished · Expired',fullyUsed:true},
 {confirmed:4,expired:true,label:'Finished · Expired',fullyUsed:true},
 {confirmed:5,expired:false,label:'Finished · Fully consumed',fullyUsed:true}
];
for(const row of scenarios){
 const promo={...offer,firstEmailSentAt:row.expired?'2026-09-01T12:00:00Z':'2026-10-08T12:00:00Z',emailSentAt:'2026-10-08T12:00:00Z',receiptConfirmedUses:row.confirmed,usesRemaining:5-row.confirmed,receiptState:row.confirmed===5?'used':row.confirmed?'partial':null};
 const before=JSON.stringify(promo),completion=classifyOfferCompletion(promo,now);
 assert.equal(completion.displayStatus,row.label);assert.equal(completion.fullyUsed,row.fullyUsed);
 assert.equal(completion.confirmedUses,row.confirmed);assert.equal(JSON.stringify(promo),before);
 const tracked={...promo,...classifyOfferTrackingState(promo,{now})};
 const account=classifyAccount({canLogin:true,accountStatus:'active',orderCount:0,rideCount:0},[tracked],now);
 assert.equal(account.fullyUsedOfferCount,Number(row.fullyUsed));assert.equal(account.accountUsed,false);
}
console.log('✓ Every final classification table row: confirmed usage, partially used, expired unused, expired used and fully consumed; immutable order counts');

// Legacy/manual counters cannot override confirmed usage, including in history labels.
for (const confirmed of [0,1,2,4]) {
 const legacy={...offer,usesRemaining:0,receiptState:'used',receiptConfirmedUses:confirmed};
 assert.equal(offerClosureLabel(legacy,now),confirmed?'Finished · Expired':'Expired · Unused');
 assert.equal(classifyOfferCompletion(legacy,now).consumed,false);
 assert.equal(classifyOfferCompletion(legacy,now).fullyUsed,confirmed>0);
}
assert.equal(offerFinishedReason({...activeOffer(),usesRemaining:0,receiptState:'used',receiptConfirmedUses:1},now),null);
function activeOffer(){return {...offer,firstEmailSentAt:'2026-10-08T12:00:00Z',emailSentAt:'2026-10-08T12:00:00Z'};}

const expired={...offer,...classifyOfferTrackingState(offer,{now})};
assert.equal(classifyAccount({canLogin:true,accountStatus:'active',orderCount:0,rideCount:0},[expired]).accountUsed,false);
const active={...offer,emailSentAt:'2026-10-08T12:00:00Z',firstEmailSentAt:'2026-10-08T12:00:00Z',trackingState:'available'};
assert.equal(classifyAccount({canLogin:true,accountStatus:'active'},[expired,active]).recommendationEligible,true,'Another eligible current offer survives unrelated expiry');
for(const canLogin of [true,false])for(const archived of [true,false])for(const used of [true,false]){
 const account={canLogin,accountStatus:archived?'archived':'active',orderCount:used?1:0,rideCount:used?1:0};
 const state={...account,...classifyAccount(account,[active])};
 assert.equal(state.archived,archived);assert.equal(state.accountUsed,used);
 assert.equal(state.recommendationEligible,canLogin&&!archived&&!used);
 for(const [filter,expected] of [['all',true],['login',canLogin],['locked',!canLogin],['used',used],['used-login',used&&canLogin],['used-locked',used&&!canLogin],['archived-login',archived&&canLogin],['archived-locked',archived&&!canLogin]])assert.equal(matchesAccountFilter(state,filter),expected,filter);
 assert.equal(account.canLogin,canLogin);assert.equal(account.accountStatus,archived?'archived':'active');
}
assert.equal(accountArchived({canLogin:false,accountStatus:'active'}),false);
assert.equal(accountArchived({canLogin:true,accountStatus:'archived'}),true);
assert.equal(accountUnfinished({canLogin:true,accountStatus:'archived',promos:[{...active,usesRemaining:4}]}),false);
for(const [eats,rides,used] of [[0,4,false],[1,1,true],[4,0,false],[5,0,true]])assert.equal(accountUsage({orderCount:eats,rideCount:rides}).accountUsed,used);
const db=openPrivateDb(':memory:');try{
 setAccountAccess(db,'archived@example.invalid',true,'Google','archived');
 setAccountAccess(db,'inaccessible@example.invalid',false,'iCloud','active');
 const accounts=getPublicAccountInsights(db);
 assert.equal(accounts.find(a=>a.loginMethod==='Google').accountStatus,'archived');
 assert.equal(accounts.find(a=>a.loginMethod==='iCloud').accountStatus,'active');
 assert.equal(accounts.find(a=>a.loginMethod==='Google').canLogin,true);
}finally{db.close();}
console.log('✓ All independent login/usage/archive combinations, original receipt-use rule, expired unfinished offers and reminder clocks');
