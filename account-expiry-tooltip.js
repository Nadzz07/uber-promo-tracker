import {expiryEndTime} from './offer-time.js';
import {offerCountdown} from './dashboard-data.js';
import {offerTermsRows} from './offer-details.js';

export function directoryExpiry(promo,now=Date.now()) {
 const end=expiryEndTime(promo),estimated=promo.expiryStatus!=='exact'||offerTermsRows(promo).some(r=>r.field==='expiry'&&r.estimated);
 if(end==null)return {label:'Expiry unknown',explanation:'Expiry has not been confirmed',urgent:false};
 const raw=offerCountdown({...promo,expiryStatus:'exact'},now).replace(/^~\s*/,''),days=Math.ceil((end-now)/86400000);
 return {label:(estimated?'~':'')+raw,explanation:estimated?'Estimated from when the offer was added':'Exact expiry from Uber',urgent:days>=0&&days<=3};
}

// One shared bubble. No data mutations or card navigation from this control.
export function createExpiryTooltips(host) {
 const bubble=document.createElement('div');bubble.id='accountExpiryTooltip';bubble.className='account-expiry-tooltip';bubble.setAttribute('role','tooltip');bubble.hidden=true;document.body.append(bubble);
 let active=null,timer=null,pinned=false,lastTouch=0,focusFrame=0,scrollPositions=new Map();
 function close(){cancelAnimationFrame(focusFrame);focusFrame=0;clearTimeout(timer);if(active){active.setAttribute('aria-expanded','false');active.removeAttribute('aria-describedby');}active=null;pinned=false;bubble.hidden=true;}
 function show(button,sticky=false){if(!button||!host.contains(button))return;const same=active===button;close();active=button;pinned=sticky;button.setAttribute('aria-expanded','true');button.setAttribute('aria-describedby',bubble.id);bubble.textContent=button.dataset.expiryExplanation;bubble.hidden=false;
  const r=button.querySelector('.directory-expiry-pill').getBoundingClientRect(),width=bubble.getBoundingClientRect().width,left=Math.max(8,Math.min(innerWidth-width-8,r.right-width));
  const height=bubble.getBoundingClientRect().height,above=r.bottom+8+height>innerHeight-8;bubble.dataset.side=above?'above':'below';
  bubble.style.left=left+'px';bubble.style.top=(above?Math.max(8,r.top-height-8):r.bottom+8)+'px';bubble.style.setProperty('--expiry-arrow-x',Math.max(12,Math.min(width-12,r.left+r.width/2-left))+'px');
  scrollPositions=new Map();for(let node=button;node;node=node.parentElement)scrollPositions.set(node,[node.scrollLeft,node.scrollTop]);scrollPositions.set(document.scrollingElement,[scrollX,scrollY]);
  timer=setTimeout(close,4000);return same;
 }
 // WebKit suppresses the synthetic tap click when touch pointerdown is cancelled.
 host.addEventListener('pointerdown',e=>{const b=e.target.closest('[data-expiry-explanation]');if(b){e.stopPropagation();if(e.pointerType==='touch')lastTouch=Date.now();else e.preventDefault();}});
 host.addEventListener('click',e=>{const b=e.target.closest('[data-expiry-explanation]');if(!b)return;e.stopPropagation();if(active===b&&pinned)close();else show(b,true);});
 host.addEventListener('pointerover',e=>{const b=e.target.closest('[data-expiry-explanation]');if(b&&e.pointerType==='mouse'&&Date.now()-lastTouch>600&&!pinned)show(b);});
 host.addEventListener('pointerout',e=>{if(active&&!pinned&&document.activeElement!==active&&e.target.closest('[data-expiry-explanation]')===active&&!active.contains(e.relatedTarget))close();});
 // Native keyboard focus may scroll its target into view after focusin (WebKit).
 // Position the explanation after that scroll; user wheel/touch input still cancels it.
 host.addEventListener('focusin',e=>{const b=e.target.closest('[data-expiry-explanation]');if(!b)return;close();focusFrame=requestAnimationFrame(()=>{focusFrame=requestAnimationFrame(()=>{focusFrame=0;if(document.activeElement===b&&host.contains(b))show(b);});});});
 host.addEventListener('focusout',e=>{if(!pinned&&e.target.closest('[data-expiry-explanation]'))close();});
 document.addEventListener('pointerdown',e=>{if(active&&!active.contains(e.target)||focusFrame&&!e.target.closest('[data-expiry-explanation]'))close();},true);
 document.addEventListener('focusin',e=>{if(active&&!active.contains(e.target))close();});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&(active||focusFrame)){const ownsFocus=active?.contains(e.target)||focusFrame&&e.target.closest('[data-expiry-explanation]');close();if(ownsFocus)e.stopPropagation();}},true);
 window.addEventListener('scroll',event=>{if(!active)return;const node=event.target===window||event.target===document?document.scrollingElement:event.target,prior=scrollPositions.get(node);if(prior&&prior[0]===node.scrollLeft&&prior[1]===node.scrollTop)return;close();},true);window.addEventListener('wheel',close,{capture:true,passive:true});window.addEventListener('touchmove',close,{capture:true,passive:true});window.addEventListener('resize',close);window.addEventListener('popstate',close);
 return {close};
}
