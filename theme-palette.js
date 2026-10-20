// The sole fixed colour registry. Every rendered UI colour comes from these
// tokens or the selected accent's hue rotation; private/user data is unrelated.
export const PALETTE = Object.freeze({
 screen:'#0B0E13',dimmed:'#10141A',sheet:'#0E1218',panel:'#161A21',border:'#272C35',outline:'#3B414C',dropdown:'#12161C',dropdownBorder:'#30363F',close:'#171B22',closeBorder:'#2C323C',
 text:'#FFFFFF',secondary:'#97A1AF',tertiary:'#8A93A1',label:'#C4CCD8',icon:'#C9D0DB',
 accent:'#4DA3FF',toggle:'#2F8CFF',onAccent:'#06121F',softAccent:'#8CC4FF',link:'#7BBAFF',selected:'#0D2140',selectedBorder:'#2F66B3',selectedDivider:'#25446E',termsDivider:'#2F4F7C',track:'#263752',record:'#0F2A52',chip:'#163E75',chipText:'#A9D1FF',selectedText:'#D3DCEA',selectedStrong:'#E1E8F2',selectedSubtitle:'#AEBCD0',selectedNote:'#9DB0C9',manageOutline:'#36507A',selectedChevron:'#9FB0C6',
 positive:'#7FE0A8',positiveFill:'#0F2A1C',positiveBorder:'#25583C',positiveDot:'#3DDC84',warningFill:'#1C1911',warningBorder:'#4B3F1D',warningIcon:'#E8B84A',warningText:'#D6B45E',warningChevron:'#C9AB5C'
});
export const ACCENT_TOKENS=['accent','toggle','onAccent','softAccent','link','selected','selectedBorder','selectedDivider','termsDivider','track','record','chip','chipText','selectedText','selectedStrong','selectedSubtitle','selectedNote','manageOutline','selectedChevron'];
export const cssToken = name => '--color-'+name.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());
export const colourRgb = hex => hex.slice(1).match(/../g).map(v=>parseInt(v,16));
export const basePaletteCss = () => ':root{'+Object.entries(PALETTE).map(([key,value])=>cssToken(key)+':'+value+';').join('')+'--color-panel-rgb:'+colourRgb(PALETTE.panel).join(',')+';--color-accent-rgb:'+colourRgb(PALETTE.accent).join(',')+';}';
