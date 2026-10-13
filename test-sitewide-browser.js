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
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>document.getElementById('scanLabel').textContent==='Up to date');
  const saved=await page.locator('#savedStat').innerText();
  await page.locator('[data-open-sheet="advanced"]').click();
  assert.equal(await page.locator('#sheetFeeInput').inputValue(),'','Unknown fees stay blank');
  await page.locator('#sheetFeeInput').fill('0');
  let settings=await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.includes('planner')).map(k=>JSON.parse(localStorage.getItem(k))).find(v=>'feeTouched' in v));
  assert.equal(settings.feeTouched,true);assert.equal(settings.extraOrderFee,0,'Explicit zero is a known fee');
  await page.locator('#sheetFeeInput').fill('');
  settings=await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.includes('planner')).map(k=>JSON.parse(localStorage.getItem(k))).find(v=>'feeTouched' in v));
  assert.equal(settings.extraOrderFee,null);assert.equal(settings.feeTouched,false,'Clearing a fee restores unknown');
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
  await page.keyboard.press('Escape');await page.locator('[data-view="accounts"]').click();await page.locator('#accountsList [data-account-offers="A001"]').click();
  await page.locator('[data-toggle-ignore][data-ignore="true"]').click();await page.locator('[data-cancel-offer-action]').click();
  assert.equal(await page.locator('[data-toggle-ignore][data-ignore="false"]').count(),0,'Cancel must not ignore');
  await page.locator('[data-toggle-ignore][data-ignore="true"]').click();await page.locator('[data-confirm-offer-action]').click();
  assert.equal(await page.locator('[data-toggle-ignore][data-ignore="false"]').count(),1);await page.locator('[data-toggle-ignore][data-ignore="false"]').click();
  await page.locator('[data-mark-offer-done][data-done="true"]').click();await page.locator('[data-cancel-offer-action]').click();
  assert.equal(await page.locator('[data-mark-offer-done][data-done="false"]').count(),0);
  await page.locator('[data-mark-offer-done][data-done="true"]').click();await page.locator('[data-confirm-offer-action]').click();
  assert.match(await page.locator('.offer-card .use-line').innerText(),/1 of 5 confirmed used/);
  await page.keyboard.press('Escape');await page.locator('[data-view="used"]').click();
  assert.equal(await page.locator('#manualDisclosureCount').innerText(),'1');assert.equal(await page.locator('#fullyUsedCount').innerText(),'0');assert.equal(await page.locator('#usedAccountCount').innerText(),'1');
  assert.equal(await page.locator('#savedStat').innerText(),saved,'Visual actions cannot alter savings');
  await page.locator('[data-view="more"]').click();await page.locator('#view-more [data-open-sheet="appearance"]').click();await page.locator('[data-theme-colour="#c5a0ff"]').click();await page.keyboard.press('Escape');await page.locator('#view-more [data-open-sheet="receipts"]').click();
  assert.equal(await page.locator('.finance-heading-icon').evaluate(el=>getComputedStyle(el).color),'rgb(197, 160, 255)');
  assert.ok(await page.locator('.insights-hero').evaluate(el=>getComputedStyle(el).backgroundImage.includes('197, 160, 255')&&getComputedStyle(el,'::before').borderColor.includes('197, 160, 255')),'Receipt insights shares the chosen Savings material');
  assert.equal(await page.locator('.savings-bar-track > span').count(),1,'Chart follows actual month records');
  assert.equal(await page.locator('#sheetBody .empty').filter({hasText:'Receipt activity will appear'}).count(),1,'Receipt empty state is available');
  assert.ok(await page.locator('.sheet').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
  await page.keyboard.press('Escape');await page.locator('#view-more [data-open-sheet="savings"]').click();
  const heroColours=await page.locator('.finance-hero').evaluate(el=>({surface:getComputedStyle(el).backgroundImage,reflection:getComputedStyle(el,'::before').backgroundImage,edge:getComputedStyle(el,'::before').borderColor}));
  assert.ok([heroColours.surface,heroColours.reflection,heroColours.edge].every(value=>value.includes('197, 160, 255')),'The Savings surface and curved reflection follow the chosen colour');
  await page.keyboard.press('Escape');await page.locator('[data-view="home"]').click();
  assert.ok(await page.locator('.total-saved-card').evaluate(el=>getComputedStyle(el).backgroundImage.includes('197, 160, 255')&&getComputedStyle(el,'::before').borderColor.includes('197, 160, 255')),'Home shares the themed Savings material');
  assert.ok(await page.locator('.home-overview').evaluate(el=>el.querySelector('.total-saved-card').getBoundingClientRect().top<el.querySelector('.home-intro').getBoundingClientRect().top),'Savings leads the overview');
  await page.locator('[data-view="used"]').click();
  const metrics=await page.locator('.activity-card').evaluateAll(cards=>cards.map(card=>({height:card.getBoundingClientRect().height,overflow:card.scrollWidth>card.clientWidth+1,icon:card.querySelector('.app-icon-surface').getBoundingClientRect().width})));
  assert.ok(metrics.every(card=>card.height<=(width<370?145:130)&&!card.overflow&&card.icon<=32),'Used tiles and icons remain balanced without oversized empty space: '+name+' / '+width+' / '+JSON.stringify(metrics));
  assert.equal(await page.locator('#view-used > details').count(),8,'Every existing status group remains available');
  await page.locator('[data-view="more"]').click();
  await page.keyboard.press('Escape');await page.locator('#view-more [data-open-sheet="device"]').click();
  await page.locator('#deviceAccountsFile').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{}')});await page.waitForFunction(()=>document.getElementById('deviceImportStatus').textContent.includes('Choose a tracker'));assert.match(await page.locator('#deviceImportStatus').innerText(),/Choose a tracker/);
  if(width<768){
   await page.evaluate(()=>{const viewport=window.visualViewport;Object.defineProperty(viewport,'height',{configurable:true,value:420});Object.defineProperty(viewport,'offsetTop',{configurable:true,value:0});viewport.dispatchEvent(new Event('resize'));});
   assert.ok(await page.locator('.sheet').evaluate(el=>el.getBoundingClientRect().bottom<=421),'Sheet remains above an emulated keyboard viewport');
  }
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('✓ Sitewide sheets: unknown/zero fees, preview/cancel/private apply, ignore/manual decisions, independent receipt states, theme propagation, empty/error and keyboard viewport ('+name+')');
}finally{await browser.close();server.close();}
