import { analyseSender } from "./parser-v2/sender.js";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { offerTime } from "./offer-time.js";

const MBOX_SEPARATOR = /^From\s+\S+\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+/;
const MAX_MIME_DEPTH = 12;

function hash(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function decodeWindows1252(buffer) {
  const remap = new Map([
    [0x80, "€"], [0x82, "‚"], [0x83, "ƒ"], [0x84, "„"], [0x85, "…"],
    [0x86, "†"], [0x87, "‡"], [0x88, "ˆ"], [0x89, "‰"], [0x8a, "Š"],
    [0x8b, "‹"], [0x8c, "Œ"], [0x8e, "Ž"], [0x91, "‘"], [0x92, "’"],
    [0x93, "“"], [0x94, "”"], [0x95, "•"], [0x96, "–"], [0x97, "—"],
    [0x98, "˜"], [0x99, "™"], [0x9a, "š"], [0x9b, "›"], [0x9c, "œ"],
    [0x9e, "ž"], [0x9f, "Ÿ"]
  ]);
  let out = "";
  for (const byte of buffer) out += remap.get(byte) ?? String.fromCharCode(byte);
  return out;
}

function decodeBytes(buffer, charset = "utf-8") {
  const value = String(charset || "utf-8").trim().toLowerCase().replace(/["']/g, "");
  if (["utf-8", "utf8", "us-ascii", "ascii"].includes(value)) return buffer.toString("utf8");
  if (["iso-8859-1", "latin1", "latin-1"].includes(value)) return buffer.toString("latin1");
  if (["windows-1252", "cp1252"].includes(value)) return decodeWindows1252(buffer);
  if (["utf-16le", "utf16le"].includes(value)) return buffer.toString("utf16le");
  return buffer.toString("utf8");
}

function decodeQuotedPrintableToBuffer(value, { header = false } = {}) {
  let text = String(value || "");
  if (header) text = text.replace(/_/g, " ");
  text = text.replace(/=\r?\n/g, "");
  const bytes = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) {
      bytes.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      for (const byte of Buffer.from(text[i], "utf8")) bytes.push(byte);
    }
  }
  return Buffer.from(bytes);
}

export function decodeHeaderValue(value) {
  return String(value || "").replace(
    /=\?([^?\s]+)\?([bBqQ])\?([^?]*)\?=/g,
    (_, charset, encoding, encoded) => {
      try {
        const buffer = encoding.toUpperCase() === "B"
          ? Buffer.from(encoded.replace(/\s+/g, ""), "base64")
          : decodeQuotedPrintableToBuffer(encoded, { header: true });
        return decodeBytes(buffer, charset);
      } catch {
        return _;
      }
    }
  );
}

function parseHeaderBlock(block) {
  const unfolded = String(block || "").replace(/\n[ \t]+/g, " ");
  const headers = new Map();
  for (const line of unfolded.split("\n")) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1].trim().toLowerCase();
    const value = decodeHeaderValue(match[2].trim());
    if (!headers.has(key)) headers.set(key, []);
    headers.get(key).push(value);
  }
  return headers;
}

function firstHeader(headers, name) {
  return headers.get(String(name).toLowerCase())?.[0] || "";
}

