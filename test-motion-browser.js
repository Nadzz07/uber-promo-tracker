import fs from 'node:fs';
import http from 'node:http';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {chromium,webkit,firefox} from 'playwright';
import {execFileSync} from 'node:child_process';
execFileSync(process.execPath,['build-site.js']);
const engineName=process.env.TRACKER_BROWSER_ENGINE||'chromium';
const out=process.env.TRACKER_MOTION_OUTPUT||'outputs/motion-polish.local/'+engineName;fs.mkdirSync(out,{recursive:true});
const files=new Set(fs.readdirSync('dist'));
const server=http.createServer((req,res)=>{const file=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';if(!files.has(file)){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync('dist/'+file));});server.listen(0,'127.0.0.1');await once(server,'listening');
const browser=await ({chromium,webkit,firefox}[engineName]).launch();
try {
 const context=await browser.newContext({viewport:{width:440,height:956},recordVideo:{dir:out,size:{width:440,height:956}},reducedMotion:'no-preference'});
 const p=await context.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto('http://127.0.0.1:'+server.address().port);await p.locator('#scanLabel').filter({hasText:/OPENING/i}).waitFor({state:'hidden'});
 await p.evaluate(()=>{window.__frames=[];window.__long=[];new PerformanceObserver(l=>window.__long.push(...l.getEntries().map(e=>e.duration))).observe({type:'longtask',buffered:true});let last=performance.now();window.__frame=requestAnimationFrame(function tick(now){window.__frames.push(now-last);last=now;window.__frame=requestAnimationFrame(tick);});});
 for(const name of ['accounts','used','more','home','accounts','more']){await p.locator('#mainNav [data-view="'+name+'"]').click();await p.waitForTimeout(120);}
 await p.locator('#view-more [data-open-sheet="appearance"]').click();await p.locator('[data-open-sheet="theme"]').click();await p.waitForTimeout(300);await p.keyboard.press('Escape');await p.waitForTimeout(300);
 await p.locator('#mainNav [data-view="accounts"]').click();await p.locator('#accountTypeTrigger').click();await p.waitForTimeout(200);await p.keyboard.press('Escape');await p.locator('#accountSearch').fill('no-such-account');await p.locator('#accountSearch').fill('');await p.waitForTimeout(300);
 assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.equal(await p.evaluate(()=>getComputedStyle(document.querySelector('.sheet')).willChange),'auto');
 assert.equal(await p.evaluate(()=>getComputedStyle(document.querySelector('.account-list')).transform),'none');assert.deepEqual(errors,[]);
 const metrics=await p.evaluate(()=>{cancelAnimationFrame(window.__frame);const a=window.__frames.slice(2).sort((a,b)=>a-b);return{frames:a.length,medianFrameMs:a[Math.floor(a.length*.5)],p95FrameMs:a[Math.floor(a.length*.95)],framesOver32Ms:a.filter(x=>x>32).length,longTasksMs:window.__long};});
 await p.screenshot({path:out+'/accounts-440.png'});
 await p.emulateMedia({reducedMotion:'reduce'});assert.ok(await p.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches));await p.locator('#mainNav [data-view="more"]').click();await p.waitForTimeout(40);assert.equal(await p.locator('#view-more.active').count(),1);
 const video=p.video();await context.close();await video.saveAs(out+'/interactions.webm');fs.writeFileSync(out+'/profile.json',JSON.stringify({engine:engineName+' desktop mobile emulation',physicalDevice:false,...metrics},null,2));console.log(JSON.stringify(metrics));
}finally{await browser.close();server.close();}
