import { createHash } from "node:crypto";

function stablePromoFields(promo) {
  return {
    service: promo.service ?? null,
    title: promo.title ?? null,
    discountType: promo.discountType ?? null,
    discount: promo.discount ?? null,
    maxSaving: promo.maxSaving ?? null,
    perUseCap: promo.perUseCap ?? null,
    uses: promo.uses ?? 1,
    maxTotalSaving: promo.maxTotalSaving ?? null,
    minimumSpend: promo.minimumSpend ?? 0,
    hasCode: Boolean(promo.hasCode),
    expires: promo.expires ?? null,
    expiryBasis: promo.expiryBasis ?? null,
    accountRef: promo.accountRef ?? null,
    hasCompanionOffer: Boolean(promo.hasCompanionOffer)
  };
}

function identityPromoFields(promo) {
  return {
    service: promo.service ?? null,
    discountType: promo.discountType ?? null,
    discount: promo.discount ?? null,
    maxSaving: promo.maxSaving ?? null,
    perUseCap: promo.perUseCap ?? null,
    uses: promo.uses ?? 1,
    maxTotalSaving: promo.maxTotalSaving ?? null,
    minimumSpend: promo.minimumSpend ?? 0,
    hasCode: Boolean(promo.hasCode),
    expires: promo.expires ?? null,
    accountRef: promo.accountRef ?? null
  };
}

export function promoHistoryId(promo) {
  const canonical = JSON.stringify(identityPromoFields(promo));
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

export function mergeHistory(previousPayload, currentPromos, generatedAt = new Date().toISOString()) {
  const previousRecords = Array.isArray(previousPayload?.records) ? previousPayload.records : [];
  const records = new Map();

  for (const record of previousRecords) {
    if (!record?.id) continue;
    records.set(record.id, {
      ...record,
      status: "inactive"
    });
  }

  for (const promo of currentPromos) {
    const safePromo = stablePromoFields(promo);
    const id = promoHistoryId(safePromo);
    const existing = records.get(id);

    records.set(id, {
      id,
      ...safePromo,
      firstSeenAt: existing?.firstSeenAt || generatedAt,
      lastSeenAt: generatedAt,
      scansSeen: Number(existing?.scansSeen || 0) + 1,
      legacyOccurrences: Number(existing?.legacyOccurrences || 0),
      source: "live-scan",
      status: "active"
    });
  }

  const sorted = [...records.values()]
    .sort((a, b) => String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || "")))
    .slice(0, 2000);

  return {
    updatedAt: generatedAt,
    records: sorted
  };
}

export function toPublicHistory(privatePayload, { maxRecords = 500 } = {}) {
  const records = Array.isArray(privatePayload?.records) ? privatePayload.records : [];

  const publicRecords = records
    .filter(record => record.service === "Uber Eats")
    .filter(record => record.source !== "legacy-db" || record.status === "active")
    .map(record => ({
      id: record.id,
      ...stablePromoFields(record),
      firstSeenAt: record.firstSeenAt ?? null,
      lastSeenAt: record.lastSeenAt ?? null,
      scansSeen: Number(record.scansSeen || 0),
      status: record.status === "active" ? "active" : "inactive"
    }))
    .sort((a, b) => String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || "")))
    .slice(0, maxRecords);

  return {
    updatedAt: privatePayload?.updatedAt || null,
    records: publicRecords
  };
}
