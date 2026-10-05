import { createHash } from "node:crypto";

function receiptId(receipt) {
  const canonical = JSON.stringify({
    accountAlias: receipt.accountAlias ?? null,
    receivedAt: receipt.receivedAt ?? null,
    orderId: receipt.orderId ?? null,
    subtotal: receipt.subtotal ?? null,
    promotionDiscount: receipt.promotionDiscount ?? null,
    total: receipt.total ?? null
  });

  return createHash("sha256").update(canonical).digest("hex").slice(0, 20);
}

export function mergeReceiptStore(
  previousPayload = {},
  currentReceipts = [],
  updatedAt = new Date().toISOString()
) {
  const records = new Map();

  for (const receipt of Array.isArray(previousPayload?.records) ? previousPayload.records : []) {
    if (!receipt) continue;
    const id = receipt.id || receiptId(receipt);
    records.set(id, { ...receipt, id });
  }

  for (const receipt of currentReceipts) {
    const id = receiptId(receipt);
    const previous = records.get(id);

    records.set(id, {
      ...previous,
      ...receipt,
      id,
      firstSeenAt: previous?.firstSeenAt || updatedAt,
      lastSeenAt: updatedAt
    });
  }

  const sorted = [...records.values()]
    .sort((a, b) => String(b.receivedAt || "").localeCompare(String(a.receivedAt || "")))
    .slice(0, 2500);

  return {
    updatedAt,
    records: sorted
  };
}
