import fs from "node:fs";
import { parseUberPromo } from "../parser.js";
import { parseUberEatsReceipt } from "../receipt-parser.js";
import { parseUberTransportReceipt } from "../transport-receipt-parser.js";
import { getAccounts, getOffers, getReceipts, getTransportReceipts } from "../private-db.js";
import { DatabaseSync } from "node:sqlite";
import { offerFingerprint } from "../identity.js";
import { analyseSender } from "../parser-v2/sender.js";
import { applyOfferExpiryPolicy, expiryEndTime, offerTime } from "../offer-time.js";
import { savingForSpend } from "../deal-intelligence.js";

const [inputPath = "emails.local.json", dbPath = "uber-tracker.local.db", receiptOutput = "receipt-moves.local.json", trashOutput = "archived-trash.local.json"] = process.argv.slice(2);
const keepEvidence = process.argv.slice(6).includes('--keep-receipts-and-used-promos');

const raw = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const messages = Array.isArray(raw) ? raw : raw.messages;
if (!Array.isArray(messages)) throw new Error("Mail export must contain a message array.");

const db = new DatabaseSync(dbPath, {readOnly:true});
let accounts, imported, preserved, usedFamilies, offers, receipts;
try {
  accounts = getAccounts(db);
  preserved = db.prepare('SELECT message_id,account_ref FROM messages WHERE body_text IS NOT NULL AND sender IS NOT NULL').all();
  offers=getOffers(db,{includeHistorical:true});
  receipts=[...getReceipts(db),...getTransportReceipts(db)];
  usedFamilies = new Set(offers.filter(p=>p.receiptConfirmedUses>0||['used','partial','needs_checking'].includes(p.receiptState)).map(p=>p.offerId));
  imported = db.prepare(`SELECT m.message_id, m.account_ref, m.kind FROM messages m WHERE m.accepted = 1 AND
    (m.kind = 'promo' OR (m.kind = 'receipt' AND EXISTS(SELECT 1 FROM receipts r WHERE r.message_key = m.message_key)) OR
    (m.kind = 'transport_receipt' AND EXISTS(SELECT 1 FROM transport_receipts r WHERE r.message_key = m.message_key)))`).all();
} finally { db.close(); }
const normalizedId = id => String(id || '').trim().replace(/^<|>$/g, '').toLowerCase();
const committed = new Set(imported.filter(m => m.message_id).map(m => [m.account_ref, m.kind, normalizedId(m.message_id)].join('|')));
const retainedSources = new Set(preserved.filter(m=>m.message_id).map(m=>m.account_ref+'|'+normalizedId(m.message_id)));
const access = new Map(accounts.map(account => [String(account.alias).trim().toLowerCase(), account]));
const offerMap=new Map(offers.map(p=>[p.offerId,p]));
const receiptsByAccount=new Map();for(const r of receipts){if(!receiptsByAccount.has(r.accountRef))receiptsByAccount.set(r.accountRef,[]);receiptsByAccount.get(r.accountRef).push(r);}
function possibleReceiptUse(promo,accountRef){
  const family=offerMap.get(offerFingerprint({...promo,accountRef}))||{...promo,accountRef};
  const policy=applyOfferExpiryPolicy(family),start=offerTime(family.firstEmailSentAt||family.emailSentAt),end=expiryEndTime(policy);
  // If an eligible-period receipt exists, ambiguous combined discount evidence
  // is retained for review rather than assuming the promotion was unused.
  return (receiptsByAccount.get(accountRef)||[]).some(r=>{
    if((promo.service==='Uber Eats')!==(r.service==='Uber Eats'))return false;
    const time=offerTime(r.sentAt||r.receivedAt);
    if(time==null||start==null||time<start||(end!=null&&time>=end))return false;
    if(promo.discountType==='uberCash')return r.uberCashUsed>0||r.uberCashSavings>0;
    if(r.promotionDiscount>0){
      const spend=r.subtotal??(Number(r.total||0)+r.promotionDiscount);
      const expected=savingForSpend(promo,spend);
      return expected.eligible&&Math.abs(expected.saving-r.promotionDiscount)<=Math.max(.2,r.promotionDiscount*.03);
    }
    return r.reportedSavings>0||r.uberOneSignal;
  });
}

const receiptIds = [];
const trashIds = [];
const trashTargets = [];
const seenTargets = new Set();
let keptArchivedReceipts=0,keptUsedPromoSources=0;
const seenReceipt = new Set();
const seenTrash = new Set();
let archivedWithoutMessageId = 0;

