const MONTHS = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6,
  aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11
};

const WEEKDAYS = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6
};

function number(value) {
  if (value == null) return null;
  const result = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(result) ? result : null;
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match;
  }
  return null;
}

function asDate(value) {
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value === "string") {
    const simple = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (simple) {
      return new Date(Number(simple[1]), Number(simple[2]) - 1, Number(simple[3]), 12, 0, 0);
    }
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function inferYear(month, day, receivedAt) {
  let year = receivedAt.getFullYear();
  const candidate = new Date(year, month, day, 23, 59, 59);
  const ninetyDays = 90 * 24 * 60 * 60 * 1000;
  if (candidate.getTime() < receivedAt.getTime() - ninetyDays) year++;
  return year;
}

function toIsoDate(year, month, day) {
  const date = new Date(year, month, day, 12, 0, 0);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day
  ) return null;

  return [
    String(year).padStart(4, "0"),
    String(month + 1).padStart(2, "0"),
    String(day).padStart(2, "0")
  ].join("-");
}

function nextWeekday(receivedAt, weekday) {
  const date = new Date(receivedAt.getFullYear(), receivedAt.getMonth(), receivedAt.getDate(), 12, 0, 0);
  const diff = (weekday - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + diff);
  return toIsoDate(date.getFullYear(), date.getMonth(), date.getDate());
}

function senderLooksUber(sender) {
  const value = String(sender || "").toLowerCase();
  if (!value) return false;

  if (/@(?:[a-z0-9-]+\.)?uber\.com(?:\b|>)/i.test(value)) return true;

  return /(?:ubereats|uber)_at_uber_com(?:[_-][^@\s>]*)?@icloud\.com/i.test(value);
}

function extractExpiry(text, receivedAt) {
  const namedDate = firstMatch(text, [
    /(?:expires?|valid\s+(?:until|through|to)|available\s+until|offer\s+available\s+until|ends?|use\s+by|redeem\s+by)\s*(?:on\s*)?(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})(?:\s+(\d{4}))?/i,
    /(?:until|before|through)\s+(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})(?:\s+(\d{4}))?/i
  ]);

  if (namedDate) {
    const day = number(namedDate[1]);
    const month = MONTHS[namedDate[2].toLowerCase()];
    if (month != null && day >= 1 && day <= 31) {
      const year = namedDate[3] ? number(namedDate[3]) : inferYear(month, day, receivedAt);
      return { expires: toIsoDate(year, month, day), expiryBasis: "explicit" };
    }
  }

  const numericDate = firstMatch(text, [
    /(?:expires?|valid\s+(?:until|through|to)|available\s+until|ends?|use\s+by|redeem\s+by)\s*(?:on\s*)?(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?/i
  ]);

  if (numericDate) {
    const day = number(numericDate[1]);
    const month = number(numericDate[2]) - 1;
    let year = numericDate[3] ? number(numericDate[3]) : inferYear(month, day, receivedAt);
    if (year < 100) year += 2000;
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      return { expires: toIsoDate(year, month, day), expiryBasis: "explicit" };
    }
  }

  const weekdayMatch = firstMatch(text, [
    /(?:valid\s+(?:until|through)|expires?(?:\s+on)?|ends?(?:\s+on)?|until|through)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i
  ]);

  if (weekdayMatch) {
    return {
      expires: nextWeekday(receivedAt, WEEKDAYS[weekdayMatch[1].toLowerCase()]),
      expiryBasis: "weekday"
    };
  }

  if (/(?:expires?|valid\s+until|ends?)\s+tomorrow\b/i.test(text)) {
    const date = new Date(receivedAt.getFullYear(), receivedAt.getMonth(), receivedAt.getDate() + 1, 12, 0, 0);
    return { expires: toIsoDate(date.getFullYear(), date.getMonth(), date.getDate()), expiryBasis: "relative" };
  }

  if (/(?:expires?|valid\s+until|ends?)\s+today\b/i.test(text)) {
    return {
      expires: toIsoDate(receivedAt.getFullYear(), receivedAt.getMonth(), receivedAt.getDate()),
      expiryBasis: "relative"
    };
  }

  const durationMatch = firstMatch(text, [
    /valid\s+for\s+(\d{1,3})\s+days?\b/i,
    /(?:validity|valid\s+period)\s+(?:of|is)\s+(\d{1,3})\s+days?\b/i,
    /expires?\s+in\s+(\d{1,3})\s+days?\b/i
  ]);

  const activationBased = /\b(?:since|from|after)\s+(?:it\s+was\s+)?applied\s+to\s+(?:the\s+)?(?:user.?s\s+)?account\b/i.test(text);

  if (durationMatch && !activationBased) {
    const days = number(durationMatch[1]);
    if (days != null && days >= 0 && days <= 365) {
      const date = new Date(receivedAt.getFullYear(), receivedAt.getMonth(), receivedAt.getDate() + days, 12, 0, 0);
      return {
        expires: toIsoDate(date.getFullYear(), date.getMonth(), date.getDate()),
        expiryBasis: "estimated_from_email_date"
      };
    }
  }

  return { expires: null, expiryBasis: null };
}

function extractUses(text) {
  const match = firstMatch(text, [
    /(?:your\s+)?(?:next|first)\s+(\d{1,2})\s+(?:uber\s+)?(?:trips?|rides?|orders?)/i,
    /(?:up\s+to|on)\s+(\d{1,2})\s+(?:uber\s+)?(?:trips?|rides?|orders?)/i,
    /(\d{1,2})\s+(?:eligible\s+)?(?:trips?|rides?|orders?)\b/i
  ]);

  const uses = match ? number(match[1]) : 1;
  return uses && uses > 0 && uses <= 99 ? uses : 1;
}

