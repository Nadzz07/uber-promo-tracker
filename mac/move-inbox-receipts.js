#!/usr/bin/osascript -l JavaScript

ObjC.import("Foundation");

function stderr(message) {
  const data = $(String(message) + "\n").dataUsingEncoding($.NSUTF8StringEncoding);
  $.NSFileHandle.fileHandleWithStandardError.writeData(data);
}

function readUtf8(path) {
  const value = $.NSString.stringWithContentsOfFileEncodingError(
    $(String(path)),
    $.NSUTF8StringEncoding,
    null
  );

  if (!value) throw new Error("Could not read move list: " + path);
  return ObjC.unwrap(value);
}

function headerValue(rawSource, headerName) {
  const headerBlock = String(rawSource || "")
    .split(/\r?\n\r?\n/, 1)[0]
    .replace(/\r?\n[ \t]+/g, " ");

  const pattern = new RegExp("^" + headerName + ":\\s*(.+)$", "im");
  const match = headerBlock.match(pattern);
  return match ? match[1].trim() : null;
}

function normalizeMessageId(value) {
  return String(value || "")
    .trim()
    .replace(/^</, "")
    .replace(/>$/, "")
    .toLowerCase();
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

function messageIdFor(message) {
  try {
    const value = normalizeMessageId(message.messageId());
    if (value) return value;
  } catch (_) {}

  try {
    return normalizeMessageId(headerValue(String(message.source() || ""), "Message-ID"));
  } catch (_) {
    return "";
  }
}

function run(argv) {
  const listPath = String(argv[0] || "receipt-moves.local.json");
  const targetMailboxName = String(argv[1] || "Uber Receipts");
  const daysBack = Number(argv[2] || 60);
  const olderThanDays = Number(argv[3] || 0);

  const payload = JSON.parse(readUtf8(listPath));
  const wanted = new Set(
    (payload.messageIds || []).map(normalizeMessageId).filter(Boolean)
  );

  if (wanted.size === 0) {
    return JSON.stringify({ requested: 0, moved: 0, unmatched: 0 });
  }

  const Mail = Application("Mail");
  Mail.includeStandardAdditions = false;

  const destination = findMailbox(Mail, targetMailboxName);
  if (!destination) {
    throw new Error("Could not find receipt mailbox: " + targetMailboxName);
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);

  let upperBound = null;
  if (olderThanDays > 0) {
    upperBound = new Date();
    upperBound.setDate(upperBound.getDate() - olderThanDays);
  }

  let inboxIds;
  let inboxDates;

  try {
    inboxIds = Mail.inbox.messages.messageId();
    inboxDates = Mail.inbox.messages.dateReceived();
  } catch (error) {
    throw new Error(
      "Mail could not read Inbox metadata in bulk; no messages were moved. " +
      String(error)
    );
  }

  if (inboxIds.length !== inboxDates.length) throw new Error("Inbox changed during indexing; retry filing.");
  const n = inboxIds.length;
  const candidates = [];

  for (let i = 0; i < n; i++) {
    const receivedAt = new Date(inboxDates[i]);

    if (Number.isNaN(receivedAt.getTime()) || receivedAt < cutoff) continue;
    if (upperBound && receivedAt >= upperBound) continue;

    const messageId = normalizeMessageId(inboxIds[i]);
    if (!messageId || !wanted.has(messageId)) continue;

    candidates.push({
      index: i,
      messageId
    });
  }

  let moved = 0;
  let failed = 0;
  const matched = new Set();

  // Move from highest index to lowest. Moving a message mutates the Inbox
  // collection, so descending order prevents later indices from shifting.
  candidates.sort((a, b) => b.index - a.index);

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const message = Mail.inbox.messages[candidate.index];
    const messageId = messageIdFor(message);

    if (!messageId || messageId !== candidate.messageId || !wanted.has(messageId)) { failed++; continue; }

    try {
      Mail.move(message, { to: destination });
      moved += 1;
      matched.add(messageId);
    } catch (error) {
      failed++;
      stderr("Warning: a receipt could not be filed; it remains in Inbox.");
    }
  }

  return JSON.stringify({
    requested: wanted.size,
    moved,
    failed,
    unmatched: wanted.size - matched.size
  });
}
