import {pendingManualUses} from './manual-state.js';
import {classifyOfferTrackingState} from './offer-state.js';
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
export const localOfferAnchor=promo=>JSON.stringify([promo.accountRef,promo.discountType,promo.discount,promo.minimumSpend,promo.uses,promo.expiresAt||promo.expires||null]);
export function validateLocalOfferEdits(edit){
 if(!object(edit)||edit.schemaVersion!==1||typeof edit.sourceAnchor!=='string'||edit.sourceAnchor.length>2048||!object(edit.values)||!Number.isFinite(Date.parse(edit.at)))throw Error('Invalid saved offer edits.');
 const p=edit.values;if(Object.keys(p).some(key=>!['minimumSpend','uses','expiresAt','expiryStatus','restriction'].includes(key)))throw Error('Unsupported offer field.');
 if(Object.hasOwn(p,'minimumSpend')&&(!Number.isFinite(p.minimumSpend)||p.minimumSpend<0||p.minimumSpend>10000))throw Error('Enter a valid minimum spend.');
 if(Object.hasOwn(p,'uses')&&(!Number.isSafeInteger(p.uses)||p.uses<1||p.uses>100))throw Error('Enter between 1 and 100 uses.');
 if(Object.hasOwn(p,'expiresAt')&&(!Number.isFinite(Date.parse(p.expiresAt))||!['exact','estimated'].includes(p.expiryStatus)))throw Error('Enter a valid expiry date and date type.');
 if(Object.hasOwn(p,'restriction')&&(typeof p.restriction!=='string'||p.restriction.length>120))throw Error('Keep the restriction under 120 characters.');
 return edit;
}
export function saveLocalOfferEdits(store,promo,values,at=new Date().toISOString()){
 if(!promo?.id||!promo.accountRef)throw Error('Offer source unavailable.');
 const before=store.offers?.[promo.id]||{},anchor=localOfferAnchor(promo),previous=before.fieldEdits?.sourceAnchor===anchor?before.fieldEdits.values:{};
 const edit=validateLocalOfferEdits({schemaVersion:1,sourceAnchor:anchor,values:{...previous,...values},at});
 const confirmed=Number(promo.receiptConfirmedUses||0),manual=pendingManualUses(store,promo);
 if(edit.values.uses!=null&&edit.values.uses<confirmed+manual)throw Error('Max uses cannot be below the recorded uses.');
 return {...store,version:3,offers:{...(store.offers||{}),[promo.id]:{...before,fieldEdits:edit,updatedAt:at,history:[...(before.history||[]),{type:'offer_terms_edited',at,previous:before.fieldEdits||null,edit}]}}};
}
export function applyLocalOfferEdits(view,rawState,source=view){
 const edit=rawState?.fieldEdits;if(!edit)return view;
 try{validateLocalOfferEdits(edit);}catch{return {...view,localEditIssue:'Saved terms need checking.'};}
 if(edit.sourceAnchor!==localOfferAnchor(source))return {...view,localEditIssue:'Source terms changed. Review your saved edits.'};
 const values=edit.values,total=values.uses??view.uses,count=view.receiptConfirmedUses;
 if(values.uses!=null&&count!=null&&count>values.uses)return {...view,localEditIssue:'Recorded uses exceed the saved allowance.'};
 const next={...view,...values,localTermsEdited:true,...(values.minimumSpend!=null?{minimumSpendVerified:true}:{}),...(values.uses!=null?{usesVerified:true,usesRemaining:count!=null?Math.max(0,total-count):total,receiptState:count!=null?(count>=total?'used':count>0?'partial':view.receiptState==='unused'?'unused':null):null}:{}),...(values.expiresAt?{expires:values.expiresAt.slice(0,10)}:{}),termsVerification:'manual'};
 return {...next,...classifyOfferTrackingState(next,{reviewReasons:next.reviewReasons||[]})};
}
export function removeLocalOffer(store,promo,at=new Date().toISOString()){
 if(!promo?.id)throw Error('Offer source unavailable.');const before=store.offers?.[promo.id]||{};
 return {...store,version:3,offers:{...(store.offers||{}),[promo.id]:{...before,ignored:true,removed:true,updatedAt:at,history:[...(before.history||[]),{type:'offer_removed_from_current',at}]}}};
}
