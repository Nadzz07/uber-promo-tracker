import fs from 'node:fs';
import assert from 'node:assert/strict';
import {PALETTE,ACCENT_TOKENS,cssToken,colourRgb,basePaletteCss,paletteProperties,paletteForHue,DEFAULT_HUE} from './theme-palette.js';
import {applyThemeTokens,DEFAULT_COLOUR,themeTokens,hslColour} from './appearance.js';
import {contrastRatio} from './liquid-glass.js';
const html=fs.readFileSync('index.html','utf8');
for(const file of ['icon-layout.css','ui-refinements.css','liquid-glass.css','desktop-layout.css','theme-system.css','receipt-insights.css','planner-design.css','index.html','parser-test.html','processor-test.html']){
 const source=fs.readFileSync(file,'utf8'),css=file.endsWith('.html')?[...source.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n'):source;
 assert.equal(/#[\da-f]{3,8}\b|rgba?\(|hsla?\(/i.test(css),false,'Rendered CSS must use only shared colour tokens: '+file);
 for(const gradient of css.matchAll(/(?:linear|radial|conic)-gradient\(([^;]+)/gi))assert.ok(gradient[1].includes('var('),'Fades use theme tokens: '+file);
}
assert.ok(html.includes('theme-system.css'));assert.ok(basePaletteCss().includes(PALETTE.screen));
const snapshots=[];
for(const hue of [283,210,24,338,160]){
 const tokens=new Map();applyThemeTokens({style:{setProperty:(key,value)=>tokens.set(key,value)}},hue);snapshots.push(tokens);const p=paletteForHue(hue);
 for(const [name,value]of Object.entries(PALETTE))if(!ACCENT_TOKENS.includes(name))assert.equal(tokens.get(cssToken(name)),value,'Fixed '+name+' cannot change with the wheel');
 assert.equal(p.accent,hslColour(hue,96,74));assert.equal(p.selected,hslColour(hue,22,28));assert.equal(p.accentLine,hslColour(hue,68,66));
 for(const background of ['screen','sheet','panel','dropdown','selected','selectedBottom'])for(const text of (background.startsWith('selected')?['selectedText','selectedStrong','selectedSubtitle','selectedNote']:['text','secondary','tertiary']))assert.ok(contrastRatio(colourRgb(p[text]),colourRgb(p[background]))>=4.5,text+' contrast on '+background+' at '+hue);
 for(const stop of ['bright','accentLine'])assert.ok(contrastRatio(colourRgb(p[stop]),colourRgb(p.onAccent))>=4.5,'Primary button contrast at '+hue);
 assert.ok(contrastRatio(colourRgb(p.chipText),colourRgb(p.chip))>=4.5);
}
for(const name of ACCENT_TOKENS)assert.ok(new Set(snapshots.map(s=>s.get(cssToken(name)))).size>1,'Hue family changes together: '+name);
assert.equal(DEFAULT_HUE,283);assert.equal(DEFAULT_COLOUR,PALETTE.accent.toLowerCase());assert.equal(themeTokens(DEFAULT_COLOUR).hue,283);
assert.deepEqual(paletteProperties(NaN),paletteProperties(DEFAULT_HUE));
for(let hue=0;hue<360;hue++){
 const stops=paletteProperties(hue)['--theme-account-primary'].match(/#[a-f0-9]{6}/gi);
 for(const stop of stops)assert.ok(contrastRatio(colourRgb(stop),colourRgb(paletteForHue(hue).onAccent))>=4.5,'Reference button contrast across the complete wheel at '+hue);
}
console.log('✓ One hue registry, default 283; five hue families; shared fades/components; fixed neutral/status roles; text, selected-card, chip and gradient-button contrast.');
