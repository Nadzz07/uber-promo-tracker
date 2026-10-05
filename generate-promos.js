import fs from "node:fs/promises";
import { buildPromoList } from "./processor.js";
import { toPublicPromo } from "./public-promo.js";
import { mergeHistory, promoHistoryId, toPublicHistory } from "./history.js";
import { assignAccountRefs } from "./account-map.js";
import { parseUberEatsReceipt } from "./receipt-parser.js";
import { mergeReceiptStore } from "./receipt-store.js";
import { applyReceiptEvidence } from "./receipt-intelligence.js";

const inputPath = process.argv[2] || "./emails.local.json";
const outputPath = process.argv[3] || "./promos.json";
const publicHistoryPath = process.argv[4] || "./history.json";
const accountMapPath = process.argv[5] || "./accounts.local.json";
const privateHistoryPath = process.argv[6] || "./history.local.json";
const receiptStorePath = process.argv[7] || "./receipts.local.json";

async function readJson(path, fallback) {
  try {
    return JSON.parse(await fs.readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function generatePromos() {
  try {
    const raw = await fs.readFile(inputPath, "utf8");
    const emails = JSON.parse(raw);

    if (!Array.isArray(emails)) {
      throw new Error("Email input must be a JSON array.");
    }

    const generatedAt = new Date().toISOString();

    const classified = emails.map(email => ({
      email,
      receipt: parseUberEatsReceipt(email)
    }));

    const currentReceipts = classified
      .map(item => item.receipt)
      .filter(receipt => receipt.isReceipt);

    const promoEmails = classified
      .filter(item => !item.receipt.isReceipt)
      .map(item => item.email);

    const privatePromos = buildPromoList(promoEmails)
      .filter(promo => promo.service === "Uber Eats");

    const oldAccountMap = await readJson(accountMapPath, {
      version: 2,
      nextNumber: 1,
      accounts: {}
    });

    const promoAssignment = assignAccountRefs(
      privatePromos,
      oldAccountMap,
      generatedAt
    );

    const oldReceiptStore = await readJson(receiptStorePath, {
      updatedAt: null,
      records: []
    });

    const receiptStore = mergeReceiptStore(
      oldReceiptStore,
      currentReceipts,
      generatedAt
    );

    const receiptAssignment = assignAccountRefs(
      receiptStore.records,
      promoAssignment.state,
      generatedAt
    );

    const evidence = applyReceiptEvidence(
      promoAssignment.promos,
      receiptAssignment.items
    );

    const promos = evidence.promos.map(privatePromo => {
      const publicPromo = toPublicPromo(privatePromo);
      return {
        id: promoHistoryId(publicPromo),
        ...publicPromo
      };
    });

    const payload = {
      schemaVersion: 2,
      generatedAt,
      source: "apple-mail",
      demo: false,
      insights: evidence.publicInsights,
      promos
    };

    const oldPrivateHistory = await readJson(privateHistoryPath, { records: [] });
    const privateHistory = mergeHistory(oldPrivateHistory, promos, generatedAt);
    const publicHistory = toPublicHistory(privateHistory);

    await fs.writeFile(outputPath, JSON.stringify(payload, null, 2) + "\n");
    await fs.writeFile(publicHistoryPath, JSON.stringify(publicHistory, null, 2) + "\n");
    await fs.writeFile(privateHistoryPath, JSON.stringify(privateHistory, null, 2) + "\n");
    await fs.writeFile(accountMapPath, JSON.stringify(receiptAssignment.state, null, 2) + "\n");
    await fs.writeFile(receiptStorePath, JSON.stringify(receiptStore, null, 2) + "\n");

    const activePromos = promos.filter(promo => promo.receiptState !== "used");
    const accountCount = new Set(
      activePromos.map(promo => promo.accountRef).filter(Boolean)
    ).size;

    console.log("Generated " + promos.length + " public Uber Eats promo records.");
    console.log(activePromos.length + " remain active after receipt evidence.");
    console.log("Active promos span " + accountCount + " anonymous accounts.");
    console.log("Private receipt store contains " + receiptStore.records.length + " receipts.");
    console.log("Private history contains " + privateHistory.records.length + " records.");
    console.log("Public history contains " + publicHistory.records.length + " records.");

    if (activePromos.length > 0) {
      console.log("Best active promo: " + activePromos[0].title);
    }
  } catch (error) {
    console.error("Could not generate promos:");
    console.error(error);
    process.exit(1);
  }
}

generatePromos();
