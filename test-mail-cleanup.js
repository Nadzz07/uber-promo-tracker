import {explicitMailDecision} from './mail-review-rules.js';
import assert from 'node:assert/strict';
import {createMailReviewContext,reviewMailMessage,campaignWinner,finalizeMailDecision,mailIdentityExclusion} from './mail-review-rules.js';
import {cleanupPreview} from './mail-cleanup.js';
import {parseUberPromo} from './parser.js';
import {offerFingerprint} from './identity.js';
import {classifyAccount} from './account-state.js';
const accounts={accounts:[{email:'a@icloud.com',accountRef:'A001',canLogin:true},{email:'b@icloud.com',accountRef:'A002',canLogin:false},{email:'c@icloud.com',accountRef:'A003',canLogin:null}],offerIdMigrations:[]};
const base={sender:'offers@uber.com',recipient:'a@icloud.com',sentAt:'2026-01-02T12:00:00Z',receivedAt:'2026-01-02T12:00:01Z',messageId:'1@uber.com'};
const message={...base,subject:'£12 off on 5 orders',body:'Get £12 off each of your next 5 Uber Eats orders. Minimum spend £15. Valid until 10 January 2026.'};
const parsed=parseUberPromo(message),offer={...parsed,id:'public-campaign',accountRef:'A001',usesVerified:true,minimumSpendVerified:true,firstEmailSentAt:base.sentAt,emailSentAt:base.sentAt,expiryStatus:'exact',receiptState:'used',trackingState:'used',receiptConfirmedUses:5};
accounts.offerIdMigrations.push({from:offerFingerprint({...parsed,accountRef:'A001'}),to:offer.id});
const receipts=Array.from({length:5},(_,i)=>({receiptId:'receipt-'+i,accountRef:'A001',uberCashUsed:0}));
const matches=receipts.map(r=>({receiptId:r.receiptId,accountRef:r.accountRef,offerId:offer.id,status:'confirmed'}));
const context=(changes={})=>createMailReviewContext({accounts,snapshot:{promos:[offer]},finance:{receipts,offerReceiptMatches:matches},receiptImported:()=>true,now:Date.parse('2026-01-11'),...changes});
const result=(m=message,c=context())=>reviewMailMessage(m,c);
assert.equal(result().destination,'Archive');assert.equal(result().deduplicate,true);
for(const email of ['a@icloud.com','b@icloud.com']){
 assert.equal(result({...base,recipient:email,subject:'Your Uber code',body:'123456 is your Uber code.'}).category,'excluded_login_code');
 assert.equal(result({...base,recipient:email,subject:'Phone number updated',body:'Your phone number has changed.'}).category,'excluded_phone_update');
 assert.equal(result({...base,recipient:email,subject:'Your receipt from Example',body:'Thanks for your order. Total £4.93.'}).destination,'Uber Receipts');
}
assert.equal(result({...base,subject:'Your receipt from Example',body:'Thanks for your order. Total £4.93.'},context({receiptImported:()=>false})).destination,null);
const eurostar={...base,subject:'Eurostar Snow is now live for bookings!',body:'Book Eurostar travel. Unsubscribe.'};
assert.equal(result(eurostar).destination,'Eurostar');assert.equal(result({...eurostar,recipient:'b@icloud.com'}).destination,'Eurostar');
for(const m of [{...message,recipient:'b@icloud.com'},{...base,recipient:'b@icloud.com',subject:'Account announcement',body:'Account news'},{...base,subject:'20% off your next Uber Ride',body:'Enjoy 20% off your next Uber ride.'},{...base,subject:'£5 off your next Uber trip',body:'£5 off your next Uber trip. Minimum fare £10.'}])assert.equal(result(m).destination,'Bin');
assert.equal(result({...message,recipient:'c@icloud.com'}).destination,null);assert.equal(result({...message,sender:'Uber <bad@invalid.example>'}).destination,null);
// Five account receipts without reliable offer assignments do not prove five promo uses.
assert.equal(result(message,context({finance:{receipts,offerReceiptMatches:[]},snapshot:{promos:[{...offer,receiptState:null,receiptConfirmedUses:0}]}})).category,'review');
// Explicit complete matching with zero, partial expiry, and still-valid partial usage.
const unused={...offer,receiptState:'unused',receiptConfirmedUses:0};
assert.equal(result(message,context({finance:{receipts,offerReceiptMatches:[]},snapshot:{promos:[unused]}})).destination,'Bin');
assert.equal(result(message,context({finance:{receipts,offerReceiptMatches:matches.slice(0,3)},snapshot:{promos:[{...offer,receiptState:'partial',receiptConfirmedUses:3}]}})).destination,'Archive');
assert.equal(result(message,context({now:Date.parse('2026-01-05'),finance:{receipts,offerReceiptMatches:matches.slice(0,3)},snapshot:{promos:[{...offer,receiptState:'partial',receiptConfirmedUses:3}]}})).destination,null);
assert.equal(result(message,context({snapshot:{promos:[{...unused,expiryStatus:'estimated'}]},finance:{receipts,offerReceiptMatches:[]}})).destination,null);
assert.equal(result({...message,body:message.body.replace('10 January','12 January')}).category,'review','Same amount, different expiry is not the same campaign');
// A percent Eats offer is kept alongside overlapping Cash, not confused with Ride.
for(const percent of [30,40,50]){
 const m={...base,subject:percent+'% off Uber Eats',body:'Get '+percent+'% off your next Uber Eats order. Minimum spend £15. Valid until 10 January 2026.'};const p=parseUberPromo(m),cash={id:'cash',accountRef:'A001',discountType:'uberCash',firstEmailSentAt:base.sentAt,expiresAt:'2026-01-12T23:59:59Z',expiryStatus:'exact'};
 const ids={...accounts,offerIdMigrations:[...accounts.offerIdMigrations,{from:offerFingerprint({...p,accountRef:'A001'}),to:'percentage'}]};const promo={...p,id:'percentage',accountRef:'A001',expiryStatus:'exact',firstEmailSentAt:'2026-01-08T12:00:00Z'};
 const c=context({accounts:ids,now:Date.parse('2026-01-09'),snapshot:{promos:[promo,cash]}});assert.equal(result(m,c).destination,'Inbox');assert.equal(c.usage(promo).used,false,'Cash spending must not establish percentage use');
 const r={receiptId:'both',accountRef:'A001',uberCashUsed:6},both=context({accounts:ids,snapshot:{promos:[{...promo,uses:1,usesVerified:true,receiptState:'used'},cash]},finance:{receipts:[r],offerReceiptMatches:[{receiptId:'both',accountRef:'A001',offerId:'percentage',status:'confirmed'},{receiptId:'both',accountRef:'A001',offerId:'cash',status:'confirmed'}]}});assert.equal(result(m,both).destination,'Bin');assert.equal(both.usage(cash).used,true);
 const cashOnly=context({accounts:ids,snapshot:{promos:[{...promo,receiptState:'unused'},cash]},finance:{receipts:[r],offerReceiptMatches:[{receiptId:'both',accountRef:'A001',offerId:'cash',status:'confirmed'}]}});assert.equal(result(m,cashOnly).destination,'Bin');
}
// Latest email is retained globally; Archive wins ties so repeat plans are stable.
const older={accountId:'local',path:['INBOX'],nativeId:1,raw:'original-1',message},newer={...older,nativeId:2,raw:'original-2',message:{...message,messageId:'2@uber.com',sentAt:'2026-01-03T12:00:00Z'}},archived={...newer,path:['Archive'],nativeId:3};
assert.equal(campaignWinner(older,newer),newer);assert.equal(campaignWinner(newer,archived),archived);
assert.equal(finalizeMailDecision(older,result(),archived).destination,'Bin');assert.equal(finalizeMailDecision(archived,result(),archived).destination,'Archive');
const preview=cleanupPreview([older,newer,archived],new Map(),context());assert.equal(preview.targets.length,2);assert(preview.targets.every(t=>t.destination==='Bin'));assert.equal(preview.alreadyAtDestination,1);
const usedAccount={canLogin:true,accountStatus:'active',orderCount:5};const newOffer={service:'Uber Eats',trackingState:'available',uses:5,usesRemaining:5,usesVerified:true,expiresAt:'2099-01-10T23:59:59Z',expiryStatus:'exact'};assert.equal(classifyAccount(usedAccount,[newOffer]).recommendationEligible,true,'New usable offer restores readiness without clearing account usage');
console.log('✓ Reviewed Mail rules: access-specific exclusions, every Ride promo, source-linked use/unknown/expiry, all Eats percentages with Cash, no double-counting, campaign duplicate winners, receipt filing and renewed readiness.');

