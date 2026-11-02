// Legacy snapshots did not distinguish an explicit count from a regex guess.
// Large legacy counts stay reviewable until the original message is reparsed.
export function useCountNeedsReview(promo = {}) {
  const uses = Number(promo.uses ?? 1);
  return !Number.isInteger(uses) || uses < 1 ||
    (uses > 10 && promo.usesVerified !== true && promo.evidence?.usesBasis !== 'explicit_offer_terms');
}

export function offerTitle(promo = {}) {
  const amount = Number(promo.discount);
  if (!Number.isFinite(amount) || amount <= 0) return 'Promo terms need checking';
  const value = promo.discountType === 'percent' ? amount + '% off'
    : '£' + amount + (promo.discountType === 'uberCash' ? ' Uber Cash' : ' off');
  if (useCountNeedsReview(promo)) return value + ' · order count needs checking';
  const uses = Number(promo.uses ?? 1);
  return value + (uses > 1 ? ' on ' + uses + ' orders' : '');
}

// A derived percentage never changes the advertised title or discount type.
export function effectiveDiscountPercent(promo, spend) {
  const basket = Number(spend), amount = Number(promo.discount);
  if (!Number.isFinite(basket) || basket <= 0 || basket < Number(promo.minimumSpend || 0) || !Number.isFinite(amount) || amount <= 0 || !['fixed','percent'].includes(promo.discountType)) return null;
  let saving = promo.discountType === 'fixed' ? amount : basket * amount / 100;
  if (promo.discountType === 'percent' && (promo.perUseCap ?? promo.maxSaving) != null) saving = Math.min(saving, Number(promo.perUseCap ?? promo.maxSaving));
  return Math.round(Math.min(saving, basket) / basket * 10000) / 100;
}

// Display source facts; inferred values retain their own review reason.
export function offerTermsRows(promo={},money=v=>new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:2}).format(v)){
 const rows=[],restrictions=promo.restrictions||{},add=(label,value,field,estimated=false,reason=null)=>rows.push({label,value,field,estimated,reason,status:value==='Unknown'?'unknown':estimated?'estimated':'confirmed'});
 const amount=promo.discount,minimum=promo.minimumSpend,limit=promo.uses;
 const title=amount==null?'Unknown':promo.discountType==='percent'?amount+'% off':money(amount)+' off'+(minimum!=null&&Number(minimum)>0?' '+money(minimum):'');
 add('Offer',title,'discount',promo.termsVerification==='needs_verification','Discount terms need checking');
 add('Orders',(promo.usesVerified===true||promo.evidence?.usesBasis==='explicit_offer_terms')&&Number.isInteger(Number(limit))&&Number(limit)>0?'Up to '+limit+(Number(limit)===1?' order':' orders'):'Unknown','uses',false,'Order allowance is not confirmed');
 add('Minimum spend',minimum==null?'Unknown':Number(minimum)===0?'No minimum spend':money(minimum)+' per order'+(restrictions.excludesFees===true?', excluding fees':''),'minimumSpend',minimum!=null&&promo.minimumSpendVerified===false,'Minimum spend is not confirmed');
 if(restrictions.fulfilment==='delivery_only')add('Order type','Delivery only','fulfilment');
 if(restrictions.fulfilment==='pickup_only')add('Order type','Collection only','fulfilment');
 if(restrictions.merchantLimited===true)add('Merchants','Selected merchants','merchants');
 if(restrictions.stacking==='no_other_promotions')add('Other promos','Cannot be combined','stacking');
 const cap=promo.perUseCap??promo.maxSaving;if(cap!=null&&(promo.discountType==='percent'||promo.capBasis==='explicit'))add('Maximum discount',money(cap)+' per order','cap',promo.capBasis==='unknown','Maximum discount is not confirmed');
 const days=restrictions.eligibleDays||restrictions.days;if(Array.isArray(days)&&days.length)add('Eligible days',days.join(', '),'eligibleDays');
 if(restrictions.newCustomersOnly===true)add('Customers','New customers only','customers');
 if(typeof restrictions.customerRestriction==='string'&&restrictions.customerRestriction.trim())add('Customers',restrictions.customerRestriction,'customers');
 if(restrictions.excludesAlcoholTobacco===true)add('Exclusions','Alcohol and tobacco','exclusions');
 const deadline=promo.expiresAt||promo.expires,valid=deadline&&Number.isFinite(Date.parse(deadline));
 const inferred=promo.expiryStatus==='estimated'||['weekday_from_email_date','relative_to_email_date','estimated_from_email_date','tracker_35_day_rule','cash_original_email_duration'].includes(promo.expiryBasis);
 add('Expiry date',valid?new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/London'}).format(new Date(deadline)):'Unknown','expiry',Boolean(valid&&inferred),inferred?'Expiry is estimated; check the date in Uber':'Expiry is not recorded');
 return rows;
}
export function offerFieldReviewReasons(promo={}){
 const fields=offerTermsRows(promo).filter(r=>(promo.discountType!=='uberCash'||r.field==='expiry')&&(r.estimated||r.status==='unknown')).map(r=>({field:r.field,status:r.status,reason:r.reason||r.label+' is not confirmed'}));if(Number(promo.receiptConfirmedUses)>0&&Number(promo.usesRemaining)>0)fields.push({field:'remainingUses',status:'estimated',reason:'Remaining uses are estimated from recorded usage'});return fields;
}
