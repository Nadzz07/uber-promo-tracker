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

function normaliseToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function extractTripKey(text, { bikeSignal = false } = {}) {
  const source = String(text || "");
  const dateMatch = source.match(
    /\b(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?\s*,?\s*(\d{1,2})\s+([a-z]{3,9})\s+(20\d{2})\b/i
  ) || source.match(
    /\b(\d{1,2})\s+([a-z]{3,9})\s+(20\d{2})\b/i
  );

  const times = [...source.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g)]
    .slice(0, 2)
    .map(match => String(match[1]).padStart(2, "0") + ":" + match[2]);

  const distanceMatch = source.match(
    /\b(\d+(?:[.,]\d+)?)\s*(miles?|mi|km|kilomet(?:er|re)s?)\b/i
  );
  const durationMatch = source.match(
    /\b(\d{1,3})\s*(minutes?|mins?|min)\b/i
  );
  const bikeNumberMatch = source.match(
    /\bbike\s*(?:number|no\.?|#)?\s*[:#-]?\s*([A-Z0-9-]{3,30})\b/i
  );
  const productMatch = source.match(
    /\b(UberX|UberXL|Comfort|Green|Exec|Taxi|Black|LIME\s+bike|Lime\s+e-?bike)\b/i
  );

  const facts = {
    date: dateMatch ? normaliseToken(dateMatch[0]) : null,
    startTime: times[0] || null,
    endTime: times[1] || null,
    distance: distanceMatch
      ? normaliseToken(distanceMatch[1].replace(",", ".") + " " + distanceMatch[2])
      : null,
    duration: durationMatch ? normaliseToken(durationMatch[1] + " min") : null,
    bikeNumber: bikeNumberMatch ? normaliseToken(bikeNumberMatch[1]) : null,
    product: productMatch
      ? normaliseToken(productMatch[1])
      : (bikeSignal ? "bike" : null)
  };

  const strongFacts = [
    facts.date,
    facts.startTime && facts.endTime ? facts.startTime + "-" + facts.endTime : null,
    facts.bikeNumber,
    facts.distance && facts.duration ? facts.distance + "/" + facts.duration : null
  ].filter(Boolean);

  return strongFacts.length >= 2
    ? Object.entries(facts)
        .filter(([, value]) => value)
        .map(([key, value]) => key + "=" + value)
        .join("|")
    : null;
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
    /\buber\s*(?:bike|bikes)\b|\blime\s+(?:e-?bike|bike)\b|\bbike\s+(?:trip|ride|number)\b|\bcycle\s+(?:trip|ride)\b|\bthanks\s+for\s+choosing\s+lime\s+bike\b/i.test(text);

  const total = moneyForLabel(text, [
    "trip total",
    "ride total",
    "amount charged",
    "fare",
    "total"
  ]);

  const tripId = extractTripId(text);
  const tripKey = extractTripKey(text, { bikeSignal });

  const isReceipt =
    Boolean(senderAnalysis.trusted) &&
    (!eatsSignal || hasTransportSignal(subject, text) || bikeSignal) &&
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
    tripKey,
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
