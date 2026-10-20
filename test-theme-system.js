import fs from 'node:fs';
import assert from 'node:assert/strict';
import {PALETTE,ACCENT_TOKENS,cssToken,colourRgb,basePaletteCss} from './theme-palette.js';
import {applyThemeTokens,DEFAULT_COLOUR} from './appearance.js';
import {contrastRatio} from './liquid-glass.js';
const html=fs.readFileSync('index.html','utf8');
for(const file of ['ui-refinements.css','liquid-glass.css','desktop-layout.css','theme-system.css','index.html','parser-test.html','processor-test.html']){
 const source=fs.readFileSync(file,'utf8'),css=file.endsWith('.html')?[...source.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n'):source;
 assert.equal(/#[\da-f]{3,8}\b|rgba?\(|hsla?\(|(?:linear|radial|conic)-gradient\(/i.test(css),false,'Rendered CSS must use only the shared colour tokens: '+file);
 for(const match of css.matchAll(/(?:box-shadow|text-shadow)\s*:\s*([^;}\n]+)/gi))assert.ok(/^(none\b|var\()/.test(match[1].trim()),'No decorative glow/shadow: '+file);
}
assert.ok(html.includes('theme-system.css'));assert.ok(basePaletteCss().includes(PALETTE.screen));
const themes=['#4da3ff','#c5a0ff','#9bea72'],snapshots=[];
for(const theme of themes){const tokens=new Map();applyThemeTokens({style:{setProperty:(key,value)=>tokens.set(key,value)}},theme);snapshots.push(tokens);
 for(const [name,value] of Object.entries(PALETTE))if(!ACCENT_TOKENS.includes(name))assert.equal(tokens.get(cssToken(name)),value,'Fixed '+name+' cannot change with the wheel');
 for(const background of ['screen','sheet','panel','dropdown'])for(const text of ['text','secondary','tertiary','label'])assert.ok(contrastRatio(colourRgb(PALETTE[text]),colourRgb(PALETTE[background]))>=4.5,text+' contrast on '+background);
 assert.ok(contrastRatio(colourRgb(tokens.get('--color-accent')),colourRgb(tokens.get('--color-on-accent')))>=4.5,'Primary button text contrast');
}
for(const name of ACCENT_TOKENS)assert.ok(new Set(snapshots.map(s=>s.get(cssToken(name)))).size>1,'Accent family must change together: '+name);
assert.equal(DEFAULT_COLOUR,PALETTE.accent.toLowerCase());
console.log('✓ Sole palette registry; no literal UI colours/gradients/glows; three accent families; fixed neutrals/statuses; text/button contrast.');
