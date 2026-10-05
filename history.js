import { createHash } from "node:crypto";

function stablePromoFields(promo) {
  return {
    service: promo.service ?? null,
    offerType: promo.offerType ?? null,
    title: promo.title ?? null,
    discountType: promo.discountType ?? null,
    discount: promo.discount ?? null,
    maxSaving: promo.maxSaving ?? null,
    perUseCap: promo.perUseCap ?? null,
    uses: promo.uses ?? 1,
    usesRemaining:
      promo.usesRemaining == null
        ? (promo.uses ?? 1)
        : promo.usesRemaining,
    maxTotalSaving: promo.maxTotalSaving ?? null,
    minimumSpend: promo.minimumSpend ?? 0,
    hasCode: Boolean(promo.hasCode),
    expires: promo.expires ?? null,
    expiryStatus: promo.expiryStatus ?? "unknown",
    expiryBasis: promo.expiryBasis ?? null,
    classificationConfidence: promo.classificationConfidence ?? null,
    accountRef: promo.accountRef ?? null,
    accountMasked: promo.accountMasked ?? null,
    canLogin: Boolean(promo.canLogin),
    hasCompanionOffer: Boolean(promo.hasCompanionOffer),
    receiptState: promo.receiptState ?? null,
    receiptConfirmedUses: Number(promo.receiptConfirmedUses || 0),
    lastUsedAt: promo.lastUsedAt ?? null,
    emailSentAt: promo.emailSentAt ?? null
  };
}

function identityPromoFields(promo) {
  return {
    service: promo.service ?? null,
    offerType: promo.offerType ?? null,
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
      status: record.status === "used" ? "used" : "inactive"
    });
  }

  for (const promo of currentPromos) {
    const safePromo = stablePromoFields(promo);
    const id = promo.id || promoHistoryId(safePromo);
    const existing = records.get(id);

    records.set(id, {
      id,
      ...safePromo,
      firstSeenAt: existing?.firstSeenAt || generatedAt,
      lastSeenAt: generatedAt,
      scansSeen: Number(existing?.scansSeen || 0) + 1,
      legacyOccurrences: Number(existing?.legacyOccurrences || 0),
      source: "live-scan",
      status: safePromo.receiptState === "used" ? "used" : "active"
    });
  }

  return {
    updatedAt: generatedAt,
    records: [...records.values()]
      .sort((a, b) =>
        String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || ""))
      )
      .slice(0, 2000)
  };
}

export function toPublicHistory(privatePayload, { maxRecords = 500 } = {}) {
  const records = Array.isArray(privatePayload?.records) ? privatePayload.records : [];

  return {
    updatedAt: privatePayload?.updatedAt || null,
    records: records
      .filter(record => record.service === "Uber Eats")
      .filter(record =>
        record.source !== "legacy-db" ||
        record.status === "active" ||
        record.status === "used"
      )
      .map(record => ({
        id: record.id,
        ...stablePromoFields(record),
        firstSeenAt: record.firstSeenAt ?? null,
        lastSeenAt: record.lastSeenAt ?? null,
        scansSeen: Number(record.scansSeen || 0),
        status:
          record.status === "used"
            ? "used"
            : record.status === "active"
              ? "active"
              : "inactive"
      }))
      .sort((a, b) =>
        String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || ""))
      )
      .slice(0, maxRecords)
  };
}
