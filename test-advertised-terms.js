import assert from 'node:assert/strict';
import {parseUberPromo} from './parser.js';
import {offerTitle,effectiveDiscountPercent} from './offer-details.js';
import {classifyOfferTrackingState,classifyOfferCompletion} from './offer-state.js';
import {offerEligible} from './account-state.js';
import {offerFingerprint} from './identity.js';
import {promotionActivity,normaliseManualStore,reconcileManualStore,setOfferDone,getOfferManualState,setOfferIgnored} from './manual-state.js';
import {openPrivateDb,ensureAccount,upsertMessage,upsertOffer,getOffers} from './private-db.js';
const input={sender:'Uber <uber@uber.com>',recipient:'test@example.invalid',subject:'Uber Eats offer',sentAt:'2026-10-10T12:00:00Z'};
const percent=parseUberPromo({...input,subject:'50% off your next 3 orders',body:'Uber Eats. Maximum £10 per order. Minimum basket £15. Ends 15 October 2026.'});
assert.equal(percent.isPromo,true);assert.equal(percent.discountType,'percent');assert.equal(percent.discount,50);assert.equal(percent.perUseCap,10);assert.equal(percent.minimumSpend,15);assert.equal(effectiveDiscountPercent(percent,30),33.33);
const fixed=parseUberPromo({...input,subject:'£12.60 off £15',body:'Save £12.60 off your Uber Eats order when you spend £15. Ends 15 October 2026.'});
assert.equal(fixed.isPromo,true);assert.equal(fixed.discountType,'fixed');assert.equal(fixed.discount,12.6);assert.equal(fixed.minimumSpend,15);assert.equal(offerTitle(fixed),'£12.6 off');assert.equal(effectiveDiscountPercent(fixed,15),84);assert.equal(effectiveDiscountPercent(fixed,10),null);
const catalogue='Order now Deals £0 delivery fee. £0.30 £0.33/L £1.85 £2.06/L 84% off Orange energy drink (900ml). £0.30 £2.14/kg £1.20 £8.57/kg 75% off Raspberry sandwich cookies. Order now.';
const product=parseUberPromo({...input,subject:'One app, endless deals: meals and more',body:catalogue});assert.equal(product.isPromo,false);assert.equal(product.rejectionReason,'product_deal_not_account_promotion');
const lucozade=parseUberPromo({...input,subject:'84% off Lucozade Orange',body:'Lucozade Orange energy drink (900ml). A discount on this product only.'});assert.equal(lucozade.isPromo,false);assert.equal(lucozade.rejectionReason,'product_deal_not_account_promotion');
assert.equal(parseUberPromo({...input,subject:'£12 off your next order',body:'Uber Eats minimum spend £15. '+catalogue}).isPromo,true,'Primary order coupon survives separate product tiles');
assert.equal(parseUberPromo({...input,subject:'Offers for you',body:'Explore deals in Uber Eats. Terms apply.'}).isPromo,false);
const missing={...fixed,trackingState:'available',sourceEvidenceStatus:'missing',expiresAt:'2026-10-15T23:59:59Z'};assert.equal(classifyOfferTrackingState(missing,{now:'2026-10-10T12:00:00Z'}).trackingState,'needs_checking');assert.equal(offerEligible({...missing,...classifyOfferTrackingState(missing,{now:'2026-10-10T12:00:00Z'})}),false);
assert.equal(offerFingerprint({...fixed,accountRef:'A001'}),offerFingerprint({...fixed,accountRef:'A001',emailSentAt:'2026-10-11T12:00:00Z'}),'Coded/campaign reminders retain identity');
console.log('✓ Explicit percentage/fixed titles, effective percentage kept separate, minimums/caps, catalogue exclusion, primary coupon, ambiguous terms, missing evidence and reminder identity');

