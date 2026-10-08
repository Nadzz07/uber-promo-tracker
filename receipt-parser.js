import { analyseSender } from "./parser-v2/sender.js";
import { receiptText, moneyForLabel, hasTransportSignal } from "./receipt-text.js";
import {
  asDate,
  extractAccountAlias,
  firstMatch,
  number,
  PARSER_VERSION,
  sourceSnippet
} from "./parser-v2/utils.js";

export function savingsAmount(text) {
  const match = firstMatch(text, [
    /\byou\s+saved\s+£\s*(\d+(?:[.,]\d{1,2})?)/i,
    /\b(?:total|your)\s+savings?\b[^£\d]{0,24}£\s*(\d+(?:[.,]\d{1,2})?)/i,
    /£\s*(\d+(?:[.,]\d{1,2})?)\s+uber\s*one\s+savings?\s+and\s+other\s+promotions?\s+applied\b/i
  ]);

  return {
    value: match ? number(match[1].replace(",", ".")) : null,
    match
  };
}

export function uberOneSavingAmount(text) {
  const labelled = moneyForLabel(text, [
    "uber one savings",
    "uber one saving",
    "uber one member savings",
    "uber one member benefit",
    "uber one benefit"
  ]);

  if (labelled.value != null) return labelled;

  const match = firstMatch(text, [
    /\bsaved\s+£\s*(\d+(?:[.,]\d{1,2})?)\s+(?:with|thanks\s+to)\s+uber\s*one\b/i,
    /\buber\s*one\b.{0,40}\bsaved\s+(?:you\s+)?£\s*(\d+(?:[.,]\d{1,2})?)/i
  ]);

  return {
    value: match ? number(match[1].replace(",", ".")) : null,
    match
  };
}

function extractOrderKey(text) {
  const source = String(text || "");
  const dateMatch = source.match(
    /\b(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(20\d{2})\b/i
  );
  const detailIndex = source.toLowerCase().indexOf("order details");
  if (!dateMatch || detailIndex < 0) return null;

  const details = source.slice(detailIndex, detailIndex + 5000);
  const pickup = details.match(
    /\b([01]?\d|2[0-3]):([0-5]\d)\s*[-–—]?\s*(?:pick\s*-?\s*up|pickup)\b/i
  );
  const delivery = details.match(
    /\b([01]?\d|2[0-3]):([0-5]\d)\s*[-–—]?\s*delivery\b/i
  );
  if (!pickup || !delivery) return null;

  const normaliseTime = match =>
    String(match[1]).padStart(2, "0") + ":" + match[2];

  return [
    "date=" + dateMatch[1] + "-" + dateMatch[2].slice(0, 3).toLowerCase() + "-" + dateMatch[3],
    "pickup=" + normaliseTime(pickup),
    "delivery=" + normaliseTime(delivery)
  ].join("|");
}

function extractOrderId(text) {
  const match = firstMatch(text, [
    /(?:order\s*(?:id|number|no\.?|#)|receipt\s*#)\s*[:#-]?\s*([A-Z0-9-]{5,64})/i
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
  const text = receiptText(subject, body);

  const senderAnalysis = analyseSender(sender);

  const receiptSignal =
    /\breceipt\b|\bthanks\s+for\s+(?:your\s+)?order\b|\border\s+(?:with|from)\b|\border\s+total\b/i.test(text);

  const foodSignal =
    /\buber\s*eats\b|\border\b|\brestaurant\b|\bdelivery\b|\bsubtotal\b/i.test(text);

  const subtotal = moneyForLabel(text, ["subtotal", "items subtotal", "estimated subtotal"]);
  const total = moneyForLabel(text, ["new total", "updated total", "final total", "amount charged", "total"]);
  const promotionDiscount = moneyForLabel(text, ["promotion", "promotions", "promo", "discount"]);
  const deliveryFee = moneyForLabel(text, ["delivery fee", "delivery"]);
  const serviceFee = moneyForLabel(text, ["service fee"]);
  const smallOrderFee = moneyForLabel(text, ["small order fee"]);
  const tip = moneyForLabel(text, ["tip"]);
  const uberCashUsed = moneyForLabel(text, ["uber cash", "uber credits"]);
  // A balance payment is not proof that the credit was earned as a promotion.
  const uberCashSavings = moneyForLabel(text, ["uber cash discount", "uber cash promotion", "promotional uber cash"]);
  const reportedSavings = savingsAmount(text);
  const uberOneSavings = uberOneSavingAmount(text);
  const uberOneSignal = uberOneSavings.value != null || /\b(?:your\s+uber\s*one|uber\s*one\s+(?:member\s+)?(?:savings?|benefits?)|as\s+an?\s+uber\s*one\s+member)\b/i.test(text);
  const orderId = extractOrderId(text);
  const orderKey = extractOrderKey(text);

  const hasReceiptAmounts = subtotal.value != null || total.value != null;
  const isReceipt =
    Boolean(senderAnalysis.trusted) && senderAnalysis.confidence === "high" &&
    !hasTransportSignal(subject, text) &&
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
    orderKey,
    merchant: merchantMatch ? merchantMatch[1].trim().slice(0, 120) : null,
    subtotal: subtotal.value,
    promotionDiscount: promotionDiscount.value,
    deliveryFee: deliveryFee.value,
    serviceFee: serviceFee.value,
    smallOrderFee: smallOrderFee.value,
    tip: tip.value,
    uberCashUsed: uberCashUsed.value,
    uberCashSavings: uberCashSavings.value,
    reportedSavings: reportedSavings.value,
    uberOneSavings: uberOneSavings.value,
    uberOneSignal,
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
      reportedSavings: sourceSnippet(text, reportedSavings.match),
      uberOneSavings: sourceSnippet(text, uberOneSavings.match),
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
