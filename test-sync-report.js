import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {assertPublicSnapshot} from './public-snapshot.js';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sync-report-test-'));
try{
 const input=path.join(dir,'input.json'),output=path.join(dir,'promos.json'),history=path.join(dir,'history.json'),db=path.join(dir,'source.local.db'),at=new Date().toISOString();
 fs.writeFileSync(input,JSON.stringify({messages:[],mailboxes:[{role:'promo'},{role:'receipt'}],exportedAt:at,scanStats:{emailsChecked:3,checkedKeys:['private-native-a','private-native-b','private-native-a']},schedulerReport:{state:'enabled',intervalSeconds:3600,reportedAt:at}}));
 const env={...process.env,TRACKER_ALLOW_UNKNOWN_ACCOUNTS:'1',TRACKER_ACCOUNT_ACCESS:'',TRACKER_PRIVATE_DB:db};
 for(let n=0;n<2;n++){
  execFileSync(process.execPath,['generate-promos.js',input,output,history,db],{env,stdio:'pipe'});const result=JSON.parse(fs.readFileSync(output));assert.equal(result.sync.runs.length,1);assert.deepEqual(result.sync.runs[0],{at,status:'success',emailsChecked:2,newReceipts:0,offersUpdated:0});assert.equal(result.sync.scheduler.intervalSeconds,3600);assert.ok(!fs.readFileSync(output,'utf8').includes('private-native'));assert.throws(()=>assertPublicSnapshot({...result,deviceBackup:{values:{private:'secret'}}},JSON.parse(fs.readFileSync(history))),/private field/);
 }
 const old=JSON.parse(fs.readFileSync(input));delete old.scanStats;old.exportedAt=new Date(Date.parse(at)+1000).toISOString();fs.writeFileSync(input,JSON.stringify(old));execFileSync(process.execPath,['generate-promos.js',input,output,history,db],{env,stdio:'pipe'});assert.equal(JSON.parse(fs.readFileSync(output)).sync.runs[0].emailsChecked,null,'Older exporters do not invent an email count');
 console.log('✓ Actual generator sync telemetry: per-run zero vs unknown, deduplicated checked messages, idempotent run history, scheduler provenance and no private scan keys in public output.');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
