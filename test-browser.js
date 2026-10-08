// Synthetic data is intercepted in the test browser only, never written to public JSON.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
execFileSync(process.execPath, ['build-site.js']);
const allowed = new Set(fs.readdirSync('dist'));
const server = http.createServer((request, response) => {
  const file = new URL(request.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!allowed.has(file)) { response.writeHead(404); response.end(); return; }
  response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.json') ? 'application/json' : 'text/html');
  response.end(fs.readFileSync('dist/' + file));
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const url = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
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
    { ...offer, id: 'test-used-account', accountRef: 'A006', accountMasked: 'us…ed@example.invalid', discount: 100 }
  ];
  const payload = { schemaVersion: 3, generatedAt: time, summary: { totalSaved: 10, estimatedTotalSaved: 15, estimatedUberOneSavings: 5, knownAccounts: 999, accessibleAccounts: 999, feeModel: { sampleSize: 1, averageExtraOrderFees: 3 } }, accounts: offers.map(p => ({ accountRef: p.accountRef, accountMasked: p.accountMasked, canLogin: p.canLogin, orderCount: p.accountRef === 'A006' ? 5 : 0, rideCount: 0 })), promos: offers };
  let failPromos = false, failHistory = false;
  await page.route('**/promos.json?*', route => failPromos ? route.abort() : route.fulfill({ json: payload }));
  await page.route('**/history.json?*', route => failHistory ? route.abort() : route.fulfill({ json: { updatedAt: time, records: [] } }));
  await page.evaluate(() => localStorage.setItem('uber-eats-promo-tracker:planner-settings:v1', JSON.stringify({ maxOrders: 3, extraOrderFee: null, feeTouched: false })));
  await page.reload(); await page.waitForFunction(() => document.getElementById('scanLabel').textContent === 'LIVE');
  assert.equal(await page.locator('#basketInput').inputValue(), '15.00', 'Default basket subtotal should be £15');
  const recommendation = await page.locator('#recommendation').innerText();
  assert.match(recommendation, /Save £10/); // At £15, one £10-off offer is the optimal single-order result.
  assert.equal(await page.locator('#usableStat').innerText(), '6');
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
  for (const hidden of ['lo…ed', 're…ew', 'ex…ed', 'us…ed']) assert.equal(recommendation.includes(hidden), false);
  await page.locator('[data-account-offers="A001"]').first().click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'sheetClose');
  assert.equal(await page.locator('.sheet').evaluate(el => getComputedStyle(el).animationName), 'liquidSheetOpen');
  assert.ok((await page.locator('.sheet').evaluate(el => parseFloat(getComputedStyle(el).animationDuration))) >= 0.6);
  assert.equal(await page.locator('#app').evaluate(e => e.inert), true);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.getElementById('sheetBackdrop').contains(document.activeElement)), true);
  await page.locator('[data-use-one="test-offer-1"]').click();
  const manual = await page.evaluate(() => JSON.parse(localStorage.getItem('uber-eats-promo-tracker:manual-state:v3')));
  assert.equal(manual.offers['test-offer-1'].manualUsesConsumed, 1);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#app').evaluate(e => e.inert), false);
  offer.receiptConfirmedUses = 2; offer.usesRemaining = 3;
  await page.reload(); await page.waitForFunction(() => document.getElementById('scanLabel').textContent === 'LIVE');
  await page.locator('[data-account-offers="A001"]').first().click();
  assert.match(await page.locator('#sheetBody').innerText(), /3 left/);
  await page.keyboard.press('Escape');
  await page.locator('[data-view="used"]').click();
  assert.match(await page.locator('#expiredList').innerText(), /ex…ed/);
  assert.match(await page.locator('#needsCheckingList').innerText(), /re…ew/);
  failHistory = true;
  await page.reload(); await page.waitForFunction(() => document.getElementById('scanLabel').textContent === 'LIVE');
  assert.match(await page.locator('#recommendation').innerText(), /Save £10/);
  failPromos = true;
  await page.reload(); await page.waitForFunction(() => document.getElementById('scanLabel').textContent === 'OFFLINE');
  assert.equal(await page.locator('[data-retry-load]').isVisible(), true);
  failPromos = false;
  await page.locator('[data-retry-load]').click();
  await page.waitForFunction(() => document.getElementById('scanLabel').textContent === 'LIVE');
  for (const width of [320, 360, 375, 390, 414, 430, 600, 768, 980, 1120, 1440]) {
    await page.setViewportSize({ width, height: 900 });
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
    const glider = await page.locator('.nav-glider').evaluate(el => ({
      width: el.getBoundingClientRect().width,
      height: el.getBoundingClientRect().height,
      transform: getComputedStyle(el).transform
    }));
    assert.ok(glider.width > 0 && glider.height > 0, `Liquid nav glider should be sized at ${width}px`);
    assert.notEqual(glider.transform, 'none', `Liquid nav glider should be positioned at ${width}px`);
    const springTiming = await page.locator('.nav-glider').evaluate(el => getComputedStyle(el).transitionTimingFunction);
    assert.match(springTiming, /cubic-bezier/, `Liquid nav glider should use spring timing at ${width}px`);

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
      assert.equal(mobileColumns, 1, `Phone Home stats should stack instead of shrinking labels at ${width}px`);
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
    return { navRight: nav.right, mainLeft: main.left, overviewWidth: overview.width, navDirection: navStyle.flexDirection };
  });
  assert.equal(desktopLayout.navDirection, 'column', 'Desktop navigation must be a vertical sidebar');
  assert.ok(desktopLayout.navRight < desktopLayout.mainLeft, 'Desktop navigation must sit left of the main dashboard');
  assert.ok(desktopLayout.overviewWidth > 700, 'Home command-centre panel must span the desktop content area');

  // A real-sized savings total must fit its desktop card, not hide behind ellipsis.
  payload.summary.totalSaved = 3382.60;
  await page.reload();
  await page.waitForFunction(() => document.getElementById('scanLabel').textContent === 'LIVE');
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
  await page.setViewportSize({ width: 1280, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  await context.close();
  console.log('✓ Browser: mobile/desktop layout, eligibility, learned fees, usage reconciliation, modal keyboard focus, partial network failure and retry');
} finally { await browser?.close(); server.close(); }
