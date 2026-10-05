#!/usr/bin/env node
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { parseUberPromo } from "../parser.js";
import {
  ensureAccount,
  openPrivateDb,
  upsertOffer
} from "../private-db.js";
import { offerFingerprint } from "../identity.js";

const legacyPath = process.argv[2];
const privateDbPath = process.argv[3] || "./uber-tracker.local.db";

if (!legacyPath) {
  console.error("Usage: node mac/import-legacy-db.js /path/to/legacy.db [uber-tracker.local.db]");
  process.exit(1);
}

if (!fs.existsSync(legacyPath)) {
  console.error("Legacy DB not found: " + legacyPath);
  process.exit(1);
}

const legacy = new DatabaseSync(legacyPath, { readOnly: true });
const target = openPrivateDb(privateDbPath);
const importedAt = new Date().toISOString();

try {
  const aliases = new Set();

  try {
    for (const row of legacy.prepare(
      "SELECT account_alias FROM accounts WHERE account_alias IS NOT NULL"
    ).all()) {
      if (row.account_alias) aliases.add(String(row.account_alias).toLowerCase());
    }
  } catch {}

  const rows = legacy.prepare(`
    SELECT
      account_alias,
      promo_code,
      discount_value,
      minimum_spend,
      expiry_timestamp,
      expiry_basis,
      subject,
      parsed_at
    FROM promos
    WHERE rejected = 0
    ORDER BY id ASC
  `).all();

  for (const row of rows) {
    if (row.account_alias) aliases.add(String(row.account_alias).toLowerCase());
  }

  for (const alias of aliases) {
    ensureAccount(target, {
      alias,
      seenAt: importedAt,
      kind: null
    });
  }

  let imported = 0;

  for (const row of rows) {
    if (!row.account_alias) continue;

    const account = ensureAccount(target, {
      alias: row.account_alias,
      seenAt: row.parsed_at || importedAt,
      kind: "promo"
    });

    if (!account) continue;

    const text = [
      row.discount_value || "",
      row.minimum_spend || "",
      row.expiry_timestamp ? "Expires " + row.expiry_timestamp : "",
      row.promo_code ? "Promo code " + row.promo_code : ""
    ].filter(Boolean).join(". ");

    const parsed = parseUberPromo({
      subject: row.subject || row.discount_value || "Legacy Uber Eats offer",
      body: text,
      recipient: row.account_alias,
      sentAt: row.parsed_at || importedAt,
      receivedAt: row.parsed_at || importedAt
    });

    const promo = {
      ...parsed,
      isPromo: true,
      accepted: true,
      service: "Uber Eats",
      accountRef: account.accountRef,
      accountMasked: account.masked,
      canLogin: account.canLogin,
      code: row.promo_code || parsed.code || null,
      expiryBasis: row.expiry_basis || parsed.expiryBasis || null,
      source: "legacy_db",
      observedLive: false,
      emailSentAt: row.parsed_at || importedAt,
      evidence: {
        ...parsed.evidence,
        legacy: "Imported privately from legacy accepted promo row"
      }
    };

    promo.offerId = offerFingerprint(promo);
    upsertOffer(target, promo, importedAt);
    imported++;
  }

  console.log("Imported " + imported + " accepted legacy promo rows privately.");
  console.log("Imported/discovered " + aliases.size + " legacy account aliases.");
  console.log("Legacy database was opened read-only and was not modified.");
  console.log("Legacy-only offers remain historical until a live Mail scan sees them.");
} finally {
  legacy.close();
  target.close();
}
