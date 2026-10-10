import { classifyOfferCompletion } from './offer-state.js';

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
    version: 3,
    offers:
      payload && typeof payload.offers === "object" && payload.offers
        ? { ...payload.offers }
        : {}
  };
}

export function getOfferManualState(store, promo) {
  const raw = store?.offers?.[promoStateKey(promo)] || {};

  return {
    manualUsesConsumed: asCount(raw.manualUsesConsumed, 0),
    receiptConfirmedBaseline: asCount(
      raw.receiptConfirmedBaseline,
      confirmedUses(promo)
    ),
    ignored: Boolean(raw.ignored),
    forceDone: Boolean(raw.forceDone),
    lastManualUseAt: raw.lastManualUseAt || null,
    updatedAt: raw.updatedAt || null,
    manualFinishedAt: raw.manualFinishedAt || null,
    verifiedAt: raw.verifiedAt || null,
    lastEvidenceUpdate: raw.lastEvidenceUpdate || null,
    lastEvidenceCount: raw.lastEvidenceCount ?? null,
    lastEvidenceTotal: raw.lastEvidenceTotal ?? null,
    verificationConflict: raw.verificationConflict || null,
    history: Array.isArray(raw.history) ? raw.history : []
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
  if (state.verificationConflict) return "needs_checking";
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
    manualFinishedAt: done ? updatedAt : state.manualFinishedAt,
    updatedAt,
    history: [...state.history, { type: done ? 'manually_finished' : 'manual_finish_undone', at: updatedAt, confirmedUses: confirmedUses(promo) }]
  };

  return safe;
}

export function promoForDecision(store, promo) {
  const remaining = effectiveRemainingUses(store, promo);
  const state = effectivePromoState(store, promo);

  return {
    ...promo,
    usesRemaining: remaining,
    receiptState: state === "used" ? "used" : promo.receiptState,
    canLogin: Boolean(promo.canLogin)
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
    effectiveState: effectivePromoState(store, promo),
    manualFinishedAt: state.manualFinishedAt,
    verifiedAt: state.verifiedAt,
    lastEvidenceUpdate: state.lastEvidenceUpdate,
    verificationConflict: state.verificationConflict,
    history: state.history
  };
}

// Only reconcile offers with private manual records. Receipt evidence comes from
// the deduplicated server projection; manual actions never create confirmations.
export function reconcileManualStore(store, promos, evidenceAt = new Date().toISOString()) {
  const keys = Object.keys(store?.offers || {});
  if (!keys.length) return store;
  const byId = promos instanceof Map ? promos : new Map(promos.map(p => [promoStateKey(p), p]));
  let next = store;
  for (const key of keys) {
    const promo = byId.get(key);
    if (!promo) continue;
    const state = getOfferManualState(store, promo);
    const count = confirmedUses(promo), total = Math.max(1, asCount(promo.uses, 1));
    let conflict = state.verificationConflict;
    if (state.lastEvidenceCount != null && count < state.lastEvidenceCount) conflict = 'Confirmed usage decreased. Review the updated evidence.';
    if (state.lastEvidenceTotal != null && total !== state.lastEvidenceTotal) conflict = 'The permitted use count changed. Review the offer terms.';
    if (state.forceDone && promo.reviewReasons?.includes('ambiguous_receipt_match')) conflict = 'A receipt could match more than one promotion.';
    const complete = classifyOfferCompletion(promo).consumed && !conflict;
    const newlyVerified = state.forceDone && complete && !state.verifiedAt;
    const migratedHistory = state.forceDone && !state.history.length;
    const history = migratedHistory ? [{type:"legacy_manual_finish", at:state.updatedAt, confirmedUses:state.receiptConfirmedBaseline}] : state.history;
    const changed = migratedHistory || newlyVerified || conflict !== state.verificationConflict || count !== state.lastEvidenceCount || total !== state.lastEvidenceTotal;
    if (!changed) continue;
    if (next === store) next = normaliseManualStore(store);
    next.offers[key] = { ...state, lastEvidenceCount: count, lastEvidenceTotal: total,
      lastEvidenceUpdate: evidenceAt, verificationConflict: conflict,
      verifiedAt: newlyVerified ? evidenceAt : state.verifiedAt,
      history: newlyVerified ? [...history, { type: 'completion_verified', at: evidenceAt, confirmedUses: count }] : history };
  }
  return next;
}

export function acknowledgeEvidenceReview(store, promo, at = new Date().toISOString()) {
  const next = rebaseOfferState(store, promo), key = promoStateKey(promo), state = next.offers[key];
  // An ambiguous receipt cannot be resolved by clicking a button. It needs a
  // corrected source match in a later snapshot before review can be acknowledged.
  if (promo.reviewReasons?.includes('ambiguous_receipt_match')) return store;
  next.offers[key] = { ...state, verificationConflict: null, lastEvidenceCount: confirmedUses(promo),
    lastEvidenceTotal: Math.max(1, asCount(promo.uses, 1)),
    history: [...state.history, { type: 'evidence_reviewed', at, confirmedUses: confirmedUses(promo) }] };
  return reconcileManualStore(next, [promo], at);
}

// One primary bucket per promotion; expiry and manual history remain available
// as supporting attributes. Account receipt usage is classified separately.
export function promotionActivity(store, promo, now = new Date()) {
  const manual = manualActivity(store, promo), completion = classifyOfferCompletion(promo, now);
  let bucket, status;
  if (manual.ignored) { bucket = 'ignored'; status = 'Ignored'; }
  else if (manual.verificationConflict) { bucket = 'needs_checking'; status = 'Needs checking'; }
  else if (completion.consumed) { bucket = 'completed'; status = 'Completed · Verified'; }
  else if (manual.forceDone || manual.effectiveState === 'used') { bucket = 'manual'; status = 'Manually finished · Unverified'; }
  else if (completion.finishedExpired) { bucket = 'finished_expired'; status = 'Finished · Expired'; }
  else if (completion.expiredUnused) { bucket = 'expired_unused'; status = 'Expired · Unused'; }
  else if (promo.trackingState === 'needs_checking') { bucket = 'needs_checking'; status = 'Needs checking'; }
  else if (completion.partiallyUsed) { bucket = 'partial'; status = 'Partially used'; }
  else { bucket = 'available'; status = 'Available'; }
  return { ...completion, ...manual, bucket, status };
}
