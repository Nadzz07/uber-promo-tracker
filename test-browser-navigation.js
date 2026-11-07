// Existing feature checks enter the same tap-through screens as users.
export async function openHomeDetail(page,name) {
  if (await page.locator('#view-'+name+'.active').count()) return;
  if (!await page.locator('#view-home.active').count()) await navigate(page,'home');
  await page.locator('#view-home [data-home-detail="'+name+'"]').click();
  await page.locator('#view-'+(name==='offers'?'accounts':name)+'.active').waitFor();
  if(name==='offers'&&await page.locator('#accountTypeOptions').isVisible())await page.keyboard.press('Escape');
}

export async function directoryStatus(page,value) {
 const key=({all:'active',tracked:'active',offers:'active',unfinished:'active',used:'finished','expired-unused':'expired',pending:'review'}[value]||value);
 if(!await page.locator('#accountShowOptions').isVisible())await page.locator('#accountShowTrigger').click();await page.locator('[data-show-accounts="'+key+'"]').click();
}
export async function directoryType(page,value) {
 if(!await page.locator('#accountTypeOptions').isVisible())await page.locator('#accountTypeTrigger').click();const main=page.locator('[data-offer-type="'+value+'"]');if(await main.count())await main.click();else{await page.locator('[data-offer-type="other"]').click();await page.locator('[data-catalogue-value="'+value+'"]').click();}
}
export async function directoryReset(page) {
 await page.locator('#accountSearch').fill('');await page.locator('[data-login-filter="all"]').click();await page.locator('#accountProvider').selectOption('all');
 await directoryType(page,'all');
 await directoryStatus(page,'active');
}

// Availability now composes the visible Show and login controls.
export async function directoryAvailability(page,value) {
 await directoryStatus(page,value==='archived'?'archived':value==='attention'?'review':'active');
 await page.locator('[data-login-filter="'+(value==='ready'?'login':'all')+'"]').click();
}

// Back/Forward and ResizeObserver updates can finish after goBack resolves.
// Wait for stable scroll and dock geometry before the next pointer action.
export async function settlePageLayout(page) {
 await page.evaluate(()=>new Promise(resolve=>{let previous='',stable=0;function frame(){const nav=document.getElementById('mainNav'),r=nav.getBoundingClientRect(),signature=[scrollY,document.documentElement.scrollHeight,innerHeight,r.top,r.height,getComputedStyle(document.body).paddingBottom].join('|');stable=signature===previous?stable+1:0;previous=signature;if(stable>=6)resolve();else requestAnimationFrame(frame);}requestAnimationFrame(frame);}));
}
export async function backToDirectory(page) {
 await page.goBack();await page.locator('#view-accounts.active').waitFor();await page.waitForFunction(()=>history.state?.trackerView==='accounts');await settlePageLayout(page);
}
export async function scrollAboveDock(page,selector) {
 await page.locator(selector).focus();await settlePageLayout(page);
 await page.waitForFunction(()=>{const n=document.getElementById('mainNav'),s=getComputedStyle(n);return Math.abs(parseFloat(getComputedStyle(document.body).paddingBottom)-(n.getBoundingClientRect().height+parseFloat(s.bottom)+16))<1.1;});
 await page.locator(selector).evaluate(e=>e.scrollIntoView({block:'end',behavior:'instant'}));await settlePageLayout(page);
}

export async function usedStatus(page,value){await page.locator('#usedStatus').click();await page.locator('[data-status-option="'+value+'"]').click();}

export async function finderAllOffers(page){await directoryType(page,'all');}

export async function openOfferManagement(page, key = null) {
 const card=key?page.locator('[data-offer-key="'+key+'"]'):page.locator('.offer-card').first();
 if(await card.count()&&await card.getAttribute('open')===null)await card.locator('>summary').click();
 const trigger=card.locator('[data-manage-toggle]');if(await trigger.count()){if(await trigger.getAttribute('aria-expanded')!=='true')await trigger.click();}else{const panel=card.locator('.manage-offer').first();if(await panel.count()&&await panel.getAttribute('open')===null)await panel.locator('>summary').click();}
}

// Exercise the actual import location, then return to Private finances.
export async function importPrivateFinance(page,file){
 if(await page.locator('#sheetBackdrop.open').count()) {await page.locator('#sheetClose').click();await page.locator('#sheetBackdrop.open').waitFor({state:'hidden'});}
 await openMoreDestination(page,'health');
 await page.locator('[data-device-file]').setInputFiles(file);
 await page.locator('[data-device-confirm]').click();
 await page.getByText('Backup restored on this device.',{exact:true}).waitFor();
 // Leave Sync & data open; callers return through its actual Close action.
}

// Browser tests follow the same responsive navigation as the app.
export async function navigate(page,view) {
 await settlePageLayout(page);
 const desktop=await page.evaluate(()=>matchMedia('(min-width:768px)').matches);
 if(desktop){if(view==='more')throw Error('More is mobile-only; select a desktop sidebar destination.');await page.locator('.desktop-sidebar [data-sidebar-view="'+view+'"]').click();}
 else await page.locator('#mainNav [data-view="'+view+'"]').click();
}
export async function openMoreDestination(page,destination) {
 if(await page.evaluate(()=>matchMedia('(min-width:768px)').matches))await page.locator('.desktop-sidebar [data-sidebar-key="'+destination+'"]').click();
 else {await navigate(page,'more');await page.locator('#view-more '+(destination==='help'?'[data-open-guide]':destination==='planner'?'[data-jump-planner]':'[data-open-sheet="'+destination+'"]')).click();}
}

// Compact offers require opening the offer before its inline terms are visible.
export async function clickOfferTerms(page) {
 const terms=page.locator('.offer-terms').first(),card=terms.locator('xpath=ancestor::details[contains(@class,"account-detail-offer")]');
 if(await card.count()&&await card.getAttribute('open')===null)await card.locator('>summary').click();
 await terms.locator('>summary').click();
}

export async function openReviewCard(page,receiptId=null) {
 const card=receiptId?page.locator('.review-card:has([data-ri-receipt="'+receiptId+'"])'):page.locator('.review-card').first();
 if(await card.getAttribute('open')===null)await card.locator('>summary').click();
}

export async function waitForMoreParent(page) {
 const view=await page.evaluate(()=>matchMedia('(min-width:768px)').matches?'home':'more');
 await page.locator('#view-'+view+'.active').waitFor();
}
