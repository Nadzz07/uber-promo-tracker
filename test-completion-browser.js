import fs from 'node:fs';import assert from 'node:assert/strict';import http from 'node:http';import {once} from 'node:events';import {execFileSync} from 'node:child_process';import {chromium,webkit,firefox} from 'playwright';
execFileSync(process.execPath,['build-site.js']);
const files=new Set(fs.readdirSync('dist')),server=http.createServer((req,res)=>{const file=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';if(!files.has(file)){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync('dist/'+file));});
server.listen(0,'127.0.0.1');await once(server,'listening');
const engine={chromium,webkit,firefox}[process.env.TRACKER_BROWSER_ENGINE||'chromium'],browser=await engine.launch();
try{
 const now=Date.now(),time=new Date(now).toISOString();
 const definitions=[[0,false,true,'active',0,0],[1,false,true,'active',1,0],[0,true,false,'active',0,0],[1,true,true,'active',1,1],[2,true,true,'archived',2,0],[4,true,false,'archived',4,0],[5,false,false,'active',5,0],[0,false,true,'active',0,0]];
 const accounts=definitions.map(([n,expired,canLogin,accountStatus,orderCount,rideCount],i)=>({accountRef:'A90'+(i+1),accountMasked:'t'+i+'…st@example.invalid',canLogin,accountStatus,orderCount,rideCount}));
 const offers=definitions.map(([confirmed,expired,canLogin],i)=>({id:'situation-'+i,accountRef:accounts[i].accountRef,accountMasked:accounts[i].accountMasked,canLogin,service:'Uber Eats',discountType:'fixed',discount:12,minimumSpend:15,uses:5,usesVerified:true,usesRemaining:5-confirmed,receiptConfirmedUses:confirmed,receiptState:confirmed===5?'used':confirmed?'partial':null,expiresAt:new Date(now+(expired?-1000:10*86400000)).toISOString(),expiryStatus:'exact',firstEmailSentAt:new Date(now-(expired?40:1)*86400000).toISOString(),emailSentAt:time,title:'£12 off on 5 orders'}));
 const lateUKDeadline=new Date(now+10*86400000);lateUKDeadline.setUTCHours(23,30,0,0);offers[0].expiresAt=lateUKDeadline.toISOString();
 offers.push({...offers[3],id:'another-finished',accountRef:'A908',accountMasked:accounts[7].accountMasked});
 // The first offer on an account may differ from the best displayed offer.
 // Title, countdown and remaining uses must all describe the same offer.
 offers.unshift({...offers[0],id:'weaker-first',discount:10,uses:2,usesRemaining:2,title:'£10 off on 2 orders',expiresAt:new Date(now+2*86400000).toISOString()});
 const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'America/Los_Angeles'});const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/promos.json?*',r=>r.fulfill({json:{accounts,promos:offers,generatedAt:time,sync:{lastSuccessfulMailScanAt:time},summary:{totalSaved:12}}}));await page.route('**/history.json?*',r=>r.fulfill({json:{updatedAt:time,records:offers}}));
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>document.getElementById('scanLabel').textContent==='Up to date');
 assert.deepEqual(await page.locator('.home-overview .stats-row .stat-label').allTextContents(),['Total Accounts','Available Offers','Accessible','Archived']);
 for(const [id,count] of [['usableStat',8],['activeStat',3],['loginStat',5],['archivedStat',2]])assert.equal(await page.locator('#'+id).innerText(),String(count));
 const firstCard=page.locator('#homeAccounts [data-card-account="A901"]');
 assert.match(await firstCard.locator('.account-offer').innerText(),/£12 off on 5 orders/);
 assert.match(await firstCard.locator('.pill-row').innerText(),/5 of 5 uses left/);
 assert.ok(!(await firstCard.locator('.pill-row').innerText()).includes('2 of 2'),'Uses must belong to the displayed offer');
 assert.ok((await firstCard.locator('.expiry-pill').innerText()).includes(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',day:'numeric',month:'short'}).format(lateUKDeadline)),'Expiry date must use UK time in a non-UK browser');
 await page.locator('[data-view="used"]').click();assert.equal(await page.locator('#fullyUsedCount').innerText(),'1');assert.equal(await page.locator('#usedAccountCount').innerText(),'2');
 const completed=await page.locator('#fullyUsedList').innerText();assert.match(completed,/Completed · Verified/);assert.doesNotMatch(completed,/Finished · Expired/);await page.locator('#finishedExpiredSection > summary').click();const finished=await page.locator('#finishedExpiredList').innerText();assert.match(finished,/1\/5 confirmed used/);assert.match(finished,/4\/5 confirmed used/);assert.equal(await page.locator('#finishedExpiredCount').innerText(),'4');
 await page.locator('#expiredSection > summary').click();assert.match(await page.locator('#expiredList').innerText(),/Expired · Unused · 0\/5 confirmed used/);
 assert.equal(await page.locator('#fullyUsedList .activity-row').count(),1,'History/current copies must not double-count');
 await page.locator('[data-view="accounts"]').click();
 for(const [filter,count] of [['all',8],['login',5],['locked',3],['used-login',1],['used-locked',1],['archived-login',1],['archived-locked',1],['finished',5],['expired-unused',1]]){await page.locator('#accountScope').selectOption(filter);assert.equal(await page.locator('#accountsMeta').innerText(),count+(count===1?' account':' accounts'),filter);}
 await page.locator('#accountScope').selectOption('all');await page.locator('#accountsList [data-account-offers="A904"]').click();await page.locator('#accountOfferHistory > summary').click();await page.locator('.past-offer > summary').click();assert.match(await page.locator('.past-offer').innerText(),/Finished · Expired/);assert.match(await page.locator('.past-offer').innerText(),/1 of 5 confirmed used/);assert.match(await page.locator('.past-offer').innerText(),/4 unredeemed/);await page.keyboard.press('Escape');
 await page.locator('[data-view="home"]').click();assert.equal(await page.locator('#homeAccounts [data-card-account="A908"]').count(),1,'Current eligible offer survives another finished offer');
 const badges=await page.locator('.account-card .pill-row').allTextContents();assert.ok(badges.every(text=>!/Login:|Partial account usage|promos available|Available/.test(text)),'Cards repeat secondary badges');
 await page.emulateMedia({reducedMotion:'reduce'});await page.locator('[data-view="more"]').click();await page.waitForTimeout(50);
 assert.ok(await page.locator('.nav-glider').evaluate(el=>!getComputedStyle(el).transform.includes('NaN')));
 if(engine===chromium){
  await page.evaluate(()=>{const pattern=document.createElement('div');pattern.id='shader-proof';pattern.style.cssText='position:fixed;inset:0;z-index:49;background:repeating-linear-gradient(90deg,#fff 0px,#fff 6px,#000 6px,#000 12px)';document.body.append(pattern);const nav=document.getElementById('mainNav');nav.style.zIndex='100';nav.style.background='transparent';});
  const displacement=page.locator('#tracker-liquid-lens feDisplacementMap');await displacement.evaluate(el=>el.setAttribute('scale','0'));const flat=await page.locator('#mainNav').screenshot();await displacement.evaluate(el=>el.setAttribute('scale','18'));const bent=await page.locator('#mainNav').screenshot();assert.ok(!flat.equals(bent),'SVG displacement must change the rendered backdrop pixels');
  await page.locator('#shader-proof').evaluate(el=>el.style.backgroundPosition='3px 0');const changed=await page.locator('#mainNav').screenshot();assert.ok(!bent.equals(changed),'Backdrop sampling must update with the underlying pixels');
 }
 assert.deepEqual(errors,[]);await page.close();console.log('✓ Final seven-situation table, Fully used counters, independent access/archive filters, preserved 1/5 expiry, deduped history and live refraction ('+(process.env.TRACKER_BROWSER_ENGINE||'chromium')+')');
}finally{await browser.close();server.close();}
