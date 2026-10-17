import assert from 'node:assert/strict';
import {reconcileCashGrants,summariseCash,reconcileVerifiedCash,currentCashPosition} from './cash-ledger.js';
import {applyOfferExpiryPolicy} from './offer-time.js';
import {parseUberPromo} from './parser.js';
const now='2026-10-17T12:00:00Z';
const grant=(overrides={})=>({accountRef:'A1',discountType:'uberCash',discount:10,service:'Uber Eats',id:'grant-1',emailSentAt:'2026-10-01T12:00:00Z',expiresAt:'2026-10-31T12:00:00Z',expiryStatus:'exact',...overrides});
const receipt=(overrides={})=>({accountRef:'A1',receiptId:'r1',service:'Uber Eats',orderAt:'2026-10-10T12:00:00Z',uberCashUsed:4,...overrides});
const model=(grants,receipts=[])=>reconcileCashGrants(grants,receipts,{now});
assert.equal(model([grant()]).grants[0].remaining,10);
assert.equal(model([grant()],[receipt()]).grants[0].remaining,6);
assert.equal(model([grant()],[receipt(),receipt()]).grants[0].remaining,6);
assert.equal(model([grant()],[receipt({uberCashUsed:10})]).grants[0].status,'exhausted');
assert.equal(model([grant({expiresAt:'2026-10-10T12:00:00Z'})]).grants[0].status,'expired');
assert.equal(summariseCash(model([grant({expiresAt:'2026-10-10T12:00:00Z'})]).grants).remaining,0);
assert.equal(model([grant()],[receipt({accountRef:'A2'})]).grants[0].remaining,10);
assert.equal(model([grant()],[receipt({orderAt:'2026-09-30T12:00:00Z'})]).grants[0].remaining,10);
assert.equal(model([grant()],[receipt({cashUsageAmbiguous:true,uberCashUsed:10})]).grants[0].status,'needs_checking');
assert.equal(summariseCash(model([grant()],[receipt({cashUsageAmbiguous:true,uberCashUsed:10})]).grants).remaining,null);
const second=grant({id:'grant-2',discount:6,emailSentAt:'2026-10-05T12:00:00Z'});
assert.deepEqual(model([grant(),second],[receipt({uberCashUsed:12})]).grants.map(g=>g.remaining),[0,4]);
assert.equal(model([grant(),grant({id:'reminder',emailSentAt:'2026-10-15T12:00:00Z',cashTerms:{reminder:true}})]).grants.length,1);
assert.equal(model([grant(),grant({id:'new-grant',emailSentAt:'2026-10-15T12:00:00Z',cashTerms:{explicitNewGrant:true}})]).grants.length,2);
assert.equal(model([grant()],[receipt({uberCashUsed:10,total:0,refundAmount:10})]).grants[0].remaining,0,'A refund does not invent restored Cash');
assert.equal(model([grant({grantRef:'g1'})],[receipt({cashGrantRef:'g1',uberCashUsed:10,cashRefundRestored:4})]).grants[0].remaining,4);
const unknown=applyOfferExpiryPolicy(grant({expiryStatus:'unknown',expiresAt:null}));assert.equal(unknown.expiresAt,null);
const duration=applyOfferExpiryPolicy(grant({firstEmailSentAt:'2026-10-01T12:00:00Z',emailSentAt:'2026-10-15T12:00:00Z',expiryStatus:'estimated',cashTerms:{anchor:'original_email',duration:31,unit:'days'}}));
assert.equal(duration.expiresAt,'2026-11-01T12:00:00.000Z');
assert.equal(applyOfferExpiryPolicy(grant({expiryStatus:'unknown',expiresAt:null,cashTerms:{anchor:'activation',duration:31,unit:'days'}})).expiresAt,null);
const parsed=parseUberPromo({sender:'Uber Eats <offers@uber.com>',recipient:'example@example.invalid',subject:'You have £10 in Uber Cash',body:'Use £10 in Uber Cash on Uber Eats. Uber Cash is valid for 31 days from the original offer email.',sentAt:'2026-10-01T12:00:00Z'});
assert.equal(parsed.evidence.cashTerms.duration,31);assert.equal(parsed.evidence.cashTerms.anchor,'original_email');
assert.equal(applyOfferExpiryPolicy({...parsed,firstEmailSentAt:parsed.emailSentAt}).expiresAt,'2026-11-01T12:00:00.000Z');
const wallet={balance:10,at:'2026-10-12T12:00:00Z',receiptCount:1};
assert.equal(reconcileVerifiedCash(wallet,[receipt()],{account:{accountRef:'A1',orderCount:1},now,completeEvidence:true}).remaining,10,'Old receipts are not deducted twice');
assert.equal(reconcileVerifiedCash(wallet,[receipt(),receipt({receiptId:'r2',orderAt:'2026-10-13T12:00:00Z'})],{account:{accountRef:'A1',orderCount:2},now,completeEvidence:true}).remaining,6);
assert.equal(reconcileVerifiedCash(wallet,[],{account:{accountRef:'A1',orderCount:2},now}).remaining,null);
console.log('✓ Cash grants: issue, partial/exhausted/expired/unknown, chronological allocation, duplicate/reminder, ambiguity, evidence-only refunds and verified-balance timestamps');

