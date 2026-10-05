#!/usr/bin/osascript -l JavaScript

ObjC.import("Foundation");

function stderr(message) {
  const data = $(String(message) + "\n").dataUsingEncoding($.NSUTF8StringEncoding);
  $.NSFileHandle.fileHandleWithStandardError.writeData(data);
}

function isoDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function headerValue(rawSource, headerName) {
  const headerBlock = String(rawSource || "")
    .split(/\r?\n\r?\n/, 1)[0]
    .replace(/\r?\n[ \t]+/g, " ");

  const pattern = new RegExp("^" + headerName + ":\\s*(.+)$", "im");
  const match = headerBlock.match(pattern);
  return match ? match[1].trim() : null;
}

function emailFromHeader(value) {
  const match = String(value || "")
    .match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
  return match ? match[1].toLowerCase() : "";
}

function firstRecipientAddress(message, rawSource) {
  try {
    const recipients = message.toRecipients();

    if (recipients && recipients.length) {
      for (let i = 0; i < recipients.length; i++) {
        try {
          const address = String(recipients[i].address() || "");
          if (address) return address.toLowerCase();
        } catch (_) {}
      }
    }
  } catch (_) {}

  return emailFromHeader(headerValue(rawSource, "To"));
}

function childMailboxes(container) {
  try {
    const boxes = container.mailboxes();
    return boxes || [];
  } catch (_) {
    return [];
  }
}

function findMailboxIn(boxes, wanted) {
  const target = String(wanted || "").trim().toLowerCase();

  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];

    try {
      const name = String(box.name() || "").trim();
      if (name.toLowerCase() === target) return box;
    } catch (_) {}

    const nested = childMailboxes(box);
    const result = findMailboxIn(nested, wanted);
    if (result) return result;
  }

  return null;
}

function findMailbox(Mail, name) {
  if (!name) return null;

  if (String(name).trim().toUpperCase() === "INBOX") {
    try { return Mail.inbox; } catch (_) {}
  }

  try {
    const direct = findMailboxIn(Mail.mailboxes(), name);
    if (direct) return direct;
  } catch (_) {}

  try {
    const accounts = Mail.accounts();

    for (let i = 0; i < accounts.length; i++) {
      const result = findMailboxIn(childMailboxes(accounts[i]), name);
      if (result) return result;
    }
  } catch (_) {}

  return null;
}

function looksUber(subject, sender) {
  return (
    /\buber\b/i.test(subject) ||
    /@(?:[a-z0-9-]+\.)?uber\.com/i.test(sender) ||
    /(?:ubereats|uber)_at_uber_com/i.test(sender) ||
    /^\s*["']?uber(?:\s+eats)?["']?\s*</i.test(sender)
  );
}

function dateRange(daysBack, olderThanDays) {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - Number(daysBack || 0));

  let end = null;
  if (Number(olderThanDays || 0) > 0) {
    end = new Date(now);
    end.setDate(end.getDate() - Number(olderThanDays));
  }

  return { start, end };
}

function bulkMailboxIndex(box) {
  try {
    const received = box.messages.dateReceived();
    const subjects = box.messages.subject();
    const senders = box.messages.sender();
    const sent = box.messages.dateSent();

    const n = Math.min(
      received.length,
      subjects.length,
      senders.length,
      sent.length
    );

    const rows = [];

    for (let i = 0; i < n; i++) {
      const receivedAt = new Date(received[i]);
      const sentAt = new Date(sent[i]);

      rows.push({
        index: i,
        subject: String(subjects[i] || ""),
        sender: String(senders[i] || ""),
        receivedAt,
        sentAt: Number.isNaN(sentAt.getTime()) ? receivedAt : sentAt
      });
    }

    return rows;
  } catch (error) {
    throw new Error(
      "Mail could not read mailbox metadata in bulk. " +
      "The tracker will not fall back to a slow full-message crawl. " +
      String(error)
    );
  }
}

