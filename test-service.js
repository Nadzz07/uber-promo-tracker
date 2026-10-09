import assert from 'node:assert/strict';
import { parseUberPromoV2 } from './parser-v2/parser.js';
import { extractOfferDetails } from './parser-v2/discount.js';
import { classifyOfferTrackingState } from './offer-state.js';
import { applyOfferExpiryPolicy } from './offer-time.js';
import { offerFingerprint } from './identity.js';

const base = { sender: 'Uber Eats <offers@uber.com>', recipient: 'sample@example.com',
  sentAt: '2026-09-16T13:25:00Z', receivedAt: '2026-09-16T13:25:10Z' };
let passed=0;
function test(name,fn){fn();passed++;console.log('✓ '+name);}

test('fixed food coupons keep their primary value and service through percentage membership footers',()=>{
 const p=parseUberPromoV2({...base,subject:'£12 off your next 5 orders',body:'Get £12 off on 5 Uber Eats orders over £15. Uber One members get 6% cashback on rides and save 10% on eligible delivery fees.'});
 assert.equal(p.isPromo,true);assert.equal(p.service,'Uber Eats');assert.equal(p.discountType,'fixed');assert.equal(p.discount,12);assert.equal(p.uses,5);
});

test('food percentage coupons remain food when a subscription upsell follows them',()=>{
 const p=parseUberPromoV2({...base,subject:'50% off an Uber Eats order',body:'50% off your next order. Join Uber One for a free membership trial.'});
 assert.equal(p.isPromo,true);assert.equal(p.service,'Uber Eats');assert.equal(p.discount,50);
});

test('ride coupons stay rides despite later food and subscription cross-promotion',()=>{
 const p=parseUberPromoV2({...base,sender:'Uber <offers@uber.com>',subject:'40% off your next 3 rides',body:'40% off three trips, up to £10 per ride. Try Uber One for free delivery on Uber Eats.'});
 assert.equal(p.isPromo,true);assert.equal(p.service,'Uber');assert.equal(p.offerType,'ride_percentage_discount');assert.equal(p.perUseCap,10);
});

test('primary percentage discounts do not become Cash because a wallet footer follows them',()=>{
 const p=parseUberPromoV2({...base,subject:'50% off your next order',body:'Use 50% off an Uber Eats order. Legal example: £10 in Uber Cash is a separate wallet credit.'});
 assert.equal(p.isPromo,true);assert.equal(p.discountType,'percent');assert.equal(p.discount,50);
});

test('body trial headings identify genuine membership promotions',()=>{
 const p=parseUberPromoV2({...base,subject:'Try a free membership',body:'Uber One free trial for 3 months. Enjoy benefits on Uber Eats orders and rides.'});
 assert.equal(p.isPromo,true);assert.equal(p.service,'Uber One');
});

test('subscription headlines remain membership even if a later coupon or bonus is mentioned',()=>{
 const p=parseUberPromoV2({...base,subject:'Try Uber One free for 3 months',body:'Start your free trial. Members may receive £10 in Uber Cash for Uber Eats orders.'});
 assert.equal(p.isPromo,true);assert.equal(p.service,'Uber One');
});

test('secondary member discount terms cannot invent a quantified primary food offer',()=>{
 const p=parseUberPromoV2({...base,subject:'Explore your favourite food',body:'Uber Eats has restaurants near you. Uber One members save 10% on eligible orders.'});
 assert.equal(p.isPromo,false);assert.equal(p.rejectionReason,'secondary_discount_terms');
});

test('unpriced food marketing with a subscription footer remains private',()=>{
 const p=parseUberPromoV2({...base,subject:'Find your favourite restaurants',body:'Order on Uber Eats. Join Uber One to save on eligible deliveries. Each offer is subject to conditions.'});
 assert.equal(p.isPromo,false);assert.equal(p.rejectionReason,'no_usable_promo_terms');
});

test('future cashback earning is not a percentage order discount',()=>{
 const offer=extractOfferDetails('Get 6% cashback in Uber Cash on eligible trips with Uber One.');
 assert.equal(offer.discountType,null);assert.equal(offer.discount,null);
});

test('save percentage wording remains supported without a literal off token',()=>{
 const p=parseUberPromoV2({...base,subject:'Save 40% on your order',body:'Save 40% on an Uber Eats order, up to £10. Expires on 20 September 2026.'});
 assert.equal(p.isPromo,true);assert.equal(p.discountType,'percent');assert.equal(p.discount,40);
});

test('membership-restricted service headlines cannot claim verified account eligibility',()=>{
 const p=parseUberPromoV2({...base,subject:'Uber One members: £15 off your Uber Eats order',body:'This offer is available only to current members.'});
 assert.equal(p.isPromo,false);assert.equal(p.rejectionReason,'membership_eligibility_unconfirmed');
});

test('primary term selection uses position within and across discount formats',()=>{
 assert.equal(extractOfferDetails('Save 40% on your order. Later example: 50% off.').discount,40);
 assert.equal(extractOfferDetails('£12 off your order. Get £10 in Uber Cash when purchasing a gift card.').discountType,'fixed');
 assert.equal(extractOfferDetails('£12 in Uber Cash for food. £10 off is a separate example.').discountType,'uberCash');
});

test('classification corrections preserve expiry, family identity and receipt-complete state',()=>{
 const p=parseUberPromoV2({...base,subject:'£12 off your next 5 orders',body:'£12 off on 5 orders. Expires on 30 September 2026. Join Uber One for a free trial.'});
 const earlier={...p,accountRef:'A001',firstEmailSentAt:'2026-09-01T12:00:00Z'};
 const reminder={...earlier,emailSentAt:'2026-09-25T12:00:00Z'};
 assert.equal(offerFingerprint(earlier),offerFingerprint(reminder));
 assert.equal(applyOfferExpiryPolicy(earlier).expiresAt,applyOfferExpiryPolicy(reminder).expiresAt);
 assert.equal(classifyOfferTrackingState({...reminder,usesRemaining:0},{now:new Date('2026-09-26T12:00:00Z')}).trackingState,'used');
 assert.equal(classifyOfferTrackingState(reminder,{now:new Date('2026-10-01T12:00:00Z')}).trackingState,'expired');
});
console.log(`\n${passed} primary-service regression groups passed.`);
