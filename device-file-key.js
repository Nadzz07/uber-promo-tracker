// Non-exportable browser key. Never included in a download or public export.
const DB='uber-tracker-file-keys',STORE='keys',ID='device-backup-v1',KIND='uber-tracker-device-encrypted';
const compatibility='Legacy encrypted file: convert it in your trusted Mac environment before importing. Existing data is unchanged.';
export const LEGACY_FILE_MESSAGE=compatibility;
const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const base64=b=>{const view=new Uint8Array(b),parts=[];for(let i=0;i<view.length;i+=32768)parts.push(String.fromCharCode(...view.subarray(i,i+32768)));return btoa(parts.join(''));};
async function key(create){
 if(!globalThis.indexedDB||!globalThis.crypto?.subtle)throw Error('Encrypted backups are unavailable in this browser. No file was exported.');
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('Backup key storage is unavailable.'));r.onblocked=()=>reject(Error('Backup key storage is busy. Close other tracker tabs and try again.'));});
 try{
  const found=await new Promise((resolve,reject)=>{const t=db.transaction(STORE,'readonly'),r=t.objectStore(STORE).get(ID);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  if(found)return found;
  if(!create)throw Error('This encrypted backup needs its original browser’s key. It cannot be restored on another device or after browser data is cleared.');
  const candidate=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  // One transaction arbitrates simultaneous first exports across tabs.
  return await new Promise((resolve,reject)=>{const t=db.transaction(STORE,'readwrite'),s=t.objectStore(STORE),r=s.get(ID);let chosen;r.onsuccess=()=>{chosen=r.result||candidate;if(!r.result)s.put(chosen,ID);};t.oncomplete=()=>resolve(chosen);t.onerror=t.onabort=()=>reject(Error('Could not save the backup key. No file was exported.'));});
 }finally{db.close();}
}
export async function encryptDeviceFile(data){const k=await key(true),iv=crypto.getRandomValues(new Uint8Array(12)),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(KIND)},k,new TextEncoder().encode(JSON.stringify(data)));return {kind:KIND,schemaVersion:1,iv:base64(iv),ciphertext:base64(cipher)};}
export async function decryptDeviceFile(value){
 if(value?.kind!==KIND||value.schemaVersion!==1||typeof value.ciphertext!=='string'||value.ciphertext.length>20000000||typeof value.iv!=='string')throw Error('Unsupported encrypted device backup.');
 const k=await key(false);try{const iv=bytes(value.iv);if(iv.length!==12)throw Error();return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(KIND)},k,bytes(value.ciphertext))));}catch{throw Error('Could not read this backup with this browser’s key. Existing data is unchanged.');}
}
