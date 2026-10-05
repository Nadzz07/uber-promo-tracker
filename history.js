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
    expiryBasis: promo.expiryBasis ?? null
  };
}

export function promoHistoryId(promo) {
  const canonical = JSON.stringify(stablePromoFields(promo));
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
      status: "active"
    });
  }

  const sorted = [...records.values()]
    .sort((a, b) => String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || "")))
    .slice(0, 500);

  return {
    updatedAt: generatedAt,
    records: sorted
  };
}