function firstEmail(value) {
  const match = String(value || "").match(/([A-Z0-9._%+\-='\x60{}~]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
  return match ? match[1].toLowerCase() : "";
}

function recipientFromHeaders(headers) {
  // Original To is the account identity; Delivered-To may be a forwarding inbox.
  const original = (headers.get('to') || []).join(',');
  const aliases = [...new Set((original.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map(a => a.toLowerCase()))];
  if (aliases.length > 1) return '';
  if (aliases.length === 1) return aliases[0];
  for (const name of ['x-original-to', 'x-envelope-to', 'envelope-to', 'delivered-to']) {
    for (const value of headers.get(name) || []) { const email = firstEmail(value); if (email) return email; }
  }
  return '';
}

function parseContentType(value) {
  const raw = String(value || "text/plain");
  const [typePart, ...parameters] = raw.split(";");
  const type = typePart.trim().toLowerCase() || "text/plain";
  const params = {};
  for (const item of parameters) {
    const match = item.match(/^\s*([^=]+)=\s*(?:"([^"]*)"|'([^']*)'|(.+))\s*$/);
    if (!match) continue;
    params[match[1].trim().toLowerCase()] = (match[2] ?? match[3] ?? match[4] ?? "").trim();
  }
  return { type, params };
}

function decodeTransfer(body, encoding, charset) {
  const kind = String(encoding || "").trim().toLowerCase();
  try {
    if (kind === "base64") {
      return decodeBytes(Buffer.from(String(body || "").replace(/\s+/g, ""), "base64"), charset);
    }
    if (kind === "quoted-printable") {
      return decodeBytes(decodeQuotedPrintableToBuffer(body), charset);
    }
  } catch {}
  return String(body || "");
}

function splitEntity(raw) {
  const match = String(raw || "").match(/\n\s*\n/);
  if (!match) return { headerBlock: String(raw || ""), body: "" };
  const index = match.index;
  return {
    headerBlock: raw.slice(0, index),
    body: raw.slice(index + match[0].length)
  };
}

function splitMultipart(body, boundary) {
  if (!boundary) return [];
  const marker = "--" + boundary;
  const endMarker = marker + "--";
  const parts = [];
  let current = null;
  for (const line of String(body || "").split("\n")) {
    const trimmed = line.replace(/\r$/, "");
    if (trimmed === marker || trimmed === endMarker) {
      if (current && current.length) parts.push(current.join("\n"));
      current = trimmed === endMarker ? null : [];
      if (trimmed === endMarker) break;
      continue;
    }
    if (current) current.push(line);
  }
  if (current && current.length) parts.push(current.join("\n"));
  return parts;
}

function decodeMimeEntity(raw, depth = 0) {
  if (depth > MAX_MIME_DEPTH) return [];
  const { headerBlock, body } = splitEntity(raw);
  const headers = parseHeaderBlock(headerBlock);
  const { type, params } = parseContentType(firstHeader(headers, "content-type"));
  const disposition = firstHeader(headers, "content-disposition").toLowerCase();
  const encoding = firstHeader(headers, "content-transfer-encoding");
  const charset = params.charset || "utf-8";

  if (type.startsWith("multipart/")) {
    return splitMultipart(body, params.boundary)
      .flatMap(part => decodeMimeEntity(part, depth + 1));
  }

  if (type === "message/rfc822") return decodeMimeEntity(body, depth + 1);
  if (!type.startsWith("text/")) return [];
  if (/\battachment\b/i.test(disposition)) return [];

  const decoded = decodeTransfer(body, encoding, charset).trim();
  return decoded ? [{ type, text: decoded }] : [];
}

function receivedAtFromHeaders(headers) {
  for (const value of headers.get("received") || []) {
    const semi = value.lastIndexOf(";");
    const candidate = semi >= 0 ? value.slice(semi + 1).trim() : "";
    if (!candidate) continue;
    const date = new Date(candidate);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  return null;
}

function envelopeDate(envelopeLine) {
  const match = String(envelopeLine || "").match(/^From\s+\S+\s+(.+)$/);
  if (!match) return null;
  const date = new Date(match[1]);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normaliseMessage(raw, envelopeLine, options) {
  const unescaped = String(raw || "").replace(/\n>From /g, "\nFrom ");
  const { headerBlock } = splitEntity(unescaped);
  const headers = parseHeaderBlock(headerBlock);
  const bodyParts = decodeMimeEntity(unescaped);
  const subject = firstHeader(headers, "subject");
  const sender = firstHeader(headers, "from");
  const recipient = recipientFromHeaders(headers);
  const messageId = firstHeader(headers, "message-id") || null;
  const sentDate = new Date(firstHeader(headers, "date"));
  const sentAt = Number.isFinite(sentDate.getTime()) ? sentDate.toISOString() : envelopeDate(envelopeLine);
  const receivedAt = receivedAtFromHeaders(headers) || sentAt || envelopeDate(envelopeLine);
  const body = bodyParts.map(part => part.text).join("\n\n").trim();

  return {
    subject,
    sender,
    recipient,
    body,
    sentAt: sentAt || receivedAt || null,
    receivedAt: receivedAt || sentAt || null,
    messageId,
    mailbox: options.mailbox || "receipt",
    sourceMailbox: options.sourceMailbox || "MBOX"
  };
}

function visibleText(value) {
  return String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<(?:br\s*\/?|\/p|\/div|\/tr|\/td)>/gi, "\n")
    .replace(/<\/?[a-z][a-z0-9]*(?:\s[^>]*)?\s*\/?>/gi, " ")
    .replace(/&(?:nbsp|#160);|\u00a0/gi, " ")
    .replace(/&(?:lt|#60);/gi, "<")
    .replace(/&(?:gt|#62);/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n");
}

function looksLikeUberSender(value) {
  return analyseSender(value).trusted === true || /<?[a-z0-9._%+-]+@(?:[a-z0-9-]+\.)*(?:li\.me|lime\.bike)>?\s*$/i.test(String(value || ''));
}

function parseForwardedDate(value) {
  const raw = String(value || "").trim();
  const direct = new Date(raw.replace(/\s+at\s+/i, " "));
  if (Number.isFinite(direct.getTime()) && /(?:[+-]\d{4}|\b(?:GMT|UTC|BST)\b)/i.test(raw)) {
    return direct.toISOString();
  }

  const match = raw.match(
    /(?:\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+)?(\d{1,2})\s+([A-Za-z]{3,9})\s+(20\d{2})\s*(?:,|\bat\b)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i
  );
  if (!match) return null;

  const months = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12"
  };
  const month = months[match[2].slice(0, 3).toLowerCase()];
  if (!month) return null;

  let hour = Number(match[4]);
  const meridiem = String(match[7] || "").toLowerCase();
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "am") hour = hour === 12 ? 0 : hour;
    if (meridiem === "pm") hour = hour === 12 ? 12 : hour + 12;
  }
  if (hour > 23) return null;

  const local = [
    match[3],
    month,
    String(match[1]).padStart(2, "0")
  ].join("-") + "T" +
    String(hour).padStart(2, "0") + ":" +
    match[5] + ":" + (match[6] || "00");

  const time = offerTime(local);
  return time == null ? null : new Date(time).toISOString();
}

function forwardedUberHeaders(body) {
  const text = visibleText(body);
  const marker = /(?:-{2,}\s*Forwarded message\s*-{2,}|Begin forwarded message:)/i;
  const start = text.search(marker);
  if (start < 0) return null;

  const window = text.slice(start, start + 8000);
  const fields = {};

  for (const line of window.split(/\n+/)) {
    const match = line.trim().match(/^(From|Date|Subject|To):\s*(.+)$/i);
    if (!match) continue;
    const key = match[1].toLowerCase();
    if (!fields[key]) fields[key] = match[2].trim();
  }

  if (!fields.from || !fields.to) {
    const flat = window.replace(/\n/g, " ");
    const fallback = flat.match(
      /\bFrom:\s*(.+?)\s+\bDate:\s*(.+?)\s+\bSubject:\s*(.+?)\s+\bTo:\s*(.+?)(?=\s+(?:Thanks\b|Total\s*£|Subtotal\s*£|$))/i
    );
    if (fallback) {
      fields.from ||= fallback[1].trim();
      fields.date ||= fallback[2].trim();
      fields.subject ||= fallback[3].trim();
      fields.to ||= fallback[4].trim();
    }
  }

  const sender = String(fields.from || "").trim();
  const recipient = firstEmail(fields.to);
  if (!looksLikeUberSender(sender) || !recipient) return null;

  return {
    sender,
    recipient,
    subject: String(fields.subject || "").trim().replace(/^Fwd:\s*/i, ""),
    sentAt: parseForwardedDate(fields.date)
  };
}

export function normaliseForwardedUberMessage(message = {}) {
  const forwarded = forwardedUberHeaders(message.body);
  if (!forwarded) return message;
  if (!forwarded.sentAt) throw new Error("Forwarded Uber/Lime message lacks a valid original date; supply the original export.");
  return {
    ...message,
    sender: forwarded.sender,
    recipient: forwarded.recipient,
    subject: forwarded.subject || String(message.subject || "").replace(/^Fwd:\s*/i, ""),
    sentAt: forwarded.sentAt,
    forwardedByUser: true
  };
}

function messageIdentity(message) {
  if (message.messageId) {
    return "mid:" + String(message.messageId).trim().replace(/^<|>$/g, "").toLowerCase() +
      "|" + String(message.recipient || "").trim().toLowerCase();
  }
  return "fallback:" + hash(JSON.stringify({
    sender: message.sender || "",
    recipient: message.recipient || "",
    subject: message.subject || "",
    sentAt: message.sentAt || "",
    body: message.body || ""
  }));
}

export function dedupeMboxMessages(messages = []) {
  const seen = new Set();
  const result = [];
  for (const raw of messages) {
    const message = normaliseForwardedUberMessage(raw);
    const key = messageIdentity(message);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(message);
  }
  return result;
}

export function looksLikeUberMail(message = {}) {
  const subject = String(message.subject || "");
  const sender = String(message.sender || "");
  return /\buber\b/i.test(subject) ||
    looksLikeUberSender(sender);
}

export async function parseMboxStream(stream, options = {}) {
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  const messages = [];
  let current = [];
  let envelopeLine = null;

  const flush = () => {
    if (!current.length) return;
    const raw = current.join("\n");
    const message = normaliseForwardedUberMessage(normaliseMessage(raw, envelopeLine, options));
    if (message.subject || message.sender || message.body) messages.push(message);
    current = [];
  };

  for await (const line of rl) {
    if (MBOX_SEPARATOR.test(line)) {
      flush();
      envelopeLine = line;
      continue;
    }
    current.push(line);
  }
  flush();
  return messages;
}

export async function parseMboxText(text, options = {}) {
  return parseMboxStream(Readable.from([String(text || "")]), options);
}
