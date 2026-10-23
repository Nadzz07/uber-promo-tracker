import {PALETTE,paletteForHue,paletteProperties,colourRgb,hslColour,DEFAULT_HUE} from './theme-palette.js';
export {hslColour} from './theme-palette.js';
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

export function colourHsl(value) {
  const [r,g,b] = normaliseColour(value).slice(1).match(/../g).map(v => parseInt(v, 16) / 255);
  const max = Math.max(r,g,b), min = Math.min(r,g,b), delta = max - min, l = (max + min) / 2;
  let h = 0;
  if (delta) h = max === r ? ((g-b) / delta + (g < b ? 6 : 0)) : max === g ? (b-r) / delta + 2 : (r-g) / delta + 4;
  return { hue: h * 60, saturation: delta ? delta / (1 - Math.abs(2*l-1)) * 100 : 0, lightness: l * 100 };
}

// The original wheel stores its exact hex output, including saturation and
// brightness. Convert that output here only; derived tokens must never feed
// back into the picker or overwrite the saved selection.
const themeHue=value=>typeof value==='number'&&Number.isFinite(value)?((value%360)+360)%360:normaliseColour(value)===DEFAULT_COLOUR?DEFAULT_HUE:colourHsl(value).hue;
export function themeTokens(value) {
 const chosen=normaliseColour(value),hue=themeHue(value),p=paletteForHue(hue);
 return {chosen,hue,accent:p.accent,strong:p.softAccent,rgb:colourRgb(p.accent).join(', ')};
}
export function applyThemeTokens(root,value){
 const hue=themeHue(value);
 for(const [key,colour]of Object.entries(paletteProperties(hue)))root.style.setProperty(key,colour);
}
// Original picker presets are inputs, not fixed application accent colours.
export const THEME_PRESETS=[['Lime',[155,234,114]],['Ocean',[128,212,255]],['Violet',[197,160,255]],['Rose',[255,155,184]],['Amber',[255,199,120]]].map(([label,rgb])=>({label,value:'#'+rgb.map(v=>v.toString(16).padStart(2,'0')).join('')}));
