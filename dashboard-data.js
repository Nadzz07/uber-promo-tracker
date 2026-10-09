// Public dashboard calculations use derived receipt totals and actual sync times.
export function syncState(sync = {}, { now = Date.now(), error = false } = {}) {
  const checked = Date.parse(sync.lastSuccessfulMailScanAt || '');
  const started = Date.parse(sync.startedAt || '');
  if (error || sync.state === 'failed') return { label: 'Attention', className: 'stale' };
  if (sync.state === 'syncing' && Number.isFinite(started) && now >= started && now - started < 30 * 60000) return { label: 'Syncing', className: 'syncing' };
  if (!Number.isFinite(checked) || checked > now + 5 * 60000) return { label: 'Snapshot', className: 'setup' };
  return now - checked <= 2 * 3600000
    ? { label: 'Up to date', className: 'live' }
    : { label: 'Stale', className: 'stale' };
}

export function receiptActivity(receipts = [], rides = [], saving) {
  const days = new Map(), months = new Map();
  for (const [items, kind] of [[receipts, 'eats'], [rides, 'rides']]) for (const receipt of items) {
    const when = receipt.sentAt || receipt.receivedAt;
    if (!when || !Number.isFinite(Date.parse(when))) continue;
    const day = new Date(when).toISOString().slice(0,10), month = day.slice(0,7);
    for (const [map, key] of [[days, day], [months, month]]) {
      const row = map.get(key) || { period: key, eats: 0, rides: 0, saved: 0 };
      row[kind]++;
      row.saved = Math.round((row.saved + saving(receipt)) * 100) / 100;
      map.set(key, row);
    }
  }
  return {
    days: [...days.values()].sort((a,b)=>b.period.localeCompare(a.period)),
    months: [...months.values()].sort((a,b)=>a.period.localeCompare(b.period))
  };
}
