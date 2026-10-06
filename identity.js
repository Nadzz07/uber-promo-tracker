import { createHash } from "node:crypto";

export function stableHash(value, length = 20) {
  return createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex")
    .slice(0, length);
}

export function messageKey(message = {}) {
  if (message.messageId) {
    return "mid_" + stableHash({
      messageId: String(message.messageId).trim().replace(/^<|>$/g, "").toLowerCase(),
      recipient: String(message.recipient || "").trim().toLowerCase()
    });
  }

  return "msg_" + stableHash({
    sender: message.sender || null,
    recipient: message.recipient || null,
    subject: message.subject || null,
    sentAt: message.sentAt || message.receivedAt || null
  });
}

export function offerFingerprint(promo = {}) {
  return "off_" + stableHash({
    accountRef: promo.accountRef || null,
    service: promo.service || null,
    offerType: promo.offerType || null,
    discountType: promo.discountType || null,
    discount: promo.discount ?? null,
    maxSaving: promo.maxSaving ?? null,
    perUseCap: promo.perUseCap ?? null,
    uses: promo.uses ?? 1,
    minimumSpend: promo.minimumSpend ?? 0,
    code: promo.code || null,
    expiryForCodelessCampaign: promo.code ? null : (promo.expires || null)
  });
}

export function receiptFingerprint(receipt = {}) {
  if (receipt.orderId) {
    return "rcp_" + stableHash({
      accountRef: receipt.accountRef || null,
      orderId: String(receipt.orderId).trim().toUpperCase()
    });
  }

  return "rcp_" + stableHash({
    accountRef: receipt.accountRef || null,
    sentAt: receipt.sentAt || receipt.receivedAt || null,
    subtotal: receipt.subtotal ?? null,
    promotionDiscount: receipt.promotionDiscount ?? null,
    total: receipt.total ?? null
  });
}

export function transportReceiptFingerprint(receipt = {}) {
  if (receipt.tripId) {
    return "trp_" + stableHash({
      accountRef: receipt.accountRef || null,
      tripId: String(receipt.tripId).trim().toUpperCase()
    });
  }

  if (receipt.tripKey) {
    return "trp_" + stableHash({
      accountRef: receipt.accountRef || null,
      transportMode: receipt.transportMode || "ride",
      tripKey: String(receipt.tripKey).trim().toLowerCase()
    });
  }

  return "trp_" + stableHash({
    accountRef: receipt.accountRef || null,
    sentAt: receipt.sentAt || receipt.receivedAt || null,
    transportMode: receipt.transportMode || "ride",
    total: receipt.total ?? null
  });
}
