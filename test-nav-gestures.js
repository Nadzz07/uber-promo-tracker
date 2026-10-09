// Gesture regressions use only a synthetic navigation fixture, never account data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { once } from 'node:events';
import { chromium, webkit } from 'playwright';

const fixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body { margin:0; min-height:1600px; }
#mainNav { position:fixed; bottom:8px; left:14px; width:calc(100% - 40px); display:grid; grid-template-columns:repeat(4,1fr); padding:5px; border:1px solid; border-radius:99px; touch-action:none; user-select:none; -webkit-user-select:none; }
#mainNav.vertical { top:10px; left:10px; bottom:auto; width:90px; grid-template-columns:1fr; }
.nav-btn { height:58px; position:relative; background:transparent; border:0; }
.nav-glider { position:absolute; top:0; left:0; background:rgba(20,20,20,.15); pointer-events:none; }
</style></head><body><nav id="mainNav"><span class="nav-glider"></span>
<button class="nav-btn active" data-view="home">Home</button><button class="nav-btn" data-view="accounts">Accounts</button>
<button class="nav-btn" data-view="used">Used</button><button class="nav-btn" data-view="more">More</button></nav>
<script type="module">
import { setupDraggableNavigation } from './nav-gestures.js';
const nav = document.getElementById('mainNav');
window.selected = []; window.captureCalls = []; window.restoreCalls = 0; window.gestureEvents = [];
for (const type of ['pointerdown','pointerup','click']) nav.addEventListener(type, event => {
  window.gestureEvents.push({type,detail:event.detail,pointerId:event.pointerId,pointerType:event.pointerType,button:event.button});
}, true);
const originalCapture = nav.setPointerCapture.bind(nav);
nav.setPointerCapture = pointerId => { window.captureCalls.push(pointerId); originalCapture(pointerId); };
function restore() { const active = nav.querySelector('.active'), glider = nav.querySelector('.nav-glider');
  glider.style.width = active.offsetWidth+'px'; glider.style.height = active.offsetHeight+'px';
  glider.style.transform = 'translate3d('+active.offsetLeft+'px,'+active.offsetTop+'px,0)'; }
function select(view) { window.selected.push(view); for (const button of nav.querySelectorAll('[data-view]')) {
  button.classList.toggle('active', button.dataset.view === view); }
  restore(); }
