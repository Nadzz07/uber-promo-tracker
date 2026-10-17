import {offerScopeLabel} from './offer-preferences.js';
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// One separate searchable dialog serves Other offers and preferred-promo
// multi-selection. It never expands the short discovery list inline.
export function openOfferCatalogue({choices=[],selected=[],multiple=false,onApply=()=>{},opener=document.activeElement}={}){
 document.getElementById('offerCatalogue')?.remove();
 const dialog=document.createElement('dialog');dialog.id='offerCatalogue';dialog.className='offer-catalogue';dialog.setAttribute('aria-labelledby','offerCatalogueTitle');
 const draft=new Set(selected),rows=multiple?choices:[{key:'all',label:'All offers'},...choices];
 dialog.innerHTML='<form method="dialog"><header><h2 id="offerCatalogueTitle">'+(multiple?'Preferred promos':'Other offers')+'</h2><button value="cancel" aria-label="Close offer picker">×</button></header><label class="catalogue-search"><span>Search offer types</span><input id="catalogueSearch" type="search" placeholder="Search offer types" autocomplete="off"></label><div id="catalogueOptions" class="catalogue-options"></div><p id="catalogueResultCount" role="status"></p>'+(multiple?'<footer><button value="cancel">Cancel</button><button type="button" id="applyPreferred">Save preferences</button></footer>':'')+'</form>';
 document.body.append(dialog);
 const close=()=>{dialog.close();dialog.remove();requestAnimationFrame(()=>{if(opener?.isConnected)opener.focus({preventScroll:true});});};
 const render=()=>{
  const query=dialog.querySelector('#catalogueSearch').value.trim().toLowerCase(),filtered=rows.filter(c=>(c.label||offerScopeLabel(c.key)).toLowerCase().includes(query));
  dialog.querySelector('#catalogueResultCount').textContent=filtered.length+' offer '+(filtered.length===1?'type':'types');
  dialog.querySelector('#catalogueOptions').innerHTML=filtered.length?filtered.map(c=>multiple?'<label class="catalogue-option"><input type="checkbox" value="'+escape(c.key)+'"'+(draft.has(c.key)?' checked':'')+'><span>'+escape(c.label||offerScopeLabel(c.key))+'</span></label>':'<button type="button" class="catalogue-option" data-catalogue-value="'+escape(c.key)+'" aria-pressed="'+draft.has(c.key)+'"><span>'+escape(c.label||offerScopeLabel(c.key))+'</span><span aria-hidden="true">'+(draft.has(c.key)?'✓':'')+'</span></button>').join(''):'<p class="sheet-help">No matching offer types.</p>';
 };
 dialog.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();close();return;}if(e.target.id==='catalogueSearch'&&e.key==='Enter'){e.preventDefault();return;}if(e.target.id==='catalogueSearch'&&e.key==='ArrowDown'){e.preventDefault();dialog.querySelector('.catalogue-option input,button.catalogue-option')?.focus();return;}if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)&&e.target.id!=='catalogueSearch'){
  const controls=[...dialog.querySelectorAll('.catalogue-option button,.catalogue-option input,button.catalogue-option')];if(!controls.length)return;e.preventDefault();const i=controls.indexOf(document.activeElement),next=e.key==='Home'?0:e.key==='End'?controls.length-1:(i+(e.key==='ArrowDown'?1:-1)+controls.length)%controls.length;controls[next].focus();
 }});
 dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
 dialog.addEventListener('click',e=>{if(e.target===dialog){close();return;}const option=e.target.closest('[data-catalogue-value]');if(option){const value=option.dataset.catalogueValue;close();onApply(value);}});
 dialog.addEventListener('change',e=>{if(e.target.matches('[type=checkbox]')){if(e.target.checked)draft.add(e.target.value);else draft.delete(e.target.value);}});
 dialog.querySelector('form').addEventListener('submit',e=>{e.preventDefault();close();});
 dialog.querySelector('#catalogueSearch').addEventListener('input',render);
 dialog.querySelector('#applyPreferred')?.addEventListener('click',()=>{const value=[...draft];close();onApply(value);});
 render();dialog.showModal();dialog.querySelector('#catalogueSearch').focus();
 return {close};
}
