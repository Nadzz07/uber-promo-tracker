import {openHomeDetail,usedStatus,openOfferManagement} from './test-browser-navigation.js';
// Verify decision boundaries and local privacy through the refined sheets.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {execFileSync} from 'node:child_process';
import {chromium,webkit,firefox} from 'playwright';
execFileSync(process.execPath,['build-site.js']);
const stamp=new Date().toISOString();
const account={accountRef:'A001',accountMasked:'te…01@example.invalid',canLogin:true,accountStatus:'active',orderCount:1,rideCount:1};
const offer={id:'sitewide-offer',...account,service:'Uber Eats',discountType:'fixed',discount:12,minimumSpend:15,uses:5,usesRemaining:4,receiptConfirmedUses:1,usesVerified:true,firstEmailSentAt:stamp,emailSentAt:stamp,expiresAt:new Date(Date.now()+10*86400000).toISOString(),expiryStatus:'exact'};
const importAccounts=Array.from({length:8},(_,i)=>i?{...account,accountRef:'A00'+(i+1),accountMasked:'te…0'+(i+1)+'@example.invalid',orderCount:0,rideCount:0}:account);
const snapshot={accounts:importAccounts,promos:[offer],generatedAt:stamp,sync:{lastSuccessfulMailScanAt:stamp},summary:{totalSaved:12,trackedOrders:1,trackedRides:1},receiptActivity:{months:[{period:'2026-10',eats:1,rides:1,saved:12}],days:[]}};
const files=new Set(fs.readdirSync('dist'));
const server=http.createServer((req,res)=>{
 const name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
 if(!files.has(name)){res.writeHead(404).end();return;}
 res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.json')?'application/json':name.endsWith('.css')?'text/css':'text/html');
 res.end(name==='promos.json'?JSON.stringify(snapshot):name==='history.json'?JSON.stringify({updatedAt:stamp,records:[offer]}):fs.readFileSync('dist/'+name));
});server.listen(0,'127.0.0.1');await once(server,'listening');
const name=process.env.TRACKER_BROWSER_ENGINE||'chromium',browser=await{chromium,webkit,firefox}[name].launch();
try{
 for(const width of [320,390,1440]){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('uber-eats-promo-tracker:offer-preferences:v1',JSON.stringify({defaultView:'all',selection:'all'})));await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>document.getElementById('scanLabel').textContent==='Up to date');
  const saved=await page.locator('#savedStat').innerText();
  await openHomeDetail(page,'planner');await page.locator('[data-open-sheet="advanced"]:visible').click();
  assert.equal(await page.locator('#sheetFeeInput').inputValue(),'1.00','Default extra-order estimate remains £1');
  await page.locator('#sheetFeeInput').fill('0');
  let settings=await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.includes('planner')).map(k=>JSON.parse(localStorage.getItem(k))).find(v=>'feeTouched' in v));
  assert.equal(settings.feeTouched,true);assert.equal(settings.extraOrderFee,0,'Explicit zero is a known fee');
  await page.locator('#sheetFeeInput').fill('');
  settings=await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.includes('planner')).map(k=>JSON.parse(localStorage.getItem(k))).find(v=>'feeTouched' in v));
  assert.equal(settings.extraOrderFee,null);assert.equal(settings.feeTouched,false,'Clearing a fee restores the default estimate');
  await page.keyboard.press('Escape');await page.locator('[data-view="more"]').click();
  await page.locator('#view-more [data-open-sheet="device"]').click();
  const file={name:'test.local.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({schemaVersion:1,kind:'uber-tracker-device-accounts',accounts:importAccounts.map((a,i)=>({...a,email:'testing-private-0'+(i+1)+'@example.invalid'}))}))};
  const requests=[];page.on('request',r=>requests.push({url:r.url(),method:r.method()}));
  await page.locator('#deviceAccountsFile').setInputFiles(file);await page.locator('[data-apply-device-import]').waitFor();
  assert.match(await page.locator('.import-access').first().innerText(),/Can log in/);
  assert.equal(await page.locator('.import-entry').count(),6,'A large preview starts with six entries');
  await page.locator('[data-show-import-entries]').click();assert.equal(await page.locator('.import-entry').count(),8,'Every entry remains available for review');assert.equal(await page.locator('.import-entry').nth(6).evaluate(el=>document.activeElement===el),true,'Keyboard focus follows the first added entry');
  assert.equal(await page.evaluate(()=>localStorage.getItem('uber-eats-promo-tracker:device-accounts:v1')),null,'Preview cannot persist identities');
  await page.locator('[data-cancel-device-import]').click();
  assert.equal(await page.evaluate(()=>localStorage.getItem('uber-eats-promo-tracker:device-accounts:v1')),null,'Cancel preserves storage');
  await page.locator('#deviceAccountsFile').setInputFiles(file);await page.locator('[data-apply-device-import]').click();
  assert.match(await page.locator('#deviceImportStatus').innerText(),/8 emails imported/);assert.equal(requests.length,0,'Review and apply stay entirely local');
  assert.equal(await page.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('uber-eats-promo-tracker:device-accounts:v1'))).length),8,'Apply includes entries beyond the visible preview');
  await page.keyboard.press('Escape');await page.locator('[data-view="accounts"]').click();if(await page.locator("#view-home.active").count())await openHomeDetail(page,'offers');await page.locator('#accountsList [data-account-offers="A001"]').click();
  await openOfferManagement(page);await page.locator('[data-toggle-ignore][data-ignore="true"]').click();await page.locator('[data-cancel-offer-action]').click();
  assert.equal(await page.locator('[data-toggle-ignore][data-ignore="false"]').count(),0,'Cancel must not ignore');
  await openOfferManagement(page);await page.locator('[data-toggle-ignore][data-ignore="true"]').click();await page.locator('[data-confirm-offer-action]').click();
  assert.equal(await page.locator('[data-toggle-ignore][data-ignore="false"]').count(),1);await openOfferManagement(page);await page.locator('[data-toggle-ignore][data-ignore="false"]').click();
  await openOfferManagement(page);await page.locator('[data-mark-offer-done][data-done="true"]').click();await page.locator('[data-cancel-offer-action]').click();
  assert.equal(await page.locator('[data-mark-offer-done][data-done="false"]').count(),0);
  await openOfferManagement(page);await page.locator('[data-mark-offer-done][data-done="true"]').click();await page.locator('[data-confirm-offer-action]').click();
  assert.match(await page.locator('.offer-card .use-line').innerText(),/1 of 5 uses receipt-confirmed/);
  await page.keyboard.press('Escape');await page.locator('[data-view="used"]').click();
  assert.equal(await page.locator('#usedAccountCount').innerText(),'1');await usedStatus(page,'manual');assert.equal(await page.locator('#usedResultsCount').innerText(),'1 promotion');await usedStatus(page,'completed');assert.equal(await page.locator('#usedResultsCount').innerText(),'0 promotions');
  assert.equal(await page.locator('#savedStat').innerText(),saved,'Visual actions cannot alter savings');
  await page.locator('[data-view="more"]').click();await page.locator('#view-more [data-open-sheet="appearance"]').click();await page.locator('[data-open-sheet="theme"]').click();await page.locator('[data-theme-colour="#c5a0ff"]').click();await page.keyboard.press('Escape');await page.locator('[data-settings-back]').click();await page.locator('#view-more [data-open-sheet="receipts"]').click();
  assert.equal(await page.locator('.finance-heading-icon').evaluate(el=>getComputedStyle(el).color),'rgb(197, 160, 255)');
  assert.ok(await page.locator('.insights-hero').evaluate(el=>getComputedStyle(el).backgroundImage==='none'&&getComputedStyle(el).backgroundColor===getComputedStyle(document.documentElement).getPropertyValue('--color-selected').trim().replace(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i,(_,r,g,b)=>'rgb('+[r,g,b].map(v=>parseInt(v,16)).join(', ')+')')),'Matte Receipt insights follows the shared selected-surface token');
  assert.equal(await page.locator('.receipt-record-metric strong').first().innerText(),'2','Receipt records retain the actual combined service count');
  assert.equal(await page.locator('.receipt-record-summary > p').innerText(),'1 Eats · 1 Ride','Service counts remain visible');
  assert.equal(await page.locator('#sheetBody .monthly-track > span').count(),1,'Chart follows actual month records');
  assert.equal(await page.locator('#sheetBody .empty').filter({hasText:'Receipt activity will appear'}).count(),1,'Receipt empty state is available');
  assert.ok(await page.locator('.sheet').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
  await page.keyboard.press('Escape');await page.locator('#view-more [data-open-sheet="savings"]').click();
  const heroColours=await page.locator('.finance-hero').evaluate(el=>({surface:getComputedStyle(el).backgroundImage,reflection:getComputedStyle(el,'::before').content}));
  assert.equal(heroColours.surface,'none');assert.equal(heroColours.reflection,'none','Savings uses the matte system without a curved reflection');
  await page.keyboard.press('Escape');await page.locator('[data-view="home"]').click();
  assert.ok(await page.locator('.total-saved-card').evaluate(el=>getComputedStyle(el).backgroundImage==='none'&&getComputedStyle(el,'::before').content==='none'),'Home shares the matte Savings material');
  assert.ok(await page.locator('.home-overview').evaluate(el=>el.querySelector('.total-saved-card').getBoundingClientRect().top<el.querySelector('.home-intro').getBoundingClientRect().top),'Savings leads the overview');
  const homeHeroHeight=await page.locator('.total-saved-card').evaluate(el=>el.getBoundingClientRect().height);
  assert.ok(homeHeroHeight<=170,'Home savings keeps compact preview proportions: '+name+' / '+width+' / '+homeHeroHeight);
  await page.locator('[data-view="used"]').click();
  assert.equal(await page.locator('.activity-card,#view-used > details').count(),0,'Old metric and category-menu presentation is removed');assert.equal(await page.locator('#usedStatusOptions [role=option]').count(),8,'Every existing status group remains available');assert.ok(await page.locator('.used-summary').evaluate(e=>e.scrollWidth<=e.clientWidth+1));
  await page.locator('[data-view="more"]').click();
  await page.keyboard.press('Escape');await page.locator('#view-more [data-open-sheet="device"]').click();
  await page.locator('#deviceAccountsFile').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{}')});await page.waitForFunction(()=>document.getElementById('deviceImportStatus').textContent.includes('Choose a tracker'));assert.match(await page.locator('#deviceImportStatus').innerText(),/Choose a tracker/);
  if(width<768){
   await page.evaluate(()=>{const viewport=window.visualViewport;Object.defineProperty(viewport,'height',{configurable:true,value:420});Object.defineProperty(viewport,'offsetTop',{configurable:true,value:0});viewport.dispatchEvent(new Event('resize'));});
   assert.ok(await page.locator('.sheet').evaluate(el=>el.getBoundingClientRect().bottom<=421),'Sheet remains above an emulated keyboard viewport');
  }
  assert.deepEqual(errors,[]);await page.close();

  // Reference layout with real-shaped totals: no illustrative counts, dates or filters.
  const populated={...snapshot,summary:{...snapshot.summary,financialBreakdown:{missing:1}},receiptActivity:{months:[
   {period:'2025-12',eats:1,rides:0,saved:0},{period:'2026-01',eats:0,rides:1,saved:28.86},
   {period:'2026-02',eats:0,rides:1,saved:42.44},{period:'2026-03',eats:0,rides:1,saved:573.64},
   {period:'2026-04',eats:0,rides:1,saved:95.76},{period:'2026-05',eats:0,rides:1,saved:110.97}],
   days:Array.from({length:5},(_,i)=>({period:'2026-10-0'+(9-i),eats:i===0?1:0,rides:1,saved:i*3,dateFallbacks:i===4?1:0}))}};
  const populatedPage=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
  await populatedPage.route('**/promos.json*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(populated)}));
  await populatedPage.addInitScript(()=>localStorage.setItem('uber-eats-promo-tracker:offer-preferences:v1',JSON.stringify({defaultView:'all',selection:'all'})));await populatedPage.goto('http://127.0.0.1:'+server.address().port);await populatedPage.waitForFunction(()=>document.getElementById('scanLabel').textContent==='Up to date');
  await populatedPage.locator('[data-view="accounts"]').click();
  assert.equal(await populatedPage.locator('#accountsTotal').innerText(),'8');assert.equal(await populatedPage.locator('#accountsAccessible').innerText(),'8');
  await populatedPage.locator('.accounts-stat [data-metric-label="Total accounts"]').click();
  assert.match(await populatedPage.locator('#sheetBody').innerText(),/Every tracked account/);await populatedPage.keyboard.press('Escape');
  await populatedPage.locator('.accounts-stat [data-metric-label="Can log in"]').click();
  assert.match(await populatedPage.locator('#sheetBody').innerText(),/separate from usage and archive/);await populatedPage.keyboard.press('Escape');
  await populatedPage.locator('[data-view="more"]').click();await populatedPage.locator('#view-more [data-open-sheet="receipts"]').click();
  assert.match(await populatedPage.locator('.insights-hero strong').innerText(),/851\.67/);
  assert.equal(await populatedPage.locator('#sheetBody .monthly-track > span').count(),6);
  const widths=await populatedPage.locator('#sheetBody .monthly-track').evaluateAll(tracks=>tracks.map(t=>({bar:t.firstElementChild.getBoundingClientRect().width,track:t.getBoundingClientRect().width})));
  assert.equal(widths[5].bar,0,'Zero savings remains zero');
  assert.ok(Math.abs(widths[2].bar-widths[2].track)<1,'The largest actual amount fills the old horizontal bar');
  assert.ok(Math.abs(widths[1].bar/widths[1].track-95.76/573.64)<.01,'Horizontal bars retain proportional savings');
  assert.match(await populatedPage.locator('#sheetBody .monthly-label').last().innerText(),/Dec 25/,'Month labels retain their years');
  assert.match(await populatedPage.locator('#sheetBody .monthly-value').nth(2).innerText(),/573\.64/,'Exact amounts remain readable beside the bars');
  const heroHeight=await populatedPage.locator('.insights-hero').evaluate(el=>el.getBoundingClientRect().height);
  assert.ok(heroHeight<=(width<768?140:150),'Receipt hero keeps the reference proportions: '+name+' / '+width+' / '+heroHeight);
  assert.ok(await populatedPage.locator('.insights-chart-card').evaluate(el=>el.getBoundingClientRect().height<=270),'Horizontal chart stays compact across responsive widths');
  assert.equal(await populatedPage.locator('.receipt-record-metric strong').last().innerText(),'1');
  assert.equal(await populatedPage.locator('.receipt-activity-card:visible').count(),3,'Recent activity has the approved short preview');
  await populatedPage.locator('.receipt-activity-more > summary').click();
  assert.equal(await populatedPage.locator('.receipt-activity-card:visible').count(),5,'View all preserves every available daily record');
  assert.match(await populatedPage.locator('.receipt-activity-list').last().innerText(),/email-date fallback/,'Date qualifications remain visible');
  assert.ok(await populatedPage.locator('.sheet').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Approved insight cards cannot overflow');
  assert.equal(await populatedPage.locator('.insights-chart-card select').count(),0,'No nonfunctional illustrative range control');
  await populatedPage.locator('.receipt-record-metric[data-open-sheet="finance"]').click();
  await populatedPage.locator('.finance-empty').waitFor();
  assert.equal(await populatedPage.locator('#sheetTitle').innerText(),'Private finances','Missing details uses the existing private corrections route');
  await populatedPage.close();
 }
 console.log('✓ Sitewide sheets: unknown/zero fees, preview/cancel/private apply, ignore/manual decisions, independent receipt states, theme propagation, empty/error and keyboard viewport ('+name+')');
}finally{await browser.close();server.close();}
