import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import vm from "node:vm";
import path from "node:path";
import { openPrivateDb, setAccountAccess } from "./private-db.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uber-mail-routing-"));
const input = path.join(dir, "emails.json");
const output = path.join(dir, "moves.json");
const trashOutput = path.join(dir, "trash.json");
const dbPath = path.join(dir, "routing.db");
const accessPath = path.join(dir, "access.csv");
fs.writeFileSync(accessPath, "email,can_login,login_method\naccount-a@icloud.com,true,iCloud\naccount-b@icloud.com,true,iCloud\naccount-c@icloud.com,false,iCloud\n");

const messages = [
  {
    sender: "Uber Eats <receipts@uber.com>",
    recipient: "account-a@icloud.com",
    subject: "Your receipt from Example Kitchen",
    body: [
      "Thanks for your order",
      "Subtotal £25.00",
      "Promotion -£10.00",
      "Total £15.00"
    ].join("\n"),
    sentAt: "2026-10-05T18:00:00Z",
    receivedAt: "2026-10-05T18:00:10Z",
    messageId: "<receipt-inbox@uber.com>",
    mailbox: "promo",
    sourceMailbox: "INBOX"
  },
  {
    sender: "Uber Eats <offers@uber.com>",
    recipient: "account-a@icloud.com",
    subject: "40% off your next order",
    body: "Get 40% off your next order, up to £12. Minimum spend £20.",
    sentAt: "2026-10-05T17:00:00Z",
    receivedAt: "2026-10-05T17:00:10Z",
    messageId: "<promo-inbox@uber.com>",
    mailbox: "promo",
    sourceMailbox: "INBOX"
  },
  {
    sender: "Uber Eats <receipts@uber.com>",
    recipient: "account-c@icloud.com",
    subject: "Your receipt from Archived Kitchen",
    body: "Subtotal £20.00\nPromotion -£5.00\nTotal £15.00",
    sentAt: "2026-10-05T16:00:00Z",
    receivedAt: "2026-10-05T16:00:10Z",
    messageId: "<archived-receipt@uber.com>",
    mailbox: "promo",
    sourceMailbox: "INBOX"
  },
  {
    sender: "Uber Eats <offers@uber.com>",
    recipient: "account-c@icloud.com",
    subject: "£10 off your next order",
    body: "Get £10 off your next order. Minimum spend £15.",
    sentAt: "2026-10-05T15:00:00Z",
    receivedAt: "2026-10-05T15:00:10Z",
    messageId: "<archived-promo@uber.com>",
    mailbox: "promo",
    sourceMailbox: "INBOX"
  },
  {
    sender:'Uber Eats <offers@uber.com>',recipient:'account-c@icloud.com',subject:'£5 off your order',
    body:'Get £5 off your next order. Minimum spend £10.',sentAt:'2026-10-05T14:00:00Z',receivedAt:'2026-10-05T14:00:10Z',
    messageId:'<archived-used-promo@uber.com>',mailbox:'promo',sourceMailbox:'INBOX'
  },
  {
    sender: "Uber Eats <receipts@uber.com>",
    recipient: "account-b@icloud.com",
    subject: "Your receipt from Another Kitchen",
    body: "Subtotal £20.00\nTotal £20.00",
    sentAt: "2026-10-04T18:00:00Z",
    receivedAt: "2026-10-04T18:00:10Z",
    messageId: "<receipt-already-filed@uber.com>",
    mailbox: "receipt",
    sourceMailbox: "Uber Receipts"
  }
];

fs.writeFileSync(input, JSON.stringify({ messages }, null, 2));

const db = openPrivateDb(dbPath);
try {
  setAccountAccess(db, "account-a@icloud.com", true, "iCloud");
  setAccountAccess(db, "account-c@icloud.com", false, "iCloud");
} finally {
  db.close();
}

