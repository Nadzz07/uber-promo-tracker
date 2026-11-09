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
assert.equal(result().destination,'Inbox');assert.equal(result().deduplicate,true);
for(const email of ['a@icloud.com','b@icloud.com']){
 assert.equal(result({...base,recipient:email,subject:'Your Uber code',body:'123456 is your Uber code.'}).category,'excluded_login_code');
 assert.equal(result({...base,recipient:email,subject:'Phone number updated',body:'Your phone number has changed.'}).category,'excluded_phone_update');
 assert.equal(result({...base,recipient:email,subject:'Your receipt from Example',body:'Thanks for your order. Total £4.93.'}).destination,'Uber Receipts');
}
assert.equal(result({...base,subject:'Your receipt from Example',body:'Thanks for your order. Total £4.93.'},context({receiptImported:()=>false})).destination,null);
const eurostar={...base,subject:'Eurostar Snow is now live for bookings!',body:'Book Eurostar travel. Unsubscribe.'};
assert.equal(result(eurostar).destination,'Eurostar');assert.equal(result({...eurostar,recipient:'b@icloud.com'}).destination,'Bin');
for(const m of [{...message,recipient:'b@icloud.com'},{...base,recipient:'b@icloud.com',subject:'Account announcement',body:'Account news'},{...base,subject:'20% off your next Uber Ride',body:'Enjoy 20% off your next Uber ride.'},{...base,subject:'£5 off your next Uber trip',body:'£5 off your next Uber trip. Minimum fare £10.'}])assert.equal(result(m).destination,'Bin');
assert.equal(result({...message,recipient:'c@icloud.com'}).destination,null);assert.equal(result({...message,sender:'Uber <bad@invalid.example>'}).destination,null);
// Five account receipts without reliable offer assignments do not prove five promo uses.
assert.equal(result(message,context({finance:{receipts,offerReceiptMatches:[]},snapshot:{promos:[{...offer,receiptState:null,receiptConfirmedUses:0}]}})).category,'retain_one_expired_unknown_offer');
// Explicit complete matching with zero, partial expiry, and still-valid partial usage.
const unused={...offer,receiptState:'unused',receiptConfirmedUses:0};
assert.equal(result(message,context({finance:{receipts,offerReceiptMatches:[]},snapshot:{promos:[unused]}})).destination,'Bin');
assert.equal(result(message,context({finance:{receipts,offerReceiptMatches:matches.slice(0,3)},snapshot:{promos:[{...offer,receiptState:'partial',receiptConfirmedUses:3}]}})).destination,'Inbox');
assert.equal(result(message,context({now:Date.parse('2026-01-05'),finance:{receipts,offerReceiptMatches:matches.slice(0,3)},snapshot:{promos:[{...offer,receiptState:'partial',receiptConfirmedUses:3}]}})).destination,null);
assert.equal(result(message,context({snapshot:{promos:[{...unused,expiryStatus:'estimated'}]},finance:{receipts,offerReceiptMatches:[]}})).destination,null);
assert.equal(result({...message,body:message.body.replace('10 January','12 January')}).category,'review','Future expiry is not assumed expired');
// A percent Eats offer is kept alongside overlapping Cash, not confused with Ride.
for(const percent of [30,40,50]){
 const m={...base,subject:percent+'% off Uber Eats',body:'Get '+percent+'% off your next Uber Eats order. Minimum spend £15. Valid until 10 January 2026.'};const p=parseUberPromo(m),cash={id:'cash',accountRef:'A001',discountType:'uberCash',firstEmailSentAt:base.sentAt,expiresAt:'2026-01-12T23:59:59Z',expiryStatus:'exact'};
 const ids={...accounts,offerIdMigrations:[...accounts.offerIdMigrations,{from:offerFingerprint({...p,accountRef:'A001'}),to:'percentage'}]};const promo={...p,id:'percentage',accountRef:'A001',expiryStatus:'exact',firstEmailSentAt:'2026-01-08T12:00:00Z'};
 const c=context({accounts:ids,now:Date.parse('2026-01-09'),snapshot:{promos:[promo,cash]}});assert.equal(result(m,c).destination,'Inbox');assert.equal(c.usage(promo).used,false,'Cash spending must not establish percentage use');
 const r={receiptId:'both',accountRef:'A001',uberCashUsed:6},both=context({accounts:ids,snapshot:{promos:[{...promo,uses:1,usesVerified:true,receiptState:'used'},cash]},finance:{receipts:[r],offerReceiptMatches:[{receiptId:'both',accountRef:'A001',offerId:'percentage',status:'confirmed'},{receiptId:'both',accountRef:'A001',offerId:'cash',status:'confirmed'}]}});assert.equal(result(m,both).destination,'Bin');assert.equal(both.usage(cash).used,true);
 const cashOnly=context({accounts:ids,snapshot:{promos:[{...promo,receiptState:'unused'},cash]},finance:{receipts:[r],offerReceiptMatches:[{receiptId:'both',accountRef:'A001',offerId:'cash',status:'confirmed'}]}});assert.equal(result(m,cashOnly).destination,'Bin');
}
// Latest email is retained globally; Inbox wins ties so repeat plans are stable.
const older={accountId:'local',path:['INBOX'],nativeId:1,raw:'original-1',message},newer={...older,nativeId:2,raw:'original-2',message:{...message,messageId:'2@uber.com',sentAt:'2026-01-03T12:00:00Z'}},archived={...newer,path:['Archive'],nativeId:3};
assert.equal(campaignWinner(older,newer),newer);assert.equal(campaignWinner(newer,archived),newer);
assert.equal(finalizeMailDecision(older,result(),archived).destination,'Archive');assert.equal(finalizeMailDecision(archived,result(),archived).destination,'Inbox');
const preview=cleanupPreview([older,newer,archived],new Map(),context());assert.equal(preview.targets.length,1);assert(preview.targets.every(t=>t.destination==='Archive'));assert.equal(preview.alreadyAtDestination,2);
const usedAccount={canLogin:true,accountStatus:'active',orderCount:5};const newOffer={service:'Uber Eats',trackingState:'available',uses:5,usesRemaining:5,usesVerified:true,expiresAt:'2099-01-10T23:59:59Z',expiryStatus:'exact'};assert.equal(classifyAccount(usedAccount,[newOffer]).recommendationEligible,true,'New usable offer restores readiness without clearing account usage');
console.log('✓ Reviewed Mail rules: access-specific exclusions, every Ride promo, source-linked use/unknown/expiry, all Eats percentages with Cash, no double-counting, campaign duplicate winners, receipt filing and renewed readiness.');

