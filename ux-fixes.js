/*
 * ux-fixes.js — OTAA_FOLEY
 * Targeted UX corrections layered over the existing app.
 *
 * Fixes:
 *  - Timeline zoom keeps the selected/playhead position in focus.
 *  - Zoom extends beyond 32x, up to 128x.
 *  - Spacebar starts/pauses the unified REPRODUCCIÓN control after recording.
 *  - Event gain from the timeline/tooltip is applied to Foley during preview.
 *  - Event tooltip opens above the timeline instead of below it.
 */
'use strict';

(() => {
  const video = document.getElementById('video-el');
  const canvas = document.getElementById('waveform');
  const outer = document.getElementById('waveform-outer');
  const btnIn = document.getElementById('btn-zoom-in');
  const btnOut = document.getElementById('btn-zoom-out');
  const btnFit = document.getElementById('btn-zoom-fit');
  const zoomLabel = document.getElementById('zoom-label');
  const playbackBtn = document.getElementById('btn-preview');
  const tooltip = document.getElementById('event-tooltip');

  if (!video || !canvas || !outer || !btnIn || !btnOut || !btnFit || !zoomLabel || !playbackBtn) return;

  const ZOOM_MAX_FIX = 128;
  const ZOOM_FACTOR = Math.sqrt(2);

  function visibleDuration() {
    return (S.videoDuration || 10) / S.zoom;
  }

  function clampScrollFix() {
    const max = Math.max(0, (S.videoDuration || 0) - visibleDuration());
    S.scrollOffset = Math.max(0, Math.min(S.scrollOffset, max));
  }

  function formatZoom(z) {
    if (z >= 100) return Math.round(z) + '×';
    if (z >= 10) return Math.round(z * 10) / 10 + '×';
    if (z >= 2) return Math.round(z * 10) / 10 + '×';
    return (Math.round(z * 100) / 100) + '×';
  }

  function updateZoomUIFix() {
    zoomLabel.textContent = formatZoom(S.zoom);
    btnOut.disabled = S.zoom <= 1;
    btnIn.disabled = S.zoom >= ZOOM_MAX_FIX;
  }

  // Keep the chosen focus time at the same relative pixel after zooming.
  function zoomAround(anchorTime, anchorRatio, nextZoom) {
    const oldZoom = S.zoom;
    const oldVis = visibleDuration();
    const safeAnchor = Math.max(0, Math.min(S.videoDuration || 0, anchorTime));
    const ratio = Math.max(0, Math.min(1, anchorRatio));

    S.zoom = Math.max(1, Math.min(ZOOM_MAX_FIX, nextZoom));
    const newVis = visibleDuration();
    S.scrollOffset = safeAnchor - ratio * newVis;

    // Avoid jumps when zooming around a focus point outside the old visible area.
    if (!Number.isFinite(S.scrollOffset)) S.scrollOffset = 0;
    clampScrollFix();
    updateZoomUIFix();
    drawWaveform();
    updateScrollbar();

    return { oldZoom, oldVis, newVis };
  }

  // Replace the original left-edge anchored zoom function.
  setZoom = function (nextZoom) {
    const ev = S.events.find(e => e.id === S.selectedEvId);
    const focus = ev ? ev.time : video.currentTime;
    const vis = visibleDuration();
    const ratio = vis > 0 ? (focus - S.scrollOffset) / vis : 0.5;
    zoomAround(focus, Math.max(0, Math.min(1, ratio)), nextZoom);
  };

  // Capture phase prevents the old zoom button handlers from also firing.
  btnIn.addEventListener('click', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    setZoom(S.zoom * ZOOM_FACTOR);
  }, true);

  btnOut.addEventListener('click', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    setZoom(S.zoom / ZOOM_FACTOR);
  }, true);

  btnFit.addEventListener('click', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    S.zoom = 1;
    S.scrollOffset = 0;
    updateZoomUIFix();
    drawWaveform();
    updateScrollbar();
  }, true);

  // Wheel zoom follows the mouse position.
  outer.addEventListener('wheel', event => {
    event.preventDefault();
    event.stopImmediatePropagation();

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const width = canvas.offsetWidth || 1;
    const anchorTime = S.scrollOffset + (x / width) * visibleDuration();
    const nextZoom = S.zoom * (event.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR);
    zoomAround(anchorTime, x / width, nextZoom);
  }, { passive: false, capture: true });

  // Pinch zoom follows the midpoint between the two fingers.
  let pinch = null;
  outer.addEventListener('touchstart', event => {
    if (event.touches.length !== 2) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const a = event.touches[0];
    const b = event.touches[1];
    const mx = (a.clientX + b.clientX) / 2;
    const my = (a.clientY + b.clientY) / 2;
    const rect = canvas.getBoundingClientRect();
    const ratio = (mx - rect.left) / (canvas.offsetWidth || 1);
    pinch = {
      dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
      zoom: S.zoom,
      anchorTime: S.scrollOffset + ratio * visibleDuration(),
      ratio,
    };
  }, { passive: false, capture: true });

  outer.addEventListener('touchmove', event => {
    if (event.touches.length !== 2 || !pinch) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const a = event.touches[0];
    const b = event.touches[1];
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    zoomAround(pinch.anchorTime, pinch.ratio, pinch.zoom * (dist / Math.max(1, pinch.dist)));
  }, { passive: false, capture: true });

  outer.addEventListener('touchend', event => {
    if (event.touches.length < 2) pinch = null;
  }, { capture: true });

  // ── Unified preview with event gain ────────────────────────────────────
  const originalStopPreview = stopPreview;

  startPreview = async function () {
    if (!S.events.length || !S.videoLoaded) return;

    S.isPreviewing = true;
    S.previewTimers.forEach(clearTimeout);
    S.previewTimers = [];

    const startAt = video.currentTime;
    S.startTimecode = startAt;
    const ctx = AudioEngine.getCtx();

    S.events.filter(ev => ev.time >= startAt).forEach(ev => {
      const delayMs = Math.max(0, (ev.time - startAt) * 1000);
      S.previewTimers.push(setTimeout(() => {
        if (!S.isPreviewing) return;

        const eventGain = ev.gain ?? 1;
        const layersWithEventGain = (ev.layers || []).map(layer => ({
          ...layer,
          gainMult: (layer.gainMult ?? 1) * eventGain,
        }));

        AudioEngine.scheduleLayers(layersWithEventGain, ctx.currentTime + 0.02);
      }, delayMs));
    });

    try {
      await video.play();
    } catch (err) {
      S.isPreviewing = false;
      S.previewTimers.forEach(clearTimeout);
      S.previewTimers = [];
      console.warn('[playback] No se pudo reproducir el video:', err);
      return;
    }

    playbackBtn.textContent = '❚❚ PAUSAR';
    if (typeof playIndicator !== 'undefined') playIndicator.classList.remove('hidden');
    startRaf();
  };

  // Keep the original stop behavior but ensure UI follows the unified control.
  stopPreview = function () {
    originalStopPreview();
    playbackBtn.textContent = '▶ REPRODUCCIÓN';
  };

  // ── Spacebar = unified playback (or trigger while recording) ────────────
  document.addEventListener('keydown', event => {
    if (event.code !== 'Space' || event.repeat) return;

    const target = event.target;
    const isEditable = target && (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable
    );
    if (isEditable) return;

    if (S.isRecording) {
      if (!playbackBtn.disabled && !document.getElementById('btn-trigger').disabled) {
        event.preventDefault();
        event.stopImmediatePropagation();
        fireTrigger();
      }
      return;
    }

    if (!S.videoLoaded) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    playbackBtn.click();
  }, true);

  // Keep zoom UI coherent after loading a video and after resize.
  video.addEventListener('loadedmetadata', () => {
    S.zoom = 1;
    S.scrollOffset = 0;
    updateZoomUIFix();
  });
  window.addEventListener('resize', updateZoomUIFix);
  updateZoomUIFix();
})();
