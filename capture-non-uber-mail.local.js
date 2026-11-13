#!/usr/bin/osascript -l JavaScript
// READ ONLY: capture non-Uber received mail in a date window so the filing rule
// can route it to Amazon or Others. Never moves anything.
ObjC.import('Foundation');
function emit(v){$.NSFileHandle.fileHandleWithStandardOutput.writeData($(JSON.stringify(v)+'\n').dataUsingEncoding($.NSUTF8StringEncoding));}
function log(s){$.NSFileHandle.fileHandleWithStandardError.writeData($(s+'\n').dataUsingEncoding($.NSUTF8StringEncoding));}
function run(argv){
  const start=argv&&argv[0]?Date.parse(argv[0]):null,end=argv&&argv[1]?Date.parse(argv[1]):null;
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)throw Error('Both valid calendar boundaries are required.');
  const Mail=Application('Mail');Mail.includeStandardAdditions=false;
  const folders=[];
  function visit(account,container,path){for(const box of container.mailboxes()){const name=String(box.name()),parts=path.concat([name]);folders.push({accountId:String(account.id()),path:parts});visit(account,box,parts);}}
  for(const account of Mail.accounts())visit(account,account,[]);
  emit({kind:'inventory',capturedAt:new Date().toISOString(),folders});
  let scanned=0,captured=0;
  for(const f of folders){
    // Never touch Sent, Drafts, Bin or already-filed Uber folders.
    if(f.path.some(p=>/^(?:sent|sent messages|sent items|drafts|outbox|sendlater|bin|trash|deleted messages|deleted items)$/i.test(p)))continue;
    if(['Uber Receipts','Eurostar','Amazon','Others'].includes(f.path.at(-1)))continue;
    const account=Mail.accounts.byId(f.accountId);
    let box=account;
    for(const part of f.path)box=box.mailboxes.byName(part);
    const ids=box.messages.id(),subjects=box.messages.subject(),senders=box.messages.sender(),received=box.messages.dateReceived();
    if(ids.length!==subjects.length||ids.length!==senders.length||ids.length!==received.length)throw Error('Mailbox changed during indexing');
    scanned+=ids.length;
    for(let i=0;i<ids.length;i++){
      const at=+new Date(received[i]);
      if(!Number.isFinite(at)||at<start||at>=end)continue;
      const sender=String(senders[i]||'');
      // Only non-Uber senders: Uber, Uber Eats, Lime and Eurostar keep their own rules.
      if(/\b(?:uber|lime|eurostar)\b/i.test(sender)||/(?:_at_.*uber_com|@(?:[^@ ]+\.)?uber\.com|@(?:[^@ ]+\.)?(?:li\.me|lime\.bike)|@(?:[^@ ]+\.)?eurostar\.com)/i.test(sender))continue;
      const message=box.messages.byId(ids[i]);
      if(Number(message.id())!==Number(ids[i]))throw Error('Physical message changed.');
      const raw=String(message.source()||'');
      if(!raw||raw.length>20000000){emit({kind:'unreadable',accountId:f.accountId,path:f.path,nativeId:ids[i]});continue;}
      emit({kind:'source',accountId:f.accountId,path:f.path,nativeId:ids[i],raw,receivedAt:new Date(at).toISOString(),sentAt:new Date(message.dateSent()).toISOString()});
      captured++;
    }
    log('Indexed '+ids.length+' in '+f.path.join(' / '));
  }
  emit({kind:'complete',scanned,captured,start:new Date(start).toISOString(),end:new Date(end).toISOString(),completedAt:new Date().toISOString()});
  return '';
}
