// Existing feature checks enter the same tap-through screens as users.
export async function openHomeDetail(page,name) {
  if (await page.locator('#view-'+name+'.active').count()) return;
  if (!await page.locator('#view-home.active').count()) await page.locator('[data-view="home"]').click();
  await page.locator('#view-home [data-home-detail="'+name+'"]').click();
  await page.locator('#view-'+name+'.active').waitFor();
}

export async function leaveReceiptEditor(page) {
 const back=page.locator('[data-finance-action="receipt-overview"]:visible').first();
 if(await back.isVisible()) await back.click();
}

export async function openReceiptPayments(page) {
 const panel=page.locator('.receipt-payment-card');
 if(await panel.count()&&await panel.getAttribute('open')===null)await panel.locator('summary').click();
}

export async function openFinanceHistory(page) {
 const panel=page.locator('[data-finance-panel="history"]');
 if(await panel.getAttribute('open')===null)await panel.locator('summary').first().click();
 const more=page.locator('[data-finance-action="history-more"]');
 if(await more.isVisible())await more.click();
}

export async function directoryStatus(page,value) {
 const panel=page.locator('#accountSecondaryFilters');if(await panel.getAttribute('open')===null)await panel.locator('summary').click();await page.locator('#accountScope').selectOption(value);
}
export async function directoryType(page,value) {
 await page.locator('#accountTypeTrigger').click();await page.locator('[data-offer-type="'+value+'"]').click();
}
export async function directoryReset(page) {
 await page.locator('#accountSearch').fill('');await page.locator('[data-login-filter="all"]').click();await page.locator('#accountProvider').selectOption('all');
 if(await page.locator('#clearAccountType').isEnabled())await page.locator('#clearAccountType').click();
 const panel=page.locator('#accountSecondaryFilters');if(await panel.getAttribute('open')===null)await panel.locator('summary').click();await page.locator('[data-reset-secondary]').click();
}

export async function directoryAvailability(page,value) { const panel=page.locator('#accountSecondaryFilters');if(await panel.getAttribute('open')===null)await panel.locator('summary').click();await page.locator('#accountOfferScope').selectOption(value); }
