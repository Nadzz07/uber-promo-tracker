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

function recipientFor(message, rawSource) {
  const header=String(headerValue(rawSource,'To')||'');
  const addresses=[...new Set((header.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[]).map(v=>v.toLowerCase()))];
  if(addresses.length!==1)return '';
  const recipients=message.toRecipients();
  const live=[...new Set(recipients.map(r=>String(r.address()).trim().toLowerCase()))];
  return live.length===1&&live[0]===addresses[0]?addresses[0]:'';
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
  const mode=String(argv[2]||'');
  const targets=payload.messageTargets||[];
  const wanted = new Set((payload.messageIds || []).map(normalizeMessageId).filter(Boolean));
  if(mode==='--plan')stderr('Preparing read-only Inbox plan: '+targets.length+' account-qualified targets.');

  if (wanted.size === 0) return JSON.stringify({ requested: 0, trashed: 0, failed: 0, unmatched: 0 });
  if(!targets.length||targets.some(t=>!t.recipient||!t.messageId))throw new Error('Account-qualified message targets are required; no messages were moved.');

  const Mail = Application("Mail");
  Mail.includeStandardAdditions = false;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);

  let inboxIds, inboxDates, physicalIds;
  try {
    inboxIds = Mail.inbox.messages.messageId();
    inboxDates = Mail.inbox.messages.dateReceived();
    physicalIds = Mail.inbox.messages.id();
  } catch (error) {
    throw new Error("Mail could not read Inbox metadata in bulk; no messages were moved to Bin. " + String(error));
  }

  if (inboxIds.length !== inboxDates.length || physicalIds.length!==inboxIds.length || JSON.stringify(physicalIds)!==JSON.stringify(Mail.inbox.messages.id())) throw new Error("Inbox changed during indexing; retry Bin routing.");
  const candidates = [];

  for (let i = 0; i < inboxIds.length; i++) {
    const receivedAt = new Date(inboxDates[i]);
    if (Number.isNaN(receivedAt.getTime()) || receivedAt < cutoff) continue;
    const messageId = normalizeMessageId(inboxIds[i]);
    if (messageId && wanted.has(messageId)) candidates.push({ index: i, physicalId:physicalIds[i], messageId });
  }

  candidates.sort((a, b) => b.index - a.index);
  if(mode==='--plan')stderr('Inbox metadata indexed: '+inboxIds.length+' messages; '+candidates.length+' matching physical copies.');
  let trashed = 0, failed = 0;
  const matched = new Set();
  const inventory=[],destinations={},movedTargets=[];

  for (const candidate of candidates) {
    const message = Mail.inbox.messages.byId(candidate.physicalId);
    const messageId = messageIdFor(message);
    if (!messageId || messageId !== candidate.messageId || !wanted.has(messageId)) { failed++; continue; }

    try {
      const raw=String(message.source()||'');
      const recipient=recipientFor(message,raw);
      if(!recipient||!targets.some(t=>normalizeMessageId(t.messageId)===messageId&&String(t.recipient).toLowerCase()===recipient))continue;
      if(normalizeMessageId(headerValue(raw,'Message-ID'))!==messageId)throw new Error('Original source identity differs');
      if(mode==='--execute-verified-plan'&&!payload.inventory?.some(t=>t.physicalId===candidate.physicalId&&t.recipient===recipient&&t.messageId===messageId&&t.raw===raw))throw new Error('Original source changed after routing verification');
      // Move to an explicit mailbox, independent of account deletion settings.
      // Missing/ambiguous destinations fail closed; there is no delete fallback.
      const account=message.mailbox().account(),key=String(account.id());
      const destination = destinations[key]||(destinations[key]=findRecoverableBin(account));
      if(mode==='--plan'){
        inventory.push({physicalId:candidate.physicalId,messageId,recipient,raw});
        if(inventory.length%100===0)stderr('Original sources retained for '+inventory.length+' Inbox copies.');
        matched.add(messageId+'|'+recipient);continue;
      }
      Mail.move(message, { to: destination });
      trashed++;
      movedTargets.push({physicalId:candidate.physicalId,messageId,recipient,mailAccountId:key});
      if(trashed%100===0)stderr('Moved '+trashed+' verified unused messages to recoverable Bin.');
      matched.add(messageId+'|'+recipient);
    } catch (_) {
      failed++;
      stderr("Warning: an archived-account message could not be moved to Bin; it remains in Inbox.");
    }
  }

  if(mode==='--plan')stderr('Read-only plan complete: '+inventory.length+' copies; '+failed+' failures.');
  const result={
    requested: targets.length,
    readOnly:mode==='--plan',
    planned:inventory.length,
    inventory:mode==='--plan'?inventory:undefined,
    messageTargets:mode==='--plan'?targets:undefined,
    messageIds:mode==='--plan'?[...wanted]:undefined,
    trashed,
    movedTargets:mode==='--plan'?undefined:movedTargets,
    failed,
    unmatched: targets.length - matched.size
  };
  if(mode==='--plan' && argv[3]){
    const outputPath=String(argv[3]);
    if(!/\.local\.json$/.test(outputPath)||$.NSFileManager.defaultManager.fileExistsAtPath($(outputPath)))throw new Error('Choose a new private *.local.json output for original sources.');
    const data=$(JSON.stringify(result)).dataUsingEncoding($.NSUTF8StringEncoding);
    if(!data.writeToFileAtomically($(outputPath),true))throw new Error('Original sources could not be retained; no messages were moved.');
    return JSON.stringify({readOnly:true,planned:inventory.length,failed,originalSourcesSaved:true});
  }
  return JSON.stringify(result);
}
