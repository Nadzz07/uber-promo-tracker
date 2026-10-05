import { parseUberPromo } from "./parser.js";
import { assignAccountRefs } from "./account-map.js";
import { toPublicPromo } from "./public-promo.js";
import { promoHistoryId, toPublicHistory } from "./history.js";

function normaliseExpiryDate(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? match[1] + "-" + match[2] + "-" + match[3] : null;
}

function legacyExpiryBasis(value) {
  if (!value) return null;
  const text = String(value);

  if (text === "explicit_in_offer_terms") return "legacy_explicit";
  if (/^estimated_\d+_days_from_email_date$/.test(text)) return "legacy_estimated";

  return "legacy_" + text;
}

function inferredLegacySeenAt(row) {
  const basis = String(row.expiry_basis || "");
  const match = basis.match(/^estimated_(\d+)_days_from_email_date$/);
  const expiry = normaliseExpiryDate(row.expiry_timestamp);

  if (!match || !expiry) return null;

  const days = Number(match[1]);
  const date = new Date(expiry + "T12:00:00Z");

  if (!Number.isFinite(days) || Number.isNaN(date.getTime())) return null;

  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}

function makeLegacyPromo(row, importedAt) {
  const discountValue = String(row.discount_value || "").trim();

  if (!discountValue) return null;

  const service = String(row.platform || "Uber Eats").trim() || "Uber Eats";
  const minimumSpend = String(row.minimum_spend || "").trim();
  const hasCode = Number(row.has_code || 0) === 1;
  const alias = String(row.account_alias || "").trim().toLowerCase();

  const syntheticBody = [
    service + " offer",
    discountValue,
    minimumSpend,
    hasCode ? "Use promo code LEGACYCODE" : ""
  ].filter(Boolean).join(". ");

  const parsed = parseUberPromo({
    sender: service + " <offers@uber.com>",
    recipient: alias,
    subject: discountValue,
    body: syntheticBody,
    receivedAt: importedAt
  });

  return {
    ...parsed,
    isPromo: true,
    service,
    title: discountValue,
    code: hasCode ? "__LEGACY_CODE_PRESENT__" : null,
    expires: normaliseExpiryDate(row.expiry_timestamp),
    expiryBasis: legacyExpiryBasis(row.expiry_basis),
    accountAlias: alias || null,
    legacySeenAt: inferredLegacySeenAt(row)
  };
}

function earliest(left, right) {
  if (!left) return right || null;
  if (!right) return left || null;
  return left < right ? left : right;
}

function latest(left, right) {
  if (!left) return right || null;
  if (!right) return left || null;
  return left > right ? left : right;
}

export function migrateLegacyRows({
  rows = [],
  accountState = {},
  privateHistory = {},
  importedAt = new Date().toISOString()
} = {}) {
  const privatePromos = rows
    .map(row => makeLegacyPromo(row, importedAt))
    .filter(Boolean);

  const assigned = assignAccountRefs(
    privatePromos,
    accountState,
    importedAt
  );

  const grouped = new Map();

  for (const promo of assigned.promos) {
    const publicPromo = toPublicPromo(promo);
    const id = promoHistoryId(publicPromo);
    const existing = grouped.get(id);

    grouped.set(id, {
      id,
      promo: publicPromo,
      occurrences: Number(existing?.occurrences || 0) + 1,
      firstSeenAt: earliest(existing?.firstSeenAt, promo.legacySeenAt),
      lastSeenAt: latest(existing?.lastSeenAt, promo.legacySeenAt)
    });
  }

  const existingRecords = Array.isArray(privateHistory?.records)
    ? privateHistory.records
    : [];

  const records = new Map();

  for (const record of existingRecords) {
    if (record?.id) records.set(record.id, { ...record });
  }

  for (const group of grouped.values()) {
    const existing = records.get(group.id);

    if (existing) {
      records.set(group.id, {
        ...existing,
        firstSeenAt: earliest(existing.firstSeenAt, group.firstSeenAt),
        lastSeenAt: latest(existing.lastSeenAt, group.lastSeenAt),
        legacyOccurrences:
          Number(existing.legacyOccurrences || 0) +
          group.occurrences
      });
      continue;
    }

    records.set(group.id, {
      id: group.id,
      ...group.promo,
      firstSeenAt: group.firstSeenAt,
      lastSeenAt: group.lastSeenAt,
      scansSeen: 0,
      legacyOccurrences: group.occurrences,
      legacyImportedAt: importedAt,
      source: "legacy-db",
      status: "inactive"
    });
  }

  const nextPrivateHistory = {
    updatedAt: privateHistory?.updatedAt || null,
    records: [...records.values()]
      .sort((a, b) =>
        String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || ""))
      )
      .slice(0, 5000)
  };

  return {
    importedRows: privatePromos.length,
    dedupedLegacyRecords: grouped.size,
    accountState: assigned.state,
    privateHistory: nextPrivateHistory,
    publicHistory: toPublicHistory(nextPrivateHistory)
  };
}
