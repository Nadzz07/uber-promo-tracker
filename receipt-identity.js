export function receiptIdentity(receipt = {}) {
  const account = receipt.accountRef || receipt.accountAlias || '';
  const service = receipt.service || 'Uber Eats';
  for (const field of ['orderId', 'orderKey', 'tripId', 'tripKey', 'messageKey', 'messageId', 'receiptId', 'id']) {
    if (receipt[field]) return [service, account, field, String(receipt[field]).trim().replace(/^<|>$/g, '').toLowerCase()].join('|');
  }
  if (!account || !(receipt.sentAt || receipt.receivedAt)) return null;
  return JSON.stringify([service, account, receipt.sentAt || receipt.receivedAt, receipt.subtotal, receipt.total]);
}

export function dedupeReceipts(receipts = []) {
  const records = new Map();
  for (const receipt of receipts) {
    const key = receiptIdentity(receipt) ?? Symbol("unidentified receipt");
    const previous = records.get(key);
    if (!previous) { records.set(key, { ...receipt }); continue; }
    const newer = String(receipt.receivedAt || receipt.sentAt || '') >= String(previous.receivedAt || previous.sentAt || '');
    const merged = { ...previous };
    for (const [field, value] of Object.entries(receipt)) {
      if (value != null && (newer || merged[field] == null)) merged[field] = value;
    }
    // Duplicate delivery time must not change order chronology.
    const dates = [previous.sentAt, receipt.sentAt].filter(Boolean).sort();
    if (dates.length) merged.sentAt = dates[0];
    records.set(key, merged);
  }
  return [...records.values()];
}
