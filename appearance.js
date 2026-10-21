import {PALETTE,ACCENT_TOKENS,cssToken,colourRgb,RICH_PALETTE,RICH_ACCENTS,richCssToken} from './theme-palette.js';
import {contrastRatio} from './liquid-glass.js';
export const THEME_KEY = 'uber-eats-promo-tracker:theme:v1';
export const DEFAULT_COLOUR = PALETTE.accent.toLowerCase();
export const LAYOUT_KEY = 'uber-eats-promo-tracker:layout:v1';

export function normaliseLayout(value) {
  return ['mobile', 'desktop'].includes(value) ? value : 'auto';
}

export function resolveLayout(value, viewportWidth) {
  const preference = normaliseLayout(value);
  return preference === 'auto' ? (Number(viewportWidth) >= 980 ? 'desktop' : 'mobile') : preference;
}

export function normaliseColour(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value.toLowerCase() : DEFAULT_COLOUR;
}

export function hslColour(hue, saturation, lightness) {
  const h = ((hue % 360) + 360) % 360 / 60;
  const s = Math.max(0, Math.min(100, saturation)) / 100;
  const l = Math.max(0, Math.min(100, lightness)) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(h % 2 - 1)), m = l - c / 2;
  const parts = [[c,x,0],[x,c,0],[0,c,x],[0,x,c],[x,0,c],[c,0,x]][Math.floor(h)];
  return '#' + parts.map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
}

export function colourHsl(value) {
  const [r,g,b] = normaliseColour(value).slice(1).match(/../g).map(v => parseInt(v, 16) / 255);
  const max = Math.max(r,g,b), min = Math.min(r,g,b), delta = max - min, l = (max + min) / 2;
  let h = 0;
  if (delta) h = max === r ? ((g-b) / delta + (g < b ? 6 : 0)) : max === g ? (b-r) / delta + 2 : (r-g) / delta + 4;
  return { hue: h * 60, saturation: delta ? delta / (1 - Math.abs(2*l-1)) * 100 : 0, lightness: l * 100 };
}

export function themeTokens(value) {
  const chosen = normaliseColour(value);
  let rgb = chosen.slice(1).match(/../g).map(v => parseInt(v, 16));
  const luminance = channels => channels.map(v => { const x = v / 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; })
    .reduce((sum, v, i) => sum + v * [.2126,.7152,.0722][i], 0);
  // Dark selections keep their hue while becoming readable on the dark glass.
  while ((luminance(rgb) + .05) / (luminance(colourRgb(PALETTE.panel)) + .05) < 4.5) rgb = rgb.map(v => Math.min(255, v + Math.max(1, Math.ceil((255-v) * .06))));
  const hex = channels => '#' + channels.map(v => v.toString(16).padStart(2, '0')).join('');
  return { chosen, accent: hex(rgb), strong: hex(rgb.map(v => Math.round(v + (255-v) * .2))), rgb: rgb.join(', ') };
}

export function applyThemeTokens(root, value) {
  const chosen=normaliseColour(value),baseHue=colourHsl(PALETTE.accent).hue,delta=colourHsl(chosen).hue-baseHue;
  for(const [name,base] of Object.entries(PALETTE)) {
    let colour=base;
    if(ACCENT_TOKENS.includes(name)&&chosen!==DEFAULT_COLOUR.toLowerCase()) {const hsl=colourHsl(base);colour=hslColour(hsl.hue+delta,hsl.saturation,hsl.lightness);}
    if(name==='accent')colour=themeTokens(chosen).accent;
    root.style.setProperty(cssToken(name),colour);
  }
  root.style.setProperty('--color-panel-rgb',colourRgb(PALETTE.panel).join(','));
  root.style.setProperty('--color-accent-rgb',colourRgb(themeTokens(chosen).accent).join(','));
  const rich={};
  for(const [name,base] of Object.entries(RICH_PALETTE)){
    const hsl=colourHsl(base);
    rich[name]=RICH_ACCENTS.includes(name)&&chosen!==DEFAULT_COLOUR? hslColour(hsl.hue+delta,hsl.saturation,hsl.lightness):base;
  }
  // Hue rotation preserves HSL lightness, but green has much higher luminance
  // than blue. Tone the derived surfaces (and purple button stops) so every
  // gradient endpoint retains contrast. The approved default blue is exact.
  if(chosen!==DEFAULT_COLOUR){
    const tone=(name,texts,direction)=>{const hsl=colourHsl(rich[name]);for(let i=0;i<100&&texts.some(text=>contrastRatio(colourRgb(rich[name]),colourRgb(rich[text]))<4.6);i++){hsl.lightness=Math.max(0,Math.min(100,hsl.lightness+direction));rich[name]=hslColour(hsl.hue,hsl.saturation,hsl.lightness);}};
    for(const name of ['selectedTop','selectedBottom'])tone(name,['secondary','positive'],-.6);
    tone('chip',['chipText'],-.6);
    for(const name of ['buttonTop','buttonBottom'])tone(name,['onAccent'],.6);
  }
  for(const [name,colour] of Object.entries(rich))root.style.setProperty(richCssToken(name),colour);
}
// Preset hue choices remain available without embedding UI colours elsewhere.
export const THEME_PRESETS=[['Lime',[155,234,114]],['Ocean',[128,212,255]],['Violet',[197,160,255]],['Rose',[255,155,184]],['Amber',[255,199,120]]].map(([label,rgb])=>({label,value:'#'+rgb.map(v=>v.toString(16).padStart(2,'0')).join('')}));