const coded={...message,body:message.body.replace('Valid until','Use code EATS12. Valid until')},cp=parseUberPromo(coded),co={...offer,...cp,id:'coded',accountRef:'A001',firstEmailSentAt:base.sentAt,expiryStatus:'exact',usesVerified:true,minimumSpendVerified:true,receiptState:'used'};const ca={...accounts,offerIdMigrations:[...accounts.offerIdMigrations,{from:offerFingerprint({...cp,accountRef:'A001'}),to:'coded'}]};const cc=context({accounts:ca,snapshot:{promos:[co]},finance:{receipts,offerReceiptMatches:matches.map(m=>({...m,offerId:'coded'}))}});assert.equal(result(coded,cc).destination,'Inbox');assert.equal(result({...coded,body:coded.body.replace('10 January','15 January')},cc).category,'review','Reused code with another validity window is a new campaign, not a duplicate');

assert.equal(mailIdentityExclusion({...base,subject:'You have £12 in Uber Cash waiting in your account',body:'Use promo code CASH12. Offer expires in 2026. Unsubscribe.'}),null,'Promo codes and years are not login codes');assert.equal(mailIdentityExclusion({...base,subject:'Book a table on Uber Eats and get a free ride',body:'Your promotional code TABLE26 expires 2026. Unsubscribe.'}),null);assert.equal(mailIdentityExclusion({...base,subject:'Your Uber code',body:'123 456 is your Uber code.'}),'excluded_login_code');assert.equal(mailIdentityExclusion({...base,subject:'Sign in to Uber',body:'Use code 123456.'}),'excluded_login_code');

