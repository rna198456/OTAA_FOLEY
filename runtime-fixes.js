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
  // app.js registers its own click listener before this file loads. A later
  // reassignment of startRecording would not replace that already-registered
  // callback, so capture the button click here and stop the old callback first.
  function startIncrementalRecording() {
    if (!S.videoLoaded || S.isRecording) return;

    // Never carry a preview transport state into a new recording pass.
    if (S.isPreviewing && typeof window.stopPreview === 'function') {
      window.stopPreview();
    } else {
      S.isPreviewing = false;
      S.previewTimers?.forEach(clearTimeout);
      S.previewTimers = [];
    }

    AudioEngine.getCtx();
    S.startTimecode = video.currentTime;
    S.isRecording = true;

    // IMPORTANT: preserve S.events and the existing session log.
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
  }

  if (btnRecord) {
    btnRecord.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      startIncrementalRecording();
    }, true);
  }

  // Build a real wrapper around the current implementation and intercept the
  // existing button listener in capture phase, since app.js already registered
  // its callback before this compatibility layer was loaded.
  let wrappedStopRecording = null;
  if (typeof stopRecording === 'function') {
    const originalStopRecording = stopRecording;
    wrappedStopRecording = function (...args) {
      const result = originalStopRecording.apply(this, args);
      S.isPreviewing = false;
      S.previewTimers?.forEach(clearTimeout);
      S.previewTimers = [];
      if (S.videoLoaded && !S.isRecording) playbackBtn.disabled = false;
      if (typeof drawWaveform === 'function') drawWaveform();
      return result;
    };
    stopRecording = wrappedStopRecording;
  }

  if (btnStop && wrappedStopRecording) {
    btnStop.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      wrappedStopRecording();
    }, true);
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
      S.isPreviewing = false;
      S.previewTimers?.forEach(clearTimeout);
      S.previewTimers = [];
      playbackBtn.disabled = !S.videoLoaded;
      if (typeof drawWaveform === 'function') drawWaveform();
    };
  }

  // ── Space = playback transport ────────────────────────────────────────
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
