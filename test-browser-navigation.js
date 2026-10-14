// Existing feature checks enter the same tap-through screens as users.
export async function openHomeDetail(page,name) {
  if (await page.locator('#view-'+name+'.active').count()) return;
  if (!await page.locator('#view-home.active').count()) await page.locator('[data-view="home"]').click();
  await page.locator('#view-home [data-home-detail="'+name+'"]').click();
  await page.locator('#view-'+name+'.active').waitFor();
}
