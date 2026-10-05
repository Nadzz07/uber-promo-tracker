import fs from "node:fs/promises";
import { migrateLegacyRows } from "./legacy-migration.js";

const inputPath = process.argv[2] || "./legacy-promos.local.json";
const privateHistoryPath = process.argv[3] || "./history.local.json";
const accountMapPath = process.argv[4] || "./accounts.local.json";
const publicHistoryPath = process.argv[5] || "./history.json";

async function readJson(path, fallback) {
  try {
    return JSON.parse(await fs.readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function main() {
  try {
    const rows = await readJson(inputPath, []);
    if (!Array.isArray(rows)) {
      throw new Error("Legacy export must be a JSON array.");
    }

    const accountState = await readJson(accountMapPath, {
      version: 1,
      nextNumber: 1,
      accounts: {}
    });

    const privateHistory = await readJson(privateHistoryPath, {
      updatedAt: null,
      records: []
    });

    const result = migrateLegacyRows({
      rows,
      accountState,
      privateHistory,
      importedAt: new Date().toISOString()
    });

    await fs.writeFile(
      privateHistoryPath,
      JSON.stringify(result.privateHistory, null, 2) + "\n"
    );

    await fs.writeFile(
      accountMapPath,
      JSON.stringify(result.accountState, null, 2) + "\n"
    );

    await fs.writeFile(
      publicHistoryPath,
      JSON.stringify(result.publicHistory, null, 2) + "\n"
    );

    console.log("Legacy accepted rows imported: " + result.importedRows);
    console.log("Legacy rows deduped to: " + result.dedupedLegacyRecords + " private history records.");
    console.log("Public history records after migration: " + result.publicHistory.records.length);
    console.log("Real account aliases remain only in " + accountMapPath + ".");
  } catch (error) {
    console.error("Legacy migration failed:");
    console.error(error);
    process.exit(1);
  }
}

main();
