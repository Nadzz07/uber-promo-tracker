#!/usr/bin/env node
// Trusted Mac conversion only. Never modifies the source file or database.
import fs from 'node:fs';
import path from 'node:path';
import {decryptFinance} from '../private-finance-vault.js';
import {readDeviceBackup} from '../device-backup.js';
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){if(!['--file','--output','--passphrase-file'].includes(args[i])||!args[i+1])throw Error('Use --file ORIGINAL --output NEW.local.json --passphrase-file OWNER_ONLY_FILE');options[args[i]]=args[i+1];}
const source=options['--file'],out=options['--output'],secret=options['--passphrase-file'];
if(!source||!out||!secret||!out.endsWith('.local.json')||fs.existsSync(out)||path.resolve(source)===path.resolve(out))throw Error('Choose an existing encrypted original and a new *.local.json output.');
const info=fs.statSync(secret);if(!info.isFile()||(info.mode&0o077)!==0)throw Error('The legacy secret file must be owner-only.');
const data=await readDeviceBackup(await decryptFinance(JSON.parse(fs.readFileSync(source,'utf8')),fs.readFileSync(secret,'utf8').replace(/\r?\n$/,'')));
fs.writeFileSync(out,JSON.stringify(data),{mode:0o600,flag:'wx'});
console.log('Converted private transfer saved. Original unchanged. Import locally; do not publish this file.');
