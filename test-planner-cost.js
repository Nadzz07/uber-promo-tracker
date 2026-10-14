import assert from 'node:assert/strict';
import {rankBasketPlans} from './deal-intelligence.js';
const now=new Date().toISOString(),end=new Date(Date.now()+7*86400000).toISOString();
const accounts=Array.from({length:4},(_,i)=>({accountRef:'A90'+i,canLogin:true,accountStatus:'active'}));
const offers=accounts.map(a=>({...a,id:'plan-'+a.accountRef,service:'Uber Eats',discountType:'fixed',discount:12,minimumSpend:15,uses:5,usesRemaining:5,expiresAt:end,expiryStatus:'exact',trackingState:'available'}));
const ranked=(subtotal,opts={})=>rankBasketPlans(offers,subtotal,{accounts,now,...opts});
let r=ranked(30);assert.equal(r.suggested.orderCount,2);assert.equal(r.suggested.estimatedPay,7);assert.equal(r.suggested.extraFees,1);assert.equal(r.suggested.grossSaving,24);assert.equal(r.suggested.checkoutFees,null);
assert.deepEqual(r.suggested.orders.map(o=>o.subtotal),[15,15]);assert.deepEqual(r.suggested.orders.map(o=>o.estimatedPay),[3,4]);assert.equal(new Set(r.suggested.orders.map(o=>o.accountRef)).size,2);
assert.equal(r.plans.find(p=>p.orderCount===1).estimatedPay,18);
r=ranked(45);assert.equal(r.suggested.orderCount,3);assert.equal(r.suggested.estimatedPay,11,'A cheaper three-order result wins over fewer orders');
r=ranked(30,{extraOrderFee:13});assert.equal(r.suggested.orderCount,1);assert.equal(r.suggested.estimatedPay,18);
r=ranked(30,{extraOrderFee:12});assert.equal(r.suggested.orderCount,1,'Fewer orders only break an equal-cost tie');
r=ranked(30,{extraOrderFee:0});assert.equal(r.suggested.estimatedPay,6);assert.equal(r.suggested.extraFees,0);
r=ranked(45,{extraOrderFee:1.335});assert.equal(Math.round(r.suggested.orders.reduce((n,o)=>n+o.estimatedPay,0)*100)/100,r.suggested.estimatedPay,'Per-account payments reconcile to the plan including rounding');
const wallets={A900:{balance:1,stacking:'supported',at:now}};
r=ranked(30,{wallets});assert.equal(r.suggested.orderCount,2,'Having a private wallet cannot replace a cheaper split with a single account');
wallets.A900.balance=25;r=ranked(30,{wallets});assert.equal(r.suggested.kind,'promo_cash');assert.equal(r.suggested.estimatedPay,0);
wallets.A900.stacking='unknown';r=ranked(30,{wallets});assert.equal(r.suggested.kind,'cash');assert.equal(r.suggested.estimatedPay,5);assert.equal(r.plans.find(p=>p.kind==='promo_cash').conditional,true,'Unknown coverage cannot be suggested as verified');
wallets.A900.stacking='supported';r=ranked(30,{wallets,fees:{A900:2}});assert.equal(r.suggested.estimatedPay,0);assert.equal(r.suggested.checkoutFees,2);assert.equal(r.suggested.extraFees,0);assert.equal(r.suggested.cashUsed,20,'Recorded single-order fees included once');
assert.equal(rankBasketPlans([{...offers[0],discountType:'uberCash'}],30,{accounts,now}).suggested,null,'An email grant supplies no current balance');
assert.equal(ranked(30,{fulfilment:'pickup'}).suggested.orderCount,2);
assert.equal(rankBasketPlans(offers.map(p=>({...p,restrictions:{fulfilment:'delivery_only'}})),30,{accounts,now,fulfilment:'pickup'}).suggested,null);
assert.equal(rankBasketPlans(offers.map(p=>({...p,canLogin:false})),30,{accounts:accounts.map(a=>({...a,canLogin:false})),now}).suggested,null);
for(const total of [15,30,45,60])for(const fee of [0,1,3,12]){
 const options=ranked(total,{extraOrderFee:fee,maxOrders:4}),expected=Math.min(...Array.from({length:Math.min(4,total/15)},(_,i)=>total-12*(i+1)+fee*i));
 assert.equal(options.suggested.estimatedPay,expected);
 assert.ok(options.plans.length<=4);const others=options.plans.slice(1);assert.ok(others.every((p,i)=>i===0||p.estimatedPay>=others[i-1].estimatedPay));
 for(const plan of options.plans){assert.equal(plan.orders.reduce((n,o)=>n+o.subtotal,0),total);assert.ok(plan.orders.every(o=>o.accountRef&&o.promo));}
}
console.log('✓ Lowest-cost ranking, distinct allocations, £1 default/zero/high fees, rounded account payments, verified/conditional Cash, recorded fees counted once and eligibility');