function extractPerUseCap(text) {
  const match = firstMatch(text, [
    /(?:up\s+to|maximum|max\.?)\s*£\s*(\d+(?:\.\d{1,2})?)\s*(?:off\s*)?(?:per|each)\s*(?:trip|ride|order)/i,
    /£\s*(\d+(?:\.\d{1,2})?)\s*(?:off\s*)?(?:per|each)\s*(?:trip|ride|order)/i
  ]);
  return match ? number(match[1]) : null;
}

export function parseUberPromo({
  subject = "",
  body = "",
  sender = "",
  receivedAt = new Date()
} = {}) {
  const received = asDate(receivedAt);
  const raw = (subject + "\n" + body).replace(/\u00a0/g, " ");
  const text = raw.replace(/\s+/g, " ").trim();
  const trustedSender = senderLooksUber(sender);
  const senderProvided = String(sender || "").trim().length > 0;
  const serviceText = text + " " + sender;

  const isUberOne = /\buber\s*one\b/i.test(serviceText);
  const service = isUberOne
    ? "Uber One"
    : /uber\s*eats|ubereats|\bfood\b|\border\b/i.test(serviceText)
      ? "Uber Eats"
      : "Uber";

  const percentMatch = firstMatch(text, [
    /(\d{1,3})\s*%\s*(?:off|discount)/i,
    /(?:save|get)\s*(\d{1,3})\s*%/i
  ]);

  const fixedMatch = firstMatch(text, [
    /£\s*(\d+(?:\.\d{1,2})?)\s*(?:off|discount)/i,
    /(?:save|get)\s*£\s*(\d+(?:\.\d{1,2})?)/i
  ]);

  const uberCashMatch = firstMatch(text, [
    /£\s*(\d+(?:\.\d{1,2})?)\s+in\s+uber\s+cash\b/i,
    /(?:get|receive)\s+£\s*(\d+(?:\.\d{1,2})?)\s+uber\s+cash\b/i
  ]);

  const perUseCap = extractPerUseCap(text);

  const maxSavingMatch = firstMatch(text, [
    /(?:up\s+to|maximum|max\.?)\s*(?:saving|savings|discount)?\s*£\s*(\d+(?:\.\d{1,2})?)/i,
    /(?:save|discount)\s+up\s+to\s*£\s*(\d+(?:\.\d{1,2})?)/i
  ]);

  const minimumSpendMatch = firstMatch(text, [
    /(?:minimum|min\.?)(?:\s+(?:spend|order|basket))?\s*£\s*(\d+(?:\.\d{1,2})?)/i,
    /£\s*(\d+(?:\.\d{1,2})?)\s+(?:minimum|min\.?)\s+(?:spend|order|basket)/i,
    /(?:when\s+you\s+spend|orders?\s+(?:over|of)|spend\s+at\s+least)\s*£\s*(\d+(?:\.\d{1,2})?)/i
  ]);

  const codeMatch = firstMatch(text, [
    /(?:promo\s+code(?:\s+below)?|use\s+code|using\s+promo\s+code|code)\s*(?:is|[:\-])?\s*([A-Z0-9][A-Z0-9_-]{3,31})\b/i
  ]);

  let discountType = null;
  let discount = null;

  if (percentMatch) {
    discountType = "percent";
    discount = number(percentMatch[1]);
  } else if (fixedMatch) {
    discountType = "fixed";
    discount = number(fixedMatch[1]);
  } else if (uberCashMatch) {
    discountType = "uberCash";
    discount = number(uberCashMatch[1]);
  }

  const uses = extractUses(text);
  const genericMaxSaving = maxSavingMatch ? number(maxSavingMatch[1]) : null;
  const maxSaving = perUseCap != null ? perUseCap : genericMaxSaving;

  let maxTotalSaving = genericMaxSaving;

  if (perUseCap != null) {
    maxTotalSaving = Number((perUseCap * uses).toFixed(2));
  } else if (discountType === "fixed" && discount != null && uses > 1) {
    const genericLooksPerUse = genericMaxSaving == null || genericMaxSaving === discount;
    if (genericLooksPerUse) maxTotalSaving = Number((discount * uses).toFixed(2));
  } else if (discountType === "uberCash" && discount != null) {
    maxTotalSaving = discount;
  }

  const minimumSpend = minimumSpendMatch ? number(minimumSpendMatch[1]) : 0;
  const code = codeMatch ? codeMatch[1].toUpperCase() : null;
  const expiry = extractExpiry(text, received);

  const explicitPromoSignal =
    discount != null ||
    maxSaving != null ||
    code != null ||
    /\b(?:promo(?:tion)?|offer|discount|deal)\b/i.test(text) ||
    (isUberOne && /(?:free|save|£0|trial|months?)/i.test(text));

  const mentionsUber = /\buber\b/i.test(text);
  const senderAccepted = !senderProvided || trustedSender;
  const looksLikePromo = senderAccepted && explicitPromoSignal && (trustedSender || mentionsUber);

  let title = subject.trim();
  if (!title) {
    if (discountType === "percent") title = discount + "% off";
    else if (discountType === "fixed") title = "£" + discount + " off";
    else if (discountType === "uberCash") title = "£" + discount + " Uber Cash";
    else if (isUberOne) title = "Uber One offer";
    else title = service === "Uber Eats" ? "Uber Eats offer" : "Uber offer";
  }

  return {
    isPromo: looksLikePromo,
    service,
    title,
    discountType,
    discount,
    maxSaving,
    perUseCap,
    uses,
    maxTotalSaving,
    minimumSpend,
    code,
    expires: expiry.expires,
    expiryBasis: expiry.expiryBasis,
    senderVerified: senderProvided ? trustedSender : null,
    rejectionReason: senderProvided && !trustedSender ? "sender_not_uber" : null
  };
}
