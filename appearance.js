export const THEME_KEY = 'uber-eats-promo-tracker:theme:v1';
export const DEFAULT_COLOUR = '#9bea72';

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
  while ((luminance(rgb) + .05) / (luminance([12,19,17]) + .05) < 7) rgb = rgb.map(v => Math.min(255, v + Math.max(1, Math.ceil((255-v) * .06))));
  const hex = channels => '#' + channels.map(v => v.toString(16).padStart(2, '0')).join('');
  return { chosen, accent: hex(rgb), strong: hex(rgb.map(v => Math.round(v + (255-v) * .2))), rgb: rgb.join(', ') };
}
