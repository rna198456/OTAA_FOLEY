/* runtime-fixes.js — OTAA_FOLEY
 * Final runtime reliability layer.
 *
 * - Normalizes event layers against library.json before playback.
 * - Preloads every WAV needed by the current event set after timeline edits.
 * - Makes Space a reliable PLAY/STOP transport without requiring a prior click.
 * - During recording, Space remains the Foley trigger handled by final-fixes.js.
 */
'use strict';

(() => {
  if (typeof S === 'undefined') return;

  const video = document.getElementById('video-el');
  const playbackBtn = document.getElementById('btn-preview');
  if (!video || !playbackBtn) return;

  function normalizeEvents() {
    const surfaces = S.lib?.surfaces || [];
    S.events.forEach(ev => {
      (ev.layers || []).forEach(layer => {
        if (layer?.surface?.id) {
          const canonical = surfaces.find(s => s.id === layer.surface.id);
          if (canonical) layer.surface = canonical;
        }
        if (!Number.isFinite(Number(layer.rrIdx)) || Number(layer.rrIdx) < 0) layer.rrIdx = 0;
        layer.rrIdx = Math.floor(Number(layer.rrIdx));
      });
    });
  }

  // Wrap the consolidated preview once. The first play from Space therefore
  // has exactly the same preparation as the button, instead of depending on
  // a previous mouse click to initialize/cache the selected Foley WAVs.
  const originalStartPreview = window.startPreview;
  const originalStopPreview = window.stopPreview;
  let preparing = false;

  if (typeof originalStartPreview === 'function' && typeof originalStopPreview === 'function') {
    window.startPreview = async function () {
      if (preparing) return;
      if (!S.videoLoaded || S.isRecording) return;

      normalizeEvents();
      preparing = true;
      playbackBtn.textContent = '… CARGANDO';
      playbackBtn.disabled = true;

      try {
        const layers = S.events
          .filter(ev => ev.time >= video.currentTime)
          .flatMap(ev => ev.layers || []);
        if (typeof AudioEngine.preloadLayers === 'function') {
          await AudioEngine.preloadLayers(layers);
        }
        if (!S.videoLoaded || S.isRecording) return;
        await originalStartPreview();
      } catch (err) {
        console.warn('[runtime] No se pudo preparar la reproducción', err);
        S.isPreviewing = false;
        S.previewTimers?.forEach(clearTimeout);
        S.previewTimers = [];
        video.pause();
        playbackBtn.textContent = '▶ REPRODUCCIÓN';
      } finally {
        preparing = false;
        playbackBtn.disabled = !S.videoLoaded;
      }
    };

    window.stopPreview = function () {
      preparing = false;
      originalStopPreview();
      playbackBtn.disabled = !S.videoLoaded;
    };
  }

  // Window capture runs before document-level shortcuts. It guarantees that
  // Space reaches the transport even when focus was never placed on the button.
  window.addEventListener('keydown', event => {
    if (event.code !== 'Space' || event.repeat) return;
    const target = event.target;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (S.isRecording) return; // final-fixes owns Space during recording
    if (!S.videoLoaded || typeof window.startPreview !== 'function') return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (S.isPreviewing) {
      if (typeof window.stopPreview === 'function') window.stopPreview();
    } else {
      window.startPreview();
    }
  }, true);

  // Normalize immediately after the file/state has changed as an additional
  // guard for old sessions containing stale surface objects.
  normalizeEvents();
})();
