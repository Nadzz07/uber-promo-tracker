const EXCLUDED_CATEGORIES = [
  "grocery",
  "groceries",
  "supermarket",
  "convenience store",
  "alcohol",
  "tobacco"
];

export function classifyMessage({ subject, text, contentText = text, senderAnalysis, offer }) {
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

  const content = String(contentText || "");
  const firstOne = content.search(/\buber\s*one\b/i);
  const discountPosition = offer.evidence?.discountPosition;
  const subjectDiscount = /(?:£\s*\d+(?:\.\d{1,2})?\s*(?:off|discount)|\d{1,3}\s*%\s*(?:off|discount)|\bsave\s+\d{1,3}\s*%|£\s*\d+(?:\.\d{1,2})?\s+(?:in\s+)?uber\s+cash)/i.test(subjectText);
  const foodSubject = /uber\s*eats|ubereats|\b(?:food|orders?|deliver(?:y|ies)|meals?|basket)\b/i.test(subjectText);
  const rideSubject = /\b(?:rides?|road trip|trips?|car ride|car rides|car)\b/i.test(subjectText);
  const oneSubject = /\buber\s*one\b/i.test(subjectText);
  const membershipTerms = /\buber\s*one\b.{0,120}\b(?:free|trial|membership|subscription|months?)\b|\b(?:free|trial|membership|subscription)\b.{0,100}\buber\s*one\b/i;
  const beforeDiscount = discountPosition == null ? content : content.slice(0, discountPosition);
  const firstFood = content.search(/uber\s*eats|ubereats|\b(?:food|orders?|deliver(?:y|ies)|meals?|basket)\b/i);
  // Service follows the primary promotion. A trial heading is membership;
  // an order/ride coupon does not become membership because of a later upsell.
  const isUberOne = (oneSubject && !foodSubject && !rideSubject) ||
    (!subjectDiscount && !foodSubject && !rideSubject && firstOne >= 0 &&
      (firstFood < 0 || firstOne < firstFood) && membershipTerms.test(beforeDiscount));
  const orderSignal = /uber\s*eats|ubereats|\bfood\b|\border\b|\bdelivery\b/i.test(corpus);
  const mentionsUberCash = offer.discountType === "uberCash" || /\buber\s+cash\b/i.test(corpus);

  let service = "Uber";
  // A membership upsell or legal footer does not turn a Cash offer for food
  // into an Uber One subscription. Cash messages retain their stated use;
  // ride-only and unspecified Cash stay separate from Eats.
  if (isUberOne) service = "Uber One";
  else if (offer.discountType === "uberCash") {
    if (orderSignal && !rideSubject) service = "Uber Eats";
  }
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

  if (oneSubject && (foodSubject || rideSubject) && offer.discountType) {
    return {
      accepted: false,
      offerType: "non_promo",
      service,
      confidence: "medium",
      rejectionReason: "membership_eligibility_unconfirmed"
    };
  }

  // Numeric benefits after a membership section, with no primary coupon in
  // the heading, do not establish a usable food/ride offer. Preserve privately
  // instead of promoting an unrelated member benefit into an available deal.
  if (!isUberOne && offer.discountType && !subjectDiscount &&
      firstOne >= 0 && Number.isInteger(discountPosition) && firstOne < discountPosition) {
    return {
      accepted: false,
      offerType: "non_promo",
      service,
      confidence: "medium",
      rejectionReason: "secondary_discount_terms"
    };
  }

  // A purchased balance, top-up or earned reward is not an immediately usable
  // promotional offer. Examine the headline, rather than legal terms which
  // often mention purchases/referrals on genuine promotional Cash emails.
  const headline = subjectText || corpus.slice(0, 200);
  if (offer.discountType === "uberCash" &&
      /\b(?:purchased?|top[ -]?up|topped\s+up|balance\s+(?:statement|updated)|(?:you(?:'ve|\s+have)?\s+)?earned)\b/i.test(headline)) {
    return {
      accepted: false,
      offerType: "non_promo",
      service,
      confidence: senderAnalysis.confidence,
      rejectionReason: "cash_balance_not_promo"
    };
  }
  if (offer.discountType === "uberCash" &&
      /\b(?:earn\b|referr?als?\b|refer\s+(?:a|your)|invite\s+(?:a|your))\b/i.test(headline)) {
    return {
      accepted: false,
      offerType: "non_promo",
      service,
      confidence: senderAnalysis.confidence,
      rejectionReason: "cash_requires_action"
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

  // Marketing copy and footer references to "offers" do not establish an
  // actual discount. Keep the original message privately without publishing a
  // generic, unusable deal. Uber One trials remain a separate service.
  if (offerType === "non_promo" && !isUberOne) {
    return {
      accepted: false,
      offerType,
      service,
      confidence: "medium",
      rejectionReason: "no_usable_promo_terms"
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
