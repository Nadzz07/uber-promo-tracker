import fs from "node:fs/promises";
import { buildPromoList } from "./processor.js";
import { toPublicPromo } from "./public-promo.js";
import { mergeHistory } from "./history.js";
import { assignAccountRefs } from "./account-map.js";

const inputPath = process.argv[2] || "./emails.local.json";
const outputPath = process.argv[3] || "./promos.json";
const historyPath = process.argv[4] || "./history.json";
const accountMapPath = process.argv[5] || "./accounts.local.json";

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

    const oldHistory = await readJson(historyPath, { records: [] });
    const history = mergeHistory(oldHistory, promos, generatedAt);

    await fs.writeFile(outputPath, JSON.stringify(payload, null, 2) + "\n");
    await fs.writeFile(historyPath, JSON.stringify(history, null, 2) + "\n");
    await fs.writeFile(accountMapPath, JSON.stringify(assigned.state, null, 2) + "\n");

    const accountCount = new Set(
      promos.map(promo => promo.accountRef).filter(Boolean)
    ).size;

    console.log("Generated " + promos.length + " public promo records.");
    console.log("Active promos span " + accountCount + " anonymous accounts.");
    console.log("History contains " + history.records.length + " sanitised offer records.");
    if (promos.length > 0) console.log("Best promo: " + promos[0].title);
  } catch (error) {
    console.error("Could not generate promos:");
    console.error(error);
    process.exit(1);
  }
}

generatePromos();
