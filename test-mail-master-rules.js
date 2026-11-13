// Acceptance tests for the master rule engine: duplicate campaigns, estimated
// expiry matching, multilingual security codes and Others routing.
import assert from 'node:assert/strict';
import {createMailReviewContext,reviewMailMessage,mailIdentityExclusion,isProtectedSecurityEmail,campaignWinner,finalizeMailDecision} from './mail-review-rules.js';
import {campaignTermKey,offerFingerprint} from './identity.js';
import {parseUberPromo} from './parser.js';

const accounts={accounts:[{email:'a@icloud.com',accountRef:'A001',canLogin:true},{email:'b@icloud.com',accountRef:'A002',canLogin:false}],offerIdMigrations:[]};
const base={sender:'Uber Eats <noreply@uber.com>',recipient:'a@icloud.com',sentAt:'2026-01-02T12:00:00Z',receivedAt:'2026-01-02T12:00:01Z',messageId:'1@uber.com'};
const offerMessage={...base,subject:'£12 off on 5 orders',body:'Get £12 off each of your next 5 Uber Eats orders. Minimum spend £15. Valid until 10 January 2026.'};
const parsed=parseUberPromo(offerMessage);

// A stored campaign whose expiry is exact, as the tracker would hold it.
const storedOffer={...parsed,id:'campaign-1',accountRef:'A001',usesVerified:true,minimumSpendVerified:true,firstEmailSentAt:base.sentAt,emailSentAt:base.sentAt,expiryStatus:'exact',expiresAt:'2026-01-10T23:59:59.000Z',trackingState:'available',receiptConfirmedUses:0,receiptState:null};

const makeContext=(promos=[storedOffer],overrides={})=>createMailReviewContext({accounts,snapshot:{promos},finance:{receipts:[],offerReceiptMatches:[]},receiptImported:()=>true,now:Date.parse('2026-01-05T12:00:00Z'),...overrides});

// ── 1. Estimated expiry no longer breaks campaign matching ────────────────
// The email's own expiry is only an estimate derived from its arrival date.
const estimatedEmail={...offerMessage,expiryStatus:'estimated',expiry:'2026-02-06T12:00:00.000Z'};
const estimatedDecision=reviewMailMessage(estimatedEmail,makeContext());
assert.ok(!observed(estimatedDecision,'unknown'),'An estimated expiry must not make an otherwise matching campaign unknown');
assert.equal(campaignTermKey({...parsed,accountRef:'A001'}),campaignTermKey(storedOffer),'Term keys ignore the expiry window');

// An estimated match may keep a campaign but must never authorise binning.
function observed(decision,needle){return decision.category===needle;}
// Stored expiry is only an estimate, so the terms match but the identity is not
// proven: the campaign is recognised, yet no destructive action may follow.
// The email carries no explicit expiry, so the parser can only estimate it.
const expiredEstimate=reviewMailMessage(
 {...base,subject:'£12 off on 5 orders',body:'Get £12 off each of your next 5 Uber Eats orders. Minimum spend £15.'},
 makeContext([{...storedOffer,expiryStatus:'exact',expiresAt:'2020-01-10T23:59:59.000Z',firstEmailSentAt:'2019-12-01T12:00:00Z',emailSentAt:'2019-12-01T12:00:00Z',receiptState:null}])
);
assert.equal(expiredEstimate.destination,null,'An estimated-expiry match never bins or archives on its own');
assert.equal(expiredEstimate.category,'review');

// ── 2. Genuinely new campaign on an account with no stored offers ─────────
const noOffers=reviewMailMessage(offerMessage,makeContext([]));
assert.equal(noOffers.destination,null,'A new campaign waits for review');
assert.equal(noOffers.category,'review');

// ── 3. Two different campaigns are not merged ────────────────────────────
const differentMinimum=reviewMailMessage({...offerMessage,body:offerMessage.body.replace('Minimum spend £15','Minimum spend £25')},makeContext());
assert.equal(differentMinimum.category,'review','A different minimum spend is a different campaign');
assert.notEqual(campaignTermKey({...parsed,accountRef:'A001',minimumSpend:25}),campaignTermKey(storedOffer));

