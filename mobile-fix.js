/*
 * mobile-fix.js
 *
 * Touch UX fix for the Foley library on smartphones.
 * The original app uses pointerdown + preventDefault() on footwear and
 * surface buttons. A vertical swipe can therefore be interpreted as a
 * button press instead of a scroll gesture.
 */
(function () {
  'use strict';

  const libraryScroll = document.getElementById('library-scroll');
  const surfaceList = document.getElementById('surface-list');
  const fwGrid = document.getElementById('fw-grid');

  if (!libraryScroll || !surfaceList || !fwGrid) return;

  libraryScroll.style.touchAction = 'pan-y';
  surfaceList.style.touchAction = 'pan-y';
  fwGrid.style.touchAction = 'pan-y';

  const state = new Map();
  const TAP_SLOP = 10;
  let library = null;

  function getLibrary() {
    if (library) return Promise.resolve(library);
    return fetch('library.json')
      .then(response => {
        if (!response.ok) throw new Error('No se pudo cargar library.json');
        return response.json();
      })
      .then(data => {
        library = data;
        return data;
      });
  }

  function install(container, selector, action) {
    container.addEventListener('pointerdown', function (event) {
      const button = event.target.closest(selector);
      if (!button || !container.contains(button)) return;

      // Block app.js's original pointerdown handler, but keep the browser's
      // native scrolling behavior by deliberately NOT calling preventDefault().
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

      // A swipe is only a scroll gesture.
      if (info.moved) return;

      const currentTarget = document.elementFromPoint(event.clientX, event.clientY);
      const currentButton = currentTarget && currentTarget.closest(selector);
      if (currentButton !== info.button) return;

      action(info.button);
    }, true);

    container.addEventListener('pointercancel', function (event) {
      state.delete(event.pointerId);
    }, true);
  }

  install(surfaceList, '.surf-check', function (button) {
    if (typeof window.toggleSurface !== 'function') return;
    const id = button.dataset.surfId;
    // toggleSurface only requires surf.id; app.js uses S.lib for the rest.
    window.toggleSurface({ id });
  });

  install(fwGrid, '.fw-btn', function (button) {
    if (typeof window.selectFootwear !== 'function') return;
    const id = button.dataset.fwId;
    getLibrary()
      .then(lib => {
        const footwear = (lib.footwear || []).find(fw => fw.id === id);
        if (footwear) window.selectFootwear(footwear);
      })
      .catch(() => {});
  });
})();
