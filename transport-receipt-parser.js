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

function extractTripId(text) {
  const match = firstMatch(text, [
    /(?:trip|ride|journey)\s*(?:id|number|no\.?|#)\s*[:#-]?\s*([A-Z0-9-]{5,50})/i
  ]);

  return {
    value: match ? match[1].toUpperCase() : null,
    match
  };
}

export function parseUberTransportReceipt({
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

  const eatsSignal =
    /\buber\s*eats\b|\brestaurant\b|\bdelivery\s+fee\b|\bitems\s+subtotal\b/i.test(text);

  const rideSignal =
    /\btrip\s+with\s+uber\b|\byour\s+(?:uber\s+)?trip\b|\bthanks\s+for\s+riding\b|\btrip\s+fare\b|\bride\s+with\s+uber\b/i.test(text);

  const bikeSignal =
    /\buber\s*(?:bike|bikes)\b|\bbike\s+(?:trip|ride)\b|\bcycle\s+(?:trip|ride)\b/i.test(text);

  const total = moneyForLabel(text, [
    "trip total",
    "ride total",
    "amount charged",
    "fare",
    "total"
  ]);

  const tripId = extractTripId(text);

  const isReceipt =
    Boolean(senderAnalysis.trusted) &&
    (!eatsSignal || hasTransportSignal(subject, text)) &&
    (rideSignal || bikeSignal) &&
    total.value != null;

  const received = asDate(receivedAt);
  const sent = sentAt ? asDate(sentAt) : received;

  return {
    parserVersion: PARSER_VERSION,
    isReceipt,
    accepted: isReceipt,
    messageType: "transport_receipt",
    service: "Uber",
    transportMode: bikeSignal ? "bike" : "ride",
    messageId: messageId || null,
    mailbox: mailbox || null,
    accountAlias: extractAccountAlias(recipient),
    sentAt: sent.toISOString(),
    receivedAt: received.toISOString(),
    tripId: tripId.value,
    total: total.value,
    senderVerified: senderAnalysis.trusted,
    senderConfidence: senderAnalysis.confidence,
    evidence: {
      total: sourceSnippet(text, total.match),
      tripId: sourceSnippet(text, tripId.match),
      senderBasis: senderAnalysis.basis
    }
  };
}
