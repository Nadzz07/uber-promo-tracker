import {recordSyncRun,validateSyncReport} from './sync-report.js';
import fs from "node:fs/promises";
import { backupPrivateDb, compressPrivateBackup } from "./private-backup.js";
import path from "node:path";
import { parserFingerprint } from "./parser-fingerprint.js";
import { assertPublicSnapshot } from "./public-snapshot.js";
import { parseAccessList } from "./access-list.js";
import { eligibleAccountCounts, classifyAccount } from "./account-state.js";
import { isOfferExpired } from "./offer-time.js";
import { parseUberPromo } from "./parser.js";
import { parseUberEatsReceipt } from "./receipt-parser.js";
import { parseUberTransportReceipt } from "./transport-receipt-parser.js";
import { applyReceiptEvidence } from "./receipt-intelligence.js";
import { toPublicPromo } from "./public-promo.js";
import { combinedReceiptSavings, confirmedReceiptSaving } from "./savings-intelligence.js";
import { receiptActivity } from "./dashboard-data.js";
import {readFinancialEvents} from './financial-ledger.js';
import {currentFinancialEvents} from './receipt-financials.js';
import {reconstructCashEvidence} from './cash-reconstruction.js';
import { applyOfferTrackingStates, classifyOfferCompletion } from "./offer-state.js";
import {
  DEFAULT_PRIVATE_DB,
  ensureAccount,
  getAccounts,
  getAccountByAlias,
  getOffers,
  getPublicAccountInsights,
  getReceipts,
  getTransportReceipts,
  getSavingsSummary,
  openPrivateDb,
  reconcileOfferSources,
  reconcileEatsReceiptSources,
  reconcileTransportReceiptIdentities,
  replaceReceiptMatches,
  resetAccountAccess,
  setAccountAccess,
  updateOfferUsage,
  upsertMessage,
  upsertOffer,
  upsertReceipt,
  upsertTransportReceipt
} from "./private-db.js";
import {
  messageKey,
  publicOfferIdentity,
  offerFingerprint,
  receiptFingerprint,
  transportReceiptFingerprint
} from "./identity.js";

const parsingFingerprint = parserFingerprint();
const inputPath = process.argv[2] || "./emails.local.json";
const outputPath = process.argv[3] || "./promos.json";
const publicHistoryPath = process.argv[4] || "./history.json";
const privateDbPath = process.argv[5] || DEFAULT_PRIVATE_DB;
const accountAccessPath =
  process.env.TRACKER_ACCOUNT_ACCESS || "./account-access.local.csv";
const allowUnknownAccounts =
  /^(?:1|true|yes)$/i.test(process.env.TRACKER_ALLOW_UNKNOWN_ACCOUNTS || "");
const rebuildOfferSources =
  /^(?:1|true|yes)$/i.test(process.env.TRACKER_REBUILD_OFFER_SOURCES || "");
let successfulMailScanAt = null,completedScanReport=null;

function isExpired(promo) {
  return isOfferExpired(promo);
}

function attachAccountOfferContext(promos) {
  const groups = new Map();

  for (const promo of promos) {
    if (!promo.accountRef) continue;
    if (!groups.has(promo.accountRef)) groups.set(promo.accountRef, []);
    groups.get(promo.accountRef).push(promo);
  }

  for (const accountPromos of groups.values()) {
    const active = accountPromos.filter(promo =>
      promo.trackingState === "available" &&
      !isExpired(promo) &&
      promo.receiptState !== "used" &&
      Number(promo.usesRemaining ?? promo.uses ?? 1) > 0
    );

    const companions = active.filter(promo =>
      promo.discountType === "fixed" ||
      promo.discountType === "uberCash"
    );

    for (const promo of accountPromos) {
      promo.sameAccountOfferCount = active.length;
      promo.hasCompanionOffer =
        promo.discountType === "percent" &&
        companions.some(companion => companion.offerId !== promo.offerId);
    }
  }

  return promos;
}

function receiptStatsByAccount(receipts, rides) {
  return combinedReceiptSavings(receipts, rides).byAccount;
}

function historyStatus(promo) {
  if (promo.trackingState === "expired" || isExpired(promo)) return "expired";
  if (promo.trackingState === "used") return "used";
  if (promo.trackingState === "needs_checking") return "needs_checking";
  if (promo.receiptState === "used") return "used";
  if (isExpired(promo)) return "used";
  if (Number(promo.usesRemaining ?? promo.uses ?? 1) <= 0) return "used";
  return "active";
}

