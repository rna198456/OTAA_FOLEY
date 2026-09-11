/* preview-reliability.js — HUELLA
 * Prevents playback from being blocked by sample preloading.
 * The video/Foley preview starts immediately; missing WAV buffers fall back
 * to the existing procedural sound engine while real samples continue loading.
 */
'use strict';

(() => {
  if (typeof S === 'undefined') return;

  const video = document.getElementById('video-el');
  const playbackBtn = document.getElementById('btn-preview');
  if (!video || !playbackBtn) return;

  let starting = false;
  let originalStart = typeof window.startPreview === 'function' ? window.startPreview : null;
  let originalStop = typeof window.stopPreview === 'function' ? window.stopPreview : null;

  if (typeof originalStart !== 'function') return;

  window.startPreview = async function () {
    if (starting || S.isRecording || !S.videoLoaded) return;
    starting = true;

    try {
      if (typeof AudioEngine?.getCtx === 'function') AudioEngine.getCtx();

      // Start playback immediately. Do not wait for a potentially large batch
      // of WAV fetch/decode operations.
      await originalStart();

      // Preload in the background for subsequent triggers/preview passes.
      try {
        const layers = S.events
          .filter(ev => ev.time >= video.currentTime)
          .flatMap(ev => ev.layers || []);
        if (layers.length && typeof AudioEngine?.preloadLayers === 'function') {
          AudioEngine.preloadLayers(layers).catch(err =>
            console.warn('[preview] preload background failed', err)
          );
        }
      } catch (err) {
        console.warn('[preview] background preload skipped', err);
      }
    } catch (err) {
      console.warn('[preview] playback failed', err);
      S.isPreviewing = false;
      video.pause();
      playbackBtn.textContent = '▶ REPRODUCCIÓN';
    } finally {
      starting = false;
      playbackBtn.disabled = !S.videoLoaded;
    }
  };

  if (originalStop) {
    window.stopPreview = function () {
      starting = false;
      return originalStop.apply(this, arguments);
    };
  }
})();
