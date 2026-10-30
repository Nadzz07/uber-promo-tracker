import assert from 'node:assert/strict';
import {accountHistoryGroups,preferredAccountOffers,validateOfferReceiptLinks,mergeOfferReceiptLinks,offerReceiptAvailability,offerUsageEvidence,directoryAccounts,offerMatchedReceipts,offerWithPrivateReceiptUses,plannerAccountChoices} from './account-sheet-data.js';
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
assert.equal(offerReceiptAvailability({accounts:[{accountRef:'A1'}],receipts:[{}]},promo).status,'outdated');
assert.equal(offerReceiptAvailability({accounts:[{accountRef:'A1'}],receipts:[{}],receiptMatchVersion:1,offerReceiptMatches:[]},{...promo,receiptConfirmedUses:0}).status,'no_matches');
assert.equal(offerReceiptAvailability({accounts:[{accountRef:'A1'}],receipts:[{}],receiptMatchVersion:1,offerReceiptMatches:[]},{...promo,receiptConfirmedUses:2}).status,'missing_details');
assert.equal(offerReceiptAvailability(data,{...promo,reviewReasons:['ambiguous_receipt_match'],id:'other'}).status,'unresolved');
console.log('✓ Receipt availability distinguishes absent, legacy, failed, outdated, known zero, aggregate-only and unresolved evidence');

const historyOffer=(id,extra={})=>({id,accountRef:'A1',uses:5,usesVerified:true,receiptConfirmedUses:0,usesRemaining:5,expiresAt:'2026-12-01T23:59:59Z',discountType:'fixed',discount:12,...extra});
const historyPromos=[historyOffer('complete',{receiptConfirmedUses:5,usesRemaining:0}),historyOffer('expired',{expiresAt:'2026-01-01',receiptConfirmedUses:1}),historyOffer('ignored',{receiptConfirmedUses:5,usesRemaining:0}),historyOffer('manual'),historyOffer('active')],historyStore={offers:{ignored:{ignored:true},manual:{forceDone:true}}};
const history=accountHistoryGroups([...historyPromos,historyPromos[0]],[{issued:10,issuedAt:'2026-01-01',expiresAt:'2026-02-01',status:'expired'},{issued:12,issuedAt:'2026-02-01',status:'exhausted'},{issued:12,issuedAt:'2026-02-01',status:'exhausted'}],historyStore,new Date('2026-10-20'));
assert.deepEqual(Object.fromEntries(history.map(g=>[g.key,g.records.length])),{completed:1,expired:2,ignored:1,manual:1,exhausted:1,other:0});
console.log('✓ Account history uses exclusive existing classifications, preserves manual/exhausted distinctions and deduplicates promos and grants');

assert.equal(offerReceiptAvailability({accounts:[{accountRef:'other'}],receipts:[{}],receiptMatchVersion:1,offerReceiptMatches:[]},promo).status,'not_imported','A partial export cannot establish receipt coverage for another account');
assert.equal(offerReceiptAvailability({accounts:[{accountRef:'A1'}],receipts:[],receiptMatchVersion:1,offerReceiptMatches:[]},{...promo,receiptConfirmedUses:0}).status,'no_matches','A supported empty receipt corpus differs from no private import');

{
 const creditPromo={id:'cash-history-source',accountRef:'A1',discountType:'uberCash'};
 const grant={issuedAt:'2026-09-01T12:00:00Z',issued:10,expiresAt:'2026-10-01T12:00:00Z',status:'expired',offers:[creditPromo]};
 const state={version:3,offers:{'cash-history-source':{ignored:true}}};
 const grouped=accountHistoryGroups([], [grant,{...grant}],state);
 assert.equal(grouped.find(g=>g.key==='ignored').records.length,1,'Ignored credit is historical once, even after expiry/reminders');
 assert.equal(grouped.find(g=>g.key==='expired').records.length,0,'Historical credit belongs to one status category');
 assert.equal(accountHistoryGroups([],[{...grant,status:'estimated'}],{version:3,offers:{'cash-history-source':{forceDone:true}}}).find(g=>g.key==='manual').records.length,1,'Manual credit decisions remain distinct from verified completion');
}
console.log('✓ Historical credit preserves ignored/manual decisions, source evidence and exclusive deduplication.');

