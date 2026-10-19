import { isOfferExpired, ukDateKey } from "./offer-time.js";
import {cashAwarePlans,cashForOrder} from './cash-planner.js';

function number(value) {
  if (value == null || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function remainingUses(promo) {
  const explicit = number(promo.usesRemaining);
  if (explicit != null) return Math.max(0, explicit);
  return Math.max(0, number(promo.uses) || 1);
}

function isAvailable(promo, excludedIds = new Set()) {
  if (!promo) return false;
  if (promo.needsReview || promo.trackingState === "needs_checking" ||
      promo.trackingState === "used" || promo.expiryStatus === "unknown" ||
      isOfferExpired(promo)) return false;
  if (promo.id && excludedIds.has(promo.id)) return false;
  if (promo.receiptState === "used" || promo.recommendationEligible === false || promo.trackingState === "expired") return false;
  if (remainingUses(promo) <= 0) return false;
  return true;
}

export function savingForSpend(promo, spend) {
  const amount = number(spend);

  if (amount == null || amount <= 0) {
    return {
      eligible: false,
      saving: 0,
      pay: amount == null ? null : amount,
      reason: "Enter a spend above £0."
    };
  }

  if (remainingUses(promo) <= 0 || promo.receiptState === "used") {
    return {
      eligible: false,
      saving: 0,
      pay: amount,
      reason: "This offer has already been used."
    };
  }

  const minimumSpend = Math.max(0, number(promo.minimumSpend) || 0);

  if (amount < minimumSpend) {
    return {
      eligible: false,
      saving: 0,
      pay: amount,
      reason: "Needs at least £" + minimumSpend.toFixed(2) + " spend."
    };
  }

  const discount = number(promo.discount);

  if (promo.discountType === "percent" && discount != null) {
    let saving = amount * (discount / 100);
    const cap = number(promo.perUseCap) ?? number(promo.maxSaving);

    if (cap != null) saving = Math.min(saving, cap);

    saving = roundMoney(Math.min(Math.max(0, saving), amount));

    return {
      eligible: true,
      saving,
      pay: roundMoney(amount - saving),
      effectivePercent: roundMoney((saving / amount) * 100),
      reason: cap != null
        ? discount + "% off, capped at £" + cap.toFixed(2) + " for this use."
        : discount + "% off for this use."
    };
  }

  if (promo.discountType === "fixed" && discount != null) {
    const saving = roundMoney(Math.min(Math.max(0, discount), amount));

    return {
      eligible: true,
      saving,
      pay: roundMoney(amount - saving),
      effectivePercent: roundMoney((saving / amount) * 100),
      reason: "£" + discount.toFixed(2) + " off this use."
    };
  }

  if (promo.discountType === "uberCash" && discount != null) {
    const saving = roundMoney(Math.min(Math.max(0, discount), amount));

    return {
      eligible: true,
      saving,
      pay: roundMoney(amount - saving),
      effectivePercent: roundMoney((saving / amount) * 100),
      reason: "Up to £" + discount.toFixed(2) + " nominal Uber Cash value."
    };
  }

  return {
    eligible: false,
    saving: 0,
    pay: amount,
    reason: "This offer has no calculable cash saving."
  };
}

export function matchesFulfilment(promo, mode='delivery') {
  if (promo?.discountType === 'uberCash') return true;
  const restriction=promo?.restrictions?.fulfilment;
  // Standard Eats discounts are Delivery only. An explicitly advertised
  // Pickup offer remains an exception; wallet funds do not broaden a coupon.
  if (restriction === 'pickup_only') return mode === 'pickup';
  return mode !== 'pickup';
}

export function rankPromosForSpend(
  promos = [],
  spend,
  {
    service = "all",
    accountRef = "all",
    excludedIds = [],
    accessibleOnly = false
  } = {}
) {
  const excluded = new Set(excludedIds);

  return promos
    .filter(promo => isAvailable(promo, excluded))
    .filter(promo => !accessibleOnly || promo.canLogin === true)
    .filter(promo => service === "all" || promo.service === service)
    .filter(promo => accountRef === "all" || promo.accountRef === accountRef)
    .map(promo => ({
      promo,
      calculation: savingForSpend(promo, spend)
    }))
    .filter(item => item.calculation.eligible && item.calculation.saving > 0)
    .sort((a, b) => {
      if (b.calculation.saving !== a.calculation.saving) {
        return b.calculation.saving - a.calculation.saving;
      }

      if (b.calculation.effectivePercent !== a.calculation.effectivePercent) {
        return b.calculation.effectivePercent - a.calculation.effectivePercent;
      }

      const aExpiry = a.promo.expires
        ? new Date(a.promo.expires + "T23:59:59").getTime()
        : Number.MAX_SAFE_INTEGER;
      const bExpiry = b.promo.expires
        ? new Date(b.promo.expires + "T23:59:59").getTime()
        : Number.MAX_SAFE_INTEGER;

      if (aExpiry !== bExpiry) return aExpiry - bExpiry;

      return remainingUses(b.promo) - remainingUses(a.promo);
    });
}

function accountCandidates(promos, subtotal, service, excludedIds, accessibleOnly) {
  const byAccount = new Map();

  for (const promo of promos) {
    if (!isAvailable(promo, excludedIds)) continue;
    if (accessibleOnly && promo.canLogin !== true) continue;
    if (service !== "all" && promo.service !== service) continue;
    if (!promo.accountRef) continue;

    if (!byAccount.has(promo.accountRef)) {
      byAccount.set(promo.accountRef, []);
    }

    byAccount.get(promo.accountRef).push(promo);
  }

  return [...byAccount.entries()]
    .map(([accountRef, accountPromos]) => {
      const fullSpend = rankPromosForSpend(accountPromos, subtotal, {
        service,
        accountRef,
        accessibleOnly
      })[0];

      const fallbackPotential = accountPromos.reduce((max, promo) => {
        const value =
          number(promo.maxTotalSaving) ??
          number(promo.maxSaving) ??
          number(promo.discount) ??
          0;
        return Math.max(max, value);
      }, 0);

      return {
        accountRef,
        accountMasked: accountPromos.find(p => p.accountMasked)?.accountMasked || null,
        promos: accountPromos,
        rankingValue: fullSpend?.calculation?.saving ?? fallbackPotential
      };
    })
    .sort((a, b) => b.rankingValue - a.rankingValue)
    .slice(0, 24);
}

function betterState(candidate, existing) {
  if (!existing) return true;
  if (candidate.grossSaving > existing.grossSaving + 0.005) return true;
  if (Math.abs(candidate.grossSaving - existing.grossSaving) <= 0.005) {
    return candidate.orders.length < existing.orders.length;
  }
  return false;
}

export function planBasketSplit(
  promos = [],
  subtotal,
  {
    service = "Uber Eats",
    maxOrders = 3,
    extraOrderFee = 0,
    excludedIds = [],
    accessibleOnly = true
  } = {}
) {
  const total = number(subtotal);
  const fee = Math.max(0, number(extraOrderFee) || 0);
  const orderLimit = Math.max(1, Math.min(4, Math.floor(number(maxOrders) || 3)));
  const excluded = new Set(excludedIds);

  if (total == null || total <= 0 || total > 1000) {
    return {
      eligible: false,
      reason: "Enter a basket subtotal above £0 and up to £1,000.",
      subtotal: total,
      orders: []
    };
  }

  const accounts = accountCandidates(
    promos,
    total,
    service,
    excluded,
    accessibleOnly
  );

  if (!accounts.length) {
    return {
      eligible: false,
      reason: "No usable offers are available.",
      subtotal: total,
      orders: []
    };
  }

  const step = total <= 120 ? 0.5 : total <= 300 ? 1 : 5;
  const wholeUnits = Math.floor(total / step);
  const remainder = roundMoney(total - wholeUnits * step);

  if (wholeUnits < 1) {
    const single = rankPromosForSpend(promos, total, {
      service,
      excludedIds,
      accessibleOnly
    })[0];

    if (!single) {
      return {
        eligible: false,
        reason: "No offer is eligible for this basket.",
        subtotal: total,
        orders: []
      };
    }

    return {
      eligible: true,
      subtotal: total,
      grossSaving: single.calculation.saving,
      extraFees: 0,
      netSaving: single.calculation.saving,
      estimatedPay: single.calculation.pay,
      orderCount: 1,
      accountCount: 1,
      benefitVsSingle: 0,
      orders: [{
        accountRef: single.promo.accountRef,
        accountMasked: single.promo.accountMasked || null,
        promo: single.promo,
        subtotal: total,
        saving: single.calculation.saving,
        pay: single.calculation.pay
      }]
    };
  }

  const dp = Array.from({ length: orderLimit + 1 }, () => new Map());
  dp[0].set(0, { grossSaving: 0, orders: [] });

  const bestFor = new Map();

  function bestForAccount(account, units) {
    const key = account.accountRef + "|" + units;
    if (bestFor.has(key)) return bestFor.get(key);

    const spend = roundMoney(units * step);
    const result = rankPromosForSpend(account.promos, spend, {
      service,
      accountRef: account.accountRef,
      accessibleOnly
    })[0] || null;

    bestFor.set(key, result);
    return result;
  }

  for (const account of accounts) {
    for (let count = orderLimit; count >= 1; count--) {
      const sources = [...dp[count - 1].entries()];

      for (const [spentUnits, state] of sources) {
        const unitsLeft = wholeUnits - spentUnits;
        if (unitsLeft <= 0) continue;

        for (let allocationUnits = 1; allocationUnits <= unitsLeft; allocationUnits++) {
          const best = bestForAccount(account, allocationUnits);
          if (!best) continue;

          const nextSpent = spentUnits + allocationUnits;
          const next = {
            grossSaving: roundMoney(state.grossSaving + best.calculation.saving),
            orders: state.orders.concat({
              accountRef: account.accountRef,
              accountMasked: account.accountMasked,
              promo: best.promo,
              subtotal: roundMoney(allocationUnits * step),
              saving: best.calculation.saving,
              pay: best.calculation.pay
            })
          };

          const existing = dp[count].get(nextSpent);
          if (betterState(next, existing)) {
            dp[count].set(nextSpent, next);
          }
        }
      }
    }
  }

  // Always evaluate the exact penny amount. Grid allocation can miss a minimum
  // such as £15.25 when the full basket is £15.25.
  const singleExact = rankPromosForSpend(promos, total, { service, excludedIds, accessibleOnly })[0];
  const plans = singleExact ? [{
    eligible: true, subtotal: total, grossSaving: singleExact.calculation.saving,
    extraFees: 0, netSaving: singleExact.calculation.saving,
    estimatedPay: singleExact.calculation.pay, orderCount: 1, accountCount: 1,
    orders: [{ accountRef: singleExact.promo.accountRef,
      accountMasked: singleExact.promo.accountMasked || null, promo: singleExact.promo,
      subtotal: total, saving: singleExact.calculation.saving, pay: singleExact.calculation.pay }]
  }] : [];

  for (let count = 1; count <= orderLimit; count++) {
    if (count === 1 && singleExact) continue;
    const state = dp[count].get(wholeUnits);
    if (!state) continue;

    const orders = state.orders.map(order => ({ ...order }));
    let grossSaving = state.grossSaving;

    if (remainder > 0 && orders.length) {
      const target = orders[orders.length - 1];
      const adjustedSubtotal = roundMoney(target.subtotal + remainder);
      const recalculated = savingForSpend(target.promo, adjustedSubtotal);

      grossSaving = roundMoney(
        grossSaving - target.saving + (recalculated.eligible ? recalculated.saving : target.saving)
      );

      target.subtotal = adjustedSubtotal;
      if (recalculated.eligible) {
        target.saving = recalculated.saving;
        target.pay = recalculated.pay;
      } else {
        target.pay = roundMoney(adjustedSubtotal - target.saving);
      }
    }

    const extraFees = roundMoney(fee * Math.max(0, orders.length - 1));
    const netSaving = roundMoney(grossSaving - extraFees);
    const estimatedPay = roundMoney(total - grossSaving + extraFees);

    plans.push({
      eligible: true,
      subtotal: total,
      grossSaving,
      extraFees,
      netSaving,
      estimatedPay,
      orderCount: orders.length,
      accountCount: new Set(orders.map(order => order.accountRef)).size,
      orders
    });
  }

  if (!plans.length) {
    return {
      eligible: false,
      reason: "No valid split can use the available offers for this basket.",
      subtotal: total,
      orders: []
    };
  }

  plans.sort((a, b) => {
    if (Math.abs(b.netSaving - a.netSaving) > 0.005) {
      return b.netSaving - a.netSaving;
    }
    return a.orderCount - b.orderCount;
  });

  const best = plans[0];
  const single = plans.find(plan => plan.orderCount === 1);

  return {
    ...best,
    benefitVsSingle: roundMoney(best.netSaving - (single?.netSaving || 0)),
    // Keep the allocations: an alternative must name the accounts and the
    // basket assigned to each one, not just its headline cost.
    alternatives: plans.slice(1, 4)
  };
}

// Compare the existing split calculation with the existing same-account Cash
// calculation. A saved wallet must never override a cheaper split. Unknown
// checkout fees remain null. The estimate applies to every order, including
// the first, and defaults to £1. Recorded fees replace
// estimates, and fees enter the calculation before verified Cash is deducted.
export function rankBasketPlans(promos = [], subtotal, {
  wallets = {}, accounts = [], fees = {}, fulfilment = 'delivery',
  maxOrders = 3, orderFeeEstimate = 1, now = new Date().toISOString(), requiredPromoId = null
} = {}) {
  if(number(subtotal)==null||Number(subtotal)<=0||Number(subtotal)>1000)return {suggested:null,plans:[],reason:'Enter a basket between £0.01 and £1,000.'};
  const perOrder = number(orderFeeEstimate);
  const perOrderFee = perOrder == null ? 1 : roundMoney(Math.max(0, perOrder));
  const usable=promos.filter(p=>isAvailable(p)&&matchesFulfilment(p,fulfilment));
  const candidates=cashAwarePlans(usable,subtotal,{accounts,wallets,fees,maxOrders,orderFeeEstimate:perOrderFee,now},savingForSpend);
  for (const option of rankCheckoutOptions(promos, subtotal, {wallets, accounts, fees, fulfilment, now, orderFeeEstimate:perOrderFee})) {
    candidates.push({eligible: true, kind: option.kind, conditional: option.conditional,
      subtotal: option.basket, grossSaving: option.promotionDiscount,
      extraFees: option.estimatedFee, checkoutFees: option.fees, cashUsed: option.cashUsed,
      estimatedPay: option.outOfPocket, orderCount: 1, accountCount: 1,
      netSaving: roundMoney(option.promotionDiscount-(option.fees??option.estimatedFee)),
      totalAfterPromosAndFees:roundMoney(option.basket-option.promotionDiscount+(option.fees??option.estimatedFee)),cashEstimated:option.cashBasis==='estimated',
      orders: [{accountRef: option.accountRef, accountMasked: option.promo?.accountMasked || null,
        promo: option.promo, subtotal: option.basket, saving: option.promotionDiscount,
        pay: roundMoney(option.basket - option.promotionDiscount),
        cashUsed: option.cashUsed, cashRemaining: option.cashRemaining,cashBasis:option.cashBasis,
        checkoutFees: option.fees, extraFee: option.estimatedFee, estimatedPay: option.outOfPocket}]
    });
  }
  if(requiredPromoId)for(let i=candidates.length-1;i>=0;i--)if(!candidates[i].orders.every(order=>(order.promo?.id||order.promo?.offerId)===requiredPromoId))candidates.splice(i,1);
  // Cost is primary. Fewer orders and conserving Cash break equal-cost ties.
  candidates.sort((a, b) => a.estimatedPay - b.estimatedPay || a.cashUsed - b.cashUsed || a.orderCount - b.orderCount);
  for (const plan of candidates) plan.key = plan.kind + ':' + plan.orders.map(o => [o.accountRef, o.promo?.id || 'wallet', o.subtotal].join('/')).join('|');
  const suggested = candidates[0];
  if (!suggested) return {suggested: null, plans: [], reason:'No eligible checkout option fits this basket and offer scope.'};
  // A few ordering strategies, rather than repeated accounts with the same
  // deal. Preserve conditional Cash comparisons, clearly labelled for review.
  const seen = new Set(), distinct = candidates.filter(plan => {
    const signature = [plan.kind, plan.orderCount, plan.grossSaving, plan.cashUsed, plan.estimatedPay, plan.conditional].join('|');
    if (seen.has(signature)) return false;
    seen.add(signature); return true;
  });
  return {suggested, plans: [suggested, ...distinct.filter(p => p.key !== suggested.key).slice(0, 3)]};
}

// Checkout compares sanitised grant estimates and private verified positions.
// Cash is a payment source, separate from promotional savings.
export function rankCheckoutOptions(promos=[],subtotal,{wallets={},accounts=[],fees={},fulfilment='delivery',orderFeeEstimate=null,now=new Date().toISOString()}={}) {
  const basket=number(subtotal);if(basket==null||basket<=0||basket>1000)return [];
  const result=[],byAccount=new Map(accounts.filter(a=>a.canLogin===true&&a.archived!==true&&a.accountStatus!=='archived'&&a.accountStatus!=='deactivated').map(a=>[a.accountRef,a]));
  const walletFor=ref=>{const w=wallets[ref],account=byAccount.get(ref);if(!w||!account||!Number.isFinite(Number(w.balance))||Number(w.balance)<0||!Number.isFinite(Date.parse(w.at))||Date.parse(w.at)>Date.parse(now))return null;
    if(w.status)return ['estimated','verified','verified_reconciled'].includes(w.status)?w:null;
    const count=Number(account.orderCount||0)+Number(account.rideCount||0);
    if(w.receiptCount!=null && w.receiptCount!==count)return null;
    if([account.lastOrderAt,account.lastRideAt].some(at=>at&&(Date.parse(at)>Date.parse(w.at)||w.receiptCount==null&&/^\d{4}-\d{2}-\d{2}$/.test(at)&&at>=ukDateKey(w.at))))return null;
    return w;};
  const add=(promo,ref,discount,cashUsed,kind,conditional=false)=>{const w=walletFor(ref),knownFee=number(fees[ref]),estimatedFee=knownFee==null?roundMoney(Math.max(0,number(orderFeeEstimate)||0)):0,fee=knownFee!=null&&knownFee>=0?knownFee:estimatedFee;const beforeCash=roundMoney(Math.max(0,basket-discount)+fee),cash=cashUsed>0?cashForOrder(w,promo,basket,discount,fee):{used:0,basis:null,conditional:false};const spent=cash.used;if(kind==='promo_cash'&&spent<=0)return;result.push({promo,accountRef:ref,basket,promotionDiscount:discount,cashUsed:spent,cashBasis:cash.basis,fees:knownFee!=null?fee:null,estimatedFee,outOfPocket:roundMoney(beforeCash-spent),cashRemaining:w?roundMoney(Number(w.balance)-spent):null,kind,conditional:spent>0&&(conditional||cash.conditional),estimated:knownFee==null,expires:promo?.expires||null,restriction:promo?.restrictions||null});};
  for(const item of rankPromosForSpend(promos.filter(p=>p.discountType!=='uberCash'&&matchesFulfilment(p,fulfilment)),basket,{service:'Uber Eats',accessibleOnly:true})) {const p=item.promo,ref=p.accountRef;if(accounts.length&&!byAccount.has(ref))continue;add(p,ref,item.calculation.saving,0,'promo');const w=walletFor(ref);if(w&&Number(w.balance)>0&&w.stacking!=='unsupported')add(p,ref,item.calculation.saving,Number(w.balance),'promo_cash',w.stacking!=='supported');}
  for(const [ref]of byAccount){const w=walletFor(ref);if(w&&Number(w.balance)>0)add(null,ref,0,Number(w.balance),'cash');}
  return result.sort((a,b)=>Number(a.conditional)-Number(b.conditional)||a.outOfPocket-b.outOfPocket||a.cashUsed-b.cashUsed||((a.promo?.discountType==='fixed'&&b.promo?.discountType==='fixed')?Number(a.promo.discount)-Number(b.promo.discount):0)||b.cashRemaining-a.cashRemaining||b.promotionDiscount-a.promotionDiscount||String(a.expires||'9999').localeCompare(String(b.expires||'9999'))||a.accountRef.localeCompare(b.accountRef));
}
