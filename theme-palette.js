// One hue input for every surface and accent. Fixed semantic roles never rotate.
export const DEFAULT_HUE=283;
export function hslColour(hue,saturation,lightness){
 const h=((hue%360)+360)%360/60,s=Math.max(0,Math.min(100,saturation))/100,l=Math.max(0,Math.min(100,lightness))/100;
 const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs(h%2-1)),m=l-c/2;
 return '#'+[[c,x,0],[x,c,0],[0,c,x],[0,x,c],[x,0,c],[c,0,x]][Math.floor(h)].map(v=>Math.round((v+m)*255).toString(16).padStart(2,'0')).join('');
}
const FIXED=Object.freeze({panel:'#1D2127',panelBottom:'#181C21',border:'#2C3038',outline:'#2C3038',dropdown:'#181C21',dropdownBorder:'#2C3038',close:'#181C21',closeBorder:'#2C3038',text:'#F4F4F8',secondary:'#C0C4CC',tertiary:'#9CA0B0',label:'#C0C4CC',icon:'#C0C4CC',positive:'#80DC8C',positiveFill:'#122A1D',positiveBorder:'#2F6B45',positiveDot:'#80DC8C',warningFill:'#2D230C',warningBorder:'#6B5518',warningIcon:'#FFC845',warningText:'#F0C75E',warningChevron:'#F0C75E',statsBottom:'#1A1D24'});
export function paletteForHue(hue=DEFAULT_HUE){
 const h=Number.isFinite(Number(hue))?((Number(hue)%360)+360)%360:DEFAULT_HUE,c=(s,l)=>hslColour(h,s,l);
 return {...FIXED,screen:c(12,6),dimmed:c(14,8),sheet:c(14,8),backgroundBottom:c(22,11),accent:c(96,74),softAccent:c(94,84),bright:c(96,81),accentLine:c(68,66),pale:c(90,91),accentFill:c(24,30),toggle:c(68,66),onAccent:c(60,8),link:c(96,74),selected:c(22,28),selectedBottom:c(20,19),selectedBorder:c(68,66),selectedDivider:c(24,36),termsDivider:c(24,36),track:c(20,19),record:c(22,28),chip:c(24,30),chipText:c(90,91),selectedText:FIXED.secondary,selectedStrong:FIXED.text,selectedSubtitle:FIXED.secondary,selectedNote:FIXED.secondary,manageOutline:c(24,36),selectedChevron:c(94,84),activeTab:c(26,26),activeTabBottom:c(24,19),activeTabBorder:c(24,36),stats:c(20,15),statsBorder:c(18,22)};
}
export const PALETTE=Object.freeze(paletteForHue());
export const ACCENT_TOKENS=Object.keys(PALETTE).filter(key=>!(key in FIXED)&&!['selectedText','selectedStrong','selectedSubtitle','selectedNote'].includes(key));
// Compatibility names point into the same palette, not a second colour family.
export function richPalette(p){return {screen:p.screen,dimmed:p.dimmed,sheetTop:p.screen,sheetMid:p.sheet,sheetBottom:p.backgroundBottom,panelTop:p.panel,panelBottom:p.panelBottom,border:p.border,secondary:p.secondary,tertiary:p.tertiary,positive:p.positive,positiveFill:p.positiveFill,positiveBorder:p.positiveBorder,positiveDot:p.positiveDot,buttonTop:p.bright,buttonBottom:p.accentLine,onAccent:p.onAccent,softAccent:p.softAccent,tag:p.link,selectedTop:p.selected,selectedBottom:p.selectedBottom,selectedBorder:p.selectedBorder,selectedDivider:p.selectedDivider,chip:p.chip,chipBorder:p.selectedBorder,chipText:p.chipText,track:p.track,progressEnd:p.softAccent};}
export const RICH_PALETTE=Object.freeze(richPalette(PALETTE));
export const RICH_ACCENTS=Object.keys(RICH_PALETTE).filter(key=>!['panelTop','panelBottom','border','secondary','tertiary','positive','positiveFill','positiveBorder','positiveDot'].includes(key));
export const cssToken=name=>'--color-'+name.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());
export const richCssToken=name=>'--rich-'+name.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());
export const colourRgb=hex=>hex.slice(1).match(/../g).map(v=>parseInt(v,16));
function accountButtonStops(hue,ink) {
 const luminance=hex=>colourRgb(hex).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
 const foreground=luminance(ink);let lightness=53;
 while(lightness<78&&(luminance(hslColour(hue,90,lightness))+.05)/(foreground+.05)<4.6)lightness++;
 return [hslColour(hue,94,Math.max(65,lightness+5)),hslColour(hue,90,lightness)];
}
// Keep small hero labels and fixed green savings readable at every wheel hue.
function insightsHeroStop(hue,maxLightness=27){
 const luminance=hex=>colourRgb(hex).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
 let lightness=maxLightness;while(lightness>12&&[FIXED.secondary,FIXED.positive].some(ink=>(luminance(ink)+.05)/(luminance(hslColour(hue,64,lightness))+.05)<4.6))lightness--;
 return hslColour(hue,64,lightness);
}
// Shared material tints used by the existing component layouts.
const MATERIAL_TINTS={
 "--tint-color-accent-14-0-transparent": "color-mix(in srgb,var(--color-accent) 14.0%,transparent)",
 "--tint-color-accent-16-0-transparent": "color-mix(in srgb,var(--color-accent) 16.0%,transparent)",
 "--tint-color-accent-13-0-transparent": "color-mix(in srgb,var(--color-accent) 13.0%,transparent)",
 "--tint-color-accent-46-0-transparent": "color-mix(in srgb,var(--color-accent) 46.0%,transparent)",
 "--tint-color-accent-48-0-transparent": "color-mix(in srgb,var(--color-accent) 48.0%,transparent)",
 "--tint-color-accent-34-0-transparent": "color-mix(in srgb,var(--color-accent) 34.0%,transparent)",
 "--tint-color-accent-6-0-transparent": "color-mix(in srgb,var(--color-accent) 6.0%,transparent)",
 "--tint-color-accent-37-0-transparent": "color-mix(in srgb,var(--color-accent) 37.0%,transparent)",
 "--tint-color-accent-18-0-transparent": "color-mix(in srgb,var(--color-accent) 18.0%,transparent)",
 "--tint-color-accent-24-0-transparent": "color-mix(in srgb,var(--color-accent) 24.0%,transparent)",
 "--tint-color-accent-72-0-transparent": "color-mix(in srgb,var(--color-accent) 72.0%,transparent)",
 "--tint-color-accent-70-0-transparent": "color-mix(in srgb,var(--color-accent) 70.0%,transparent)",
 "--tint-color-accent-19-0-transparent": "color-mix(in srgb,var(--color-accent) 19.0%,transparent)",
 "--tint-color-accent-22-0-transparent": "color-mix(in srgb,var(--color-accent) 22.0%,transparent)",
 "--tint-color-accent-9-0-transparent": "color-mix(in srgb,var(--color-accent) 9.0%,transparent)",
 "--tint-color-accent-25-0-transparent": "color-mix(in srgb,var(--color-accent) 25.0%,transparent)",
 "--tint-color-accent-55-0-transparent": "color-mix(in srgb,var(--color-accent) 55.0%,transparent)",
 "--tint-color-accent-12-0-transparent": "color-mix(in srgb,var(--color-accent) 12.0%,transparent)",
 "--tint-color-accent-35-0-transparent": "color-mix(in srgb,var(--color-accent) 35.0%,transparent)",
 "--tint-color-accent-44-0-transparent": "color-mix(in srgb,var(--color-accent) 44.0%,transparent)",
 "--tint-color-accent-38-0-transparent": "color-mix(in srgb,var(--color-accent) 38.0%,transparent)",
 "--tint-color-accent-20-0-transparent": "color-mix(in srgb,var(--color-accent) 20.0%,transparent)",
 "--tint-color-accent-30-0-transparent": "color-mix(in srgb,var(--color-accent) 30.0%,transparent)",
 "--tint-color-accent-65-0-transparent": "color-mix(in srgb,var(--color-accent) 65.0%,transparent)",
 "--tint-color-accent-8-5-transparent": "color-mix(in srgb,var(--color-accent) 8.5%,transparent)",
 "--tint-color-accent-50-0-transparent": "color-mix(in srgb,var(--color-accent) 50.0%,transparent)",
 "--tint-color-accent-28-0-transparent": "color-mix(in srgb,var(--color-accent) 28.0%,transparent)",
 "--tint-color-accent-8-0-transparent": "color-mix(in srgb,var(--color-accent) 8.0%,transparent)",
 "--tint-color-accent-5-5-transparent": "color-mix(in srgb,var(--color-accent) 5.5%,transparent)",
 "--tint-color-accent-6-5-transparent": "color-mix(in srgb,var(--color-accent) 6.5%,transparent)",
 "--tint-color-accent-7-0-transparent": "color-mix(in srgb,var(--color-accent) 7.0%,transparent)",
 "--tint-color-accent-75-0-transparent": "color-mix(in srgb,var(--color-accent) 75.0%,transparent)",
 "--tint-color-accent-45-0-transparent": "color-mix(in srgb,var(--color-accent) 45.0%,transparent)",
 "--tint-account-accent-65-color-text": "color-mix(in srgb,var(--account-accent) 65%,var(--color-text))",
 "--tint-account-accent-60-color-panel": "color-mix(in srgb,var(--account-accent) 60%,var(--color-panel))",
 "--tint-account-accent-20-color-sheet": "color-mix(in srgb,var(--account-accent) 20%,var(--color-sheet))",
 "--tint-account-accent-7-color-panel": "color-mix(in srgb,var(--account-accent) 7%,var(--color-panel))",
 "--tint-account-accent-72-color-secondary": "color-mix(in srgb,var(--account-accent) 72%,var(--color-secondary))"
};
export function paletteProperties(hue=DEFAULT_HUE){
 hue=Number.isFinite(Number(hue))?((Number(hue)%360)+360)%360:DEFAULT_HUE;
 const p=paletteForHue(hue),props=Object.fromEntries(Object.entries(p).map(([k,v])=>[cssToken(k),v]));
 const accountButtons=accountButtonStops(hue,p.onAccent);
 for(const [k,v]of Object.entries(richPalette(p)))props[richCssToken(k)]=v;
 return {...MATERIAL_TINTS,...props,'--accent-hue':String(hue),'--color-panel-rgb':colourRgb(p.panel).join(','),'--color-accent-rgb':colourRgb(p.accent).join(','),
 '--theme-background':'linear-gradient(180deg,var(--color-screen),var(--color-sheet) 50%,var(--color-background-bottom))',
 '--theme-panel':'linear-gradient(180deg,var(--color-panel),var(--color-panel-bottom))',
 '--theme-primary':'linear-gradient(180deg,var(--color-bright),var(--color-accent-line))',
 '--theme-progress':'linear-gradient(90deg,var(--color-accent-line),var(--color-soft-accent))',
 '--theme-selected':'linear-gradient(145deg,var(--color-selected),var(--color-selected-bottom))',
 '--theme-active-tab':'linear-gradient(180deg,var(--color-active-tab),var(--color-active-tab-bottom))',
 '--theme-stats':'linear-gradient(180deg,var(--color-stats),var(--color-stats-bottom))',
 '--theme-selected-shadow':'0 0 12px color-mix(in srgb,var(--color-accent) 22%,transparent)',
 '--theme-dock-fade':'linear-gradient(180deg,transparent,var(--color-background-bottom) 72%)',
 // Account reference materials keep the chosen hue, with deeper chroma than
 // the general-purpose selected pill. No fixed blue or picker override.
 '--theme-account-page':`linear-gradient(180deg,${hslColour(hue,45,9)},${hslColour(hue,40,5)})`,
 '--color-insights-header':hslColour(hue,70,19),
 '--color-planner-spot':insightsHeroStop(hue,42),
 '--theme-insights-hero':`linear-gradient(140deg,${insightsHeroStop(hue)},${hslColour(hue,68,12)})`,
 '--theme-menu-page':`linear-gradient(180deg,${hslColour(hue,70,19)},${hslColour(hue,65,10)} 50%,${hslColour(hue,52,6)})`,
 '--theme-menu-panel':`linear-gradient(150deg,${hslColour(hue,55,13)},${hslColour(hue,50,9)})`,
 '--color-menu-border':hslColour(hue,43,28),
 '--theme-account-panel':`linear-gradient(145deg,${hslColour(hue,28,13)},${hslColour(hue,30,9)})`,
 '--theme-account-selected':`linear-gradient(145deg,${hslColour(hue,64,22)},${hslColour(hue,64,10)})`,
 '--theme-account-primary':`linear-gradient(180deg,${accountButtons[0]},${accountButtons[1]})`};
}
export const basePaletteCss=()=>':root{'+Object.entries(paletteProperties()).map(([k,v])=>k+':'+v+';').join('')+'}';