const coded={...message,body:message.body.replace('Valid until','Use code EATS12. Valid until')},cp=parseUberPromo(coded),co={...offer,...cp,id:'coded',accountRef:'A001',firstEmailSentAt:base.sentAt,expiryStatus:'exact',usesVerified:true,minimumSpendVerified:true,receiptState:'used'};const ca={...accounts,offerIdMigrations:[...accounts.offerIdMigrations,{from:offerFingerprint({...cp,accountRef:'A001'}),to:'coded'}]};const cc=context({accounts:ca,snapshot:{promos:[co]},finance:{receipts,offerReceiptMatches:matches.map(m=>({...m,offerId:'coded'}))}});assert.equal(result(coded,cc).destination,'Archive');assert.equal(result({...coded,body:coded.body.replace('10 January','15 January')},cc).category,'review','Reused code with another validity window is a new campaign, not a duplicate');

assert.equal(mailIdentityExclusion({...base,subject:'You have £12 in Uber Cash waiting in your account',body:'Use promo code CASH12. Offer expires in 2026. Unsubscribe.'}),null,'Promo codes and years are not login codes');assert.equal(mailIdentityExclusion({...base,subject:'Book a table on Uber Eats and get a free ride',body:'Your promotional code TABLE26 expires 2026. Unsubscribe.'}),null);assert.equal(mailIdentityExclusion({...base,subject:'Your Uber code',body:'123 456 is your Uber code.'}),'excluded_login_code');assert.equal(mailIdentityExclusion({...base,subject:'Sign in to Uber',body:'Use code 123456.'}),'excluded_login_code');

