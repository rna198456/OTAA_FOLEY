/* runtime-fixes.js — OTAA_FOLEY
 * Final runtime reliability layer.
 *
 * - Normalizes event layers against library.json before playback.
 * - Preloads every WAV needed by the current event set after timeline edits.
 * - Makes Space a reliable PLAY/STOP transport without requiring a prior click.
 * - During recording, Space remains the Foley trigger handled by final-fixes.js.
 * - Recording is incremental: starting a new recording pass preserves all
 *   previously recorded events in the same video/session.
 */
'use strict';

(() => {
  if (typeof S === 'undefined') return;

  const video = document.getElementById('video-el');
  const playbackBtn = document.getElementById('btn-preview');
  const btnRecord = document.getElementById('btn-record');
  const btnStop = document.getElementById('btn-stop');
  const recIndicator = document.getElementById('rec-indicator');
  const hintBar = document.getElementById('hint-bar');

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

  // ── Incremental recording ─────────────────────────────────────────────
  // app.js historically cleared S.events and the session log in startRecording().
  // Override it here with the same recording behavior, but preserve the events
  // already recorded for the current video.
  if (btnRecord && btnStop && typeof startRecording === 'function') {
    startRecording = function () {
      if (!S.videoLoaded || S.isRecording) return;

      AudioEngine.getCtx();
      S.startTimecode = video.currentTime;
      S.isRecording = true;

      // IMPORTANT: do NOT clear S.events or the session log here.
      // A second/third pass adds new events to the existing timeline.
      btnRecord.style.display = 'none';
      btnStop.style.display = 'inline-block';
      btnStop.disabled = false;
      playbackBtn.disabled = true;

      recIndicator?.classList.remove('hidden');
      if (hintBar) hintBar.classList.remove('hidden');
      if (typeof updateEventCount === 'function') updateEventCount();
      if (typeof updateHint === 'function') updateHint();
      if (typeof hideTooltip === 'function') hideTooltip();
      if (typeof drawWaveform === 'function') drawWaveform();
      if (typeof startRaf === 'function') startRaf();

      const p = video.play();
      if (p && typeof p.catch === 'function') p.catch(err => console.warn('[record]', err));
    };
  }

  // Keep the transport usable after every recording pass.
  if (typeof stopRecording === 'function' && playbackBtn) {
    const originalStopRecording = stopRecording;
    stopRecording = function (...args) {
      const result = originalStopRecording.apply(this, args);
      if (S.videoLoaded && !S.isRecording) playbackBtn.disabled = false;
      return result;
    };
  }

  // ── Preview preparation ────────────────────────────────────────────────
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

  // ── Space = playback transport ────────────────────────────────────────
  // Capture at window level so keyboard focus never has to be placed on the
  // button first. During recording, final-fixes.js keeps Space as the Foley
  // trigger instead.
  window.addEventListener('keydown', event => {
    if (event.code !== 'Space' || event.repeat) return;
    const target = event.target;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (S.isRecording) return;
    if (!S.videoLoaded || typeof window.startPreview !== 'function') return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (S.isPreviewing) {
      if (typeof window.stopPreview === 'function') window.stopPreview();
    } else {
      window.startPreview();
    }
  }, true);

  normalizeEvents();
})();