function pushUnique(list, seen, value) {
  const key = String(value || "").trim().toLowerCase();
  if (!key || seen.has(key)) return;
  seen.add(key);
  list.push(value);
}

for (const email of messages) {
  if (String(email.sourceMailbox || "").toUpperCase() !== "INBOX") continue;

  const eats = parseUberEatsReceipt(email);
  const transport = eats.isReceipt ? null : parseUberTransportReceipt(email);
  const isReceipt = eats.isReceipt || Boolean(transport?.isReceipt);
  const promo = isReceipt ? null : parseUberPromo(email);
  const alias = String(
    eats.isReceipt ? eats.accountAlias :
    transport?.isReceipt ? transport.accountAlias :
    promo?.accountAlias || email.recipient || ""
  ).trim().toLowerCase();

  const account = access.get(alias);
  const cleanupEligible = account?.canLogin === false &&
    (account.accountStatus === 'archived' || account.accountStatus === 'deactivated' || !account.accountStatus);
  // Pending/new access is never a reason to send Mail to Bin. Accessible
  // accounts stay protected even when separately marked Archived.
  if (account?.canLogin !== true && !cleanupEligible) continue;
  if(keepEvidence && cleanupEligible && retainedSources.has(account.accountRef+'|'+normalizedId(email.messageId))){
    // Keep all receipt-looking messages, including unsupported currencies, and
    // used/reviewable promo families. Only trusted, preserved Uber sources move.
    const receiptLike=isReceipt || /\breceipt\b|\b(?:your\s+)?trip\s+with\s+uber\b|\bthanks\s+for\s+(?:your\s+)?order\b/i.test(email.subject||'');
    if(receiptLike){keptArchivedReceipts++;continue;}
    if(promo?.isPromo && (usedFamilies.has(offerFingerprint({...promo,accountRef:account.accountRef}))||possibleReceiptUse(promo,account.accountRef))){keptUsedPromoSources++;continue;}
    const sender=analyseSender(email.sender);
    if(!sender.trusted||sender.confidence!=='high')continue;
    const targetKey=account.accountRef+'|'+normalizedId(email.messageId);
    if(email.messageId&&!seenTargets.has(targetKey)){
      seenTargets.add(targetKey);trashTargets.push({messageId:email.messageId,recipient:alias,accountRef:account.accountRef});
      pushUnique(trashIds,seenTrash,email.messageId);
    }
    continue;
  }
  if(keepEvidence && account && !account.canLogin)continue;
  // Unknown, skipped, untrusted, or incompletely imported messages stay in Inbox.
  const kind = eats.isReceipt ? 'receipt' : transport?.isReceipt ? 'transport_receipt' : promo?.isPromo ? 'promo' : null;
  if (!account || !kind || !committed.has([account.accountRef, kind, normalizedId(email.messageId)].join('|'))) continue;
  if (!account.canLogin) {
    if (email.messageId) pushUnique(trashIds, seenTrash, email.messageId);
    if (email.messageId) trashTargets.push({messageId:email.messageId,recipient:alias,accountRef:account.accountRef});
    else archivedWithoutMessageId++;
    continue;
  }

  if (isReceipt && email.messageId) {
    pushUnique(receiptIds, seenReceipt, email.messageId);
  }
}

const generatedAt = new Date().toISOString();
fs.writeFileSync(receiptOutput, JSON.stringify({
  generatedAt,
  sourceMailbox: "INBOX",
  action: "file_receipt",
  count: receiptIds.length,
  messageIds: receiptIds
}, null, 2) + "\n");

fs.writeFileSync(trashOutput, JSON.stringify({
  generatedAt,
  sourceMailbox: "INBOX",
  action: "trash_archived",
  keepReceiptsAndUsedPromos: keepEvidence,
  keptArchivedReceipts,
  keptUsedPromoSources,
  usageProtection:'Confirmed usage and uncertain promo usage within receipt dates are retained for review.',
  count: trashIds.length,
  messageIds: trashIds,
  messageTargets: trashTargets
}, null, 2) + "\n");

console.log("Available-account Inbox receipts ready to file: " + receiptIds.length);
console.log("Archived-account Inbox messages ready for Bin: " + trashIds.length);
if (archivedWithoutMessageId) {
  console.warn("Archived Inbox messages left in place because Message-ID was unavailable: " + archivedWithoutMessageId);
}
