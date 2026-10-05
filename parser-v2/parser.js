import { classifyMessage } from "./classifier.js";
import { extractOfferDetails } from "./discount.js";
import { extractExpiry } from "./expiry.js";
import { analyseSender } from "./sender.js";
import {
  asDate,
  extractAccountAlias,
  normaliseText,
  PARSER_VERSION
} from "./utils.js";

export function parseUberPromoV2({
  subject = "",
  body = "",
  sender = "",
  recipient = "",
  receivedAt = new Date(),
  sentAt = null,
  messageId = null,
  mailbox = null
} = {}) {
  const received = asDate(receivedAt);
  const sent = sentAt ? asDate(sentAt) : received;
  const rawText = normaliseText(subject + "\n" + body);
  const compactText = rawText.replace(/\s+/g, " ").trim();

  const senderAnalysis = analyseSender(sender);
  const offer = extractOfferDetails(compactText);
  const expiry = extractExpiry(compactText, sent);
  const classification = classifyMessage({
    subject,
    text: compactText + " " + sender,
    senderAnalysis,
    offer
  });

  let title = String(subject || "").trim();

  if (!title) {
    if (offer.discountType === "uberCash") title = "£" + offer.discount + " Uber Cash";
    else if (offer.discountType === "percent") title = offer.discount + "% off";
    else if (offer.discountType === "fixed") title = "£" + offer.discount + " off";
    else title = classification.service === "Uber Eats" ? "Uber Eats offer" : "Uber offer";
  }

  return {
    parserVersion: PARSER_VERSION,
    isPromo: classification.accepted,
    accepted: classification.accepted,
    messageType: "promo",
    messageId: messageId || null,
    mailbox: mailbox || null,
    receivedAt: received.toISOString(),
    emailSentAt: sent.toISOString(),
    accountAlias: extractAccountAlias(recipient),
    service: classification.service,
    offerType: classification.offerType,
    classificationConfidence: classification.confidence,
    title,
    discountType: offer.discountType,
    discount: offer.discount,
    maxSaving: offer.maxSaving,
    perUseCap: offer.perUseCap,
    uses: offer.uses,
    maxTotalSaving: offer.maxTotalSaving,
    minimumSpend: offer.minimumSpend,
    code: offer.code,
    expires: expiry.expires,
    expiresAt: expiry.expiresAt,
    expiryStatus: expiry.expiryStatus,
    expiryBasis: expiry.expiryBasis,
    expiryConfidence: expiry.expiryConfidence,
    senderVerified: senderAnalysis.provided ? senderAnalysis.trusted : null,
    senderConfidence: senderAnalysis.confidence,
    senderBasis: senderAnalysis.basis,
    rejectionReason: classification.rejectionReason,
    evidence: {
      ...offer.evidence,
      expiry: expiry.expirySourceText,
      senderBasis: senderAnalysis.basis
    }
  };
}