for(const subject of ['Explore new restaurants on Uber Eats 🍽','One app, endless deals: meals and more','What are you in the mood for?','Delicious meals for less'])for(const recipient of ['a@icloud.com','b@icloud.com','c@icloud.com'])assert.equal(result({...base,recipient,subject,body:'Browse nearby restaurants. Order now. Unsubscribe.'}).destination,'Bin');
assert.equal(result({...base,subject:'Explore new restaurants on Uber Eats',body:'Get £12 off your next 5 Uber Eats orders. Minimum spend £15. Valid until 10 January 2026. Unsubscribe.'}).category,'retain_one_expired_unknown_offer','A real expired offer in the fine print retains its latest source, rather than being treated as generic marketing');
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
for(const subject of ['Crowd favourites, delivered'])assert.equal(explicitMailDecision({...base,subject,body:'Get £12 off your next 5 Uber Eats orders. Minimum spend £15. Use promo code PERSONAL12. Valid until 20 November 2026. Other shopping deals: discount percentage varies per item.'},Date.parse('2026-11-06')),null,'Mixed personal offers must stay protected');
assert.equal(explicitMailDecision({...base,subject:'Turn takeaways into getaways',body:'Link your British Airways Club account to collect Avios on orders. Unsubscribe.'}).destination,'Bin');
assert.equal(explicitMailDecision({...base,subject:'4 weeks free! Try Uber One and start saving.',body:'Sign up for a free trial. Membership benefits on eligible orders and rides. Unsubscribe.'}).destination,'Bin');
assert.equal(explicitMailDecision({...base,subject:'Earn Uber One credits thanks to Uber One',body:'Take a ride. Earn credits on eligible rides. Unsubscribe.'}).destination,'Bin');
console.log('✓ Restaurant discovery, item-level shopping discounts, Avios and membership adverts bin; personal offers in mixed messages remain protected.');
// Later owner additions: discard £15 off £25; discard old percentage emails by age,
// without pretending that an active or unknown expiry is confirmed expired.
const reviewNow=Date.parse('2026-11-07T12:00:00Z');
const fixed1525={...base,sentAt:'2026-11-06T12:00:00Z',subject:'Save £15 on groceries',body:'Get £15 off your next Uber Eats order of £25 or more. Minimum spend £25. Use code GROCERY15. Valid until 20 November 2026.'};assert.equal(explicitMailDecision(fixed1525,reviewNow).category,'owner_excluded_grocery');
const oldPercent={...base,sentAt:'2026-10-06T12:00:00Z',subject:'50% off Uber Eats',body:'Get 50% off your next 5 Uber Eats orders. Minimum spend £15. Maximum discount £12. Valid until 20 November 2026.'};assert.equal(explicitMailDecision(oldPercent,reviewNow).category,'old_eats_percentage_email');assert.equal(explicitMailDecision({...oldPercent,body:oldPercent.body.replace(' Valid until 20 November 2026.','')},reviewNow).category,'old_eats_percentage_email');assert.equal(explicitMailDecision({...oldPercent,sentAt:'2026-10-20T12:00:00Z'},reviewNow),null);assert.equal(explicitMailDecision({...oldPercent,sentAt:null,receivedAt:null},reviewNow),null);
for(const subject of ['Half off your favourite burger','30% off autumn favourites',"See this week's top shopping deals 📲","See this week's top shopping offers 📲",'Budget-friendly bites'])assert.equal(explicitMailDecision({...base,sentAt:'2026-11-06',subject,body:'Explore merchant deals. Order now. Unsubscribe.'},reviewNow).destination,'Bin');
assert.equal(explicitMailDecision({...fixed1525,subject:'Your Uber Eats receipt',body:'Thanks for your order. Receipt total £1.00. Promotion £15.00. Minimum spend £25.'},reviewNow),null);assert.equal(explicitMailDecision({...fixed1525,body:fixed1525.body.replace('of £25 or more','of £15 or more').replace('Minimum spend £25','Minimum spend £15')},reviewNow).destination,'Bin');
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

