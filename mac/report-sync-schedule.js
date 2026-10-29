// Read the existing agent only; never load, install, enable or reschedule it.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
const report={state:'unknown',intervalSeconds:null,reportedAt:new Date().toISOString()};
if(process.platform==='darwin')try{
 const file=path.join(os.homedir(),'Library/LaunchAgents/com.nadzz07.uber-promo-tracker.plist');
 if(fs.existsSync(file)){
  const parsed=spawnSync('plutil',['-convert','json','-o','-',file],{encoding:'utf8'});if(parsed.status!==0)throw Error();const config=JSON.parse(parsed.stdout);
  const root=path.dirname(import.meta.dirname);if(config.WorkingDirectory!==root||!config.ProgramArguments?.some(p=>[path.join(root,'hourly-sync.local.sh'),path.join(root,'mac/update-promos.sh')].includes(p)))throw Error();
  const domain='gui/'+process.getuid(),job=spawnSync('launchctl',['print',domain+'/'+config.Label],{encoding:'utf8'}),disabled=spawnSync('launchctl',['print-disabled',domain],{encoding:'utf8'});
  const explicitDisabled=disabled.status===0&&disabled.stdout.includes('"'+config.Label+'" => true');
  report.state=explicitDisabled?'disabled':job.status===0?'enabled':'unknown';
  const interval=job.status===0?Number(job.stdout.match(/run interval = (\d+) seconds/)?.[1]):null;
  report.intervalSeconds=Number.isSafeInteger(interval)&&interval>0?interval:null;
 }
}catch{}
console.log(JSON.stringify(report));
