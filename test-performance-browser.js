// Synthetic performance regressions; no owner account or Mail data is loaded.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {execFileSync} from 'node:child_process';
import {chromium,webkit,firefox} from 'playwright';
execFileSync(process.execPath,['build-site.js']);
const time=Date.now(),stamp=new Date(time).toISOString();
const account={accountRef:'A901',accountMasked:'te…st@example.invalid',canLogin:true,accountStatus:'active',orderCount:0,rideCount:0};
const offer={id:'perf-offer',accountRef:account.accountRef,accountMasked:account.accountMasked,canLogin:true,service:'Uber Eats',discountType:'percent',discount:50,uses:5,usesRemaining:5,usesVerified:true,receiptConfirmedUses:0,emailSentAt:stamp,firstEmailSentAt:stamp,expiresAt:new Date(time+2*86400000).toISOString(),expiryStatus:'exact'};
let snapshot={accounts:[account],promos:[offer],generatedAt:stamp,sync:{lastSuccessfulMailScanAt:stamp},summary:{totalSaved:0}};
let version=1;const requests=[];
const files=new Set(fs.readdirSync('dist'));
let html=fs.readFileSync('dist/index.html','utf8');
const hook=`window.__runtime={renders:0,model:()=>enrichedAccounts(),reload:()=>load(),refresh:()=>refreshTimedViews()};const originalRender=renderAll;renderAll=(...args)=>{window.__runtime.renders++;return originalRender(...args);};`;
const at=html.lastIndexOf('load();');assert.ok(at>=0);html=html.slice(0,at)+hook+html.slice(at);
const server=http.createServer((req,res)=>{
 const file=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';if(!files.has(file)){res.writeHead(404).end();return;}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':file.endsWith('.css')?'text/css':'text/html');
 if(file.endsWith('.json')) {
   const tag='"snapshot-'+version+'"';const cached=req.headers['if-none-match']===tag;
   requests.push({file,query:new URL(req.url,'http://localhost').search,cached});res.setHeader('Cache-Control','no-cache');res.setHeader('ETag',tag);
   if(cached){res.writeHead(304).end();return;}
   res.end(JSON.stringify(file==='promos.json'?snapshot:{updatedAt:snapshot.generatedAt,records:[]}));return;
 }
 res.end(file==='index.html'?html:fs.readFileSync('dist/'+file));
});server.listen(0,'127.0.0.1');await once(server,'listening');
const engine={chromium,webkit,firefox}[process.env.TRACKER_BROWSER_ENGINE||'chromium'],browser=await engine.launch();
try {
 const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'Europe/London',reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.clock.install({time});await page.goto('http://127.0.0.1:'+server.address().port);
 await page.waitForFunction(()=>window.__runtime?.model().length===1);
 assert.equal(await page.locator('#accountsList .account-card').count(),0,'Closed account screen is deferred');
 assert.equal(await page.locator('#fullyUsedList .activity-row').count(),0);
 assert.equal(await page.evaluate(()=>window.__runtime.model()===window.__runtime.model()),true,'Repeated projections reuse derived accounts');
 const renders=await page.evaluate(()=>window.__runtime.renders);await page.clock.fastForward(4*60000);
 assert.equal(await page.evaluate(()=>window.__runtime.renders),renders,'Unchanged minute checks do not reconstruct visible DOM');
 await page.evaluate(async()=>await Promise.all([window.__runtime.reload(),window.__runtime.reload()]));
 assert.equal(requests.filter(r=>r.file==='promos.json').length,2,'Concurrent refresh requests are coalesced');
 assert.equal(requests.filter(r=>r.file==='history.json').length,2);
 assert.ok(requests.slice(-2).every(r=>r.query==='?snapshot=1'),'Snapshots revalidate a stable URL');
 if(engine===chromium)assert.ok(requests.slice(-2).every(r=>r.cached),'Browser HTTP cache revalidates using ETags');
 snapshot={...snapshot,promos:[{...offer,discount:25}]};version++;
 await page.evaluate(async()=>await window.__runtime.reload());
 assert.equal(await page.evaluate(()=>window.__runtime.model()[0].bestNow.promo.discount),25,'A changed snapshot invalidates derived state');
 assert.ok(requests.slice(-2).every(r=>!r.cached));
 await page.locator('[data-view="accounts"]').click();assert.equal(await page.locator('#accountsList .account-card').count(),1);
 await page.locator('#accountSearch').fill('not-found');assert.equal(await page.locator('#accountsList .account-card').count(),0);
 await page.locator('#accountSearch').fill('');assert.equal(await page.locator('#accountsList .account-card').count(),1);
 await page.locator('[data-view="home"]').click();await page.locator('#basketInput').fill('40');await page.clock.fastForward(200);
 assert.equal(await page.evaluate(()=>window.__runtime.model()[0].bestNow.calculation.saving),10,'Basket changes recompute offer savings');
 await page.locator('[data-account-offers="A901"]').first().click();await page.locator('[data-use-one="perf-offer"]').click();
 assert.equal(await page.evaluate(()=>window.__runtime.model()[0].promos[0].usesRemaining),4,'Manual actions invalidate offer projections');await page.keyboard.press('Escape');
 await page.clock.fastForward(2*86400000+60000);await page.waitForFunction(()=>document.getElementById('activeStat').textContent==='0');
 assert.equal(await page.locator('#activeStat').innerText(),'0','Deadline invalidates cached availability without a Mail import');
 assert.equal(await page.evaluate(()=>window.__runtime.model()[0].promos.length),0);
 await page.clock.setSystemTime(time);await page.evaluate(()=>window.__runtime.refresh());await page.waitForFunction(()=>document.getElementById('activeStat').textContent==='1');
 assert.equal(await page.locator('#activeStat').innerText(),'1','A corrected device clock cannot retain stale expiry state');
 const beforeHidden=await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});return window.__runtime.renders;});
 await page.clock.fastForward(3*86400000);assert.equal(await page.evaluate(()=>window.__runtime.renders),beforeHidden,'Background tabs do no timed rendering');
 await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
 assert.equal(await page.locator('#activeStat').innerText(),'0','Foreground restoration applies elapsed deadlines');
 assert.deepEqual(errors,[]);await page.close();
 console.log('✓ Deferred screens; reusable projections; conditional fresh snapshots; coalesced requests; basket/manual/expiry/clock invalidation; idle and background work ('+(process.env.TRACKER_BROWSER_ENGINE||'chromium')+')');
}finally{await browser.close();server.close();}
