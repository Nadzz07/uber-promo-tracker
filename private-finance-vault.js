// Loaded only when the user opens private finances. No network access.
import {currentFinancialEvents,validateFinancialCorrection,validateCashEntry} from './receipt-financials.js';
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
  open.onerror=()=>reject(Error('Private storage could not be locked.'));
  open.onsuccess=()=>{
   const db=open.result,transaction=db.transaction('mutex','readwrite');let result;
   transaction.oncomplete=()=>{db.close();resolve(result);};
   transaction.onabort=()=>{db.close();reject(transaction.error||Error('Private storage update failed.'));};
   const request=transaction.objectStore('mutex').get('save');
   request.onsuccess=()=>{try{
    // localStorage caches can lag across Firefox processes even under Web
    // Locks. IndexedDB serializes this authoritative revision comparison.
    const stored=request.result;
    if(stored?.revision!==undefined&&stored.revision!==expectedRevision){const error=Error('Private finances changed in another tab. Unlock the latest copy before editing.');error.financeConflict=true;throw error;}
    result=action();transaction.objectStore('mutex').put({revision:nextRevision},'save');
   }catch(error){transaction.abort();reject(error);}};
  };
 });
 return globalThis.navigator?.locks?.request?navigator.locks.request(KEY+'-save',save):save();
}
async function keyFor(password,salt){if(String(password).length<10)throw Error('Use a passphrase of at least 10 characters.');const base=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
export async function encryptFinance(data,password){const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));const key=await keyFor(password,salt);const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(KEY)},key,new TextEncoder().encode(JSON.stringify(data)));return {kind:'uber-tracker-encrypted-finance',schemaVersion:1,iterations,salt:encode(salt),iv:encode(iv),ciphertext:encode(encrypted)};}
export async function decryptFinance(envelope,password){if(envelope?.kind!=='uber-tracker-encrypted-finance'||envelope.schemaVersion!==1||envelope.iterations!==iterations||String(envelope.ciphertext).length>20000000)throw Error('Not a supported encrypted financial backup.');try{const salt=decode(envelope.salt),iv=decode(envelope.iv);if(salt.length!==16||iv.length!==12)throw Error();const key=await keyFor(password,salt);return validateFinanceData(JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(KEY)},key,decode(envelope.ciphertext)))));}catch{throw Error('Could not unlock. Check the passphrase and backup file.');}}
export function validateFinanceData(data){if(data?.kind!=='uber-tracker-private-finance'||data.schemaVersion!==1||!Array.isArray(data.receipts)||data.receipts.length>100000||!Array.isArray(data.events)||data.events.length>100000||!Array.isArray(data.accounts))throw Error('Not a supported private finance file.');const accounts=new Set(data.accounts.map(a=>a.accountRef));const receipts=new Map();for(const r of data.receipts){if(!r.receiptId||!accounts.has(r.accountRef)||receipts.has(r.receiptId))throw Error('Invalid or duplicate receipt identity.');receipts.set(r.receiptId,r);}for(const e of data.events){if(!/^[a-z0-9-]{8,80}$/i.test(e.id)||!['receipt','cash'].includes(e.kind)||!['set','undo'].includes(e.action)||!Number.isFinite(Date.parse(e.at))||!accounts.has(e.accountRef)|| (e.kind==='receipt'&&receipts.get(e.recordId)?.accountRef!==e.accountRef)||(e.kind==='cash'&&e.recordId!==e.accountRef))throw Error('Financial history does not match these private accounts and receipts.');if(e.action==='set'){if(e.kind==='receipt')validateFinancialCorrection(e.value);else validateCashEntry(e.value);}}return data;}
// Keys remain in memory. Mobile browsers can suspend timers, so also check the
// background deadline before revealing the vault when the app becomes visible.
export class PrivateFinanceSession {
 constructor({vault = new PrivateFinanceVault(), onLock = () => {}, now = Date.now,
   setTimer = (callback, delay) => setTimeout(callback, delay), clearTimer = timer => clearTimeout(timer), graceMs = 15 * 60000} = {}) {
  Object.assign(this, {vault, onLock, now, setTimer, clearTimer, graceMs});
  this.hiddenAt = null; this.timer = null;
 }
 visibility(hidden) {
  if (!this.vault.data) { this.cancel(); return; }
  if (hidden) {
   if (this.hiddenAt == null) {
    this.hiddenAt = this.now();
    this.timer = this.setTimer(() => this.lock(), this.graceMs);
   }
  } else {
   if (this.hiddenAt != null && (this.now() - this.hiddenAt >= this.graceMs || this.now() < this.hiddenAt)) this.lock();
   this.cancel();
  }
 }
 cancel() {
  if (this.timer != null) this.clearTimer(this.timer);
  this.timer = null; this.hiddenAt = null;
 }
 lock() { this.cancel(); this.vault.lock(); this.onLock(this.vault); }
}

