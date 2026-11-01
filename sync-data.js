import {createReceiptImporter} from './receipt-import.js';
import {encryptDeviceFile} from './device-file-key.js';
import {syncState} from './dashboard-data.js';
import {financeIcon} from './finance-layout.js';
import {exportDeviceBackup,readDeviceBackup,prepareDeviceRestore,applyDeviceRestore} from './device-backup.js';
import {DEVICE_RECOVERY_KEY,PrivateFinanceVault} from './private-finance-vault.js';
const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const count=v=>Number.isInteger(v)&&v>=0?v.toLocaleString('en-GB'):'—';
export const formatSyncTime=v=>{if(!Number.isFinite(Date.parse(v)))return 'Not reported';const d=new Date(v),year=d.getFullYear()!==new Date().getFullYear();return new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',...(year?{year:'numeric'}:{})}).format(d)+', '+new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit'}).format(d);};
const when=formatSyncTime;
export function syncReportModel(sync={},now=Date.now()){
 const at=Date.parse(sync.lastSuccessfulMailScanAt),valid=Number.isFinite(at)&&at<=now+300000;
 const runs=Array.isArray(sync.runs)?sync.runs.filter(r=>['success','failed','running'].includes(r.status)&&Number.isFinite(Date.parse(r.at))&&Date.parse(r.at)<=now+300000).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,20):[];
 const latest=runs[0]||null;
 const running=sync.state==='syncing'&&Number.isFinite(Date.parse(sync.startedAt))&&now-Date.parse(sync.startedAt)>=0&&now-Date.parse(sync.startedAt)<1800000;
 return {label:running?'Sync running':sync.state==='failed'||latest?.status==='failed'?'Last sync failed':sync.state==='syncing'?'Sync status unavailable':valid?'Last sync successful':'Sync status unavailable',at:running?sync.startedAt:latest?.status==='failed'?latest.at:valid?sync.lastSuccessfulMailScanAt:null,latest,runs,scheduler:sync.scheduler&&Number.isFinite(Date.parse(sync.scheduler.reportedAt))?sync.scheduler:null};
}
// Daily reports carry their observed cadence into the Home status too.
export function reportedSyncState(sync={},options={}){
 const state=syncState(sync,options),now=options.now??Date.now(),s=sync.scheduler;
 const reportAge=now-Date.parse(s?.reportedAt),scanAge=now-Date.parse(sync.lastSuccessfulMailScanAt);
 return state.label==='Update due'&&s?.state==='enabled'&&s.intervalSeconds===86400&&reportAge>=-300000&&reportAge<=172800000&&scanAge>=0&&scanAge<=93600000?{label:'Up to date',className:'live'}:state;
}
export function syncDataMarkup(sync={}){
 const m=syncReportModel(sync),s=m.scheduler,chevron=financeIcon('chevron-right');
 const fresh=s&&Date.now()-Date.parse(s.reportedAt)>=-300000&&Date.now()-Date.parse(s.reportedAt)<=172800000;
 const schedule=fresh&&s.intervalSeconds===86400?(s.state==='enabled'?'Enabled':'Not confirmed'):'Not confirmed';
 const scan=Number.isFinite(Date.parse(sync.lastSuccessfulMailScanAt))&&Date.parse(sync.lastSuccessfulMailScanAt)<=Date.now()+300000?sync.lastSuccessfulMailScanAt:null;
 return '<header class="sd-header"><button data-sync-back aria-label="Back">'+financeIcon('chevron-left')+'</button><div><h1 id="syncTitle" tabindex="-1">Sync & data</h1><p>Updates, imports and backups</p></div><button data-sync-info aria-label="About sync and backups">'+financeIcon('info')+'</button></header>'+
 '<section class="sd-card sd-email" data-sync-email><h2 class="sd-eyebrow">Email updates</h2><div class="sd-scan">'+financeIcon('mail')+'<div><p>Last scanned</p><strong>'+e(when(scan))+'</strong></div><span class="sd-daily" data-sync-auto>'+e(schedule==='Enabled'?'Daily':'Schedule not confirmed')+'</span></div><p class="sd-email-caption">Email scans run on your Mac.</p></section>'+
 '<section class="sd-card sd-refresh-card"><div class="sd-refresh-heading">'+financeIcon('menu-sync')+'<div><h2>Refresh this device</h2><p>Load the latest published update</p></div></div><button class="sd-refresh sd-primary" data-device-refresh>Refresh data</button></section>'+
 '<h2 class="sd-heading">Import data</h2><section class="sd-card sd-imports"><button class="sd-row sd-action" data-receipt-import>'+financeIcon('receipt-slip')+'<span><strong>Import receipts</strong><small>Upload an updated private receipts file</small></span>'+chevron+'</button><button class="sd-row sd-action" data-account-import>'+financeIcon('user-plus')+'<span><strong>Import accounts</strong><small>Add accounts or update your account list</small></span>'+chevron+'</button></section><p class="sd-caption">Check changes before importing.</p>'+
 '<h2 class="sd-heading">Backups</h2><section class="sd-card"><details id="deviceBackupExport"><summary class="sd-row">'+financeIcon('menu-import')+'<span><strong>Export backup</strong><small>Copy your saved data</small></span>'+chevron+'</summary><form data-device-export class="sd-form"><p>Includes receipts on this device, corrections, balance history, saved account details and notes, manual uses, and saved colour, layout, motion, planner and offer preferences.</p><p>Encrypted for this browser only. Restore requires this browser’s saved key. It will not work on another device or after clearing browser data.</p><button class="sd-primary" type="submit">Export encrypted backup</button></form><div data-device-recovery></div></details><button class="sd-row sd-action" data-device-restore>'+financeIcon('upload')+'<span><strong>Restore backup</strong><small>Preview changes before restoring</small></span>'+chevron+'</button><input type="file" data-device-file accept="application/json,.json" hidden><div data-device-preview></div></section>'+
 '<section class="sd-card sd-about"><details><summary class="sd-row">'+financeIcon('info')+'<span>About updates</span>'+chevron+'</summary><div class="sd-about-body"><div class="sd-row">'+financeIcon('laptop')+'<span><strong>Email scanning</strong><small>Handled by your Mac.</small></span></div><div class="sd-row">'+financeIcon('shield')+'<span><strong>Public data</strong><small>A separate sanitised export.</small></span></div><p class="sd-caption">Sync details reflect the last report received.</p></div></details></section><p class="sd-notice" role="status" data-sync-notice></p>';
}
export function syncHistoryMarkup(sync={}){
 const m=syncReportModel(sync);return '<details class="sd-history"><summary class="sheet-action-row">View sync history</summary><div class="sd-history-body">'+(m.runs.length?m.runs.map(r=>'<div class="sd-row"><span>'+e(when(r.at))+'<small>'+e(r.status==='success'?'Successful':r.status==='failed'?'Failed':'Running')+'</small></span><span>'+count(r.emailsChecked)+' emails checked · '+count(r.newReceipts)+' new receipts · '+count(r.offersUpdated)+' offers</span></div>').join(''):'<p>No run history reported.</p>')+'</div></details><p class="sheet-help">Schedule last reported: '+e(when(m.scheduler?.reportedAt))+'.</p>';
}
export function createSyncData({host,getSync,vault,refresh,onRestore,onInfo,onBack,onAccounts}){
 host.innerHTML=syncDataMarkup(getSync());let busy=false,incoming=null,plan=null;
 const importer=createReceiptImporter({vault,onUpdate:onRestore});
 const notice=text=>{host.querySelector('[data-sync-notice]').textContent=text;};
 const download=(value,name)=>{const u=URL.createObjectURL(new Blob([value],{type:'application/json'})),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);};
 const disable=value=>{busy=value;host.querySelectorAll('button').forEach(b=>b.disabled=value);};
 const preview=()=>{plan=prepareDeviceRestore(vault,incoming);const c=plan.changes,unchanged=Math.max(0,incoming.receipts.length-c.newReceipts-c.updatedReceipts);host.querySelector('[data-device-preview]').innerHTML='<section class="sd-form"><h3>Review '+'restore'+'</h3><p>'+c.newReceipts+' new · '+c.updatedReceipts+' updated · '+unchanged+' unchanged receipts</p><p>'+c.historyEntries+' history entries · '+c.accountChanges+' account changes · '+c.preferences+' preferences</p><p>Merge with saved records. Existing corrections and other accounts remain.</p><button class="sd-primary" data-device-confirm>Confirm '+'restore'+'</button><button data-device-cancel>Cancel</button></section>';};
 const recovery=()=>{host.querySelector('[data-device-recovery]').innerHTML=vault.storage.getItem(DEVICE_RECOVERY_KEY)?'<button class="sd-recovery" data-device-recovery-download>Export recovery copy</button>':'';};recovery();
 async function action(fn){if(busy)return;disable(true);try{await fn();}catch(error){if(incoming&&plan&&/changed/.test(error.message)){try{preview();}catch{} }notice(error.message||'Could not complete this action. Existing data is preserved.');}finally{disable(false);}}
 const click=event=>{const b=event.target.closest('button');if(!b||busy)return;
 if(b.matches('[data-sync-back]'))onBack();if(b.matches('[data-sync-info]'))onInfo();
 if(b.matches('[data-account-import]'))onAccounts();
 if(b.matches('[data-receipt-import]'))importer.open();
 if(b.matches('[data-device-restore]'))host.querySelector('[data-device-file]').click();
 if(b.matches('[data-device-cancel]')){incoming=plan=null;host.querySelector('[data-device-preview]').innerHTML='';notice('Restore cancelled. No data changed.');}
 if(b.matches('[data-device-confirm]'))action(async()=>{await applyDeviceRestore(vault,plan);incoming=plan=null;host.querySelector('[data-device-preview]').innerHTML='';await onRestore();recovery();notice('Backup restored on this device.');});
 if(b.matches('[data-device-refresh]'))action(async()=>{notice('Refreshing published data…');const result=await refresh();notice(result==='updated'?'Updated published data loaded.':'This device is already current.');});
 if(b.matches('[data-device-recovery-download]'))action(async()=>{const original=JSON.parse(vault.storage.getItem(DEVICE_RECOVERY_KEY));const finance=original.values['uber-tracker-finance-encrypted-v1'];const stored=finance?JSON.parse(finance):null;if(stored&&!stored.data)throw Error('Legacy recovery needs conversion in your trusted Mac environment.');const data=stored?.data||{kind:'uber-tracker-private-finance',schemaVersion:1,accounts:[],receipts:[],events:[]};data.deviceBackup={schemaVersion:1,createdAt:original.createdAt,values:Object.fromEntries(Object.entries(original.values).filter(([k,v])=>v!=null&&k!=='uber-tracker-finance-encrypted-v1'))};download(JSON.stringify(await encryptDeviceFile(data)),'tracker-pre-restore-backup.local.json');notice('Encrypted recovery copy exported for this browser.');});
 };
 const change=event=>{if(!event.target.matches('[data-device-file]'))return;const file=event.target.files[0];event.target.value='';if(!file)return;incoming=plan=null;host.querySelector('[data-device-preview]').innerHTML='';action(async()=>{if(file.size>20000000)throw Error('File is too large.');incoming=await readDeviceBackup(JSON.parse(await file.text()));preview();notice('Review this file. Nothing has changed.');});};
 const submit=event=>{if(event.target.matches('[data-device-export]')){event.preventDefault();action(async()=>{download(await exportDeviceBackup(vault),'tracker-device-backup.local.json');notice('Encrypted backup download started. Restore in this browser only.');});}};
 host.addEventListener('click',click);host.addEventListener('change',change);host.addEventListener('submit',submit);
 return {destroy(){importer.destroy();host.removeEventListener('click',click);host.removeEventListener('change',change);host.removeEventListener('submit',submit);},refreshStatus(){const scroll=host.ownerDocument.defaultView.scrollY;const fresh=new DOMParser().parseFromString(syncDataMarkup(getSync()),'text/html');for(const selector of ['[data-sync-email]']){const old=host.querySelector(selector),next=fresh.querySelector(selector);if(old&&next&&old.outerHTML!==next.outerHTML){if(old.querySelector('details[open]'))next.querySelector('details')?.setAttribute('open','');old.replaceWith(next);}}host.ownerDocument.defaultView.scrollTo({top:scroll,behavior:'instant'});}};
}
