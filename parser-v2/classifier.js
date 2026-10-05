const EXCLUDED_CATEGORIES = [
  "grocery",
  "groceries",
  "supermarket",
  "convenience store",
  "alcohol",
  "tobacco"
];

export function classifyMessage({ subject, text, senderAnalysis, offer }) {
  const subjectText = String(subject || "");
  const corpus = String(text || "");
  const lowerSubject = subjectText.toLowerCase();

  const receiptSignal =
    /\breceipt\b|\bthanks\s+for\s+(?:your\s+)?order\b|\border\s+total\b/i.test(corpus);

  if (receiptSignal) {
    return {
      accepted: false,
      offerType: "non_promo",
      service: "Uber Eats",
      confidence: "high",
      rejectionReason: "receipt_not_promo"
    };
  }

  const excludedCategory = EXCLUDED_CATEGORIES.find(term => lowerSubject.includes(term));

  if (excludedCategory) {
    return {
      accepted: false,
      offerType: "non_promo",
      service: "Uber Eats",
      confidence: "high",
      rejectionReason: "category_excluded"
    };
  }

  const isUberOne = /\buber\s*one\b/i.test(corpus);
  const rideSubject = /\b(?:rides?|road trip|trips?|car ride|car rides|car)\b/i.test(subjectText);
  const orderSignal = /uber\s*eats|ubereats|\bfood\b|\border\b|\bdelivery\b/i.test(corpus);
  const mentionsUberCash = offer.discountType === "uberCash" || /\buber\s+cash\b/i.test(corpus);

  let service = "Uber";
  if (isUberOne) service = "Uber One";
  else if (orderSignal && !rideSubject) service = "Uber Eats";
  else if (mentionsUberCash && /\border\b|uber\s*eats/i.test(corpus)) service = "Uber Eats";

  let offerType = "non_promo";

  if (offer.discountType === "uberCash") {
    offerType = "uber_cash";
  } else if (rideSubject && offer.discountType === "percent") {
    offerType = "ride_percentage_discount";
  } else if (rideSubject && offer.discountType === "fixed") {
    offerType = "ride_fixed_discount";
  } else if (offer.discountType === "percent") {
    offerType = "percentage_discount";
  } else if (offer.discountType === "fixed" && Number(offer.uses || 1) > 1) {
    offerType = "multi_order_discount";
  } else if (offer.discountType === "fixed") {
    offerType = "fixed_order_discount";
  } else if (/\b(?:reminder|still\s+have|waiting\s+in\s+your\s+account)\b/i.test(corpus)) {
    offerType = "reminder";
  }

  const explicitPromoSignal =
    offer.discount != null ||
    offer.maxSaving != null ||
    offer.code != null ||
    /\b(?:promo(?:tion)?|offer|discount|deal)\b/i.test(corpus) ||
    (isUberOne && /(?:free|save|£0|trial|months?)/i.test(corpus));

  if (senderAnalysis.provided && !senderAnalysis.trusted) {
    return {
      accepted: false,
      offerType,
      service,
      confidence: "low",
      rejectionReason: "sender_not_uber"
    };
  }

  if (!explicitPromoSignal) {
    return {
      accepted: false,
      offerType: "non_promo",
      service,
      confidence: senderAnalysis.confidence,
      rejectionReason: "no_promo_signal"
    };
  }

  return {
    accepted: true,
    offerType,
    service,
    confidence:
      senderAnalysis.confidence === "high" && offer.discount != null
        ? "high"
        : "medium",
    rejectionReason: null
  };
}