// Owner's broader categories and selected-restaurant exception, 8 November.
for(const subject of ["Happy Diwali at Uber Eats ✨","Your shortcut for spooky season 🎃","No tricks, just treats on Uber Eats 🎃","£10 off A'la Pizza","See what's trending at Waitrose Stratford City and more!","Save £11 on groceries","Fuel up the squad 🍕","Not ordered in a while? Let us treat you","Member Days: Deal drop 2 inside...","We've updated our Terms & Conditions","Earn 10% Uber One credit","4-for-2 at Burger King? That's a win 🏆","🚗 Loved ones on the go? Take charge","Uber One Exclusive: 40% off top picks 🔥","Info about cancellation and wait time policies","Uber One Exclusive: 40% off","Say hello to Uber Electric","Get to the airport with ease ✈️","Make your next work trip a breeze 🛫","Whatever your plans or budget, order on Uber Eats","50% off all your local favourites"]){
 assert.equal(explicitMailDecision({...base,subject,body:'Explore deals on Uber Eats. Unsubscribe.'},reviewNow)?.destination,'Bin',subject);
}
assert.equal(explicitMailDecision({...base,subject:'Get £8 off your next order',body:'Get £8 off your next Uber Eats order. Minimum spend £25. Valid until 20 November 2026.'},reviewNow)?.destination,'Bin');
assert.equal(explicitMailDecision({...base,subject:'Unlock 25% off your next eats order',body:'Complete 2 orders of £15 or more to unlock your reward. Unsubscribe.'},reviewNow)?.destination,'Bin');
assert.equal(explicitMailDecision({...base,subject:'Left something behind?',body:'Send forgotten items with Courier. Unsubscribe.'},reviewNow)?.destination,'Bin');
for(const subject of ['A survey about your experience','Tell us what you think'])assert.equal(explicitMailDecision({...base,subject,body:'Complete our feedback survey. Unsubscribe.'},reviewNow)?.destination,'Bin');
assert.equal(explicitMailDecision({...base,subject:'Share your opinion',body:'Complete the survey and receive a £5 voucher for your time.'},reviewNow)?.category,'keep_rewarded_survey');
assert.equal(explicitMailDecision({...base,subject:'Share your opinion',body:'Enter a prize draw for a chance to win a £50 voucher.'},reviewNow)?.ownerQuestion,true);
for(const [subject,discount]of [['£12 off 5 orders is still yours to enjoy. 🍛 🍝','£12'],['Get 40% off your next 5 orders','40%']])assert.equal(explicitMailDecision({...base,sentAt:'2026-11-08',subject,body:`Get ${discount} off your next 5 Uber Eats orders. Minimum spend £15. Valid on orders from selected restaurants. Valid until 20 November 2026.`},reviewNow),null,'Personal selected-restaurant offer stays eligible');
for(const subject of ['Your Uber One receipt','Your Bonfire Night receipt','Your grocery receipt'])assert.equal(explicitMailDecision({...base,subject,body:'Thanks for your order. Subtotal £15. Total paid £3.00.'},reviewNow),null);
assert.equal(explicitMailDecision({...base,subject:'Your Uber One payment failed',body:'Please update your payment details.'},reviewNow).category,'protected_transaction_notice');
assert.equal(explicitMailDecision({...base,subject:'Your Uber verification code',body:'123456 is your Uber code. Grocery offers are available.'},reviewNow),null);
assert.equal(explicitMailDecision({...base,subject:'Phone number updated',body:'Your phone number has changed. Diwali offers are available.'},reviewNow),null);
console.log('✓ Broader owner exclusions; rewardless versus rewarded surveys; ask-before-moving unclear incentives; personal selected-restaurant exception; receipt, billing and identity protection.');

for(const subject of ["Order confirmation from Morrisons - Stratford","Your order from ASDA Superstore - Isle of Dogs has been cancelled"]){const d=explicitMailDecision({...base,subject,body:'Your order has been received. Groceries from your selected store.'},reviewNow);assert.equal(d.destination,null);assert.equal(d.category,'protected_transaction_notice');}
assert.equal(explicitMailDecision({...base,subject:'Help us improve',body:'Take our quick survey. There is no reward for participation.'},reviewNow)?.destination,'Bin');