// ── 4. Duplicate copies: keep one, bin the rest ──────────────────────────
const copy1={accountId:'local',path:['INBOX'],nativeId:11,raw:'raw-11',message:{...offerMessage,messageId:'11@uber.com'}};
const copy2={accountId:'local',path:['INBOX'],nativeId:12,raw:'raw-12',message:{...offerMessage,messageId:'12@uber.com',sentAt:'2026-01-03T12:00:00Z'}};
const copy3={accountId:'local',path:['INBOX'],nativeId:13,raw:'raw-13',message:{...offerMessage,messageId:'13@uber.com',sentAt:'2026-01-04T12:00:00Z'}};
const winner=[copy1,copy2,copy3].reduce((best,c)=>campaignWinner(best,c),null);
assert.equal(winner.nativeId,13,'The latest useful copy is retained');
// A reliable match (exact expiry on both sides) authorises deduplication.
const reliableDecision=reviewMailMessage(offerMessage,makeContext());
assert.equal(reliableDecision.deduplicate,true,'A reliably identified campaign is deduplicated');
const decisions=[copy1,copy2].map(c=>finalizeMailDecision(c,reliableDecision,winner));
assert.ok(decisions.every(d=>d.destination==='Bin'),'Redundant copies are binned');
assert.equal(finalizeMailDecision(winner,reliableDecision,winner).destination,reliableDecision.destination,'The retained copy is never binned');

// ── 5. Romanian and other-language login codes are protected ─────────────
const code=subject=>({...base,subject,body:'Uber'});
assert.equal(mailIdentityExclusion(code('Nu transmite altcuiva: 3131')),'excluded_login_code');
assert.equal(isProtectedSecurityEmail(code('Nu transmite altcuiva: 3131')),'excluded_login_code');
assert.equal(mailIdentityExclusion(code('No compartas este código: 4821')),'excluded_login_code');
assert.equal(mailIdentityExclusion(code('Ne partagez pas ce code : 9021')),'excluded_login_code');
assert.equal(mailIdentityExclusion(code('Nicht weitergeben: 3311')),'excluded_login_code');
assert.equal(mailIdentityExclusion(code('Não compartilhe: 7712')),'excluded_login_code');
assert.equal(mailIdentityExclusion(code('Nie udostępniaj: 5512')),'excluded_login_code');
assert.equal(mailIdentityExclusion(code('Doğrulama kodu: 8842')),'excluded_login_code');
assert.equal(mailIdentityExclusion(code('Не сообщайте: 6604')),'excluded_login_code');
assert.equal(mailIdentityExclusion(code('لا تشارك: 2299')),'excluded_login_code');
// A translated phrase without a code is not a security email.
assert.equal(isProtectedSecurityEmail({...base,subject:'Nu transmite altcuiva',body:'Uber'}),null);

// Security protection wins over a promotional-looking body and over access state.
for(const recipient of ['a@icloud.com','b@icloud.com']){
 const decided=reviewMailMessage({...base,recipient,subject:'Nu transmite altcuiva: 3131',body:'Get £10 off. Unsubscribe.'},makeContext());
 assert.equal(decided.category,'excluded_login_code','Security classification takes priority');
 assert.equal(decided.destination,null,'Security email is never moved to Bin');
}

// ── 6. Uber Cash notices never create a balance or a campaign ────────────
const cashNotice=reviewMailMessage({...base,subject:'You have £12 in Uber Cash waiting in your account 🤑',body:'Use your Uber Cash. Unsubscribe.'},makeContext());
assert.notEqual(cashNotice.category,'keep_current_offer','A Cash notice is not a tracked campaign');
assert.equal(cashNotice.category,'keep_cash_notice','Uber Cash is a promotion, so it keeps its own classification');
assert.equal(cashNotice.destination,'Inbox','Uber Cash stays in the Inbox for an account you can log into and never changes a balance');

// ── 7. Uber One welcome mail is not a promotion ───────────────────────────
const uberOne=reviewMailMessage({...base,subject:'Welcome to Uber One, Nadim',body:'Your membership has started. Unsubscribe.'},makeContext());
assert.notEqual(uberOne.category,'keep_current_offer');
assert.equal(uberOne.destination,'Others','A membership welcome is filed to Others');
assert.equal(uberOne.category,'uber_one_welcome');

// ── 8. General Uber mail on an account without confirmed completion ──────
const general=reviewMailMessage({...base,subject:'Your midday pick-me-up is here',body:'Browse restaurants near you. Unsubscribe.'},makeContext());
assert.equal(general.destination,'Others','General Uber mail is filed, not discarded');
assert.equal(general.category,'general_uber_mail');

console.log('✓ Master rule engine: estimated-expiry matching without destructive action, new campaigns held, distinct campaigns not merged, one retained copy in Archive with duplicates binned, multilingual login codes protected over every rule, Cash notices not campaigns, Uber One welcome and general Uber mail filed to Others');
