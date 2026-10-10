// UK offer terms have a London wall clock, independent of the Mac/browser zone.
const london = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
});
const londonDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });

export function offerTime(value) {
  if (!value) return null;
  const local = String(value).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!local) {
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : null;
  }
  const [, y, m, d, h, min, sec, ms = "0"] = local;
  const wall = Date.UTC(+y, +m - 1, +d, +h, +min, +sec, +ms.padEnd(3, "0"));
  const check = new Date(wall);
  if (check.getUTCFullYear() !== +y || check.getUTCMonth() !== +m - 1 ||
      check.getUTCDate() !== +d || +h > 23 || +min > 59 || +sec > 59) return null;
  // Test both UK offsets; ambiguous autumn clocks use the earlier instant.
  for (const offset of [3600000, 0]) {
    const time = wall - offset;
    const parts = Object.fromEntries(london.formatToParts(time).map(p => [p.type, p.value]));
    if (+parts.year === +y && +parts.month === +m && +parts.day === +d &&
        +parts.hour === +h && +parts.minute === +min && +parts.second === +sec) return time;
  }
  return null; // Nonexistent spring-forward time needs checking.
}

const expiryCache = new Map();

function computeExpiry(promo = {}) {
  if (promo.expiresAt) return offerTime(promo.expiresAt);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(promo.expires || "")) return null;
  return offerTime(promo.expires + "T23:59:59.999");
}

export function expiryEndTime(promo = {}) {
  const key = String(promo.expiresAt || "") + "|" + String(promo.expires || "");
  if (!expiryCache.has(key)) {
    if (expiryCache.size > 2000) expiryCache.clear();
    expiryCache.set(key, computeExpiry(promo));
  }
  return expiryCache.get(key);
}

export function isOfferExpired(promo, now = Date.now()) {
  const expiry = expiryEndTime(promo);
  return expiry != null && new Date(now).getTime() >= expiry;
}

// User policy: at most 35 elapsed days from the first observed offer email.
// An earlier explicit deadline still wins; receipt usage never starts this clock.
export function applyOfferExpiryPolicy(promo = {}) {
  const anchor = offerTime(promo.firstEmailSentAt || promo.emailSentAt);
  if (anchor == null) return promo;
  const deadline = anchor + 35 * 86400000;
  const explicit = expiryEndTime(promo);
  if ((promo.expiresAt || promo.expires) && explicit == null) return promo;
  if (explicit != null && explicit <= deadline) return promo;
  const expiresAt = new Date(deadline).toISOString();
  return { ...promo, expiresAt, expires: londonDate.format(deadline),
    expiryStatus: 'estimated', expiryBasis: 'tracker_35_day_rule', expiryConfidence: 'policy' };
}
