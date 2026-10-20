import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {financialSummary,receiptFinancials,currentFinancialEvents} from './receipt-financials.js';
import {initFinancialLedger,appendFinancialEvent,readFinancialEvents,mergeFinancialEvents} from './financial-ledger.js';
import {PrivateFinanceVault,FINANCE_STORAGE_KEY,LEGACY_RECOVERY_KEY,encryptFinance,decryptFinance} from './private-finance-vault.js';
import {rankCheckoutOptions} from './deal-intelligence.js';
const receipt={receiptId:'rcp_test',accountRef:'A001',service:'Uber Eats',total:4.93};
assert.equal(receiptFinancials(receipt).total,null);
assert.equal(receiptFinancials({uberCashUsed:12}).total,null);
assert.equal(receiptFinancials({...receipt,promotionDiscount:10,reportedSavings:10,uberCashUsed:12}).total,10);
const b=receiptFinancials({...receipt,reportedSavings:12.89,uberCashUsed:12,total:13.53,financialEvidence:{reportedKind:'combined',outOfPocket:1.53}});
assert.equal(b.total,12.89);assert.equal(b.categories.combinedUberOnePromotions,12.89);assert.equal(b.outOfPocket,1.53);assert.equal(b.cashUsed,12);
const reconciled=receiptFinancials({...receipt,promotionDiscount:10,uberOneSavings:2.89,reportedSavings:12.89,financialEvidence:{reportedKind:'combined'}});assert.equal(reconciled.total,12.89);assert.equal(reconciled.categories.combinedUberOnePromotions,0);
const a={total:16.35,breakdown:{eatsPromotions:14.85,schedule:1.5},outOfPocket:4.93};assert.equal(receiptFinancials(receipt,a).total,16.35);assert.equal(receiptFinancials({...receipt,promotionDiscount:14.85,financialEvidence:{scheduleSavings:1.5}}).total,16.35);
assert.equal(receiptFinancials({...receipt,reportedSavings:4},a).conflict,true);
assert.equal(financialSummary([receipt,receipt],{rcp_test:a}).total,16.35);assert.equal(financialSummary([receipt]).missing,1);
const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE accounts(account_ref TEXT PRIMARY KEY);INSERT INTO accounts VALUES('A001');CREATE TABLE receipts(receipt_id TEXT,account_ref TEXT);INSERT INTO receipts VALUES('rcp_test','A001');CREATE TABLE transport_receipts(receipt_id TEXT,account_ref TEXT);");initFinancialLedger(db);
const event=appendFinancialEvent(db,{kind:'receipt',recordId:'rcp_test',accountRef:'A001',action:'set',value:a});assert.equal(currentFinancialEvents(readFinancialEvents(db)).corrections.rcp_test.total,16.35);mergeFinancialEvents(db,[event]);assert.equal(readFinancialEvents(db).length,1);assert.throws(()=>mergeFinancialEvents(db,[{...event,value:{total:99,breakdown:{},source:'manually_reported_from_uber',note:''}}]),/Conflicting/);assert.equal(readFinancialEvents(db).length,1);
appendFinancialEvent(db,{kind:'receipt',recordId:'rcp_test',accountRef:'A001',action:'undo',at:event.at});assert.equal(currentFinancialEvents(readFinancialEvents(db)).corrections.rcp_test,undefined);assert.equal(db.prepare('SELECT COUNT(*) n FROM receipts').get().n,1);assert.throws(()=>appendFinancialEvent(db,{kind:'receipt',recordId:'wrong',accountRef:'A001',action:'set',value:a}),/match/);db.close();
const saved=new Map(),storage={getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)};
const vault=new PrivateFinanceVault(storage);await vault.import({kind:'uber-tracker-private-finance',schemaVersion:1,accounts:[{accountRef:'A001'}],receipts:[receipt],events:[]});await vault.append({kind:'receipt',recordId:'rcp_test',accountRef:'A001',action:'set',value:a});const backup=await vault.encryptedBackup('test passphrase only');assert.ok(!backup.includes('rcp_test'));assert.ok(!backup.includes('16.35'));assert.equal((await decryptFinance(JSON.parse(backup),'test passphrase only')).events.length,1);await assert.rejects(()=>decryptFinance(JSON.parse(backup),'wrong password 123'),/decrypt/);
await vault.import({kind:'uber-tracker-private-finance',schemaVersion:1,accounts:[{accountRef:'A001'}],receipts:[receipt],events:[]});assert.equal(vault.current().corrections.rcp_test.total,16.35,'Resync preserves local history');const reopened=new PrivateFinanceVault(storage);assert.equal(reopened.current().corrections.rcp_test.total,16.35);await reopened.append({kind:'receipt',recordId:'rcp_test',accountRef:'A001',action:'undo'});assert.equal(reopened.current().corrections.rcp_test,undefined);assert.equal(reopened.data.events.length,2);
const previous=reopened.data;reopened.storage={...storage,setItem(){throw Error('quota');}};await assert.rejects(()=>reopened.append({kind:'receipt',recordId:'rcp_test',accountRef:'A001',action:'set',value:a}),/quota/);assert.equal(reopened.data,previous,'Failed persistence never pretends to save');
const now='2026-10-11T12:00:00Z',offer={id:'offer',accountRef:'A001',canLogin:true,service:'Uber Eats',discountType:'fixed',discount:12,minimumSpend:15,uses:5,usesRemaining:5,expiresAt:'2026-10-30T23:59:00Z',expiryStatus:'exact'},accounts=[{accountRef:'A001',canLogin:true,accountStatus:'active'}],wallets={A001:{balance:12,at:now,stacking:'unknown'}};
let options=rankCheckoutOptions([offer],15,{accounts,wallets,now});assert.equal(options[0].kind,'promo');assert.equal(options[0].outOfPocket,3);assert.equal(options[0].cashRemaining,12);assert.equal(options.find(o=>o.kind==='promo_cash').conditional,true);wallets.A001.stacking='supported';options=rankCheckoutOptions([offer],15,{accounts,wallets,now});assert.equal(options[0].kind,'promo_cash');assert.equal(options[0].outOfPocket,0);assert.equal(options[0].cashRemaining,9);assert.equal(options[0].estimated,true);
assert.equal(rankCheckoutOptions([offer],15,{accounts,wallets,fees:{A001:2},now})[0].outOfPocket,0);assert.equal(rankCheckoutOptions([offer],14,{accounts,wallets,now}).some(o=>o.promo),false);wallets.A001.stacking='unsupported';assert.equal(rankCheckoutOptions([offer],15,{accounts,wallets,now}).some(o=>o.kind==='promo_cash'),false);assert.equal(rankCheckoutOptions([{...offer,discountType:'uberCash'}],15,{accounts,now}).length,0);assert.equal(rankCheckoutOptions([offer],15,{accounts:[{...accounts[0],archived:true}],wallets,now}).length,0);assert.equal(rankCheckoutOptions([offer],15,{accounts:[{...accounts[0],lastOrderAt:'2026-10-11T13:00:00Z'}],wallets,now}).some(o=>o.cashUsed>0),false);assert.equal(rankCheckoutOptions([{...offer,discountType:'percent',discount:40,perUseCap:5}],20,{accounts,now})[0].promotionDiscount,5);
console.log('✓ Receipt unknown/combined/schedule/Cash evidence, correction replace/undo/resync/history/encryption/storage failure; same-account checkout minimum/cap/fees/stacking/Cash-preservation/access/staleness');

