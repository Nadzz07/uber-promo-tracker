import fs from "node:fs/promises";
import { buildPromoList } from "./processor.js";
import { toPublicPromo } from "./public-promo.js";
import { mergeHistory } from "./history.js";

const inputPath = process.argv[2] || "./emails.local.json";
const outputPath = process.argv[3] || "./promos.json";
const historyPath = process.argv[4] || "./history.json";

async function readHistory() {
  try {
    return JSON.parse(await fs.readFile(historyPath, "utf8"));
  } catch {
    return { records: [] };
  }
}

async function generatePromos() {
  try {
    const raw = await fs.readFile(inputPath, "utf8");
    const emails = JSON.parse(raw);
    if (!Array.isArray(emails)) throw new Error("Email input must be a JSON array.");

    const generatedAt = new Date().toISOString();
    const promos = buildPromoList(emails).map(toPublicPromo);
    const payload = {
      generatedAt,
      source: "apple-mail",
      demo: false,
      promos
    };

    const oldHistory = await readHistory();
    const history = mergeHistory(oldHistory, promos, generatedAt);

    await fs.writeFile(outputPath, JSON.stringify(payload, null, 2) + "\n");
    await fs.writeFile(historyPath, JSON.stringify(history, null, 2) + "\n");

    console.log("Generated " + promos.length + " public promo records.");
    console.log("History contains " + history.records.length + " sanitised offer records.");
    if (promos.length > 0) console.log("Best promo: " + promos[0].title);
  } catch (error) {
    console.error("Could not generate promos:");
    console.error(error);
    process.exit(1);
  }
}

generatePromos();
