import fs from "node:fs/promises";
import { parseUberPromo } from "./parser.js";
import { parseUberEatsReceipt } from "./receipt-parser.js";
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
  getSavingsSummary,
  openPrivateDb,
  replaceReceiptMatches,
  updateOfferUsage,
  upsertMessage,
  upsertOffer,
  upsertReceipt
} from "./private-db.js";
import {
  messageKey,
  offerFingerprint,
  receiptFingerprint
} from "./identity.js";

const inputPath = process.argv[2] || "./emails.local.json";
const outputPath = process.argv[3] || "./promos.json";
const publicHistoryPath = process.argv[4] || "./history.json";
const privateDbPath = process.argv[5] || DEFAULT_PRIVATE_DB;

function todayIso() {
  const date = new Date();
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function isExpired(promo, today = todayIso()) {
  return Boolean(promo.expires && promo.expires < today);
}

function isRecentUsed(promo, generatedAt) {
  if (promo.receiptState !== "used" || !promo.lastUsedAt) return false;

  const used = new Date(promo.lastUsedAt).getTime();
  const now = new Date(generatedAt).getTime();
  if (Number.isNaN(used) || Number.isNaN(now)) return false;

  return now - used <= 180 * 24 * 60 * 60 * 1000;
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

  return messages;
}

async function generatePromos() {
  const generatedAt = new Date().toISOString();
  const db = openPrivateDb(privateDbPath);

  try {
    const messages = await loadMessages(inputPath);

    for (const email of messages) {
      const receipt = parseUberEatsReceipt(email);
      const key = messageKey(email);
      const sentAt =
        receipt.sentAt ||
        email.sentAt ||
        email.receivedAt ||
        generatedAt;

      if (receipt.isReceipt) {
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

      const promo = parseUberPromo(email);
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

    const publicPromos = refreshedOffers
      .filter(promo =>
        promo.trackingState !== "used" ||
        isRecentUsed(promo, generatedAt)
      )
      .map(promo => toPublicPromo({
        ...promo,
        id: promo.offerId
      }));

    const receiptStats = receiptStatsByAccount(receipts);
    const reviewCounts = new Map();

    for (const promo of refreshedOffers) {
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
          firstSeenAt: promo.emailSentAt || null,
          lastSeenAt: promo.emailSentAt || null
        }))
        .sort((a, b) =>
          String(b.emailSentAt || "").localeCompare(String(a.emailSentAt || ""))
        )
        .slice(0, 750)
    };

    await fs.writeFile(outputPath, JSON.stringify(payload, null, 2) + "\n");
    await fs.writeFile(
      publicHistoryPath,
      JSON.stringify(publicHistory, null, 2) + "\n"
    );

    const access = getAccounts(db);
    const accessible = access.filter(account => account.canLogin).length;

    console.log("Private DB: " + privateDbPath);
    console.log("Known accounts: " + access.length + " (" + accessible + " can log in)");
    console.log("Stored receipts: " + receipts.length);
    console.log("Public current/recent promos: " + publicPromos.length);
    console.log("Lifetime confirmed receipt saving: £" + summary.totalSaved.toFixed(2));
    console.log("Lifetime estimated saving: £" + summary.estimatedTotalSaved.toFixed(2));
  } finally {
    db.close();
  }
}

generatePromos().catch(error => {
  console.error("Could not generate tracker data:");
  console.error(error);
  process.exit(1);
});
