import {parseDeviceAccounts,deviceEmail} from './device-accounts.js';
export function accountWithDeviceMetadata(mapping,account){
 const row=mapping?.[account.accountRef];if(!row||!deviceEmail(mapping,account))return account;
 return {...account,...(typeof row.canLogin==='boolean'?{canLogin:row.canLogin,accessStatus:'verified'}:{}),...(Array.isArray(row.loginMethods)&&row.loginMethods.length&&row.loginMethods.every(v=>['iCloud','Google'].includes(v))?{loginMethods:row.loginMethods,loginMethod:row.loginMethods.length===2?'Both':row.loginMethods[0]}:{})};
}
export function prepareAccountImport(input,accounts,saved){
 if(input?.kind==='uber-tracker-encrypted-finance')throw Error('Legacy encrypted file: convert it in your trusted Mac environment before importing.');
 if(input?.kind!=='uber-tracker-device-accounts'||input.schemaVersion!==1||!Array.isArray(input.accounts)||input.accounts.length>5000)throw Error('Choose a tracker device-accounts JSON export.');
 const issues=[],groups=new Map(),refs=new Map(),mapping={},notes={},review=[];let unchanged=0,added=0,updated=0;
 input.accounts.forEach((row,index)=>{const id=typeof row?.email==='string'?row.email.trim().toLowerCase():null;if(!id){issues.push({index:index+1,reason:'Missing email address'});return;}const group=groups.get(id)||[];group.push({row,index:index+1});groups.set(id,group);const r=refs.get(row.accountRef)||new Set();r.add(id);refs.set(row.accountRef,r);});
 for(const group of groups.values()){
  const {row,index}=group[0];if(group.some(g=>JSON.stringify(g.row)!==JSON.stringify(row))||refs.get(row.accountRef).size>1){issues.push({index,reason:'Conflicting duplicate rows for this account'});continue;}
  try{const parsed=parseDeviceAccounts({...input,accounts:[{...row,email:row.email.trim()}]},accounts),ref=Object.keys(parsed)[0],value=parsed[ref],account=accounts.find(a=>a.accountRef===ref),prior=saved[ref],fields=[];
   const next={...prior,...value};
   if(!prior)fields.push('Add full email to this account');else if(prior.email.toLowerCase()!==value.email.toLowerCase())fields.push('Email: '+prior.email+' → '+value.email);else next.email=prior.email;
   if(row.canLogin!==undefined&&row.canLogin!==''){if(typeof row.canLogin!=='boolean')throw Error('Login status must be true or false.');next.canLogin=row.canLogin;const before=account.canLogin;if(before!==row.canLogin)fields.push('Login status: '+(before==null?'Unknown':before?'Can log in':'Can’t log in')+' → '+(row.canLogin?'Can log in':'Can’t log in'));}
   const methods=row.loginMethods??(row.loginMethod?row.loginMethod==='Both'?['iCloud','Google']:[row.loginMethod]:undefined);
   if(methods!==undefined&&methods!==''){if(!Array.isArray(methods)||!methods.length||methods.some(v=>!['iCloud','Google'].includes(v)))throw Error('Provider must be iCloud, Google or Both.');next.loginMethods=[...new Set(methods)].sort();const before=(account.loginMethods|| (account.loginMethod==='Both'?['Google','iCloud']:account.loginMethod?[account.loginMethod]:[])).slice().sort();if(JSON.stringify(before)!==JSON.stringify(next.loginMethods))fields.push('Provider: '+(before.join(' + ')||'Unknown')+' → '+next.loginMethods.join(' + '));}
   if(row.note!==undefined){if(typeof row.note!=='string'||row.note.length>10000)throw Error('Invalid note.');if((account.note||'')!==row.note){notes[ref]=row.note;fields.push('Notes: '+(account.note||'Empty')+' → '+(row.note||'Clear note'));}}
   if(!fields.length){unchanged++;continue;}
   mapping[ref]=next;if(prior)updated++;else added++;review.push({email:next.email,fields});
  }catch(error){issues.push({index,reason:error.message});}
 }
 if(!groups.size||!added&&!updated&&!unchanged&&issues.length)throw Error('No account rows can be imported. '+(issues[0]?.reason||''));
 return {mapping,notes,review,issues,counts:{added,updated,unchanged,rejected:issues.length},changes:added+updated,historyChanges:0};
}
