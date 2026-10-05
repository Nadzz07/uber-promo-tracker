import {
  asDate,
  firstMatch,
  isoDate,
  localDateTimeString,
  number,
  sourceSnippet
} from "./utils.js";

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

function inferYear(month, day, receivedAt) {
  let year = receivedAt.getFullYear();
  const candidate = new Date(year, month, day, 23, 59, 59);
  const ninetyDays = 90 * 24 * 60 * 60 * 1000;

  if (candidate.getTime() < receivedAt.getTime() - ninetyDays) year++;
  return year;
}

function parseClock(hourText, minuteText, meridiemText) {
  if (hourText == null) return { hour: 23, minute: 59, second: 59, explicit: false };

  let hour = number(hourText);
  const minute = number(minuteText) || 0;
  const meridiem = String(meridiemText || "").toLowerCase();

  if (hour == null || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return { hour: 23, minute: 59, second: 59, explicit: false };
  }

  if (meridiem === "am" || meridiem === "pm") {
    hour %= 12;
    if (meridiem === "pm") hour += 12;
  }

  return { hour, minute, second: 0, explicit: true };
}

function explicitResult(text, match, year, month, day, clock) {
  const expires = isoDate(year, month, day);
  if (!expires) return null;

  return {
    expires,
    expiresAt: localDateTimeString(
      year,
      month,
      day,
      clock.hour,
      clock.minute,
      clock.second
    ),
    expiryStatus: "exact",
    expiryBasis: "explicit_in_offer_terms",
    expiryConfidence: "high",
    expirySourceText: sourceSnippet(text, match)
  };
}

function nextWeekday(receivedAt, weekday) {
  const date = new Date(
    receivedAt.getFullYear(),
    receivedAt.getMonth(),
    receivedAt.getDate(),
    12,
    0,
    0
  );

  const diff = (weekday - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + diff);
  return date;
}

export function extractExpiry(text, receivedAtValue) {
  const receivedAt = asDate(receivedAtValue);

  const named = firstMatch(text, [
    /(?:expires?|valid\s+(?:until|through|to)|available\s+until|offer\s+(?:is\s+)?available\s+until|offer\s+valid\s+until|ends?|use\s+by|redeem\s+by)\s*(?:(?:on|at)\s*)?(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})(?:\s+(\d{4}))?(?:\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm))?/i,
    /(?:until|before|through)\s+(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})(?:\s+(\d{4}))?(?:\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm))?/i
  ]);

  if (named) {
    const day = number(named[1]);
    const month = MONTHS[String(named[2]).toLowerCase()];

    if (month != null && day >= 1 && day <= 31) {
      const year = named[3]
        ? number(named[3])
        : inferYear(month, day, receivedAt);

      const clock = parseClock(named[4], named[5], named[6]);
      const result = explicitResult(text, named, year, month, day, clock);
      if (result) return result;
    }
  }

  const numeric = firstMatch(text, [
    /(?:expires?|valid\s+(?:until|through|to)|available\s+until|ends?|use\s+by|redeem\s+by)\s*(?:(?:on|at)\s*)?(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?(?:\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm))?/i
  ]);

  if (numeric) {
    const first = number(numeric[1]);
    const second = number(numeric[2]);
    let year = numeric[3]
      ? number(numeric[3])
      : inferYear(second - 1, first, receivedAt);

    if (year < 100) year += 2000;

    // UK-first. If the first component cannot be a month, interpretation is unambiguous.
    const day = first;
    const month = second - 1;

    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      const clock = parseClock(numeric[4], numeric[5], numeric[6]);
      const result = explicitResult(text, numeric, year, month, day, clock);
      if (result) return result;
    }
  }

  const weekday = firstMatch(text, [
    /(?:valid\s+(?:until|through)|expires?(?:\s+on)?|ends?(?:\s+on)?|until|through)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i
  ]);

  if (weekday) {
    const date = nextWeekday(receivedAt, WEEKDAYS[weekday[1].toLowerCase()]);
    return {
      expires: isoDate(date.getFullYear(), date.getMonth(), date.getDate()),
      expiresAt: localDateTimeString(date.getFullYear(), date.getMonth(), date.getDate()),
      expiryStatus: "estimated",
      expiryBasis: "weekday_from_email_date",
      expiryConfidence: "medium",
      expirySourceText: sourceSnippet(text, weekday)
    };
  }

  const relative = firstMatch(text, [
    /(?:expires?|valid\s+until|ends?)\s+(today|tomorrow)\b/i
  ]);

  if (relative) {
    const offset = relative[1].toLowerCase() === "tomorrow" ? 1 : 0;
    const date = new Date(
      receivedAt.getFullYear(),
      receivedAt.getMonth(),
      receivedAt.getDate() + offset,
      12,
      0,
      0
    );

    return {
      expires: isoDate(date.getFullYear(), date.getMonth(), date.getDate()),
      expiresAt: localDateTimeString(date.getFullYear(), date.getMonth(), date.getDate()),
      expiryStatus: "estimated",
      expiryBasis: "relative_to_email_date",
      expiryConfidence: "medium",
      expirySourceText: sourceSnippet(text, relative)
    };
  }

  const duration = firstMatch(text, [
    /valid\s+for\s+(\d{1,3})\s+days?\b/i,
    /(?:validity|valid\s+period)\s+(?:of|is)\s+(\d{1,3})\s+days?\b/i,
    /expires?\s+in\s+(\d{1,3})\s+days?\b/i
  ]);

  const activationBased =
    /\b(?:since|from|after)\s+(?:it\s+was\s+)?applied\s+to\s+(?:the\s+)?(?:user.?s\s+)?account\b/i.test(text);

  if (duration && activationBased) {
    return {
      expires: null,
      expiresAt: null,
      expiryStatus: "unknown",
      expiryBasis: "activation_date_unknown",
      expiryConfidence: null,
      expirySourceText: sourceSnippet(text, duration)
    };
  }

  if (duration) {
    const days = number(duration[1]);

    if (days != null && days >= 0 && days <= 365) {
      const date = new Date(receivedAt.getTime());
      date.setDate(date.getDate() + days);

      return {
        expires: isoDate(date.getFullYear(), date.getMonth(), date.getDate()),
        expiresAt: date.toISOString(),
        expiryStatus: "estimated",
        expiryBasis: "estimated_from_email_date",
        expiryConfidence: "medium",
        expirySourceText: sourceSnippet(text, duration)
      };
    }
  }

  return {
    expires: null,
    expiresAt: null,
    expiryStatus: "unknown",
    expiryBasis: null,
    expiryConfidence: null,
    expirySourceText: null
  };
}
