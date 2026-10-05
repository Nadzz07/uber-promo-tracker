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
  if (promo.id && excludedIds.has(promo.id)) return false;
  if (promo.receiptState === "used") return false;
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

export function rankPromosForSpend(
  promos = [],
  spend,
  {
    service = "all",
    accountRef = "all",
    excludedIds = [],
    accessibleOnly = true
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

  if (total == null || total <= 0) {
    return {
      eligible: false,
      reason: "Enter a basket subtotal above £0.",
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

  const step = total <= 120 ? 0.5 : 1;
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

  const plans = [];

  for (let count = 1; count <= orderLimit; count++) {
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
    alternatives: plans.slice(1, 4).map(plan => ({
      orderCount: plan.orderCount,
      netSaving: plan.netSaving,
      estimatedPay: plan.estimatedPay
    }))
  };
}
