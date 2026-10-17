import {ukDateKey} from './offer-time.js';
const cents=value=>Math.round(Number(value)*100),money=value=>Math.round((value+Number.EPSILON)*100)/100;
const valid=n=>n!=null&&Number.isFinite(Number(n));

export function cashForOrder(wallet,promo,subtotal,discount,fee){
 if(!wallet||!(Number(wallet.balance)>0)||wallet.status==='needs_checking')return {used:0,conditional:false};
 if(promo&&(wallet.stacking==='unsupported'||promo.restrictions?.stacking==='no_other_promotions'))return {used:0,conditional:false};
 let merchandise=Math.max(0,money(subtotal-discount)),fees=fee,used=0;
 const grants=wallet.grants?.length?wallet.grants:[{remaining:Number(wallet.balance),minimumSpend:0,excludesFees:false,restrictions:{}}];
 for(const grant of grants){
  if(subtotal<Number(grant.minimumSpend||0)||promo&&grant.restrictions?.stacking==='no_other_promotions')continue;
  const take=money(Math.min(Number(grant.remaining)||0,Number(wallet.balance)-used,merchandise+(grant.excludesFees?0:fees)));
  if(take<=0)continue;used=money(used+take);const fromFood=Math.min(take,merchandise);merchandise=money(merchandise-fromFood);fees=money(Math.max(0,fees-(take-fromFood)));
 }
 return {used,conditional:Boolean(promo&&used>0&&wallet.stacking!=='supported'),basis:wallet.status==='verified'?'verified':'estimated'};
}

