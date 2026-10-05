#!/usr/bin/osascript -l JavaScript

ObjC.import("Foundation");

function isoDate(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function extractRecipient(rawSource) {
  const headerBlock = String(rawSource || "")
    .split(/\r?\n\r?\n/, 1)[0]
    .replace(/\r?\n[ \t]+/g, " ");

  const toHeader = headerBlock.match(/^To:\s*(.+)$/im);
  if (!toHeader) return null;

  const address = toHeader[1].match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
  return address ? address[1].toLowerCase() : null;
}

function firstRecipientAddress(message) {
  try {
    const recipients = message.toRecipients();
    if (recipients && recipients.length) {
      for (let i = 0; i < recipients.length; i++) {
        try {
          const address = String(recipients[i].address() || "");
          if (address) return address;
        } catch (_) {}
      }
    }
  } catch (_) {}

  try {
    const rawSource = String(message.source() || "")
      .replace(/\r?\n[ \t]+/g, " ");
    const toHeader = rawSource.match(/^To:\s*([^\r\n]+)/mi);
    if (toHeader) {
      const email = toHeader[1].match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
      if (email) return email[1];
    }
  } catch (_) {}

  return "";
}

function run(argv) {
  const daysBack = Number(argv[0] || 45);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);

  const Mail = Application("Mail");
  Mail.includeStandardAdditions = false;

  const inbox = Mail.inbox;
  const messages = inbox.messages();
  const results = [];

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];

    let subject = "";
    let sender = "";
    let recipient = null;
    let body = "";
    let recipient = "";
    let receivedAt = null;

    try { subject = String(message.subject() || ""); } catch (_) {}
    try { sender = String(message.sender() || ""); } catch (_) {}
    try { recipient = extractRecipient(String(message.source() || "")); } catch (_) {}
    try { receivedAt = new Date(message.dateReceived()); } catch (_) { receivedAt = new Date(0); }

    if (Number.isNaN(receivedAt.getTime()) || receivedAt < cutoff) continue;

    const looksUber =
      /\buber\b/i.test(subject) ||
      /@(?:[a-z0-9-]+\.)?uber\.com/i.test(sender) ||
      /(?:ubereats|uber)_at_uber_com/i.test(sender) ||
      /\buber\b/i.test(sender);

    if (!looksUber) continue;

    try { body = String(message.content() || ""); } catch (_) {}

    results.push({
      subject,
      sender,
      recipient,
      body,
      receivedAt: isoDate(receivedAt)
    });
  }

  return JSON.stringify(results, null, 2);
}
