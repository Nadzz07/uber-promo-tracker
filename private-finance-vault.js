import {validateOfferReceiptLinks,mergeOfferReceiptLinks} from './account-sheet-data.js';
// Device-local data only. Transfer files remain passphrase-encrypted. No network access.
import {currentFinancialEvents,financialEditHistory,financialHistoryMetadata,validateFinancialCorrection,validateCashEntry} from './receipt-financials.js';
const KEY='uber-tracker-finance-encrypted-v1',iterations=310000;
const encode=bytes=>{const view=new Uint8Array(bytes),parts=[];for(let i=0;i<view.length;i+=32768)parts.push(String.fromCharCode(...view.subarray(i,i+32768)));return btoa(parts.join(''));};
const decode=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
// Serialize the version check and write across browser tabs. IndexedDB provides
// the same exclusion on older browsers without Web Locks; it stores no ledger.
const revisionFor=async value=>value===null?null:encode(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
async function withFinanceLock(storage,previous,next,action){
 if(storage!==globalThis.localStorage)return action();
 if(!globalThis.indexedDB)throw Error('This browser cannot safely coordinate private edits. Use a current browser.');
 const [expectedRevision,nextRevision]=await Promise.all([revisionFor(previous),revisionFor(next)]);
 const save=()=>new Promise((resolve,reject)=>{
  const open=indexedDB.open(KEY+'-lock',1);
  open.onupgradeneeded=()=>open.result.createObjectStore('mutex');
  open.onerror=()=>reject(Error('Private edits could not be coordinated.'));
  open.onsuccess=()=>{
   const db=open.result,transaction=db.transaction('mutex','readwrite');let result;
   transaction.oncomplete=()=>{db.close();resolve(result);};
   transaction.onabort=()=>{db.close();reject(transaction.error||Error('Private storage update failed.'));};
   const request=transaction.objectStore('mutex').get('save');
   request.onsuccess=()=>{try{
    // localStorage caches can lag across Firefox processes even under Web
    // Locks. IndexedDB serializes this authoritative revision comparison.
    const stored=request.result;
    if(stored?.revision!==undefined&&stored.revision!==expectedRevision){const error=Error('Private finances changed in another tab. Review the latest copy before saving.');error.financeConflict=true;throw error;}
    result=action();transaction.objectStore('mutex').put({revision:nextRevision},'save');
   }catch(error){transaction.abort();reject(error);}};
  };
 });
 return globalThis.navigator?.locks?.request?navigator.locks.request(KEY+'-save',save):save();
}
async function keyFor(password,salt){if(String(password).length<10)throw Error('Use a passphrase of at least 10 characters.');const base=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
export async function encryptFinance(data,password){const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));const key=await keyFor(password,salt);const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(KEY)},key,new TextEncoder().encode(JSON.stringify(data)));return {kind:'uber-tracker-encrypted-finance',schemaVersion:1,iterations,salt:encode(salt),iv:encode(iv),ciphertext:encode(encrypted)};}
export async function decryptFinance(envelope,password){if(envelope?.kind!=='uber-tracker-encrypted-finance'||envelope.schemaVersion!==1||envelope.iterations!==iterations||String(envelope.ciphertext).length>20000000)throw Error('Not a supported encrypted financial backup.');try{const salt=decode(envelope.salt),iv=decode(envelope.iv);if(salt.length!==16||iv.length!==12)throw Error();const key=await keyFor(password,salt);return validateFinanceData(JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(KEY)},key,decode(envelope.ciphertext)))));}catch{throw Error('Could not decrypt. Check the passphrase and backup file.');}}
export function validateFinanceData(data){if(data?.kind!=='uber-tracker-private-finance'||data.schemaVersion!==1||!Array.isArray(data.receipts)||data.receipts.length>100000||!Array.isArray(data.events)||data.events.length>100000||!Array.isArray(data.accounts))throw Error('Not a supported private finance file.');if(data.receiptReviewVersion!=null&&data.receiptReviewVersion!==1)throw Error('Unsupported receipt review version.');const accounts=new Set(data.accounts.map(a=>a.accountRef));const receipts=new Map();for(const r of data.receipts){if(r.financialReview&&(!Array.isArray(r.financialReview.reasons)||!r.financialReview.reasons.length||r.financialReview.reasons.some(reason=>!['refund','adjusted_receipt','changed_total'].includes(reason))||!/^[a-f0-9]{64}$/.test(r.financialReview.revision||'')))throw Error('Invalid receipt review evidence.');if(!r.receiptId||!accounts.has(r.accountRef)||receipts.has(r.receiptId))throw Error('Invalid or duplicate receipt identity.');receipts.set(r.receiptId,r);}for(const e of data.events){financialHistoryMetadata(e);if(!/^[a-z0-9-]{8,80}$/i.test(e.id)||!['receipt','cash'].includes(e.kind)||!['set','undo'].includes(e.action)||!Number.isFinite(Date.parse(e.at))||!accounts.has(e.accountRef)|| (e.kind==='receipt'&&receipts.get(e.recordId)?.accountRef!==e.accountRef)||(e.kind==='cash'&&e.recordId!==e.accountRef))throw Error('Financial history does not match these private accounts and receipts.');if(e.action==='set'){if(e.kind==='receipt')validateFinancialCorrection(e.value);else validateCashEntry(e.value);}}validateOfferReceiptLinks(data);return data;}
// Keep the original storage key so there is only one active ledger. Version 2
// is device-local, like imported identities. Browser-profile access grants access.
// The legacy ciphertext is retained separately only as a recovery original.
export const FINANCE_STORAGE_KEY=KEY;
export const LEGACY_RECOVERY_KEY=KEY+'-legacy-recovery';
const emptyData=()=>({kind:'uber-tracker-private-finance',schemaVersion:1,accounts:[],receipts:[],events:[]});
export class PrivateFinanceVault{
 constructor(storage=localStorage){this.storage=storage;this.data=null;this.queue=Promise.resolve();this.saved=null;this.status='loading';this.error=null;this.hydrate();}
 hasSaved(){return Boolean(this.storage.getItem(KEY));}
 hydrate(){
  try{const saved=this.storage.getItem(KEY),value=saved?JSON.parse(saved):null;
   if(value?.kind==='uber-tracker-encrypted-finance'){this.data=null;this.saved=saved;this.status='migration_required';this.error=null;return null;}
   const data=value===null?emptyData():value.kind==='uber-tracker-local-finance'&&value.schemaVersion===2?validateFinanceData(value.data):validateFinanceData(value);
   this.saved=saved;this.data=data;this.status='ready';this.error=null;return data;
  }catch(error){this.status='error';this.error=error;return null;}
 }
 async migrateLegacy(password){
  const original=this.storage.getItem(KEY);
  if(!original||JSON.parse(original).kind!=='uber-tracker-encrypted-finance'){this.hydrate();return this.data;}
  const data=await decryptFinance(JSON.parse(original),password);
  // Write and verify recovery BEFORE activating the migrated data. Any quota,
  // password, validation or cross-tab failure leaves the active original intact.
  if(this.storage.getItem(KEY)!==original)throw Error('Private data changed in another tab. Try migration again.');
  const recovery=this.storage.getItem(LEGACY_RECOVERY_KEY);
  if(recovery&&recovery!==original)throw Error('A different recovery original already exists. Keep both originals before migrating.');
  this.storage.setItem(LEGACY_RECOVERY_KEY,original);
  if(this.storage.getItem(LEGACY_RECOVERY_KEY)!==original)throw Error('Recovery verification failed. Original retained.');
  this.saved=original;await this.persist(data);
  const loaded=this.hydrate();if(!loaded||JSON.stringify(loaded)!==JSON.stringify(data))throw Error('Migration verification failed. Recovery original retained.');
  return loaded;
 }
 current(){return currentFinancialEvents(this.data?.events||[]);}
 async persist(data){
  validateFinanceData(data);const previous=this.saved,next=JSON.stringify({kind:'uber-tracker-local-finance',schemaVersion:2,data});
  return withFinanceLock(this.storage,previous,next,()=>{
   if(this.storage.getItem(KEY)!==previous){const error=Error('Private finances changed in another tab. Review the latest copy before saving.');error.financeConflict=true;throw error;}
   this.storage.setItem(KEY,next);this.saved=next;this.data=data;this.status='ready';this.error=null;return data;
  }).catch(error=>{if(error.financeConflict)this.hydrate();throw error;});
 }
 async import(data){if(!this.data)throw Error(this.status==='migration_required'?'Migrate existing private data in Sync & data first.':'Private data could not load. Original storage retained.');validateFinanceData(data);const incoming=new Map(data.events.map(e=>[e.id,e]));for(const e of this.data.events){if(incoming.has(e.id)&&JSON.stringify(incoming.get(e.id))!==JSON.stringify(e))throw Error('Conflicting history. Both originals remain unchanged.');incoming.set(e.id,e);}const receipts=new Map(data.receipts.map(r=>[r.receiptId,r]));for(const r of this.data.receipts){if(!receipts.has(r.receiptId))receipts.set(r.receiptId,r);else if(data.receiptReviewVersion!==1&&this.data.receiptReviewVersion===1&&r.financialReview)receipts.set(r.receiptId,{...receipts.get(r.receiptId),financialReview:r.financialReview});}const accounts=new Map(data.accounts.map(a=>[a.accountRef,a]));for(const a of this.data.accounts)if(!accounts.has(a.accountRef))accounts.set(a.accountRef,a);const merged=validateFinanceData({...data,...mergeOfferReceiptLinks(this.data,data),...(this.data.receiptReviewVersion===1?{receiptReviewVersion:1}:{}),accounts:[...accounts.values()],receipts:[...receipts.values()],events:[...incoming.values()]});return this.persist(merged);}
 append(input){const execute=async()=>{if(!this.data)throw Error(this.status==='migration_required'?'Migrate existing private data in Sync & data first.':'Private data could not load. Original storage retained.');const last=this.data.events.reduce((n,e)=>Math.max(n,Date.parse(e.at)),0);const value=input.action==='undo'?{}:input.kind==='receipt'?validateFinancialCorrection(input.value):validateCashEntry(input.value);const event={...input,value,id:crypto.randomUUID(),at:new Date(Math.max(Date.now(),last+1)).toISOString()};const next=validateFinanceData({...this.data,events:[...this.data.events,event]});await this.persist(next);return event;};const result=this.queue.then(execute);this.queue=result.catch(()=>{});return result;}
 resetReceiptCorrections(){const execute=async()=>{if(!this.data)throw Error(this.status==='migration_required'?'Migrate existing private data in Sync & data first.':'Private data could not load. Original storage retained.');await this.persist(validateFinanceData({...this.data,events:this.data.events.filter(e=>e.kind!=='receipt')}));};const result=this.queue.then(execute);this.queue=result.catch(()=>{});return result;}
 editHistory(kind,recordId){return financialEditHistory(this.data?.events||[],kind,recordId);}
 changeHistory(kind,recordId,direction){const execute=async()=>{if(!this.data)throw Error(this.status==='migration_required'?'Migrate existing private data in Sync & data first.':'Private data could not load. Original storage retained.');if(!['undo','redo'].includes(direction))throw Error('Invalid history action.');const change=this.editHistory(kind,recordId)[direction];if(!change)throw Error('Nothing to '+direction+'.');const value=direction==='undo'?change.before:change.after,last=this.data.events.reduce((n,e)=>Math.max(n,Date.parse(e.at)),0);const event={id:crypto.randomUUID(),at:new Date(Math.max(Date.now(),last+1)).toISOString(),kind,recordId,accountRef:change.event.accountRef,action:value===null?'undo':'set',value:value??{},historyAction:direction,historyTargetId:change.event.id,...(value===null?{}:{historyValueAt:direction==='undo'?change.beforeAt:change.afterAt})};await this.persist(validateFinanceData({...this.data,events:[...this.data.events,event]}));};const result=this.queue.then(execute);this.queue=result.catch(()=>{});return result;}
 recoveryBackup(){const value=this.storage.getItem(LEGACY_RECOVERY_KEY)||this.storage.getItem(KEY);if(!value||JSON.parse(value).kind!=='uber-tracker-encrypted-finance')throw Error('No legacy recovery original.');return value;}
 async encryptedBackup(password){if(!this.data)throw Error('Private data is unavailable.');return JSON.stringify(await encryptFinance(this.data,password));}
}
