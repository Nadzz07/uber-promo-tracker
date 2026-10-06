import { firstMatch, number, sourceSnippet } from "./utils.js";

export function extractOfferDetails(text) {
  const uberCashMatch = firstMatch(text, [
    /£\s*(\d+(?:\.\d{1,2})?)\s+(?:in\s+)?uber\s+cash\b/i,
    /(?:get|receive|you\s+have)\s+£\s*(\d+(?:\.\d{1,2})?)\s+(?:in\s+)?uber\s+cash\b/i
  ]);

  const percentMatch = firstMatch(text, [
    /(\d{1,3})\s*%\s*(?:off|discount)/i,
    /(?:save|get)\s*(\d{1,3})\s*%/i
  ]);

  const fixedMatch = firstMatch(text, [
    /£\s*(\d+(?:\.\d{1,2})?)\s*(?:off|discount)\b/i,
    /(?:save|get)\s*£\s*(\d+(?:\.\d{1,2})?)\s*(?:off|discount)\b/i
  ]);

  const usesMatch = firstMatch(text, [
    /(?:your\s+)?(?:next|first)\s+(\d{1,2})\s+(?:uber\s+)?(?:trips?|rides?|orders?)/i,
    /(?:up\s+to|on)\s+(\d{1,2})\s+(?:uber\s+)?(?:trips?|rides?|orders?)/i,
    /(\d{1,2})\s+(?:eligible\s+)?(?:trips?|rides?|orders?)\b/i
  ]);

  const perUseCapMatch = firstMatch(text, [
    /(?:up\s+to|maximum|max\.?)\s*£\s*(\d+(?:\.\d{1,2})?)\s*(?:off\s*)?(?:per|each)\s*(?:trip|ride|order)/i,
    /£\s*(\d+(?:\.\d{1,2})?)\s*(?:off\s*)?(?:per|each)\s*(?:trip|ride|order)/i
  ]);

  const maxSavingMatch = firstMatch(text, [
    /(?:up\s+to|maximum|max\.?)\s*(?:saving|savings|discount)?\s*£\s*(\d+(?:\.\d{1,2})?)/i,
    /(?:save|discount)\s+up\s+to\s*£\s*(\d+(?:\.\d{1,2})?)/i
  ]);

  const minimumSpendMatch = firstMatch(text, [
    /(?:minimum|min\.?)(?:\s+(?:spend|order|basket))?\s*£\s*(\d+(?:\.\d{1,2})?)/i,
    /£\s*(\d+(?:\.\d{1,2})?)\s+(?:minimum|min\.?)\s+(?:spend|order|basket)/i,
    /(?:when\s+you\s+spend|orders?\s+(?:over|of)|spend\s+at\s+least)\s*£\s*(\d+(?:\.\d{1,2})?)/i
  ]);

  const codeMatch = firstMatch(text, [
    /(?:promo\s+code(?:\s+below)?|use\s+code|using\s+promo\s+code|code)\s*(?:is|[:\-])?\s*([A-Z0-9][A-Z0-9_-]{3,31})\b/i
  ]);

  let discountType = null;
  let discount = null;
  let discountMatch = null;

  if (uberCashMatch) {
    discountType = "uberCash";
    discount = number(uberCashMatch[1]);
    discountMatch = uberCashMatch;
  } else if (percentMatch) {
    discountType = "percent";
    discount = number(percentMatch[1]);
    discountMatch = percentMatch;
  } else if (fixedMatch) {
    discountType = "fixed";
    discount = number(fixedMatch[1]);
    discountMatch = fixedMatch;
  }

  const uses = usesMatch ? number(usesMatch[1]) : 1;
  const safeUses = uses && uses > 0 && uses <= 99 ? uses : 1;
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
      minimumSpend: sourceSnippet(text, minimumSpendMatch),
      promoCode: sourceSnippet(text, codeMatch),
      uses: sourceSnippet(text, usesMatch),
      cap: sourceSnippet(text, perUseCapMatch || maxSavingMatch)
    }
  };
}
