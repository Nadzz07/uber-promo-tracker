import { createHash } from 'node:crypto';
import { parseUberEatsReceipt } from './receipt-parser.js';
import { parseUberTransportReceipt } from './transport-receipt-parser.js';
import { analyseSender } from './parser-v2/sender.js';

const normalize = value => String(value || '').trim().toLowerCase();
function header(headers, key) {
  return String(headers || '').replace(/\r?\n[ \t]+/g, ' ').match(new RegExp('^' + key + ':\\s*(.*)$', 'im'))?.[1] || '';
}
function addresses(value) {
  return [...new Set((String(value).match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || []).map(normalize))];
}
const messageId = value => normalize(value).replace(/^<|>$/g, '');

// Discovery never grants login access and never modifies an existing account.
// Only direct receipt recipients corroborated by original headers may be added.
export function discoverReceiptAccounts(messages, existingAliases, deletedHashes = new Set()) {
  const existing = new Set([...existingAliases].map(normalize));
  const found = new Map(), blocked = [];
  for (const email of messages) {
    const eats = parseUberEatsReceipt(email);
    const receipt = eats.isReceipt ? eats : parseUberTransportReceipt(email);
    if (!receipt.isReceipt) continue;
    const alias = normalize(receipt.accountAlias);
    if (existing.has(alias)) continue;
    let reason = null;
    if (deletedHashes.has(createHash('sha256').update(alias).digest('hex'))) reason = 'intentional_exclusion';
    const to = addresses(header(email.originalHeaders, 'To'));
    const from = header(email.originalHeaders, 'From');
    const sender = analyseSender(from);
    const lime = /@(?:[a-z0-9-]+\.)*(?:li\.me|lime\.bike)>?\s*$/i.test(from) && receipt.service !== 'Uber Eats';
    if (!reason && (!(sender.trusted && sender.confidence === 'high') && !lime)) reason = 'original_sender_unverified';
    if (!reason && (to.length !== 1 || to[0] !== alias || normalize(email.recipient) !== alias)) reason = 'original_recipient_unverified';
    if (!reason && (!email.messageId || messageId(header(email.originalHeaders, 'Message-ID')) !== messageId(email.messageId))) reason = 'original_identity_unverified';
    if (!reason && (/^\s*(?:fw|fwd)\s*:/i.test(email.subject || '') || /begin forwarded message|forwarded message/i.test(email.body || ''))) reason = 'forwarded_receipt_needs_review';
    if (reason) { blocked.push({ alias, messageId: email.messageId, reason }); continue; }
    if (!found.has(alias)) found.set(alias, { email: alias, canLogin: null, loginMethod: null, accountStatus: 'active', receiptMessages: [] });
    found.get(alias).receiptMessages.push(email.messageId);
  }
  return { accounts: [...found.values()], blocked };
}