for(const subject of ['Explore new restaurants on Uber Eats 🍽','One app, endless deals: meals and more','What are you in the mood for?','Delicious meals for less'])for(const recipient of ['a@icloud.com','b@icloud.com','c@icloud.com'])assert.equal(result({...base,recipient,subject,body:'Browse nearby restaurants. Order now. Unsubscribe.'}).destination,'Bin');
assert.equal(result({...base,subject:'Explore new restaurants on Uber Eats',body:'Get £12 off your next 5 Uber Eats orders. Minimum spend £15. Valid until 10 January 2026. Unsubscribe.'}).category,'review','A real offer in the fine print is not generic marketing');
assert.equal(result({...base,subject:'Book a table on Uber Eats and get a free ride 🚗',body:'Book today. Unsubscribe.'}).destination,'Bin');
console.log('✓ Generic adverts bin immediately across login states; fine-print offers, receipts, codes and phone updates remain protected; Eurostar has a dedicated folder.');

for(const percent of [30,40,50]){const m={...base,subject:percent+'% off Uber Eats',body:'Get '+percent+'% off your next Uber Eats order. Minimum spend £15. Valid until 10 January 2026.'};const c=context({now:Date.parse('2026-01-09'),snapshot:{promos:[]}});assert.equal(result(m,c).destination,'Inbox','Keep a current percentage offer without Cash or a matched campaign');assert.equal(result(m,context({now:Date.parse('2026-01-11'),snapshot:{promos:[]}})).destination,'Bin','Confirmed expiry is enough for the requested percentage cleanup, without claiming receipt usage');assert.equal(result({...m,body:m.body.replace(' Valid until 10 January 2026.','')},c).destination,null,'Unknown expiry is not expired');}
console.log('✓ Eats percentage offers: current to Inbox even without Cash; source-confirmed expired to Bin; unknown expiry held.');

