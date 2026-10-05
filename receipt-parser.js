import { analyseSender } from "./parser-v2/sender.js";
import {
  asDate,
  extractAccountAlias,
  firstMatch,
  number,
  PARSER_VERSION,
  sourceSnippet
} from "./parser-v2/utils.js";

function moneyForLabel(text, labels) {
  for (const label of labels) {
    const pattern = new RegExp(
      "(?:^|\\b)" + label + "\\b[^£\\d-]{0,32}(?:-\\s*)?£\\s*(\\d+(?:[.,]\\d{1,2})?)",
      "i"
    );
    const match = text.match(pattern);
    if (match) {
      return {
        value: number(match[1].replace(",", ".")),
        match
      };
    }
  }

  return { value: null, match: null };
}

function extractOrderId(text) {
  const match = firstMatch(text, [
    /(?:order\s*(?:number|no\.?|#)|receipt\s*#)\s*[:#-]?\s*([A-Z0-9-]{5,40})/i
  ]);

  return {
    value: match ? match[1].toUpperCase() : null,
    match
  };
}

export function parseUberEatsReceipt({
  subject = "",
  body = "",
  sender = "",
  recipient = "",
  receivedAt = new Date(),
  sentAt = null,
  messageId = null,
  mailbox = null
} = {}) {
  const text = (String(subject || "") + "\n" + String(body || ""))
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ");

  const senderAnalysis = analyseSender(sender);

  const receiptSignal =
    /\breceipt\b|\bthanks\s+for\s+(?:your\s+)?order\b|\border\s+(?:with|from)\b|\border\s+total\b/i.test(text);

  const foodSignal =
    /\buber\s*eats\b|\border\b|\brestaurant\b|\bdelivery\b|\bsubtotal\b/i.test(text);

  const subtotal = moneyForLabel(text, ["subtotal", "items subtotal", "estimated subtotal"]);
  const total = moneyForLabel(text, ["final total", "amount charged", "total"]);
  const promotionDiscount = moneyForLabel(text, ["promotion", "promotions", "promo", "discount"]);
  const deliveryFee = moneyForLabel(text, ["delivery fee", "delivery"]);
  const serviceFee = moneyForLabel(text, ["service fee"]);
  const smallOrderFee = moneyForLabel(text, ["small order fee"]);
  const tip = moneyForLabel(text, ["tip"]);
  const uberCashUsed = moneyForLabel(text, ["uber cash", "uber credits"]);
  const orderId = extractOrderId(text);

  const hasReceiptAmounts = subtotal.value != null || total.value != null;
  const isReceipt =
    Boolean(senderAnalysis.trusted) &&
    receiptSignal &&
    foodSignal &&
    hasReceiptAmounts;

  const received = asDate(receivedAt);
  const sent = sentAt ? asDate(sentAt) : received;

  const merchantMatch =
    String(subject).match(/(?:order|receipt)\s+(?:from|with)\s+(.+?)(?:\s+is\b|\s*[|–—-]|$)/i);

  return {
    parserVersion: PARSER_VERSION,
    isReceipt,
    accepted: isReceipt,
    messageType: "receipt",
    service: "Uber Eats",
    messageId: messageId || null,
    mailbox: mailbox || null,
    accountAlias: extractAccountAlias(recipient),
    sentAt: sent.toISOString(),
    receivedAt: received.toISOString(),
    orderId: orderId.value,
    merchant: merchantMatch ? merchantMatch[1].trim().slice(0, 120) : null,
    subtotal: subtotal.value,
    promotionDiscount: promotionDiscount.value,
    deliveryFee: deliveryFee.value,
    serviceFee: serviceFee.value,
    smallOrderFee: smallOrderFee.value,
    tip: tip.value,
    uberCashUsed: uberCashUsed.value,
    total: total.value,
    senderVerified: senderAnalysis.trusted,
    senderConfidence: senderAnalysis.confidence,
    evidence: {
      subtotal: sourceSnippet(text, subtotal.match),
      promotion: sourceSnippet(text, promotionDiscount.match),
      deliveryFee: sourceSnippet(text, deliveryFee.match),
      serviceFee: sourceSnippet(text, serviceFee.match),
      smallOrderFee: sourceSnippet(text, smallOrderFee.match),
      uberCash: sourceSnippet(text, uberCashUsed.match),
      total: sourceSnippet(text, total.match),
      orderId: sourceSnippet(text, orderId.match),
      senderBasis: senderAnalysis.basis
    }
  };
}

export function parseUberEatsReceipts(messages = []) {
  return messages
    .map(parseUberEatsReceipt)
    .filter(receipt => receipt.isReceipt);
}