// Owner decision: keep exactly one source per expired personal campaign without inventing usage.
const unknownContext=context({finance:{receipts,offerReceiptMatches:[]},snapshot:{promos:[{...offer,receiptState:null,receiptConfirmedUses:0}]}});
const unknownDecision=result(message,unknownContext);assert.equal(unknownDecision.destination,'Archive');assert.equal(unknownDecision.usageUnknown,true);
assert.equal(finalizeMailDecision(older,unknownDecision,archived).category,'duplicate_expired_unknown_offer');
assert.equal(finalizeMailDecision(archived,unknownDecision,archived).destination,'Archive');
const unmapped=context({snapshot:{promos:[]},finance:{receipts,offerReceiptMatches:[]}}),unmappedDecision=result(message,unmapped);assert.equal(unmappedDecision.destination,'Archive');assert.equal(unmappedDecision.family,unknownDecision.family);
const differentWindow=result({...message,body:message.body.replace('10 January','9 January')},unmapped);assert.equal(differentWindow.destination,'Archive');assert.notEqual(differentWindow.family,unknownDecision.family);
const unknownCoded={...message,body:message.body+' Use code SAVENOW.'};const codedEarlier=result(unknownCoded,unmapped),codedLater=result({...unknownCoded,body:unknownCoded.body.replace('10 January','9 January')},unmapped);assert.notEqual(codedEarlier.family,codedLater.family,'A reused code does not merge different expiry windows');
assert.equal(result({...message,body:'Get £12 off Uber Eats. Minimum spend £15.'},unmapped).destination,null,'Unknown expiry stays held');
assert.equal(result({...message,body:message.body.replace('10 January 2026','10 January')},unmapped).destination,null,'A missing source year is not sufficient for archival dedupe');
console.log('✓ Unknown-use expired personal offers: latest in Archive, duplicates only in Bin, no inferred usage, exact source dates, separate validity windows and protected uncertain dates.');

// Latest owner clarification: every offer for a confirmed inaccessible Uber account is binned, Cash included.
for(const [subject,body]of [['You have £12 in Uber Cash waiting in your account','Use your £12 Uber Cash balance. Unsubscribe.'],['Your personal promo is waiting','Open Uber to see your offer. Unsubscribe.'],['Get £12 off your next 5 orders','Get £12 off your next 5 Uber Eats orders. Minimum spend £15. Valid until 10 January 2026.'],['Eurostar offers for you','Discover Eurostar savings. Unsubscribe.']])assert.equal(result({...base,recipient:'b@icloud.com',subject,body}).destination,'Bin');
for(const subject of ['Payment received','Uber Cash credits added','Your refund is complete'])assert.notEqual(result({...base,recipient:'b@icloud.com',subject,body:'A transaction has been recorded.'}).destination,'Bin');
for(const [subject,body]of [['£10 off The Bagel Guys','Enjoy £10 off The Bagel Guys. Valid on one order from The Bagel Guys. Unsubscribe.'],['Daily deal: Save £10 at Boots and John Lewis 🎁','Save £10 on orders from Boots and John Lewis. Unsubscribe.'],["See what's trending at Co-Op Franchise St Katherines and more!",'Browse grocery offers. Unsubscribe.'],['Get ready for the school term 🎒','Sign up and link a Teen account to get £10 off a grocery order. Unsubscribe.'],['Maximise your ride savings with Uber One 💸','Get up to 10% Uber One credits. Unsubscribe.'],['Ibrahim, unlock an easier way to ride','Download the app for GPS ride tracking. Unsubscribe.'],["We've missed you! Enjoy an easy meal in a few taps.",'There are so many flavours to choose from. Browse restaurants. Unsubscribe.'],['Hungry again? Order your faves','Reorder and satisfy your cravings. Menu: 20% off at one local shop. Unsubscribe.']])assert.equal(result({...base,subject,body}).destination,'Bin');
assert.notEqual(result({...base,subject:'Hungry again? Order your faves',body:'Get £12 off your next 5 Uber Eats orders. Minimum spend £15. Valid until 15 January 2026. Unsubscribe.'}).destination,'Bin','A genuine personal offer in the same template stays protected');
console.log('✓ All inaccessible-account offers including Cash and Uber-issued Eurostar ads bin; receipt/credit/payment records stay protected; verified named-shop, grocery, prerequisite and discovery templates are excluded.');

