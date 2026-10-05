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

function scanMailbox(box, role, daysBack) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - Number(daysBack || 60));

  const messages = box.messages();
  const results = [];

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];

    let subject = "";
    let sender = "";
    let receivedAt = null;
    let sentAt = null;

    try { subject = String(message.subject() || ""); } catch (_) {}
    try { sender = String(message.sender() || ""); } catch (_) {}
    try { receivedAt = new Date(message.dateReceived()); } catch (_) { receivedAt = new Date(0); }
    try { sentAt = new Date(message.dateSent()); } catch (_) { sentAt = receivedAt; }

    if (Number.isNaN(receivedAt.getTime()) || receivedAt < cutoff) continue;
    if (!looksUber(subject, sender)) continue;

    let rawSource = "";
    let recipient = "";
    let body = "";

    try { rawSource = String(message.source() || ""); } catch (_) {}
    try { recipient = firstRecipientAddress(message, rawSource); } catch (_) {}
    try { body = String(message.content() || ""); } catch (_) {}

    const rawMessageId = headerValue(rawSource, "Message-ID");

    results.push({
      subject,
      sender,
      recipient,
      body,
      sentAt: isoDate(sentAt),
      receivedAt: isoDate(receivedAt),
      messageId: rawMessageId || null,
      mailbox: role
    });
  }

  return results;
}

function run(argv) {
  const promoDays = Number(argv[0] || 60);
  const promoMailboxName = String(argv[1] || "INBOX");
  const receiptDays = Number(argv[2] || 3650);
  const receiptMailboxName = String(argv[3] || "Uber Receipts");

  const Mail = Application("Mail");
  Mail.includeStandardAdditions = false;

  const messages = [];
  const scannedMailboxes = [];

  const promoMailbox = findMailbox(Mail, promoMailboxName);

  if (!promoMailbox) {
    throw new Error("Could not find promo mailbox: " + promoMailboxName);
  }

  messages.push.apply(messages, scanMailbox(promoMailbox, "promo", promoDays));
  scannedMailboxes.push({
    role: "promo",
    name: promoMailboxName,
    daysBack: promoDays
  });

  const receiptMailbox = findMailbox(Mail, receiptMailboxName);

  if (receiptMailbox) {
    messages.push.apply(messages, scanMailbox(receiptMailbox, "receipt", receiptDays));
    scannedMailboxes.push({
      role: "receipt",
      name: receiptMailboxName,
      daysBack: receiptDays
    });
  } else {
    stderr(
      "Warning: receipt mailbox '" +
      receiptMailboxName +
      "' was not found. Promo scanning will continue."
    );
  }

  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    mailboxes: scannedMailboxes,
    messages
  }, null, 2);
}
