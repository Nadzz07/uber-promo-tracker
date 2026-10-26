import {validateSyncReport} from './sync-report.js';
import { classifyOfferCompletion } from "./offer-state.js";
import { classifyAccount } from "./account-state.js";
import { publicOfferTitle } from "./public-promo.js";
import {RECEIPT_AMOUNT_KEYS,mergeReceiptAmounts} from './dashboard-data.js';

const forbidden = /^(?:deviceBackup|deviceRecovery|recoveryBackup|ciphertext|credentials|accessToken|apiKey|authorization|password|offerReceiptMatches|receiptMatchVersion|receiptMatchExportedAt|alias|email|accountAlias|code|promo_code|promoCode|recipient|sender|subject|body|bodyText|body_text|evidence|evidence_json|merchant|orderId|tripId|messageId|messageKey|mailbox|sourceMailbox|financialCorrection|financialEvents|financialEvidence|financialReview|financial_evidence_json|wallet|wallets|balance|currentCashBalance|manualNote|recordId|eventId|note)$/i;
const email = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const masked = /[a-z0-9._%+-]{0,2}…[a-z0-9._%+-]{0,2}@[a-z0-9.-]+\.[a-z]{2,}/gi;

// Email-derived Cash estimates are public aggregates, never private wallet
// verifications or source evidence. Reject extra keys at every nested level.
function cashKeys(value,allowed){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))throw Error('Invalid public Cash aggregate.');}
function cashEstimate(value,grant=false){
  cashKeys(value,['status','remaining','issued','issuedAt','expiresAt','allocation','recordedUsed',...(grant?['minimumSpend','excludesFees','restrictions']:[])]);
  if(value.recordedUsed!=null&&(!Number.isFinite(value.recordedUsed)||value.recordedUsed<0||value.recordedUsed>value.issued))throw Error('Invalid recorded Cash usage.');
  if(value.issuedAt!=null&&!Number.isFinite(Date.parse(value.issuedAt)))throw Error('Invalid Cash issue date.');
  if(!['estimated','exhausted','expired','needs_checking','duplicate'].includes(value.status))throw Error('Private or invalid Cash state in public snapshot.');
  if(!Number.isFinite(value.issued)||value.issued<=0||value.remaining!==null&&(!Number.isFinite(value.remaining)||value.remaining<0||value.remaining>value.issued))throw Error('Invalid public Cash amount.');
  if(value.status==='needs_checking'?value.remaining!==null:value.remaining===null)throw Error('Unknown Cash is not zero.');
  if(['expired','exhausted','duplicate'].includes(value.status)&&value.remaining!==0)throw Error('Closed Cash cannot be spendable.');
  if(value.status==='estimated'&&(!(value.remaining>0)||!Number.isFinite(Date.parse(value.expiresAt))))throw Error('Spendable Cash requires expiry evidence.');
  if(!['inferred_from_receipts','no_recorded_usage','source_needs_checking'].includes(value.allocation))throw Error('Invalid public Cash allocation label.');
  if(grant){cashKeys(value.restrictions,['stacking']);if(![null,'unknown','no_other_promotions','allowed','supported'].includes(value.restrictions.stacking))throw Error('Invalid Cash restriction.');if(!Number.isFinite(value.minimumSpend)||value.minimumSpend<0||typeof value.excludesFees!=='boolean')throw Error('Invalid Cash terms.');}
}

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
  validateSyncReport({...(payload.sync?.runs?{runs:payload.sync.runs}:{}),...(payload.sync?.scheduler?{scheduler:payload.sync.scheduler}:{})});
  for(const account of payload.accounts)if(account.cashSummary){const c=account.cashSummary;cashKeys(c,['status','remaining','expiresAt','hasUncertainty','grants']);if(!['estimated','exhausted','expired','needs_checking','none'].includes(c.status)||!Array.isArray(c.grants)||typeof c.hasUncertainty!=='boolean')throw Error('Invalid Cash summary.');c.grants.forEach(g=>cashEstimate(g,true));const total=Math.round(c.grants.filter(g=>g.status==='estimated').reduce((n,g)=>n+g.remaining,0)*100)/100;if(c.remaining!==(total>0?total:c.hasUncertainty?null:0))throw Error('Cash summary disagrees with grants.');}
  if ([1, 2].includes(payload.summary?.accountStatusVersion)) {
    const independent = payload.summary.accountStatusVersion === 2;
    const accounts = new Map();
    const offersByAccount=new Map();
    for(const p of payload.promos){if(!offersByAccount.has(p.accountRef))offersByAccount.set(p.accountRef,[]);offersByAccount.get(p.accountRef).push(p);}
    for (const account of payload.accounts) {
      if (!account.accountRef || accounts.has(account.accountRef)) throw new Error('Duplicate or missing account reference.');
      accounts.set(account.accountRef, account);
      if (account.accessStatus && !['accessible','inaccessible','pending'].includes(account.accessStatus)) throw new Error('Invalid login access state.');
      if (account.accessStatus && account.canLogin !== ({accessible:true,inaccessible:false,pending:null})[account.accessStatus]) throw new Error('Login access disagrees with verification state.');
      if (account.deactivated && account.canLogin) throw new Error('Deactivated accounts cannot be available for login.');
      if (independent && !['active', 'archived', 'deactivated'].includes(account.accountStatus)) throw new Error('Explicit account rotation status is required.');
      for (const field of ['orderCount', 'rideCount']) if (!Number.isInteger(account[field]) || account[field] < 0) throw new Error('Invalid receipt counter.');
      if(account.receiptReviewCount!=null&&(!Number.isInteger(account.receiptReviewCount)||account.receiptReviewCount<0||account.receiptReviewCount>account.orderCount+account.rideCount))throw Error('Invalid financial review counter.');
      const expected = classifyAccount(account, offersByAccount.get(account.accountRef)||[], payload.generatedAt);
      for (const field of [...(payload.summary.offerEligibilityVersion === 1 ? ['hasEligibleOffers'] : []), ...(independent ? ['archived', 'accountStatus', 'fullyUsedOfferCount', 'expiredUnusedOfferCount'] : []), 'accountUsed', 'accountUsedReason', 'accountState', 'activePromoCount', 'reviewOfferCount', 'needsReview', 'recommendationEligible']) {
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
    if(summary.financialBreakdown?.adjustmentsNeedingReview!=null&&summary.financialBreakdown.adjustmentsNeedingReview!==payload.accounts.reduce((n,a)=>n+(a.receiptReviewCount||0),0))throw Error('Financial review counters disagree with accounts.');
    for (const [field, count] of [
      ['knownAccounts', payload.accounts.length], ['accessibleAccounts', payload.accounts.filter(a => a.canLogin).length],
      ['inaccessibleAccounts', payload.accounts.filter(a => a.canLogin === false).length], ['availableAccounts', payload.accounts.filter(a => summary.offerEligibilityVersion === 1 ? a.hasEligibleOffers : a.recommendationEligible).length],
      ['usedAccounts', payload.accounts.filter(a => independent ? a.accountUsed : a.accountState === 'used').length], ['archivedAccounts', payload.accounts.filter(a => independent ? a.archived : a.accountState === 'archived').length],
      ['needsCheckingAccounts', payload.accounts.filter(a => a.accountState === 'needs_checking').length],
      ['trackedOrders', payload.accounts.reduce((n, a) => n + a.orderCount, 0)]
    ]) if (summary[field] !== count) throw new Error('Summary counter disagrees with accounts: ' + field);
    if (summary.offerEligibilityVersion === 1) {
      if (summary.readyToUseAccounts !== payload.accounts.filter(a => a.recommendationEligible).length ||
          summary.offerAttentionAccounts !== summary.availableAccounts - summary.readyToUseAccounts) throw new Error('Offer readiness counters disagree with accounts.');
      for (const account of payload.accounts) if (account.hasEligibleOffers !== (account.activePromoCount > 0)) throw new Error('Eligible offer flag disagrees with accounts.');
    }
    if (summary.pendingAccessAccounts != null && summary.pendingAccessAccounts !== payload.accounts.filter(a => a.canLogin == null).length) throw new Error("Pending access counter disagrees with accounts.");
    if (independent) {
      const completions = payload.promos.map(p => classifyOfferCompletion(p, payload.generatedAt));
      for (const [field, predicate] of [['fullyUsedOffers','fullyUsed'],['finishedExpiredOffers','finishedExpired'],['fullyConsumedOffers','consumed'],['expiredUnusedOffers','expiredUnused'],['partiallyUsedOffers','partiallyUsed']]) if (summary[field] !== completions.filter(c => c[predicate]).length) throw new Error('Finished offer counter disagrees with confirmed usage: ' + field);
    }
    if (summary.completedPromotions != null && summary.completedPromotions !== payload.promos.filter(p => classifyOfferCompletion(p, payload.generatedAt).consumed).length) throw new Error('Completed promotions disagree with receipt evidence.');
    if (summary.completedPromotions != null && summary.fullyUsedAccounts !== payload.accounts.filter(a => a.accountUsed).length) throw new Error('Fully used accounts disagree with receipts.');
    if (independent && summary.usedAccessibleAccounts !== payload.accounts.filter(a => a.accountUsed && a.canLogin).length) throw new Error('Used accessible counter disagrees with accounts.');
    for (const [summaryField, accountField] of [['totalSaved', 'totalSaved'], ['estimatedUberOneSavings', 'estimatedUberOneSavings'], ['estimatedTotalSaved', 'estimatedTotalSaved']]) {
      if (Math.abs(Number(summary[summaryField]) - payload.accounts.reduce((sum, a) => sum + Number(a[accountField] || 0), 0)) > 0.011) throw new Error('Savings summary disagrees with accounts.');
    }
  }
  if (payload.receiptActivity) {
    const activity=payload.receiptActivity;
    if(activity.amountVersion!=null&&activity.amountVersion!==1)throw Error('Unsupported public receipt amount version.');
    for (const rows of [payload.receiptActivity.days, payload.receiptActivity.months]) {
      if (!Array.isArray(rows) || rows.reduce((n,r)=>n+r.eats,0)!==payload.summary.trackedOrders || rows.reduce((n,r)=>n+r.rides,0)!==payload.summary.trackedRides || Math.abs(rows.reduce((n,r)=>n+r.saved,0)-payload.summary.totalSaved)>0.011) throw new Error('Receipt activity disagrees with verified receipt totals.');
      if(activity.amountVersion===1)for(const row of rows){
        cashKeys(row.amounts,['eats','rides']);
        for(const kind of ['eats','rides']){
          const amounts=row.amounts[kind];cashKeys(amounts,RECEIPT_AMOUNT_KEYS);
          for(const key of RECEIPT_AMOUNT_KEYS){
            const a=amounts[key];cashKeys(a,['value','known','total',...(key==='fees'?['complete']:[])]);
            if(!Number.isInteger(a.total)||a.total<0||a.total!==row[kind]||!Number.isInteger(a.known)||a.known<0||a.known>a.total||a.value!==null&&(!Number.isFinite(a.value)||a.value<0||a.value>1e12)||(!a.known?a.value!==(a.total?null:0):a.value===null))throw Error('Invalid public receipt amount coverage.');
            if(key==='fees'&&(!Number.isInteger(a.complete)||a.complete<0||a.complete>a.known))throw Error('Invalid public fee coverage.');
          }
        }
      }
    }
    if(activity.amountVersion===1)for(const month of activity.months)for(const kind of ['eats','rides']){
      const derived=mergeReceiptAmounts(activity.days.filter(day=>day.period.slice(0,7)===month.period).map(day=>day.amounts[kind]));
      for(const key of RECEIPT_AMOUNT_KEYS)for(const field of Object.keys(derived[key]))if(field==='value'?Math.abs((derived[key][field]??0)-(month.amounts[kind][key][field]??0))>.011:derived[key][field]!==month.amounts[kind][key][field])throw Error('Monthly receipt amounts disagree with daily aggregates.');
    }
  }
  for (const promo of [...payload.promos, ...history.records]) {
    if(promo.cashEstimate){if(promo.discountType!=='uberCash')throw Error('Cash estimate on a promotional discount.');cashEstimate(promo.cashEstimate);}
    if(promo.cashTerms){cashKeys(promo.cashTerms,['duration','unit','anchor','excludesFees']);if(promo.cashTerms.duration!=null&&(!Number.isFinite(promo.cashTerms.duration)||promo.cashTerms.duration<=0))throw Error('Invalid Cash duration.');if(promo.cashTerms.unit!=null&&!['days','weeks','months'].includes(promo.cashTerms.unit))throw Error('Invalid Cash duration unit.');if(promo.cashTerms.anchor!=null&&!['original_email','activation','unknown'].includes(promo.cashTerms.anchor))throw Error('Invalid Cash expiry anchor.');}
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
