import {importPrivateFinance} from './test-browser-navigation.js';
import {openHomeDetail,leaveReceiptEditor,openReceiptPayments,openFinanceHistory,openOfferManagement} from './test-browser-navigation.js';
// Computed mobile sizes and real encrypted form flows; fixtures stay off disk.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {execFileSync} from 'node:child_process';
import {chromium,webkit,firefox} from 'playwright';
execFileSync(process.execPath,['build-site.js']);
const stamp=new Date().toISOString(),account={accountRef:'A001',accountMasked:'te…01@example.invalid',canLogin:true,orderCount:2,rideCount:1,receiptReviewCount:2};
const offer={id:'mobile-offer',...account,service:'Uber Eats',discountType:'fixed',discount:12,minimumSpend:15,uses:5,usesRemaining:4,receiptConfirmedUses:1,usesVerified:true,firstEmailSentAt:stamp,emailSentAt:stamp,expiresAt:new Date(Date.now()+10*86400000).toISOString(),expiryStatus:'exact'};
const snapshot={accounts:[account],promos:[offer],generatedAt:stamp,sync:{lastSuccessfulMailScanAt:stamp},summary:{totalSaved:24.89,trackedOrders:2,trackedRides:1,financialBreakdown:{missing:2}}};
const transfer={kind:'uber-tracker-private-finance',schemaVersion:1,receiptReviewVersion:1,accounts:[{accountRef:'A001'}],receipts:[
 {receiptId:'rcp_adjusted',accountRef:'A001',service:'Uber Eats',merchant:'Adjusted receipt',sentAt:'2025-12-28T03:30:00Z',total:0,financialEvidence:{outOfPocket:0},financialReview:{reasons:['refund','adjusted_receipt'],revision:'a'.repeat(64)}},
 {receiptId:'rcp_charged',accountRef:'A001',service:'Uber Eats',sentAt:'2025-12-27T03:30:00Z',promotionDiscount:12,total:5.62,financialEvidence:{outOfPocket:5.62},financialReview:{reasons:['adjusted_receipt'],revision:'b'.repeat(64)}},
 {receiptId:'rcp_ride',accountRef:'A001',service:'Uber',sentAt:'2025-12-26T03:30:00Z',reportedSavings:12.89,financialEvidence:{reportedKind:'combined'}}
],events:[]};
const files=new Set(fs.readdirSync('dist'));
const server=http.createServer((req,res)=>{const file=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';if(!files.has(file)){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':file.endsWith('.css')?'text/css':'text/html');res.end(file==='promos.json'?JSON.stringify(snapshot):file==='history.json'?JSON.stringify({updatedAt:stamp,records:[offer]}):fs.readFileSync('dist/'+file));});
server.listen(0,'127.0.0.1');await once(server,'listening');
const name=process.env.TRACKER_BROWSER_ENGINE||'chromium',browser=await{chromium,webkit,firefox}[name].launch();
const url='http://127.0.0.1:'+server.address().port;
async function fields(page){
 const sizes=await page.locator('input,textarea,select').evaluateAll(items=>items.map(e=>({id:e.id||e.type,size:parseFloat(getComputedStyle(e).fontSize)})));
 assert.ok(sizes.length);assert.ok(sizes.every(f=>f.size>=16),'Mobile font floor: '+JSON.stringify(sizes.filter(f=>f.size<16)));
 assert.ok(!/user-scalable\s*=\s*(?:no|0)|maximum-scale\s*=/i.test(await page.locator('meta[name="viewport"]').getAttribute('content')),'Pinch zoom remains enabled');
 assert.equal(await page.locator('body').evaluate(e=>getComputedStyle(e).touchAction),'auto');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow');
}
try{for(const width of [320,390,430,844,1024]){
 const context=await browser.newContext({viewport:{width,height:900},hasTouch:true,reducedMotion:'reduce',timezoneId:'Europe/London'}),page=await context.newPage(),errors=[],writes=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET')writes.push(r.url());});
 await page.goto(url);await page.waitForFunction(()=>document.getElementById('scanLabel').textContent==='Up to date');await fields(page);
 assert.equal(await page.locator('#basketInput').evaluate(e=>parseFloat(getComputedStyle(e).fontSize)),20,'Neutral basket amount matches the reference and remains readable');
 await openHomeDetail(page,'planner');await page.locator('[data-open-sheet="advanced"]:visible').click();await fields(page);assert.equal(await page.locator('.setting-money input').first().evaluate(e=>parseFloat(getComputedStyle(e).fontSize)),25,'Sheet amount keeps its larger size');await page.keyboard.press('Escape');
 await page.locator('[data-view="accounts"]').click();await page.locator('#accountsList [data-account-offers]').first().click();await openOfferManagement(page);await page.locator('[data-toggle-ignore][data-ignore="true"]').click();await page.locator('#sheetBody').evaluate(e=>{const field=document.createElement('textarea');field.id='futureSheetTextarea';field.className='sheet-input';e.append(field);});await fields(page);await page.keyboard.press('Escape');
 await page.locator('[data-view="more"]').click();await page.locator('[data-view=more]').click();await page.locator('#view-more [data-open-sheet="finance"]').click();await page.locator('.finance-page [data-finance-target=history]').click();await fields(page);
 await page.locator('.finance-empty').waitFor();
 await importPrivateFinance(page,{name:'finance.local.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(transfer))});await page.locator('#financeReceipt option').first().waitFor({state:'attached'});
 await page.locator('[data-finance-panel="receipt"] > summary').click();await page.locator('[data-finance-action="change-receipt"]').click();await page.locator('#financeReceipt').selectOption('rcp_adjusted');await fields(page);assert.equal(await page.locator('#financePaid').getAttribute('required'),'','Final payment required for refund review');await page.locator('#financeMissingOnly').check();assert.equal(await page.locator('#financeReceipt option').count(),3,'Unknown payments and known savings with adjustments stay in Missing details');await page.locator('#financeMissingOnly').uncheck();
 if(await page.locator('[data-finance-disclosure="breakdown"]').getAttribute('open')===null)await page.locator('[data-finance-disclosure="breakdown"] > summary').click();assert.equal(await page.locator('#finance-ridePromotions').isVisible(),false,'Only the receipt service is shown first');
 await page.locator('#financeTotal').fill('16.21');await openReceiptPayments(page);await page.locator('#financePaid').fill('0');await page.locator('#finance-eatsPromotions').fill('12');await page.locator('#finance-explicitUberOne').fill('4.21');
 assert.equal(await page.locator('[data-finance-breakdown-total]').innerText(),'£16.21');assert.equal(await page.locator('[data-finance-breakdown-check]').innerText(),'Matches total savings.');
 // Searching must retain the form, focus, draft and open sections when the
 // selected receipt still matches; it must not rebuild the sheet while typing.
 await page.locator('#financeSearch').evaluate(e=>window.searchField=e);await page.locator('#financeSearch').fill('Adjusted');
 assert.ok(await page.locator('#financeSearch').evaluate(e=>e===window.searchField&&e===document.activeElement));assert.equal(await page.locator('#financeTotal').inputValue(),'16.21');await page.locator('#financeSearch').fill('');
 await page.locator('[data-finance-form="receipt"] button[type="submit"]').click();await page.waitForFunction(()=>document.querySelector('[data-finance-feedback="receipt"]')?.dataset.state==='saved');
 assert.equal(await page.locator('[data-finance-disclosure="breakdown"]').getAttribute('open'),'','Saving keeps expanded breakdown');assert.match(await page.locator('[data-finance-feedback="receipt"]').innerText(),/Saved correction.*Adjusted receipt/);
 assert.ok(await page.locator('[data-finance-feedback="receipt"]').evaluate(e=>{const r=e.getBoundingClientRect(),s=e.closest('.sheet-body').getBoundingClientRect();return r.top>=s.top-1&&r.bottom<=s.bottom+1;}),'Saved confirmation stays in view');
 if(process.env.TRACKER_SCREENSHOT_DIR&&width===390){fs.mkdirSync(process.env.TRACKER_SCREENSHOT_DIR,{recursive:true,mode:0o700});await page.screenshot({path:process.env.TRACKER_SCREENSHOT_DIR+'/03-correction-saved.png'});}
 const decrypt=()=>page.evaluate(async()=>{return JSON.parse(localStorage.getItem('uber-tracker-finance-encrypted-v1')).data;});
 const saved=await decrypt();assert.equal(saved.events[0].value.total,16.21);assert.equal(saved.events[0].value.outOfPocket,0);assert.deepEqual(saved.events[0].value.breakdown,{eatsPromotions:12,explicitUberOne:4.21});assert.equal(saved.events[0].value.reviewedReceiptRevision,'a'.repeat(64));assert.equal(await page.locator('#financePaid').getAttribute('required'),null,'Review completes only after final savings and payment are saved');
 // A mismatch shows a nearby error and preserves typed values and ciphertext.
 const ciphertext=await page.evaluate(()=>localStorage.getItem('uber-tracker-finance-encrypted-v1'));
 await page.locator('#financeTotal').fill('12');await page.locator('[data-finance-form="receipt"] button[type="submit"]').click();await page.waitForFunction(()=>document.querySelector('[data-finance-feedback="receipt"]')?.dataset.state==='error');
 assert.match(await page.locator('[data-finance-feedback="receipt"]').innerText(),/exceeds/);assert.equal(await page.locator('#financeTotal').inputValue(),'12');assert.equal(await page.evaluate(()=>localStorage.getItem('uber-tracker-finance-encrypted-v1')),ciphertext);
 // Undo/redo restores exact previous values, including the review state.
 await page.locator('[data-finance-action="undo-receipt"]').click();await page.waitForFunction(()=>document.querySelector('[data-finance-feedback="receipt"]')?.dataset.state==='saved');assert.equal(await page.locator('#financeTotal').inputValue(),'');assert.equal(await page.locator('#financePaid').getAttribute('required'),'');assert.match(await page.locator('.savings-hero-value').innerText(),/24.89/);
 await page.locator('[data-finance-action="redo-receipt"]').click();await page.waitForFunction(()=>document.querySelector('#financeTotal')?.value==='16.21');assert.equal((await decrypt()).events.at(-1).historyAction,'redo');
 // Cash and original data survive a receipt-only reset; cancel is harmless.
 await leaveReceiptEditor(page);await page.locator('[data-finance-panel="cash"] > summary').click();await page.locator('#financeBalance').fill('12');await page.locator('[data-finance-form="cash"] button[type="submit"]').click();await page.waitForFunction(()=>document.querySelector('[data-finance-feedback="cash"]')?.dataset.state==='saved');
 await openFinanceHistory(page);
 assert.equal(await page.locator('[data-finance-action="reset-receipts"]').count(),1);
 assert.equal(await page.locator('[data-finance-panel="history"] .sheet-row').count(),4,'Saved history remains visible');
 const retained=await decrypt();assert.equal(retained.events.length,4);assert.deepEqual(retained.receipts,transfer.receipts);assert.deepEqual(retained.accounts,transfer.accounts);assert.equal(retained.events[0].value.total,16.21);assert.equal(retained.events[3].value.balance,12);assert.match(await page.locator('.savings-hero-value').innerText(),/41.10/);assert.equal(await page.locator('#savedStat').innerText(),'£24.89','Viewing private history cannot change published Mac totals');
 assert.equal(await page.locator('#financeBalance').inputValue(),'12');
 await page.locator('[data-finance-action="reset-receipts"]').click();if(process.env.TRACKER_SCREENSHOT_DIR&&width===390){await page.locator('[data-finance-action="confirm-reset-receipts"]').scrollIntoViewIfNeeded();await page.screenshot({path:process.env.TRACKER_SCREENSHOT_DIR+'/04-receipt-only-reset.png'});}await page.locator('[data-finance-action="cancel-reset-receipts"]').click();assert.equal((await decrypt()).events.length,4);
 await page.locator('[data-finance-action="reset-receipts"]').click();await page.locator('[data-finance-action="confirm-reset-receipts"]').click();await page.waitForFunction(()=>document.querySelector('[data-finance-feedback="history"]')?.dataset.state==='saved');const reset=await decrypt();assert.equal(reset.events.length,1);assert.equal(reset.events[0].kind,'cash');assert.deepEqual(reset.receipts,transfer.receipts);assert.deepEqual(reset.accounts,transfer.accounts);assert.match(await page.locator('.savings-hero-value').innerText(),/24.89/);assert.equal(await page.locator('#financeBalance').inputValue(),'12');assert.match(await page.locator('[data-finance-feedback="history"]').innerText(),/Receipt corrections cleared/);assert.equal(await page.locator('[data-finance-action="reset-receipts"]').count(),0);
 await page.keyboard.press('Escape');await page.locator('[data-view="accounts"]').click();await page.locator('#accountsList [data-finance-account="A001"]').first().click();await page.locator('[data-ri-review=needs]').waitFor();assert.equal(await page.locator('[data-ri-receipt]').count(),3,'Banner shares the missing-payment and adjustment review list');await page.locator('[data-ri-receipt=rcp_adjusted]').click();await page.locator('[data-check-form]').waitFor();assert.equal(await page.locator('#sheetTitle').innerText(),'Check receipt');await fields(page);await page.locator('[data-check-cancel]').click();await page.locator('#sheetBackdrop.open').waitFor({state:'hidden'});
 // Legacy monetary edits remain available; incomplete payment/refund details
 // stay in the shared review set. Undo/redo continues to target the saved ID.
 await page.locator('[data-view=more]').click();await page.locator('#view-more [data-open-sheet=finance]').click();await page.locator('.finance-page [data-finance-target=history]').click();await page.locator('[data-finance-panel="receipt"] > summary').click();await page.locator('[data-finance-action="change-receipt"]').click();await page.locator('#financeMissingOnly').check();await page.locator('#financeReceipt').selectOption('rcp_adjusted');
 await page.locator('#financeTotal').fill('12');await openReceiptPayments(page);await page.locator('#financePaid').fill('0');await page.locator('[data-finance-form="receipt"] button[type="submit"]').click();await page.waitForFunction(()=>document.querySelector('[data-finance-feedback="receipt"]')?.dataset.state==='saved');assert.equal(await page.locator('#financeReceipt option').count(),3,'Savings alone do not resolve missing Cash/refund details');assert.equal(await page.locator('[data-finance-action="undo-receipt"]').isEnabled(),true);
 await page.locator('[data-finance-action="undo-receipt"]').click();await page.waitForFunction(()=>document.querySelector('#financeReceipt')?.value==='rcp_adjusted');assert.equal(await page.locator('#financeReceipt option').count(),3);
 await page.locator('[data-finance-action="redo-receipt"]').click();await page.waitForFunction(()=>document.querySelector('#financeTotal')?.value==='12');assert.equal((await decrypt()).events.at(-1).recordId,'rcp_adjusted');assert.equal((await decrypt()).events.at(-1).historyAction,'redo');
 await fields(page);assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
 await context.close();
 }
 console.log('✓ Mobile/touch fields ≥16px, large amounts preserved, pinch zoom enabled; receipt-style breakdown, visible save/error feedback, draft/search/scroll preservation, durable undo/redo, refund review and receipt-only reset preserving Cash and originals ('+name+')');
}finally{await browser.close();server.close();}
