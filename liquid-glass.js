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
export function materialPalette(background = [14,16,21], accent = [197,160,255]) {
  const safe = rgb => rgb.map(v => Math.max(0,Math.min(255,Number(v)||0)));
  const sample = safe(background), tint = sample.map(v=>Math.min(36,Math.round(18+v*.06)));
  const opacity = Math.max(.84,Math.min(.94,.84+luminance(sample)*.10));
  // Prove contrast against the brightest possible underlying pixel, including
  // images/gradients that cannot be sampled from a web page's DOM. Blur and
  // displacement cannot exceed that bound. Typography is never blend-mode text.
  // Include the specular layer and selected capsule, both white-tinted, in
  // the bound as well as the underlying backdrop.
  const worst = tint.map(v => ((v*opacity+255*(1-opacity))*.94+255*.06)*.925+255*.075);
  let vibrant = safe(accent);
  while (contrastRatio(vibrant,worst)<4.5) vibrant=vibrant.map(v=>Math.min(255,v+(255-v)*.15+1));
  return { tint, opacity, text:[246,246,250], secondary:[212,214,224], accent:vibrant.map(Math.ceil), worst };
}

export function createLiquidNavigation(nav) {
  const doc=nav.ownerDocument, win=doc.defaultView, glider=nav.querySelector('.nav-glider');
  const motion=win.matchMedia('(prefers-reduced-motion: reduce)');
  const states={x:{value:0,velocity:0},y:{value:0,velocity:0},width:{value:0,velocity:0},height:{value:0,velocity:0},flex:{value:0,velocity:0}};
  const targets={x:0,y:0,width:0,height:0,flex:0};
  let frame=0, last=0, initialized=false, hapticPending=false, disposed=false;
  const ns='http://www.w3.org/2000/svg', make=(name, attrs)=>{const el=doc.createElementNS(ns,name);for(const [key,value] of Object.entries(attrs))el.setAttribute(key,value);return el;};
  // WebKit currently parses url() backdrop filters but does not render them.
  // Apply the shader only to renderers known to support it; Safari keeps the
  // same accessible foreground, springs, edge reflection and depth material.
  const refractive=/Chrome\/|Chromium\/|Edg\//.test(win.navigator.userAgent)&&!/iPhone|iPad|iPod/.test(win.navigator.userAgent)&&win.CSS.supports('backdrop-filter','url("#tracker-liquid-lens")');
  const svg=make('svg',{'aria-hidden':'true',width:'0',height:'0',class:'liquid-filter-defs'}),defs=make('defs',{});
  const filter=make('filter',{id:'tracker-liquid-lens',x:'0',y:'0',width:'100%',height:'100%','color-interpolation-filters':'sRGB',filterUnits:'objectBoundingBox'});
  const map=make('feImage',{result:'curvature',preserveAspectRatio:'none',x:'0',y:'0',width:'100%',height:'100%'});
  filter.append(make('feGaussianBlur',{in:'SourceGraphic',stdDeviation:'2',result:'soft-backdrop'}),map,make('feDisplacementMap',{in:'soft-backdrop',in2:'curvature',scale:'18',xChannelSelector:'R',yChannelSelector:'G',result:'refracted'}),make('feGaussianBlur',{in:'refracted',stdDeviation:'.3',result:'polished'}),make('feColorMatrix',{in:'polished',type:'saturate',values:'1.12'}));
  defs.append(filter);svg.append(defs);doc.body.append(svg);
  nav.dataset.material=refractive?'refractive':'accessible-glass';
  function lens() {
    if(!refractive)return;
    const width=Math.max(1,Math.round(nav.clientWidth)),height=Math.max(1,Math.round(nav.clientHeight));
    const canvas=doc.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(width,height),radius=Math.min(width,height)/2;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const cx=Math.max(radius,Math.min(width-radius,x)),cy=Math.max(radius,Math.min(height-radius,y));
      const dx=x-cx,dy=y-cy,distance=Math.hypot(dx,dy),depth=radius-distance;
      const curvature=distance>0?Math.max(0,1-Math.max(0,depth)/18)**2:0,index=(y*width+x)*4;
      pixels.data[index]=Math.round(128+(distance?dx/distance:0)*110*curvature);
      pixels.data[index+1]=Math.round(128+(distance?dy/distance:0)*110*curvature);
      pixels.data[index+2]=128;pixels.data[index+3]=255;
    }
    ctx.putImageData(pixels,0,0);map.setAttribute('href',canvas.toDataURL('image/png'));
    nav.style.backdropFilter='url("#tracker-liquid-lens")';
  }
  function adaptiveMaterial() {
    const rect=nav.getBoundingClientRect(),samples=[];
    for(const fraction of [.15,.5,.85]){
      const under=doc.elementsFromPoint(rect.left+rect.width*fraction,rect.top+rect.height/2).find(el=>el!==nav&&!nav.contains(el)&&el!==svg);
      let current=under;
      while(current){
        const raw=win.getComputedStyle(current).backgroundColor.match(/[\d.]+/g)?.map(Number);
        if(raw&&raw.length>=3&&(raw[3]??1)>.8){samples.push(raw.slice(0,3));break;}
        current=current.parentElement;
      }
    }
    const sample=samples.sort((a,b)=>luminance(b)-luminance(a))[0]||[14,16,21];
    const colour=win.getComputedStyle(doc.documentElement).getPropertyValue('--accent-rgb').split(',').map(Number);
    const palette=materialPalette(sample,colour.length===3?colour:undefined);
    nav.style.setProperty('--liquid-tint',palette.tint.join(','));nav.style.setProperty('--liquid-opacity',palette.opacity);
    nav.style.setProperty('--liquid-accent',`rgb(${palette.accent.join(',')})`);
  }
  function paint() {
    glider.style.width=states.width.value+'px';glider.style.height=states.height.value+'px';
    glider.style.transform=`translate3d(${states.x.value}px,${states.y.value}px,0) scale(${1+states.flex.value},${1-states.flex.value*.4})`;
    glider.style.setProperty('--fluid-flex',Math.min(1,Math.abs(states.flex.value)*30));
  }
  function tick(time) {
    frame=0;if(disposed||doc.hidden)return;
    const dt=last?Math.min((time-last)/1000,.032):1/60;last=time;
    let moving=false;
    for(const key of Object.keys(states)){
      const before=states[key];states[key]=springStep(before,targets[key],dt,key==='flex'?{stiffness:600,damping:28}:undefined);
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
  function wake(){if(!frame&&!motion.matches&&!doc.hidden)frame=win.requestAnimationFrame(tick);}
  function setTarget(next,{immediate=false}={}){
    Object.assign(targets,next);
    if(!initialized||immediate||motion.matches){for(const key of Object.keys(next))states[key]={value:next[key],velocity:0};initialized=true;paint();}
    else wake();
  }
  function pointerDown(event){
    if(event.isPrimary===false||(event.pointerType==='mouse'&&event.button!==0)||motion.matches)return;
    const rect=nav.getBoundingClientRect();nav.style.setProperty('--liquid-light-x',Math.max(0,Math.min(100,(event.clientX-rect.left)/rect.width*100))+'%');
    states.flex.velocity=-.72;hapticPending=event.pointerType==='touch'&&typeof win.navigator.vibrate==='function';adaptiveMaterial();wake();
  }
  let sampleFrame=0;
  function scheduleMaterial(){if(!sampleFrame)sampleFrame=win.requestAnimationFrame(()=>{sampleFrame=0;adaptiveMaterial();});}
  function motionChange(){hapticPending=false;if(motion.matches){win.cancelAnimationFrame(frame);frame=0;states.flex={value:0,velocity:0};for(const key of ['x','y','width','height'])states[key]={value:targets[key],velocity:0};paint();}}
  const resize=new win.ResizeObserver(()=>{lens();scheduleMaterial();});resize.observe(nav);
  const theme=new win.MutationObserver(scheduleMaterial);theme.observe(doc.documentElement,{attributes:true,attributeFilter:['style','data-layout']});
  nav.addEventListener('pointerdown',pointerDown);win.addEventListener('scroll',scheduleMaterial,{passive:true});motion.addEventListener('change',motionChange);
  lens();adaptiveMaterial();
  return {setTarget,dragTo:next=>setTarget(next,{immediate:true}),refreshMaterial:scheduleMaterial,destroy(){disposed=true;win.cancelAnimationFrame(frame);win.cancelAnimationFrame(sampleFrame);resize.disconnect();theme.disconnect();svg.remove();nav.removeEventListener('pointerdown',pointerDown);win.removeEventListener('scroll',scheduleMaterial);motion.removeEventListener('change',motionChange);}};
}