// Cost-aware counterpart to the existing offer splitter. One account can enter
// a plan only once, so its Cash cannot be spent by two orders. Identical offer
// curves are safely reduced to the maximum needed account count, retaining the
// largest usable balances. Distinct terms are never discarded by a top-N cap.
export function cashAwarePlans(promos,total,{accounts=[],wallets={},fees={},maxOrders=3,orderFeeEstimate=1,now=Date.now()}={},calculate){
 const target=cents(total);if(!(target>0)||target>100000)return [];
 const limit=Math.max(1,Math.min(4,Math.floor(Number(maxOrders)||3))),fee=money(Math.max(0,Number(orderFeeEstimate)||0)),byRef=new Map();
 for(const account of accounts){if(account.canLogin!==true||account.archived||['archived','deactivated'].includes(account.accountStatus))continue;byRef.set(account.accountRef,{...account,promos:[],wallet:null});}
 for(const promo of promos){if(promo.discountType==='uberCash'||promo.canLogin!==true)continue;if(!byRef.has(promo.accountRef)&&!accounts.length)byRef.set(promo.accountRef,{accountRef:promo.accountRef,accountMasked:promo.accountMasked,promos:[],wallet:null});byRef.get(promo.accountRef)?.promos.push(promo);}
 for(const a of byRef.values()){
  const w=wallets[a.accountRef];if(!w||!(Number(w.balance)>0))continue;
  if(w.status){if(!['estimated','verified','verified_reconciled'].includes(w.status)||!Number.isFinite(Date.parse(w.at))||Date.parse(w.at)>new Date(now).getTime())continue;a.wallet=w;}
  else if(Number.isFinite(Date.parse(w.at))&&Date.parse(w.at)<=new Date(now).getTime()&&(w.receiptCount==null||w.receiptCount===Number(a.orderCount||0)+Number(a.rideCount||0))&&![a.lastOrderAt,a.lastRideAt].some(at=>Date.parse(at)>Date.parse(w.at)||w.receiptCount==null&&/^\d{4}-\d{2}-\d{2}$/.test(at||'')&&at>=ukDateKey(w.at)))a.wallet=w;
 }
 const profile=p=>[p.discountType,p.discount,p.minimumSpend,p.perUseCap??p.maxSaving,p.restrictions?.stacking,p.restrictions?.fulfilment].join(':');
 const profiles=new Map();
 for(const a of byRef.values()){
  if(!a.promos.length&&!a.wallet)continue;
  const key=JSON.stringify([a.promos.map(profile).sort(),fees[a.accountRef]??null,a.wallet?.stacking||null,(a.wallet?.grants||[]).map(g=>[g.minimumSpend,g.excludesFees,g.restrictions?.stacking])]);
  if(!profiles.has(key))profiles.set(key,[]);profiles.get(key).push(a);
 }
 const candidates=[...profiles.values()].flatMap(rows=>rows.sort((a,b)=>Number(b.wallet?.balance||0)-Number(a.wallet?.balance||0)||a.accountRef.localeCompare(b.accountRef)).slice(0,limit));
 const quantum=target<=12000?50:target<=30000?100:500,allocations=new Set([target]);
 for(let n=quantum;n<target;n+=quantum)allocations.add(n);
 const critical=new Set([1]);
 const add=value=>{if(!valid(value))return;const n=cents(value);for(const d of [-1,0,1])if(n+d>0&&n+d<=target)critical.add(n+d);};
 for(const a of candidates){const cash=Number(a.wallet?.balance||0);add(cash-fee);for(const g of a.wallet?.grants||[])add(g.minimumSpend);
  for(const p of a.promos){add(p.minimumSpend);if(p.discountType==='fixed'){add(p.discount);add(Number(p.discount)+cash-fee);}else{const cap=Number(p.perUseCap??p.maxSaving);if(cap>0){add(cap*100/Number(p.discount));add(cap+cash-fee);}if(p.discount<100)add((cash-fee)/(1-Number(p.discount)/100));}}
 }
 // At a piecewise-linear optimum all but one order can sit on a term or
 // Cash boundary. Include complements of combined boundaries, so the free
 // remainder can belong to any account, not just the last account in the DP.
 let sums=new Set([0]);for(let count=1;count<limit;count++){const next=new Set();for(const before of sums)for(const n of critical)if(before+n<target)next.add(before+n);for(const n of next)allocations.add(target-n);sums=next;}
 for(const n of critical){allocations.add(n);if(target-n>0)allocations.add(target-n);}
 const values=[...allocations].filter(n=>n>0&&n<=target).sort((a,b)=>a-b),cached=new Map();
 function bestAt(a,spend){
  const key=a.accountRef+'|'+spend;if(cached.has(key))return cached.get(key);
  const basket=spend/100,known=spend===target&&valid(fees[a.accountRef])?Math.max(0,Number(fees[a.accountRef])):null,charged=known??fee,options=[];
  for(const p of [...a.promos,...(a.wallet?[null]:[])]){
   if(p?.minimumSpendVerified===false)continue;
   const c=p?calculate(p,basket):{eligible:true,saving:0};if(!c.eligible)continue;
   const cash=cashForOrder(a.wallet,p,basket,c.saving,charged),pay=money(Math.max(0,basket-c.saving+charged-cash.used));
   options.push({accountRef:a.accountRef,accountMasked:a.accountMasked||p?.accountMasked||null,promo:p,subtotal:basket,saving:c.saving,pay:money(basket-c.saving),checkoutFees:known,extraFee:known==null?charged:0,cashUsed:cash.used,cashRemaining:a.wallet?money(a.wallet.balance-cash.used):null,cashBasis:cash.basis||null,conditional:cash.conditional,estimatedPay:pay});
  }
  options.sort((a,b)=>a.estimatedPay-b.estimatedPay||a.cashUsed-b.cashUsed||b.saving-a.saving);const result=options[0]||null;cached.set(key,result);return result;
 }
 const dp=Array.from({length:limit+1},()=>new Map());dp[0].set(0,{estimatedPay:0,cashUsed:0,orders:[]});
 for(const account of candidates)for(let count=limit;count>=1;count--){
  for(const [spent,state]of [...dp[count-1]]){
   const left=target-spent;if(left<=0)continue;
   const choices=values.filter(n=>n<=left);if(!allocations.has(left))choices.push(left);
   for(const spend of choices){const order=bestAt(account,spend);if(!order)continue;
    const used=spent+spend,next={estimatedPay:money(state.estimatedPay+order.estimatedPay),cashUsed:money(state.cashUsed+order.cashUsed),orders:[...state.orders,order]},prior=dp[count].get(used);
    if(!prior||next.estimatedPay<prior.estimatedPay-.005||Math.abs(next.estimatedPay-prior.estimatedPay)<.005&&next.cashUsed<prior.cashUsed)dp[count].set(used,next);
   }
  }
 }
 return dp.slice(1).map(rows=>rows.get(target)).filter(Boolean).map(state=>{
  const grossSaving=money(state.orders.reduce((n,o)=>n+o.saving,0)),extraFees=money(state.orders.reduce((n,o)=>n+o.extraFee,0)),recorded=money(state.orders.reduce((n,o)=>n+(o.checkoutFees||0),0));
  return {...state,eligible:true,subtotal:Number(total),grossSaving,extraFees,checkoutFees:state.orders.some(o=>o.checkoutFees!=null)?recorded+extraFees:null,totalAfterPromosAndFees:money(Number(total)-grossSaving+extraFees+recorded),orderCount:state.orders.length,accountCount:state.orders.length,netSaving:money(grossSaving-extraFees-recorded),conditional:state.orders.some(o=>o.conditional),cashEstimated:state.orders.some(o=>o.cashUsed>0&&o.cashBasis==='estimated'),kind:state.orders.length>1?'split':state.cashUsed>0?grossSaving>0?'promo_cash':'cash':'promo'};
 });
}
