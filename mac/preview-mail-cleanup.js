#!/usr/bin/osascript -l JavaScript
// READ ONLY: physical, account-qualified sources. No Mail.move/delete calls.
ObjC.import('Foundation');
function log(s){$.NSFileHandle.fileHandleWithStandardError.writeData($(s+'\n').dataUsingEncoding($.NSUTF8StringEncoding));}
function output(value){$.NSFileHandle.fileHandleWithStandardOutput.writeData($(JSON.stringify(value)+'\n').dataUsingEncoding($.NSUTF8StringEncoding));}
function run(argv){const start=argv&&argv[0]?Date.parse(argv[0]):null,end=argv&&argv[1]?Date.parse(argv[1]):null;if((start!==null||end!==null)&&(!Number.isFinite(start)||!Number.isFinite(end)||end<=start))throw Error('Both valid calendar range boundaries are required.');const Mail=Application('Mail');Mail.includeStandardAdditions=false;let scanned=0,captured=0,dated=0;const folders=[];
function visit(account,container,path){for(const box of container.mailboxes()){const name=String(box.name()),parts=path.concat([name]);folders.push({accountId:String(account.id()),path:parts});visit(account,box,parts);}}
for(const account of Mail.accounts())visit(account,account,[]);
output({kind:'inventory',capturedAt:new Date().toISOString(),folders});
for(const f of folders){let box=Mail.accounts.byId(f.accountId);for(const part of f.path)box=box.mailboxes.byName(part);const ids=box.messages.id(),subjects=box.messages.subject(),senders=box.messages.sender(),received=start===null?null:box.messages.dateReceived();if(ids.length!==subjects.length||ids.length!==senders.length||(received&&ids.length!==received.length)||JSON.stringify(ids)!==JSON.stringify(box.messages.id()))throw Error('Mailbox changed during indexing; retry.');scanned+=ids.length;log('Indexed '+ids.length+' messages in '+f.path.join(' / '));
for(let i=0;i<ids.length;i++){if(received){const at=+new Date(received[i]);if(at<start||at>=end||!Number.isFinite(at))continue;}dated++;if(!/\b(?:uber|lime)\b/i.test(subjects[i])&&!/(?:_at_.*uber_com|@(?:[^@ ]+\.)?uber\.com|@(?:[^@ ]+\.)?(?:li\.me|lime\.bike))/i.test(senders[i]))continue;
const m=box.messages.byId(ids[i]);if(Number(m.id())!==Number(ids[i]))throw Error('Physical message changed.');const raw=String(m.source()||'');if(!raw||raw.length>20000000){output({kind:'unreadable',accountId:f.accountId,path:f.path,nativeId:ids[i]});continue;}
output({kind:'source',accountId:f.accountId,path:f.path,nativeId:ids[i],raw,receivedAt:new Date(m.dateReceived()).toISOString(),sentAt:new Date(m.dateSent()).toISOString()});captured++;if(captured%250===0)log('Preserved '+captured+' original messages privately.');}}
output({kind:'complete',scanned,dated,captured,start:start===null?null:new Date(start).toISOString(),end:end===null?null:new Date(end).toISOString(),completedAt:new Date().toISOString()});return '';}