assert.equal(reconcileVerifiedCash(wallet,[receipt()],{account:{accountRef:'A1',orderCount:2},now,completeEvidence:true}).status,'needs_checking','An older private export is not complete just because it is unlocked');
assert.equal(model([grant()],[receipt({orderAt:'2026-10-20T12:00:00Z'})]).grants[0].remaining,10,'Future receipts cannot reduce current Cash');
assert.equal(model([grant({grantRef:'g1'})],[receipt({uberCashUsed:10,cashGrantRef:'g1'}),receipt({receiptId:'refund',orderAt:'2026-10-11T12:00:00Z',uberCashUsed:0,cashGrantRef:'g1',cashRefundRestored:4})]).grants[0].remaining,4,'Explicit Cash-only refunds are reconciled once');
assert.equal(model([grant()],[receipt({cashUsageAmbiguous:true,financialCorrection:{uberCashUsed:4}})]).grants[0].status,'estimated','Private explicit payment corrections retain precedence');

const newGrant={issued:10,issuedAt:'2026-10-13T12:00:00Z',expiresAt:'2026-11-01T12:00:00Z',remaining:6,status:'estimated'};
const reconciled=reconcileVerifiedCash({...wallet,balance:3},[receipt(),receipt({receiptId:'later',orderAt:'2026-10-14T12:00:00Z'})],{account:{accountRef:'A1',orderCount:2,cashSummary:{grants:[newGrant]}},now,completeEvidence:true});
assert.equal(reconciled.remaining,9,'New grant issued after a manual check is added once, then later payments deducted once');assert.equal(reconciled.status,'verified_reconciled');
assert.equal(reconcileVerifiedCash(wallet,[],{account:{accountRef:'A1',orderCount:1,cashSummary:{grants:[{...newGrant,issuedAt:'2026-10-01T12:00:00Z',expiresAt:'2026-10-15T12:00:00Z'}]}},now}).status,'needs_checking','A grant expiring after wallet verification requires reconciliation');
assert.equal(model([grant(),grant({id:'reminder-extended',emailSentAt:'2026-10-15T12:00:00Z',expiresAt:'2026-11-15T12:00:00Z',cashTerms:{reminder:true}})]).grants[0].end,Date.parse('2026-10-31T12:00:00Z'),'A reminder alone cannot extend an explicit grant expiry');

assert.equal(model([grant(),grant({messageKey:'another-original',emailSentAt:'2026-10-15T12:00:00Z',cashTerms:{explicitNewGrant:true}})]).grants.length,2,'A new issue can reuse a promo family identifier');
assert.ok(model([grant(),second],[receipt({cashUsageAmbiguous:true,uberCashUsed:2})]).grants.every(g=>g.status==='needs_checking'),'Ambiguous credits cannot certify another overlapping grant untouched');
assert.equal(model([grant()],[receipt({orderAt:null,orderDate:'2026-10-01'})]).grants[0].status,'needs_checking','Date-only usage on an issue boundary is not invented as before or after the grant');

const summary=summariseCash(model([grant()]).grants);assert.equal(currentCashPosition({cashSummary:summary},[],null,[],{now,ignoredEstimates:summary.grants}).remaining,0,'Ignoring a grant removes its estimate from discovery without deleting it');

// A newer receipt can make a manual verification uncertain, but must never
// resurrect an email estimate from before that verification.
const priorGrant={status:'estimated',remaining:10,issued:10,issuedAt:'2026-10-01T12:00:00Z',expiresAt:'2026-10-31T12:00:00Z'};
const checkedAccount={accountRef:'A1',orderCount:1,rideCount:0,lastOrderAt:'2026-10-16T12:00:00Z',cashSummary:{grants:[priorGrant]}};
const checkedZero={balance:0,at:'2026-10-15T12:00:00Z',receiptCount:0},savedCheck=JSON.stringify(checkedZero);
for(const balance of [0,3]){
 const position=currentCashPosition(checkedAccount,[],{...checkedZero,balance},[],{now});
 assert.equal(position.status,'needs_checking');assert.equal(position.remaining,null);assert.equal(position.verificationNeedsChecking,true);
}
assert.equal(JSON.stringify(checkedZero),savedCheck,'Reconciliation cannot overwrite the saved verification');
const laterReceipt=receipt({orderAt:'2026-10-16T12:00:00Z',uberCashUsed:0});
assert.equal(currentCashPosition(checkedAccount,[],checkedZero,[laterReceipt],{now,completeEvidence:true}).remaining,0,'Complete newer evidence preserves a checked zero instead of resurrecting the prior grant');
const laterGrant={...priorGrant,issued:6,remaining:6,issuedAt:'2026-10-16T14:00:00Z'};
assert.equal(currentCashPosition({...checkedAccount,cashSummary:{grants:[priorGrant,laterGrant]}},[],checkedZero,[laterReceipt],{now,completeEvidence:true}).remaining,6,'A supported new grant after verification still participates');
console.log('✓ Manual Cash verification stays authoritative when newer receipt evidence is incomplete; prior grants cannot resurrect spent balances');
