import { firstMatch, number, sourceSnippet } from "./utils.js";

function allInText(text, patterns) {
  return patterns.flatMap(pattern => [...text.matchAll(new RegExp(pattern.source, pattern.flags.replace('g','') + 'g'))])
    .sort((a,b) => a.index - b.index);
}

const SHORTHAND_MINIMUM = /£\s*\d+(?:\.\d{1,2})?\s*off\s*(?:an?\s*)?£\s*(\d+(?:\.\d{1,2})?)(?=\s*(?:\+|&#(?:43|x2b);|[.!?]|$|\b(?:at|when|grocery|supermarket|orders?|basket|minimum|min|spend)\b))/i;

function discountScope(text, match, type, subject) {
  if (type === 'uberCash') return 'order';
  const before = text.slice(Math.max(0, match.index - 180), match.index);
  const tail = text.slice(match.index + match[0].length, match.index + match[0].length + 120);
  if (/^\s+(?:on\s+)?(?:(?:the|our|select(?:ed)?|individual)\s+)*(?:(?:grocery|supermarket)\s+)?(?:products?|items?|bundles?|dishes?)\b/i.test(tail) ||
      /^\s+(?:on\s+)?select(?:ed)?\b.{0,65}\brange\b/i.test(tail)) return 'product';
  const headline = String(subject || '').replace(/\s+/g,' ').trim();
  if (/^\s*(?:an?\s*)?£\s*\d+(?:\.\d+)?(?=\s*(?:\+|&#(?:43|x2b);|[.!?]|$|\b(?:at|when|grocery|supermarket|orders?|basket|minimum|min|spend)\b))/i.test(tail) ||
      (match.index < headline.length && SHORTHAND_MINIMUM.test(headline.slice(match.index))) ||
      /^\s+(?:on\s+)?(?:(?:your|an?|the|next|first|eligible|qualifying|grocery|supermarket|uber|reserve|eats|food|\d+)\s+){0,8}(?:orders?|basket|shop|rides?|trips?)\b/i.test(tail)) return 'order';
  if (/£\s*\d+(?:\.\d+)?\s*\/\s*(?:kg|g|l|ml|unit|100)\b/i.test(before) ||
      /^.{0,70}\(\d+\s*(?:ml|l|g|kg|pack)\b/i.test(tail)) return 'product';
  if (/(?:offer|promo(?:tion)?|discount)\b.{0,140}\b(?:eligible|qualifying|delivery|uber eats|grocery|supermarket)\s+(?:orders?|basket)\b/i.test(text) ||
      /(?:minimum|min\.?)(?:\s+(?:spend|order|basket))?\s*(?:of\s*)?£|when you spend|orders? (?:over|of) £/i.test(text) ||
      /\bvalid on (?:all )?orders? (?:placed|made) via (?:the )?uber|\boffer will be automatically applied to (?:the )?basket\b/i.test(text)) return 'order';
  return 'uncertain';
}

function firstInText(text, patterns) {
  return patterns.map(pattern => text.match(pattern)).filter(Boolean)
    .sort((a, b) => a.index - b.index)[0] || null;
}

export function extractOfferDetails(text, { subject = '' } = {}) {
  const uberCashMatch = firstInText(text, [
    /£\s*(\d+(?:\.\d{1,2})?)\s+(?:in\s+)?uber\s+cash\b/i,
    /(?:get|receive|you\s+have)\s+£\s*(\d+(?:\.\d{1,2})?)\s+(?:in\s+)?uber\s+cash\b/i
  ]);

  const percentMatch = firstInText(text, [
    /(\d{1,3})\s*%\s*(?:off|discount)/i,
    /\bsave\s*(\d{1,3})\s*%/i
  ]);

  const fixedMatch = firstInText(text, [
    /£\s*(\d+(?:\.\d{1,2})?)\s*(?:off|discount)\b/i,
    /(?:save|get)\s*£\s*(\d+(?:\.\d{1,2})?)\s*(?:off|discount)\b/i
  ]);

  const usesMatch = firstMatch(text, [
    /\b(?:your\s+)?(?:next|first)\s+(\d+)\s+(?:eligible\s+)?(?:uber\s+)?(?:trips?|rides?|orders?)\b/i,
    /\b(?:up\s+to|on)\s+(\d+)\s+(?:eligible\s+)?(?:uber\s+)?(?:trips?|rides?|orders?)\b/i,
    /\b(?:off|discount|valid\s+for|redeemable\s+on)\s+(\d+)\s+(?:eligible\s+)?(?:uber\s+)?(?:trips?|rides?|orders?)\b/i
  ]);

  const singleUseMatch = text.match(/\b(?:your\s+)?(?:next|first)\s+(?:eligible\s+)?(?:uber\s+)?(?:order|ride|trip)\b/i);
  const perUseCapMatch = firstMatch(text, [
    /(?:up\s+to|maximum|max\.?)\s*£\s*(\d+(?:\.\d{1,2})?)\s*(?:off\s*)?(?:per|each)\s*(?:trip|ride|order)/i,
    /£\s*(\d+(?:\.\d{1,2})?)\s*(?:off\s*)?(?:per|each)\s*(?:trip|ride|order)/i
  ]);

  const maxSavingMatch = firstMatch(text, [
    /(?:up\s+to|maximum|max\.?)\s*(?:saving|savings|discount)?\s*(?:is\s*)?£\s*(\d+(?:\.\d{1,2})?)/i,
    /(?:save|discount)\s+up\s+to\s*£\s*(\d+(?:\.\d{1,2})?)/i
  ]);

  const explicitMinimum = firstMatch(text, [
    /(?:minimum|min\.?)(?:\s+(?:spend|order|basket))?\s*(?:of\s*)?£\s*(\d+(?:\.\d{1,2})?)/i,
    /\d+\s*%\s*off\s*£\s*(\d+(?:\.\d{1,2})?)\s*(?:\+|&#(?:43|x2b);)/i,
    /£\s*(\d+(?:\.\d{1,2})?)\s+(?:minimum|min\.?)\s+(?:spend|order|basket)/i,
    /(?:when\s+you\s+spend|orders?\s+(?:over|of)|spend\s+at\s+least)\s*£\s*(\d+(?:\.\d{1,2})?)/i
  ]);
  // A neighbouring product price after “Enjoy £15 off” is not a basket
  // minimum. Prefer explicit order terms. Compact shorthand must have an
  // order/spend boundary, or end in the separately preserved subject.
  const subjectMinimum = String(subject).replace(/\s+/g,' ').trim().match(SHORTHAND_MINIMUM);
  const minimumSpendMatch = explicitMinimum || subjectMinimum || text.match(SHORTHAND_MINIMUM);

  const codeMatch = firstMatch(text, [
    /(?:promo\s+code(?:\s+below)?|use\s+code|using\s+promo\s+code|code)\s*(?:is|[:\-])?\s*([A-Z0-9][A-Z0-9_-]{3,31})\b/i
  ]);

  let discountType = null;
  let discount = null;
  let discountMatch = null;

  // A later membership benefit or Cash footer cannot overwrite the quantified
  // offer in the headline. "Get 6% cashback" is earning, not 6% off an order.
  const candidates = [
    ...allInText(text, [/£\s*(\d+(?:\.\d{1,2})?)\s+(?:in\s+)?uber\s+cash\b/i]).map(match => ['uberCash', match]),
    ...allInText(text, [/(\d{1,3})\s*%\s*(?:off|discount)/i, /\bsave\s*(\d{1,3})\s*%/i]).map(match => ['percent', match]),
    ...allInText(text, [/£\s*(\d+(?:\.\d{1,2})?)\s*(?:off|discount)\b/i]).map(match => ['fixed', match])
  ].sort((a,b) => a[1].index - b[1].index);
  const scoped = candidates.map(([type, match]) => ({type, match, scope:discountScope(text, match, type, subject)}));
  const chosen = scoped.find(candidate => candidate.scope !== 'product') || scoped[0];
  // Prefer a confirmed order coupon over uncertain copy in a mixed message.
  const primary = chosen?.scope === 'uncertain' ? scoped.find(candidate => candidate.scope === 'order') || chosen : chosen;
  if (primary) {
    discountType = primary.type; discountMatch = primary.match;
    discount = number(discountMatch[1]);
  }

  const uses = usesMatch ? number(usesMatch[1]) : 1;
  const safeUses = Number.isSafeInteger(uses) && uses > 0 ? uses : 1;
  const perUseCap = perUseCapMatch ? number(perUseCapMatch[1]) : null;
  const genericMaxSaving = maxSavingMatch ? number(maxSavingMatch[1]) : null;
  const maxSaving = perUseCap != null ? perUseCap : genericMaxSaving;

  let maxTotalSaving = genericMaxSaving;

  if (perUseCap != null) {
    maxTotalSaving = Number((perUseCap * safeUses).toFixed(2));
  } else if (discountType === "fixed" && discount != null && safeUses > 1) {
    const genericLooksPerUse = genericMaxSaving == null || genericMaxSaving === discount;
    if (genericLooksPerUse) {
      maxTotalSaving = Number((discount * safeUses).toFixed(2));
    }
  } else if (discountType === "uberCash" && discount != null) {
    maxTotalSaving = discount;
  }

  return {
    discountType,
    discount,
    maxSaving,
    perUseCap,
    uses: safeUses,
    maxTotalSaving,
    minimumSpend: minimumSpendMatch ? number(minimumSpendMatch[1]) : 0,
    code: codeMatch && !/^(?:below|above|here|this|will|must|only|applies|valid|expires|available|when|your|account)$/i.test(codeMatch[1])
      ? codeMatch[1].toUpperCase() : null,
    evidence: {
      discount: sourceSnippet(text, discountMatch),
      discountPosition: discountMatch?.index ?? null,
      discountScope: primary?.scope || null,
      minimumSpend: sourceSnippet(text, minimumSpendMatch),
      promoCode: sourceSnippet(text, codeMatch),
      uses: sourceSnippet(text, usesMatch),
      usesBasis: (usesMatch && safeUses === uses) || singleUseMatch ? 'explicit_offer_terms' : 'single_use_default',
      cap: sourceSnippet(text, perUseCapMatch || maxSavingMatch)
    }
  };
}
