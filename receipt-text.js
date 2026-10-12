import { number } from "./parser-v2/utils.js";

// Apply at the confirmation boundary too: legacy imports may already have
// replaced outer headers, and JSON imports do not pass through the MBOX codec.
export function hasForwardedReceiptClaims(subject, body) {
  const text = receiptText('', body);
  const marker = /(?:-{2,}\s*Forwarded\s+message\s*-{2,}|Begin\s+forwarded\s+message:)/i;
  return /^\s*(?:fw|fwd):/i.test(String(subject || '')) ||
    marker.test(String(body || '')) || marker.test(text);
}

export function receiptText(subject, body) {
  return (String(subject || "") + "\n" + String(body || ""))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<(?:br\s*\/?|\/p|\/div|\/tr|\/td)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|#160);|\u00a0/gi, " ")
    .replace(/&(?:pound|#163|#xA3);/gi, "£")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ");
}

export function moneyForLabel(text, labels) {
  for (const label of labels) {
    // A label may be on the previous line. Never skip arbitrary words, which
    // confused "Total savings" with "Total" and crossed into unrelated rows.
    const match = text.match(new RegExp("(?:^|\\b)" + label +
      "\\b\\s*(?:[:：]\\s*)?(?:[−–-]\\s*)?£\\s*(\\d{1,3}(?:,\\d{3})+(?:\\.\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)\\b", "i"));
    if (match) {
      const amount = match[1];
      return { value: number(/,\d{3}(?:[,.]|$)/.test(amount) ? amount : amount.replace(",", ".")), match };
    }
  }
  return { value: null, match: null };
}

export function receiptFinancialEvidence(text) {
  const combined=/£\s*\d+(?:[.,]\d{1,2})?\s+uber\s*one\s+savings?\s+and\s+other\s+promotions?\s+applied/i.test(text);
  const payment=text.match(/\b(?:mastercard|visa|amex|card payment|paid by card)\b[^\n£]{0,80}£\s*(\d+(?:\.\d{1,2})?)/i);
  return {reportedKind:combined?'combined':'total',scheduleSavings:moneyForLabel(text,['schedule savings','scheduled savings','schedule discount']).value,
    outOfPocket:payment?Number(payment[1]):null};
}

export function hasTransportSignal(subject, text) {
  const pattern = /\btrip\s+with\s+uber\b|\byour\s+(?:uber\s+)?trip\b|\bthanks\s+for\s+riding\b|\btrip\s+fare\b|\bride\s+with\s+uber\b|\bbike\s+(?:trip|ride)\b|\bcycle\s+(?:trip|ride)\b|\blime\s+(?:e-?bike|bike|ride|receipt)\b|\bthanks\s+for\s+(?:riding\s+with|choosing)\s+lime\b/;
  return pattern.test(String(subject).toLowerCase()) || pattern.test(String(text).slice(0, 600).toLowerCase());
}
