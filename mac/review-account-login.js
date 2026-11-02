#!/usr/bin/env node
// Private chat-review queue and field-specific confirmations. No email lists on stdout.
import fs from 'node:fs';
import {openPrivateDb} from '../private-db.js';
import {parseAccessList} from '../access-list.js';
import {auditLoginAccounts,confirmLoginFields} from '../account-login-review.js';
const options={db:'final-audit.local/runtime.local/uber-tracker.local.db',registry:'final-audit.local/account-access.local.csv',queue:'final-audit.local/login-review-queue.local.json'};
for(let i=2;i<process.argv.length;i++){const name=process.argv[i].slice(2);if(!['db','registry','queue','confirm'].includes(name)||!process.argv[i+1])throw Error('Use --db, --registry, --queue and optional --confirm.');options[name]=process.argv[++i];}
if(!/\.local\.json$/.test(options.queue)||options.confirm&&!/\.local\.json$/.test(options.confirm))throw Error('Review files must remain private *.local.json files.');
const registry=parseAccessList(fs.readFileSync(options.registry,'utf8')),changes=options.confirm?JSON.parse(fs.readFileSync(options.confirm,'utf8')):null;
if(changes&&(changes.schemaVersion!==1||!Array.isArray(changes.accounts)))throw Error('Unsupported login confirmation file.');
const db=openPrivateDb(options.db);let result;
try{db.exec('BEGIN IMMEDIATE');auditLoginAccounts(db,registry);if(changes)confirmLoginFields(db,changes.accounts,new Date().toISOString());result=auditLoginAccounts(db,registry);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}finally{db.close();}
const temporary=options.queue+'.tmp';fs.writeFileSync(temporary,JSON.stringify({schemaVersion:1,generatedAt:new Date().toISOString(),...result},null,2),{mode:0o600});fs.renameSync(temporary,options.queue);
console.log(JSON.stringify({total:result.total,missingAccess:result.missingAccess,missingMethod:result.missingMethod,accountsNeedingReview:result.queue.length,deferredHistorical:result.deferredHistorical,confirmedAccounts:changes?.accounts.length||0}));
