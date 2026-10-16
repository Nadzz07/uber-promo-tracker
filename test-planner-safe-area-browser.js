import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {once} from 'node:events';
import {execFileSync} from 'node:child_process';
import {chromium,webkit,firefox,devices} from 'playwright';

execFileSync(process.execPath,['build-site.js']);
const stamp=new Date().toISOString(),end=new Date(Date.now()+10*86400000).toISOString();
const emails=['first.private.account@example.invalid','second.very.long.account.identity.to.check.safe.wrapping@example.invalid','third@example.invalid'];
const accounts=emails.map((email,i)=>({accountRef:'A90'+i,accountMasked:email.slice(0,2)+'…'+email.split('@')[0].slice(-2)+'@example.invalid',canLogin:true,accountStatus:'active',loginMethod:i===1?'Google':'iCloud'}));
const promos=accounts.map(a=>({...a,id:'planner-'+a.accountRef,service:'Uber Eats',discountType:'fixed',discount:12,minimumSpend:15,minimumSpendVerified:true,uses:5,usesVerified:true,usesRemaining:5,emailSentAt:stamp,expiresAt:end,expiryStatus:'exact',restrictions:{merchantLimited:true,fulfilment:'delivery_only',promoCodeRequired:true}}));
const snapshot={accounts,promos,generatedAt:stamp,sync:{lastSuccessfulMailScanAt:stamp},summary:{totalSaved:0,feeModel:{sampleSize:0}}};
const files=new Set(fs.readdirSync('dist'));let writes=0;
const server=http.createServer((req,res)=>{
 if(req.method!=='GET')writes++;
 const file=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
 if(!files.has(file)){res.writeHead(404).end();return;}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html');
 res.end(file==='promos.json'?JSON.stringify(snapshot):file==='history.json'?JSON.stringify({records:promos,updatedAt:stamp}):fs.readFileSync('dist/'+file));
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const engine=process.env.TRACKER_BROWSER_ENGINE||'chromium';
const browser=await{chromium,webkit,firefox}[engine].launch();
let checked=0;
try{
 for(const [width,height,large,motion]of [[440,956,false,'reduce'],[440,763,false,'no-preference'],[440,763,true,'reduce'],[320,568,false,'reduce'],[1440,1000,false,'reduce']]){
  const context=await browser.newContext({...width===440&&engine!=='firefox'?devices['iPhone 16 Pro Max']:{},viewport:{width,height},deviceScaleFactor:width<980?3:1,reducedMotion:motion});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await context.addInitScript(({accounts,emails})=>{
   localStorage.setItem('uber-eats-promo-tracker:theme:v1','#c989f5');
   localStorage.setItem('uber-eats-promo-tracker:device-accounts:v1',JSON.stringify(Object.fromEntries(accounts.map((a,i)=>[a.accountRef,{email:emails[i],accountMasked:a.accountMasked}]))));
  },{accounts,emails});
  await page.goto('http://127.0.0.1:'+server.address().port);
  const originalTheme=await page.locator('meta[name="theme-color"]').getAttribute('content');
  await page.locator('[data-home-detail="planner"]').first().click();await page.locator('.recommendation-title').waitFor();
  await page.locator('#basketInput').fill('30');await page.waitForFunction(()=>document.querySelector('.recommendation-title')?.textContent==='Use 2 accounts');await page.locator('#basketInput').blur();
  await page.waitForFunction(()=>document.querySelector('meta[name="theme-color"]').content==='#0e1015');
  assert.equal(await page.locator('#view-planner .detail-view-head').evaluate(e=>getComputedStyle(e).animationName),'none','Header stays crisp during page entry');
  await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});
  const rows=page.locator('.plan-accounts .plan-row');
  assert.equal(await rows.count(),2);
  assert.deepEqual(await page.locator('.plan-promo').allTextContents(),['£12 off · £15 minimum','£12 off · £15 minimum']);
  assert.deepEqual(await page.locator('.plan-subtotal').allTextContents(),['Basket £15 · Fee £1','Basket £15 · Fee £1']);
  assert.deepEqual(await page.locator('.plan-payment strong').allTextContents(),['£4.00','£4.00']);
  assert.deepEqual(await page.locator('.plan-login').allTextContents(),['Sign in with iCloud','Sign in with Google']);
  assert.ok((await rows.nth(1).innerText()).includes(emails[1]));
  assert.doesNotMatch(await page.locator('.plan-accounts').innerText(),/Selected merchants|Delivery only|Apply promo code/);
  await rows.first().locator('[data-account-offers]').click();
  await page.locator('.offer-terms > summary').first().click();
  const details=await page.locator('.offer-terms').first().innerText();
  assert.match(details,/Selected merchants · confirm in Uber/);assert.match(details,/Delivery · pickup excluded/);assert.match(details,/Apply promo code in Uber/);
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!history.state?.trackerSheet);
  await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});

  if(large)await page.addStyleTag({content:'.nav-btn{font-size:24px!important;min-height:100px!important}#view-planner :is(.plan-account,.plan-login,.plan-promo,.plan-subtotal,.plan-payment small,summary,.planner-privacy){font-size:20px!important}'});
  for(const [top,bottom]of width<980?[[0,0],[62,34]]:[[0,0]]){
   // Explicitly simulated insets test CSS ownership; they do not emulate native iPhone chrome.
   await page.evaluate(({top,bottom})=>{
    document.documentElement.style.setProperty('--planner-safe-top',top+'px');
    document.documentElement.style.setProperty('--planner-safe-bottom',bottom+'px');
    dispatchEvent(new Event('resize'));scrollTo(0,0);
   },{top,bottom});
   if(width<980)await page.waitForFunction(()=>{
    const nav=document.querySelector('.bottom-nav'),s=getComputedStyle(nav);
    return Math.abs(parseFloat(getComputedStyle(document.body).paddingBottom)-(nav.getBoundingClientRect().height+parseFloat(s.bottom)+16))<1.1;
   });
   const layout=await page.evaluate(()=>{
    const head=document.querySelector('#view-planner .detail-view-head');
    const rect=e=>{const r=e.getBoundingClientRect();return{top:r.top,bottom:r.bottom,height:r.height,right:r.right};};
    const ancestors=[];for(let e=head;e;e=e.parentElement){const s=getComputedStyle(e);ancestors.push({filter:s.filter,backdrop:s.backdropFilter||s.webkitBackdropFilter,overflowY:s.overflowY});}
    const background=getComputedStyle(document.body,'::before');
    return{header:rect(head),ancestors,background:{height:parseFloat(background.height),color:background.backgroundColor,filter:background.filter},nav:rect(document.querySelector('.bottom-nav')),padding:parseFloat(getComputedStyle(document.body).paddingBottom),overflow:document.documentElement.scrollWidth>innerWidth};
   });
   if(width<980){assert.equal(layout.header.top,top+24,'Only the shell applies the top inset');assert.equal(layout.background.height,top);assert.equal(layout.background.color,'rgb(14, 16, 21)');assert.equal(layout.background.filter,'none');if(large)assert.ok(layout.nav.height>100,'Clearance follows actual enlarged dock height');}
   for(const ancestor of layout.ancestors){assert.ok(ancestor.filter==='none'||ancestor.filter==='blur(0px)');assert.equal(ancestor.backdrop,'none');assert.ok(!['clip','hidden'].includes(ancestor.overflowY),'No ancestor clips vertical page scrolling');}
   assert.equal(layout.overflow,false);
   for(const expanded of [false,true]){
    await page.locator('#plannerOtherOptions').evaluate((e,open)=>{if(e.open!==open)e.querySelector('summary').click();},expanded);
    const controls=['#plannerOtherOptions > summary','.planner-matching-action','[data-open-sheet="advanced"]'];
    if(expanded)controls.splice(1,0,'[data-select-plan]');
    for(const selector of controls){
     const control=page.locator('#view-planner '+selector).first();
     await control.evaluate(e=>{e.focus({preventScroll:true});e.scrollIntoView({block:'end',behavior:'instant'});});
     if(width<980)assert.ok(await control.evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=document.querySelector('.bottom-nav').getBoundingClientRect().top-15;}),'Control can scroll above the dock: '+selector+' '+JSON.stringify({width,height,large,top,bottom,expanded}));
    }
    await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));
    if(width<980){const end=await page.locator('.planner-privacy').evaluate(e=>({footer:e.getBoundingClientRect().bottom,dock:document.querySelector('.bottom-nav').getBoundingClientRect().top,padding:getComputedStyle(document.body).paddingBottom,scroll:scrollY,height:document.documentElement.scrollHeight}));assert.ok(end.footer<=end.dock-15,'Final content clears the actual dock and safe area '+JSON.stringify({width,height,large,top,bottom,expanded,...end}));}
   }
   checked++;
  }
  // Eligibility remains active even though its restrictions moved out of the default row.
  await page.locator('#plannerFulfilment').selectOption('pickup');assert.equal(await page.locator('.plan-accounts .plan-row').count(),0);
  await page.locator('#plannerFulfilment').selectOption('delivery');assert.equal(await rows.count(),2);
  await page.locator('#basketInput').fill('15');await page.waitForFunction(()=>document.querySelector('.recommendation-title')?.textContent==='Use 1 account');assert.deepEqual(await page.locator('.plan-payment strong').allTextContents(),['£4.00']);
  await page.locator('[data-view="more"]').click();await page.waitForFunction(theme=>document.querySelector('meta[name="theme-color"]').content===theme,originalTheme);
  assert.equal(await page.evaluate(()=>document.documentElement.style.getPropertyValue('--planner-nav-clearance')),'','Planner measurements do not change other screens');
  assert.ok(!/maximum-scale|user-scalable=no/.test(await page.locator('meta[name="viewport"]').getAttribute('content')));
  assert.deepEqual(errors,[]);await context.close();
 }
 assert.equal(writes,0);
 console.log('✓ Planner top inset once, crisp foreground/dark system background, actual dock/large-text/bottom-inset clearance, reachable collapsed/expanded controls, concise private account rows and accessible restrictions, unchanged eligibility and £1 each-order payments: '+checked+' configurations ('+engine+'). Native Safari/Home Screen appearance requires physical testing.');
}finally{await browser.close();server.close();}
