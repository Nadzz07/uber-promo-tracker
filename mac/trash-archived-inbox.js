#!/usr/bin/osascript -l JavaScript

ObjC.import("Foundation");

function stderr(message) {
  const data = $(String(message) + "\n").dataUsingEncoding($.NSUTF8StringEncoding);
  $.NSFileHandle.fileHandleWithStandardError.writeData(data);
}

function readUtf8(path) {
  const value = $.NSString.stringWithContentsOfFileEncodingError(
    $(String(path)), $.NSUTF8StringEncoding, null
  );
  if (!value) throw new Error("Could not read Bin routing list: " + path);
  return ObjC.unwrap(value);
}

function normalizeMessageId(value) {
  return String(value || "").trim().replace(/^</, "").replace(/>$/, "").toLowerCase();
}

function headerValue(rawSource, headerName) {
  const headerBlock = String(rawSource || "").split(/\r?\n\r?\n/, 1)[0].replace(/\r?\n[ \t]+/g, " ");
  const match = headerBlock.match(new RegExp("^" + headerName + ":\\s*(.+)$", "im"));
  return match ? match[1].trim() : null;
}

function messageIdFor(message) {
  try {
    const value = normalizeMessageId(message.messageId());
    if (value) return value;
  } catch (_) {}
  try {
    return normalizeMessageId(headerValue(String(message.source() || ""), "Message-ID"));
  } catch (_) { return ""; }
}

function findRecoverableBin(account) {
  const candidates = [];
  function visit(container) {
    const boxes = container.mailboxes();
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (/^(bin|trash|deleted messages|deleted items)$/i.test(String(box.name()).trim())) candidates.push(box);
      visit(box);
    }
  }
  visit(account);
  if (candidates.length !== 1) throw new Error('A unique recoverable Bin mailbox is required.');
  return candidates[0];
}

function run(argv) {
  const listPath = String(argv[0] || "archived-trash.local.json");
  const daysBack = Number(argv[1] || 60);
  const payload = JSON.parse(readUtf8(listPath));
  const wanted = new Set((payload.messageIds || []).map(normalizeMessageId).filter(Boolean));

  if (wanted.size === 0) return JSON.stringify({ requested: 0, trashed: 0, failed: 0, unmatched: 0 });

  const Mail = Application("Mail");
  Mail.includeStandardAdditions = false;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);

  let inboxIds, inboxDates;
  try {
    inboxIds = Mail.inbox.messages.messageId();
    inboxDates = Mail.inbox.messages.dateReceived();
  } catch (error) {
    throw new Error("Mail could not read Inbox metadata in bulk; no messages were moved to Bin. " + String(error));
  }

  if (inboxIds.length !== inboxDates.length) throw new Error("Inbox changed during indexing; retry Bin routing.");
  const candidates = [];

  for (let i = 0; i < inboxIds.length; i++) {
    const receivedAt = new Date(inboxDates[i]);
    if (Number.isNaN(receivedAt.getTime()) || receivedAt < cutoff) continue;
    const messageId = normalizeMessageId(inboxIds[i]);
    if (messageId && wanted.has(messageId)) candidates.push({ index: i, messageId });
  }

  candidates.sort((a, b) => b.index - a.index);
  let trashed = 0, failed = 0;
  const matched = new Set();

  for (const candidate of candidates) {
    const message = Mail.inbox.messages[candidate.index];
    const messageId = messageIdFor(message);
    if (!messageId || messageId !== candidate.messageId || !wanted.has(messageId)) { failed++; continue; }

    try {
      // Move to an explicit mailbox, independent of account deletion settings.
      // Missing/ambiguous destinations fail closed; there is no delete fallback.
      const destination = findRecoverableBin(message.mailbox().account());
      Mail.move(message, { to: destination });
      trashed++;
      matched.add(messageId);
    } catch (_) {
      failed++;
      stderr("Warning: an archived-account message could not be moved to Bin; it remains in Inbox.");
    }
  }

  return JSON.stringify({
    requested: wanted.size,
    trashed,
    failed,
    unmatched: wanted.size - matched.size
  });
}
