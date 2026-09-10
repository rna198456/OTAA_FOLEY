/*
 * rehearsal-playback.js — OTAA_FOLEY
 *
 * Unified playback control.
 *
 * The existing #btn-preview becomes the single REPRODUCCIÓN control:
 * - In ENSAYO (no recorded events): plays / pauses the video from the
 *   current timeline position.
 * - When events exist: plays / pauses the video and schedules the recorded
 *   Foley from the current timeline position.
 *
 * The current video.currentTime is always preserved; playback never forces
 * the video back to 0 unless the user has explicitly moved the playhead.
 */
'use strict';

(() => {
  const video = document.getElementById('video-el');
  const playbackBtn = document.getElementById('btn-preview');

  if (!video || !playbackBtn) return;

  playbackBtn.type = 'button';
  playbackBtn.textContent = '▶ REPRODUCCIÓN';
  playbackBtn.title = 'Reproducir / pausar video y Foley desde la posición actual';

  function hasRecordedEvents() {
    return typeof S !== 'undefined' && Array.isArray(S.events) && S.events.length > 0;
  }

  function syncButton() {
    const hasVideo = !!video.src;
    const recording = typeof S !== 'undefined' && S.isRecording;

    // Preview must remain clickable so the same control can pause it.
    playbackBtn.disabled = !hasVideo || recording;

    if (typeof S !== 'undefined' && S.isPreviewing) {
      playbackBtn.textContent = '❚❚ PAUSAR';
    } else if (!video.paused) {
      playbackBtn.textContent = '❚❚ PAUSAR';
    } else {
      playbackBtn.textContent = '▶ REPRODUCCIÓN';
    }
  }

  async function startUnifiedPlayback() {
    if (!video.src || (typeof S !== 'undefined' && S.isRecording)) return;

    // Existing preview engine already uses video.currentTime as the start
    // position and schedules only events at or after that position.
    if (hasRecordedEvents() && typeof startPreview === 'function') {
      await startPreview();
      syncButton();
      return;
    }

    // No events: ordinary video playback for ENSAYO, also from current position.
    try {
      await video.play();
    } catch (err) {
      console.warn('[playback] No se pudo reproducir el video:', err);
    }
    syncButton();
  }

  function stopUnifiedPlayback() {
    if (typeof S !== 'undefined' && S.isPreviewing && typeof stopPreview === 'function') {
      stopPreview();
    } else {
      video.pause();
    }
    syncButton();
  }

  // Capture phase prevents the old app.js #btn-preview click handler from
  // also running. REPRODUCCIÓN is therefore the single playback control.
  playbackBtn.addEventListener('click', event => {
    event.preventDefault();
    event.stopImmediatePropagation();

    if (!video.src) return;

    if ((typeof S !== 'undefined' && S.isPreviewing) || !video.paused) {
      stopUnifiedPlayback();
    } else {
      startUnifiedPlayback();
    }
  }, true);

  video.addEventListener('loadedmetadata', syncButton);
  video.addEventListener('play', syncButton);
  video.addEventListener('pause', syncButton);
  video.addEventListener('ended', () => {
    if (typeof S !== 'undefined' && S.isPreviewing && typeof stopPreview === 'function') {
      stopPreview();
    }
    syncButton();
  });

  setInterval(syncButton, 250);
  syncButton();
})();
