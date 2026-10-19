import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const target={mailNativeId:12,messageId:'<receipt@uber.com>',recipient:'a@example.invalid',receivedAt:'2026-10-09T12:00:00.000Z',body:'Subtotal £20\nTotal £15',sourceMailbox:'INBOX'};
const plan={action:'file_verified_receipts',start:'2026-10-08T23:00:00.000Z',end:'2026-10-09T23:00:00.000Z',destination:'Uber Receipts',targets:[target]};
for(const scenario of ['good','delayed','wrong-destination-copy','changed-original','missing-destination','out-of-day','stale-global-inbox','unrelated-removal']){
 let moved=0,inbox=scenario==='stale-global-inbox'?[]:scenario==='unrelated-removal'?[12,13]:[12],dest=[],sleeps=0;
 const receipt=(id,wrong=false)=>({id:()=>id,messageId:()=>target.messageId,toRecipients:{address:()=>[wrong?'other@example.invalid':target.recipient]},dateReceived:()=>target.receivedAt,content:()=>target.body});
 const destination={name:()=>plan.destination,mailboxes:()=>[],account:()=>({id:()=> 'owner'}),messages:{id:()=>dest,messageId:()=>dest.map(()=>target.messageId),byId:id=>receipt(id,scenario==='wrong-destination-copy')}};
 const physical={name:()=> 'INBOX',account:()=>({id:()=> 'owner'}),mailboxes:()=>[],messages:{id:()=>inbox,byId:id=>{if(!inbox.includes(id))throw Error('Gone');return receipt(id,scenario==='changed-original')}}};
 const account={mailboxes:()=>scenario==='missing-destination'?[physical]:[physical,destination]};
 const apply=()=>{inbox=[];dest=[90]},Mail={accounts:()=>[account],mailboxes:()=>[],inbox:{messages:{byId:()=>{throw Error('Unified Inbox must never be used to move originals')}}},move:()=>{moved++;if(scenario!=='delayed')apply()}};
 const context=vm.createContext({ObjC:{import(){}},Application:()=>Mail,$:{NSThread:{sleepForTimeInterval(){if(++sleeps===3&&scenario==='delayed')apply()}}}});vm.runInContext(fs.readFileSync('mac/file-verified-receipts.js','utf8').replace(/^#!.*\n/,''),context);context.read=()=>JSON.stringify(scenario==='out-of-day'?{...plan,targets:[target,{...target,mailNativeId:13,messageId:'different',receivedAt:'2026-10-10T12:00:00Z'}]}:plan);
 if(['missing-destination','out-of-day'].includes(scenario)){assert.throws(()=>context.run(['file','--execute-verified-plan']));assert.equal(moved,0);continue;}
 const result=JSON.parse(context.run(['file','--execute-verified-plan'])),good=['good','delayed'].includes(scenario);
 assert.equal(result.moved,good?1:0);assert.equal(result.halted,!good);if(['changed-original','stale-global-inbox'].includes(scenario))assert.equal(moved,0);if(good)assert.equal(result.results[0].status,'moved_verified');
}
console.log('✓ Verified receipt filing resolves the physical same-account Inbox, checks membership/originals/destination, tolerates delayed moves, preserves neighbours and halts on discrepancies.');