try {
  execFileSync(process.execPath, [
    "mac/find-inbox-receipts.js",
    input,
    output
  ], {
    cwd: process.cwd(),
    stdio: "pipe"
  });

  const result = JSON.parse(fs.readFileSync(output, "utf8"));

  assert.equal(result.count, 2);
  assert.deepEqual(result.messageIds, ["<receipt-inbox@uber.com>", "<archived-receipt@uber.com>"]);

  // Parse-only results must never authorize filing before a successful import.
  execFileSync(process.execPath, ['mac/plan-inbox-routing.js', input, dbPath, output, trashOutput], { stdio: 'pipe', env: { ...process.env, TRACKER_ACCOUNT_ACCESS: accessPath, TRACKER_ALLOW_UNKNOWN_ACCOUNTS: '0' } });
  assert.equal(JSON.parse(fs.readFileSync(output)).count, 0);
  assert.equal(JSON.parse(fs.readFileSync(trashOutput)).count, 0);
  execFileSync(process.execPath, ['generate-promos.js', input, path.join(dir, 'promos.json'), path.join(dir, 'history.json'), dbPath], { stdio: 'pipe', env: { ...process.env, TRACKER_ACCOUNT_ACCESS: accessPath, TRACKER_ALLOW_UNKNOWN_ACCOUNTS: '0' } });
  execFileSync(process.execPath, [
    "mac/plan-inbox-routing.js",
    input,
    dbPath,
    output,
    trashOutput
  ], {
    cwd: process.cwd(),
    stdio: "pipe"
  });

  const routedReceipts = JSON.parse(fs.readFileSync(output, "utf8"));
  const routedTrash = JSON.parse(fs.readFileSync(trashOutput, "utf8"));
  assert.deepEqual(routedReceipts.messageIds, ["<receipt-inbox@uber.com>"]);
  assert.deepEqual(routedTrash.messageIds, ["<archived-receipt@uber.com>", "<archived-promo@uber.com>","<archived-used-promo@uber.com>"]);
  execFileSync(process.execPath,['mac/plan-inbox-routing.js',input,dbPath,output,trashOutput,'--keep-receipts-and-used-promos'],{stdio:'pipe'});
  const protectedPlan=JSON.parse(fs.readFileSync(trashOutput));
  assert.deepEqual(protectedPlan.messageIds,['<archived-promo@uber.com>']);
  assert.equal(protectedPlan.keptArchivedReceipts,1);assert.equal(protectedPlan.keptUsedPromoSources,1);
  assert.equal(protectedPlan.messageTargets[0].recipient,'account-c@icloud.com');

  const exporterSource = fs.readFileSync("mac/export-uber-mail.js", "utf8");
  const moverSource = fs.readFileSync("mac/move-inbox-receipts.js", "utf8");
  const trashSource = fs.readFileSync("mac/trash-archived-inbox.js", "utf8");
  // Exercise the optional router without touching Mail: missing or ambiguous
  // recovery folders must leave the original message untouched.
  for (const destinationCount of [0,1,2]) for (const wrongMove of [false,true]) {
    let sourceIds=[123,124], binIds=[];
    const raw='Message-ID: <routing-test>\nTo: archived@example.test\nFrom: offers@uber.com\n\nSynthetic unused offer';
    const message={id:()=>123,messageId:()=>'<routing-test>',toRecipients:()=>[{address:()=> 'archived@example.test'}],source:()=>raw};
    const recovered={...message,id:()=>900};
    const bins=Array.from({length:destinationCount},()=>({name:()=> 'Bin',mailboxes:()=>[],messages:{id:()=>binIds.slice(),byId:()=>recovered}}));
    const physicalCollection={id:()=>sourceIds.slice(),byId:()=>message};
    const physicalInbox={name:()=> 'INBOX',mailboxes:()=>[],messages:physicalCollection};
    const account={id:()=> 'synthetic-account',mailboxes:()=>[physicalInbox,...bins]};
    message.mailbox=()=>({account:()=>account});
    const discovery={messageId:()=> '<routing-test>',mailbox:()=>({account:()=>account})};
    const virtual={messageId:()=>['<routing-test>'],dateReceived:()=>[new Date()],id:()=>[123],byId:()=>discovery};
    const moves=[];
    const context=vm.createContext({ObjC:{import(){}},$:{},delay(){},Application:()=>({inbox:{messages:virtual},accounts:{byId:()=>account},move:(msg,options)=>{
      assert.equal(msg,message,'Mutations must use a newly resolved physical reference, never the unified Inbox discovery object');
      moves.push({msg,options});sourceIds=sourceIds.filter(id=>id!==(wrongMove?124:123));binIds.push(900);
    },delete:()=>{throw Error('Permanent deletion forbidden');}})});
    vm.runInContext(trashSource.replace(/^#!.*\n/,''),context);context.stderr=()=>{};
    const targets={messageIds:['<routing-test>'],messageTargets:[{messageId:'<routing-test>',recipient:'archived@example.test'}]};
    context.readUtf8=()=>JSON.stringify(targets);
    assert.throws(()=>context.run(['fixture','60']),/original-source plan/);
    const planned=JSON.parse(context.run(['fixture','60','--plan']));
    assert.equal(moves.length,0);
    if(destinationCount!==1){assert.equal(planned.failed,1);continue;}
    assert.equal(planned.planned,1);
    context.readUtf8=()=>JSON.stringify(planned);
    const result=JSON.parse(context.run(['fixture','60','--execute-verified-plan']));
    assert.equal(result.trashed,wrongMove?0:1);
    assert.equal(result.halted,wrongMove);
    assert.equal(result.failed,wrongMove?1:0);
    if(wrongMove)assert.equal(result.movedTargets.length,0,'A neighbouring move must never be reported as a verified target move');
    sourceIds=[123,124];binIds=[];moves.length=0;
    planned.inventory[0].raw+=' changed';
    assert.equal(JSON.parse(context.run(['fixture','60','--execute-verified-plan'])).failed,1);assert.equal(moves.length,0);
    context.readUtf8=()=>JSON.stringify({...targets,messageTargets:[{messageId:'<routing-test>',recipient:'accessible@example.test'}]});
    assert.equal(JSON.parse(context.run(['fixture','60','--plan'])).planned,0);assert.equal(moves.length,0);
  }
  const commonSource = fs.readFileSync("mac/common.sh", "utf8");
  const exampleEnv = fs.readFileSync("tracker.example.env", "utf8");

  assert.equal(
    exporterSource.includes(".whose("),
    false,
    "exporter must not reintroduce Mail whose queries on large mailboxes"
  );
  assert.equal(
    moverSource.includes(".whose("),
    false,
    "receipt mover must not reintroduce Mail whose queries on Inbox"
  );
  assert.equal(
    exporterSource.includes("box.messages.dateReceived()"),
    true,
    "exporter should bulk-fetch date metadata before opening message bodies"
  );

  assert.equal(
    commonSource.includes('MOVE_INBOX_RECEIPTS="${APPLE_MAIL_MOVE_INBOX_RECEIPTS:-false}"'),
    true,
    "routine sync must leave Inbox receipts in place by default"
  );
  assert.equal(
    commonSource.includes('TRASH_ARCHIVED_MAIL="${APPLE_MAIL_TRASH_ARCHIVED:-false}"'),
    true,
    "routine sync must leave archived mail in place by default"
  );
  assert.equal(
    exampleEnv.includes("APPLE_MAIL_MOVE_INBOX_RECEIPTS=false"),
    true,
    "example configuration should match the runtime receipt-filing default"
  );
  assert.equal(
    exampleEnv.includes("APPLE_MAIL_TRASH_ARCHIVED=false"),
    true,
    "example configuration should expose Archived-account Bin routing"
  );
  assert.equal(
    trashSource.includes("Mail.move(message, { to: destination })"),
    true,
    "archived mail should move to an explicit recoverable Bin mailbox"
  );
  assert.equal(
    /Mail\.erase|expunge|Erase Deleted Items/i.test(trashSource),
    false,
    "archived routing must never permanently erase Bin contents"
  );

  console.log("✓ Inbox routing separates available receipts from archived-account mail");
  console.log("✓ Archived-account receipts are planned for Bin only after private import");
  console.log("✓ Protected routing keeps receipts and used promos; original-source plans and account-qualified identities prevent unrelated moves");
  console.log("✓ Mail exporter and routing avoid timeout-prone whose queries");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
