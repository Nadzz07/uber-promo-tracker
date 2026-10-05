import fs from "node:fs/promises";
import { buildPromoList } from "./processor.js";
import { toPublicPromo } from "./public-promo.js";
import { mergeHistory, toPublicHistory } from "./history.js";
import { assignAccountRefs } from "./account-map.js";

const inputPath = process.argv[2] || "./emails.local.json";
const outputPath = process.argv[3] || "./promos.json";
const publicHistoryPath = process.argv[4] || "./history.json";
const accountMapPath = process.argv[5] || "./accounts.local.json";
const privateHistoryPath = process.argv[6] || "./history.local.json";

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
    if (!Array.isArray(emails)) throw new Error("Email input must be a JSON array.");

    const generatedAt = new Date().toISOString();
    const privatePromos = buildPromoList(emails);

    const oldAccountMap = await readJson(accountMapPath, {
      version: 1,
      nextNumber: 1,
      accounts: {}
    });

    const assigned = assignAccountRefs(
      privatePromos,
      oldAccountMap,
      generatedAt
    );

    const promos = assigned.promos.map(toPublicPromo);

    const payload = {
      generatedAt,
      source: "apple-mail",
      demo: false,
      promos
    };

    const oldPrivateHistory = await readJson(privateHistoryPath, { records: [] });
    const privateHistory = mergeHistory(oldPrivateHistory, promos, generatedAt);
    const publicHistory = toPublicHistory(privateHistory);

    await fs.writeFile(outputPath, JSON.stringify(payload, null, 2) + "\n");
    await fs.writeFile(publicHistoryPath, JSON.stringify(publicHistory, null, 2) + "\n");
    await fs.writeFile(privateHistoryPath, JSON.stringify(privateHistory, null, 2) + "\n");
    await fs.writeFile(accountMapPath, JSON.stringify(assigned.state, null, 2) + "\n");

    const accountCount = new Set(
      promos.map(promo => promo.accountRef).filter(Boolean)
    ).size;

    console.log("Generated " + promos.length + " public promo records.");
    console.log("Active promos span " + accountCount + " anonymous accounts.");
    console.log("Private history contains " + privateHistory.records.length + " records.");
    console.log("Public history contains " + publicHistory.records.length + " records.");
    if (promos.length > 0) console.log("Best promo: " + promos[0].title);
  } catch (error) {
    console.error("Could not generate promos:");
    console.error(error);
    process.exit(1);
  }
}

generatePromos();