for(const [subject,body]of [['Land 1K bonus Avios ✈️','Link your British Airways Club account, then complete 1 qualifying trip and 1 qualifying order.'],['From pre-drinks to the after-party',"Enjoy the night. We will handle the rides."],['New device sign-in','A new device was used to log into your Uber account.']])assert.equal(result({...base,subject,body}).destination,'Bin');
assert.equal(result({...base,sender:'Uber Eats <offers@uber.com>',subject:"Do not wait! 20% off will not last",body:'Let someone else handle the driving. Take your next trip with the Uber app and enjoy 20% off 2 rides. Up to £5 max. Valid until 9 November 2026.'}).destination,'Bin');
assert.equal(result({...base,subject:'New device sign-in',body:'Your login verification code is 123456.'}).category,'excluded_login_code','A real verification code is still protected');
console.log('✓ Explicit Avios, night-out and new-device notices bin; cross-branded Ride offers use service terms; actual codes remain protected.');

assert.equal(result({...base,subject:'50% off Uber Eats',body:'Get 50% off your next Uber Eats order. Minimum spend £15. Valid until 10 January.'},context({now:Date.parse('2026-01-11'),snapshot:{promos:[]}})).destination,null,'An inferred expiry year must not trigger deletion');

assert.equal(mailIdentityExclusion({...base,subject:'Your Uber code',body:'Use promo code CASH12. Offer expires in 2026. Unsubscribe.'}),null,'A promo code and a year are not a numeric login code');

assert.equal(mailIdentityExclusion({...base,subject:'Your Uber account verification code',body:'To verify your account, enter 1234. This expires in 10 minutes.'}),'excluded_login_code','Four-digit OTP need not be immediately after the word code');