// Availability is independent from default counters and detailed receipt rows.
const usagePromo={id:'pub_a',accountRef:'A1',receiptConfirmedUses:0};
assert.equal(offerUsageEvidence(null,usagePromo).confirmed,null);
assert.equal(offerUsageEvidence({accounts:[{accountRef:'A1'}],receipts},usagePromo).confirmed,null);
assert.equal(offerUsageEvidence({...data,offerReceiptMatches:[]},usagePromo).confirmed,null,'A supported schema with missing receipt amounts cannot establish zero');
assert.equal(offerUsageEvidence({...data,offerReceiptMatches:[],receipts:[]},usagePromo).confirmed,0,'Supported empty receipt coverage can establish zero');
assert.equal(offerUsageEvidence(data,usagePromo).confirmed,3);
assert.equal(offerUsageEvidence(null,{...usagePromo,receiptConfirmedUses:2}).confirmed,2);
assert.equal(offerUsageEvidence(data,{...usagePromo,receiptConfirmedUses:4}).confirmed,4,'Safe aggregate is not hidden by a partial detail import');
assert.equal(offerUsageEvidence(data,{...usagePromo,usageEvidenceUnavailable:true}).confirmed,null);
assert.equal(offerUsageEvidence(data,{...usagePromo,reviewReasons:['ambiguous_receipt_match']}).partial,true);
console.log('✓ Unavailable/default zero, known zero, linked rows, aggregate-only, partial and conflicting usage stay distinct.');

{
 const {accountPromoUseProjection,consumeManualUse,undoManualUse,restoreCompetingPromo,normaliseManualStore}=await import('./manual-state.js');
 const offers=[historyOffer('chosen'),historyOffer('other',{discount:10}),{...historyOffer('cash'),discountType:'uberCash'}];
 let store=normaliseManualStore(),view=()=>accountPromoUseProjection(store,offers);
 assert.equal(view().filter(p=>p.hiddenByPromoUse).length,0);
 store=consumeManualUse(store,offers[0]);assert.deepEqual(view().map(p=>p.hiddenByPromoUse),[false,true,false]);
 store=undoManualUse(store,offers[0]);assert.equal(view().some(p=>p.hiddenByPromoUse),false);
 const confirmed=[{...offers[0],receiptConfirmedUses:5,usesRemaining:0},offers[1],offers[2]];
 assert.equal(accountPromoUseProjection(store,confirmed)[1].hiddenByPromoUse,true,'Exhaustion cannot release competitors');
 store=restoreCompetingPromo(store,offers[1]);assert.equal(accountPromoUseProjection(store,confirmed)[1].hiddenByPromoUse,false);
 assert.equal(JSON.parse(JSON.stringify(store)).offers.other.competitionRestored,true);
 const multi=accountPromoUseProjection({},[{...offers[0],receiptConfirmedUses:1},{...offers[1],receiptConfirmedUses:2},offers[2]]);
 assert.equal(multi.filter(p=>p.promoInUse).length,2,'Multiple genuinely used promos retain their evidence');assert.equal(multi.some(p=>p.hiddenByPromoUse),false);
 assert.equal(accountHistoryGroups(accountPromoUseProjection({},confirmed),[],{}).find(g=>g.key==='other').records.length,1,'Hidden competitors reuse Other promos in the existing accordion');
}
console.log('✓ Promo in use: explicit manual/confirmed evidence, undo, exhaustion, restoration, multiple used offers and independent Cash.');

