import assert from 'node:assert/strict';
import {accountHistoryGroups,validateOfferReceiptLinks,mergeOfferReceiptLinks,offerReceiptAvailability,offerMatchedReceipts,offerWithPrivateReceiptUses,plannerAccountChoices} from './account-sheet-data.js';
import {validateFinanceData,PrivateFinanceVault} from './private-finance-vault.js';
import {assertPublicSnapshot} from './public-snapshot.js';
const receipt=(id,accountRef='A1',orderAt='2026-10-18T12:00:00Z',extra={})=>({receiptId:id,accountRef,orderAt,service:'Uber Eats',total:4,...extra});
const receipts=[receipt('r1'),receipt('r2','A1','2026-10-16T12:00:00Z'),receipt('r3','A1','2026-10-14T12:00:00Z'),receipt('other','A2')];
const match=(receiptId,offerId='pub_a',status='confirmed')=>({receiptId,accountRef:'A1',offerId,status,observedSaving:12});
const data={kind:'uber-tracker-private-finance',schemaVersion:1,accounts:[{accountRef:'A1'},{accountRef:'A2'}],receipts,events:[],receiptMatchVersion:1,receiptMatchExportedAt:'2026-10-19T12:00:00Z',offerReceiptMatches:[match('r1'),match('r2'),match('r3'),match('r1'),match('r1','pub_b','ambiguous')]};
validateFinanceData(data);assert.deepEqual(offerMatchedReceipts(data,{id:'pub_a',accountRef:'A1'}).map(r=>r.receiptId),['r1','r2','r3']);
assert.deepEqual(offerMatchedReceipts(data,{id:'pub_b',accountRef:'A1'}),[]);assert.deepEqual(offerMatchedReceipts(data,{id:'pub_a',accountRef:'A2'}),[]);assert.deepEqual(offerMatchedReceipts({...data,receiptMatchVersion:undefined},{id:'pub_a',accountRef:'A1'}),[]);
assert.throws(()=>validateOfferReceiptLinks({...data,offerReceiptMatches:[{...match('other'),accountRef:'A1'}]}));assert.throws(()=>validateOfferReceiptLinks({...data,offerReceiptMatches:[{...match('r1'),observedSaving:-1}]}));
const newer={...data,receipts:[receipts[0]],receiptMatchExportedAt:'2026-10-20T00:00:00Z',offerReceiptMatches:[]};
assert.deepEqual(mergeOfferReceiptLinks(data,newer).offerReceiptMatches.map(m=>m.receiptId),['r2','r3'],'A newer authoritative import clears stale links for its receipts');
assert.equal(mergeOfferReceiptLinks(data,{...newer,receiptMatchExportedAt:'2026-10-01'}).offerReceiptMatches.length,4,'Older imports do not replace newer assignments');
assert.equal(mergeOfferReceiptLinks(data,{receipts}).offerReceiptMatches.length,4,'Legacy backups retain current private match evidence');
const storage=new Map(),vault=new PrivateFinanceVault({getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)});await vault.import(data);await vault.import(newer);assert.deepEqual(vault.data.offerReceiptMatches.map(m=>m.receiptId),['r2','r3']);vault.hydrate();assert.equal(vault.data.offerReceiptMatches.length,2,'Receipt link evidence survives device reload');
const offers=[{id:'pub_a',accountRef:'A1'},{id:'pub_b',accountRef:'A1'},{id:'pub_c',accountRef:'A2'}],accounts=[{accountRef:'A1'},{accountRef:'A2'}],wallets={A1:{remaining:12},A2:{remaining:20}};
assert.deepEqual(plannerAccountChoices({accountRef:'A1',promoKey:'pub_b',includeCash:true},offers,accounts,wallets),{offers:[offers[1]],accounts:[accounts[0]],wallets:{A1:wallets.A1}});assert.deepEqual(plannerAccountChoices({accountRef:'A1',promoKey:null,includeCash:false},offers,accounts,wallets),{offers:[],accounts:[accounts[0]],wallets:{}});assert.equal(plannerAccountChoices(null,offers,accounts,wallets).offers,offers);
for(const field of ['offerReceiptMatches','receiptMatchVersion','receiptMatchExportedAt'])assert.throws(()=>assertPublicSnapshot({accounts:[],promos:[],[field]:data[field]}),'Private receipt links cannot enter public snapshots');
console.log('✓ Account sheet: authoritative private receipt links, exact offer/account matching, deduplication, encrypted import freshness, scoped calculator and public export rejection.');

