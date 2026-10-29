const keys=(value,allowed)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))throw Error('Invalid public sync report.');};
const date=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
export function validateSyncReport(report={}){
 keys(report,['runs','scheduler']);
 if(report.runs!=null){if(!Array.isArray(report.runs)||report.runs.length>20)throw Error('Invalid sync history.');for(const r of report.runs){keys(r,['at','status','emailsChecked','newReceipts','offersUpdated']);if(!date(r.at)||!['success','failed','running'].includes(r.status))throw Error('Invalid sync run.');for(const key of ['emailsChecked','newReceipts','offersUpdated'])if(r[key]!=null&&(!Number.isSafeInteger(r[key])||r[key]<0))throw Error('Invalid latest-run count.');}}
 if(report.scheduler!=null){const s=report.scheduler;keys(s,['state','intervalSeconds','reportedAt']);if(!date(s.reportedAt)||!['enabled','disabled','unknown'].includes(s.state)||s.intervalSeconds!=null&&(!Number.isSafeInteger(s.intervalSeconds)||s.intervalSeconds<=0))throw Error('Invalid scheduler report.');}
 return report;
}
export function recordSyncRun(previous,at,stats,scheduler){
 validateSyncReport(previous);const runs=[...(previous.runs||[])];
 if(!runs.some(r=>r.at===at))runs.push({at,status:'success',emailsChecked:Number.isSafeInteger(stats.emailsChecked)?stats.emailsChecked:null,newReceipts:stats.newReceipts,offersUpdated:stats.offersUpdated});
 return validateSyncReport({runs:runs.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,20),...(scheduler&&(!previous.scheduler||Date.parse(scheduler.reportedAt)>=Date.parse(previous.scheduler.reportedAt))?{scheduler}:previous.scheduler?{scheduler:previous.scheduler}:{})});
}
