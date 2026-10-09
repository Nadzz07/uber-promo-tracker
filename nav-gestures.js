// Pointer navigation is separate from account data and works with mouse, pen and touch.
export function setupDraggableNavigation({ nav, onSelect, onRestore = () => {}, onGliderMove = null, threshold = 6 }) {
  if (!nav?.ownerDocument || typeof onSelect !== 'function') {
    throw new TypeError('Navigation element and selection callback are required');
  }
  const document = nav.ownerDocument, window = document.defaultView;
  let gesture = null, suppressedClick = null;
  const buttons = () => [...nav.querySelectorAll('[data-view]')].filter(button => !button.disabled);
  const buttonFor = target => {
    const button = target?.closest?.('[data-view]');
    return button && nav.contains(button) && !button.disabled ? button : null;
  };
  const isVertical = items => {
    if (items.length < 2) return false;
    const first = items[0].getBoundingClientRect(), last = items.at(-1).getBoundingClientRect();
    return Math.abs(last.top - first.top) > Math.abs(last.left - first.left);
  };
  const nearest = (event, vertical) => buttons().reduce((best, button) => {
    const rect = button.getBoundingClientRect();
    const distance = Math.abs(vertical ? event.clientY - (rect.top + rect.bottom) / 2 : event.clientX - (rect.left + rect.right) / 2);
    return !best || distance < best.distance ? { button, distance } : best;
  }, null)?.button;
  const select = button => {
    if (!button?.isConnected || button.disabled) { onRestore(); return; }
    onSelect(button.dataset.view);
    button.focus({ preventScroll: true });
  };
  const releaseCapture = pointerId => {
    try { if (nav.hasPointerCapture(pointerId)) nav.releasePointerCapture(pointerId); }
    catch { /* A canceled or detached pointer may already have lost capture. */ }
  };

  function finish(event, cancelled = false) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const finished = gesture;
    gesture = null; // releasePointerCapture can synchronously fire lostpointercapture.
    nav.classList.remove('dragging');
    suppressedClick = { until: window.performance.now() + 1000 };
    releaseCapture(finished.pointerId);
    if (cancelled) { onRestore(); return; }
    const crossed = Math.hypot(event.clientX - finished.x, event.clientY - finished.y) >= threshold;
    if (finished.moved) select(nearest(event, finished.vertical));
    else if (!crossed && finished.button) select(finished.button);
    else onRestore();
  }

  function cancel() {
    if (gesture) finish({ pointerId: gesture.pointerId }, true);
  }

  function pointerDown(event) {
    // Touch/pen button values vary. Only reject a non-primary MOUSE button.
    if (gesture || event.isPrimary === false || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const items = buttons();
    if (!items.length) return;
    const button = buttonFor(event.target), active = nav.querySelector('[data-view].active') || items[0];
    const vertical = isVertical(items), rect = (button || active).getBoundingClientRect();
    const size = vertical ? active.offsetHeight : active.offsetWidth;
    const offset = button ? (vertical ? event.clientY - rect.top : event.clientX - rect.left) : size / 2;
    suppressedClick = null;
    gesture = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, button, active, vertical,
      grabOffset: Math.max(0, Math.min(size, offset)), moved: false };
    // Capture on down, before a finger can leave its initial button or the bar.
    try { nav.setPointerCapture(event.pointerId); }
    catch { /* Window listeners also finish a drag if capture is unavailable. */ }
  }

  function pointerMove(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const delta = gesture.vertical ? event.clientY - gesture.y : event.clientX - gesture.x;
    if (!gesture.moved && Math.abs(delta) < threshold) return;
    gesture.moved = true;
    if (event.cancelable) event.preventDefault();
    nav.classList.add('dragging');
    const glider = nav.querySelector('.nav-glider'), items = buttons();
    if (!glider || !items.length) return;
    const { active, vertical, grabOffset } = gesture, origin = nav.getBoundingClientRect();
    const position = vertical ? event.clientY - origin.top - nav.clientTop : event.clientX - origin.left - nav.clientLeft;
    const size = vertical ? active.offsetHeight : active.offsetWidth;
    const start = Math.min(...items.map(button => vertical ? button.offsetTop : button.offsetLeft));
    const end = Math.max(...items.map(button => vertical ? button.offsetTop + button.offsetHeight : button.offsetLeft + button.offsetWidth)) - size;
    const along = Math.max(start, Math.min(end, position - grabOffset));
    if (onGliderMove) { onGliderMove({x:vertical ? active.offsetLeft : along,y:vertical ? along : active.offsetTop,width:active.offsetWidth,height:active.offsetHeight}); return; }
    glider.style.width = active.offsetWidth + 'px';
    glider.style.height = active.offsetHeight + 'px';
    glider.style.transform = 'translate3d(' + (vertical ? active.offsetLeft : along) + 'px,' + (vertical ? along : active.offsetTop) + 'px,0)';
  }

  function pointerUp(event) { finish(event); }
  function pointerCancel(event) { finish(event, true); }
  function click(event) {
    const pointerClick = event.detail > 0 || event.pointerType === 'touch' || event.pointerType === 'pen';
    // A delayed compatibility click must not undo the view selected at pointerup.
    // A new physical down clears suppression; keyboard/programmatic clicks remain usable.
    // WebKit can report the touch pointer as id 0 and its mouse compatibility click as id 1.
    if (pointerClick && suppressedClick && window.performance.now() < suppressedClick.until) {
      event.preventDefault(); event.stopImmediatePropagation(); return;
    }
    const button = buttonFor(event.target);
    if (button) { cancel(); select(button); }
  }
  function keyDown(event) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const items = buttons(), index = items.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault(); cancel();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (index + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + items.length) % items.length;
    select(items[next]);
  }
  function contextMenu(event) { if (gesture) event.preventDefault(); }
  function visibilityChange() { if (document.hidden) cancel(); }
  const listeners = [
    [nav, 'pointerdown', pointerDown], [window, 'pointermove', pointerMove, { passive: false }],
    [window, 'pointerup', pointerUp], [window, 'pointercancel', pointerCancel],
    [nav, 'lostpointercapture', pointerCancel], [nav, 'click', click], [nav, 'keydown', keyDown],
    [nav, 'contextmenu', contextMenu], [window, 'blur', cancel], [window, 'resize', cancel],
    [document, 'visibilitychange', visibilityChange]
  ];
  for (const [target, type, listener, options] of listeners) target.addEventListener(type, listener, options);
  return () => {
    cancel(); suppressedClick = null;
    for (const [target, type, listener, options] of listeners) target.removeEventListener(type, listener, options);
  };
}
