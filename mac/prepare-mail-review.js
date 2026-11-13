#!/usr/bin/env node
// Read-only all-history preview. Never imports into SQLite or moves Mail.
import fs from 'node:fs';
import path from 'node:path';
import {once} from 'node:events';
import {createGzip,createGunzip} from 'node:zlib';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {parseMboxText,decodeHeaderValue} from '../mbox-import.js';
import {jsonLines,targetKey} from '../reviewed-cleanup-plan.js';
import {getReceipts,getTransportReceipts} from '../private-db.js';
import {receiptFingerprint,transportReceiptFingerprint} from '../identity.js';
import {parseDeviceAccounts} from '../device-accounts.js';
import {validateFinanceData} from '../private-finance-vault.js';
import {createMailReviewContext,historicalMailAccess,reviewMailMessage,campaignWinner,finalizeMailDecision,mailIdentityExclusion,MAIL_REVIEW_RULE_VERSION} from '../mail-review-rules.js';
import {cleanupPolicyFingerprint} from '../cleanup-policy.js';
import {confirmedFiling} from '../mail-filing-rules.js';
import {analyseSender} from '../parser-v2/sender.js';
process.umask(0o077);
const args=process.argv.slice(2),options={};for(let i=0;i<args.length;i+=2){if(!['--capture','--out','--db','--accounts','--finance','--snapshot'].includes(args[i])||!args[i+1])throw Error('Expected named preview inputs.');options[args[i].slice(2)]=path.resolve(args[i+1]);}
for(const key of ['capture','out','db','accounts','finance','snapshot'])if(!options[key])throw Error('Missing preview input: '+key);
if(!options.out.endsWith('.local')||!options.capture.endsWith('.local.jsonl.gz')||!fs.existsSync(options.db))throw Error('Existing private inputs and a private preview directory are required.');
const hash=async file=>{const h=createHash('sha256');for await(const chunk of fs.createReadStream(file))h.update(chunk);return h.digest('hex');};
const ruleFingerprint=cleanupPolicyFingerprint();
const inputProofs=[];for(const file of [options.capture,options.db,options.accounts,options.finance,options.snapshot])inputProofs.push({file,sha256:await hash(file)});
inputProofs.push({file:options.db+'-wal',sha256:fs.existsSync(options.db+'-wal')?await hash(options.db+'-wal'):null});
const identities=JSON.parse(fs.readFileSync(options.accounts)),finance=JSON.parse(fs.readFileSync(options.finance)),snapshot=JSON.parse(fs.readFileSync(options.snapshot));
validateFinanceData(finance);parseDeviceAccounts(identities,snapshot.accounts);
const db=new DatabaseSync(options.db,{readOnly:true}),saved=[...getReceipts(db),...getTransportReceipts(db)],savedById=new Map(saved.map(r=>[r.receiptId,r]));
if(saved.length!==finance.receipts.length||finance.receipts.some(r=>JSON.stringify(r)!==JSON.stringify(savedById.get(r.receiptId))))throw Error('Private receipt source does not exactly match the current transfer; do not use it for filing.');
const normal=v=>String(v||'').trim().replace(/^<|>$/g,'').toLowerCase();
const imported=new Set(db.prepare("SELECT m.message_id,a.alias FROM messages m JOIN accounts a USING(account_ref) WHERE m.accepted=1 AND m.kind IN ('receipt','transport_receipt')").all().map(m=>normal(m.message_id)+'|'+m.alias));const historicalAccess=historicalMailAccess(db);db.close();
const receiptImported=(message,receipt,account)=>{
 if(!imported.has(normal(message.messageId)+'|'+account.email))return false;
 const id=receipt.service==='Uber Eats'?receiptFingerprint({...receipt,accountRef:account.accountRef}):transportReceiptFingerprint({...receipt,accountRef:account.accountRef});
 const saved=savedById.get(id);if(!saved||saved.accountRef!==account.accountRef)return false;
 // A newer source with different monetary facts must be imported first.
 for(const k of ['total','subtotal','promotionDiscount','uberCashUsed','deliveryFee','serviceFee','refundAmount'])if(receipt[k]!=null&&receipt[k]!==saved[k])return false;
 return true;
};
const context=createMailReviewContext({accounts:identities,historicalAccess,snapshot,finance,receiptImported}),winners=new Map(),classified=new Map();let completed=null,sourceCount=0;
async function* sources(parse=true){for await(const line of jsonLines(fs.createReadStream(options.capture).pipe(createGunzip()))){if(!line.trim())continue;const s=JSON.parse(line);if(s.kind==='complete'){completed=s;continue;}if(s.kind!=='source')continue;
 if(!parse){const cached=classified.get(targetKey(s));if(!cached)throw Error('Physical source changed between preview passes.');yield {...s,message:cached.message,classification:cached.classification};continue;}
 const parsed=await parseMboxText('From export Thu Jan 01 00:00:00 1970\n'+s.raw.replace(/\r\n/g,'\n'));if(parsed.length!==1){yield {...s,message:{subject:'',sender:'',recipient:''}};continue;}
 const header=s.raw.split(/\r?\n\r?\n/,1)[0].replace(/\r?\n[ \t]+/g,' '),from=header.match(/^From:\s*(.*)$/im)?.[1],to=header.match(/^To:\s*(.*)$/im)?.[1];
 const addresses=[...new Set((decodeHeaderValue(to||'').match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)||[]).map(normal))];
 const message={...parsed[0],sender:decodeHeaderValue(from||''),sentAt:s.sentAt,receivedAt:s.receivedAt};
 if(addresses.length!==1||addresses[0]!==normal(message.recipient))message.sender='';
 yield {...s,message};
}}
for await(const source of sources()){sourceCount++;if(sourceCount%1000===0)console.log('Classified '+sourceCount+' sources for preview.');const uberSender=analyseSender(source.message.sender).trusted===true;const securityLike=!uberSender&&(Boolean(mailIdentityExclusion(source.message))||/multi-factor|two-factor|authentication settings|new device sign|password|security code/i.test(String(source.message.subject||'')));const filed=uberSender||securityLike?null:confirmedFiling(source,source.message,new Set());const c=securityLike?{category:'excluded_login_code',reason:'Login or security email outside Uber: left in its current folder.',destination:null}:filed?{category:'non_uber_filing',reason:'Non-Uber mail filed by its actual sender into '+filed+'.',destination:filed}:reviewMailMessage(source.message,context),key=targetKey(source);if(classified.has(key))throw Error('Duplicate physical source in capture.');classified.set(key,{classification:c,message:{subject:source.message.subject,sentAt:source.message.sentAt,recipient:source.message.recipient,messageId:source.message.messageId}});if(c.deduplicate)winners.set(c.family,campaignWinner(winners.get(c.family),{accountId:source.accountId,path:source.path,nativeId:source.nativeId,sourceRaw:source.raw,message:{messageId:source.message.messageId,sentAt:source.message.sentAt,receivedAt:source.message.receivedAt}}));}
if(!completed||completed.captured!==sourceCount)throw Error('Mail scan is incomplete; preview is not executable.');
fs.mkdirSync(options.out,{recursive:true,mode:0o700});const plan=path.join(options.out,'plan.local.jsonl.gz'),details=path.join(options.out,'moves.local.jsonl.gz'),report=path.join(options.out,'report.local.json');
if([plan,details,report].some(f=>fs.existsSync(f)))throw Error('Do not overwrite an existing approval preview.');
const parts=['Archive','Uber Receipts','Bin','Others','Inbox','Amazon'].map((destination,index)=>{const file=path.join(options.out,'plan-part-'+index+'.tmp.local.gz'),zip=createGzip(),output=fs.createWriteStream(file,{flags:'wx',mode:0o600});zip.pipe(output);return {destination,file,zip,output};});const detailZip=createGzip(),detailFile=fs.createWriteStream(details,{flags:'wx',mode:0o600});detailZip.pipe(detailFile);
const write=async(stream,value)=>{if(!stream.write(JSON.stringify(value)+'\n'))await once(stream,'drain');};
const counts={},destinations={},byReason={},examples=[],seen=new Set();let alreadyThere=0,preserved=0,review=0,planned=0;
try{for await(const source of sources(false)){
 const initial=source.classification,c=finalizeMailDecision(source,initial,winners.get(initial.family));counts[c.category]=(counts[c.category]||0)+1;
 if(!c.destination){if(c.category==='review')review++;else preserved++;continue;}
 if(source.path.some(p=>/^(?:sent|sent messages|sent items|drafts|bin|trash|deleted messages|deleted items)$/i.test(p))||source.path.at(-1).toLowerCase()===c.destination.toLowerCase()){alreadyThere++;continue;}
 if(!source.accountId||!Number.isInteger(source.nativeId)||!source.raw||!source.message.messageId||!source.message.recipient)throw Error('A proposed source is incomplete.');
 const key=targetKey(source);if(seen.has(key))throw Error('Duplicate physical source in preview.');seen.add(key);
 const target={kind:'target',accountId:source.accountId,path:source.path,nativeId:source.nativeId,raw:source.raw,messageId:source.message.messageId,recipient:source.message.recipient,classification:c};
 await write(parts.find(p=>p.destination===c.destination).zip,target);const row={account:c.accountEmail,subject:source.message.subject,date:source.message.sentAt,from:source.path.join(' / '),to:c.destination,reason:c.reason};await write(detailZip,row);if(examples.length<15)examples.push(row);
 planned++;destinations[c.destination]=(destinations[c.destination]||0)+1;byReason[c.category]=(byReason[c.category]||0)+1;
 }const finished=parts.map(p=>once(p.output,'finish'));for(const p of parts)p.zip.end();const detailsFinished=once(detailFile,'finish');detailZip.end();await Promise.all([...finished,detailsFinished]);
 const combined=fs.createWriteStream(plan,{flags:'wx',mode:0o600});for(const part of parts){for await(const chunk of fs.createReadStream(part.file))if(!combined.write(chunk))await once(combined,'drain');}const combinedFinished=once(combined,'finish');combined.end();await combinedFinished;for(const part of parts)fs.unlinkSync(part.file);
 for(const proof of inputProofs)if((fs.existsSync(proof.file)?await hash(proof.file):null)!==proof.sha256)throw Error('Source data changed while preparing the preview.');
 if(cleanupPolicyFingerprint()!==ruleFingerprint)throw Error('Mail rules changed while preparing this preview; prepare it again.');
 const summary={kind:'uber-tracker-cleanup-preview',version:2,ruleVersion:MAIL_REVIEW_RULE_VERSION,ruleFingerprint,createdAt:new Date().toISOString(),scope:'All historical Uber emails across non-deleted received folders; Sent, Drafts and Bin are excluded from moves.',scan:completed,sourceReadOnly:true,inputProofs,planSha256:await hash(plan),counts,planned,destinations,byReason,preserved,review,alreadyAtDestination:alreadyThere,examples,requiresApproval:true};
 fs.writeFileSync(report,JSON.stringify(summary,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({planned,destinations,byReason,preserved,review,alreadyThere,report,approvalDigest:await hash(report)}));
}catch(error){for(const part of parts)part.zip.destroy();detailZip.destroy();throw error;}