{
 const prefs={preferredPromos:['fixed:12:15'],includeCash:true},at=Date.parse('2026-10-20T12:00:00Z');
 const p=(id,discount=12,days=15)=>({id,accountRef:id.split('-')[0],service:'Uber Eats',discountType:'fixed',discount,minimumSpend:15,minimumSpendVerified:true,uses:5,usesVerified:true,receiptConfirmedUses:0,usesRemaining:5,trackingState:'available',firstEmailSentAt:'2026-10-01T12:00:00Z',expiresAt:new Date(at+days*86400000).toISOString(),expiryStatus:'exact'});
 const a=(ref,offers,extra={})=>({accountRef:ref,accountMasked:'masked-'+ref,canLogin:true,accountStatus:'active',loginMethod:'iCloud',promos:offers,allOffers:offers,hasEligibleOffers:offers.length>0,...extra});
 const cash={status:'estimated',remaining:8};
 const records=[a('A',[p('A-main'),p('A-soon',10,1)],{email:'Punctuation.Name+tag-7@Example.invalid',loginMethods:['iCloud','Google']}),a('B',[p('B-main',12,1)],{email:'beta@example.invalid',loginMethod:'Google',cashPosition:cash}),a('C',[],{email:'cash@example.invalid',cashPosition:cash}),a('D',[p('D-main')],{email:'locked@example.invalid',canLogin:false}),a('E',[],{email:'unknown@example.invalid',cashPosition:{status:'needs_checking',remaining:null}}),a('F',[],{email:'expired@example.invalid',cashPosition:{status:'expired',remaining:0}})];
 const run=filters=>directoryAccounts([...records,records[0]],{type:'all',management:'tracked',login:'all',provider:'all',...filters},prefs,{emailFor:a=>a.email,now:at,valueFor:p=>p.discount});
 assert.deepEqual(run({search:'  PUNCTUATION.Name+tag-7@EXAMPLE.invalid  '}).map(a=>a.accountRef),['A']);
 assert.deepEqual(run({search:'name+tag',provider:'Google',login:'login'}).map(a=>a.accountRef),['A']);
 assert.deepEqual(run({type:'fixed:12:15',management:'expiring'}).map(a=>a.accountRef),['B'],'Type and expiry must belong to the same offer');
 assert.deepEqual(run({type:'cash-promo'}).map(a=>a.accountRef),['B']);
 records[1].cashPosition={...cash,stacking:'unsupported'};
 records[1].promos[0].restrictions={stacking:'no_other_promotions'};
 assert.deepEqual(run({type:'cash-promo'}).map(a=>a.accountRef),['B'],'Accounts presence filter does not promise checkout compatibility');
 records[1].cashPosition={status:'needs_checking',remaining:null};
 assert.deepEqual(run({type:'cash-promo'}),[],'Unknown Cash is not available Cash');
 records[1].cashPosition=cash;delete records[1].promos[0].restrictions;

 assert.deepEqual(run({type:'cash'}).map(a=>a.accountRef),['B','C']);
 assert.deepEqual(run({type:['fixed:10:15','cash']}).map(a=>a.accountRef),['A','B','C'],'A multi-select group uses OR; independent groups use AND');
 assert.deepEqual(run({search:'locked',login:'login'}),[]);
 records[0].receiptReviewCount=1;
 assert.deepEqual(run({management:'review',type:'fixed:12:15'}).map(a=>a.accountRef),['A'],'Account receipt review is independent of the selected offer type');
 assert.deepEqual(run({management:'review',type:'fixed:12:15',availability:'ready'}).map(a=>a.accountRef),['A'],'A valid selected offer remains ready while account receipts need review');
 const expired=p('F-old',10,-2);records[5].allOffers=[expired,{...p('F-credit',10,-2),discountType:'uberCash',cashEstimate:{status:'expired',remaining:0}}];
 assert.deepEqual(run({management:'expired',type:'cash'}).map(a=>a.accountRef),['F'],'Expired cash remains discoverable in explicit history');
 records[5].cashPosition=cash;assert.equal(run({management:'expired',type:'all',availability:'ready'}).length,0,'Cash cannot supply the readiness of a different expired offer');assert.equal(run({management:'expired',type:'fixed:10:15',availability:'ready'}).length,0,'Unrelated cash cannot make an expired selected promo ready');records[5].cashPosition={status:'expired',remaining:0};
 assert.equal(run({search:'none'}).length,0);assert.equal(run({search:''}).length,records.length,'Clear restores all accounts once');
 assert.deepEqual(run({sort:'email'}).map(a=>a.email),run({sort:'email'}).map(a=>a.email).sort((a,b)=>a.localeCompare(b,'en-GB',{sensitivity:'base'})));
 assert.equal(run({sort:'best'}).at(-1).directoryValue,null,'Missing value ranks after known values');
 records.push(a('G',[p('G-z',3)],{email:records[3].email}));assert.deepEqual(run({search:'locked',sort:'email'}).map(a=>a.accountRef),['D','G'],'Stable account identity tie breaker');
}
console.log('✓ Directory full identities, punctuation/case/space, AND/OR filters, dual providers, same-offer terms, Cash states, all sorts, missing values and stable deduplication.');