export class PrivateFinanceVault{
 constructor(storage=localStorage){this.storage=storage;this.data=null;this.password=null;this.queue=Promise.resolve();this.epoch=0;this.saved=null;}
 hasSaved(){return Boolean(this.storage.getItem(KEY));}
 async unlock(password){const saved=this.storage.getItem(KEY),epoch=this.epoch;const data=saved?await decryptFinance(JSON.parse(saved),password):{kind:'uber-tracker-private-finance',schemaVersion:1,accounts:[],receipts:[],events:[]};if(epoch!==this.epoch||this.storage.getItem(KEY)!==saved)throw Error('Private finances changed or were locked. Unlock again.');this.saved=saved;this.data=data;this.password=password;if(!saved)await this.persist(this.data);return this.data;}
 lock(){this.epoch++;this.data=null;this.password=null;}
 current(){return currentFinancialEvents(this.data?.events||[]);}
 async persist(data){const epoch=this.epoch,password=this.password,previous=this.saved;const encrypted=await encryptFinance(data,password),next=JSON.stringify(encrypted);return withFinanceLock(this.storage,previous,next,()=>{if(epoch!==this.epoch)throw Error('Private finances were locked. Unlock before saving.');if(this.storage.getItem(KEY)!==previous){this.lock();throw Error('Private finances changed in another tab. Unlock the latest copy before editing.');}this.storage.setItem(KEY,next);this.saved=next;this.data=data;return data;}).catch(error=>{if(error.financeConflict)this.lock();throw error;});}
 async import(data){if(!this.data)throw Error('Unlock private finances first.');validateFinanceData(data);const incoming=new Map(data.events.map(e=>[e.id,e]));for(const e of this.data.events){if(incoming.has(e.id)&&JSON.stringify(incoming.get(e.id))!==JSON.stringify(e))throw Error('Conflicting history. Both originals remain unchanged.');incoming.set(e.id,e);}const receipts=new Map(data.receipts.map(r=>[r.receiptId,r]));for(const r of this.data.receipts)if(!receipts.has(r.receiptId))receipts.set(r.receiptId,r);const accounts=new Map(data.accounts.map(a=>[a.accountRef,a]));for(const a of this.data.accounts)if(!accounts.has(a.accountRef))accounts.set(a.accountRef,a);const merged=validateFinanceData({...data,accounts:[...accounts.values()],receipts:[...receipts.values()],events:[...incoming.values()]});return this.persist(merged);}
 append(input){const execute=async()=>{if(!this.data)throw Error('Unlock private finances first.');const last=this.data.events.reduce((n,e)=>Math.max(n,Date.parse(e.at)),0);const value=input.action==='undo'?{}:input.kind==='receipt'?validateFinancialCorrection(input.value):validateCashEntry(input.value);const event={...input,value,id:crypto.randomUUID(),at:new Date(Math.max(Date.now(),last+1)).toISOString()};const next=validateFinanceData({...this.data,events:[...this.data.events,event]});await this.persist(next);return event;};const result=this.queue.then(execute);this.queue=result.catch(()=>{});return result;}
 resetHistory(){const execute=async()=>{if(!this.data)throw Error('Unlock private finances first.');await this.persist(validateFinanceData({...this.data,events:[]}));};const result=this.queue.then(execute);this.queue=result.catch(()=>{});return result;}
 encryptedBackup(){const value=this.storage.getItem(KEY);if(!value)throw Error('No saved private finances.');return value;}
}
