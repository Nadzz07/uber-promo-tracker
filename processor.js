import { parseUberPromo } from "./parser.js";

function asDate(value) {
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value === "string") {
    const simple = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (simple) return new Date(Number(simple[1]), Number(simple[2]) - 1, Number(simple[3]), 12, 0, 0);
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export function estimatedValue(promo) {
  if (promo.maxTotalSaving != null) return promo.maxTotalSaving;
  if (promo.maxSaving != null) return promo.maxSaving;
  if (promo.discountType === "fixed" && promo.discount != null) {
    return promo.discount * (promo.uses || 1);
  }
  return null;
}

export function scorePromo(promo) {
  let score = 0;
  const value = estimatedValue(promo);

  if (value != null) score += value * 100;
  if (promo.discountType === "percent" && promo.discount != null) score += promo.discount;
  if (promo.discountType === "fixed" && promo.discount != null) score += promo.discount * 10;
  if (promo.minimumSpend) score -= promo.minimumSpend;
  if (promo.uses > 1) score += Math.min(promo.uses, 10);
  if (promo.service === "Uber One" && value == null) score += 1;

  return score;
}

function promoKey(promo) {
  return [
    promo.accountAlias || "",
    promo.service,
    promo.discountType,
    promo.discount,
    promo.perUseCap,
    promo.maxTotalSaving,
    promo.minimumSpend,
    promo.uses,
    promo.code || "",
    promo.expires || ""
  ].join("|").toLowerCase();
}

function isExpired(promo, now) {
  if (!promo.expires) return false;
  const [year, month, day] = promo.expires.split("-").map(Number);
  const expiry = new Date(year, month - 1, day, 23, 59, 59, 999);
  return expiry < now;
}

export function buildPromoList(emails = [], { now = new Date(), includeExpired = false } = {}) {
  const referenceTime = asDate(now);
  const uniquePromos = new Map();

  emails.forEach(email => {
    const promo = parseUberPromo(email);
    if (!promo.isPromo) return;
    if (!includeExpired && isExpired(promo, referenceTime)) return;

    const key = promoKey(promo);
    if (!uniquePromos.has(key)) uniquePromos.set(key, promo);
  });

  const promos = [...uniquePromos.values()];

  const byAccount = new Map();

  for (const promo of promos) {
    promo.sameAccountOfferCount = 1;
    promo.hasCompanionOffer = false;

    if (!promo.accountAlias) continue;

    if (!byAccount.has(promo.accountAlias)) {
      byAccount.set(promo.accountAlias, []);
    }

    byAccount.get(promo.accountAlias).push(promo);
  }

  for (const accountPromos of byAccount.values()) {
    const companionOffers = accountPromos.filter(promo =>
      promo.discountType === "fixed" ||
      promo.discountType === "uberCash"
    );

    for (const promo of accountPromos) {
      promo.sameAccountOfferCount = accountPromos.length;

      if (promo.discountType === "percent") {
        promo.hasCompanionOffer = companionOffers.some(companion =>
          companion !== promo
        );
      }
    }
  }

  return promos.sort((a, b) => scorePromo(b) - scorePromo(a));
}