{
 const {accountPromoUseProjection,restoreCompetingPromo}=await import('./manual-state.js');
 const {plannerOffersForScope,matchesDiscoveryScope,normaliseOfferPreferences}=await import('./offer-preferences.js');
 const {rankPromosForSpend}=await import('./deal-intelligence.js');
 const make=(id,discount,confirmed=0)=>({id,accountRef:'scope-account',service:'Uber Eats',discountType:'fixed',discount,minimumSpend:15,minimumSpendVerified:true,uses:5,usesVerified:true,receiptConfirmedUses:confirmed,usesRemaining:5-confirmed,trackingState:confirmed===5?'used':'available',expiresAt:new Date(Date.now()+86400000).toISOString(),expiryStatus:'exact'});
 const originals=[make('in-use',12,5),make('competitor',10)],before=JSON.stringify(originals),view=accountPromoUseProjection({},originals),preferences=normaliseOfferPreferences({preferredPromos:['fixed:10:15'],includeCash:false});
 assert.deepEqual(rankPromosForSpend(view,15),[],'Exhausting the used promo cannot release its competitor into a plan');
 assert.equal(matchesDiscoveryScope({promos:view},'preferred',preferences),false,'Hidden offers cannot inflate preferred counts');
 assert.deepEqual(plannerOffersForScope(view,[],'all',preferences).map(p=>p.id),['in-use'],'Every Planner scope removes the hidden competitor before ranking');
 const restored=accountPromoUseProjection(restoreCompetingPromo({},originals[1]),originals);
 assert.equal(rankPromosForSpend(restored,15)[0].promo.id,'competitor');
 assert.equal(matchesDiscoveryScope({promos:restored},'preferred',preferences),true);
 assert.equal(JSON.stringify(originals),before,'The source records and usage evidence remain unchanged');
}
console.log('✓ In-use suppression is shared by preferred discovery, every Planner scope and direct ranking, with explicit restoration and immutable sources.');

{
 const p={id:'coverage',accountRef:'A1',receiptConfirmedUses:0,firstEmailSentAt:'2026-10-01T00:00:00Z',expiresAt:'2026-11-01T00:00:00Z'};
 const exportData={accounts:[{accountRef:'A1'}],receiptMatchVersion:1,offerReceiptMatches:[],receipts:[{receiptId:'summary-only',accountRef:'A1',service:'Uber Eats',orderAt:'2026-10-05T12:00:00Z',total:4}]};
 assert.equal(offerUsageEvidence(exportData,p).confirmed,null);
 assert.equal(offerReceiptAvailability(exportData,p).status,'incomplete');
 assert.equal(offerUsageEvidence({...exportData,receipts:exportData.receipts.map(r=>({...r,promotionDiscount:0}))},p).confirmed,0,'Explicit zero is not missing');
 assert.equal(offerUsageEvidence({...exportData,receipts:exportData.receipts.map(r=>({...r,promotionDiscount:'0'}))},p).confirmed,null,'Unsupported amount representations cannot manufacture confirmed zero');
 assert.equal(offerUsageEvidence({...exportData,receipts:exportData.receipts.map(r=>({...r,promotionDiscount:12}))},p).confirmed,null,'Positive discount without qualifying basket cannot establish matching completeness');
 assert.equal(offerUsageEvidence({...exportData,receipts:exportData.receipts.map(r=>({...r,orderAt:'2026-09-01T12:00:00Z'}))},p).confirmed,0,'Earlier receipts cannot redeem a later offer');
 assert.equal(offerUsageEvidence(exportData,{...p,receiptConfirmedUses:2}).confirmed,2,'Keep supported positive aggregate even when details are partial');
 const pref={preferredPromos:['fixed:12:15']};
 const preferred={id:'preferred',accountRef:'A1',discountType:'fixed',discount:12,minimumSpend:15,minimumSpendVerified:true};
 const other={...preferred,id:'other',discountType:'percent',discount:30,minimumSpend:20};
 const partition=preferredAccountOffers([preferred,other],pref);
 assert.deepEqual(partition.current.map(p=>p.id),['preferred']);assert.equal(partition.other[0].hiddenByPreference,true);
 assert.deepEqual(accountHistoryGroups(partition.other).find(g=>g.key==='other').records.map(r=>r.promo.id),['other']);
 assert.equal(other.hiddenByPreference,undefined,'Presentation does not mutate source');
 assert.equal(preferredAccountOffers([{...other,promoInUse:true}],pref).current.length,1,'Used promo remains prominent');
 assert.equal(preferredAccountOffers([other],pref,{version:3,offers:{other:{competitionRestored:true}}}).current.length,1,'An explicit Restore bypasses preference folding');
}
console.log('✓ Incomplete compact receipts never manufacture zero; preference folding retains used/restored offers and original records.');

