export const PARSER_VERSION = 2;

export function number(value) {
  if (value == null || value === "") return null;
  const result = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(result) ? result : null;
}

export function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match;
  }
  return null;
}

export function asDate(value) {
  if (value instanceof Date) return new Date(value.getTime());

  if (typeof value === "string") {
    const simple = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (simple) {
      return new Date(
        Number(simple[1]),
        Number(simple[2]) - 1,
        Number(simple[3]),
        12,
        0,
        0
      );
    }
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export function normaliseText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\r?\n+/g, "\n")
    .trim();
}

export function singleLine(value) {
  return normaliseText(value).replace(/\s+/g, " ").trim();
}

export function extractAccountAlias(recipient) {
  const match = String(recipient || "")
    .match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);

  return match ? match[1].toLowerCase() : null;
}

export function sourceSnippet(text, match, radius = 70) {
  if (!match) return null;

  const source = String(text || "");
  const index = Number.isInteger(match.index) ? match.index : source.indexOf(match[0]);
  if (index < 0) return singleLine(match[0]);

  const start = Math.max(0, index - radius);
  const end = Math.min(source.length, index + match[0].length + radius);
  return singleLine(source.slice(start, end));
}

export function isoDate(year, monthIndex, day) {
  const date = new Date(year, monthIndex, day, 12, 0, 0);

  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== monthIndex ||
    date.getDate() !== day
  ) {
    return null;
  }

  return [
    String(year).padStart(4, "0"),
    String(monthIndex + 1).padStart(2, "0"),
    String(day).padStart(2, "0")
  ].join("-");
}

export function localDateTimeString(year, monthIndex, day, hour = 23, minute = 59, second = 59) {
  const date = isoDate(year, monthIndex, day);
  if (!date) return null;

  return (
    date +
    "T" +
    String(hour).padStart(2, "0") +
    ":" +
    String(minute).padStart(2, "0") +
    ":" +
    String(second).padStart(2, "0")
  );
}
