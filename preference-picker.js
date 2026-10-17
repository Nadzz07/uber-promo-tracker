import {offerScopeLabel,DEFAULT_PREFERRED_PROMOS,validOfferSelection} from './offer-preferences.js';
import {financeIcon} from './finance-layout.js';
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Ordinary discovery uses a separate single-choice catalogue. Favourites are
// edited by the focused child-page controller below.
export function openOfferCatalogue({choices=[],selected=[],onApply=()=>{},opener=document.activeElement}={}){
 document.getElementById('offerCatalogue')?.remove();
 const dialog=document.createElement('dialog');dialog.id='offerCatalogue';dialog.className='offer-catalogue';dialog.setAttribute('aria-labelledby','offerCatalogueTitle');
 const draft=new Set(selected),rows=[{key:'all',label:'All offers'},...choices];
 dialog.innerHTML='<form method="dialog"><header><h2 id="offerCatalogueTitle">'+'Other offers'+'</h2><button value="cancel" aria-label="Close offer picker">×</button></header><label class="catalogue-search"><span>Search offer types</span><input id="catalogueSearch" type="search" placeholder="Search offer types" autocomplete="off"></label><div id="catalogueOptions" class="catalogue-options"></div><p id="catalogueResultCount" role="status"></p>'+'</form>';
 document.body.append(dialog);
 const close=()=>{dialog.close();dialog.remove();requestAnimationFrame(()=>{if(opener?.isConnected)opener.focus({preventScroll:true});});};
 const render=()=>{
  const query=dialog.querySelector('#catalogueSearch').value.trim().toLowerCase(),filtered=rows.filter(c=>(c.label||offerScopeLabel(c.key)).toLowerCase().includes(query));
  dialog.querySelector('#catalogueResultCount').textContent=filtered.length+' offer '+(filtered.length===1?'type':'types');
  dialog.querySelector('#catalogueOptions').innerHTML=filtered.length?filtered.map(c=>'<button type="button" class="catalogue-option" data-catalogue-value="'+escape(c.key)+'" aria-pressed="'+draft.has(c.key)+'"><span>'+escape(c.label||offerScopeLabel(c.key))+'</span><span aria-hidden="true">'+(draft.has(c.key)?'✓':'')+'</span></button>').join(''):'<p class="sheet-help">No matching offer types.</p>';
 };
 dialog.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();close();return;}if(e.target.id==='catalogueSearch'&&e.key==='Enter'){e.preventDefault();return;}if(e.target.id==='catalogueSearch'&&e.key==='ArrowDown'){e.preventDefault();dialog.querySelector('.catalogue-option input,button.catalogue-option')?.focus();return;}if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)&&e.target.id!=='catalogueSearch'){
  const controls=[...dialog.querySelectorAll('.catalogue-option button,.catalogue-option input,button.catalogue-option')];if(!controls.length)return;e.preventDefault();const i=controls.indexOf(document.activeElement),next=e.key==='Home'?0:e.key==='End'?controls.length-1:(i+(e.key==='ArrowDown'?1:-1)+controls.length)%controls.length;controls[next].focus();
 }});
 dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
 dialog.addEventListener('click',e=>{if(e.target===dialog){close();return;}const option=e.target.closest('[data-catalogue-value]');if(option){const value=option.dataset.catalogueValue;close();onApply(value);}});
 dialog.querySelector('form').addEventListener('submit',e=>{e.preventDefault();close();});
 dialog.querySelector('#catalogueSearch').addEventListener('input',render);
 render();dialog.showModal();dialog.querySelector('#catalogueSearch').focus();
 return {close};
}

