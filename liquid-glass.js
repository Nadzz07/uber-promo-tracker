import {PALETTE,colourRgb} from './theme-palette.js';
// A small, local-only material for navigation. It never captures the screen,
// copies private DOM content, requests media access or sends samples anywhere.
export function springStep(state, target, dt, { mass = 1, stiffness = 480, damping = 32 } = {}) {
  const elapsed = Math.min(Math.max(dt, 0), .032), steps = Math.max(1, Math.ceil(elapsed / .008));
  let { value, velocity } = state;
  for (let i = 0; i < steps; i++) {
    const h = elapsed / steps;
    velocity += ((target - value) * stiffness - velocity * damping) / mass * h;
    value += velocity * h;
  }
  return { value, velocity };
}
const linear = value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
export function luminance(rgb) { return rgb.reduce((sum, value, i) => sum + linear(value / 255) * [.2126,.7152,.0722][i], 0); }
export function contrastRatio(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); }
export function materialPalette(background = colourRgb(PALETTE.panel), accent = colourRgb(PALETTE.accent)) {
  const safe = rgb => rgb.map(v => Math.max(0,Math.min(255,Number(v)||0)));
  const tint=colourRgb(PALETTE.panel),opacity=1,worst=tint;
  let vibrant=safe(accent);
  while(contrastRatio(vibrant,worst)<4.5)vibrant=vibrant.map(v=>Math.min(255,v+(255-v)*.15+1));
  return {tint,opacity,text:colourRgb(PALETTE.text),secondary:colourRgb(PALETTE.label),accent:vibrant.map(Math.ceil),worst};
}

export function createLiquidNavigation(nav) {
  const doc=nav.ownerDocument, win=doc.defaultView, glider=nav.querySelector('.nav-glider');
  const motion=win.matchMedia('(prefers-reduced-motion: reduce)');
  const isReduced=()=>motion.matches||nav.dataset?.motion==='reduced';
  const states={x:{value:0,velocity:0},y:{value:0,velocity:0},width:{value:0,velocity:0},height:{value:0,velocity:0},flex:{value:0,velocity:0}};
  const targets={x:0,y:0,width:0,height:0,flex:0};
  let frame=0, last=0, initialized=false, hapticPending=false, disposed=false, paletteKey='';
  // Matte navigation has a fixed, contrast-proven surface. It needs no
  // backdrop sampling, refraction canvas, blur filter or scroll-time readback.
  nav.dataset.material='matte';
  function adaptiveMaterial() {
    if(disposed||doc.hidden)return;
    const colour=win.getComputedStyle(doc.documentElement).getPropertyValue('--accent-rgb').split(',').map(Number);
    const palette=materialPalette(undefined,colour.length===3?colour:undefined),key=JSON.stringify(palette.accent);
    if(key===paletteKey)return;paletteKey=key;
    nav.style.setProperty('--liquid-accent','var(--color-accent)');
  }
  function paint() {
    const width=states.width.value+'px',height=states.height.value+'px';
    if(glider.style.width!==width)glider.style.width=width;
    if(glider.style.height!==height)glider.style.height=height;
    glider.style.transform=`translate3d(${states.x.value}px,${states.y.value}px,0) scale(${1+states.flex.value},${1-states.flex.value*.4})`;
    glider.style.setProperty('--fluid-flex',Math.min(1,Math.abs(states.flex.value)*30));
  }
  function tick(time) {
    frame=0;if(disposed||doc.hidden)return;
    const dt=last?Math.min((time-last)/1000,.032):1/60;last=time;
    let moving=false;
    for(const key of Object.keys(states)){
      const before=states[key];states[key]=springStep(before,targets[key],dt,key==='flex'?{stiffness:600,damping:28}:{stiffness:760,damping:48});
      if(key==='flex'&&hapticPending&&before.velocity<0&&states[key].velocity>=0){
        hapticPending=false;
        // One best-effort tick at measured maximum deflection. iOS Safari has
        // no Vibration API; failed/unavailable haptics never delay navigation.
        try{win.navigator.vibrate?.(8);}catch{}
      }
      if(Math.abs(states[key].value-targets[key])>.015||Math.abs(states[key].velocity)>.015)moving=true;
      else states[key]={value:targets[key],velocity:0};
    }
    paint();if(moving)frame=win.requestAnimationFrame(tick);else last=0;
  }
  function wake(){if(!disposed&&!frame&&!isReduced()&&!doc.hidden)frame=win.requestAnimationFrame(tick);}
  function setTarget(next,{immediate=false}={}){
    Object.assign(targets,next);
    if(!initialized||immediate||isReduced()){for(const key of Object.keys(next))states[key]={value:next[key],velocity:0};initialized=true;paint();}
    else wake();
  }
  function pointerDown(event){
    if(event.isPrimary===false||(event.pointerType==='mouse'&&event.button!==0)||isReduced())return;
    const rect=nav.getBoundingClientRect();nav.style.setProperty('--liquid-light-x',Math.max(0,Math.min(100,(event.clientX-rect.left)/rect.width*100))+'%');
    states.flex.velocity=-.72;hapticPending=event.pointerType==='touch'&&typeof win.navigator.vibrate==='function';adaptiveMaterial();wake();
  }
  let sampleFrame=0;
  function scheduleMaterial(){if(!disposed&&!doc.hidden&&!sampleFrame)sampleFrame=win.requestAnimationFrame(()=>{sampleFrame=0;adaptiveMaterial();});}
  function visibilityChange(){if(doc.hidden){win.cancelAnimationFrame(frame);win.cancelAnimationFrame(sampleFrame);frame=sampleFrame=last=0;}else{scheduleMaterial();wake();}}
  function motionChange(){hapticPending=false;if(isReduced()){win.cancelAnimationFrame(frame);frame=0;states.flex={value:0,velocity:0};for(const key of ['x','y','width','height'])states[key]={value:targets[key],velocity:0};paint();}}
  const resize=new win.ResizeObserver(()=>{scheduleMaterial();});resize.observe(nav);
  const theme=new win.MutationObserver(scheduleMaterial);theme.observe(doc.documentElement,{attributes:true,attributeFilter:['style','data-layout']});
  nav.addEventListener('pointerdown',pointerDown);motion.addEventListener('change',motionChange);
  doc.addEventListener('visibilitychange',visibilityChange);
  adaptiveMaterial();
  return {setTarget,dragTo:next=>setTarget(next,{immediate:true}),refreshMaterial:scheduleMaterial,refreshMotion:motionChange,destroy(){disposed=true;win.cancelAnimationFrame(frame);win.cancelAnimationFrame(sampleFrame);resize.disconnect();theme.disconnect();nav.removeEventListener('pointerdown',pointerDown);motion.removeEventListener('change',motionChange);doc.removeEventListener('visibilitychange',visibilityChange);}};
}