async function loadMessages(path) {
  const raw = JSON.parse(await fs.readFile(path, "utf8"));
  const messages = Array.isArray(raw) ? raw : raw.messages;
  if (!Array.isArray(raw) && Array.isArray(raw.mailboxes) && raw.mailboxes.some(m=>m.role==='promo') && raw.mailboxes.some(m=>m.role==='receipt')) {
    const at = Date.parse(raw.exportedAt);
    if (!Number.isFinite(at) || at > Date.now() + 5 * 60000) throw new Error('Invalid completed Mail scan time.');
    successfulMailScanAt = new Date(at).toISOString();
    completedScanReport={emailsChecked:Array.isArray(raw.scanStats?.checkedKeys)?new Set(raw.scanStats.checkedKeys).size:Number.isSafeInteger(raw.scanStats?.emailsChecked)?raw.scanStats.emailsChecked:null,scheduler:raw.schedulerReport||null};
    if(completedScanReport.scheduler)validateSyncReport({scheduler:completedScanReport.scheduler});
  }

  if (!Array.isArray(messages)) {
    throw new Error("Mail export must contain a message array.");
  }

  for (const [index, message] of messages.entries()) {
    if (!message || typeof message !== "object" || Array.isArray(message) ||
        ["subject", "body", "sender", "recipient"].some(key =>
          message[key] != null && typeof message[key] !== "string") ||
        ![message.sentAt, message.receivedAt].some(value =>
          value && Number.isFinite(new Date(value).getTime())) ||
        [message.sentAt, message.receivedAt].some(value =>
          value != null && !Number.isFinite(new Date(value).getTime()))) {
      throw new Error("Invalid Mail record at position " + (index + 1) + "; nothing imported.");
    }
  }
  return messages.map(message => ({ ...message,
    receivedAt: message.receivedAt || message.sentAt,
    sentAt: message.sentAt || message.receivedAt
  }));
}

async function loadAccountAllowlist() {
  if (allowUnknownAccounts) return null;

  try {
    const text = await fs.readFile(accountAccessPath, "utf8");
    return new Map(parseAccessList(text).map(record => [record.email.trim().toLowerCase(), record]));
  } catch (error) {
    if (error?.code === "ENOENT" && !process.env.TRACKER_ACCOUNT_ACCESS) return null;
    throw error;
  }
}

function accountAllowed(allowlist, alias) {
  if (!allowlist) return true;
  return allowlist.has(String(alias || "").trim().toLowerCase());
}

