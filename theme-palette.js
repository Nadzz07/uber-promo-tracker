// The sole fixed colour registry. Every rendered UI colour comes from these
// tokens or the selected accent's hue rotation; private/user data is unrelated.
export const PALETTE = Object.freeze({
 screen:'#0B0E13',dimmed:'#10141A',sheet:'#0E1218',panel:'#161A21',border:'#272C35',outline:'#3B414C',dropdown:'#12161C',dropdownBorder:'#30363F',close:'#171B22',closeBorder:'#2C323C',
 text:'#FFFFFF',secondary:'#97A1AF',tertiary:'#8A93A1',label:'#C4CCD8',icon:'#C9D0DB',
 accent:'#4DA3FF',toggle:'#2F8CFF',onAccent:'#06121F',softAccent:'#8CC4FF',link:'#7BBAFF',selected:'#0D2140',selectedBorder:'#2F66B3',selectedDivider:'#25446E',termsDivider:'#2F4F7C',track:'#263752',record:'#0F2A52',chip:'#163E75',chipText:'#A9D1FF',selectedText:'#D3DCEA',selectedStrong:'#E1E8F2',selectedSubtitle:'#AEBCD0',selectedNote:'#9DB0C9',manageOutline:'#36507A',selectedChevron:'#9FB0C6',
 positive:'#7FE0A8',positiveFill:'#0F2A1C',positiveBorder:'#25583C',positiveDot:'#3DDC84',warningFill:'#1C1911',warningBorder:'#4B3F1D',warningIcon:'#E8B84A',warningText:'#D6B45E',warningChevron:'#C9AB5C'
});
export const ACCENT_TOKENS=['accent','toggle','onAccent','softAccent','link','selected','selectedBorder','selectedDivider','termsDivider','track','record','chip','chipText','selectedText','selectedStrong','selectedSubtitle','selectedNote','manageOutline','selectedChevron'];
// Receipt Insights and Planner share the approved rich surface variant. Other
// screens retain their existing matte surfaces and status roles.
export const RICH_PALETTE=Object.freeze({screen:'#090D14',dimmed:'#0F1622',sheetTop:'#141E2E',sheetMid:'#0D131C',sheetBottom:'#0A0F16',panelTop:'#1C2431',panelBottom:'#171E29',border:'#2C3546',secondary:'#A5B0C2',tertiary:'#8B97AB',positive:'#5BE49B',positiveFill:'#0E3322',positiveBorder:'#1F7A4D',positiveDot:'#34D27B',buttonTop:'#66B6FF',buttonBottom:'#2F8CFF',onAccent:'#04101F',softAccent:'#7CC2FF',tag:'#6DB6FF',selectedTop:'#16396C',selectedBottom:'#0C2244',selectedBorder:'#2F7BE0',selectedDivider:'#2A5189',chip:'#1B4D9A',chipBorder:'#3C8CFF',chipText:'#C3E0FF',track:'#22324D',progressEnd:'#6CC4FF'});
export const RICH_ACCENTS=['buttonTop','buttonBottom','onAccent','softAccent','tag','selectedTop','selectedBottom','selectedBorder','selectedDivider','chip','chipBorder','chipText','track','progressEnd'];
export const richCssToken=name=>'--rich-'+name.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());
export const cssToken = name => '--color-'+name.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());
export const colourRgb = hex => hex.slice(1).match(/../g).map(v=>parseInt(v,16));
export const basePaletteCss = () => ':root{'+Object.entries(PALETTE).map(([key,value])=>cssToken(key)+':'+value+';').join('')+Object.entries(RICH_PALETTE).map(([key,value])=>richCssToken(key)+':'+value+';').join('')+'--color-panel-rgb:'+colourRgb(PALETTE.panel).join(',')+';--color-accent-rgb:'+colourRgb(PALETTE.accent).join(',')+';}';
