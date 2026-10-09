#!/usr/bin/osascript -l JavaScript
ObjC.import('Foundation');
function read(path) { const v=$.NSString.stringWithContentsOfFileEncodingError($(String(path)),$.NSUTF8StringEncoding,null); if(!v)throw new Error('Private verified plan unavailable');return ObjC.unwrap(v); }
function mid(value) { return String(value||'').trim().replace(/^<|>$/g,'').toLowerCase(); }
function boxes(parent) { try{return parent.mailboxes();}catch(_){return [];} }
function find(list,name,result,path='') { for(let i=0;i<list.length;i++){const b=list[i], full=path+'/'+String(b.name());let account='local';try{account=String(b.account().id());}catch(_){}if(String(b.name()).toLowerCase()===name.toLowerCase())result.push({key:account+full,box:b});find(boxes(b),name,result,full);} }
function recipient(message) { const values=message.toRecipients.address(); const unique=[...new Set(values.map(v=>String(v).trim().toLowerCase()))]; return unique.length===1?unique[0]:null; }
function identityMatches(message,target) { return mid(message.messageId())===mid(target.messageId)&&recipient(message)===target.recipient&&new Date(message.dateReceived()).toISOString()===target.receivedAt&&String(message.content()||'')===target.body; }
function destinationMatches(destination,target) { const ids=destination.messages.id(), mids=destination.messages.messageId(), final=destination.messages.id();if(JSON.stringify(ids)!==JSON.stringify(final)||ids.length!==mids.length)throw new Error('Destination changed during verification');const matches=[];for(let i=0;i<ids.length;i++)if(mid(mids[i])===mid(target.messageId)) {const m=destination.messages.byId(ids[i]);if(identityMatches(m,target))matches.push(ids[i]);}return matches; }
function run(argv) {
 if(argv[1]!=='--execute-verified-plan')throw new Error('Explicit verified filing opt-in required');
 const plan=JSON.parse(read(argv[0]));if(plan.action!=='file_verified_receipts'||!Array.isArray(plan.targets))throw new Error('Invalid receipt filing plan');
 const start=+new Date(plan.start),end=+new Date(plan.end);if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end)throw new Error('Invalid calendar boundaries');
 const keys=new Set();
 for(const target of plan.targets){const time=+new Date(target.receivedAt),key=mid(target.messageId)+'|'+target.recipient;if(!Number.isFinite(time)||time<start||time>=end||target.sourceMailbox!=='INBOX'||!Number.isInteger(target.mailNativeId)||!target.recipient||!target.body||keys.has(key))throw new Error('Invalid, duplicate or out-of-day receipt target; no messages moved');keys.add(key);}
 const Mail=Application('Mail');Mail.includeStandardAdditions=false;
 const destinations=[];find(Mail.mailboxes(),plan.destination,destinations);const accounts=Mail.accounts();for(let i=0;i<accounts.length;i++)find(boxes(accounts[i]),plan.destination,destinations);
 // Resolve unique mailbox identity even if Mail exposes it at two roots.
 const unique=[];for(const box of destinations){const key=box.key;if(!unique.some(v=>v.key===key))unique.push(box);}
 if(unique.length!==1)throw new Error('Receipt destination is missing or ambiguous; no messages moved');const destination=unique[0].box;
 const results=[];let halted=false;
 for(const target of plan.targets) {
  if(halted){results.push({messageId:target.messageId,status:'left_untouched'});continue;}
  if(+new Date(target.receivedAt)<start||+new Date(target.receivedAt)>=end||target.sourceMailbox!=='INBOX')throw new Error('Out-of-day or non-Inbox target rejected before move');
  try {
   const message=Mail.inbox.messages.byId(target.mailNativeId);
   if(Number(message.id())!==Number(target.mailNativeId)||!identityMatches(message,target))throw new Error('Original Inbox receipt changed; no move');
   const before=destinationMatches(destination,target);
   if(before.length)throw new Error('Matching destination copy already exists; original left in Inbox for review');
   Mail.move(message,{to:destination});
   let after=[];for(let retry=0;retry<5;retry++){after=destinationMatches(destination,target);if(after.length===1)break;$.NSThread.sleepForTimeInterval(.4);}
   if(after.length!==1)throw new Error('Move issued but destination not uniquely verified; reconcile before retry');
   let remains=false;try{remains=identityMatches(Mail.inbox.messages.byId(target.mailNativeId),target);}catch(_){}
   if(remains)throw new Error('Destination exists but original still in Inbox; reconcile before retry');
   results.push({messageId:target.messageId,status:'moved_verified',destinationId:after[0]});
  } catch(error) { halted=true;results.push({messageId:target.messageId,status:'attention',reason:String(error)}); }
 }
 return JSON.stringify({requested:plan.targets.length,moved:results.filter(r=>r.status==='moved_verified').length,halted,results,destinationVerified:true,destination:plan.destination,verifiedAt:new Date().toISOString()});
}
