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

const themeHue=value=>typeof value==='number'&&Number.isFinite(value)?((value%360)+360)%360:normaliseColour(value)===DEFAULT_COLOUR?DEFAULT_HUE:colourHsl(value).hue;
export function themeTokens(value) {
 const chosen=normaliseColour(value),hue=themeHue(value),p=paletteForHue(hue);
 return {chosen,hue,accent:p.accent,strong:p.softAccent,rgb:colourRgb(p.accent).join(', ')};
}
export function applyThemeTokens(root,value){
 const hue=themeHue(value);
 for(const [key,colour]of Object.entries(paletteProperties(hue)))root.style.setProperty(key,colour);
}
export const THEME_PRESETS=[['Purple',DEFAULT_HUE],['Blue',210],['Orange',24],['Pink',338],['Mint',160]].map(([label,hue])=>({label,value:hslColour(hue,96,74)}));
