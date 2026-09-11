/* scroll-drag-guard.js — HUELLA
 * Prevents the timeline scrollbar from staying latched to the mouse/touch
 * after a scrollbar interaction. The legacy app.js scrollbar uses document
 * mouse/touch listeners, so we explicitly terminate any stale drag whenever
 * a normal timeline gesture begins, and also on pointer cancellation/blur.
 */
'use strict';

(() => {
  const canvas = document.getElementById('waveform');
  const thumb = document.getElementById('tl-scroll-thumb');
  if (!canvas || !thumb) return;

  const finishLegacyScrollbarDrag = () => {
    // app.js clears its private _sbDrag variable from these document events.
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    document.dispatchEvent(new Event('touchend', { bubbles: true }));
  };

  // Starting a normal timeline gesture must never inherit an old scrollbar drag.
  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    finishLegacyScrollbarDrag();
  }, true);

  // Belt-and-suspenders cleanup for interrupted pointer/touch gestures.
  document.addEventListener('pointerup', finishLegacyScrollbarDrag, true);
  document.addEventListener('pointercancel', finishLegacyScrollbarDrag, true);
  window.addEventListener('blur', finishLegacyScrollbarDrag, true);
})();
