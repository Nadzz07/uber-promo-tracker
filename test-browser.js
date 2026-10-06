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
  await page.goto(url); await page.waitForFunction(() => document.getElementById('scanLabel').textContent === 'READY');
  assert.equal(await page.locator('#usableStat').innerText(), '0');
  assert.equal(await page.locator('.account-card').count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const time = new Date().toISOString();
  const offer = { id: 'test-offer-1', accountRef: 'A001', accountMasked: 'al…ha@example.invalid', canLogin: true, service: 'Uber Eats', title: '£10 off on 5 orders', discountType: 'fixed', discount: 10, minimumSpend: 15, uses: 5, usesRemaining: 4, receiptConfirmedUses: 1, expires: '2099-12-31', expiresAt: '2099-12-31T23:59:59', expiryStatus: 'exact', trackingState: 'available', receiptState: 'partial', emailSentAt: time };
  const offers = [offer,
    { ...offer, id: 'test-review', accountRef: 'A002', accountMasked: 're…ew@example.invalid', discount: 50, trackingState: 'needs_checking', expires: null, expiresAt: null, expiryStatus: 'unknown' },
    { ...offer, id: 'test-locked', accountRef: 'A003', accountMasked: 'lo…ed@example.invalid', canLogin: false, discount: 40 },
    { ...offer, id: 'test-expired', accountRef: 'A004', accountMasked: 'ex…ed@example.invalid', discount: 30, expiresAt: new Date(Date.now() - 1000).toISOString() },
    { ...offer, id: 'test-offer-5', accountRef: 'A005', accountMasked: 'be…ta@example.invalid' }
  ];
  const payload = { schemaVersion: 3, generatedAt: time, summary: { totalSaved: 10, estimatedTotalSaved: 10, feeModel: { sampleSize: 1, averageExtraOrderFees: 3 } }, accounts: offers.map(p => ({ accountRef: p.accountRef, accountMasked: p.accountMasked, canLogin: p.canLogin })), promos: offers };
  let failPromos = false, failHistory = false;
  await page.route('**/promos.json?*', route => failPromos ? route.abort() : route.fulfill({ json: payload }));
  await page.route('**/history.json?*', route => failHistory ? route.abort() : route.fulfill({ json: { updatedAt: time, records: [] } }));
  await page.evaluate(() => localStorage.setItem('uber-eats-promo-tracker:planner-settings:v1', JSON.stringify({ maxOrders: 3, extraOrderFee: null, feeTouched: false })));
  await page.reload(); await page.waitForFunction(() => document.getElementById('scanLabel').textContent === 'LIVE');
  const recommendation = await page.locator('#recommendation').innerText();
  assert.match(recommendation, /Save £17/); // Two valid £10 offers minus £3 learned extra fee.
  for (const hidden of ['lo…ed', 're…ew', 'ex…ed']) assert.equal(recommendation.includes(hidden), false);
  await page.locator('[data-account-offers="A001"]').first().click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'sheetClose');
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
  assert.match(await page.locator('#fullyUsedList').innerText(), /ex…ed/);
  assert.match(await page.locator('#needsCheckingList').innerText(), /re…ew/);
  failHistory = true;
  await page.reload(); await page.waitForFunction(() => document.getElementById('scanLabel').textContent === 'LIVE');
  assert.match(await page.locator('#recommendation').innerText(), /Save £17/);
  failPromos = true;
  await page.reload(); await page.waitForFunction(() => document.getElementById('scanLabel').textContent === 'OFFLINE');
  assert.equal(await page.locator('[data-retry-load]').isVisible(), true);
  failPromos = false;
  await page.locator('[data-retry-load]').click();
  await page.waitForFunction(() => document.getElementById('scanLabel').textContent === 'LIVE');
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Overflow at ${width}px`);
    if (process.env.TRACKER_SCREENSHOT_DIR && [390, 1440].includes(width)) await page.screenshot({ path: `${process.env.TRACKER_SCREENSHOT_DIR}/tracker-${width}.png`, fullPage: true });
  }
  await page.locator('#basketInput').fill('1000000');
  await page.waitForFunction(() => document.getElementById('recommendation').textContent.includes('£1,000'));
  await page.setViewportSize({ width: 1280, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  await context.close();
  console.log('✓ Browser: mobile/desktop layout, eligibility, learned fees, usage reconciliation, modal keyboard focus, partial network failure and retry');
} finally { await browser?.close(); server.close(); }
