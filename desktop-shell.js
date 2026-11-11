import {financeIcon} from './finance-layout.js';
// The sidebar reuses More's destinations. No duplicate routes or account data.
export function createDesktopShell({app,more,onNavigate,onDesktop}) {
 const wide=matchMedia('(min-width:768px)'),sidebar=document.createElement('aside');sidebar.className='desktop-sidebar';sidebar.setAttribute('aria-label','App sidebar');
 sidebar.innerHTML='<a class="sidebar-brand" href="#home" aria-label="Promo Tracker Home"><span class="sidebar-brand-mark" aria-hidden="true">'+financeIcon('tag')+'</span><span class="sidebar-brand-copy"><small>Uber Eats</small><strong>Promo Tracker</strong></span></a><nav class="sidebar-navigation" aria-label="Desktop navigation"><div class="sidebar-primary"><button data-sidebar-view="home" data-sidebar-key="home" aria-label="Home" title="Home">'+financeIcon('home')+'<span class="sidebar-label">Home</span></button><button data-sidebar-view="accounts" data-sidebar-key="accounts" aria-label="Accounts" title="Accounts">'+financeIcon('users')+'<span class="sidebar-label">Accounts</span></button></div></nav><div class="sidebar-footer"><span class="sidebar-status-dot" aria-hidden="true"></span><span class="sidebar-label">Your private promo tracker</span></div>';
 const nav=sidebar.querySelector('nav');
 for(const group of more.querySelectorAll('.more-group')){
  const section=document.createElement('section');section.className='sidebar-group';const heading=document.createElement('h2');heading.className='sidebar-group-heading';heading.textContent=group.querySelector('h2').textContent;section.append(heading);
  for(const source of group.querySelectorAll('.more-card')){const button=document.createElement('button'),title=source.querySelector('.more-title').textContent,key=source.hasAttribute('data-jump-planner')?'planner':source.hasAttribute('data-open-guide')?'help':source.dataset.openSheet;
   for(const attribute of source.attributes)if(attribute.name.startsWith('data-'))button.setAttribute(attribute.name,attribute.value);
   button.dataset.sidebarKey=key;button.type='button';button.title=title;button.setAttribute('aria-label',title);const icon=source.querySelector('[data-icon]')?.dataset.icon||'info';button.innerHTML=financeIcon(icon)+'<span class="sidebar-label">'+title+'</span>'+(key==='locked'?'<span class="sidebar-count" data-sidebar-count aria-label="Archived account count"></span>':'');section.append(button);
  }nav.append(section);
 }
 app.prepend(sidebar);const placeholder=document.createElement('section');placeholder.className='desktop-detail-placeholder';placeholder.innerHTML=financeIcon('users')+'<h2>Account details</h2><p>Select an account to view its offers and records.</p>';document.getElementById('view-accounts').append(placeholder);
 document.addEventListener('toggle',event=>{if(!wide.matches||!event.target.open||!event.target.matches('.sr-receipt,.review-card'))return;for(const other of event.target.parentElement.querySelectorAll(event.target.matches('.sr-receipt')?'.sr-receipt[open]':'.review-card[open]'))if(other!==event.target)other.open=false;},true);
 // The table is a desktop projection of the existing transaction rows. Receipt IDs
 // and delegated open handlers stay unchanged; resizing never edits financial data.
 const tableObserver=new MutationObserver(()=>{if(wide.matches)requestAnimationFrame(enhanceTables);});
 function enhanceTables(){if(!wide.matches)return;for(const list of app.querySelectorAll('.fi-transactions:not([data-desktop-table])')){
  list.dataset.desktopTable='true';const source=[...list.querySelectorAll('.fi-transaction')];if(!source.length)continue;
  const table=document.createElement('table');table.className='desktop-transactions';table.setAttribute('aria-label','Transactions');
  const head=table.createTHead().insertRow(),body=table.createTBody();let sort='day',direction=-1;
  const columns=[['day','Date'],['merchant','Merchant'],['type','Type'],['card','Card'],['value','Amount']];
  const records=source.map(button=>({id:button.dataset.riReceipt,day:button.dataset.transactionDay,merchant:button.querySelector('span>strong')?.textContent||button.querySelector('strong')?.textContent||'',type:button.dataset.transactionType,card:button.dataset.transactionCard,value:Number(button.dataset.transactionValue),amount:button.lastElementChild.textContent}));
  function render(){body.replaceChildren();const ordered=[...records].sort((a,b)=>(sort==='value'?a.value-b.value:String(a[sort]).localeCompare(String(b[sort])))*direction);let day;
   for(const record of ordered){if(sort==='day'&&record.day!==day){day=record.day;const group=body.insertRow();group.className='desktop-day';const th=document.createElement('th');th.colSpan=5;th.scope='rowgroup';th.textContent=day||'Date not recorded';group.append(th);}
    const row=body.insertRow();row.dataset.riReceipt=record.id;row.tabIndex=0;row.setAttribute('aria-label',record.merchant+', '+record.amount);for(const key of ['day','merchant','type','card','amount'])row.insertCell().textContent=record[key]||'—';
    row.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();row.click();}if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();const rows=[...body.querySelectorAll('[data-ri-receipt]')],i=rows.indexOf(row);rows[Math.max(0,Math.min(rows.length-1,i+(event.key==='ArrowDown'?1:-1)))]?.focus();}});
   }for(const th of head.cells)th.setAttribute('aria-sort',th.dataset.sort===sort?(direction===1?'ascending':'descending'):'none');
  }
  for(const[key,label]of columns){const th=document.createElement('th');th.scope='col';th.dataset.sort=key;const button=document.createElement('button');button.textContent=label+' ↕';button.addEventListener('click',()=>{direction=sort===key?-direction:1;sort=key;render();});th.append(button);head.append(th);}render();list.prepend(table);
 }}
 tableObserver.observe(app,{childList:true,subtree:true});wide.addEventListener('change',()=>{if(wide.matches)enhanceTables();});

 const click=event=>{const button=event.target.closest('[data-sidebar-view]');if(button)onNavigate(button.dataset.sidebarView);};
 const keyboard=event=>{if(!wide.matches)return;const editable=event.target.closest('input,textarea,select,[contenteditable=true]');if(event.key==='/'&&!editable&&!event.metaKey&&!event.ctrlKey&&!event.altKey){const search=app.querySelector('.view.active input[type=search]');if(search){event.preventDefault();search.focus();}return;}
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key)||!nav.contains(event.target))return;const buttons=[...nav.querySelectorAll('button:not(:disabled)')],i=buttons.indexOf(event.target.closest('button'));if(i<0)return;event.preventDefault();buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(i+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length].focus({preventScroll:true});};
 const media=()=>{sidebar.inert=!wide.matches;if(wide.matches)onDesktop();};sidebar.addEventListener('click',click);document.addEventListener('keydown',keyboard);wide.addEventListener('change',media);sidebar.inert=!wide.matches;
 const keyForView={home:'home',accounts:'accounts',planner:'planner',receipts:'receipts',savings:'savings',finance:'finance',sync:'health',settings:'appearance',help:'help','preferred-promos':'appearance','preferred-catalogue':'appearance'};
 return {update({view,sheet,archived=0}){const key=['locked','about'].includes(sheet)?sheet:keyForView[view];for(const button of nav.querySelectorAll('button')){const active=button.dataset.sidebarKey===key;button.classList.toggle('active',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}const count=sidebar.querySelector('[data-sidebar-count]');if(count)count.textContent=archived.toLocaleString('en-GB');sidebar.dataset.activeDestination=key||'';},destroy(){tableObserver.disconnect();sidebar.removeEventListener('click',click);document.removeEventListener('keydown',keyboard);wide.removeEventListener('change',media);sidebar.remove();}};
}
