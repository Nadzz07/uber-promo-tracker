// Private read-only classification. Mail execution is a separate approved tool.
import {analyseSender} from './parser-v2/sender.js';
import {parseUberEatsReceipt} from './receipt-parser.js';
import {parseUberTransportReceipt} from './transport-receipt-parser.js';
import {parseUberPromo} from './parser.js';
import {receiptText,hasForwardedReceiptClaims} from './receipt-text.js';
import {extractAccountAlias} from './parser-v2/utils.js';
export function classifyCleanupMessage(message,accounts=new Map()) {
 const text=receiptText(message.subject,message.body),subject=String(message.subject||'');
 const result=(category,reason,destination=null)=>({category,reason,destination});
 const receiptCandidate=/\breceipt\b|thanks for (?:your order|riding)|your .*?(?:trip|order)|trip fare|ride total/i.test(subject+'\n'+text.slice(0,1500));
 const receipt=receiptCandidate?parseUberEatsReceipt(message):{isReceipt:false},ride=receiptCandidate&&!receipt.isReceipt?parseUberTransportReceipt(message):null;
 if(receipt.isReceipt||ride?.isReceipt||(/\breceipt\b|thanks for (?:your order|riding)|your .*?trip/i.test(subject)&&/£\s*\d|trip id|order id|view (?:your |the )?(?:full )?receipt/i.test(text)))return result('protected_receipt','Receipt evidence takes priority over any promotion.');
 if(/\b(?:verification|security|sign[ -]?in|login|recover|password|phone|payment|transaction|refund|charge|invoice)\b/i.test(subject)&&/verification|\bcode\b|\botp\b|phone number|password|recover|security|account activity|payment|transaction|refund|charged|mastercard|visa|invoice/i.test(text.slice(subject.length)))return result('protected_security_transaction','Security, access or essential transaction evidence.');
 if(hasForwardedReceiptClaims(subject,message.body))return result('uncertain','Forwarded identity is not independently verified.');
 const sender=analyseSender(message.sender);if(sender.trusted!==true||sender.confidence!=='high')return result('uncertain','Sender identity is not sufficiently supported.');
 const alias=extractAccountAlias(message.recipient),account=accounts.get(alias);if(!account||account.canLogin==null)return result('uncertain','Unknown recipient or pending login verification.');
 const promo=parseUberPromo(message),scope=promo.evidence?.discountScope||promo.offerScope;
 const marketing=promo.isPromo||/\bunsubscribe\b/i.test(text)&&/\b(?:offer|promotion|discount|save|off|try|order|trip|shop)\b/i.test(text);
 if(!marketing)return result('uncertain','No clear promotion or marketing evidence.');
 if(account.canLogin===false)return result('inaccessible_promotion','Promotional mail for an account that cannot log in.','Bin');
 const ride40=promo.service==='Uber'&&promo.discountType==='percent'&&Number(promo.discount)===40&&/\bride|\btrip/i.test(text);
 if(ride40)return result('excluded_marketing','Specifically excluded 40% Ride promotion.','Bin');
 if(scope==='product'||promo.rejectionReason==='product_deal_not_account_promotion')return result('excluded_marketing','Confirmed product-specific offer; genuine order discounts are retained.','Bin');
 if(promo.isPromo&&promo.discount>0&&scope!=='uncertain')return result('genuine_promotion','Genuine account/order-level promotion or reminder.','Archive');
 if(promo.isPromo||scope==='uncertain'||promo.discount>0)return result('uncertain','Offer terms or scope need review.');
 return result('excluded_marketing','Clear generic marketing without a qualifying offer.','Bin');
}
export function cleanupPreview(sources,accounts) {
 const counts={},logical=new Set(),targets=[],protectedSources=[],review=[];let duplicates=0,alreadyAtDestination=0;
 for(const source of sources){const classification=classifyCleanupMessage(source.message,accounts),key=String(source.message.messageId||'').toLowerCase()+'|'+String(source.message.recipient||'').toLowerCase();counts[classification.category]=(counts[classification.category]||0)+1;if(logical.has(key))duplicates++;logical.add(key);
 const last=source.path?.at(-1)||source.message.sourceMailbox;
 if(classification.category.startsWith('protected')){protectedSources.push({accountId:source.accountId,path:source.path,nativeId:source.nativeId,messageId:source.message.messageId});continue;}
 if(!classification.destination){review.push({accountRef:accounts.get(source.message.recipient)?.accountRef||null,reason:classification.reason});continue;}
 if(/^(?:sent messages|drafts|bin|trash|deleted messages|deleted items)$/i.test(last)||classification.destination==='Archive'&&/^archive$/i.test(last)){alreadyAtDestination++;continue;}
 if(!source.accountId||!source.path||source.nativeId==null||!source.raw||!source.message.messageId){review.push({reason:'A qualified physical source is required.'});continue;}
 targets.push({accountId:source.accountId,path:source.path,nativeId:source.nativeId,messageId:source.message.messageId,recipient:source.message.recipient,raw:source.raw,...classification});
 }
 return {version:1,kind:'uber-tracker-cleanup-preview',createdAt:new Date().toISOString(),counts,physicalSources:sources.length,logicalMessages:logical.size,duplicates,alreadyAtDestination,targets,protectedSources,review};
}
