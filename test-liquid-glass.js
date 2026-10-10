import assert from 'node:assert/strict';import {springStep,materialPalette,contrastRatio} from './liquid-glass.js';
for(const background of [[0,0,0],[255,255,255],[255,0,0],[0,255,0],[0,0,255],[124,127,132]])for(const accent of [[0,0,0],[255,255,255],[105,210,84],[197,160,255],[0,110,145]]){
 const p=materialPalette(background,accent);
 for(const text of [p.text,p.secondary,p.accent])assert.ok(contrastRatio(text,p.worst)>=4.5,'Typography must meet contrast even over white pixels');
}
let state={value:0,velocity:0},peak=0;
for(let i=0;i<180;i++){state=springStep(state,100,1/60);peak=Math.max(peak,state.value);}
assert.ok(peak>100&&peak<112,'Damped spring has restrained physical overshoot');assert.ok(Math.abs(state.value-100)<.01);
let flex={value:0,velocity:-.72},previous=flex.velocity,turns=0,max=0;
for(let i=0;i<80;i++){flex=springStep(flex,0,1/60,{stiffness:600,damping:28});max=Math.min(max,flex.value);if(previous<0&&flex.velocity>=0)turns++;previous=flex.velocity;}
assert.ok(max>-.04&&max<-.005);assert.ok(turns>=1,'Maximum deflection can drive an optional haptic tick');
console.log('✓ Contrast bound against unknown backdrop pixels; damped motion, bounded flex and maximum-deflection haptic timing');

// Material sampling must not repeat identical style writes or survive disposal.
import {createLiquidNavigation} from './liquid-glass.js';
const listeners=new Map(),frames=new Map();let nextFrame=0,writes=0;
const element=()=>({setAttribute(){},append(){},remove(){},style:{setProperty(){writes++;}},getBoundingClientRect:()=>({left:0,top:0,width:320,height:64})});
const root=element(),body=element(),glider=element(),nav=element();
const doc={documentElement:root,body,hidden:false,createElementNS:element,elementsFromPoint:()=>[body],addEventListener:(name,fn)=>listeners.set('doc-'+name,fn),removeEventListener:(name)=>listeners.delete('doc-'+name)};
const motion={matches:false,addEventListener:(name,fn)=>listeners.set('motion-'+name,fn),removeEventListener:(name)=>listeners.delete('motion-'+name)};
const win={navigator:{userAgent:'Safari'},CSS:{supports:()=>false},matchMedia:()=>motion,getComputedStyle:()=>({backgroundColor:'rgb(14,16,21)',getPropertyValue:()=> '197,160,255'}),requestAnimationFrame:fn=>{frames.set(++nextFrame,fn);return nextFrame;},cancelAnimationFrame:id=>frames.delete(id),ResizeObserver:class{observe(){}disconnect(){}},MutationObserver:class{observe(){}disconnect(){}},addEventListener:(name,fn)=>listeners.set('win-'+name,fn),removeEventListener:name=>listeners.delete('win-'+name)};
Object.assign(doc,{defaultView:win});Object.assign(nav,{ownerDocument:doc,querySelector:()=>glider,dataset:{},contains:()=>false,addEventListener:(name,fn)=>listeners.set('nav-'+name,fn),removeEventListener:name=>listeners.delete('nav-'+name)});
const navigation=createLiquidNavigation(nav),initialWrites=writes;
for(let i=0;i<10;i++){navigation.refreshMaterial();const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn(100+i));}
assert.equal(writes,initialWrites,'Unchanged sampled material does not invalidate painted styles');
navigation.setTarget({x:20});doc.hidden=true;listeners.get('doc-visibilitychange')();assert.equal(frames.size,0,'Hidden tabs cancel spring and sample work');
navigation.refreshMaterial();assert.equal(frames.size,0);doc.hidden=false;listeners.get('doc-visibilitychange')();assert.ok(frames.size>0);
navigation.destroy();assert.equal(listeners.size,0);assert.equal(frames.size,0);navigation.refreshMaterial();navigation.setTarget({x:40});assert.equal(frames.size,0,'Disposed navigation cannot schedule new work');
console.log('✓ Stable material sampling, background suspension and complete navigation listener/frame disposal');
