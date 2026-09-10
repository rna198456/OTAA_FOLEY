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

  let videoOnlyPlayback = false;

  function hasRecordedEvents() {
    return typeof S !== 'undefined' && Array.isArray(S.events) && S.events.length > 0;
  }

  function syncButton() {
    const hasVideo = !!video.src;
    const blocked = typeof S !== 'undefined' && (S.isRecording || S.isPreviewing);

    playbackBtn.disabled = !hasVideo || blocked;

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

    // With recorded events, use the application's existing preview engine.
    // startPreview() already starts from video.currentTime and schedules only
    // events at or after that position.
    if (hasRecordedEvents() && typeof startPreview === 'function') {
      videoOnlyPlayback = false;
      await startPreview();
      syncButton();
      return;
    }

    // No events: ordinary video playback for ENSAYO.
    videoOnlyPlayback = true;
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
      videoOnlyPlayback = false;
    } else {
      video.pause();
      videoOnlyPlayback = false;
    }
    syncButton();
  }

  // Capture phase prevents app.js's old #btn-preview click handler from
  // running as well. This makes REPRODUCCIÓN the single source of playback.
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

  video.addEventListener('loadedmetadata', () => {
    videoOnlyPlayback = false;
    syncButton();
  });
  video.addEventListener('play', syncButton);
  video.addEventListener('pause', syncButton);
  video.addEventListener('ended', () => {
    videoOnlyPlayback = false;
    if (typeof S !== 'undefined' && S.isPreviewing && typeof stopPreview === 'function') {
      stopPreview();
    }
    syncButton();
  });

  // Loading a new video clears the session in app.js, so the same button
  // naturally returns to video-only ENSAYO playback.
  setInterval(syncButton, 250);
  syncButton();
})();