for (const [subject,body,amount,min] of [
 ['£10 off a £20 grocery order','Uber Eats supermarket order coupon.',10,20],
 ['£15 off £15 at a supermarket','Valid on your next grocery order.',15,15],
 ['40% off an eligible Uber Eats order','Shop at participating supermarkets.',40,0]
]) { const p=parseUberPromo({...input,subject,body});assert.equal(p.isPromo,true);assert.equal(p.discount,amount);assert.equal(p.minimumSpend,min);assert.equal(p.evidence.discountScope,'order'); }
const mixed=parseUberPromo({...input,subject:'Deals today',body:catalogue+' Use your £10 off a £20 grocery order promotion. Minimum basket £20.'});assert.equal(mixed.isPromo,true);assert.equal(mixed.discountType,'fixed');assert.equal(mixed.discount,10);assert.equal(mixed.minimumSpend,20);
const selected=parseUberPromo({...input,subject:'50% off selected grocery products',body:'Only the featured items qualify.'});assert.equal(selected.isPromo,false);assert.equal(selected.rejectionReason,'product_deal_not_account_promotion');
const ambiguous=parseUberPromo({...input,subject:'50% off selected offers',body:'Uber Eats deals. Check the app for applicable terms.'});assert.equal(ambiguous.isPromo,true);assert.equal(classifyOfferTrackingState({...ambiguous,expiresAt:'2026-10-15T23:59:59Z'},{now:'2026-10-10T12:00:00Z'}).trackingState,'needs_checking');
assert.equal(parseUberPromo({...input,subject:'40% off your next Uber Ride',body:'Valid on your next trip.'}).service,'Uber');
assert.equal(parseUberPromo({...input,subject:'£12 Uber Cash for Uber Eats orders',body:'Use on your next grocery order.'}).isPromo,true);
console.log('✓ Grocery/supermarket order coupons, Ride and Cash retained; selected products excluded; mixed email selects genuine order offer; uncertain scope is reviewable');