function scanMailbox(box, role, daysBack, olderThanDays, sourceMailbox) {
  const range = dateRange(daysBack, olderThanDays);
  const rows = bulkMailboxIndex(box);
  const results = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    if (Number.isNaN(row.receivedAt.getTime())) continue;
    if (row.receivedAt < range.start) continue;
    if (range.end && row.receivedAt >= range.end) continue;
    if (!looksUber(row.subject, row.sender)) continue;

    const message = box.messages[row.index];

    let rawSource = "";
    let recipient = "";
    let body = "";

    try { rawSource = String(message.source() || ""); } catch (_) {}
    try { recipient = firstRecipientAddress(message, rawSource); } catch (_) {}
    try { body = String(message.content() || ""); } catch (_) {}

    const rawMessageId = headerValue(rawSource, "Message-ID");

    results.push({
      subject: row.subject,
      sender: row.sender,
      recipient,
      body,
      sentAt: isoDate(row.sentAt),
      receivedAt: isoDate(row.receivedAt),
      messageId: rawMessageId || null,
      mailbox: role,
      sourceMailbox: sourceMailbox || null
    });
  }

  return results;
}

function splitMailboxNames(value) {
  return String(value || "")
    .split("|")
    .map(name => name.trim())
    .filter(Boolean);
}

function dedupeMessages(messages) {
  const seen = new Set();
  const result = [];

  for (const message of messages) {
    const key = message.messageId
      ? "id:" + String(message.messageId).toLowerCase()
      : [
          message.sender || "",
          message.recipient || "",
          message.subject || "",
          message.sentAt || "",
          message.receivedAt || ""
        ].join("|");

    if (seen.has(key)) continue;
    seen.add(key);
    result.push(message);
  }

  return result;
}

function run(argv) {
  const promoDays = Number(argv[0] || 60);
  const promoMailboxNames = splitMailboxNames(argv[1] || "INBOX");
  const receiptDays = Number(argv[2] || 90);
  const receiptMailboxName = String(argv[3] || "Uber Receipts");
  const receiptOlderThanDays = Number(argv[4] || 0);
  const promoOlderThanDays = Number(argv[5] || 0);

  const Mail = Application("Mail");
  Mail.includeStandardAdditions = false;

  const messages = [];
  const scannedMailboxes = [];

  if (promoDays > 0) {
    let foundPromoMailbox = false;

    for (const promoMailboxName of promoMailboxNames) {
      const promoMailbox = findMailbox(Mail, promoMailboxName);

      if (!promoMailbox) {
        stderr("Warning: promo mailbox '" + promoMailboxName + "' was not found.");
        continue;
      }

      foundPromoMailbox = true;
      messages.push.apply(
        messages,
        scanMailbox(
          promoMailbox,
          "promo",
          promoDays,
          promoOlderThanDays,
          promoMailboxName
        )
      );
      scannedMailboxes.push({
        role: "promo",
        name: promoMailboxName,
        daysBack: promoDays,
        olderThanDays: promoOlderThanDays
      });
    }

    if (!foundPromoMailbox) {
      throw new Error(
        "Could not find any configured promo mailbox: " +
        promoMailboxNames.join(" | ")
      );
    }
  }

  if (receiptDays > 0) {
    const receiptMailbox = findMailbox(Mail, receiptMailboxName);

    if (receiptMailbox) {
      messages.push.apply(
        messages,
        scanMailbox(
          receiptMailbox,
          "receipt",
          receiptDays,
          receiptOlderThanDays,
          receiptMailboxName
        )
      );
      scannedMailboxes.push({
        role: "receipt",
        name: receiptMailboxName,
        daysBack: receiptDays,
        olderThanDays: receiptOlderThanDays
      });
    } else {
      stderr(
        "Warning: receipt mailbox '" +
        receiptMailboxName +
        "' was not found. Promo scanning will continue."
      );
    }
  }

  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    mailboxes: scannedMailboxes,
    messages: dedupeMessages(messages)
  }, null, 2);
}
