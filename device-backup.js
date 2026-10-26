import {validateFinanceData,encryptFinance,decryptFinance,FINANCE_STORAGE_KEY,commitDeviceRestore,mergeFinanceData} from './private-finance-vault.js';
import {deviceEmail} from './device-accounts.js';
import {normaliseManualStore} from './manual-state.js';
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
   if(value.version!==3||!object(value.offers)||value.accountRecords&&!object(value.accountRecords))throw Error('Unsupported manual usage version.');
   for(const state of Object.values(value.offers))if(!object(state)||state.manualUsesConsumed!=null&&(!Number.isInteger(state.manualUsesConsumed)||state.manualUsesConsumed<0)||state.history!=null&&!Array.isArray(state.history))throw Error('Invalid manual usage.');
   for(const r of Object.values(value.accountRecords||{}))if(!object(r)||r.note!=null&&(typeof r.note!=='string'||r.note.length>10000)||r.archived!=null&&typeof r.archived!=='boolean')throw Error('Invalid saved account change.');
  }
  if(key.endsWith('planner-settings:v1')&&(value.maxOrders!=null&&![1,2,3,4].includes(value.maxOrders)||value.extraOrderFee!=null&&(!Number.isFinite(value.extraOrderFee)||value.extraOrderFee<0)||value.fulfilment!=null&&!['delivery','pickup'].includes(value.fulfilment)||value.feeTouched!=null&&typeof value.feeTouched!=='boolean'))throw Error('Invalid planner preferences.');
  if(key.endsWith('offer-preferences:v1')&&(value.version!==1||!Array.isArray(value.preferredPromos)||value.preferredPromos.some(v=>typeof v!=='string')||['includeCash','anyPromoWithCash'].some(k=>value[k]!=null&&typeof value[k]!=='boolean')))throw Error('Invalid offer preferences.');
  if(key.endsWith('device-accounts:v1'))for(const [ref,r] of Object.entries(value))if(!object(r)||!deviceEmail(value,{accountRef:ref,accountMasked:r.accountMasked})||typeof r.email!=='string'||r.email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)||typeof r.accountMasked!=='string')throw Error('Invalid saved account identity.');
 }
 return values;
}
export function deviceBackup(vault,storage=vault.storage){
 if(vault.status!=='ready'||!vault.data)throw Error('Private records could not load. Existing data is preserved.');
 badKeys(vault.data);
 const values={};for(const key of DEVICE_BACKUP_KEYS){const raw=storage.getItem(key);if(raw!=null)values[key]=raw;}
 if(!values[prefix+'manual-state:v3']){const legacy=JSON.parse(storage.getItem('uber-eats-promo-finder:promo-state:v2')||'{}'),offers={};for(const [id,state]of Object.entries(legacy)){if(state==='ignored')offers[id]={ignored:true};if(state==='used')offers[id]={forceDone:true};}if(Object.keys(offers).length)values[prefix+'manual-state:v3']=JSON.stringify({version:3,offers});}
 validateValues(values);return {...vault.data,deviceBackup:{schemaVersion:1,createdAt:new Date().toISOString(),values}};
}
export async function exportDeviceBackup(vault,password){const value=JSON.stringify(await encryptFinance(deviceBackup(vault),password));if(value.length>19999000)throw Error('This device backup exceeds the supported 20 MB transfer size. Existing data is unchanged.');return value;}
export async function readDeviceBackup(input,password){
 const data=input?.kind==='uber-tracker-encrypted-finance'?await decryptFinance(input,password):validateFinanceData(input);
 validateFinanceData(data);badKeys(data);
 if(data.deviceBackup){if(data.deviceBackup.schemaVersion!==1||!Number.isFinite(Date.parse(data.deviceBackup.createdAt)))throw Error('Unsupported device backup version.');validateValues(data.deviceBackup.values);}
 const ids=new Map();for(const event of data.events){const text=JSON.stringify(event);if(ids.has(event.id)&&ids.get(event.id)!==text)throw Error('Conflicting correction history.');ids.set(event.id,text);}
 return data;
}
export function prepareDeviceRestore(vault,incoming){
 if(!vault.data||vault.status!=='ready')throw Error('Current private records could not load. Existing data is preserved.');
 const finance=mergeFinanceData(vault.data,incoming);delete finance.deviceBackup;validateFinanceData(finance);
 const values={};for(const [key,raw]of Object.entries(incoming.deviceBackup?.values||{})){
  if(key.endsWith('manual-state:v3')){const before=normaliseManualStore(JSON.parse(vault.storage.getItem(key)||'{}')),after=JSON.parse(raw);values[key]=JSON.stringify({...after,offers:{...before.offers,...after.offers},accountRecords:{...before.accountRecords,...after.accountRecords}});}
  else if(key.endsWith('device-accounts:v1'))values[key]=JSON.stringify({...JSON.parse(vault.storage.getItem(key)||'{}'),...JSON.parse(raw)});
  else values[key]=raw;
 }
 const beforeReceipts=new Map(vault.data.receipts.map(r=>[r.receiptId,r])),beforeEvents=new Set(vault.data.events.map(e=>e.id));
 const manualKey=prefix+'manual-state:v3',manual=JSON.parse(values[manualKey]||'{}'),prior=JSON.parse(vault.storage.getItem(manualKey)||'{}');
 const changed=(a={},b={})=>Object.entries(a).filter(([k,v])=>JSON.stringify(v)!==JSON.stringify(b[k])).length;
 const changes={newReceipts:finance.receipts.filter(r=>!beforeReceipts.has(r.receiptId)).length,updatedReceipts:finance.receipts.filter(r=>beforeReceipts.has(r.receiptId)&&JSON.stringify(r)!==JSON.stringify(beforeReceipts.get(r.receiptId))).length,historyEntries:finance.events.filter(e=>!beforeEvents.has(e.id)).length,offerRecords:changed(manual.offers,prior.offers),accountChanges:changed(manual.accountRecords,prior.accountRecords),preferences:Object.entries(values).filter(([k,v])=>!k.endsWith('manual-state:v3')&&!k.endsWith('device-accounts:v1')&&v!==vault.storage.getItem(k)).length};
 return {finance,values,changes,revision:vault.saved,baseline:Object.fromEntries(DEVICE_BACKUP_KEYS.map(k=>[k,vault.storage.getItem(k)])),preview:{receipts:finance.receipts.length,corrections:finance.events.filter(e=>e.kind==='receipt').length,accounts:finance.accounts.length,manualOffers:Object.keys(incoming.deviceBackup?.values?.[prefix+'manual-state:v3']?JSON.parse(incoming.deviceBackup.values[prefix+'manual-state:v3']).offers:{}).length,preferences:Object.keys(values).length,deviceBackup:Boolean(incoming.deviceBackup)}};
}
export async function applyDeviceRestore(vault,plan){if(vault.saved!==plan.revision||Object.entries(plan.baseline).some(([k,v])=>vault.storage.getItem(k)!==v))throw Error('Device data changed. Review the backup again.');const manual='uber-eats-promo-tracker:manual-state:v3',effective=deviceBackup(vault).deviceBackup.values[manual];return commitDeviceRestore(vault,plan.finance,plan.values,DEVICE_BACKUP_KEYS,vault.storage.getItem(manual)===null&&effective?{[manual]:effective}:{});}
export {FINANCE_STORAGE_KEY};
