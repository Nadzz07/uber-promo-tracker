// Synthetic data is intercepted in the test browser only, never written to public JSON.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { chromium, webkit } from 'playwright';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
execFileSync(process.execPath, ['build-site.js']);
const allowed = new Set(fs.readdirSync('dist'));
const server = http.createServer((request, response) => {
  const file = new URL(request.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!allowed.has(file)) { response.writeHead(404); response.end(); return; }
  response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.json') ? 'application/json' : file.endsWith('.css') ? 'text/css' : 'text/html');
  response.end(fs.readFileSync('dist/' + file));
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const url = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  const engine = process.env.TRACKER_BROWSER_ENGINE === 'webkit' ? webkit : chromium;
  browser = await engine.launch(engine === chromium ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {});
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'America/Los_Angeles' });
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // First-sync behaviour must not depend on the user's checked-in live data.
  await page.route('**/promos.json?*', route => route.fulfill({ json: { schemaVersion: 3, configured: false, generatedAt: null, accounts: [], promos: [], summary: {} } }));
  await page.route('**/history.json?*', route => route.fulfill({ json: { updatedAt: null, records: [] } }));
  await page.goto(url); await page.waitForFunction(() => document.getElementById('scanLabel').textContent === 'READY');
  assert.equal(await page.locator('#usableStat').innerText(), '0');
  assert.equal(await page.locator('.account-card').count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const time = new Date().toISOString();
  const offer = { id: 'test-offer-1', accountRef: 'A001', accountMasked: 'al…ha@example.invalid', canLogin: true, service: 'Uber Eats', title: '£10 off on 5 orders', discountType: 'fixed', discount: 10, minimumSpend: 15, uses: 5, usesRemaining: 4, receiptConfirmedUses: 1, expires: '2099-12-31', expiresAt: '2099-12-31T23:59:59', expiryStatus: 'exact', trackingState: 'available', receiptState: 'partial', emailSentAt: time };
  const offers = [offer,
    { ...offer, id: 'test-review', accountRef: 'A002', accountMasked: 're…ew@example.invalid', discount: 50, trackingState: 'needs_checking', expires: null, expiresAt: null, expiryStatus: 'unknown', emailSentAt: null, firstEmailSentAt: null },
    { ...offer, id: 'test-locked', accountRef: 'A003', accountMasked: 'lo…ed@example.invalid', canLogin: false, discount: 40 },
    { ...offer, id: 'test-expired', accountRef: 'A004', accountMasked: 'ex…ed@example.invalid', discount: 30, expiresAt: new Date(Date.now() - 1000).toISOString() },
    { ...offer, id: 'test-offer-5', accountRef: 'A005', accountMasked: 'be…ta@example.invalid' },
    { ...offer, id: 'test-used-account', accountRef: 'A006', accountMasked: 'us…ed@example.invalid', discount: 100 },
    { ...offer, id: 'test-bad-count', accountRef: 'A007', accountMasked: 'ba…nt@example.invalid', discount: 15, uses: 96, usesRemaining: 96, receiptConfirmedUses: 0, receiptState: null, title: '£15 off on 96 orders' }
  ];
  const payload = { schemaVersion: 3, generatedAt: time, summary: { totalSaved: 10, estimatedTotalSaved: 15, estimatedUberOneSavings: 5, knownAccounts: 999, accessibleAccounts: 999, feeModel: { sampleSize: 1, averageExtraOrderFees: 3 } }, accounts: offers.map(p => ({ accountRef: p.accountRef, accountMasked: p.accountMasked, canLogin: p.canLogin, orderCount: p.accountRef === 'A006' ? 5 : 0, rideCount: 0 })), promos: offers };
  let failPromos = false, failHistory = false;
  await page.route('**/promos.json?*', route => failPromos ? route.abort() : route.fulfill({ json: payload }));
  await page.route('**/history.json?*', route => failHistory ? route.abort() : route.fulfill({ json: { updatedAt: time, records: [] } }));
  await page.evaluate(() => localStorage.setItem('uber-eats-promo-tracker:planner-settings:v1', JSON.stringify({ maxOrders: 3, extraOrderFee: null, feeTouched: false })));
  await page.reload(); await page.waitForFunction(() => document.getElementById('scanLabel').textContent === 'Snapshot');
  assert.equal(await page.locator('#basketInput').inputValue(), '15.00', 'Default basket subtotal should be £15');
  const recommendation = await page.locator('#recommendation').innerText();
  assert.match(recommendation, /Save £10/); // At £15, one £10-off offer is the optimal single-order result.
  assert.equal(await page.locator('#usableStat').innerText(), '7');
  assert.equal(await page.locator('#activeStat').innerText(), '2');
  assert.equal(await page.locator('#savedStat').innerText(), '£10');
  assert.match(await page.locator('#savedStatSub').innerText(), /£5 estimated/);
  await page.locator('[data-view="accounts"]').click();
  await page.locator('[data-account-filter="used"]').click();
  assert.equal(await page.locator('#accountsList .account-card').count(), 1);
  assert.match(await page.locator('#accountsList').innerText(), /us…ed/);
  await page.locator('#accountSearch').fill('missing');
  assert.equal(await page.locator('#accountsList .account-card').count(), 0);
  await page.locator('#accountSearch').fill('');
  await page.locator('[data-account-filter="all"]').click();
  await page.locator('[data-view="home"]').click();
  for (const hidden of ['lo…ed', 're…ew', 'ex…ed', 'us…ed', 'ba…nt']) assert.equal(recommendation.includes(hidden), false);
  await page.locator('[data-account-offers="A001"]').first().click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'sheetClose');
  assert.match(await page.locator('#sheetBody .offer-details').first().innerText(), /Estimated end.*35-day tracking limit/, 'A capped deadline must be labelled as a tracker estimate');
  assert.equal(await page.locator('.sheet').evaluate(el => getComputedStyle(el).animationName), 'liquidSheetOpen');
  const sheetAnimation = await page.locator('.sheet').evaluate(el => parseFloat(getComputedStyle(el).animationDuration));
  assert.ok(sheetAnimation >= .2 && sheetAnimation <= .4, 'Sheets should use a short, purposeful transition');
  assert.equal(await page.locator('#app').evaluate(e => e.inert), true);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.getElementById('sheetBackdrop').contains(document.activeElement)), true);
  await page.locator('[data-use-one="test-offer-1"]').click();
  const manual = await page.evaluate(() => JSON.parse(localStorage.getItem('uber-eats-promo-tracker:manual-state:v3')));
  assert.equal(manual.offers['test-offer-1'].manualUsesConsumed, 1);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#app').evaluate(e => e.inert), false);
  offer.receiptConfirmedUses = 2; offer.usesRemaining = 3;
  await page.reload(); await page.waitForFunction(() => document.getElementById('scanLabel').textContent === 'Snapshot');
  await page.locator('[data-account-offers="A001"]').first().click();
  assert.match(await page.locator('#sheetBody').innerText(), /3 left/);
  await page.keyboard.press('Escape');
  await page.locator('[data-view="used"]').click();
  assert.match(await page.locator('#expiredList').innerText(), /ex…ed/);
  assert.match(await page.locator('#needsCheckingList').innerText(), /re…ew/);
  assert.match(await page.locator('#needsCheckingList').innerText(), /order count needs verification/);
  assert.doesNotMatch(await page.locator('#needsCheckingList').innerText(), /96 orders/);
  await page.locator('#needsCheckingList [data-account-offers="A007"]').click();
  assert.equal(await page.locator('[data-use-one="test-bad-count"]').isDisabled(), true);
  assert.doesNotMatch(await page.locator('#sheetBody').innerText(), /96 left|of 96/);
  await page.keyboard.press('Escape');
  failHistory = true;
  await page.reload(); await page.waitForFunction(() => document.getElementById('scanLabel').textContent === 'Snapshot');
  assert.match(await page.locator('#recommendation').innerText(), /Save £10/);
  failPromos = true;
  await page.reload(); await page.waitForFunction(() => document.getElementById('scanLabel').textContent === 'Attention');
  assert.equal(await page.locator('[data-retry-load]').isVisible(), true);
  failPromos = false;
  await page.locator('[data-retry-load]').click();
  await page.waitForFunction(() => document.getElementById('scanLabel').textContent === 'Snapshot');
  for (const width of [320, 360, 375, 390, 414, 430, 600, 768, 980, 1120, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForFunction(expected => document.documentElement.dataset.layout === expected, width < 980 ? 'mobile' : 'desktop');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Overflow at ${width}px`);
    const brand = await page.locator('.brand-title').evaluate(el => ({
      text: el.textContent.trim(),
      whiteSpace: getComputedStyle(el).whiteSpace,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth
    }));
    assert.equal(brand.text, 'Promo Tracker', `Header should use the compact product title at ${width}px`);
    assert.equal(brand.whiteSpace, 'nowrap', `Product title should stay on one line at ${width}px`);
    assert.ok(brand.scrollWidth <= brand.clientWidth + 1, `Product title should fit without clipping at ${width}px`);
    const header = await page.evaluate(() => {
      const title = document.querySelector('.brand-title'), stamp = document.getElementById('scanTime');
      const a = title.getBoundingClientRect(), b = stamp.getBoundingClientRect();
      return { overlap: a.right > b.left && a.bottom > b.top && a.top < b.bottom, filter: getComputedStyle(title).filter, stampSize: parseFloat(getComputedStyle(stamp).fontSize) };
    });
    assert.equal(header.overlap, false, `Title and last sync timestamp must not overlap at ${width}px`);
    assert.equal(header.filter, 'none'); assert.ok(header.stampSize >= 11);
    const glider = await page.locator('.nav-glider').evaluate(el => ({
      width: el.getBoundingClientRect().width,
      height: el.getBoundingClientRect().height,
      transform: getComputedStyle(el).transform
    }));
    assert.ok(glider.width > 0 && glider.height > 0, `Liquid nav glider should be sized at ${width}px`);
    assert.notEqual(glider.transform, 'none', `Liquid nav glider should be positioned at ${width}px`);
    const springTiming = await page.locator('.nav-glider').evaluate(el => getComputedStyle(el).transitionTimingFunction);
    assert.match(springTiming, /cubic-bezier/, `Liquid nav glider should use spring timing at ${width}px`);
    // Resize transitions settle before checking exact geometry below.
    if (width < 980) {
      const nav = await page.locator('#mainNav').evaluate(el => ({ bottom: innerHeight-el.getBoundingClientRect().bottom, radius: getComputedStyle(el).borderRadius, position: getComputedStyle(el).position, height: el.offsetHeight }));
      assert.equal(nav.position, 'fixed'); assert.equal(nav.radius, '999px');
      assert.ok(nav.bottom >= 7 && nav.bottom <= 9, 'Floating nav must sit 8px above the browser safe area');
      assert.ok(nav.height < 75, 'Floating nav must stay a compact capsule');
    }

    const availableLabelFits = await page.locator('.accounts-available-label').evaluate(el => ({
      nowrap: getComputedStyle(el).whiteSpace === 'nowrap',
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      fits: el.scrollWidth <= el.clientWidth
    }));
    assert.equal(availableLabelFits.nowrap, true, `Accounts available should stay on one line at ${width}px`);
    assert.equal(availableLabelFits.fits, true, `Accounts available should fit its card at ${width}px (scroll ${availableLabelFits.scrollWidth}px / client ${availableLabelFits.clientWidth}px)`);
    if (width <= 600) {
      const cardWidths = await page.locator('.home-overview .stat-card').evaluateAll(cards => cards.map(card => card.getBoundingClientRect().width));
      assert.ok(Math.max(...cardWidths) - Math.min(...cardWidths) < 1, `Home stat cards should remain equal width at ${width}px`);
      const labelSizes = await page.locator('.home-overview .stat-label').evaluateAll(labels => labels.map(label => parseFloat(getComputedStyle(label).fontSize)));
      assert.ok(Math.max(...labelSizes) - Math.min(...labelSizes) < 0.1, `Home stat labels should use the same font size at ${width}px`);
      assert.ok(Math.min(...labelSizes) >= 11, `Home stat labels should remain readable at ${width}px`);
      const mobileColumns = await page.locator('.home-overview .stats-row').evaluate(row => getComputedStyle(row).gridTemplateColumns.split(' ').length);
      assert.equal(mobileColumns, 2, `Phone Home account metrics should use the requested 2×2 grid at ${width}px`);
      assert.equal(await page.locator('.home-overview .stats-row .stat-card').count(),4);
    }
    if (process.env.TRACKER_SCREENSHOT_DIR && [390, 1440].includes(width)) await page.screenshot({ path: `${process.env.TRACKER_SCREENSHOT_DIR}/tracker-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('[data-view="home"]').click();
  const desktopLayout = await page.evaluate(() => {
    const nav = document.getElementById('mainNav').getBoundingClientRect();
    const main = document.querySelector('main').getBoundingClientRect();
    const overview = document.querySelector('.home-overview').getBoundingClientRect();
    const navStyle = getComputedStyle(document.getElementById('mainNav'));
    const widths = [...document.querySelectorAll('.home-overview .stat-card')].map(el => el.getBoundingClientRect().width);
    const privacy = document.querySelector('.privacy').getBoundingClientRect();
    return { navBottom: nav.bottom, mainTop: main.top, overviewWidth: overview.width, overviewTop: overview.top, privacyTop: privacy.top, mainBottom: main.bottom, navColumns: navStyle.gridTemplateColumns.split(' ').length, widths };
  });
  assert.equal(desktopLayout.navColumns, 4, 'Desktop navigation should use four horizontal tabs');
  assert.ok(desktopLayout.navBottom <= desktopLayout.mainTop, 'Desktop navigation belongs in the header above the dashboard');
  assert.ok(Math.max(...desktopLayout.widths)-Math.min(...desktopLayout.widths) < 1, 'Desktop summary cards should be equal width');
  assert.ok(desktopLayout.overviewWidth > 1000, 'Desktop should use the full workspace width');
  assert.ok(desktopLayout.overviewTop < 220, 'Privacy footer must not create a blank row above the desktop dashboard');
  assert.ok(desktopLayout.privacyTop >= desktopLayout.mainBottom, 'Privacy copy belongs below the dashboard');
  const desktopHome = await page.locator('[data-view="home"]').boundingBox(), desktopAccounts = await page.locator('[data-view="accounts"]').boundingBox();
  await page.mouse.move(desktopHome.x+desktopHome.width/2, desktopHome.y+desktopHome.height/2); await page.mouse.down();
  await page.mouse.move(desktopAccounts.x+desktopAccounts.width/2, desktopAccounts.y+desktopAccounts.height/2, { steps: 6 });
  await page.mouse.up(); assert.equal(await page.locator('#view-accounts').isVisible(), true, 'Desktop header tabs must slide horizontally');
  await page.keyboard.press('Home'); assert.equal(await page.locator('#view-home').isVisible(), true);

  // A real-sized savings total must fit its desktop card, not hide behind ellipsis.
  payload.summary.totalSaved = 3382.60;
  await page.reload();
  await page.waitForFunction(() => document.getElementById('scanLabel').textContent === 'Snapshot');
  assert.equal(await page.locator('#savedStat').innerText(), '£3,382.60');
  for (const width of [390, 980, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const fits = await page.locator('#savedStat').evaluate(el => el.scrollWidth <= el.clientWidth + 1);
    assert.equal(fits, true, `Full savings amount must remain visible at ${width}px`);
  }

  await page.locator('#basketInput').focus();
  const basketFocus = await page.evaluate(() => {
    const editor = document.querySelector('.basket-editor');
    const input = document.getElementById('basketInput');
    return { borderColor: getComputedStyle(editor).borderColor, outline: getComputedStyle(input).outlineStyle };
  });
  assert.equal(basketFocus.outline, 'none', 'Basket input must not draw a rectangular focus outline');
  assert.ok(!basketFocus.borderColor.includes('184, 255, 143'), 'Basket focus border must stay neutral instead of bright green');

  await page.locator('#basketInput').fill('1000000');
  await page.waitForFunction(() => document.getElementById('recommendation').textContent.includes('£1,000'));
  // Without observed or explicitly chosen fees, avoid optimistic multi-order savings.
  payload.summary.feeModel = { sampleSize: 0, averageExtraOrderFees: 0 };
  await page.reload(); await page.waitForFunction(() => document.getElementById('scanLabel').textContent === 'Snapshot');
  await page.locator('#basketInput').fill('30');
  await page.waitForFunction(() => document.getElementById('recommendation').textContent.includes('before delivery'));
  assert.match(await page.locator('#recommendation').innerText(), /Use 1 account/);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-view="home"]').click();
  const homeTab = await page.locator('[data-view="home"]').boundingBox(), moreTab = await page.locator('[data-view="more"]').boundingBox();
  await page.mouse.move(homeTab.x+homeTab.width/2, homeTab.y+homeTab.height/2); await page.mouse.down();
  await page.mouse.move(moreTab.x+moreTab.width/2, moreTab.y+moreTab.height/2, { steps: 8 });
  assert.equal(await page.locator('#mainNav').evaluate(el => el.classList.contains('dragging')), true);
  await page.mouse.up(); assert.equal(await page.locator('#view-more').isVisible(), true);
  await page.waitForFunction(() => { const nav = document.getElementById('mainNav'), a = nav.querySelector('.active').getBoundingClientRect(), g = nav.querySelector('.nav-glider').getBoundingClientRect(); return Math.abs(a.left-g.left) < 1 && Math.abs(a.top-g.top) < 1; });
  await page.keyboard.press('ArrowLeft'); assert.equal(await page.locator('#view-used').isVisible(), true);
  await page.keyboard.press('End'); assert.equal(await page.locator('#view-more').isVisible(), true);

  await page.locator('[data-open-sheet="appearance"]').click();
  const manualBeforeLayout = await page.evaluate(() => localStorage.getItem('uber-eats-promo-tracker:manual-state:v3'));
  // Mobile on a wide display stays the phone composition, including its fixed dock.
  await page.locator('[name="layoutPreference"][value="mobile"]').check();
  await page.setViewportSize({ width: 1440, height: 900 });
  assert.equal(await page.locator('html').getAttribute('data-layout'), 'mobile');
  assert.ok((await page.locator('#app').boundingBox()).width <= 480);
  const phoneDock = await page.locator('#mainNav').evaluate(el => ({ width: el.offsetWidth, position: getComputedStyle(el).position }));
  assert.equal(phoneDock.position, 'fixed'); assert.ok(phoneDock.width <= 452);
  await page.keyboard.press('Escape'); await page.reload(); await page.waitForFunction(() => document.getElementById('scanLabel').textContent === 'Snapshot');
  assert.equal(await page.locator('html').getAttribute('data-layout'), 'mobile', 'Layout override must survive reload');
  await page.locator('[data-view="more"]').click();
  assert.equal(await page.locator('#view-more .screen-title').innerText(), 'Settings & tools');
  assert.equal(await page.locator('#view-more .eyebrow').count(), 0, 'Settings must not repeat More as kicker and heading');
  await page.locator('[data-open-sheet="appearance"]').click();
  await page.locator('[name="layoutPreference"][value="desktop"]').check();
  assert.equal(await page.locator('html').getAttribute('data-layout'), 'desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('html').getAttribute('data-layout'), 'desktop', 'Desktop override must survive resize');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Explicit Desktop must remain usable at phone width');
  for (const width of [320,600,768,980,1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.locator('html').getAttribute('data-layout'), 'desktop');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Explicit Desktop must fit ${width}px`);
    const navFits = await page.locator('.nav-btn').evaluateAll(buttons => buttons.every(button => button.scrollWidth <= button.clientWidth+1));
    assert.equal(navFits, true, `Desktop navigation labels must fit at ${width}px`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  // The radio group works with keyboard selection and Auto can be restored.
  await page.locator('[name="layoutPreference"][value="desktop"]').focus();
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => document.documentElement.dataset.layoutPreference === 'mobile');
  await page.locator('[name="layoutPreference"][value="auto"]').check();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForFunction(() => document.documentElement.dataset.layout === 'desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.documentElement.dataset.layout === 'mobile');
  assert.equal(await page.evaluate(() => localStorage.getItem('uber-eats-promo-tracker:manual-state:v3')), manualBeforeLayout, 'Layout choices must preserve manual usage');
  assert.equal(await page.locator('#savedStat').innerText(), '£3,382.60', 'Layout choices must preserve financial totals');
  await page.locator('[data-theme-colour="#c5a0ff"]').click();
  const chosen = await page.evaluate(() => ({ stored: localStorage.getItem('uber-eats-promo-tracker:theme:v1'), colour: getComputedStyle(document.documentElement).getPropertyValue('--green') }));
  assert.equal(chosen.stored, '#c5a0ff'); assert.notEqual(chosen.colour.trim(), '#9bea72');
  await page.locator('#colourWheel').scrollIntoViewIfNeeded();
  const wheel = await page.locator('#colourWheel').boundingBox();
  await page.mouse.click(wheel.x+wheel.width*.8, wheel.y+wheel.height*.5);
  assert.notEqual(await page.locator('#themeColour').inputValue(), '#c5a0ff');
  await page.locator('#colourWheel').focus(); await page.keyboard.press('ArrowRight');
  const wheelColour = await page.locator('#themeColour').inputValue();
  await page.keyboard.press('Escape');
  offers.find(p => p.accountRef === 'A005').discount = 9; // Make the imported account the clear best recommendation.
  await page.reload(); await page.waitForFunction(() => document.getElementById('scanLabel').textContent === 'Snapshot');
  assert.equal(await page.evaluate(() => localStorage.getItem('uber-eats-promo-tracker:theme:v1')), wheelColour);

  await page.locator('[data-view="more"]').click(); await page.locator('[data-open-sheet="device"]').click();
  const privateEmail = 'alot.extralong+login.alpha@example.invalid';
  const requests = []; page.on('request', request => requests.push({ url: request.url(), method: request.method() }));
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.testCopiedEmail = text; } } }); });
  await page.locator('#deviceAccountsFile').setInputFiles({ name: 'device-accounts.local.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, kind: 'uber-tracker-device-accounts', accounts: [{ accountRef: 'A001', accountMasked: offer.accountMasked, email: privateEmail }] })) });
  await page.waitForFunction(() => document.getElementById('deviceImportStatus').textContent.includes('1 emails imported'));
  assert.deepEqual(requests, [], 'Importing private emails must not make any network request');
  await page.keyboard.press('Escape'); await page.locator('[data-view="accounts"]').click();
  await page.locator('#accountSearch').fill(privateEmail);
  assert.equal(await page.locator('#accountsList .account-card').count(), 1);
  assert.equal(await page.locator('#accountsList .account-email').innerText(), privateEmail);
  const fullEmail = await page.locator('#accountsList .account-email').evaluate(el => ({ overflow: el.scrollWidth > el.clientWidth+1, whiteSpace: getComputedStyle(el).whiteSpace }));
  assert.equal(fullEmail.overflow, false); assert.equal(fullEmail.whiteSpace, 'normal');
  await page.locator('#accountsList [data-account-offers="A001"]').click();
  await page.locator('[data-copy-email="A001"]').click();
  assert.equal(await page.evaluate(() => window.testCopiedEmail), privateEmail);
  await page.keyboard.press('Escape'); await page.reload(); await page.waitForFunction(() => document.getElementById('scanLabel').textContent === 'Snapshot');
  assert.match(await page.locator('#recommendation').innerText(), /alot\.extralong\+login\.alpha/);
  assert.equal(requests.some(r => r.url.includes(privateEmail) || r.method !== 'GET'), false);
  await page.locator('[data-view="more"]').click(); await page.locator('[data-open-sheet="device"]').click();
  await page.locator('#forgetDeviceAccounts').click();
  assert.equal(await page.evaluate(() => localStorage.getItem('uber-eats-promo-tracker:device-accounts:v1')), null);
  await page.keyboard.press('Escape'); await page.locator('[data-view="home"]').click();
  assert.equal((await page.locator('#recommendation').innerText()).includes(privateEmail), false);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('[data-view="more"]').click();
  assert.ok(parseFloat(await page.locator('.nav-glider').evaluate(el => getComputedStyle(el).transitionDuration)) < .01);
  await page.setViewportSize({ width: 1280, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  await context.close();

  // Repeat uses of one discount and separate cash/discount offers are different filters.
  const filterContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const filterPage = await filterContext.newPage();
  filterPage.on('pageerror', error => errors.push(error.message));
  const repeatOffer = { ...offer, id: 'repeat-101', accountRef: 'A101', accountMasked: 're…at@example.invalid', discount: 12, minimumSpend: 15, uses: 5, usesRemaining: 4, receiptConfirmedUses: 1 };
  const cashOffer = { ...repeatOffer, id: 'cash-101', discountType: 'uberCash', discount: 7, minimumSpend: 0, uses: 1, usesRemaining: 1, receiptConfirmedUses: 0, receiptState: null };
  const filterOffers = [repeatOffer, cashOffer, { ...cashOffer, id: 'another-cash-101' },
    { ...repeatOffer, id: 'single-102', accountRef: 'A102', accountMasked: 'si…le@example.invalid', discountType: 'percent', discount: 20, usesRemaining: 1, receiptConfirmedUses: 4 },
    { ...repeatOffer, id: 'another-single-102', accountRef: 'A102', accountMasked: 'si…le@example.invalid', uses: 1, usesRemaining: 1, receiptConfirmedUses: 0 },
    { ...cashOffer, id: 'cash-only-103', accountRef: 'A103', accountMasked: 'ca…ly@example.invalid' },
    { ...repeatOffer, id: 'repeat-104', accountRef: 'A104', accountMasked: 'ex…sh@example.invalid' },
    { ...cashOffer, id: 'expired-cash-104', accountRef: 'A104', accountMasked: 'ex…sh@example.invalid', expiresAt: new Date(Date.now()-1000).toISOString() },
    { ...repeatOffer, id: 'repeat-105', accountRef: 'A105', accountMasked: 'us…sh@example.invalid' },
    { ...cashOffer, id: 'used-cash-105', accountRef: 'A105', accountMasked: 'us…sh@example.invalid', usesRemaining: 0, receiptConfirmedUses: 1, receiptState: 'used' },
    { ...cashOffer, id: 'review-cash-105', accountRef: 'A105', accountMasked: 'us…sh@example.invalid', emailSentAt: null, expires: null, expiresAt: null, expiryStatus: 'unknown' },
    { ...repeatOffer, id: 'repeat-106', accountRef: 'A106', accountMasked: 'ar…ed@example.invalid', canLogin: false },
    { ...cashOffer, id: 'cash-106', accountRef: 'A106', accountMasked: 'ar…ed@example.invalid', canLogin: false },
    { ...repeatOffer, id: 'repeat-107', accountRef: 'A107', accountMasked: 'us…ed@example.invalid' },
    { ...cashOffer, id: 'cash-107', accountRef: 'A107', accountMasked: 'us…ed@example.invalid' },
    { ...repeatOffer, id: 'one-left-109', accountRef: 'A109', accountMasked: 'fo…ts@example.invalid', usesRemaining: 1, receiptConfirmedUses: 4 },
    { ...repeatOffer, id: 'complete-110', accountRef: 'A110', accountMasked: 'ea…de@example.invalid' },
    { ...cashOffer, id: 'past-cash-111', accountRef: 'A111', accountMasked: 'pa…sh@example.invalid', expiresAt: new Date(Date.now()-1000).toISOString() }
  ];
  const filterAccounts = [...new Map(filterOffers.map(p => [p.accountRef, { accountRef: p.accountRef, accountMasked: p.accountMasked, canLogin: p.canLogin, orderCount: p.accountRef === 'A107' ? 5 : p.accountRef === 'A109' ? 4 : ['A101','A110','A111'].includes(p.accountRef) ? 1 : 0, rideCount: ['A110','A111'].includes(p.accountRef) ? 1 : 0 }])).values()];
  filterAccounts.push({accountRef:'A108',accountMasked:'no…rs@example.invalid',canLogin:true,orderCount:0,rideCount:0});
  const filterPayload = { schemaVersion: 3, generatedAt: time, accounts: filterAccounts, promos: filterOffers, summary: { totalSaved: 40 } };
  await filterPage.route('**/promos.json?*', route => route.fulfill({ json: filterPayload }));
  await filterPage.route('**/history.json?*', route => route.fulfill({ json: { updatedAt: time, records: [] } }));
  await filterPage.goto(url); await filterPage.waitForFunction(() => document.getElementById('scanLabel').textContent === 'Snapshot');
  assert.equal(await filterPage.locator('#unfinishedCount').innerText(), '9 accounts');
  await filterPage.locator('[data-intent="unfinished"]').click();
  assert.match(await filterPage.locator('#homeAccounts [data-card-account="A101"]').innerText(), /4 of 5 uses left/);
  assert.equal(await filterPage.locator('#homeAccounts [data-card-account="A102"]').count(), 1, 'An unfinished account with one remaining use stays in the section');
  for (const ref of ['A106','A111']) assert.equal(await filterPage.locator('#homeAccounts [data-card-account="'+ref+'"]').count(), 0, 'Archived and completed accounts without live offers stay out');
  await filterPage.locator('[data-jump-accounts][data-target-filter="unfinished"]').click();
  assert.equal(await filterPage.locator('#accountsMeta').innerText(),'9 accounts');
  for (const ref of ['A102','A104','A109','A107','A110']) assert.equal(await filterPage.locator('#accountsList [data-card-account="'+ref+'"]').count(), 1, 'The full list retains unused, expired and one-left accounts');
  assert.match(await filterPage.locator('#accountsList [data-card-account="A109"]').innerText(), /4 of 5 Eats.*1 more Eats receipt/);
  assert.equal(await filterPage.locator('#accountsList [data-card-account="A108"]').count(),1,'The full section includes accounts with no offer yet');
  await filterPage.locator('[data-view="home"]').click();
  await filterPage.locator('[data-intent="cash"]').click();
  assert.equal(await filterPage.locator('#homeAccounts [data-card-account="A107"]').count(), 1, 'Receipt completion cannot hide a current Cash offer');
  await filterPage.locator('[data-jump-accounts][data-target-filter="cash"]').click();
  assert.match(await filterPage.locator('#accountsList [data-card-account="A111"]').innerText(), /Past Cash offer · expired/);
  await filterPage.locator('[data-view="home"]').click();
  assert.equal(await filterPage.locator('#cashPromoCount').innerText(), '2 accounts', 'Cash remains visible on a receipt-complete account; multiple offers count one account');
  await filterPage.locator('[data-intent="cash-promo"]').click();
  assert.equal(await filterPage.locator('#homeAccounts .account-card').count(), 2);
  assert.equal(await filterPage.locator('#homeAccounts [data-card-account="A101"]').count(), 1, 'Same-account cash and discount are required; expired, consumed, review and archived offers must not qualify');
  assert.match(await filterPage.locator('[data-intent="cash-promo"]').innerText(), /Combining them depends on Uber/);
  assert.equal(await filterPage.locator('#savedStat').innerText(), '£40');
  assert.match(await filterPage.locator('#recommendation').innerText(), /Save £12/, 'Finding both offers must not add £7 cash to £12 discount');
  await filterPage.locator('[data-view="accounts"]').click();
  await filterPage.locator('[data-account-filter="cash-promo"]').click();
  assert.equal(await filterPage.locator('#accountsList [data-card-account="A101"]').count(), 1);
  for (const accountRef of ['A102', 'A103', 'A104', 'A105']) assert.equal(await filterPage.locator(`#accountsList [data-card-account="${accountRef}"]`).count(), 0);
  // A single remaining order is still available, but is no longer a repeat-order option.
  repeatOffer.usesRemaining = 1; repeatOffer.receiptConfirmedUses = 4;
  for (const promo of filterOffers.filter(p => p.accountRef === 'A101' && p.discountType === 'uberCash')) promo.usesRemaining = 0;
  await filterPage.reload(); await filterPage.waitForFunction(() => document.getElementById('scanLabel').textContent === 'Snapshot');
  assert.equal(await filterPage.locator('#unfinishedCount').innerText(), '9 accounts', 'One remaining use and partial receipts do not finish an account');
  assert.equal(await filterPage.locator('#cashPromoCount').innerText(), '1 account');
  assert.equal(await filterPage.locator('#activeStat').innerText(), '6', 'One use left must preserve account availability');
  filterOffers.splice(filterOffers.findIndex(p => p.id === 'another-single-102'), 1);
  filterOffers.push({ ...cashOffer, id: 'cash-102', accountRef: 'A102', accountMasked: 'si…le@example.invalid', usesRemaining: 1 });
  await filterPage.reload(); await filterPage.waitForFunction(() => document.getElementById('scanLabel').textContent === 'Snapshot');
  assert.equal(await filterPage.locator('#cashPromoCount').innerText(), '2 accounts', 'Percentage discounts also match with active cash');
  await filterPage.locator('[data-intent="cash-promo"]').click();
  assert.equal(await filterPage.locator('#homeAccounts [data-card-account="A102"]').count(), 1);
  filterAccounts.find(a => a.accountRef === 'A109').orderCount = 5;
  await filterPage.reload(); await filterPage.waitForFunction(() => document.getElementById('scanLabel').textContent === 'Snapshot');
  assert.equal(await filterPage.locator('#unfinishedCount').innerText(), '9 accounts', 'Receipt completion cannot hide a remaining offer');
  filterOffers.find(p => p.accountRef === 'A109').usesRemaining = 0;
  filterOffers.find(p => p.accountRef === 'A109').receiptConfirmedUses = 5;
  await filterPage.reload(); await filterPage.waitForFunction(() => document.getElementById('scanLabel').textContent === 'Snapshot');
  assert.equal(await filterPage.locator('#unfinishedCount').innerText(), '8 accounts', 'The account leaves when receipt usage is complete and no live uses remain');
  await filterPage.locator('[data-intent="unfinished"]').click();
  assert.equal(await filterPage.locator('#homeAccounts [data-card-account="A109"]').count(), 0);
  for (const width of [320, 390, 1440]) {
    await filterPage.setViewportSize({ width, height: 900 });
    await filterPage.waitForFunction(layout => document.documentElement.dataset.layout === layout, width < 980 ? 'mobile' : 'desktop');
    assert.equal(await filterPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Quick filters fit ${width}px`);
    assert.equal(await filterPage.locator('.quick-card').evaluateAll(cards => cards.every(card => card.scrollWidth <= card.clientWidth+1 && card.scrollHeight <= card.clientHeight+1)), true, `Quick filter labels fit their cards at ${width}px`);
  }
  assert.deepEqual(errors, []);
  await filterContext.close();
  console.log('✓ Browser: unfinished-account and cash-plus-promo filtering/counts without combined savings, saved/automatic layouts across screen sizes, deduplicated settings headings, state preservation, header clarity, capsule drag/keyboard navigation, private email import/copy/forget, colour wheel persistence, uncertain counts/fees, reduced motion, focus and network retry');
} finally { await browser?.close(); server.close(); }
