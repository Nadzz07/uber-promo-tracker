export const DEVICE_ACCOUNTS_KEY = 'uber-eats-promo-tracker:device-accounts:v1';
export const DEVICE_ACCOUNTS_KIND = 'uber-tracker-device-accounts';

function emailMask(value) {
  const [local, domain] = value.toLowerCase().split('@');
  return (local.length <= 2 ? local[0] + '…' : local.length <= 5 ? local[0] + '…' + local.at(-1) : local.slice(0,2) + '…' + local.slice(-2)) + '@' + domain;
}

// This module has no network calls. Private identities are imported by the
// owner and kept only in this browser's local storage, never in public JSON.
export function parseDeviceAccounts(value, publicAccounts) {
  if (value?.kind !== DEVICE_ACCOUNTS_KIND || value?.schemaVersion !== 1 || !Array.isArray(value.accounts) || value.accounts.length > 5000) throw new Error('Choose a tracker device-accounts export.');
  const known = new Map(publicAccounts.map(a => [a.accountRef, a.accountMasked]));
  const result = Object.create(null), seen = new Set();
  for (const row of value.accounts) {
    if (!row || typeof row.accountRef !== 'string' || typeof row.accountMasked !== 'string' || typeof row.email !== 'string' || row.email.length > 254 || !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(row.email) || seen.has(row.accountRef)) throw new Error('Invalid or duplicate account in the export.');
    seen.add(row.accountRef);
    if (emailMask(row.email) !== row.accountMasked) throw new Error('An email does not match its masked account. Export this file again from your Mac.');
    if (!known.has(row.accountRef)) continue; // Removed accounts cannot return.
    if (known.get(row.accountRef) !== row.accountMasked) throw new Error('This export does not match the current tracker. Export it again from the same private database.');
    result[row.accountRef] = { email: row.email, accountMasked: row.accountMasked };
  }
  if (!Object.keys(result).length) throw new Error('No accounts match this tracker.');
  return result;
}

export function deviceEmail(mapping, account) {
  const row = mapping?.[account?.accountRef];
  return row && row.accountMasked === account.accountMasked && typeof row.email === 'string' && /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(row.email) && emailMask(row.email) === account.accountMasked ? row.email : null;
}
