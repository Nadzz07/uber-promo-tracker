import {encryptDeviceFile,decryptDeviceFile,LEGACY_FILE_MESSAGE} from './device-file-key.js';
import {validateFinanceData,encryptFinance,decryptFinance,FINANCE_STORAGE_KEY,commitDeviceRestore,mergeFinanceData} from './private-finance-vault.js';
import {deviceEmail} from './device-accounts.js';
import {applyOfferExpiryPolicy,isOfferExpired} from './offer-time.js';
import {currentFinancialEvents} from './receipt-financials.js';
const prefix='uber-eats-promo-tracker:';
export const DEVICE_BACKUP_KEYS=[prefix+'manual-state:v3',prefix+'device-accounts:v1',prefix+'theme:v1',prefix+'layout:v1',prefix+'motion:v1',prefix+'planner-settings:v1',prefix+'offer-preferences:v1'];
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const badKeys=v=>{if(!v||typeof v!=='object')return;for(const k of Object.keys(v)){if(['__proto__','constructor','prototype','password','credentials','accessToken','apiKey','authorization','privilegedToken'].includes(k))throw Error('Invalid backup field.');badKeys(v[k]);}};
function validateValues(values){
 if(!object(values)||Object.keys(values).some(k=>!DEVICE_BACKUP_KEYS.includes(k)))throw Error('Unsupported device backup settings.');
 for(const [key,raw]of Object.entries(values)){
  if(typeof raw!=='string'||raw.length>10000000)throw Error('Invalid backup value.');
  if(key.endsWith('theme:v1')){if(!/^#[a-f0-9]{6}$/i.test(raw))throw Error('Invalid saved colour.');continue;}
  if(key.endsWith('layout:v1')){if(!['auto','mobile','desktop'].includes(raw))throw Error('Invalid saved layout.');continue;}
  if(key.endsWith('motion:v1')){if(!['system','reduced'].includes(raw))throw Error('Invalid saved motion.');continue;}
  const value=JSON.parse(raw);if(!object(value))throw Error('Invalid backup settings.');badKeys(value);
  if(key.endsWith('manual-state:v3')){
   if(value.version!=null&&value.version!==3||!object(value.offers)||value.accountRecords&&!object(value.accountRecords))throw Error('Unsupported manual usage version.');
   for(const state of Object.values(value.offers))if(!object(state)||state.manualUsesConsumed!=null&&(!Number.isInteger(state.manualUsesConsumed)||state.manualUsesConsumed<0)||state.history!=null&&!Array.isArray(state.history))throw Error('Invalid manual usage.');
   for(const state of Object.values(value.offers))if(['ignored','forceDone','competitionRestored'].some(k=>state[k]!=null&&typeof state[k]!=='boolean'))throw Error('Invalid saved offer state.');
   for(const r of Object.values(value.accountRecords||{}))if(!object(r)||r.note!=null&&(typeof r.note!=='string'||r.note.length>10000)||r.archived!=null&&typeof r.archived!=='boolean')throw Error('Invalid saved account change.');
  }
  if(key.endsWith('planner-settings:v1')&&value.basketSubtotal!=null&&value.basketSubtotal!==''&&(!Number.isFinite(Number(value.basketSubtotal))||Number(value.basketSubtotal)<0||Number(value.basketSubtotal)>1000))throw Error('Invalid saved basket.');
  if(key.endsWith('planner-settings:v1')&&(value.maxOrders!=null&&![1,2,3,4].includes(Number(value.maxOrders))||value.extraOrderFee!=null&&(!Number.isFinite(Number(value.extraOrderFee))||Number(value.extraOrderFee)<0)||value.fulfilment!=null&&!['delivery','pickup'].includes(value.fulfilment)||value.feeTouched!=null&&typeof value.feeTouched!=='boolean'))throw Error('Invalid planner preferences.');
  if(key.endsWith('offer-preferences:v1')&&(value.version!=null&&value.version!==1||value.preferredPromos!=null&&(!Array.isArray(value.preferredPromos)||value.preferredPromos.some(v=>typeof v!=='string'))||['includeCash','anyPromoWithCash'].some(k=>value[k]!=null&&typeof value[k]!=='boolean')))throw Error('Invalid offer preferences.');
  if(key.endsWith('device-accounts:v1')){const emails=new Set();for(const [ref,r]of Object.entries(value)){
   if(!object(r)||!deviceEmail(value,{accountRef:ref,accountMasked:r.accountMasked})||typeof r.email!=='string'||r.email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)||typeof r.accountMasked!=='string')throw Error('Invalid saved account identity.');
   if(r.canLogin!=null&&typeof r.canLogin!=='boolean'||r.loginMethods!=null&&(!Array.isArray(r.loginMethods)||!r.loginMethods.length||r.loginMethods.some(v=>!['iCloud','Google'].includes(v))))throw Error('Invalid saved login details.');
   const email=r.email.trim().toLowerCase();if(emails.has(email))throw Error('Duplicate backup account email.');emails.add(email);
  }}
 }
 return values;
}
export const BACKUP_FORMAT='uber-tracker-device-backup';
export const BACKUP_COVERAGE=['accounts','receipts','manualUsage','corrections','balances','preferences','offerSources','reconciliation'];
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const parsed=(raw,fallback={})=>raw==null?fallback:JSON.parse(raw);
function sourceRecords(source){
 if(!source)return null;
 if(source.schemaVersion!==1||!Array.isArray(source.accounts)||!Array.isArray(source.promos)||!Array.isArray(source.history)||source.accounts.length>100000||source.promos.length>100000||source.history.length>100000)throw Error('Unsupported backup offer records.');
 const accounts=new Set();for(const a of source.accounts){if(!object(a)||typeof a.accountRef!=='string'||!a.accountRef||accounts.has(a.accountRef))throw Error('Invalid backup account identity.');accounts.add(a.accountRef);}
 for(const rows of [source.promos,source.history]){const ids=new Set();for(const r of rows){if(!object(r)||typeof r.id!=='string'||!r.id||ids.has(r.id)||!accounts.has(r.accountRef))throw Error('Invalid backup offer relationship.');ids.add(r.id);}}
 badKeys(source);return source;
}
function mergeSources(current,incoming){
 if(!incoming)return current;
 if(!current)return structuredClone(incoming);
 const merge=(a,b,key)=>[...new Map([...a,...b].map(r=>[r[key],r])).values()];
 return {schemaVersion:1,accounts:merge(current.accounts,incoming.accounts,'accountRef'),promos:merge(current.promos,incoming.promos,'id'),history:merge(current.history,incoming.history,'id')};
}
function requiredSources(source,data,values){
 if(!source)return null;
 const manual=parsed(values[prefix+'manual-state:v3']),ids=new Set([...Object.keys(manual.offers||{}),...(data.offerReceiptMatches||[]).map(r=>r.offerId)]);
 const required=r=>ids.has(r.id)||ids.has(r.offerId)||!isOfferExpired(applyOfferExpiryPolicy(r));
 const accountFields=['accountRef','accountMasked','canLogin','accessStatus','loginMethod','accountStatus','deactivated','archived','lastSeenAt','lastPromoAt','lastOrderAt','lastRideAt','orderCount','rideCount','sourceReviewCount','receiptReviewCount','needsReview','cashSummary'];
 return {schemaVersion:1,accounts:source.accounts.map(a=>Object.fromEntries(accountFields.filter(k=>k in a).map(k=>[k,a[k]]))),promos:source.promos.filter(required),history:source.history.filter(required)};
}
export function deviceBackup(vault,storage=vault.storage,source=null){
 if(vault.status!=='ready'||!vault.data)throw Error('Private records could not load. Existing data is preserved.');
 if(storage.getItem(FINANCE_STORAGE_KEY)!==vault.saved)throw Error('Device data changed. Try exporting again.');
 badKeys(vault.data);
 const values={};for(const key of DEVICE_BACKUP_KEYS){const raw=storage.getItem(key);if(raw!=null)values[key]=raw;}
 if(!values[prefix+'manual-state:v3']){const legacy=parsed(storage.getItem('uber-eats-promo-finder:promo-state:v2')),offers={};for(const [id,state]of Object.entries(legacy)){if(state==='ignored')offers[id]={ignored:true};if(state==='used')offers[id]={forceDone:true};}if(Object.keys(offers).length)values[prefix+'manual-state:v3']=JSON.stringify({version:3,offers});}
 validateValues(values);
 const sources=requiredSources(mergeSources(sourceRecords(vault.data.trackerSource),sourceRecords(source)),vault.data,values);
 return structuredClone({...vault.data,...(sources?{trackerSource:sources}:{}),deviceBackup:{format:BACKUP_FORMAT,schemaVersion:2,createdAt:new Date().toISOString(),...(sources?{offerSourceScope:'available-and-referenced'}:{}),coverage:BACKUP_COVERAGE.filter(k=>k!=='offerSources'||sources),values}});
}
export async function exportDeviceBackup(vault,password,source=null){
 const baseline=Object.fromEntries([...DEVICE_BACKUP_KEYS,FINANCE_STORAGE_KEY,'uber-eats-promo-finder:promo-state:v2'].map(k=>[k,vault.storage.getItem(k)]));
 const data=deviceBackup(vault,vault.storage,source);
 const value=JSON.stringify(await(password===undefined?encryptDeviceFile(data):encryptFinance(data,password)));
 if(Object.entries(baseline).some(([k,v])=>vault.storage.getItem(k)!==v))throw Error('Device data changed while preparing the backup. Try again.');
 if(value.length>19999000)throw Error('This device backup exceeds the supported 20 MB transfer size. Existing data is unchanged.');return value;
}
function validateBackupMetadata(data){
 sourceRecords(data.trackerSource);
 if(data.deviceBackup){const b=data.deviceBackup;
  if(![1,2].includes(b.schemaVersion)||!Number.isFinite(Date.parse(b.createdAt)))throw Error('Unsupported device backup version.');
  if(b.offerSourceScope!=null&&b.offerSourceScope!=='available-and-referenced')throw Error('Unsupported backup offer coverage.');
  if(b.schemaVersion===2&&(b.format!==BACKUP_FORMAT||!Array.isArray(b.coverage)||new Set(b.coverage).size!==b.coverage.length||b.coverage.some(k=>!BACKUP_COVERAGE.includes(k))||['accounts','receipts','manualUsage','corrections','balances','preferences','reconciliation'].some(k=>!b.coverage.includes(k))||b.coverage.includes('offerSources')!==Boolean(data.trackerSource)))throw Error('Unsupported backup coverage.');
  validateValues(b.values);
 }
 for(const [rows,key]of [[data.accounts,'accountRef'],[data.events,'id']]){const ids=new Set();for(const r of rows){if(typeof r[key]!=='string'||!r[key]||ids.has(r[key]))throw Error('Invalid or duplicate backup identity.');ids.add(r[key]);}}
}
export async function readDeviceBackup(input,password){
 if(input?.kind==='uber-tracker-encrypted-finance'&&password===undefined)throw Error(LEGACY_FILE_MESSAGE);
 const data=input?.kind==='uber-tracker-device-encrypted'?await decryptDeviceFile(input):input?.kind==='uber-tracker-encrypted-finance'?await decryptFinance(input,password):validateFinanceData(input);
 validateFinanceData(data);badKeys(data);sourceRecords(data.trackerSource);
 validateBackupMetadata(data);
 return data;
}
export function prepareDeviceRestore(vault,incoming,resolutions={}){
 if(!vault.data||vault.status!=='ready')throw Error('Current private records could not load. Existing data is preserved.');
 validateFinanceData(incoming);badKeys(incoming);validateBackupMetadata(incoming);
 const accountKey=prefix+'device-accounts:v1',existingIdentities=parsed(vault.storage.getItem(accountKey)),incomingIdentities=parsed(incoming.deviceBackup?.values?.[accountKey]);
 const emailRefs=new Map(Object.entries(existingIdentities).map(([id,r])=>[String(r.email).trim().toLowerCase(),id]));
 for(const [id,r]of Object.entries(incomingIdentities)){const other=emailRefs.get(r.email.trim().toLowerCase());if(other&&other!==id)throw Error('This email is linked to another account. Review account identities before restoring.');}
 const records=[],conflicts=[],backup=Boolean(incoming.deviceBackup),copy=structuredClone(incoming),accountLabel=ref=>incomingIdentities[ref]?.email||existingIdentities[ref]?.email||incoming.accounts.find(a=>a.accountRef===ref)?.accountMasked||ref,offerLabels=new Map([...(incoming.trackerSource?.promos||[]),...(incoming.trackerSource?.history||[])].map(r=>[r.id,r.title||'Saved offer']));
 const track=(id,category,label,before,after,forceConflict=false)=>{
  const state=before===undefined?'addition':same(before,after)?'unchanged':'update';
  const conflict=state==='update'&&(backup||forceConflict);
  const resolution=resolutions[id];
  const row={id,category,label,state,before,after,conflict,resolution};records.push(row);if(conflict)conflicts.push(row);
  return conflict&&resolution==='saved'?before:after;
 };
 for(const [name,key,label]of [['accounts','accountRef','Account'],['receipts','receiptId','Receipt']]){
  const before=new Map(vault.data[name].map(r=>[r[key],r]));copy[name]=copy[name].map(r=>track(name+':'+r[key],name,name==='accounts'?'Account · '+accountLabel(r.accountRef):(r.service||'Receipt')+' receipt · '+accountLabel(r.accountRef),before.get(r[key]),r));
 }
 // Divergent correction histories cannot be resolved by guessing from timestamps.
 // Keep both originals intact and require correction in the receipt/balance flow.
 const current=currentFinancialEvents(vault.data.events),next=currentFinancialEvents(incoming.events),targets=new Set(vault.data.events.map(e=>e.kind+':'+e.recordId));
 for(const target of new Set(incoming.events.map(e=>e.kind+':'+e.recordId))){
  if(!backup||!targets.has(target))continue;
  const split=target.indexOf(':'),kind=target.slice(0,split),id=target.slice(split+1),map=kind==='receipt'?'corrections':'wallets';
  const plain=x=>x?Object.fromEntries(Object.entries(x).filter(([k])=>!['at','eventId'].includes(k))):null;
  if(!same(plain(current[map][id]),plain(next[map][id])))conflicts.push({id:'history:'+target,label:(kind==='receipt'?'Receipt correction ':'Checked balance ')+id,category:'history',before:plain(current[map][id]),after:plain(next[map][id]),blocked:true});
 }
 const priorEvents=new Map(vault.data.events.map(r=>[r.id,r]));for(const r of incoming.events)track('events:'+r.id,'history',r.kind==='cash'?'Balance history':'Correction history',priorEvents.get(r.id),r);
 const finance=mergeFinanceData(vault.data,copy);delete finance.deviceBackup;
 finance.trackerSource=mergeSources(incoming.trackerSource,vault.data.trackerSource);if(!finance.trackerSource)delete finance.trackerSource;
 if(incoming.trackerSource)for(const [bucket,key]of [['accounts','accountRef'],['promos','id'],['history','id']]){
  const prior=new Map((vault.data.trackerSource?.[bucket]||[]).map(r=>[r[key],r]));
  for(const r of incoming.trackerSource[bucket]){const before=prior.get(r[key]);track('source:'+bucket+':'+r[key],'sources',bucket==='accounts'?'Account source · '+(r.accountMasked||r.accountRef):'Offer source · '+(r.title||'Saved offer'),before,before||r);}
 }

 const values={};for(const [key,raw]of Object.entries(incoming.deviceBackup?.values||{})){
  const original=vault.storage.getItem(key);
  if(key.endsWith('manual-state:v3')||key.endsWith('device-accounts:v1')){
   const before=parsed(original),after=JSON.parse(raw),merged={...before};
   if(key.endsWith('manual-state:v3')){if(original===null){const legacy=parsed(vault.storage.getItem('uber-eats-promo-finder:promo-state:v2'));badKeys(legacy);before.offers=Object.fromEntries(Object.entries(legacy).filter(([,v])=>['used','ignored'].includes(v)).map(([id,v])=>[id,v==='used'?{forceDone:true}:{ignored:true}]));}merged.version=3;for(const bucket of ['offers','accountRecords']){merged[bucket]={...(before[bucket]||{})};for(const [id,value]of Object.entries(after[bucket]||{}))merged[bucket][id]=track(key+':'+bucket+':'+id,bucket,bucket==='offers'?(offerLabels.get(id)||'Saved offer'):'Account changes · '+accountLabel(id),before[bucket]?.[id],value);}}
   else for(const [id,value]of Object.entries(after))merged[id]=track(key+':'+id,'identities','Account identity · '+value.email,before[id],value);
   values[key]=JSON.stringify(merged);
  }else values[key]=track(key,'preferences',({'theme:v1':'Theme','layout:v1':'Layout','motion:v1':'Motion','planner-settings:v1':'Order Planner','offer-preferences:v1':'Preferred offers'})[key.slice(prefix.length)]||'Preference',original??undefined,raw);
 }
 // Imported snapshots retain IDs and offer links; missing categories never clear stores.
 const c={newReceipts:records.filter(r=>r.category==='receipts'&&r.state==='addition').length,updatedReceipts:records.filter(r=>r.category==='receipts'&&r.state==='update'&&r.resolution!=='saved').length,historyEntries:records.filter(r=>r.category==='history'&&r.state==='addition').length,offerRecords:records.filter(r=>r.category==='offers'&&r.state!=='unchanged'&&r.resolution!=='saved').length,accountChanges:records.filter(r=>r.category==='accountRecords'&&r.state!=='unchanged'&&r.resolution!=='saved').length,preferences:records.filter(r=>r.category==='preferences'&&r.state!=='unchanged'&&r.resolution!=='saved').length};
 return {finance,values,changes:c,records,conflicts,unresolved:conflicts.filter(r=>r.blocked||!['saved','backup'].includes(r.resolution)),revision:vault.saved,baseline:Object.fromEntries(DEVICE_BACKUP_KEYS.map(k=>[k,vault.storage.getItem(k)])),preview:backupContents(incoming)};
}
export function backupContents(data){
 const values=data.deviceBackup?.values||{},manual=parsed(values[prefix+'manual-state:v3']),identities=parsed(values[prefix+'device-accounts:v1']),active=currentFinancialEvents(data.events);
 return {accounts:new Set([...data.accounts.map(a=>a.accountRef),...Object.keys(identities),...(data.trackerSource?.accounts||[]).map(a=>a.accountRef)]).size,receipts:data.receipts.length,manualUses:Object.values(manual.offers||{}).reduce((n,r)=>n+(r.manualUsesConsumed||0),0),corrections:Object.keys(active.corrections).length,balances:Object.keys(active.wallets).length,preferences:Object.keys(values).filter(k=>!k.endsWith('manual-state:v3')&&!k.endsWith('device-accounts:v1')).length};
}
export async function applyDeviceRestore(vault,plan){
 if(plan.unresolved?.length)throw Error('Resolve the saved-value conflicts before restoring.');
 if(vault.saved!==plan.revision||Object.entries(plan.baseline).some(([k,v])=>vault.storage.getItem(k)!==v))throw Error('Device data changed. Review the backup again.');
 const manual=prefix+'manual-state:v3',overrides={};
 if(vault.storage.getItem(manual)===null){const old=parsed(vault.storage.getItem('uber-eats-promo-finder:promo-state:v2')),offers={};for(const [id,state]of Object.entries(old)){if(state==='ignored')offers[id]={ignored:true};if(state==='used')offers[id]={forceDone:true};}if(Object.keys(offers).length)overrides[manual]=JSON.stringify({version:3,offers});}
 return commitDeviceRestore(vault,plan.finance,plan.values,DEVICE_BACKUP_KEYS,overrides);
}
export {FINANCE_STORAGE_KEY};
