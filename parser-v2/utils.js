export const PARSER_VERSION = 3;

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
  if (value == null || value === '') throw new Error('Missing message date');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error('Invalid message date');
  const dateOnly = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly && parsed.toISOString().slice(0, 10) !== value) throw new Error('Invalid calendar date');
  return parsed;
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
  const addresses = [...new Set((String(recipient || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map(a => a.toLowerCase()))];
  return addresses.length === 1 ? addresses[0] : null;
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
