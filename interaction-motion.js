// Native disclosures keep their semantics; only their content is animated.
const motions=new WeakMap();
const reduced=()=>document.documentElement.dataset.motion==='reduced'||matchMedia('(prefers-reduced-motion: reduce)').matches;
export function installInteractionMotion(){
document.addEventListener('click',event=>{
 const summary=event.target.closest('summary');if(!summary||event.target.closest('button,a,input,select,textarea'))return;
 const details=summary.parentElement;if(details.tagName!=='DETAILS'||details.id==='accountOfferHistory')return;
 let state=motions.get(details);
 if(!state){const bodies=[...details.children].filter(node=>node!==summary);if(bodies.length!==1||!['DIV','SECTION','ARTICLE'].includes(bodies[0].tagName))return;const grid=bodies[0],inner=document.createElement('div');grid.classList.add('motion-disclosure');grid.style.display='grid';inner.className='motion-disclosure-inner';for(const node of [...grid.childNodes])inner.append(node);grid.append(inner);state={grid,inner,open:details.open,timer:null};grid.dataset.expanded=String(details.open);motions.set(details,state);}
 event.preventDefault();
 if(!state.timer&&state.open!==details.open){state.open=details.open;state.grid.dataset.expanded=String(details.open);}
 clearTimeout(state.timer);state.timer=null;state.open=!state.open;summary.setAttribute('aria-expanded',String(state.open));
 if(reduced()){details.open=state.open;state.grid.dataset.expanded=String(state.open);return;}
 if(state.open){details.open=true;state.grid.dataset.direction='open';requestAnimationFrame(()=>{if(state.open&&details.isConnected)state.grid.dataset.expanded='true';});}
 else{state.grid.dataset.direction='close';state.grid.dataset.expanded='false';state.timer=setTimeout(()=>{if(!state.open)details.open=false;state.timer=null;},200);}
});

let drag=null;
document.addEventListener('pointerdown',event=>{const handle=event.target.closest('.sheet-handle');if(!handle||drag||!event.isPrimary)return;const sheet=handle.closest('.sheet');if(!sheet||!sheet.closest('.sheet-backdrop.open'))return;drag={handle,sheet,id:event.pointerId,start:event.clientY,offset:0};handle.setPointerCapture(event.pointerId);sheet.style.transition='none';});
document.addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag.id)return;drag.offset=Math.max(0,event.clientY-drag.start);drag.sheet.style.transform='translateY('+drag.offset+'px)';});
function finishDrag(event){if(!drag||event.pointerId!==drag.id)return;const current=drag;drag=null;current.sheet.style.transition=reduced()?'none':'transform 240ms cubic-bezier(.2,.8,.2,1)';current.sheet.style.transform='';if(event.type!=='pointercancel'&&current.offset>100)document.getElementById('sheetClose')?.click();setTimeout(()=>{current.sheet.style.transition='';},240);}
document.addEventListener('pointerup',finishDrag);document.addEventListener('pointercancel',finishDrag);

}
