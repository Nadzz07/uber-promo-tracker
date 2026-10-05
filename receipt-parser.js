function number(value) {
  if (value == null) return null;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function accountAlias(recipient) {
  const match = String(recipient || "").match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
  return match ? match[1].toLowerCase() : null;
}

function senderLooksUber(sender) {
  const value = String(sender || "").toLowerCase();
  if (!value) return false;
  if (/@(?:[a-z0-9-]+\.)?uber\.com(?:\b|>)/i.test(value)) return true;
  return /(?:ubereats|uber)_at_uber_com(?:[_-][^@\s>]*)?@icloud\.com/i.test(value);
}

function moneyForLabel(text, labels) {
  for (const label of labels) {
    const pattern = new RegExp(
      "(?:^|\\b)" + label + "\\b[^£\\d-]{0,28}(?:-\\s*)?£\\s*(\\d+(?:[.,]\\d{1,2})?)",
      "i"
    );
    const match = text.match(pattern);
    if (match) return number(match[1].replace(",", "."));
  }
  return null;
}

function orderId(text) {
  const match = text.match(/(?:order\s*(?:number|no\.?|#)|receipt\s*#)\s*[:#-]?\s*([A-Z0-9-]{5,40})/i);
  return match ? match[1].toUpperCase() : null;
}

export function parseUberEatsReceipt({
  subject = "",
  body = "",
  sender = "",
  recipient = "",
  receivedAt = new Date()
} = {}) {
  const text = (subject + "\n" + body)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ");

  const senderVerified = senderLooksUber(sender);
  const receiptSignal =
    /\breceipt\b|\bthanks\s+for\s+(?:your\s+)?order\b|\border\s+(?:with|from)\b|\border\s+total\b/i.test(text);

  const foodSignal =
    /\buber\s*eats\b|\border\b|\brestaurant\b|\bdelivery\b|\bsubtotal\b/i.test(text);

  const subtotal = moneyForLabel(text, ["subtotal", "items subtotal", "estimated subtotal"]);
  const total = moneyForLabel(text, ["total", "final total", "amount charged"]);
  const promotionDiscount = moneyForLabel(text, ["promotion", "promotions", "promo", "discount"]);
  const deliveryFee = moneyForLabel(text, ["delivery fee", "delivery"]);
  const serviceFee = moneyForLabel(text, ["service fee"]);
  const smallOrderFee = moneyForLabel(text, ["small order fee"]);
  const tip = moneyForLabel(text, ["tip"]);
  const uberCashUsed = moneyForLabel(text, ["uber cash", "uber credits"]);

  const hasReceiptAmounts = subtotal != null || total != null;
  const isReceipt = senderVerified && receiptSignal && foodSignal && hasReceiptAmounts;

  const date = new Date(receivedAt);
  const isoReceivedAt = Number.isNaN(date.getTime()) ? null : date.toISOString();

  const merchantMatch =
    String(subject).match(/(?:order|receipt)\s+(?:from|with)\s+(.+?)(?:\s+is\b|\s*[|–—-]|$)/i);

  return {
    isReceipt,
    service: "Uber Eats",
    accountAlias: accountAlias(recipient),
    receivedAt: isoReceivedAt,
    orderId: orderId(text),
    merchant: merchantMatch ? merchantMatch[1].trim().slice(0, 120) : null,
    subtotal,
    promotionDiscount,
    deliveryFee,
    serviceFee,
    smallOrderFee,
    tip,
    uberCashUsed,
    total,
    senderVerified
  };
}

export function parseUberEatsReceipts(messages = []) {
  return messages
    .map(parseUberEatsReceipt)
    .filter(receipt => receipt.isReceipt);
}
