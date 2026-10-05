import { createHash } from "node:crypto";

export function stableHash(value, length = 20) {
  return createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex")
    .slice(0, length);
}

export function messageKey(message = {}) {
  if (message.messageId) {
    return "mid_" + stableHash(String(message.messageId).trim().toLowerCase());
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
    code: promo.code || null
  });
}

export function receiptFingerprint(receipt = {}) {
  if (receipt.orderId) {
    return "rcp_" + stableHash({
      accountRef: receipt.accountRef || null,
      orderId: receipt.orderId
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