window.destroyNavigation = setupDraggableNavigation({nav,onSelect:select,onRestore:()=>{window.restoreCalls++;restore();}});
window.resetNavigation = () => { select('home'); window.selected = []; window.captureCalls = []; window.restoreCalls = 0; window.gestureEvents = []; };
window.replayPointer = (type, options = {}, view = 'home') => {
  const event = new PointerEvent(type, { bubbles:true, cancelable:true, isPrimary:true, pointerType:'touch', pointerId:42, button:type==='pointerdown' ? -1 : -1, buttons:type==='pointerup' ? 0 : 1, ...options });
  const target = view === 'outside' ? window : nav.querySelector('[data-view="'+view+'"]');
  target.dispatchEvent(event);
};
window.compatibilityClick = (view='home') => nav.querySelector('[data-view="'+view+'"]').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));
window.ready = true; restore();
</script></body></html>`;
const server = http.createServer((request, response) => {
  if (request.url === '/nav-gestures.js') {
    response.setHeader('Content-Type', 'text/javascript'); response.end(fs.readFileSync(new URL('./nav-gestures.js', import.meta.url))); return;
  }
  if (request.url !== '/') { response.writeHead(404); response.end(); return; }
  response.setHeader('Content-Type', 'text/html'); response.end(fixture);
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
let browser;
try {
  const engine = process.env.TRACKER_BROWSER_ENGINE === 'webkit' ? webkit : chromium;
  browser = await engine.launch(engine === chromium ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {});
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:' + server.address().port); await page.waitForFunction(() => window.ready);
  assert.equal(await page.locator('#mainNav').evaluate(nav => getComputedStyle(nav).touchAction), 'none');
  const center = async view => { const rect = await page.locator('[data-view="' + view + '"]').boundingBox(); return { clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 }; };
  const dispatch = async (type, position, view = 'home', extra = {}) => page.evaluate(({ type, position, view, extra }) => window.replayPointer(type, { ...position, ...extra }, view), { type, position, view, extra });
  const selections = () => page.evaluate(() => window.selected);
  const reset = () => page.evaluate(() => window.resetNavigation());
  // Mobile viewport setup can emit a delayed resize, which intentionally cancels gestures.
  await page.waitForTimeout(250);
  const home = await center('home'), more = await center('more');

  // The previous button===0 guard rejected this touch sequence before dragging began.
  await dispatch('pointerdown', home);
  assert.deepEqual(await page.evaluate(() => window.captureCalls), [42], 'Capture must begin at pointerdown, before any move');
  await page.waitForTimeout(180); // A held finger can begin moving later.
  await dispatch('pointermove', more);
  assert.equal(await page.locator('#mainNav').evaluate(nav => nav.classList.contains('dragging')), true);
  assert.deepEqual(await selections(), [], 'Scrubbing previews the capsule without switching views before release');
  await page.waitForFunction(() => { const a=document.querySelector('.nav-glider').getBoundingClientRect(),b=document.querySelector('[data-view="more"]').getBoundingClientRect(); return Math.abs(a.left-b.left)<1; });
  const followsFinger = await page.locator('#mainNav').evaluate(nav => {
    const glider = nav.querySelector('.nav-glider').getBoundingClientRect(), target = nav.querySelector('[data-view="more"]').getBoundingClientRect();
    return Math.abs(glider.left - target.left) < 1;
  });
  assert.equal(followsFinger, true, 'Capsule must follow the finger to the destination');
  await dispatch('pointerup', more, 'more');
  assert.deepEqual(await selections(), ['more']);
  await page.waitForTimeout(150);
  await page.evaluate(() => window.compatibilityClick('home'));
  assert.deepEqual(await selections(), ['more'], 'A delayed compatibility click must not undo the drag');
  await page.keyboard.press('Home');
  assert.deepEqual(await selections(), ['more', 'home'], 'Keyboard navigation must work immediately after a drag');

  // Actual browser touch taps must select once despite capture retargeting the click.
  await reset();
  const accounts = await center('accounts');
  await page.touchscreen.tap(accounts.clientX, accounts.clientY);
  await page.waitForTimeout(350);
  assert.deepEqual(await selections(), ['accounts'], 'A real touch tap must select exactly once: ' + JSON.stringify(await page.evaluate(() => window.gestureEvents)));
  assert.equal(await page.evaluate(() => window.captureCalls.length > 0), true);

  if (engine === chromium) {
    // Generate native touch events, including hold and slide, through the browser's input layer.
    await reset();
    const session = await context.newCDPSession(page);
    const touch = async (type, position) => session.send('Input.dispatchTouchEvent', { type, touchPoints: position ? [{ x: position.clientX, y: position.clientY, id: 1, radiusX: 8, radiusY: 8 }] : [] });
    try {
      await touch('touchStart', home); await page.waitForTimeout(180);
      assert.equal(await page.evaluate(() => window.captureCalls.length > 0), true);
      for (let step = 1; step <= 5; step++) await touch('touchMove', { clientX: home.clientX + (more.clientX - home.clientX) * step / 5, clientY: home.clientY });
      assert.equal(await page.locator('#mainNav').evaluate(nav => nav.classList.contains('dragging')), true);
      assert.equal(await page.evaluate(() => scrollY), 0, 'Holding the nav must not scroll the page');
      await touch('touchEnd'); await page.waitForTimeout(150);
      assert.deepEqual(await selections(), ['more'], 'A native held touch drag must select exactly once');
    } finally { await session.detach(); }
  }

  // Actual browser mouse capture remains supported, and normal clicks are not doubled.
  await reset();
  await page.mouse.move(home.clientX, home.clientY); await page.mouse.down();
  assert.equal(await page.locator('#mainNav').evaluate(nav => nav.hasPointerCapture(1)), true);
  await page.mouse.move(more.clientX, more.clientY, { steps: 8 }); await page.mouse.up();
  assert.deepEqual(await selections(), ['more']);
  await page.locator('[data-view="accounts"]').click();
  assert.deepEqual(await selections(), ['more', 'accounts']);

  for (const cancellation of ['pointercancel', 'lostpointercapture']) {
    await reset(); await dispatch('pointerdown', home); await dispatch('pointermove', more);
    await dispatch(cancellation, more);
    assert.deepEqual(await selections(), [], cancellation + ' must not change views');
    assert.equal(await page.locator('#mainNav').evaluate(nav => nav.classList.contains('dragging')), false);
    assert.equal(await page.locator('#mainNav').evaluate(nav => nav.querySelector('.nav-glider').style.transform === 'translate3d(' + nav.querySelector('.active').offsetLeft + 'px, ' + nav.querySelector('.active').offsetTop + 'px, 0px)'), true, cancellation + ' must restore the selected capsule');
    await page.evaluate(() => window.compatibilityClick('more'));
    assert.deepEqual(await selections(), [], cancellation + ' must also ignore a stray click');
  }

  // A second finger cannot steal the active gesture, and movement beyond the bar still finishes.
  await reset(); await dispatch('pointerdown', home);
  await dispatch('pointerdown', more, 'more', { pointerId: 43, isPrimary: false });
  await dispatch('pointermove', more, 'outside', { pointerId: 43, isPrimary: false });
  assert.equal(await page.locator('#mainNav').evaluate(nav => nav.classList.contains('dragging')), false);
  await dispatch('pointermove', { ...more, clientX: more.clientX + 150 }, 'outside');
  await dispatch('pointerup', { ...more, clientX: more.clientX + 150 }, 'outside');
  assert.deepEqual(await selections(), ['more']);

  await reset();
  await dispatch('pointerdown', home, 'home', { pointerType: 'mouse', button: 2 });
  await dispatch('pointermove', more, 'more', { pointerType: 'mouse' });
  await dispatch('pointerup', more, 'more', { pointerType: 'mouse' });
  assert.deepEqual(await selections(), [], 'Secondary mouse buttons must not start navigation');
  await dispatch('pointerdown', home);
  await dispatch('pointermove', { ...home, clientY: home.clientY - 60 });
  await dispatch('pointerup', { ...home, clientY: home.clientY - 60 });
  assert.deepEqual(await selections(), [], 'A vertical escape must not count as a tap on a horizontal bar');

  await reset(); await dispatch('pointerdown', home); await dispatch('pointermove', more);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  assert.deepEqual(await selections(), []);
  assert.equal(await page.locator('#mainNav').evaluate(nav => nav.classList.contains('dragging')), false);

  await page.locator('[data-view="home"]').focus();
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  assert.deepEqual(await selections(), ['more', 'home', 'accounts', 'more', 'more']);

  // Orientation follows actual button geometry, including a vertical header/sidebar.
  await page.locator('#mainNav').evaluate(nav => nav.classList.add('vertical'));
  await reset();
  const verticalHome = await center('home'), verticalMore = await center('more');
  await dispatch('pointerdown', verticalHome); await dispatch('pointermove', verticalMore);
  await dispatch('pointerup', verticalMore, 'more');
  assert.deepEqual(await selections(), ['more']);

  await reset(); await page.evaluate(() => window.destroyNavigation());
  await dispatch('pointerdown', verticalHome); await dispatch('pointermove', verticalMore); await dispatch('pointerup', verticalMore, 'more');
  await page.locator('[data-view="accounts"]').click();
  assert.deepEqual(await selections(), [], 'Destroy must remove gesture and click listeners');
  assert.deepEqual(errors, []);
  console.log('Navigation gesture checks passed (' + (engine === webkit ? 'WebKit' : 'Chromium') + '): held touch, capture, taps, delayed clicks, mouse, cancel, multitouch, keyboard, orientation and cleanup.');
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
}
