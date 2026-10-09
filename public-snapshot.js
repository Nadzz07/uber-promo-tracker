import { classifyAccount } from "./account-state.js";
import { publicOfferTitle } from "./public-promo.js";

const forbidden = /^(?:alias|email|accountAlias|code|promo_code|promoCode|recipient|sender|subject|body|bodyText|body_text|evidence|evidence_json|merchant|orderId|tripId|messageId|messageKey|mailbox|sourceMailbox)$/i;
const email = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const masked = /[a-z0-9._%+-]{0,2}…[a-z0-9._%+-]{0,2}@[a-z0-9.-]+\.[a-z]{2,}/gi;

export function assertPublicSnapshot(payload, history, privateValues = []) {
  function visit(value) {
    if (Array.isArray(value)) return value.forEach(visit);
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (forbidden.test(key)) throw new Error("Public snapshot contains a private field.");
        visit(child);
      }
    } else if (typeof value === "string" && email.test(value.replace(masked, ""))) {
      throw new Error("Public snapshot contains an unmasked email address.");
    } else if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error("Public snapshot contains a non-finite number.");
    }
  }
  if (!Array.isArray(payload?.promos) || !Array.isArray(payload?.accounts) || !Array.isArray(history?.records)) {
    throw new Error("Invalid public snapshot structure.");
  }
  visit(payload); visit(history);
  if (payload.summary?.accountStatusVersion === 1) {
    const accounts = new Map();
    for (const account of payload.accounts) {
      if (!account.accountRef || accounts.has(account.accountRef)) throw new Error('Duplicate or missing account reference.');
      accounts.set(account.accountRef, account);
      if (account.deactivated && account.canLogin) throw new Error('Deactivated accounts cannot be available for login.');
      for (const field of ['orderCount', 'rideCount']) if (!Number.isInteger(account[field]) || account[field] < 0) throw new Error('Invalid receipt counter.');
      const expected = classifyAccount(account, payload.promos.filter(p => p.accountRef === account.accountRef));
      for (const field of ['accountUsed', 'accountUsedReason', 'accountState', 'activePromoCount', 'reviewOfferCount', 'needsReview', 'recommendationEligible']) {
        if (expected[field] !== account[field]) throw new Error('Account status disagrees with offer/receipt evidence: ' + field);
      }
    }
    const ids = new Set();
    for (const promo of payload.promos) {
      if (!promo.id || ids.has(promo.id) || !accounts.has(promo.accountRef)) throw new Error('Duplicate offer or missing account.');
      ids.add(promo.id);
      if (promo.recommendationEligible !== accounts.get(promo.accountRef).recommendationEligible) throw new Error('Offer recommendation eligibility disagrees with account.');
      if (promo.usesRemaining < 0 || promo.usesRemaining > promo.uses || promo.receiptConfirmedUses < 0 || promo.receiptConfirmedUses > promo.uses) throw new Error('Invalid offer usage counter.');
      if (promo.trackingState === 'expired' && promo.closedReason !== 'expired') throw new Error('Expired offer cannot be described as receipt used.');
    }
    const summary = payload.summary;
    for (const [field, count] of [
      ['knownAccounts', payload.accounts.length], ['accessibleAccounts', payload.accounts.filter(a => a.canLogin).length],
      ['inaccessibleAccounts', payload.accounts.filter(a => !a.canLogin).length], ['availableAccounts', payload.accounts.filter(a => a.accountState === 'available').length],
      ['usedAccounts', payload.accounts.filter(a => a.accountState === 'used').length], ['archivedAccounts', payload.accounts.filter(a => a.accountState === 'archived').length],
      ['needsCheckingAccounts', payload.accounts.filter(a => a.accountState === 'needs_checking').length],
      ['trackedOrders', payload.accounts.reduce((n, a) => n + a.orderCount, 0)]
    ]) if (summary[field] !== count) throw new Error('Summary counter disagrees with accounts: ' + field);
    for (const [summaryField, accountField] of [['totalSaved', 'totalSaved'], ['estimatedUberOneSavings', 'estimatedUberOneSavings'], ['estimatedTotalSaved', 'estimatedTotalSaved']]) {
      if (Math.abs(Number(summary[summaryField]) - payload.accounts.reduce((sum, a) => sum + Number(a[accountField] || 0), 0)) > 0.011) throw new Error('Savings summary disagrees with accounts.');
    }
  }
  if (payload.receiptActivity) {
    for (const rows of [payload.receiptActivity.days, payload.receiptActivity.months]) {
      if (!Array.isArray(rows) || rows.reduce((n,r)=>n+r.eats,0)!==payload.summary.trackedOrders || rows.reduce((n,r)=>n+r.rides,0)!==payload.summary.trackedRides || Math.abs(rows.reduce((n,r)=>n+r.saved,0)-payload.summary.totalSaved)>0.011) throw new Error('Receipt activity disagrees with verified receipt totals.');
    }
  }
  for (const promo of [...payload.promos, ...history.records]) {
    if (promo.title !== publicOfferTitle(promo)) throw new Error("Public title must be built from offer fields.");
    if (promo.service !== "Uber Eats") throw new Error("Only Eats offers may be published.");
    if (/^demo-/i.test(promo.id || "")) throw new Error("Test records cannot be published.");
  }
  if (payload.demo === true || payload.source === "demo") throw new Error("Test data cannot be published.");
  const serialized = JSON.stringify([payload, history]).toLowerCase();
  for (const secret of privateValues.filter(Boolean)) {
    if (serialized.includes(String(secret).toLowerCase())) {
      throw new Error("Public snapshot contains private source data.");
    }
  }
  if (payload.generatedAt && history.updatedAt !== payload.generatedAt) {
    throw new Error("Public snapshot and history are from different generations.");
  }
}
