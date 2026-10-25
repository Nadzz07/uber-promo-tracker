import {directoryType,directoryAvailability} from './test-browser-navigation.js';
import {importPrivateFinance} from './test-browser-navigation.js';

// Layout/navigation regression with synthetic private data only.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {execFileSync} from 'node:child_process';
import {chromium,webkit,firefox} from 'playwright';
execFileSync(process.execPath,['build-site.js']);
const stamp=new Date().toISOString(),emails=['a.long.private.account.label.for.layout@example.invalid','second@example.invalid'];
const accounts=emails.map((email,i)=>({accountRef:'A'+(901+i),accountMasked:(email.split('@')[0].slice(0,2)+'…'+email.split('@')[0].slice(-2))+'@example.invalid',canLogin:true,accountStatus:'active',orderCount:0,rideCount:0}));
const promos=accounts.map(a=>({...a,id:'preview-'+a.accountRef,service:'Uber Eats',discountType:'fixed',discount:12,minimumSpend:15,uses:5,usesVerified:true,usesRemaining:5,receiptConfirmedUses:0,firstEmailSentAt:stamp,emailSentAt:stamp,expiresAt:new Date(Date.now()+864000000).toISOString(),expiryStatus:'exact'}));
const snapshot={accounts,promos,generatedAt:stamp,sync:{lastSuccessfulMailScanAt:stamp},summary:{totalSaved:24.89,trackedOrders:2,trackedRides:1},receiptActivity:{months:[{period:'2026-09',saved:16.95,eats:2,rides:0},{period:'2026-10',saved:7.94,eats:0,rides:1}],days:[]}};
const transfer={kind:'uber-tracker-private-finance',schemaVersion:1,accounts:accounts.map(a=>({accountRef:a.accountRef})),receipts:[{receiptId:'receipt-original',accountRef:'A901',service:'Uber',sentAt:'2026-10-09T17:07:00Z',promotionDiscount:7.94,total:0}],events:[{id:'previous-correction',kind:'receipt',recordId:'receipt-original',accountRef:'A901',action:'set',at:'2026-10-13T11:40:00Z',value:{total:7.94,outOfPocket:0}}]};
const files=new Set(fs.readdirSync('dist'));let writes=0;
const server=http.createServer((req,res)=>{if(req.method!=='GET')writes++;const file=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';if(!files.has(file)){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html');res.end(file==='promos.json'?JSON.stringify(snapshot):file==='history.json'?JSON.stringify({updatedAt:stamp,records:promos}):fs.readFileSync('dist/'+file));});
server.listen(0,'127.0.0.1');await once(server,'listening');
const name=process.env.TRACKER_BROWSER_ENGINE||'chromium',browser=await{chromium,webkit,firefox}[name].launch(),url='http://127.0.0.1:'+server.address().port;
const output=process.env.TRACKER_SCREENSHOT_DIR;
if(output)fs.mkdirSync(output,{recursive:true,mode:0o700});
try{for(const [width,height,largeText] of [[390,844,false],[430,932,false],[1440,1000,false],[320,568,false],[390,844,true]]){
 const context=await browser.newContext({viewport:{width,height},hasTouch:width<980,reducedMotion:'reduce',timezoneId:'Europe/London'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>{errors.push(e.message);console.log('Page error: '+e.message);});
 await context.addInitScript(({accounts,emails})=>localStorage.setItem('uber-eats-promo-tracker:device-accounts:v1',JSON.stringify(Object.fromEntries(accounts.map((a,i)=>[a.accountRef,{email:emails[i],accountMasked:a.accountMasked}])))),{accounts,emails});
 await page.goto(url);await page.waitForFunction(()=>document.getElementById('scanLabel').textContent==='Up to date');
 if(output&&!largeText&&[430,1440].includes(width)){
  await page.locator('[data-view="more"]').click();await page.locator('[data-open-sheet="appearance"]').click();await page.locator('[data-open-sheet="theme"]').click();await page.locator('[data-theme-colour="#ffc778"]').click();await page.keyboard.press('Escape');await page.locator('[data-view="home"]').click();
  assert.ok(await page.locator('.total-saved-card').evaluate(e=>getComputedStyle(e).backgroundImage.includes('255, 199, 120')),'Home follows the selected Amber theme');
 }
 if(largeText)await page.addStyleTag({content:`
  body {font-family:Arial,sans-serif}
  #app .brand-title {font-size:34px!important}
  #app .scan-time,#app .scan-pill {font-size:18px!important}
  #app .stat-label,#app .home-action-row small {font-size:18px!important}
  #app .stat-value {font-size:43px!important}
  #app .home-action-row strong,#app .account-email {font-size:22px!important}
  #app .detail-view-head h1 {font-size:40px!important}
  #sheetBody .sheet-help,#sheetBody .sheet-row-meta,#sheetBody .finance-history-date {font-size:18px!important}
  #sheetBody label {font-size:20px!important}
  #sheetBody .finance-card-heading {font-size:24px!important}
  #sheetBody .sheet-row-title,#sheetBody [data-finance-account-label] {font-size:21px!important}
  #sheetBody input,#sheetBody select,#sheetBody textarea {--mobile-field-size:24px;font-size:24px!important}
 `});
 assert.equal(await page.locator('#view-home .account-card').count(),0);
 assert.equal(await page.locator('#view-home #basketInput').count(),0);
 assert.equal(await page.locator('#view-home #quickGrid').count(),0);
 assert.deepEqual(await page.locator('#view-home .stat-label').allTextContents(),['Total saved','Total accounts','Accounts available','Can log in','Archived']);
 assert.equal(await page.locator('#homeReadyCount').innerText(),'2 ready to use');
 assert.equal(await page.locator('#view-home').evaluate(e=>getComputedStyle(e).animationName),'none','Reduced motion disables view entry animation');
 const overflow=await page.evaluate(()=>({fits:document.documentElement.scrollWidth<=innerWidth,items:[...document.querySelectorAll('#view-home *, .topbar *')].filter(e=>e.getClientRects().length&&e.getBoundingClientRect().right>innerWidth+1).map(e=>({tag:e.tagName,class:e.className,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right}))}));
 assert.ok(overflow.fits,'Home overflow at '+width+' / larger text '+largeText+' '+JSON.stringify(overflow.items));
 const copy=await page.locator('#view-home .stats-row .stat-card').evaluateAll(cards=>cards.map(c=>{const box=c.getBoundingClientRect();return {width:box.width,height:box.height,offset:[...c.querySelectorAll('.stat-label,.stat-value,.stat-sub')].map(e=>e.getBoundingClientRect().left-box.left)};}));
 assert.ok(copy.every(c=>Math.max(...c.offset)-Math.min(...c.offset)<1),'Each metric caption, label and value share the reference inset');
 // Reserved scrollbars reduce the usable canvas; system fonts may wrap a caption.
 if(width===430&&!largeText){const canvas=await page.evaluate(()=>document.documentElement.clientWidth);assert.ok(copy.every(c=>Math.abs(c.width-(canvas-50)/2)<2&&c.height>=114&&Math.abs(c.offset[0]-58)<2),'Home metrics retain the reference width and inset without clipping wrapped text: '+JSON.stringify({canvas,copy}));}
 if(output&&!largeText&&[430,1440].includes(width))await page.screenshot({path:output+'/'+name+'-'+width+'-home.png',fullPage:width>=980});
 if(width===390&&!largeText){assert.ok(await page.locator('#homeAnalytics').evaluate(e=>e.getBoundingClientRect().bottom<innerHeight+100),'Overview allows little natural scrolling on typical iPhone viewport');}
 const find=page.locator('[data-home-detail="offers"]').first();await find.focus();await page.keyboard.press('Enter');await page.locator('#view-accounts.active').waitFor();
 assert.equal(await page.locator('[data-view="accounts"]').getAttribute('aria-current'),'page');
 await page.keyboard.press('Escape');await page.locator('#accountSearch').fill('second');assert.equal(await page.locator('#accountsList .account-card').count(),1);
 await directoryAvailability(page,'all');await directoryType(page,'fixed:12:15');
 await page.goBack();await page.locator('#view-home.active').waitFor();assert.ok(await find.evaluate(e=>e===document.activeElement),'Back restores the opening row');
 await find.click();assert.equal(await page.locator('#accountSearch').inputValue(),'second');assert.equal(await page.locator('#accountOfferScope').inputValue(),'all');assert.equal(await page.locator('[data-preferred-filter="fixed:12:15"]').getAttribute('aria-pressed'),'true');await page.keyboard.press('Escape');
 await page.locator('[data-view=home]').click();await page.locator('#view-home [data-home-detail="planner"]').click();await page.locator('#basketInput').fill('30');await page.locator('#plannerFulfilment').selectOption('pickup');await page.waitForFunction(()=>document.getElementById('homePlannerSummary').textContent==='Basket £30 · Pickup');
 const result=await page.locator('#recommendation').innerText();await page.locator('[data-open-sheet="advanced"]:visible').click();await page.goBack();await page.waitForFunction(()=>document.getElementById('sheetBackdrop').getAttribute('aria-hidden')==='true');assert.ok(await page.locator('#view-planner').isVisible());
 await page.goBack();await page.locator('#view-home.active').waitFor();await page.goForward();await page.locator('#view-planner.active').waitFor();assert.equal(await page.locator('#basketInput').inputValue(),'30');assert.equal(await page.locator('#plannerFulfilment').inputValue(),'pickup');assert.equal(await page.locator('#recommendation').innerText(),result);
 if(output&&!largeText&&[430,1440].includes(width))await page.screenshot({path:output+'/'+name+'-'+width+'-planner.png',fullPage:true});
 await page.locator('#view-planner [data-home-back]').click();await page.locator('#view-home.active').waitFor();assert.equal(await page.locator('#homePlannerSummary').innerText(),'Basket £30 · Pickup');
 await page.locator('#view-home [data-home-detail="planner"]').click();assert.equal(await page.locator('#recommendation').innerText(),result);
 // Explicitly choosing an account resets discovery filters so a previous
 // search cannot hide that chosen account; ordinary view switches retain it.
 assert.equal(await page.locator('.plan-accounts .plan-row').count(),0,'Ordinary Delivery promos are absent from Pickup');await page.locator('#plannerFulfilment').selectOption('delivery');await page.locator('#recommendation [data-account-offers="A901"]').click();await page.locator('[data-use-this-account="A901"]').click();await page.locator('#view-accounts.active').waitFor();assert.equal(await page.locator('#accountSearch').inputValue(),'second','Account usage navigation preserves the shared search');assert.equal(await page.locator('#basketInput').inputValue(),'30');assert.equal(await page.locator('#plannerFulfilment').inputValue(),'delivery');
 await page.locator('[data-view="home"]').click();await page.locator('#homeAnalytics button').click();assert.equal(await page.locator('.ri-paid-card').count(),1);assert.equal(await page.locator('.ri-range').inputValue(),'month');assert.equal(await page.locator('.ri-activity').count(),1);await page.locator('[data-receipts-back]').click();
 await importPrivateFinance(page,{name:'preview-finance.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(transfer))});await page.locator('#sheetClose').click();await page.locator('[data-view=accounts]').click();await page.locator('#accountSearch').fill('');await directoryType(page,'all');await page.locator('#accountsList [data-account-offers=A901]').first().click();await page.locator('[data-cash-entry]>summary').click();await page.locator('.cash-balance-editor>summary').click();await page.locator('[name=balance]').fill('12');await page.locator('.cash-balance-editor form > details > summary').first().click();await page.locator('[name=basketSubtotal]').fill('30');await page.locator('[name=checkoutFees]').fill('0');await page.locator('[name=stacking]').selectOption('unsupported');await page.locator('[data-cash-balance-form] button[type=submit]').click();await page.waitForFunction(()=>document.querySelector('.cash-entry-balance')?.textContent==='£12.00');
 const decrypt=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('uber-tracker-finance-encrypted-v1')).data);assert.deepEqual((await decrypt()).receipts,transfer.receipts);assert.equal((await decrypt()).events.at(-1).value.checkoutFees,0);
 await page.locator('[data-balance-history=undo]').click();await page.locator('[data-balance-history=redo]').click();await page.waitForFunction(()=>document.querySelector('.cash-entry-balance')?.textContent==='£12.00');
 // Transfer and encrypted backup must retain exact records; no network writes.
 await page.locator('#sheetClose').click();await page.locator('[data-view=more]').click();await page.locator('#view-more [data-open-sheet=health]').click();await page.locator('#privateDataTools').getByText('Encrypted transfer & backup',{exact:true}).click();await page.locator('#financeExportPassword').fill('preview test passphrase');
 const download=page.waitForEvent('download');await page.locator('[data-finance-form=backup] button').click();const file=await download,value=JSON.parse(fs.readFileSync(await file.path(),'utf8'));const restored=await page.evaluate(async v=>(await import('./private-finance-vault.js')).decryptFinance(v,'preview test passphrase'),value);assert.deepEqual(restored.events,(await decrypt()).events);assert.deepEqual(restored.receipts,transfer.receipts);
 const final=(await decrypt()).events;await importPrivateFinance(page,{name:'roundtrip.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(await decrypt()))});assert.deepEqual((await decrypt()).events,final);
 await page.keyboard.press('Escape');await page.locator('[data-view="home"]').click();await page.locator('[data-home-detail="planner"]').first().click();await page.locator('#plannerFulfilment').selectOption('pickup');assert.equal(await page.locator('.plan-cost-line.discount strong').innerText(),'−£0.00');assert.match(await page.locator('.plan-costs').innerText(),/Cash applied · verified/);assert.equal(await page.locator('.recommendation-save').innerText(),'£18.00\nIncluding estimated fees','Recorded zero fees replace the estimate and verified Cash pays Pickup without a coupon');await page.locator('#plannerFulfilment').selectOption('delivery');assert.ok(await page.locator('.plan-accounts .plan-row').count()>0);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 if(width<980){assert.ok((await page.locator('input,select,textarea').evaluateAll(fields=>fields.map(e=>parseFloat(getComputedStyle(e).fontSize)))).every(n=>n>=16));assert.ok(!/maximum-scale|user-scalable=no/.test(await page.locator('meta[name="viewport"]').getAttribute('content')));}
 assert.deepEqual(errors,[]);await context.close();
}assert.equal(writes,0);console.log('✓ Compact Home, Back/Forward/focus and persistent filters/planner; private Cash blank/zero, account drafts, explicit coverage, fees, save/reopen/undo/redo/history and encrypted transfer roundtrip; 5 sizes/text configurations ('+name+')');
}finally{await browser.close();server.close();}