// Prior explicit access confirmations remain useful for Mail only; a replacement roster does not erase them.
const historic={accountRef:'A999',email:'historical@icloud.com',canLogin:false,accessEvidence:{value:false,status:'imported',source:'access_list',recordedAt:'2026-11-02T18:23:39.376Z'}},histMessage={...base,recipient:historic.email,subject:'You have £20 in Uber Cash waiting in your account',body:'You have £20 in Uber Cash waiting in your account. Use it on your next Uber Eats orders. Unsubscribe.'};
assert.equal(result(histMessage,context({historicalAccess:[historic]})).destination,'Bin');
for(const row of [{...historic,accessEvidence:{...historic.accessEvidence,source:'inferred'}},{...historic,accessEvidence:{...historic.accessEvidence,status:'pending'}},{...historic,accessEvidence:{...historic.accessEvidence,value:null}},{...historic,accessEvidence:{...historic.accessEvidence,recordedAt:null}}])assert.equal(result(histMessage,context({historicalAccess:[row]})).destination,null);
assert.equal(context({historicalAccess:[{...historic,email:'a@icloud.com'}]}).byEmail.get('a@icloud.com').canLogin,true,'Current owner-confirmed access takes precedence over older false evidence');
assert.equal(accounts.accounts.length,3,'Historical access does not mutate the active roster');
console.log('✓ Historical explicit inaccessible-access evidence is honored only for Mail; inferred/pending/missing evidence is ignored and current roster confirmations win.');

for(const recipient of ['a@icloud.com','b@icloud.com','historical@icloud.com'])for(const subject of ['Do not share: 1234','1234']){const m={...base,recipient,subject,body:'1234 is your Uber code. Keep this code private.'};assert.equal(mailIdentityExclusion(m),'excluded_login_code');assert.notEqual(result(m,context({historicalAccess:[historic]})).destination,'Bin');}
assert.equal(mailIdentityExclusion({...base,subject:'2026',body:'Use promo code CASH2026 to get a £12 Uber Cash offer.'}),null);
console.log('✓ Numeric-only and Do not share authentication messages stay protected across current and historical access states; years and promo codes are not authentication codes.');
for(const recipient of ['a@icloud.com','b@icloud.com','historical@icloud.com']){const m={...base,recipient,subject:'Verify your Uber account email',body:'Confirm your email address using the verification link.'};assert.equal(mailIdentityExclusion(m),'excluded_login_link');assert.equal(result(m,context({historicalAccess:[historic]})).destination,null);assert.notEqual(result({...base,recipient,subject:'M, add a different payment method',body:'Please check the payment details for your account.'},context({historicalAccess:[historic]})).destination,'Bin');}
console.log('✓ Account email verification links and payment-action notices remain protected across current and historical login states.');

for(const recipient of ['a@icloud.com','b@icloud.com','historical@icloud.com'])assert.notEqual(result({...base,recipient,subject:'Uber One payment confirmation',body:'Your membership payment has been recorded.'},context({historicalAccess:[historic]})).destination,'Bin');

for(const recipient of ['a@icloud.com','b@icloud.com'])assert.equal(result({...base,recipient,subject:'Your Disney+ promo code is on its way',body:'Your Disney+ benefit code is being prepared.'}).destination,'Inbox');

// The owner's three-use example: both full and expired partial use retain the latest in Inbox.
for(const n of [2,3]){const p={...offer,uses:3,receiptState:n===3?'used':'partial'},c=context({snapshot:{promos:[p]},finance:{receipts,offerReceiptMatches:matches.slice(0,n)}}),d=result(message,c);assert.equal(d.destination,'Inbox');assert.equal(finalizeMailDecision(older,d,newer).destination,'Archive');assert.equal(finalizeMailDecision(newer,d,newer).destination,'Inbox');assert.equal(c.usage(p).count,n);}

// Missing private links cannot turn a previously used/partial campaign into unused.
for(const state of ['used','partial']){const p={...offer,receiptState:state},c=context({snapshot:{promos:[p]},finance:{receipts,offerReceiptMatches:[]}});assert.equal(c.usage(p).known,false);assert.notEqual(result(message,c).category,'expired_unused_offer');}

for(const subject of ['Dig in to up to £15 off','24 hours until your £ Uber voucher expires ⏳'])assert.equal(result({...message,subject},context()).category,'keep_owner_personal_teaser');
assert.equal(result({...message,subject:'Browse new deals'},context()).destination,'Bin');
