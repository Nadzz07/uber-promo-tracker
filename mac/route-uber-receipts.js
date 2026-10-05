#!/usr/bin/osascript -l JavaScript

function childMailboxes(container) {
  try {
    return container.mailboxes() || [];
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

function looksUber(subject, sender) {
  return (
    /\buber\b/i.test(subject) ||
    /@(?:[a-z0-9-]+\.)?uber\.com/i.test(sender) ||
    /(?:ubereats|uber)_at_uber_com/i.test(sender) ||
    /^\s*["']?uber(?:\s+eats)?["']?\s*</i.test(sender)
  );
}

function looksLikeReceipt(subject, body) {
  const text = String(subject || "") + "\n" + String(body || "");

  const receiptSignal =
    /\breceipt\b|\bthanks\s+for\s+(?:your\s+)?order\b|\byour\s+order\s+(?:with|from)\b|\border\s+(?:with|from)\b/i.test(text);

  const subtotalSignal =
    /\b(?:items\s+)?subtotal\b[^£\d]{0,40}£\s*\d/i.test(text);

  const totalSignal =
    /\b(?:final\s+total|amount\s+charged|total)\b[^£\d]{0,40}£\s*\d/i.test(text);

  return receiptSignal && (subtotalSignal || totalSignal);
}

function recentInboxMessages(Mail, daysBack) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - Number(daysBack || 120));

  try {
    return Mail.inbox.messages.whose({
      dateReceived: { ">=": cutoff }
    })();
  } catch (error) {
    throw new Error(
      "Apple Mail could not filter Inbox by date. " +
      "No messages were moved. " +
      String(error)
    );
  }
}

function run(argv) {
  const daysBack = Number(argv[0] || 120);
  const targetName = String(argv[1] || "Uber Receipts");

  if (!Number.isFinite(daysBack) || daysBack <= 0) {
    throw new Error("Receipt routing lookback must be a positive number of days.");
  }

  const Mail = Application("Mail");
  Mail.includeStandardAdditions = false;

  const target = findMailbox(Mail, targetName);
  if (!target) {
    throw new Error("Could not find receipt mailbox: " + targetName);
  }

  const messages = recentInboxMessages(Mail, daysBack);
  const toMove = [];

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];

    let subject = "";
    let sender = "";

    try { subject = String(message.subject() || ""); } catch (_) {}
    try { sender = String(message.sender() || ""); } catch (_) {}

    if (!looksUber(subject, sender)) continue;

    let body = "";
    try { body = String(message.content() || ""); } catch (_) {}

    if (looksLikeReceipt(subject, body)) {
      toMove.push(message);
    }
  }

  let moved = 0;

  for (let i = 0; i < toMove.length; i++) {
    try {
      Mail.move(toMove[i], { to: target });
      moved += 1;
    } catch (error) {
      throw new Error(
        "Stopped after moving " + moved + " receipt(s): " + String(error)
      );
    }
  }

  return JSON.stringify({
    scannedRecentInbox: messages.length,
    movedReceipts: moved,
    targetMailbox: targetName,
    daysBack
  });
}
