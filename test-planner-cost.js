import assert from 'node:assert/strict';
import {rankBasketPlans,matchesFulfilment} from './deal-intelligence.js';
const now=new Date().toISOString(),end=new Date(Date.now()+7*86400000).toISOString();
const accounts=Array.from({length:4},(_,i)=>({accountRef:'A90'+i,canLogin:true,accountStatus:'active'}));
const offers=accounts.map(a=>({...a,id:'plan-'+a.accountRef,service:'Uber Eats',discountType:'fixed',discount:12,minimumSpend:15,uses:5,usesRemaining:5,expiresAt:end,expiryStatus:'exact',trackingState:'available'}));
const ranked=(subtotal,opts={})=>rankBasketPlans(offers,subtotal,{accounts,now,...opts});
assert.equal(ranked(15).suggested.estimatedPay,4,'The default fee includes the first order');
let r=ranked(30);assert.equal(r.suggested.orderCount,2);assert.equal(r.suggested.estimatedPay,8);assert.equal(r.suggested.extraFees,2);assert.equal(r.suggested.grossSaving,24);assert.equal(r.suggested.checkoutFees,null);
assert.deepEqual(r.suggested.orders.map(o=>o.subtotal),[15,15]);assert.deepEqual(r.suggested.orders.map(o=>o.estimatedPay),[4,4]);assert.equal(new Set(r.suggested.orders.map(o=>o.accountRef)).size,2);
assert.equal(r.plans.find(p=>p.orderCount===1).estimatedPay,19);
r=ranked(45);assert.equal(r.suggested.orderCount,3);assert.equal(r.suggested.estimatedPay,12,'A cheaper three-order result wins over fewer orders');
r=ranked(30,{orderFeeEstimate:13});assert.equal(r.suggested.orderCount,1);assert.equal(r.suggested.estimatedPay,31);
r=ranked(30,{orderFeeEstimate:12});assert.equal(r.suggested.orderCount,1,'Fewer orders only break an equal-cost tie');
r=ranked(30,{orderFeeEstimate:0});assert.equal(r.suggested.estimatedPay,6);assert.equal(r.suggested.extraFees,0);
r=ranked(45,{orderFeeEstimate:1.335});assert.equal(Math.round(r.suggested.orders.reduce((n,o)=>n+o.estimatedPay,0)*100)/100,r.suggested.estimatedPay,'Per-account payments reconcile to the plan including rounding');
const wallets={A900:{balance:1,stacking:'supported',at:now}};
r=ranked(30,{wallets});assert.equal(r.suggested.orderCount,2,'Having a private wallet cannot replace a cheaper split with a single account');
wallets.A900.balance=25;r=ranked(30,{wallets});assert.equal(r.suggested.kind,'promo_cash');assert.equal(r.suggested.estimatedPay,0);
wallets.A900.stacking='unknown';r=ranked(30,{wallets});assert.equal(r.suggested.kind,'promo_cash');assert.equal(r.suggested.estimatedPay,0);assert.equal(r.suggested.conditional,true,'The cheapest conditional estimate must retain its compatibility warning');
wallets.A900.stacking='supported';r=ranked(30,{wallets,fees:{A900:2}});assert.equal(r.suggested.estimatedPay,0);assert.equal(r.suggested.checkoutFees,2);assert.equal(r.suggested.extraFees,0);assert.equal(r.suggested.cashUsed,20,'Recorded single-order fees included once');
assert.equal(rankBasketPlans([{...offers[0],discountType:'uberCash'}],30,{accounts,now}).suggested,null,'An email grant supplies no current balance');
assert.equal(ranked(30,{fulfilment:'pickup'}).suggested,null,'Standard promos default to Delivery only');
assert.equal(matchesFulfilment({...offers[0],discountType:'uberCash',restrictions:{fulfilment:'delivery_only'}},'pickup'),true,'Cash supports Pickup');
assert.equal(matchesFulfilment({...offers[0],restrictions:{fulfilment:'pickup_only'}},'delivery'),false,'Explicit source restrictions still apply');
assert.equal(matchesFulfilment({...offers[0],restrictions:{fulfilment:'pickup_only'}},'pickup'),true);
const pickup=ranked(30,{fulfilment:'pickup',wallets:{A900:{balance:12,stacking:'supported',at:now}}});
assert.equal(pickup.suggested.kind,'cash');assert.equal(pickup.suggested.estimatedPay,19);assert.equal(pickup.suggested.grossSaving,0,'Cash on an account cannot enable its Delivery coupon for Pickup');
assert.ok(pickup.plans.every(p=>p.kind==='cash'));
assert.equal(rankBasketPlans(offers.map(p=>({...p,restrictions:{fulfilment:'delivery_only'}})),30,{accounts,now,fulfilment:'pickup'}).suggested,null);
assert.equal(rankBasketPlans(offers.map(p=>({...p,canLogin:false})),30,{accounts:accounts.map(a=>({...a,canLogin:false})),now}).suggested,null);
for(const total of [15,30,45,60])for(const fee of [0,1,3,12]){
 const options=ranked(total,{orderFeeEstimate:fee,maxOrders:4}),expected=Math.min(...Array.from({length:Math.min(4,total/15)},(_,i)=>total-12*(i+1)+fee*(i+1)));
 assert.equal(options.suggested.estimatedPay,expected);
 assert.ok(options.plans.length<=4);const others=options.plans.slice(1);assert.ok(others.every((p,i)=>i===0||p.estimatedPay>=others[i-1].estimatedPay));
 for(const plan of options.plans){assert.equal(plan.orders.reduce((n,o)=>n+o.subtotal,0),total);assert.ok(plan.orders.every(o=>o.accountRef&&o.promo));}
}
console.log('✓ Lowest-cost ranking, distinct allocations, £1 default/zero/high fees, rounded account payments, verified/conditional Cash, recorded fees counted once and eligibility');

