function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
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

    const cap =
      number(promo.perUseCap) ??
      number(promo.maxSaving);

    if (cap != null) saving = Math.min(saving, cap);

    saving = Math.min(saving, amount);
    saving = roundMoney(Math.max(0, saving));

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
  { service = "all", accountRef = "all" } = {}
) {
  return promos
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

      return Number(b.promo.uses || 1) - Number(a.promo.uses || 1);
    });
}
