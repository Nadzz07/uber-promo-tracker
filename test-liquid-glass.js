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