for (const count of [1,2,3]) {
 const result=ranked(15*count,{orderFeeEstimate:2,maxOrders:count});
 assert.equal(result.suggested.orderCount,count);
 assert.equal(result.suggested.extraFees,2*count,'£2 is charged once per recommended account, including the first');
 assert.deepEqual(result.suggested.orders.map(o=>o.extraFee),Array(count).fill(2));
 assert.deepEqual(result.suggested.orders.map(o=>o.estimatedPay),Array(count).fill(5));
 assert.equal(result.suggested.estimatedPay,5*count);
}
for(const total of [15,30,45,60])for(const fee of [0,2,3.33,12,13]) {
 const result=ranked(total,{orderFeeEstimate:fee,maxOrders:4});
 const expected=Math.min(...Array.from({length:Math.min(4,total/15)},(_,i)=>total-12*(i+1)+fee*(i+1)));
 assert.equal(result.suggested.estimatedPay,Math.round(expected*100)/100,'Manual fees participate in cheapest-plan ranking');
 for(const plan of result.plans)assert.equal(Math.round(plan.orders.reduce((n,o)=>n+o.estimatedPay,0)*100)/100,plan.estimatedPay);
}
const manualWallet={A900:{balance:19,stacking:'supported',at:now}};
r=ranked(30,{wallets:manualWallet,orderFeeEstimate:2,maxOrders:1});
assert.equal(r.suggested.cashUsed,19);assert.equal(r.suggested.estimatedPay,1,'Cash pays the basket and estimated fees before the remainder is computed');
r=ranked(30,{wallets:manualWallet,orderFeeEstimate:2,fees:{A900:3},maxOrders:1});
assert.equal(r.suggested.checkoutFees,3);assert.equal(r.suggested.extraFees,0);assert.equal(r.suggested.estimatedPay,2,'Recorded matching fees replace the manual estimate');
console.log('✓ Manual per-account fees: £2/£4/£6, zero and fractional fees, cheapest-plan ranking, reconciled payments and Cash, recorded-fee replacement');
