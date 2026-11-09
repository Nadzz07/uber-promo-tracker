import {navigate,openMoreDestination} from './test-browser-navigation.js';
import {openHomeDetail,directoryReset,directoryStatus,openOfferManagement} from './test-browser-navigation.js';
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
 for(const width of [320,390,440,1440]){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('uber-eats-promo-tracker:offer-preferences:v1',JSON.stringify({defaultView:'all',selection:'all'})));await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>document.getElementById('scanLabel').textContent==='Updated');
  const saved=await page.locator('#savedStat').innerText();
  await openHomeDetail(page,'planner');
  assert.equal(await page.locator('#plannerFeeInput').inputValue(),'1.00','Default extra-order estimate remains £1');
  await page.locator('#plannerFeeInput').fill('0');
  let settings=await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.includes('planner')).map(k=>JSON.parse(localStorage.getItem(k))).find(v=>'feeTouched' in v));
  assert.equal(settings.feeTouched,true);assert.equal(settings.extraOrderFee,0,'Explicit zero is a known fee');
  await page.locator('#plannerFeeInput').fill('');
  settings=await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.includes('planner')).map(k=>JSON.parse(localStorage.getItem(k))).find(v=>'feeTouched' in v));
  assert.equal(settings.extraOrderFee,0);assert.match(await page.locator('#recommendation').innerText(),/Enter a valid/);await page.locator('#plannerFeeInput').fill('1');
  await page.keyboard.press('Escape');await openMoreDestination(page,'health');await page.locator('[data-account-import]').click();
  const file={name:'test.local.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({schemaVersion:1,kind:'uber-tracker-device-accounts',accounts:importAccounts.map((a,i)=>({...a,email:'testing-private-0'+(i+1)+'@example.invalid'}))}))};
  const requests=[];page.on('request',r=>requests.push({url:r.url(),method:r.method()}));
  await page.locator('.receipt-import-dialog[open] [data-receipt-import-file]').setInputFiles(file);await page.locator('.receipt-import-dialog[open] [data-rim-confirm]').waitFor();
  assert.equal(await page.locator('.rim-change').count(),8,'All proposed entries are accessible');await page.locator('.rim-view-all').click();
  assert.equal(await page.evaluate(()=>localStorage.getItem('uber-eats-promo-tracker:device-accounts:v1')),null,'Preview cannot persist identities');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  assert.equal(await page.evaluate(()=>localStorage.getItem('uber-eats-promo-tracker:device-accounts:v1')),null,'Cancel preserves storage');
  await page.locator('[data-account-import]').click();await page.locator('.receipt-import-dialog[open] [data-receipt-import-file]').setInputFiles(file);await page.locator('.receipt-import-dialog[open] [data-rim-confirm]').click();
  await page.getByText('Import accounts complete.',{exact:true}).waitFor();assert.equal(requests.length,0,'Review and apply stay entirely local');
  assert.equal(await page.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('uber-eats-promo-tracker:device-accounts:v1'))).length),8,'Apply includes entries beyond the visible preview');
  await page.keyboard.press('Escape');await navigate(page,'accounts');if(await page.locator("#view-home.active").count())await openHomeDetail(page,'offers');await page.locator('#accountsList [data-account-offers="A001"]').click();
  await openOfferManagement(page);await page.locator('[data-toggle-ignore][data-ignore="true"]').click();await page.locator('[data-cancel-offer-action]').click();
  assert.equal(await page.locator('[data-toggle-ignore][data-ignore="false"]').count(),0,'Cancel must not ignore');
  await openOfferManagement(page);await page.locator('[data-toggle-ignore][data-ignore="true"]').click();await page.locator('[data-confirm-offer-action]').click();
  assert.equal(await page.locator('[data-toggle-ignore][data-ignore="false"]').count(),1);await openOfferManagement(page);await page.locator('[data-toggle-ignore][data-ignore="false"]').click();
  await openOfferManagement(page);await page.locator('[data-remove-offer]').click();await page.locator('.offer-edit-dialog [data-cancel]').click();assert.equal(await page.locator('[data-mark-offer-done][data-done="false"]').count(),0);
  await page.evaluate(async offer=>{const m=await import('./manual-state.js'),key='uber-eats-promo-tracker:manual-state:v3',store=m.normaliseManualStore(JSON.parse(localStorage.getItem(key)||'{}'));localStorage.setItem(key,JSON.stringify(m.setOfferDone(store,offer,true)));dispatchEvent(new StorageEvent('storage',{key}));},offer);
  assert.match(await page.locator('.offer-card .use-line').innerText(),/1 of 5 orders completed/);
  await page.keyboard.press('Escape');await navigate(page,'accounts');await directoryReset(page);await directoryStatus(page,'used');
  assert.equal(await page.locator('#accountsMeta').innerText(),'1 account');
  assert.equal(await page.locator('#savedStat').innerText(),saved,'Visual actions cannot alter savings');
  await openMoreDestination(page,'appearance');await page.locator('[data-open-sheet="theme"]').click();await page.locator('[data-theme-colour="#c5a0ff"]').click();await page.keyboard.press('Escape');await page.locator('[data-settings-back]').click();await openMoreDestination(page,'receipts');
  assert.ok(await page.locator('.ri-paid-card').evaluate(el=>getComputedStyle(el).backgroundImage.includes('gradient')));
  assert.equal(await page.locator('.ri-activity').count(),1,'Horizontal activity stays inside one card');
  assert.equal(await page.locator('.ri-range').inputValue(),'month');
  assert.match(await page.locator('.ri-empty').innerText(),/not imported/,'Do not invent individual receipts from lifetime totals');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator('[data-receipts-back]').click();await openMoreDestination(page,'savings');
  const heroColours=await page.locator('.savings-hero').evaluate(el=>({surface:getComputedStyle(el).backgroundImage,reflection:getComputedStyle(el,'::before').content}));
  assert.ok(heroColours.surface.includes('gradient'));assert.equal(heroColours.reflection,'none','Savings shares the hue fade without a curved reflection');
  await page.keyboard.press('Escape');await navigate(page,'home');
  assert.ok(await page.locator('.total-saved-card').evaluate(el=>getComputedStyle(el).backgroundImage.includes('gradient')&&getComputedStyle(el,'::before').content==='none'),'Home shares the Savings material');
  assert.ok(await page.locator('.home-overview').evaluate(el=>el.querySelector('.total-saved-card').getBoundingClientRect().top<el.querySelector('.home-intro').getBoundingClientRect().top),'Savings leads the overview');
  const homeHeroHeight=await page.locator('.total-saved-card').evaluate(el=>el.getBoundingClientRect().height);
  assert.ok(homeHeroHeight>=240&&(width>=768||homeHeroHeight<=400),'Home savings reserves its chart and readable support: '+name+' / '+width+' / '+homeHeroHeight);
  await navigate(page,'accounts');await directoryReset(page);await directoryStatus(page,'used');
  assert.equal(await page.locator('#view-used,[data-view=used]').count(),0);assert.equal(await page.locator('#accountShowValue').innerText(),'Finished');
  await page.keyboard.press('Escape');await openMoreDestination(page,'health');await page.locator('[data-account-import]').click();
  await page.locator('.receipt-import-dialog[open] [data-receipt-import-file]').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{}')});await page.locator('.rim-error').waitFor();assert.match(await page.locator('.rim-error').innerText(),/Choose a tracker/);
  if(width<768){
   await page.evaluate(()=>{const viewport=window.visualViewport;Object.defineProperty(viewport,'height',{configurable:true,value:420});Object.defineProperty(viewport,'offsetTop',{configurable:true,value:0});viewport.dispatchEvent(new Event('resize'));});
   assert.ok(await page.locator('.receipt-import-dialog[open]').evaluate(el=>el.scrollWidth<=el.clientWidth),'Import remains readable without overflow');
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
  await populatedPage.addInitScript(()=>localStorage.setItem('uber-eats-promo-tracker:offer-preferences:v1',JSON.stringify({defaultView:'all',selection:'all'})));await populatedPage.goto('http://127.0.0.1:'+server.address().port);await populatedPage.waitForFunction(()=>document.getElementById('scanLabel').textContent==='Updated');
  await navigate(populatedPage,'accounts');
  assert.equal(await populatedPage.locator('#accountsTotal').innerText(),'8');assert.equal(await populatedPage.locator('#accountsAccessible').innerText(),'8');
  await populatedPage.locator('.accounts-stat [data-metric-label="Total accounts"]').click();
  assert.match(await populatedPage.locator('#sheetBody').innerText(),/Every tracked account/);await populatedPage.keyboard.press('Escape');
  await populatedPage.locator('.accounts-stat [data-metric-label="Can log in"]').click();
  assert.match(await populatedPage.locator('#sheetBody').innerText(),/separate from usage and archive/);await populatedPage.keyboard.press('Escape');
  await openMoreDestination(populatedPage,'receipts');
  await populatedPage.locator('.ri-range').selectOption('all');
  await populatedPage.locator('[data-ri-service=all]').click();
  assert.equal(await populatedPage.locator('.ri-paid-total').innerText(),'—','Public daily savings do not establish paid amounts');
  assert.match(await populatedPage.locator('[data-ri-service=all]').getAttribute('aria-label'),/6 receipts/);
  assert.equal(await populatedPage.locator('.ri-activity').count(),1);
  assert.equal(await populatedPage.locator('.monthly-track,.monthly-chart').count(),0,'No old monthly chart remains');
  assert.ok(await populatedPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await populatedPage.close();
 }
 console.log('✓ Sitewide sheets: unknown/zero fees, preview/cancel/private apply, ignore/manual decisions, independent receipt states, theme propagation, empty/error and keyboard viewport ('+name+')');
}finally{await browser.close();server.close();}