{
 const {offerUsageSlots}=await import('./account-sheet-data.js');
 const {consumeManualUse,undoManualUse,normaliseManualStore,pendingManualEntries}=await import('./manual-state.js');
 const promo={id:'slot-offer',accountRef:'S1',uses:5,usesVerified:true,receiptConfirmedUses:3,usesRemaining:2};
 const receipts=[1,2,3].map(i=>({receiptId:'slot-'+i,accountRef:'S1',service:'Uber Eats',orderAt:`2026-10-0${i}T12:00:00Z`,total:i===2?null:i*2}));
 const data={accounts:[{accountRef:'S1'}],receipts,events:[],receiptMatchVersion:1,offerReceiptMatches:receipts.map(r=>({receiptId:r.receiptId,accountRef:'S1',offerId:'slot-offer',status:'confirmed'}))};
 let store=normaliseManualStore();
 assert.deepEqual(offerUsageSlots(data,promo,store).slots.map(s=>s.kind),['confirmed','confirmed','confirmed','unused','unused']);
 store=consumeManualUse(store,promo,'2026-10-20T12:00:00Z');
 let model=offerUsageSlots(data,promo,store);assert.deepEqual(model.slots.map(s=>s.kind),['confirmed','confirmed','confirmed','manual','unused']);assert.equal(model.remaining,1);assert.equal(model.slots[3].at,'2026-10-20T12:00:00Z');assert.equal(model.slots[1].total,null);assert.equal(model.slots[0].total,2,'Slot amounts are receipt totals, not savings');
 const saved=JSON.parse(JSON.stringify(store));assert.deepEqual(offerUsageSlots(data,promo,saved),model);
 store=undoManualUse(store,promo);assert.equal(offerUsageSlots(data,promo,store).manual,0);assert.equal(offerUsageSlots(data,promo,store).confirmed,3);
 const fourth={receiptId:'slot-4',accountRef:'S1',service:'Uber Eats',orderAt:'2026-10-04',total:12};
 const incoming={...data,receipts:[...receipts,fourth],offerReceiptMatches:[...data.offerReceiptMatches,{receiptId:fourth.receiptId,accountRef:'S1',offerId:'slot-offer',status:'confirmed'}]};
 model=offerUsageSlots(incoming,{...promo,receiptConfirmedUses:4,usesRemaining:1},saved);assert.equal(model.confirmed,4);assert.equal(model.manual,0);assert.equal(model.remaining,1);assert.equal(incoming.receipts.length,4);
 const unrelated={...data,receipts:[...receipts,fourth]};assert.equal(offerUsageSlots(unrelated,promo,saved).manual,1,'Equal amounts without an assigned promo match do not reconcile manual uses');
 const unknown=offerUsageSlots(null,{...promo,receiptConfirmedUses:null,usesRemaining:5},consumeManualUse(normaliseManualStore(),{...promo,receiptConfirmedUses:null,usesRemaining:5},'2026-10-20'));
 assert.equal(unknown.confirmed,null);assert.equal(unknown.remaining,null);assert.equal(unknown.slots[0].kind,'manual');assert.ok(unknown.slots.slice(1).every(s=>s.kind==='unknown'));
 for(const uses of [1,2,3,5,6,12])assert.equal(offerUsageSlots(null,{...promo,uses,receiptConfirmedUses:0,usesRemaining:uses}).slots.length,uses);
 for(const uses of [null,100,100000])assert.equal(offerUsageSlots(null,{...promo,uses,receiptConfirmedUses:null},saved).compact,true);
 const legacy=normaliseManualStore({offers:{'slot-offer':{manualUsesConsumed:2,receiptConfirmedBaseline:3,lastManualUseAt:'2026-10-18'}}});assert.deepEqual(pendingManualEntries(legacy,promo).map(e=>e.at),[null,'2026-10-18']);assert.deepEqual(pendingManualEntries(consumeManualUse(legacy,{...promo,uses:6,usesRemaining:3},'2026-10-20'),{...promo,uses:6,usesRemaining:3}).map(e=>e.at),[null,'2026-10-18','2026-10-20']);
 console.log('✓ Usage slots: actual limits, dated manual/undo/persistence, receipt totals, explicit-match reconciliation, unknown and compact limits; originals retained.');
}

