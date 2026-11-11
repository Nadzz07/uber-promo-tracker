import {navigate,openMoreDestination} from './test-browser-navigation.js';
import fs from 'node:fs';import http from 'node:http';import assert from 'node:assert/strict';import {once} from 'node:events';import {execFileSync} from 'node:child_process';import {chromium,webkit,firefox} from 'playwright';
execFileSync(process.execPath,['build-site.js']);
const files=new Map(fs.readdirSync('dist').filter(f=>fs.statSync('dist/'+f).isFile()).map(f=>[f,fs.readFileSync('dist/'+f)]));
const server=http.createServer((req,res)=>{const f=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';if(!files.has(f))return res.writeHead(404).end();res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':f.endsWith('.json')?'application/json':'text/html');res.end(files.get(f));});server.listen(0,'127.0.0.1');await once(server,'listening');
const engine=process.env.TRACKER_BROWSER_ENGINE||'chromium',browser=await{chromium,webkit,firefox}[engine].launch(),out=process.env.TRACKER_MAIN_SCREENSHOTS;
if(out)fs.mkdirSync(out,{recursive:true});
const reports=[];
try{for(const [width,large,accent]of [[440,false,'#4da3ff'],[440,false,'#b184f5'],[390,false,'#4da3ff'],[320,false,'#e47d3d'],[440,true,'#b184f5']]){
 const p=await browser.newPage({viewport:{width,height:956},reducedMotion:'reduce'});const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.addInitScript(accent=>localStorage.setItem('uber-eats-promo-tracker:theme:v1',accent),accent);await p.goto('http://127.0.0.1:'+server.address().port);await p.waitForFunction(()=>document.getElementById('scanLabel').textContent==='Updated');
 if(large)await p.addStyleTag({content:'.main-screen :is(p,button,input,select,small,.account-email,.used-email,.more-title,.stat-label){font-size:20px!important}'});
 const styles=[];
 for(const view of['home','accounts','more']){
  await p.locator('[data-view='+view+']').click();await p.locator('#view-'+view+'.active').waitFor();await p.evaluate(()=>scrollTo(0,0));
  const s=await p.evaluate(view=>{
   const root=document.querySelector('#view-'+view),card=root.querySelector(({home:'.stat-card',accounts:'.directory-card',more:'.more-group-list'})[view]),heading=root.querySelector('h1'),nav=document.querySelector('#mainNav');
   const style=el=>{const s=getComputedStyle(el);return {background:s.backgroundImage,border:s.borderTopColor,radius:s.borderTopLeftRadius};};
   // The latest Home-only reference approves its charcoal dock finish. Keep an
   // exact material check there and strict parity for untouched Accounts/More.
   const probe=document.createElement('span');probe.style.cssText='position:absolute;visibility:hidden;background-color:var(--data-screen);background-image:linear-gradient(160deg,var(--data-screen),var(--data-card-bottom));border:1px solid color-mix(in srgb,var(--color-accent) 15%,var(--data-border));border-radius:999px';nav.parentElement.append(probe);const homeDock=style(probe),homeSolid=getComputedStyle(probe).backgroundColor;probe.remove();
   const buttons=[...nav.querySelectorAll('.nav-btn')],rects=buttons.map(b=>b.getBoundingClientRect()),centres=rects.map(r=>r.left+r.width/2),r=nav.getBoundingClientRect();
   return {cardWidth:card?.getBoundingClientRect().width,body:getComputedStyle(document.body).backgroundImage,card:card&&style(card),title:view==='home'?null:getComputedStyle(heading).fontSize,nav:style(nav),homeDock,homeSolid,solid:getComputedStyle(nav).backgroundColor,columns:getComputedStyle(nav).gridTemplateColumns.split(' ').length,labels:buttons.map(b=>b.textContent.trim()),targets:rects.map(r=>({width:r.width,height:r.height})),centres,dock:{left:r.left,right:r.right},gutter:root.getBoundingClientRect().left,active:nav.querySelector('[aria-current=page]')?.dataset.view,overflow:document.documentElement.scrollWidth>innerWidth};
  },view);
  assert.equal(s.overflow,false,view+' page overflow');assert.equal(s.active,view);assert.ok(s.card,view+' real card');styles.push(s);
  if(out&&!large)await p.screenshot({path:`${out}/${engine}-${width}-${accent.slice(1)}-${view}.png`});
 }
 for(const [i,s]of styles.entries()){
  assert.ok(s.body.includes('gradient'),'Every page retains its fade');assert.ok(Math.abs(s.gutter-styles[0].gutter)<=1,'Shared page gutters');assert.ok(s.card.radius,'Cards retain rounded surfaces');
  assert.deepEqual(s.nav,i===0?s.homeDock:styles[1].nav,i===0?'Home dock matches its approved charcoal finish':'Accounts and More keep the identical shared dock material');
  assert.equal(s.nav.radius,'999px');assert.equal(s.columns,3);assert.deepEqual(s.labels,['Home','Accounts','More']);assert.ok(s.targets.every(t=>t.width>=44&&t.height>=44),'Comfortable targets on every page');assert.ok(Math.abs((s.centres[1]-s.centres[0])-(s.centres[2]-s.centres[1]))<1,'Three destinations stay evenly spaced');assert.notEqual(s.solid,'rgba(0, 0, 0, 0)','Dock retains its solid fallback');
  if(i===0){assert.equal(s.solid,s.homeSolid,'Home fallback matches its page paint');assert.ok(s.dock.left>=11&&s.dock.right<=width-11,'Home retains its approved outer breathing room');}
 }
 assert.equal(new Set(styles.slice(1).map(s=>s.title)).size,1,'Equal Accounts/More title sizes');
 await navigate(p,'accounts');assert.deepEqual(await p.locator('[data-login-filter]').allTextContents(),['All 236','Can log in 214','Can’t log in 22']);
 if(width===440&&!large){const rects=await p.locator('#accountPreferredChips button').evaluateAll(es=>es.map(e=>({top:e.getBoundingClientRect().top,left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right})));assert.equal(rects.length,4);assert.ok(rects.every(r=>Math.abs(r.top-rects[0].top)<2),'Offer chips keep one horizontal row');assert.notEqual(await p.locator('#accountPreferredChips').evaluate(e=>getComputedStyle(e).maskImage),'none','Overflow has the reference edge fade');assert.ok(await p.locator('#accountPreferredChips button').evaluateAll(es=>es.every(e=>e.scrollWidth<=e.clientWidth+1)),'Chip labels remain complete');}
 await p.locator('#accountSearch').fill('nothing-matches.invalid');assert.equal(await p.locator('#accountsList [data-account-offers]').count(),0);await p.locator('[data-view=more]').click();await navigate(p,'accounts');assert.equal(await p.locator('#accountSearch').inputValue(),'nothing-matches.invalid');await p.locator('#accountSearch').fill('');
 await p.locator('[data-view=more]').click();assert.equal(await p.locator('#view-more [data-open-sheet=device]').count(),0);assert.equal(await p.locator('#view-more [data-open-sheet=health]').count(),1);
 await p.locator('#view-more [data-jump-planner]').click();assert.equal(await p.locator('.main-screen.active').count(),0);assert.equal(await p.evaluate(()=>getComputedStyle(document.querySelector('#app')).getPropertyValue('--theme-account-panel').trim()),await p.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--theme-account-panel').trim()),'Main-page material aliases do not alter detail routes');await p.reload();assert.equal(await p.evaluate(()=>localStorage.getItem('uber-eats-promo-tracker:theme:v1')),accent);assert.deepEqual(errors,[]);reports.push({width,large,accent,styles});await p.close();
}if(out)fs.writeFileSync(out+'/'+engine+'-results.json',JSON.stringify(reports,null,2));console.log('✓ Three main pages: exact approved dock materials, common controls and navigation geometry, matched title scale, three wheel accents, 440/390/320 widths, larger text, chip fit, search/state and preference persistence ('+engine+').');}finally{await browser.close();server.close();}