async function generatePromos() {
  const generatedAt = new Date().toISOString();
  const paths = [inputPath, outputPath, publicHistoryPath, privateDbPath].map(p => path.resolve(p));
  if (new Set(paths).size !== paths.length) throw new Error("Input, database and output paths must be distinct.");
  const messages = await loadMessages(inputPath);
  const accountAllowlist = await loadAccountAllowlist();
  const backup = backupPrivateDb(privateDbPath);
  if (backup) console.log("Consistent private database backup created before import.");
  const db = openPrivateDb(privateDbPath);
  let transaction = false;
  let skippedOutsideAccessList = 0;
  const temporaryFiles = [];
  const processedMessageKeys = new Set();
  const sourceFamilies = new Map();
  const transportSources = [];
  const eatsSources = [];
  try {
    db.exec("BEGIN IMMEDIATE");
    transaction = true;
    const beforeReceiptIds=new Set([...getReceipts(db),...getTransportReceipts(db)].map(r=>r.receiptId));
    const offerSignature=row=>JSON.stringify(Object.fromEntries(Object.entries(row).filter(([k])=>k!=='last_seen_at')));
    const beforeOffers=new Map(db.prepare('SELECT * FROM offers').all().map(row=>[row.offer_id,offerSignature(row)]));
    if (accountAllowlist) {
      resetAccountAccess(db);
      for (const record of accountAllowlist.values()) setAccountAccess(db, record.email, record.canLogin, record.loginMethod, record.accountStatus);
    }

    for (const email of messages) {
      const receipt = parseUberEatsReceipt(email);
      const key = messageKey(email);
      const sentAt =
        receipt.sentAt ||
        email.sentAt ||
        email.receivedAt ||
        generatedAt;

      if (receipt.isReceipt) {
        if (!accountAllowed(accountAllowlist, receipt.accountAlias)) {
          skippedOutsideAccessList++;
          continue;
        }

        const account = ensureAccount(db, {
          alias: receipt.accountAlias,
          seenAt: sentAt,
          kind: "receipt"
        });

        if (!account) continue;

        const storedReceipt = {
          ...receipt,
          reparsedSource: true,
          accountRef: account.accountRef,
          accountMasked: account.masked,
          canLogin: account.canLogin,
          messageKey: key
        };

        storedReceipt.receiptId = receiptFingerprint(storedReceipt);

        upsertMessage(db, {
          messageKey: key,
          messageId: email.messageId || receipt.messageId || null,
          accountRef: account.accountRef,
          kind: "receipt",
          mailbox: email.mailbox || receipt.mailbox || null,
          sender: email.sender || null,
          subject: email.subject || null,
          bodyText: email.body || null,
          sentAt,
          receivedAt: receipt.receivedAt,
          parserVersion: receipt.parserVersion,
          classification: "receipt",
          classificationConfidence: receipt.senderConfidence,
          accepted: true,
          rejectionReason: null,
          evidence: receipt.evidence,
          parsedAt: generatedAt
        });

        storedReceipt.receiptId=upsertReceipt(db, storedReceipt, generatedAt);
        eatsSources.push(storedReceipt);
        processedMessageKeys.add(key);
        continue;
      }

      const transportReceipt = parseUberTransportReceipt(email);

      if (transportReceipt.isReceipt) {
        if (!accountAllowed(accountAllowlist, transportReceipt.accountAlias)) {
          skippedOutsideAccessList++;
          continue;
        }

        const transportSentAt =
          transportReceipt.sentAt ||
          email.sentAt ||
          email.receivedAt ||
          generatedAt;

        const account = ensureAccount(db, {
          alias: transportReceipt.accountAlias,
          seenAt: transportSentAt,
          kind: "transport_receipt"
        });

        if (!account) continue;

        const storedTransportReceipt = {
          ...transportReceipt,
          reparsedSource: true,
          accountRef: account.accountRef,
          accountMasked: account.masked,
          canLogin: account.canLogin,
          messageKey: key
        };

        storedTransportReceipt.receiptId =
          transportReceiptFingerprint(storedTransportReceipt);

        upsertMessage(db, {
          messageKey: key,
          messageId: email.messageId || transportReceipt.messageId || null,
          accountRef: account.accountRef,
          kind: "transport_receipt",
          mailbox: email.mailbox || transportReceipt.mailbox || null,
          sender: email.sender || null,
          subject: email.subject || null,
          bodyText: email.body || null,
          sentAt: transportSentAt,
          receivedAt: transportReceipt.receivedAt,
          parserVersion: transportReceipt.parserVersion,
          classification: transportReceipt.transportMode,
          classificationConfidence: transportReceipt.senderConfidence,
          accepted: true,
          rejectionReason: null,
          evidence: transportReceipt.evidence,
          parsedAt: generatedAt
        });

        upsertTransportReceipt(db, storedTransportReceipt, generatedAt);
        transportSources.push(storedTransportReceipt);
        processedMessageKeys.add(key);
        continue;
      }

      const promo = parseUberPromo(email);

      if (!accountAllowed(accountAllowlist, promo.accountAlias)) {
        skippedOutsideAccessList++;
        continue;
      }

      const account = promo.isPromo ? ensureAccount(db, {
        alias: promo.accountAlias,
        seenAt: promo.emailSentAt || promo.receivedAt || sentAt,
        kind: "promo"
      }) : getAccountByAlias(db, promo.accountAlias);
      if (!account) continue;

      upsertMessage(db, {
        messageKey: key,
        messageId: email.messageId || promo.messageId || null,
        accountRef: account?.accountRef || null,
        kind: promo.isPromo ? "promo" : "other",
        mailbox: email.mailbox || promo.mailbox || null,
        sender: email.sender || null,
        subject: email.subject || null,
        bodyText: email.body || null,
        sentAt: promo.emailSentAt,
        receivedAt: promo.receivedAt,
        parserVersion: promo.parserVersion,
        classification: promo.offerType,
        classificationConfidence: promo.classificationConfidence,
        accepted: promo.isPromo,
        rejectionReason: promo.rejectionReason,
        evidence: promo.evidence,
        parsedAt: generatedAt
      });
      processedMessageKeys.add(key);

      if (!promo.isPromo || !account) continue;

      const storedPromo = {
        ...promo,
        accountRef: account.accountRef,
        accountMasked: account.masked,
        canLogin: account.canLogin,
        messageKey: key,
        source: "live_mail",
        observedLive: true
      };

      storedPromo.offerId = offerFingerprint(storedPromo);
      upsertOffer(db, storedPromo, generatedAt);
      if (rebuildOfferSources) {
        const sourceSentAt = storedPromo.emailSentAt || storedPromo.receivedAt;
        const family = sourceFamilies.get(storedPromo.offerId);
        if (!family) sourceFamilies.set(storedPromo.offerId, { firstSentAt: sourceSentAt, latest: storedPromo,
          latestExpiry: storedPromo.expires || storedPromo.expiresAt ? storedPromo : null });
        else {
          if (Date.parse(sourceSentAt) < Date.parse(family.firstSentAt)) family.firstSentAt = sourceSentAt;
          if (Date.parse(sourceSentAt) >= Date.parse(family.latest.emailSentAt || family.latest.receivedAt)) family.latest = storedPromo;
          if ((storedPromo.expires || storedPromo.expiresAt) &&
              (!family.latestExpiry || Date.parse(sourceSentAt) >= Date.parse(family.latestExpiry.emailSentAt || family.latestExpiry.receivedAt))) family.latestExpiry = storedPromo;
        }
      }
    }

    if (rebuildOfferSources) {
      const rebuilt = reconcileOfferSources(db, { processedMessageKeys, families: sourceFamilies });
      console.log('Complete stored-source offer reconstruction: ' + JSON.stringify(rebuilt));
      console.log('Complete Eats receipt source reconstruction: '+JSON.stringify(reconcileEatsReceiptSources(db,processedMessageKeys,eatsSources)));
      console.log('Complete receipt identity reconstruction: ' + JSON.stringify(reconcileTransportReceiptIdentities(db,processedMessageKeys,transportSources)));
    }

    const durableOffers = getOffers(db, {
      service: "Uber Eats",
      includeHistorical: false
    });

    const corrections=currentFinancialEvents(readFinancialEvents(db)).corrections;
    const adjust=r=>corrections[r.receiptId]?{...r,financialCorrection:corrections[r.receiptId]}:r;
    const receipts = getReceipts(db).map(adjust);
    const transportReceipts = getTransportReceipts(db).map(adjust);
    const cashEvidence=reconstructCashEvidence(db,getOffers(db,{includeHistorical:true}),[...receipts,...transportReceipts],generatedAt);
    const evidence = applyReceiptEvidence(durableOffers, receipts, { now: generatedAt });

    for (const promo of evidence.promos) {
      updateOfferUsage(db, promo);
    }

    replaceReceiptMatches(db, evidence.matches, generatedAt);

    const refreshedOffers = attachAccountOfferContext(
      applyOfferTrackingStates(
        getOffers(db, {
          service: "Uber Eats",
          includeHistorical: false
        }).map(cashEvidence.annotate),
        evidence.matches,
        { now: generatedAt }
      )
    );

    // Closed offers remain visible in Used, including expiry without a receipt.
    const publicPromos = refreshedOffers
      .map(promo => toPublicPromo({
        ...promo,
        id: publicOfferIdentity(db, promo.offerId),
        previousOfferIds: (promo.previousOfferIds || []).map(id => publicOfferIdentity(db, id))
      }));

    const receiptStats = receiptStatsByAccount(receipts, transportReceipts);
    const reviewCounts = new Map();
    const availableCounts = new Map();

    for (const promo of refreshedOffers) {
      if (promo.trackingState === "available" && promo.accountRef) {
        availableCounts.set(
          promo.accountRef,
          (availableCounts.get(promo.accountRef) || 0) + 1
        );
      }
      if (!promo.needsReview || !promo.accountRef) continue;
      reviewCounts.set(
        promo.accountRef,
        (reviewCounts.get(promo.accountRef) || 0) + 1
      );
    }

    const offersByAccount = new Map();
    for (const offer of refreshedOffers) {
      if (!offersByAccount.has(offer.accountRef)) offersByAccount.set(offer.accountRef, []);
      offersByAccount.get(offer.accountRef).push(offer);
    }
    const accounts = getPublicAccountInsights(db,{receipts,rides:transportReceipts,offers:refreshedOffers}).map(account => {
      const stats = receiptStats.get(account.accountRef) || {
        orderCount: 0,
        promoSavings: 0,
        uberCashUsed: 0,
        uberOneConfirmedSavings: 0,
        otherConfirmedSavings: 0,
        confirmedSaved: 0,
        estimatedUberOneSavings: 0,
        estimatedTotalSaved: 0,
        lastOrderAt: account.lastOrderAt || null
      };

      const reviewOfferCount = reviewCounts.get(account.accountRef) || 0;

      return {
        ...account,
        cashSummary:cashEvidence.summary(account.accountRef),
        activePromoCount: availableCounts.get(account.accountRef) || 0,
        needsReview: reviewOfferCount > 0,
        reviewOfferCount,
        orderCount: stats.orderCount,
        promoSavings: stats.promoSavings,
        uberCashUsed: stats.uberCashUsed,
        uberCashConfirmedSavings: stats.uberCashConfirmedSavings || 0,
        uberOneConfirmedSavings: stats.uberOneConfirmedSavings,
        otherConfirmedSavings: stats.otherConfirmedSavings,
        totalSaved: stats.confirmedSaved,
        rideConfirmedSaved: stats.rideConfirmedSaved || 0,
        estimatedUberOneSavings: stats.estimatedUberOneSavings,
        estimatedTotalSaved: stats.estimatedTotalSaved,
        lastOrderAt: stats.lastOrderAt || account.lastOrderAt || null,
        ...classifyAccount({ ...account, orderCount: stats.orderCount }, offersByAccount.get(account.accountRef) || [], generatedAt)
      };
    });

    const summary = getSavingsSummary(db,{receipts,rides:transportReceipts});
    summary.accountStatusVersion = 2;
    summary.offerEligibilityVersion = 1;
    summary.cashModelVersion = 1;
    const eligibility = eligibleAccountCounts(accounts);
    summary.availableAccounts = eligibility.available;
    summary.readyToUseAccounts = eligibility.ready;
    summary.offerAttentionAccounts = eligibility.attention;
    summary.usedAccounts = accounts.filter(a => a.accountUsed).length;
    const completions = publicPromos.map(p => classifyOfferCompletion(p, generatedAt));
    for (const [field, predicate] of [['fullyUsedOffers','fullyUsed'],['finishedExpiredOffers','finishedExpired'],['fullyConsumedOffers','consumed'],['expiredUnusedOffers','expiredUnused'],['partiallyUsedOffers','partiallyUsed']]) summary[field] = completions.filter(c => c[predicate]).length;
    summary.usedAccessibleAccounts = accounts.filter(a => a.accountUsed && a.canLogin).length;
    summary.completedUsageAccounts = accounts.filter(a => a.accountUsed).length;
    summary.partialUsageAccounts = accounts.filter(a => a.canLogin && a.partialUsage).length;
    summary.expiredAccounts = accounts.filter(a => a.accountState === "expired").length;
    summary.fullyUsedAccounts = summary.usedAccounts;
    summary.completedPromotions = completions.filter(c => c.consumed).length;
    summary.archivedAccounts = accounts.filter(a => a.archived).length;
    summary.deactivatedAccounts = accounts.filter(a => a.deactivated).length;
    summary.archivedConfirmedSaved = Math.round(accounts.filter(a => a.archived).reduce((n,a)=>n+Number(a.totalSaved||0),0)*100)/100;
    summary.deactivatedConfirmedSaved = Math.round(accounts.filter(a => a.deactivated).reduce((n,a)=>n+Number(a.totalSaved||0),0)*100)/100;
    summary.needsCheckingAccounts = accounts.filter(a => a.accountState === "needs_checking").length;
    summary.receiptSourcesNeedingReview=accounts.reduce((n,a)=>n+a.sourceReviewCount,0);
    if (successfulMailScanAt) db.prepare("INSERT INTO meta(key,value) VALUES('last_successful_mail_scan_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE excluded.value > meta.value").run(successfulMailScanAt);
    const lastSuccessfulMailScanAt = db.prepare("SELECT value FROM meta WHERE key='last_successful_mail_scan_at'").get()?.value || null;
    const eligibleRefs = new Set(accounts.filter(a => a.recommendationEligible).map(a => a.accountRef));
    for (const promo of publicPromos) promo.recommendationEligible = eligibleRefs.has(promo.accountRef);
    summary.activePromoAccounts = new Set(
      refreshedOffers
        .filter(promo => promo.trackingState === "available" && eligibleRefs.has(promo.accountRef))
        .map(promo => promo.accountRef)
        .filter(Boolean)
    ).size;
    const feeSampleSize = receipts.filter(receipt =>
      receipt.deliveryFee != null ||
      receipt.serviceFee != null ||
      receipt.smallOrderFee != null
    ).length;

    let publicSyncReport=JSON.parse(db.prepare("SELECT value FROM meta WHERE key='sync_report_v1'").get()?.value||'{}');
    validateSyncReport(publicSyncReport);
    if(successfulMailScanAt&&completedScanReport){
      publicSyncReport=recordSyncRun(publicSyncReport,successfulMailScanAt,{emailsChecked:completedScanReport.emailsChecked,newReceipts:[...receipts,...transportReceipts].filter(r=>!beforeReceiptIds.has(r.receiptId)).length,offersUpdated:db.prepare('SELECT * FROM offers').all().filter(row=>beforeOffers.get(row.offer_id)!==offerSignature(row)).length},completedScanReport.scheduler);
      db.prepare("INSERT INTO meta(key,value)VALUES('sync_report_v1',?)ON CONFLICT(key)DO UPDATE SET value=excluded.value").run(JSON.stringify(publicSyncReport));
    }
    const payload = {
      schemaVersion: 3,
      generatedAt,
      source: "apple-mail-sqlite",
      demo: false,
      sync: { state: 'snapshot', lastSuccessfulMailScanAt, ...publicSyncReport },
      receiptActivity: receiptActivity(receipts, transportReceipts, confirmedReceiptSaving,{includeAmounts:true}),
      summary: {
        ...summary,
        feeModel: {
          sampleSize: feeSampleSize,
          averageExtraOrderFees: summary.averageExtraOrderFees
        }
      },
      accounts,
      promos: publicPromos
    };

    const allHistoryOffers = attachAccountOfferContext(
      applyOfferTrackingStates(
        getOffers(db, {
          service: "Uber Eats",
          includeHistorical: true
        }).map(cashEvidence.annotate),
        evidence.matches,
        { now: generatedAt }
      )
    );

    const publicHistory = {
      schemaVersion: 3,
      updatedAt: generatedAt,
      records: allHistoryOffers
        .filter(promo => promo.observedLive)
        .map(promo => ({
          ...toPublicPromo({
            ...promo,
            id: publicOfferIdentity(db, promo.offerId),
            previousOfferIds: (promo.previousOfferIds || []).map(id => publicOfferIdentity(db, id))
          }),
          status: historyStatus(promo),
          firstSeenAt: promo.firstSeenAt || null,
          lastSeenAt: promo.lastSeenAt || null
        }))
        .sort((a, b) =>
          String(b.emailSentAt || "").localeCompare(String(a.emailSentAt || ""))
        )
        .slice(0, 750)
    };

    assertPublicSnapshot(payload, publicHistory, [
      ...getAccounts(db).map(account => account.alias),
      ...allHistoryOffers.map(promo => promo.code)
    ]);
    // Prepare both complete files before committing; never truncate a good snapshot.
    for (const [destination, value] of [[outputPath, payload], [publicHistoryPath, publicHistory]]) {
      const temporary = destination + ".tmp-" + process.pid;
      temporaryFiles.push(temporary);
      await fs.writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
    }
    db.prepare("INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run("mail_parser_fingerprint", parsingFingerprint);
    db.exec("COMMIT");
    transaction = false;
    await fs.rename(temporaryFiles[0], outputPath);
    await fs.rename(temporaryFiles[1], publicHistoryPath);

    const access = getAccounts(db);
    const accessible = access.filter(account => account.canLogin).length;

    console.log("Private DB: " + privateDbPath);
    console.log("Known accounts: " + access.length + " (" + accessible + " can log in)");
    console.log("Stored Uber Eats receipts: " + receipts.length);
    console.log("Stored ride/bike receipts: " + transportReceipts.length);
    if (accountAllowlist) {
      console.log("Skipped messages outside account access list: " + skippedOutsideAccessList);
    }
    console.log("Public current/recent promos: " + publicPromos.length);
    console.log("Lifetime confirmed receipt saving: £" + summary.totalSaved.toFixed(2));
    console.log("Lifetime estimated saving: £" + summary.estimatedTotalSaved.toFixed(2));
  } finally {
    if (transaction) db.exec("ROLLBACK");
    db.close();
    await Promise.all(temporaryFiles.map(file => fs.rm(file, { force: true })));
    if (backup && process.env.TRACKER_COMPRESS_BACKUPS === 'true') {
      await compressPrivateBackup(backup);
      console.log('Import backup retained as a verified lossless owner-only gzip file.');
    }
  }
}

generatePromos().catch(error => {
  console.error("Could not generate tracker data:");
  console.error(error.message);
  process.exit(1);
});
