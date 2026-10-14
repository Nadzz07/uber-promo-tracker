#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {openPrivateDb,getAccounts,getReceipts,getTransportReceipts} from '../private-db.js';
import {backupPrivateDb} from '../private-backup.js';
import {readFinancialEvents,mergeFinancialEvents} from '../financial-ledger.js';
import {financialSummary,currentFinancialEvents} from '../receipt-financials.js';
const args=process.argv.slice(2),operation=args.shift();
let source=process.env.TRACKER_PRIVATE_DB||'uber-tracker.local.db',file;
for(let i=0;i<args.length;i++)if(args[i]==='--db')source=args[++i];else if(args[i]==='--file')file=args[++i];else throw Error('Use export|import --db DB --file NEW.local.json');
if(!['export','import'].includes(operation)||!file||!/\.local\.json$/.test(file)||!fs.existsSync(source)||path.resolve(source)===path.resolve(file))throw Error('An existing private DB and *.local.json transfer file are required.');
if(operation==='export'&&fs.existsSync(file))throw Error('Existing transfer files are never overwritten.');
backupPrivateDb(source);
const db=openPrivateDb(source);
try{
 if(operation==='import'){
  const data=JSON.parse(fs.readFileSync(file));
  if(data.kind!=='uber-tracker-private-finance'||data.schemaVersion!==1)throw Error('Not a private financial transfer.');
  mergeFinancialEvents(db,data.events);
 }
 const receipts=[...getReceipts(db),...getTransportReceipts(db)],events=readFinancialEvents(db);
 if(operation==='export'){
  const data={schemaVersion:1,kind:'uber-tracker-private-finance',receiptReviewVersion:1,exportedAt:new Date().toISOString(),
    accounts:getAccounts(db).map(a=>({accountRef:a.accountRef,accountMasked:a.masked})),receipts,events};
  fs.writeFileSync(file,JSON.stringify(data),{mode:0o600,flag:'wx'});
 }
 const report=financialSummary(receipts,currentFinancialEvents(events).corrections);
 console.log(JSON.stringify({operation,receipts:report.receipts,privateSupportedSavings:report.total,missingSavings:report.missing,conflicts:report.conflicting,manualCorrections:report.manual}));
}finally{db.close();}