{
 const {consumeManualUse,undoManualUse,pendingManualUses,accountPromoUseProjection}=await import('./manual-state.js');
 const p={id:'unavailable-baseline',accountRef:'qa-local',uses:5,usesVerified:true,usesRemaining:5,receiptConfirmedUses:null,usageEvidenceUnavailable:true};
 let s={version:3,offers:{'unavailable-baseline':{manualUsesConsumed:1,receiptConfirmedBaseline:3,history:[]}}};
 assert.equal(accountPromoUseProjection(s,[p,{...p,id:'competitor',usageEvidenceUnavailable:false,receiptConfirmedUses:0}])[0].hiddenByPromoUse,false,'Temporarily unavailable receipts do not hide the prior promo in use');
 const recorded=consumeManualUse(s,p,'2026-10-24T10:00:00Z');assert.equal(recorded.offers[p.id].manualUsesConsumed,2);assert.equal(recorded.offers[p.id].receiptConfirmedBaseline,3,'Unavailable evidence must preserve its known receipt baseline');
 const undone=undoManualUse(recorded,p);assert.equal(undone.offers[p.id].manualUsesConsumed,1);assert.equal(undone.offers[p.id].receiptConfirmedBaseline,3);
 assert.equal(pendingManualUses(undone,{...p,usageEvidenceUnavailable:false,receiptConfirmedUses:3}),1,'Restoring the same receipts must not erase unrelated manual entries');
}

{
 const {normaliseOfferPreferences}=await import('./offer-preferences.js');
 const now=Date.parse('2026-10-29T12:00:00Z');
 const promo=(id,extra={})=>({id,service:'Uber Eats',discountType:'fixed',discount:12,minimumSpend:15,minimumSpendVerified:true,uses:5,usesVerified:true,usesRemaining:3,receiptConfirmedUses:0,trackingState:'available',firstEmailSentAt:'2026-10-01T12:00:00Z',expiresAt:'2099-12-31T23:59:59Z',expiryStatus:'exact',...extra});
 const row=(accountRef,offers,extra={})=>({accountRef,accountMasked:accountRef+'@example.invalid',canLogin:true,archived:false,accountStatus:'active',promos:offers,allOffers:offers,...extra});
 const records=[row('valid',[promo('valid-a'),promo('valid-b')]),row('other',[promo('other',{discount:8,minimumSpend:20})]),row('locked',[promo('locked')],{canLogin:false}),row('archived',[promo('archived')],{archived:true,accountStatus:'archived'}),row('expired',[promo('expired',{expiresAt:'2026-10-28T12:00:00Z'})]),row('exhausted',[promo('exhausted',{usesRemaining:0})]),row('ignored',[promo('ignored',{ignored:true})]),row('finished',[promo('finished',{forceDone:true})]),row('hidden',[promo('hidden',{hiddenByPromoUse:true})]),row('unknown',[promo('unknown',{trackingState:'needs_checking',sourceEvidenceStatus:'missing'})]),row('cash',[],{cashPosition:{remaining:5,status:'verified'}}),row('unknown-cash',[],{cashPosition:{remaining:null,status:'needs_checking'}})];
 const filters={type:'preferred',management:'tracked',login:'all',provider:'all',availability:'ready'};
 const list=preferences=>directoryAccounts([...records,records[0]],filters,normaliseOfferPreferences(preferences),{now}).map(a=>a.accountRef).sort();
 assert.deepEqual(list({preferredPromos:['fixed:12:15'],includeCash:false}),['valid'],'One account once; uncertain, hidden, expired, ignored, exhausted, finished and inaccessible offers are not ready');
 assert.deepEqual(list({preferredPromos:['fixed:8:20'],includeCash:false}),['other'],'Custom saved preferences replace the match set');
 assert.deepEqual(list({preferredPromos:[],includeCash:false}),[],'An empty saved preference list does not fall back to hardcoded offers');
 assert.deepEqual(list({preferredPromos:['fixed:12:15'],includeCash:true}),['cash','valid'],'Cash follows its existing saved inclusion setting, with unknown balances excluded');
 const noUses=promo('no-recorded-uses',{receiptConfirmedUses:null,usesRemaining:5});
 assert.equal(directoryAccounts([row('unused',[noUses])],filters,normaliseOfferPreferences({preferredPromos:['fixed:12:15'],includeCash:false}),{now}).length,1,'No receipt matching data alone does not disqualify a usable unused preferred offer');
 const login=()=>directoryAccounts(records,{...filters,type:'all',login:'login',availability:'any'},{preferredPromos:[],includeCash:false},{now}).length;
 const before=login();records[0].promos=records[0].promos.map(p=>({...p,usesRemaining:0}));assert.deepEqual(list({preferredPromos:['fixed:12:15'],includeCash:false}),[]);assert.equal(login(),before,'Can log in remains independent of preferred-offer availability');
}
console.log('✓ Preferred Home scope: saved custom/empty choices, unique accounts, remaining use, expiry, ignore/manual finish, hidden competitors, uncertain evidence, Cash setting and independent login counts.');