for(const subject of ['Your Wednesday evening trip with Uber','Your Sunday morning trip with Uber','Your Wednesday evening order with Uber Eats']){const m={...base,subject,body:'Thanks for riding with Uber. Fare £11.91. Promotion -£10.00. Total £1.91. Unsubscribe. Get 20% off your next 2 rides.'};assert.notEqual(result(m).destination,'Bin','A dated trip/order receipt must never become an advert cleanup');}
console.log('✓ Dated trip/order receipt subjects and real receipt parsers take priority over every advertising rule.');
// A footer mentioning Eurostar cannot turn general rail advertising into a Eurostar campaign.
for(const subject of ['Go green on your next adventure! 🚄','Travelling for the holidays? Coaches run non-stop','New: London <> Stirling direct with Lumo','Go by train to keep your travel green 💚','GWR Black Friday sale: Up to 50% off','Member Days exclusive: 20% back on Trains']){
 assert.equal(explicitMailDecision({...base,subject,body:'Book travel in Uber. Eurostar is also available. Unsubscribe.'}).destination,'Bin');
}
assert.equal(explicitMailDecision({...base,subject:'Eurostar sale: Tickets from £35',body:'Book Eurostar.'}).destination,'Eurostar');
// Explicit fine-print dates remain explicit with Sept and clock-before-date phrasing.
for(const tail of ['available until 28 Sept 2026 3:00AM','available until 11:55pm on 27 September 2026','Offer ends at 11:55pm on 27 September 2026'])assert.equal(explicitMailDecision({...base,subject:'Get 50% off your next 5 orders',body:'50% off your next 5 Uber Eats orders. Minimum spend £15. Maximum discount £12. '+tail+'.'},Date.parse('2026-11-06')).destination,'Bin');
assert.equal(explicitMailDecision({...base,subject:'Explore new restaurants on Uber Eats 🍽️',body:'Discover restaurants, including offers in your area. Unsubscribe.'}).destination,'Bin');
const differentDeadlines=parseUberPromo({...base,subject:'50% off dinner',body:'50% off Uber Eats orders. Minimum spend £15. Offer ends at 11:55pm on 15 November 2026, except Wagamama for which the offer ends at 11:55pm on 11 October 2026.'});assert.equal(differentDeadlines.expiryStatus,'unknown','Merchant exceptions must not become one invented expiry');
// Menu discounts and product percentage adverts are not personal account offers.
for(const subject of ['Crowd favourites, delivered','All the trusted picks','Feeling peckish?'])assert.equal(explicitMailDecision({...base,subject,body:'Order from nearby restaurants. Roti King 30% off £20+. KFC 15% off. Join Uber One. Unsubscribe.'}).destination,'Bin');
for(const subject of ['Cosy season = hot grocery savings','Up to 50% off skincare + more offers'])assert.equal(explicitMailDecision({...base,subject,body:'Shop Boots, John Lewis and other selected stores. Discount percentage varies per item. The discount value is calculated as a percentage off of the original price of the item. Unsubscribe.'}).destination,'Bin');
for(const subject of ['Crowd favourites, delivered','Cosy season = hot grocery savings'])assert.equal(explicitMailDecision({...base,subject,body:'Get £12 off your next 5 Uber Eats orders. Minimum spend £15. Use promo code PERSONAL12. Valid until 20 November 2026. Other shopping deals: discount percentage varies per item.'},Date.parse('2026-11-06')),null,'Mixed personal offers must stay protected');
assert.equal(explicitMailDecision({...base,subject:'Turn takeaways into getaways',body:'Link your British Airways Club account to collect Avios on orders. Unsubscribe.'}).destination,'Bin');
assert.equal(explicitMailDecision({...base,subject:'4 weeks free! Try Uber One and start saving.',body:'Sign up for a free trial. Membership benefits on eligible orders and rides. Unsubscribe.'}).destination,'Bin');
assert.equal(explicitMailDecision({...base,subject:'Earn Uber One credits thanks to Uber One',body:'Take a ride. Earn credits on eligible rides. Unsubscribe.'}).destination,'Bin');
console.log('✓ Restaurant discovery, item-level shopping discounts, Avios and membership adverts bin; personal offers in mixed messages remain protected.');
// Later owner additions: discard £15 off £25; discard old percentage emails by age,
// without pretending that an active or unknown expiry is confirmed expired.
const reviewNow=Date.parse('2026-11-07T12:00:00Z');
const fixed1525={...base,sentAt:'2026-11-06T12:00:00Z',subject:'Save £15 on groceries',body:'Get £15 off your next Uber Eats order of £25 or more. Minimum spend £25. Use code GROCERY15. Valid until 20 November 2026.'};assert.equal(explicitMailDecision(fixed1525,reviewNow).category,'owner_excluded_15_off_25');
const oldPercent={...base,sentAt:'2026-10-06T12:00:00Z',subject:'50% off Uber Eats',body:'Get 50% off your next 5 Uber Eats orders. Minimum spend £15. Maximum discount £12. Valid until 20 November 2026.'};assert.equal(explicitMailDecision(oldPercent,reviewNow).category,'old_eats_percentage_email');assert.equal(explicitMailDecision({...oldPercent,body:oldPercent.body.replace(' Valid until 20 November 2026.','')},reviewNow).category,'old_eats_percentage_email');assert.equal(explicitMailDecision({...oldPercent,sentAt:'2026-10-20T12:00:00Z'},reviewNow),null);assert.equal(explicitMailDecision({...oldPercent,sentAt:null,receivedAt:null},reviewNow),null);
for(const subject of ['Half off your favourite burger','30% off autumn favourites',"See this week's top shopping deals 📲","See this week's top shopping offers 📲",'Budget-friendly bites'])assert.equal(explicitMailDecision({...base,sentAt:'2026-11-06',subject,body:'Explore merchant deals. Order now. Unsubscribe.'},reviewNow).destination,'Bin');
assert.equal(explicitMailDecision({...fixed1525,subject:'Your Uber Eats receipt',body:'Thanks for your order. Receipt total £1.00. Promotion £15.00. Minimum spend £25.'},reviewNow),null);assert.equal(explicitMailDecision({...fixed1525,body:fixed1525.body.replace('of £25 or more','of £15 or more').replace('Minimum spend £25','Minimum spend £15')},reviewNow),null);
console.log('✓ Owner additions: £15 off £25 and named adverts bin; calendar-age rule is separate from expiry; newer and undated percentage offers, receipts and £15 off £15 remain protected.');
assert.equal(explicitMailDecision({...base,sentAt:'2026-11-06',subject:'Delicious options for you',body:'Order from these restaurants near you. Help yourself to these restaurants. Popeyes 30% off £15+. Menu item £14.49. Unsubscribe.'},reviewNow).destination,'Bin');
assert.equal(explicitMailDecision({...base,sentAt:'2026-11-06',subject:'Delicious options for you',body:'Order from these restaurants near you. Get £12 off your next 5 Uber Eats orders. Minimum spend £15. Use code PERSONAL12. Valid until 20 November 2026.'},reviewNow),null);
for(const [subject,body]of [['Need something sent? Choose Courier.','Try same-day delivery for packages. Unsubscribe.'],['Get 50% off Uber One for 1 month!','Sign up for membership. Unsubscribe.'],['Thanking NHS workers',"Link your Uber account to a valid NHS email. We will send two promo codes after you link your account. Unsubscribe."]])assert.equal(explicitMailDecision({...base,subject,body},reviewNow).destination,'Bin');
assert.equal(explicitMailDecision({...oldPercent,subject:'Last call: 50% off your next 2 meals',body:'50% off your next 2 meals on Uber Eats. Order now. Unsubscribe.'},reviewNow).destination,'Bin');
// Transaction-looking subjects must not protect a proven marketing-only template.
const postOrderAd={...base,subject:'Example, thanks for ordering',body:'Join Uber One and save as a member! Pan to plate with just a few taps. Explore Top Eats. Order now. Make your own masterpiece. Unsubscribe.'};assert.equal(explicitMailDecision(postOrderAd).destination,'Bin');assert.equal(explicitMailDecision({...postOrderAd,body:postOrderAd.body+' Order details. Order ID ABC12345. Subtotal £15. Total £3.'}),null);
assert.equal(explicitMailDecision({...base,subject:'Remember, remember… Bonfire Night',body:'Shop Bonfire Night snacks. Unsubscribe.'}).destination,'Bin');assert.equal(explicitMailDecision({...base,subject:'Your Bonfire Night receipt',body:'Thanks for your order. Subtotal £15. Total £3. Unsubscribe.'}),null);
assert.equal(explicitMailDecision({...postOrderAd,body:postOrderAd.body+' Your payment method will be charged £4.99/month after a free trial. View the Renewable Membership T&Cs.'}).destination,'Bin','Generic membership renewal fine print is not a transaction receipt');

{
 const {explicitMailDecision}=await import('./mail-review-rules.js');
 const base={sender:'Uber One <noreply@uber.com>',recipient:'member@example.invalid',sentAt:new Date().toISOString()};
 assert.equal(explicitMailDecision({...base,subject:'Long time, no see!',body:'Try Uber One. Rejoin our membership and get 4 weeks free. Join Uber One. Unsubscribe.'})?.destination,'Bin');
 assert.equal(explicitMailDecision({...base,subject:'Your Uber One receipt',body:'Membership invoice. Total paid £5.99. Unsubscribe.'}),null,'Actual membership receipts stay protected');
}
