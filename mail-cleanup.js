// Shared read-only Mail decisions. No moves occur in this module.
import {reviewMailMessage,campaignWinner,finalizeMailDecision} from './mail-review-rules.js';
export function classifyCleanupMessage(message,accounts=new Map(),context=null) {
 const fallback={byEmail:accounts,offers:new Map(),completed:new Set(),resolve:()=>null,usage:()=>({known:false,used:false,full:false}),cashOverlap:()=>false,receiptImported:()=>false,now:Date.now()};
 return reviewMailMessage(message,context||fallback);
}
export function cleanupPreview(sources,accounts,context=null) {
 const winners=new Map();for(const source of sources){const c=classifyCleanupMessage(source.message,accounts,context);if(c.deduplicate)winners.set(c.family,campaignWinner(winners.get(c.family),source));}
 const counts={},logical=new Set(),targets=[],protectedSources=[],review=[];let duplicates=0,alreadyAtDestination=0;
 for(const source of sources){const initial=classifyCleanupMessage(source.message,accounts,context),classification=finalizeMailDecision(source,initial,winners.get(initial.family)),key=String(source.message.messageId||'').toLowerCase()+'|'+String(source.message.recipient||'').toLowerCase();counts[classification.category]=(counts[classification.category]||0)+1;if(logical.has(key))duplicates++;logical.add(key);
 const last=source.path?.at(-1)||source.message.sourceMailbox;
 if(classification.category.startsWith('protected')){protectedSources.push({accountId:source.accountId,path:source.path,nativeId:source.nativeId,messageId:source.message.messageId});continue;}
 if(!classification.destination){review.push({accountRef:accounts.get(source.message.recipient)?.accountRef||null,reason:classification.reason});continue;}
 if(/^(?:sent messages|drafts|bin|trash|deleted messages|deleted items)$/i.test(last)||classification.destination==='Archive'&&/^archive$/i.test(last)||classification.destination==='Inbox'&&/^inbox$/i.test(last)){alreadyAtDestination++;continue;}
 if(!source.accountId||!source.path||source.nativeId==null||!source.raw||!source.message.messageId){review.push({reason:'A qualified physical source is required.'});continue;}
 targets.push({accountId:source.accountId,path:source.path,nativeId:source.nativeId,messageId:source.message.messageId,recipient:source.message.recipient,raw:source.raw,classification,...classification});
 }
 return {version:1,kind:'uber-tracker-cleanup-preview',createdAt:new Date().toISOString(),counts,physicalSources:sources.length,logicalMessages:logical.size,duplicates,alreadyAtDestination,targets,protectedSources,review};
}
