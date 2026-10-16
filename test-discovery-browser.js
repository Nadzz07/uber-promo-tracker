import {openHomeDetail,directoryStatus,directoryType,directoryReset,directoryAvailability} from './test-browser-navigation.js';
import fs from 'node:fs';import assert from 'node:assert/strict';import http from 'node:http';import {once} from 'node:events';import {execFileSync} from 'node:child_process';import {chromium,webkit,firefox} from 'playwright';
execFileSync(process.execPath,['build-site.js']);const allowed=new Set(fs.readdirSync('dist'));const server=http.createServer((req,res)=>{const file=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';if(!allowed.has(file)){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync('dist/'+file));});server.listen(0,'127.0.0.1');await once(server,'listening');
const time=new Date().toISOString(),end=new Date(Date.now()+7*86400000).toISOString();const accounts=Array.from({length:12},(_,i)=>({accountRef:'A'+(801+i),accountMasked:'account-'+i+'@example.invalid',canLogin:true,accountStatus:'active',loginMethod:'Google',orderCount:0,rideCount:0,totalSaved:0}));accounts.push({accountRef:'A813',accountMasked:'pending@example.invalid',canLogin:null,accessStatus:'pending',accountStatus:'active',orderCount:0,rideCount:0,totalSaved:0});
accounts.push({accountRef:'A814',accountMasked:'archived@example.invalid',canLogin:true,accountStatus:'archived',orderCount:1,rideCount:1,totalSaved:0},{accountRef:'A815',accountMasked:'locked@example.invalid',canLogin:false,accountStatus:'active',orderCount:5,rideCount:0,totalSaved:0});
const offers=accounts.map((a,i)=>({...a,id:'offer'+i,service:'Uber Eats',discountType:'fixed',discount:i%2?12:15,minimumSpend:15,minimumSpendVerified:true,uses:i===2?5:1,usesVerified:true,usesRemaining:i===2?4:1,receiptConfirmedUses:i===2?1:0,trackingState:'available',classificationConfidence:'high',expiryStatus:'exact',expiresAt:end,firstEmailSentAt:time,observedLive:true,title:i%2?'£12 off':'£15 off'}));for(const i of [0,1])offers.push({...offers[i],id:'cash'+i,discountType:'uberCash',discount:12,title:'£12 Uber Cash'});
offers.push({...offers[1],id:'stronger-other-category',discount:15,title:'£15 off'});
offers.push({...offers[14],id:'uncertain-locked',offerScope:'uncertain',trackingState:'needs_checking',reviewReasons:['unconfirmed_discount_scope']});
const engine={chromium,webkit,firefox}[process.env.TRACKER_BROWSER_ENGINE||'chromium'],browser=await engine.launch();
try { for(const width of [390,980,1440,1920]) {
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.emulateMedia({reducedMotion:'reduce'});
 await page.route('**/promos.json?*',r=>r.fulfill({json:{accounts,promos:offers,generatedAt:time,sync:{lastSuccessfulMailScanAt:time},summary:{totalSaved:0}}}));await page.route('**/history.json?*',r=>r.fulfill({json:{updatedAt:time,records:offers}}));await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>document.getElementById('scanLabel').textContent==='Up to date');
 assert.equal(await page.locator('#view-home #quickGrid').count(),0);await openHomeDetail(page,'offers');
 for(const [intent,count] of [['best',12],['15off15',7],['12off15',6],['cash',2],['unfinished',1],['cash-promo',2]]){
  await openHomeDetail(page,'offers');await page.locator('[data-intent="'+intent+'"]').click();assert.equal(await page.locator('#homeAccountsTitle').innerText(),'Best matches');assert.match(await page.locator('#homeAccountMeta').innerText(),new RegExp('^'+count+' '));assert.equal(await page.locator('[data-intent][aria-pressed="true"]').count(),1);
  if(intent==='12off15') assert.ok((await page.locator('#homeAccounts .account-offer').allTextContents()).every(t=>t.startsWith('£12 off')),'Selected category displays its matching offer, even with another stronger promo');
  assert.ok(await page.locator('#homeAccounts').evaluate(e=>Boolean(e.closest('.offer-browser')?.contains(document.getElementById('quickGrid')))),'Filters and results must share one browser panel');
  assert.ok(await page.locator('#offersTitle').isVisible(),'Offer detail retains its heading');
  if(width===390) {await page.waitForFunction(()=>{const heading=document.getElementById('homeAccountsTitle').getBoundingClientRect();return heading.top>=0&&heading.bottom<document.getElementById('mainNav').getBoundingClientRect().top;});assert.ok(await page.locator('#homeAccountsTitle').evaluate(e=>e.getBoundingClientRect().top>=0 && e.getBoundingClientRect().bottom<document.getElementById('mainNav').getBoundingClientRect().top),'Selected result context must be discoverable above the dock');}
 }
 await openHomeDetail(page,'offers');await page.locator('[data-intent="15off15"]').click();await openHomeDetail(page,'offers');await page.locator('#homeResultsFooter [data-jump-accounts]').click();assert.equal(await page.locator('#accountsMeta').innerText(),'7 accounts');assert.equal(await page.locator('#accountTypeValue').innerText(),'£15 off £15');await page.locator('[data-view="home"]').click();assert.equal(await page.locator('#homeAccountsTitle').innerText(),'Best matches');await openHomeDetail(page,'offers');await page.locator('#resetQuickFind').click();assert.equal(await page.locator('#homeAccountsTitle').innerText(),'Best matches');
 await page.locator('[data-view="accounts"]').click();await directoryReset(page);await directoryStatus(page,'pending');assert.equal(await page.locator('#accountsMeta').innerText(),'1 account');assert.match(await page.locator('#accountsList').innerText(),/pending verification/i);
 await page.locator('[data-view="home"]').click();
 assert.equal(await page.locator('#activeStat').innerText(),'15');
 assert.match(await page.locator('#offerScopeSummary').innerText(),/12 ready · 3 need attention/);
 for(const [scope,count] of [['all',15],['archived',1],['attention',3],['ready',12]]) {
  await openHomeDetail(page,'offers');await page.locator('#offerScope').selectOption(scope);assert.match(await page.locator('#homeAccountMeta').innerText(),new RegExp('^'+count+' '));assert.equal(await page.locator('#bestCount').innerText(),String(count));
  if(scope==='attention') {
   assert.match(await page.locator('#homeAccounts').innerText(),/Accessible · archived.*pending verification/s);
   if(await page.locator('#homeAccounts .account-card').count()===3)assert.match(await page.locator('#homeAccounts').innerText(),/Can’t log in/);
  }
 }
 await openHomeDetail(page,'offers');await page.locator('#offerScope').selectOption('all');await openHomeDetail(page,'offers');await page.locator('#homeResultsFooter [data-jump-accounts]').click();
 assert.equal(await page.locator('#accountsMeta').innerText(),'15 accounts');assert.equal(await page.locator('#accountOfferScope').inputValue(),'all');
 const ordered=await page.locator('#accountsList [data-card-account]').evaluateAll(nodes=>nodes.map(n=>n.dataset.cardAccount));assert.deepEqual(ordered.slice(-3),['A814','A813','A815'],'Readiness outranks basket savings and receipt usage');
 await directoryAvailability(page,'attention');assert.equal(await page.locator('#accountsMeta').innerText(),'3 accounts');
 if(await page.locator("#view-home.active").count())await openHomeDetail(page,'offers');await page.locator('#accountsList [data-account-offers="A815"]').click();
 assert.equal(await page.locator('[data-use-this-account="A815"]').isDisabled(),true);
 assert.match(await page.locator('#sheetBody').textContent(),/Eligible offers · login unavailable/);
 const review=page.locator('.offer-history').filter({has:page.locator('summary', {hasText:'Terms need checking'})});
 await review.locator('> summary').click();
 const reviewStatus=review.locator('.pill').filter({hasText:'Needs checking'}).first();await reviewStatus.scrollIntoViewIfNeeded();await reviewStatus.waitFor({state:'visible'});assert.match(await review.textContent(),/Needs checking/);
 const terms=page.locator('.offer-terms').first();await terms.locator('> summary').click();assert.notEqual(await terms.getAttribute('open'),null);assert.match(await terms.textContent(),/Minimum£15/);assert.match(await terms.textContent(),/Calculated100%/);assert.match(await terms.textContent(),/remaining uses require confirmation in Uber/);
 await page.keyboard.press('Escape');

 await page.locator('[data-view="home"]').click();assert.equal(await page.locator('#offerScope').inputValue(),'all');
 await openHomeDetail(page,'offers');await page.locator('#offerScope').selectOption('ready');
 await page.locator('[data-view="used"]').click();const disclosures=page.locator('#view-used .disclosure-card');assert.equal(await disclosures.count(),8);for(let i=0;i<8;i++){const summary=disclosures.nth(i).locator('> summary');await summary.focus();const before=await disclosures.nth(i).getAttribute('open');await page.keyboard.press('Space');assert.notEqual(await disclosures.nth(i).getAttribute('open'),before,'Keyboard disclosure toggle');}
 await page.locator('[data-view="home"]').click();await page.locator('#homeAnalytics button').focus();await page.keyboard.press('Enter');assert.ok(await page.locator('.insights-chart-card').isVisible());await page.keyboard.press('Escape');
 if(width===390){await openHomeDetail(page,'offers');await page.locator('#homeResultsFooter button').scrollIntoViewIfNeeded();await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));assert.ok(await page.locator('#homeResultsFooter button').evaluate(e=>e.getBoundingClientRect().bottom<document.getElementById('mainNav').getBoundingClientRect().top),'Last result action can clear floating navigation');}
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal overflow');assert.deepEqual(errors,[]);await page.close();
 }console.log('✓ Connected discovery across four widths: six category selections/counts and Best matches heading, persistent View all filter, pending access, native disclosures, dock clearance');
}finally{await browser.close();server.close();}