const concurrentStorage={getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)},firstTab=new PrivateFinanceVault(concurrentStorage),secondTab=new PrivateFinanceVault(concurrentStorage);
await firstTab.append({kind:'cash',recordId:'A001',accountRef:'A001',action:'set',value:{balance:12,checkoutFees:2,basketSubtotal:15}});
await assert.rejects(()=>secondTab.append({kind:'cash',recordId:'A001',accountRef:'A001',action:'set',value:{balance:99}}),/another tab/);
assert.equal(secondTab.current().wallets.A001.balance,12,'Conflict reloads the latest copy without authentication');
await secondTab.append({kind:'cash',recordId:'A001',accountRef:'A001',action:'set',value:{balance:11,checkoutFees:2,basketSubtotal:15}});
const safeReload=new PrivateFinanceVault(concurrentStorage);assert.equal(safeReload.current().wallets.A001.balance,11);assert.equal(safeReload.current().wallets.A001.checkoutFees,2);
// Existing ciphertext is never discarded. Failed recovery and quota interruption
// are retryable; the original remains recoverable after verified migration.
const original=JSON.stringify(await encryptFinance(safeReload.data,'old private passphrase'));
for(const failure of ['password','recovery','activation']){
 const map=new Map([[FINANCE_STORAGE_KEY,original]]);let fail=true;
 const store={getItem:k=>map.get(k)||null,setItem(k,v){if(fail&&((failure==='recovery'&&k===LEGACY_RECOVERY_KEY)||(failure==='activation'&&k===FINANCE_STORAGE_KEY)))throw Error('quota');map.set(k,v);}};
 const legacy=new PrivateFinanceVault(store);assert.equal(legacy.status,'migration_required');
 await assert.rejects(()=>legacy.migrateLegacy(failure==='password'?'wrong old passphrase':'old private passphrase'),/decrypt|quota/);
 assert.equal(map.get(FINANCE_STORAGE_KEY),original);assert.equal(new PrivateFinanceVault(store).status,'migration_required');
 fail=false;await legacy.migrateLegacy('old private passphrase');assert.deepEqual(legacy.data,safeReload.data);assert.equal(map.get(LEGACY_RECOVERY_KEY),original);assert.deepEqual(new PrivateFinanceVault(store).data,safeReload.data);
}
console.log('✓ Persistent private data; concurrent conflicts; resumable legacy migration; failed password/quota preserve the recovery original');

