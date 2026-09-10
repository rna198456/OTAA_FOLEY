/*
 * mobile-fix.js
 *
 * Touch UX fix for the Foley library on smartphones.
 *
 * The original app uses pointerdown + preventDefault() on footwear and
 * surface buttons. That makes a vertical swipe inside the library behave
 * like a button press instead of a scroll gesture.
 *
 * This layer captures those pointerdown events before they reach the
 * original handlers, lets the browser keep its native vertical scrolling,
 * and only performs the selection when the gesture is a short tap.
 */
(function () {
  'use strict';

  const libraryScroll = document.getElementById('library-scroll');
  const surfaceList = document.getElementById('surface-list');
  const fwGrid = document.getElementById('fw-grid');

  if (!libraryScroll || !surfaceList || !fwGrid) return;

  // Explicitly preserve native vertical scrolling in the library.
  libraryScroll.style.touchAction = 'pan-y';
  surfaceList.style.touchAction = 'pan-y';
  fwGrid.style.touchAction = 'pan-y';

  const state = new Map();
  const TAP_SLOP = 10; // px allowed before a touch becomes a scroll gesture

  function install(container, selector, action) {
    container.addEventListener('pointerdown', function (event) {
      const button = event.target.closest(selector);
      if (!button || !container.contains(button)) return;

      // Stop the original target-level pointerdown handler in app.js.
      // We deliberately do NOT call preventDefault(): vertical scrolling
      // must remain a native browser gesture.
      event.stopPropagation();

      state.set(event.pointerId, {
        button,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
      });
    }, true);

    container.addEventListener('pointermove', function (event) {
      const info = state.get(event.pointerId);
      if (!info) return;

      const dx = event.clientX - info.startX;
      const dy = event.clientY - info.startY;
      if (Math.hypot(dx, dy) > TAP_SLOP) info.moved = true;
    }, true);

    container.addEventListener('pointerup', function (event) {
      const info = state.get(event.pointerId);
      if (!info) return;
      state.delete(event.pointerId);

      // A swipe is a scroll gesture, not a selection.
      if (info.moved) return;

      // Only react if the same button is still under the pointer.
      const currentTarget = document.elementFromPoint(event.clientX, event.clientY);
      const currentButton = currentTarget && currentTarget.closest(selector);
      if (currentButton !== info.button) return;

      action(buttonFromElement(info.button));
    }, true);

    container.addEventListener('pointercancel', function (event) {
      state.delete(event.pointerId);
    }, true);
  }

  function buttonFromElement(button) {
    return button;
  }

  install(surfaceList, '.surf-check', function (button) {
    if (typeof window.toggleSurface !== 'function') return;
    const id = button.dataset.surfId;
    const surface = window.S && window.S.lib && Array.isArray(window.S.lib.surfaces)
      ? window.S.lib.surfaces.find(s => s.id === id)
      : null;
    if (surface) window.toggleSurface(surface);
  });

  install(fwGrid, '.fw-btn', function (button) {
    if (typeof window.selectFootwear !== 'function') return;
    const id = button.dataset.fwId;
    const footwear = window.S && window.S.lib && Array.isArray(window.S.lib.footwear)
      ? window.S.lib.footwear.find(f => f.id === id)
      : null;
    if (footwear) window.selectFootwear(footwear);
  });
})();
