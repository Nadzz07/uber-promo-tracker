// Structured Cash terms only. Never export these private source snippets.
export function extractCashTerms(text=''){
 const duration=String(text).match(/(?:valid\s+(?:for|within)|expire[sd]?\s+(?:in|after)|(?:within|for))\s+(\d{1,3})\s+(days?|weeks?|months?)\b/i);
 const activation=/\b(?:from|since|after)\s+(?:it\s+(?:was|is)\s+)?(?:being\s+)?(?:applied|added|credited|activat\w*|redeem\w*|claim\w*)\b|\bactivation date\b/i.test(text);
 const original=/\b(?:from|since|after|of)\s+(?:receiv(?:e|ed|ing)\s+)?(?:the\s+|this\s+|your\s+)?(?:original\s+)?(?:offer\s+)?(?:e-?mail|message)\b|\breceiv(?:e|ed|ing)\s+(?:this|the|your)\s+offer\b/i.test(text);
 const issued=/\b(?:we(?:'ve| have)?\s+(?:added|credited|issued)|(?:has|have)\s+been\s+(?:added|credited)|you(?:'ve| have)\s+received)\b/i.test(text);
 const reminder=/\b(?:reminder|still (?:have|waiting)|don't forget|do not forget|expires? (?:today|tomorrow|soon)|last chance)\b/i.test(text);
 const reference=String(text).match(/\b(?:grant|credit)\s+(?:reference|id)\s*[:#]\s*([a-z0-9-]{4,80})/i)?.[1]||null;
 return {duration:duration?Number(duration[1]):null,unit:duration?duration[2].toLowerCase().replace(/s$/,'')+'s':null,
  anchor:activation?'activation':duration&&(original||issued||/expires?\s+in/i.test(duration[0]))?'original_email':null,
  explicitNewGrant:!reminder&&/\b(?:another|additional|new)\s+£?\s*\d|\bnew (?:cash )?(?:grant|credit)\b/i.test(text),
  issuedEvidence:issued,reminder,grantReference:reference,
  excludesFees:/\b(?:uber cash|credit)\b[^.]{0,100}\b(?:cannot|can't|does not|not)\b[^.]{0,45}\b(?:fees|delivery charges)\b/i.test(text)};
}

// Private receipt evidence: identifiers never enter the public aggregate.
export function cashAllocationEvidence(text=''){
 const reference=String(text).match(/\bUber Cash\s+(?:grant|credit)\s+(?:reference|id)\s*[:#]\s*([a-z0-9-]{4,80})/i)?.[1];
 const refund=String(text).match(/\bUber Cash\s+(?:refunded|restored|returned)\s*[:]?\s*£\s*(\d+(?:\.\d{1,2})?)/i)?.[1];
 return {...(reference?{cashGrantRef:reference}:{}),...(refund?{cashRefundRestored:Number(refund)}:{}),cashUsageAmbiguous:/\bUber credits?\s*[-−]?\s*£\s*\d/i.test(text)};
}
