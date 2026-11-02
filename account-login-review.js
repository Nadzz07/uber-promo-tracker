// Private per-field evidence. Never include this table in public snapshots.
import {randomUUID} from 'node:crypto';
export function initLoginReview(db){db.exec(`CREATE TABLE IF NOT EXISTS account_login_fields(account_ref TEXT NOT NULL,field TEXT NOT NULL,value_json TEXT NOT NULL,status TEXT NOT NULL,source TEXT NOT NULL,confirmed_at TEXT,recorded_at TEXT NOT NULL,raw_json TEXT,PRIMARY KEY(account_ref,field));CREATE TABLE IF NOT EXISTS account_login_history(id TEXT PRIMARY KEY,account_ref TEXT NOT NULL,field TEXT NOT NULL,value_json TEXT NOT NULL,status TEXT NOT NULL,source TEXT NOT NULL,confirmed_at TEXT,recorded_at TEXT NOT NULL,raw_json TEXT);`);}
export function loginField(db,ref,field){return db.prepare('SELECT * FROM account_login_fields WHERE account_ref=? AND field=?').get(ref,field)||null;}
export function recordLoginField(db,ref,field,value,{source='access_list',confirmedAt=null,raw=null,status=value==null?'pending':source==='codex_chat'?'confirmed':'imported',at=new Date().toISOString()}={}){
 if(!['access','method'].includes(field)||field==='access'&&![true,false,null].includes(value)||field==='method'&&![null,'iCloud','Google','Both'].includes(value))throw Error('Invalid login field.');
 if(!db.prepare('SELECT 1 FROM accounts WHERE account_ref=?').get(ref))throw Error('Unknown account identity.');
 if(!['pending','confirmed','imported'].includes(status)||!['access_list','codex_chat','inferred','unrecognised','not_recorded'].includes(source)||confirmedAt!=null&&(!Number.isFinite(Date.parse(confirmedAt))||value==null))throw Error('Invalid login confirmation.');
 const current=loginField(db,ref,field),text=JSON.stringify(value),rawText=raw==null?null:JSON.stringify(raw);
 if(source!=='codex_chat'&&current&&(current.source==='codex_chat'||value==null&&current.status!=='pending'))return JSON.parse(current.value_json);
 if(current&&current.value_json===text&&current.status===status&&current.source===source)return value;
 const record=[ref,field,text,status,source,confirmedAt,at,rawText];
 db.prepare('INSERT INTO account_login_history VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(),...record);
 db.prepare('INSERT INTO account_login_fields VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(account_ref,field) DO UPDATE SET value_json=excluded.value_json,status=excluded.status,source=excluded.source,confirmed_at=excluded.confirmed_at,recorded_at=excluded.recorded_at,raw_json=excluded.raw_json').run(...record);
 return value;
}
export function auditLoginAccounts(db,registry=[]){
 const known=new Map(registry.map(r=>[r.email.trim().toLowerCase(),r]));const queue=[];
 for(const a of db.prepare('SELECT account_ref,alias,login_access,can_login,login_method,account_status FROM accounts ORDER BY account_ref').all()){
  const row=known.get(a.alias),ref=a.account_ref;
  for(const field of ['access','method']){
   const current=loginField(db,ref,field);if(current?.source==='codex_chat')continue;
   const raw=field==='access'?a.login_access:a.login_method;
   const supplied=field==='access'?row?.canLogin:row?.loginMethod;
   const recognised=field==='access'?[true,false].includes(supplied):['iCloud','Google','Both'].includes(supplied);
   recordLoginField(db,ref,field,recognised?supplied:null,{source:recognised?'access_list':raw?'unrecognised':'not_recorded',raw:row?.loginReview?.[field]?.raw??raw,status:recognised?'imported':'pending'});
  }
  const access=JSON.parse(loginField(db,ref,'access').value_json),method=JSON.parse(loginField(db,ref,'method').value_json);
  db.prepare('UPDATE accounts SET can_login=?,login_access=?,login_method=? WHERE account_ref=?').run(access===true?1:0,access==null?'pending':access?'accessible':'inaccessible',method,ref);
  if(access==null||method==null)queue.push({accountRef:ref,email:a.alias,deferred:a.account_status==='deactivated',missing:[...(access==null?['access']:[]),...(method==null?['method']:[])],reasons:Object.fromEntries(['access','method'].filter(field=>/awaiting permission/i.test(loginField(db,ref,field)?.raw_json||'')).map(field=>[field,'Awaiting permission needs clarification']))});
 }
 return {total:db.prepare('SELECT COUNT(*) n FROM accounts').get().n,missingAccess:queue.filter(r=>r.missing.includes('access')).length,missingMethod:queue.filter(r=>r.missing.includes('method')).length,deferredHistorical:queue.filter(r=>r.deferred).length,queue:queue.filter(r=>!r.deferred)};
}
export function confirmLoginFields(db,rows,at=new Date().toISOString()){
 if(!Array.isArray(rows)||!rows.length||!Number.isFinite(Date.parse(at)))throw Error('No login confirmations supplied.');
 db.exec('SAVEPOINT confirm_login_fields');try{
 for(const row of rows){const a=db.prepare('SELECT account_ref,alias,login_method,login_access,can_login FROM accounts WHERE account_ref=?').get(row.accountRef);if(!a||a.alias!==String(row.email).trim().toLowerCase())throw Error('Account identity does not match.');
  if(!Object.hasOwn(row,'access')&&!Object.hasOwn(row,'method'))throw Error('Choose the field being reviewed.');
  if(Object.hasOwn(row,'access')){const value=recordLoginField(db,a.account_ref,'access',row.access,{source:'codex_chat',at,confirmedAt:row.access==null?null:at});db.prepare('UPDATE accounts SET can_login=?,login_access=? WHERE account_ref=?').run(value===true?1:0,value==null?'pending':value?'accessible':'inaccessible',a.account_ref);}
  if(Object.hasOwn(row,'method')){const value=recordLoginField(db,a.account_ref,'method',row.method,{source:'codex_chat',at,confirmedAt:row.method==null?null:at});db.prepare('UPDATE accounts SET login_method=? WHERE account_ref=?').run(value,a.account_ref);}
 }
 db.exec('RELEASE confirm_login_fields');}catch(error){db.exec('ROLLBACK TO confirm_login_fields');db.exec('RELEASE confirm_login_fields');throw error;}
}