// The private transfer uses the same keyed offer identity as public navigation.
// Original receipt links remain private and publication never receives them.
{
 const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path'),{execFileSync}=await import('node:child_process');
 const {openPrivateDb,ensureAccount,upsertOffer,upsertReceipt}=await import('./private-db.js'),{keyedPublicOfferId}=await import('./identity.js');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'account-links-')),dbFile=path.join(dir,'fixture.local.db'),file=path.join(dir,'finance.local.json'),key='a'.repeat(64);
 try{const db=openPrivateDb(dbFile),account=ensureAccount(db,{alias:'receipt-links@example.invalid'});db.prepare("INSERT INTO meta(key,value) VALUES('public_offer_identity_key',?)").run(key);upsertOffer(db,{offerId:'private-offer',accountRef:account.accountRef,service:'Uber Eats',discountType:'fixed',discount:12,minimumSpend:15,uses:5,emailSentAt:'2026-10-01T12:00:00Z'});upsertReceipt(db,{receiptId:'private-receipt',accountRef:account.accountRef,sentAt:'2026-10-18T12:00:00Z',total:4,promotionDiscount:12});db.prepare('INSERT INTO receipt_offer_matches(receipt_id,offer_id,status,observed_saving,matched_at) VALUES(?,?,?,?,?)').run('private-receipt','private-offer','confirmed',12,'2026-10-18T13:00:00Z');db.close();execFileSync(process.execPath,['mac/private-finance.js','export','--db',dbFile,'--file',file],{stdio:'pipe'});const exported=JSON.parse(fs.readFileSync(file));validateFinanceData(exported);assert.equal(exported.offerReceiptMatches.length,1);assert.equal(exported.offerReceiptMatches[0].offerId,keyedPublicOfferId(key,'private-offer'));assert.equal(offerMatchedReceipts(exported,{id:keyedPublicOfferId(key,'private-offer'),accountRef:account.accountRef}).length,1);assert.equal(fs.statSync(file).mode&0o777,0o600);}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
 console.log('✓ Private transfer retains source-assigned receipt links with keyed public offer identities and owner-only file permissions.');
}

// A newer private transfer drives the whole usage total, not the visible slice.
{
 const {pendingManualUses,effectiveRemainingUses,consumeManualUse}=await import('./manual-state.js');
 const source={id:'pub_a',accountRef:'A1',discountType:'fixed',discount:12,uses:5,usesVerified:true,usesRemaining:5,receiptConfirmedUses:0};
 const before=JSON.stringify(source),view=offerWithPrivateReceiptUses(source,data);
 assert.equal(view.receiptConfirmedUses,3);assert.equal(view.usesRemaining,2);assert.equal(JSON.stringify(source),before);
 const manual={version:3,offers:{pub_a:{manualUsesConsumed:4,receiptConfirmedBaseline:0}}};
 assert.equal(pendingManualUses(manual,view),1);assert.equal(effectiveRemainingUses(manual,view),1);
 const next=consumeManualUse(manual,view);assert.equal(pendingManualUses(next,view),2);assert.equal(effectiveRemainingUses(next,view),0);
 assert.equal(offerWithPrivateReceiptUses(source,null),source,'Locking does not replace stored evidence with a new zero');
 assert.equal(offerWithPrivateReceiptUses({...source,receiptConfirmedUses:null},null).receiptConfirmedUses,null);
 assert.equal(offerWithPrivateReceiptUses({...source,uses:3,usesRemaining:3},data).trackingState,'used');
 assert.equal(offerWithPrivateReceiptUses({...source,uses:2,usesRemaining:2},data).trackingState,'needs_checking','Conflicting private counts cannot certify completion');
}
console.log('✓ Newer private matches reconcile manual entries and full usage independently of receipt-list expansion; source records remain immutable.');

const promo={id:'absent',accountRef:'A1'};
assert.equal(offerReceiptAvailability(null,promo).status,'not_imported');
assert.equal(offerReceiptAvailability(null,{...promo,receiptConfirmedUses:0}).status,'not_imported','A published zero does not mean private details were imported');
assert.equal(offerReceiptAvailability(null,promo,'migration_required').status,'migration_required');
assert.equal(offerReceiptAvailability(null,promo,'error').status,'error');
assert.equal(offerReceiptAvailability({receipts:[{}]},promo).status,'outdated');
assert.equal(offerReceiptAvailability({receipts:[{}],receiptMatchVersion:1,offerReceiptMatches:[]},{...promo,receiptConfirmedUses:0}).status,'no_matches');
assert.equal(offerReceiptAvailability({receipts:[{}],receiptMatchVersion:1,offerReceiptMatches:[]},{...promo,receiptConfirmedUses:2}).status,'missing_details');
assert.equal(offerReceiptAvailability(data,{...promo,reviewReasons:['ambiguous_receipt_match'],id:'other'}).status,'unresolved');
console.log('✓ Receipt availability distinguishes absent, legacy, failed, outdated, known zero, aggregate-only and unresolved evidence');

const historyOffer=(id,extra={})=>({id,accountRef:'A1',uses:5,usesVerified:true,receiptConfirmedUses:0,usesRemaining:5,expiresAt:'2026-12-01T23:59:59Z',discountType:'fixed',discount:12,...extra});
const historyPromos=[historyOffer('complete',{receiptConfirmedUses:5,usesRemaining:0}),historyOffer('expired',{expiresAt:'2026-01-01',receiptConfirmedUses:1}),historyOffer('ignored',{receiptConfirmedUses:5,usesRemaining:0}),historyOffer('manual'),historyOffer('active')],historyStore={offers:{ignored:{ignored:true},manual:{forceDone:true}}};
const history=accountHistoryGroups([...historyPromos,historyPromos[0]],[{issued:10,issuedAt:'2026-01-01',expiresAt:'2026-02-01',status:'expired'},{issued:12,issuedAt:'2026-02-01',status:'exhausted'},{issued:12,issuedAt:'2026-02-01',status:'exhausted'}],historyStore,new Date('2026-10-20'));
assert.deepEqual(Object.fromEntries(history.map(g=>[g.key,g.records.length])),{completed:1,expired:2,ignored:1,manual:1,exhausted:1,other:0});
console.log('✓ Account history uses exclusive existing classifications, preserves manual/exhausted distinctions and deduplicates promos and grants');
