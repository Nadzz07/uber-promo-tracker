function asCount(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.floor(parsed));
}

export function promoStateKey(promo) {
  return String(
    promo?.id ||
    [
      promo?.accountRef,
      promo?.discountType,
      promo?.discount,
      promo?.minimumSpend,
      promo?.expires
    ].join("|")
  );
}

export function confirmedUses(promo) {
  const explicit = asCount(promo?.receiptConfirmedUses, -1);
  if (explicit >= 0) return explicit;

  const total = asCount(promo?.uses, 1);
  const remaining = asCount(promo?.usesRemaining, total);
  return Math.max(0, total - remaining);
}

export function serverRemainingUses(promo) {
  const total = Math.max(1, asCount(promo?.uses, 1));

  if (promo?.usesRemaining == null) {
    return Math.max(0, total - confirmedUses(promo));
  }

  return Math.min(total, asCount(promo.usesRemaining, total));
}

export function normaliseManualStore(payload = {}) {
  return {
    version: 2,
    offers:
      payload && typeof payload.offers === "object" && payload.offers
        ? { ...payload.offers }
        : {},
    accounts:
      payload && typeof payload.accounts === "object" && payload.accounts
        ? { ...payload.accounts }
        : {}
  };
}

export function getOfferManualState(store, promo) {
  const safe = normaliseManualStore(store);
  const raw = safe.offers[promoStateKey(promo)] || {};

  return {
    manualUsesConsumed: asCount(raw.manualUsesConsumed, 0),
    receiptConfirmedBaseline: asCount(
      raw.receiptConfirmedBaseline,
      confirmedUses(promo)
    ),
    ignored: Boolean(raw.ignored),
    forceDone: Boolean(raw.forceDone),
    lastManualUseAt: raw.lastManualUseAt || null,
    updatedAt: raw.updatedAt || null
  };
}

export function pendingManualUses(store, promo) {
  const state = getOfferManualState(store, promo);
  const receiptDelta = Math.max(
    0,
    confirmedUses(promo) - state.receiptConfirmedBaseline
  );

  return Math.max(0, state.manualUsesConsumed - receiptDelta);
}

export function effectiveRemainingUses(store, promo) {
  if (!promo) return 0;

  const state = getOfferManualState(store, promo);

  if (
    state.ignored ||
    state.forceDone ||
    promo.receiptState === "used"
  ) {
    return 0;
  }

  return Math.max(
    0,
    serverRemainingUses(promo) - pendingManualUses(store, promo)
  );
}

export function effectivePromoState(store, promo) {
  const state = getOfferManualState(store, promo);

  if (state.ignored) return "ignored";
  if (state.forceDone) return "used";
  if (promo?.receiptState === "used") return "used";
  if (effectiveRemainingUses(store, promo) <= 0) return "used";
  return "active";
}

function rebaseOfferState(store, promo) {
  const safe = normaliseManualStore(store);
  const key = promoStateKey(promo);
  const current = getOfferManualState(safe, promo);
  const pending = pendingManualUses(safe, promo);

  safe.offers[key] = {
    ...current,
    manualUsesConsumed: pending,
    receiptConfirmedBaseline: confirmedUses(promo)
  };

  return safe;
}

export function consumeManualUse(
  store,
  promo,
  usedAt = new Date().toISOString()
) {
  const safe = rebaseOfferState(store, promo);
  const key = promoStateKey(promo);
  const state = safe.offers[key];

  const available = Math.max(
    0,
    serverRemainingUses(promo) - state.manualUsesConsumed
  );

  if (state.ignored || state.forceDone || available <= 0) return safe;

  safe.offers[key] = {
    ...state,
    manualUsesConsumed: state.manualUsesConsumed + 1,
    lastManualUseAt: usedAt,
    updatedAt: usedAt
  };

  return safe;
}

export function undoManualUse(
  store,
  promo,
  updatedAt = new Date().toISOString()
) {
  const safe = rebaseOfferState(store, promo);
  const key = promoStateKey(promo);
  const state = safe.offers[key];

  if (state.manualUsesConsumed <= 0) return safe;

  safe.offers[key] = {
    ...state,
    manualUsesConsumed: state.manualUsesConsumed - 1,
    updatedAt
  };

  return safe;
}

export function setOfferIgnored(
  store,
  promo,
  ignored,
  updatedAt = new Date().toISOString()
) {
  const safe = rebaseOfferState(store, promo);
  const key = promoStateKey(promo);
  const state = safe.offers[key];

  safe.offers[key] = {
    ...state,
    ignored: Boolean(ignored),
    updatedAt
  };

  return safe;
}

export function setOfferDone(
  store,
  promo,
  done,
  updatedAt = new Date().toISOString()
) {
  const safe = rebaseOfferState(store, promo);
  const key = promoStateKey(promo);
  const state = safe.offers[key];

  safe.offers[key] = {
    ...state,
    forceDone: Boolean(done),
    updatedAt
  };

  return safe;
}

export function isAccountDone(store, accountRef) {
  const safe = normaliseManualStore(store);
  return Boolean(safe.accounts?.[accountRef]?.done);
}

export function setAccountDone(
  store,
  accountRef,
  done,
  updatedAt = new Date().toISOString()
) {
  const safe = normaliseManualStore(store);

  safe.accounts[accountRef] = {
    ...(safe.accounts[accountRef] || {}),
    done: Boolean(done),
    updatedAt
  };

  return safe;
}

export function promoForDecision(store, promo) {
  const remaining = effectiveRemainingUses(store, promo);
  const state = effectivePromoState(store, promo);

  return {
    ...promo,
    usesRemaining: remaining,
    receiptState: state === "used" ? "used" : promo.receiptState
  };
}

export function manualActivity(store, promo) {
  const pending = pendingManualUses(store, promo);
  const state = getOfferManualState(store, promo);

  return {
    pendingManualUses: pending,
    lastManualUseAt: state.lastManualUseAt,
    ignored: state.ignored,
    forceDone: state.forceDone,
    effectiveRemaining: effectiveRemainingUses(store, promo),
    effectiveState: effectivePromoState(store, promo)
  };
}