assert.equal(parseUberPromo({...input,subject:'£12 off your next order',body:'Uber Eats.'}).evidence.usesBasis,'explicit_offer_terms');
const basketTerms=parseUberPromo({...input,subject:'£15 off popular picks',body:'Grocery favourites. £15 off expires 16 Oct 2026. Order must be a minimum of £25 before fees. Maximum discount is £15. Valid on 1 order(s) made via Uber or Uber Eats.'});
assert.equal(basketTerms.evidence.discountScope,'order');assert.equal(basketTerms.minimumSpend,25);assert.equal(basketTerms.maxSaving,15);
const restaurantTerms=parseUberPromo({...input,subject:'30% off local favourites',body:'30% off selected restaurants. Valid on orders placed via the Uber Eats app. Offer will be automatically applied to basket from a participating merchant.'});assert.equal(restaurantTerms.evidence.discountScope,'order');
const mixedThreshold=parseUberPromo({...input,subject:'What are you in the mood for?',body:'Egg restaurant 30% off select items. Tortilla 20% off £25+.'});assert.equal(mixedThreshold.discount,20);assert.equal(mixedThreshold.minimumSpend,25);assert.equal(mixedThreshold.evidence.discountScope,'order');
const cereal=parseUberPromo({...input,subject:'Grocery offers',body:'£15 off your next grocery order of £25+. Enjoy £15 off. £2 cereal for back to school. Order must be a minimum of £25 on food and drink per order.'});
assert.equal(cereal.isPromo,true);assert.equal(cereal.minimumSpend,25,'Explicit order minimum wins over an adjacent product price');
const adjacentPrice=parseUberPromo({...input,subject:'Grocery offers',body:'Enjoy £15 off. £2 cereal. Valid on your next Uber Eats order.'});assert.equal(adjacentPrice.minimumSpend,0,'Do not invent a basket minimum from a product price');
const flattenedPrice=parseUberPromo({...input,subject:'Grocery offers',body:'Enjoy £15 off £2 cereal. Valid on your next Uber Eats order.'});assert.equal(flattenedPrice.minimumSpend,0);
assert.equal(parseUberPromo({...input,subject:'£15 off £15',body:'Uber Eats coupon. Terms apply.'}).minimumSpend,15,'A standalone advertised subject threshold is preserved');
const fixedItem=parseUberPromo({...input,subject:'Grocery product deals',body:'£10 off £20 steak pack (500g).'});assert.equal(fixedItem.rejectionReason,'product_deal_not_account_promotion');
for(const plus of ['&#43;','&#x2b;']){
 const encoded=parseUberPromo({...input,subject:'Budget-friendly meals',body:'15% off £20'+plus+'. Uber Eats restaurant order discount.'});assert.equal(encoded.isPromo,true);assert.equal(encoded.minimumSpend,20);assert.equal(encoded.evidence.discountScope,'order');
 const encodedMixed=parseUberPromo({...input,subject:'Your takeout offer',body:'20% off £25'+plus+'. Also 20% off select items.'});assert.equal(encodedMixed.isPromo,true);assert.equal(encodedMixed.minimumSpend,25);assert.equal(encodedMixed.evidence.discountScope,'order');
}
assert.equal(parseUberPromo({...input,subject:'Uber Reserve offer',body:'Enjoy 20% off your next Reserve trip.'}).evidence.discountScope,'order');
const unknownAllowance={...fixed,uses:1,usesVerified:false,usesRemaining:0,receiptConfirmedUses:1,receiptState:'used',expiresAt:'2026-10-15T23:59:59Z'};
assert.equal(classifyOfferCompletion(unknownAllowance,'2026-10-10T12:00:00Z').consumed,false,'A default allowance does not prove all permitted uses were redeemed');
assert.equal(classifyOfferTrackingState(unknownAllowance,{now:'2026-10-10T12:00:00Z'}).trackingState,'needs_checking');
assert.equal(promotionActivity(normaliseManualStore({}),{...unknownAllowance,...classifyOfferTrackingState(unknownAllowance,{now:'2026-10-10T12:00:00Z'})},'2026-10-10T12:00:00Z').bucket,'needs_checking');
const db=openPrivateDb(':memory:');
try {
 const ref=ensureAccount(db,{alias:'correction@example.invalid',seenAt:input.sentAt}).accountRef;
 upsertMessage(db,{messageKey:'original-coupon',accountRef:ref,kind:'promo',accepted:true,bodyText:'Synthetic £15 order coupon.',parsedAt:input.sentAt});
 const prior={...fixed,accountRef:ref,messageKey:'original-coupon',observedLive:true,offerId:'old-coupon',evidence:{...fixed.evidence,discountPosition:0},minimumSpend:0};
 upsertOffer(db,prior,input.sentAt);
 const corrected={...prior,offerId:'corrected-coupon',minimumSpend:15};upsertOffer(db,corrected,input.sentAt);
 assert.deepEqual(getOffers(db).find(p=>p.offerId===corrected.offerId).previousOfferIds,['old-coupon']);
 const otherAnchor={...corrected,offerId:'another-discount',evidence:{...corrected.evidence,discountPosition:200}};upsertOffer(db,otherAnchor,input.sentAt);
 assert.deepEqual(getOffers(db).find(p=>p.offerId===otherAnchor.offerId).previousOfferIds,[],'A different advertised discount must not inherit a manual decision');
} finally {db.close();}
const oldManual={...fixed,id:'previous-coupon',uses:5,usesVerified:true,receiptConfirmedUses:2,usesRemaining:3,expiresAt:'2099-12-31T23:59:59Z'};
const correction={...oldManual,id:'corrected-coupon',minimumSpend:25,previousOfferIds:[oldManual.id]};
for(const action of [setOfferDone,setOfferIgnored]) {
 const store=action(normaliseManualStore({}),oldManual,true,input.sentAt),oldRecord=structuredClone(store.offers[oldManual.id]);
 const migrated=reconcileManualStore(store,[correction],input.sentAt);
 assert.deepEqual(migrated.offers[oldManual.id],oldRecord,'Original manual record stays unchanged');
 assert.equal(getOfferManualState(migrated,correction).forceDone,action===setOfferDone);assert.equal(getOfferManualState(migrated,correction).ignored,action===setOfferIgnored);
 assert.ok(getOfferManualState(migrated,correction).verificationConflict);assert.equal(getOfferManualState(migrated,correction).history.at(-1).type,'offer_terms_corrected');
 assert.strictEqual(reconcileManualStore(migrated,[correction],input.sentAt),migrated,'Correction migration is idempotent');
}
console.log('✓ Same-source term corrections preserve manual finish/ignore, timestamp and history; different discounts cannot inherit decisions');
