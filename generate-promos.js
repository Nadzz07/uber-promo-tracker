import fs from "node:fs/promises";
import path from "node:path";
import { assertPublicSnapshot } from "./public-snapshot.js";
import { parseAccessList } from "./access-list.js";
import { isOfferExpired } from "./offer-time.js";
import { parseUberPromo } from "./parser.js";
import { parseUberEatsReceipt } from "./receipt-parser.js";
import { parseUberTransportReceipt } from "./transport-receipt-parser.js";
import { applyReceiptEvidence } from "./receipt-intelligence.js";
import { toPublicPromo } from "./public-promo.js";
import { estimateReceiptSavings } from "./savings-intelligence.js";
import { applyOfferTrackingStates } from "./offer-state.js";
import {
  DEFAULT_PRIVATE_DB,
  ensureAccount,
  getAccounts,
  getOffers,
  getPublicAccountInsights,
  getReceipts,
  getTransportReceipts,
  getSavingsSummary,
  openPrivateDb,
  replaceReceiptMatches,
  updateOfferUsage,
  upsertMessage,
  upsertOffer,
  upsertReceipt,
  upsertTransportReceipt
} from "./private-db.js";
import {
  messageKey,
  offerFingerprint,
  receiptFingerprint,
  transportReceiptFingerprint
} from "./identity.js";

const inputPath = process.argv[2] || "./emails.local.json";
const outputPath = process.argv[3] || "./promos.json";
const publicHistoryPath = process.argv[4] || "./history.json";
const privateDbPath = process.argv[5] || DEFAULT_PRIVATE_DB;
const accountAccessPath =
  process.env.TRACKER_ACCOUNT_ACCESS || "./account-access.local.csv";
const allowUnknownAccounts =
  /^(?:1|true|yes)$/i.test(process.env.TRACKER_ALLOW_UNKNOWN_ACCOUNTS || "");

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

function receiptStatsByAccount(receipts) {
  return estimateReceiptSavings(receipts).byAccount;
}

function historyStatus(promo) {
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
    return new Set(
      parseAccessList(text).map(record => record.email.trim().toLowerCase())
    );
  } catch (error) {
    if (error?.code === "ENOENT") return null;
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
  const db = openPrivateDb(privateDbPath);
  let transaction = false;
  let skippedOutsideAccessList = 0;
  const temporaryFiles = [];
  try {
    db.exec("BEGIN IMMEDIATE");
    transaction = true;

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

        upsertReceipt(db, storedReceipt, generatedAt);
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
        continue;
      }

      const promo = parseUberPromo(email);

      if (!accountAllowed(accountAllowlist, promo.accountAlias)) {
        skippedOutsideAccessList++;
        continue;
      }

      const account = ensureAccount(db, {
        alias: promo.accountAlias,
        seenAt: promo.emailSentAt || promo.receivedAt || sentAt,
        kind: "promo"
      });

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
    }

    const durableOffers = getOffers(db, {
      service: "Uber Eats",
      includeHistorical: false
    });

    const receipts = getReceipts(db);
    const transportReceipts = getTransportReceipts(db);
    const evidence = applyReceiptEvidence(durableOffers, receipts);

    for (const promo of evidence.promos) {
      updateOfferUsage(db, promo);
    }

    replaceReceiptMatches(db, evidence.matches, generatedAt);

    const refreshedOffers = attachAccountOfferContext(
      applyOfferTrackingStates(
        getOffers(db, {
          service: "Uber Eats",
          includeHistorical: false
        }),
        evidence.matches,
        { now: generatedAt }
      )
    );

    // Closed offers remain visible in Used, including expiry without a receipt.
    const publicPromos = refreshedOffers
      .map(promo => toPublicPromo({
        ...promo,
        id: promo.offerId
      }));

    const receiptStats = receiptStatsByAccount(receipts);
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

    const accounts = getPublicAccountInsights(db).map(account => {
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
        activePromoCount: availableCounts.get(account.accountRef) || 0,
        needsReview: reviewOfferCount > 0,
        reviewOfferCount,
        orderCount: stats.orderCount,
        promoSavings: stats.promoSavings,
        uberCashUsed: stats.uberCashUsed,
        uberOneConfirmedSavings: stats.uberOneConfirmedSavings,
        otherConfirmedSavings: stats.otherConfirmedSavings,
        totalSaved: stats.confirmedSaved,
        estimatedUberOneSavings: stats.estimatedUberOneSavings,
        estimatedTotalSaved: stats.estimatedTotalSaved,
        lastOrderAt: stats.lastOrderAt || account.lastOrderAt || null
      };
    });

    const summary = getSavingsSummary(db);
    summary.activePromoAccounts = new Set(
      refreshedOffers
        .filter(promo => promo.trackingState === "available")
        .map(promo => promo.accountRef)
        .filter(Boolean)
    ).size;
    const feeSampleSize = receipts.filter(receipt =>
      receipt.deliveryFee != null ||
      receipt.serviceFee != null ||
      receipt.smallOrderFee != null
    ).length;

    const payload = {
      schemaVersion: 3,
      generatedAt,
      source: "apple-mail-sqlite",
      demo: false,
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
        }),
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
            id: promo.offerId
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
  }
}

generatePromos().catch(error => {
  console.error("Could not generate tracker data:");
  console.error(error.message);
  process.exit(1);
});