// Standalone favourites have a draft lifetime across two child pages. Neither
// search nor catalogue navigation writes preferences; only the explicit Save does.
export function createPreferredPromosEditor({page,catalogue,getChoices,getPreferences,onNavigate,onBack,onSave}){
 let draft=null,baseline='',confirmDialog=null;
 const signature=values=>[...values].sort().join('|');
 const search=(id,placeholder)=>'<label class="preferred-search" for="'+id+'">'+financeIcon('search')+'<input id="'+id+'" type="search" placeholder="'+placeholder+'" aria-label="'+placeholder+'" autocomplete="off"></label>';
 page.innerHTML='<button type="button" class="preferred-back" data-preferred-back>'+financeIcon('chevron-left')+'Settings</button><header class="preferred-head"><h1 id="preferredTitle" tabindex="-1">Preferred promos</h1><p>Choose the promos shown first.</p></header>'+search('preferredSearch','Search promos')+
  '<section class="preferred-selection" aria-labelledby="preferredResultsTitle"><div class="preferred-section-head"><h2 id="preferredResultsTitle" tabindex="-1">Selected</h2><span id="preferredSelectedCount" role="status"></span></div><div id="preferredRows" class="preferred-panel"></div><p id="preferredSearchStatus" class="preferred-search-status" role="status" hidden></p></section>'+
  '<section class="preferred-more"><h2>Find more promos</h2><button type="button" id="browsePreferredPromos" class="preferred-browse">'+financeIcon('search')+'<span><strong>Browse other promos</strong><small>Search by discount or minimum spend</small></span>'+financeIcon('chevron-right')+'</button></section>'+
  '<p class="preferred-cash-note">Uber Cash preferences are managed in Settings.</p><button type="button" id="restorePreferred" class="preferred-restore">Restore defaults</button><div class="preferred-save-wrap"><p id="preferredSaveError" role="alert" hidden></p><button type="button" id="savePreferred" class="preferred-save">Save preferences</button><p>Applies to Accounts and Find an offer.</p></div>';
 catalogue.innerHTML='<header class="preferred-catalogue-head"><button type="button" class="preferred-back" data-preferred-back>'+financeIcon('chevron-left')+'Preferred promos</button><button type="button" class="preferred-done" data-preferred-back>Done</button></header><header class="preferred-head"><h1 id="preferredCatalogueTitle" tabindex="-1">Other promos</h1><p>Choose promos to add to your favourites.</p></header>'+search('preferredCatalogueSearch','Search promos')+'<p id="preferredCatalogueCount" class="preferred-search-status" role="status"></p><div id="preferredCatalogueRows" class="preferred-panel"></div><p class="preferred-cash-note">Changes stay in your draft until you save preferences.</p>';
 function choices(){return [...new Map([...DEFAULT_PREFERRED_PROMOS.map(key=>({key})),...getChoices(),...[...(draft||[])].map(key=>({key}))].filter(c=>validOfferSelection(c.key)&&/^(fixed|percent):/.test(c.key)).map(c=>[c.key,{...c,label:offerScopeLabel(c.key)}])).values()].sort((a,b)=>{const x=a.key.split(':'),y=b.key.split(':');return (x[2]==='unknown'?Infinity:Number(x[2]))-(y[2]==='unknown'?Infinity:Number(y[2]))||Number(x[1])-Number(y[1])||a.key.localeCompare(b.key);});}
 const subtitle=key=>key.endsWith(':unknown')?'Minimum spend not shown':'£'+key.split(':')[2]+' minimum spend';
 const matches=(choice,query)=>query.toLocaleLowerCase('en-GB').trim().split(/\s+/).every(term=>(choice.label+' '+subtitle(choice.key)).toLocaleLowerCase('en-GB').includes(term));
 function rowsMarkup(rows){return rows.map(c=>'<label class="preferred-row">'+financeIcon('promo-tag')+'<span class="preferred-row-copy"><strong>'+escape(c.label)+'</strong><small>'+escape(subtitle(c.key))+'</small></span><span class="preferred-checkbox"><input type="checkbox" value="'+escape(c.key)+'" aria-label="'+escape(c.label)+'"'+(draft.has(c.key)?' checked':'')+'>'+financeIcon('check')+'</span></label>').join('');}
 function render(){
  if(!draft)return;
  const query=page.querySelector('#preferredSearch').value,all=choices(),selected=all.filter(c=>draft.has(c.key)),rows=query.trim()?all.filter(c=>matches(c,query)):selected;
  page.querySelector('#preferredSelectedCount').textContent=draft.size+' selected';
  page.querySelector('#preferredResultsTitle').textContent=query.trim()?'Search results':'Selected';
  const empty=query.trim()?'No matching promos. Try a discount or minimum spend.':getPreferences().includeCash?'No standalone promos selected. Uber Cash stays included through Settings.':'No preferred offer categories are enabled. Select a promo or enable Uber Cash in Settings.';
  page.querySelector('#preferredRows').innerHTML=rows.length?rowsMarkup(rows):'<p class="preferred-empty">'+empty+'</p>';
  const status=page.querySelector('#preferredSearchStatus');status.hidden=!query.trim();status.textContent=rows.length+' matching promo '+(rows.length===1?'type':'types');
  const catalogueQuery=catalogue.querySelector('input').value,catalogueRows=all.filter(c=>matches(c,catalogueQuery));
  catalogue.querySelector('#preferredCatalogueCount').textContent=catalogueRows.length+' promo '+(catalogueRows.length===1?'type':'types')+' · '+draft.size+' selected';
  catalogue.querySelector('#preferredCatalogueRows').innerHTML=catalogueRows.length?rowsMarkup(catalogueRows):'<p class="preferred-empty">No matching promos.</p>';
 }
 function changed(event){if(!event.target.matches('input[type=checkbox]'))return;const {value,checked}=event.target,host=event.currentTarget,inputs=[...host.querySelectorAll('input[type=checkbox]')],index=inputs.indexOf(event.target);if(checked)draft.add(value);else draft.delete(value);render();const next=[...host.querySelectorAll('input[type=checkbox]')];(next.find(e=>e.value===value)||next[Math.min(index,next.length-1)]||host.querySelector('h2,h1')).focus({preventScroll:true});}
 for(const host of [page,catalogue]){
  host.addEventListener('change',changed);
  host.querySelector('input[type=search]').addEventListener('input',render);
  host.addEventListener('click',e=>{if(e.target.closest('[data-preferred-back]'))onBack();});
  host.addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.target.matches('input[type=search]')){e.preventDefault();e.stopPropagation();onBack();}if(e.key==='ArrowDown'&&e.target.matches('input[type=search]')){e.preventDefault();host.querySelector('input[type=checkbox]')?.focus();}});
 }
 page.querySelector('#browsePreferredPromos').addEventListener('click',()=>onNavigate('preferred-catalogue'));
 page.querySelector('#restorePreferred').addEventListener('click',()=>{draft=new Set(DEFAULT_PREFERRED_PROMOS);page.querySelector('#preferredSearch').value='';render();});
 page.querySelector('#savePreferred').addEventListener('click',()=>{if(onSave([...draft])===false){const error=page.querySelector('#preferredSaveError');error.hidden=false;error.textContent='Preferences could not be saved. Please try again.';return;}baseline=signature(draft);onBack();});
 return {
  start(){draft=new Set(getPreferences().preferredPromos);baseline=signature(draft);for(const host of [page,catalogue])host.querySelector('input[type=search]').value='';page.querySelector('#preferredSaveError').hidden=true;render();},
  get active(){return draft!==null;},get dirty(){return draft!==null&&signature(draft)!==baseline;},
  end(){draft=null;baseline='';},
  requestDiscard(discard){
   if(confirmDialog)return;
   const opener=document.activeElement,dialog=document.createElement('dialog');confirmDialog=dialog;dialog.className='preferred-discard';dialog.id='discardPreferredChanges';dialog.setAttribute('aria-labelledby','discardPreferredTitle');dialog.setAttribute('aria-describedby','discardPreferredCopy');
   dialog.innerHTML='<h2 id="discardPreferredTitle">Discard unsaved changes?</h2><p id="discardPreferredCopy">Your saved preferred promos will stay unchanged.</p><div><button type="button" data-keep-editing>Keep editing</button><button type="button" data-discard-preferred>Discard changes</button></div>';document.body.append(dialog);
   const close=()=>{dialog.close();dialog.remove();confirmDialog=null;opener?.isConnected&&opener.focus({preventScroll:true});};
   dialog.addEventListener('cancel',e=>{e.preventDefault();close();});dialog.querySelector('[data-keep-editing]').onclick=close;dialog.querySelector('[data-discard-preferred]').onclick=()=>{close();draft=null;baseline='';discard();};dialog.showModal();dialog.querySelector('[data-keep-editing]').focus();
  }
 };
}
