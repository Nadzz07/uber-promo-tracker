// Grouped destination menu: real handlers, keyboard activation and safe layouts.
import assert from 'node:assert/strict';
import {settlePageLayout} from './test-browser-navigation.js';
import fs from 'node:fs';
import http from 'node:http';
import {once} from 'node:events';
import {execFileSync} from 'node:child_process';
import {chromium,webkit,firefox} from 'playwright';
execFileSync(process.execPath,['build-site.js']);
const stamp=new Date().toISOString(),accounts=[{accountRef:'A901',accountMasked:'pr…te@example.invalid',canLogin:true,accountStatus:'active'},{accountRef:'A902',accountMasked:'ar…ed@example.invalid',canLogin:false,accountStatus:'archived'}];
const data={accounts,promos:[],generatedAt:stamp,sync:{lastSuccessfulMailScanAt:stamp},summary:{totalSaved:12,trackedOrders:1,trackedRides:0}};
const files=new Set(fs.readdirSync('dist'));let writes=0;
const server=http.createServer((req,res)=>{if(req.method!=='GET')writes++;const file=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';if(!files.has(file)){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html');res.end(file==='promos.json'?JSON.stringify(data):file==='history.json'?JSON.stringify({records:[],updatedAt:stamp}):fs.readFileSync('dist/'+file));});
server.listen(0,'127.0.0.1');await once(server,'listening');
const engine=process.env.TRACKER_BROWSER_ENGINE||'chromium',browser=await{chromium,webkit,firefox}[engine].launch(),output=process.env.TRACKER_SCREENSHOT_DIR;
if(output)fs.mkdirSync(output,{recursive:true,mode:0o700});
const groups=[['Offers & history',['Order Planner','Promo history','Archived accounts']],['Savings & receipts',['Savings','Receipt insights','Finances']],['Accounts & data',['Import accounts','Sync & data']],['Settings & help',['Settings','Help & guide','About this tracker']]];
const destinations=['planner','history','locked','savings','receipts','finance','device','health','appearance','guide','about'];
try {for(const [width,height,large] of [[320,568,false],[440,956,false],[430,932,false],[1440,1000,false],[390,844,true]]){
 const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await context.addInitScript(()=>localStorage.setItem('uber-eats-promo-tracker:theme:v1','#4da3ff'));
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>document.getElementById('scanLabel').textContent==='Up to date');await page.locator('[data-view="more"]').click();
 if(large)await page.addStyleTag({content:'#view-more .more-title,#view-more .eyebrow{font-size:24px!important}#view-more .more-count{font-size:20px!important}'});
 assert.deepEqual(await page.locator('#view-more .more-group h2').allTextContents(),groups.map(g=>g[0]));
 for(let i=0;i<groups.length;i++)assert.deepEqual(await page.locator('#view-more .more-group').nth(i).locator('.more-title').allTextContents(),groups[i][1]);
 assert.equal(await page.locator('.more-intro').innerText(),'Your tools, history and settings.');
 assert.equal(await page.locator('#lockedCardCopy').innerText(),'1');
 const geometry=await page.locator('#view-more .more-card').evaluateAll(rows=>rows.map(row=>{const rect=row.getBoundingClientRect(),icon=row.querySelector('.more-icon'),label=row.querySelector('.more-title'),chevron=row.querySelector('.row-chevron'),style=getComputedStyle(icon);return {height:rect.height,icon:icon.getBoundingClientRect().left-rect.left,label:label.getBoundingClientRect().left-rect.left,chevron:chevron.getBoundingClientRect().right-rect.left,background:style.backgroundColor,border:style.borderTopWidth};}));
 assert.ok(geometry.every(r=>r.height>=44&&r.background==='rgba(0, 0, 0, 0)'&&r.border==='0px'));
 for(const key of ['icon','label','chevron'])assert.ok(Math.max(...geometry.map(r=>r[key]))-Math.min(...geometry.map(r=>r[key]))<1,'Rows align '+key+' at '+width+' large '+large+' '+JSON.stringify(geometry));
 if(!large&&output&&[320,440,430,1440].includes(width))await page.screenshot({path:output+'/'+engine+'-'+width+'-more.png',fullPage:true});
 for(let i=0;i<destinations.length;i++){
  const button=page.locator('#view-more .more-card').nth(i);await button.focus();await settlePageLayout(page);const beforeScroll=await page.evaluate(()=>scrollY);await page.keyboard.press(i%2?'Space':'Enter');const dest=destinations[i];
  if(dest==='planner'){await page.locator('#view-planner.active').waitFor();assert.equal(await page.locator('#plannerTitle').innerText(),'Order Planner');assert.equal(await page.locator('#mainNav [aria-current=page]').getAttribute('data-view'),'more');await page.locator('#view-planner [data-home-back]').click();await page.locator('#view-more.active').waitFor();}
  else if(dest==='receipts'){await page.locator('#view-receipts.active').waitFor();assert.equal(await page.locator('#receiptInsightsTitle').innerText(),'Receipt insights');await page.locator('[data-receipts-back]').click();await page.locator('#view-more.active').waitFor();assert.equal(await button.evaluate(e=>document.activeElement===e),true);}
  else if(dest==='guide'){await page.locator('#view-help.active').waitFor();await page.locator('#view-help [data-guide-back]').click();await page.locator('[data-view="more"]').click();}
  else if(dest==='appearance'){await page.locator('#view-settings.active').waitFor();assert.equal(await page.locator('#settingsTitle').innerText(),'Settings');assert.deepEqual(await page.locator('#settingsContent h2').allTextContents(),['Appearance','Offer preferences','Fees']);assert.equal(await page.locator('[data-view="more"]').getAttribute('aria-current'),'page');await page.locator('[data-settings-back]').click();await page.locator('#view-more.active').waitFor();assert.equal(await button.evaluate(e=>document.activeElement===e),true,'Settings Back restores its menu button');}
  else {await page.locator('#sheetBackdrop.open').waitFor();const titles={history:'Promo history',locked:'Archived accounts',savings:'Savings',receipts:'Receipt insights',finance:'Private finances',device:'Private account import',health:'Sync & data',appearance:'Settings',about:'About this tracker'};assert.equal(await page.locator('#sheetTitle').innerText(),titles[dest]);assert.ok(await page.locator('#sheetBody').innerText());await page.keyboard.press('Escape');await page.locator('#sheetBackdrop.open').waitFor({state:'hidden'});assert.equal(await button.evaluate(e=>document.activeElement===e),true,'Sheet dismissal restores its menu button');}
  await page.waitForTimeout(70);assert.ok(Math.abs(await page.evaluate(()=>scrollY)-beforeScroll)<2,JSON.stringify({reason:'More scroll restoration',width,large,dest,beforeScroll,after:await page.evaluate(()=>scrollY)}));assert.equal(await page.locator('#mainNav [aria-current=page]').getAttribute('data-view'),'more');
 }
 await page.locator('#view-more .more-card').last().focus();await page.locator('#view-more .more-card').last().scrollIntoViewIfNeeded();
 assert.ok(await page.locator('#view-more .more-card').last().evaluate(e=>{const a=e.getBoundingClientRect(),b=document.getElementById('mainNav').getBoundingClientRect();return a.bottom<=b.top||a.top>=b.bottom||a.right<=b.left||a.left>=b.right;}),'Bottom navigation clears the last menu item');
 if(output)await page.screenshot({path:output+'/'+engine+'-'+width+(large?'-large':'')+'-more-bottom.png'});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);await context.close();
 }assert.equal(writes,0);console.log('✓ Four ordered More groups, 11 destinations, counts, compact aligned icons, Enter/Space activation, focus restoration, 320/430/1440px and larger text, bottom navigation clearance ('+engine+')');
}finally{await browser.close();server.close();}
