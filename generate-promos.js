import fs from "node:fs/promises";
import { buildPromoList } from "./processor.js";
import { toPublicPromo } from "./public-promo.js";

const inputPath = process.argv[2] || "./emails.local.json";
const outputPath = process.argv[3] || "./promos.json";

async function generatePromos() {
  try {
    const raw = await fs.readFile(inputPath, "utf8");
    const emails = JSON.parse(raw);
    if (!Array.isArray(emails)) throw new Error("Email input must be a JSON array.");

    const promos = buildPromoList(emails).map(toPublicPromo);
    const payload = {
      generatedAt: new Date().toISOString(),
      source: "apple-mail",
      demo: false,
      promos
    };

    await fs.writeFile(outputPath, JSON.stringify(payload, null, 2) + "\n");
    console.log("Generated " + promos.length + " public promo records.");
    if (promos.length > 0) console.log("Best promo: " + promos[0].title);
  } catch (error) {
    console.error("Could not generate promos:");
    console.error(error);
    process.exit(1);
  }
}

generatePromos();
