import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const target={mailNativeId:12,messageId:'<receipt@uber.com>',recipient:'a@example.invalid',receivedAt:'2026-10-09T12:00:00.000Z',body:'Subtotal £20\nTotal £15',sourceMailbox:'INBOX'};
const plan={action:'file_verified_receipts',start:'2026-10-08T23:00:00.000Z',end:'2026-10-09T23:00:00.000Z',destination:'Uber Receipts',targets:[target]};
for(const scenario of ['good','wrong-destination-copy','changed-original','missing-destination','out-of-day']){
 let moved=0,inbox=[12],dest=[];
 const receipt=(id,wrong=false)=>({id:()=>id,messageId:()=>target.messageId,toRecipients:{address:()=>[wrong?'other@example.invalid':target.recipient]},dateReceived:()=>target.receivedAt,content:()=>target.body});
 const destination={name:()=>plan.destination,mailboxes:()=>[],account:()=>({id:()=> 'local'}),messages:{id:()=>dest,messageId:()=>dest.map(()=>target.messageId),byId:id=>receipt(id,scenario==='wrong-destination-copy')}};
 const Mail={accounts:()=>[],mailboxes:()=>scenario==='missing-destination'?[]:[destination],inbox:{messages:{byId:id=>{if(!inbox.includes(id))throw Error('Gone');return receipt(id,scenario==='changed-original');}}},move:()=>{moved++;inbox=[];dest=[90];}};
 const context=vm.createContext({ObjC:{import(){}},Application:()=>Mail,$:{NSThread:{sleepForTimeInterval(){}}}});vm.runInContext(fs.readFileSync('mac/file-verified-receipts.js','utf8').replace(/^#!.*\n/,''),context);context.read=()=>JSON.stringify(scenario==='out-of-day'?{...plan,targets:[target,{...target,mailNativeId:13,messageId:'different',receivedAt:'2026-10-10T12:00:00Z'}]}:plan);
 if(['missing-destination','out-of-day'].includes(scenario)){assert.throws(()=>context.run(['file','--execute-verified-plan']));assert.equal(moved,0);continue;}
 const result=JSON.parse(context.run(['file','--execute-verified-plan']));
 assert.equal(result.moved,scenario==='good'?1:0);assert.equal(result.halted,scenario!=='good');if(scenario==='changed-original')assert.equal(moved,0);
 if(scenario==='good')assert.equal(result.results[0].status,'moved_verified');
}
console.log('✓ Today-only receipt filing validates originals, preserves unrelated mail, verifies exact destination copies and halts on discrepancy');