const large={kind:'uber-tracker-private-finance',schemaVersion:1,accounts:[{accountRef:'A001'}],receipts:Array.from({length:1000},(_,i)=>({...receipt,receiptId:'rcp_large_'+i,merchant:'Example '.repeat(30)})),events:[]};const largeEncrypted=await encryptFinance(large,'test passphrase only');assert.equal((await decryptFinance(largeEncrypted,'test passphrase only')).receipts.length,1000);console.log('✓ Realistic large private imports encrypt without browser argument-stack overflow');

const combinedScheduled=receiptFinancials({...receipt,promotionDiscount:14.85,reportedSavings:16.35,financialEvidence:{reportedKind:'combined',scheduleSavings:1.5}});assert.equal(combinedScheduled.total,16.35);assert.equal(combinedScheduled.conflict,false);assert.equal(combinedScheduled.categories.schedule,1.5);assert.equal(Object.values(combinedScheduled.categories).reduce((a,b)=>a+b,0),16.35);console.log('✓ A combined reported total already containing schedule savings is never counted twice');

const twoAccounts=[...accounts,{accountRef:'A002',canLogin:true,accountStatus:'active'}],secondOffer={...offer,id:'no-cash-required',accountRef:'A002',discount:15};const conserved=rankCheckoutOptions([offer,secondOffer],15,{accounts:twoAccounts,wallets:{A001:{balance:50,at:now,stacking:'supported'}},now});assert.equal(conserved[0].accountRef,'A002');assert.equal(conserved[0].cashUsed,0);assert.equal(rankCheckoutOptions([offer],15,{accounts:[{...accounts[0],lastRideAt:'2026-10-11T13:00:00Z'}],wallets,now}).some(o=>o.cashUsed>0),false);const cashOnly=rankCheckoutOptions([],15,{accounts,wallets:{A001:{balance:20,at:now,stacking:'unknown'}},now});assert.equal(cashOnly[0].outOfPocket,0);assert.equal(cashOnly[0].cashRemaining,5);console.log('✓ Equal-payment choices conserve cash across accounts; newer Ride spending invalidates a balance; verified cash can pay without an active coupon');

// Delivery and pickup restrictions cannot enter the wrong checkout comparison.
const {matchesFulfilment}=await import('./deal-intelligence.js');
assert.equal(matchesFulfilment({restrictions:{fulfilment:'delivery_only'}},'pickup'),false);
assert.equal(matchesFulfilment({restrictions:{fulfilment:'pickup_only'}},'delivery'),false);
assert.equal(matchesFulfilment({restrictions:{fulfilment:'unknown'}},'delivery'),true);

// Purchase dates without a clock must not hide a new same-day receipt.
const dayOnlyAccount={...accounts[0],orderCount:1,rideCount:1,lastRideAt:'2026-10-11'};
const knownCountWallet={...wallets[dayOnlyAccount.accountRef],balance:12,stacking:'supported',at:'2026-10-11T12:00:00Z',receiptCount:2};
const datedOptions=account=>rankCheckoutOptions([],15,{accounts:[account],wallets:{[account.accountRef]:knownCountWallet},now:'2026-10-11T14:00:00Z'});
assert.ok(datedOptions(dayOnlyAccount).some(o=>o.cashUsed>0),'A current verified balance can be used after existing receipt evidence');
assert.ok(datedOptions({...dayOnlyAccount,rideCount:2}).every(o=>o.cashUsed===0),'A new same-day receipt requires rechecking Cash');
assert.ok(datedOptions({...dayOnlyAccount,orderCount:0}).every(o=>o.cashUsed===0),'Changed evidence must not silently retain a balance');
console.log('✓ Same-day receipt-count changes invalidate Cash without inventing purchase times');

const {validateCashEntry}=await import('./receipt-financials.js');
assert.equal(validateCashEntry({balance:12,receiptCount:2}).receiptCount,2);
assert.throws(()=>validateCashEntry({balance:12,receiptCount:'2'}),/Invalid receipt evidence count/);
assert.throws(()=>validateCashEntry({balance:12,receiptCount:-1}),/Invalid receipt evidence count/);
