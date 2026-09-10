/*
 * rehearsal-playback.js — OTAA_FOLEY
 *
 * Adds independent video playback so ENSAYO can be used without entering
 * recording mode. The existing GRABAR control remains responsible only for
 * recording events into the timeline.
 */
'use strict';

(() => {
  const video = document.getElementById('video-el');
  const controlsRow = document.getElementById('controls-row');
  if (!video || !controlsRow) return;

  const playBtn = document.createElement('button');
  playBtn.id = 'btn-video-play';
  playBtn.className = 'btn btn-ghost';
  playBtn.type = 'button';
  playBtn.textContent = '▶ REPRODUCIR';
  playBtn.disabled = true;
  playBtn.title = 'Reproducir / pausar video';

  // Put independent video playback before GRABAR.
  const recordBtn = document.getElementById('btn-record');
  if (recordBtn) controlsRow.insertBefore(playBtn, recordBtn);
  else controlsRow.insertBefore(playBtn, controlsRow.firstChild);

  function syncButton() {
    if (!video.src) {
      playBtn.disabled = true;
      playBtn.textContent = '▶ REPRODUCIR';
      return;
    }

    playBtn.disabled = !!S.isRecording;
    playBtn.textContent = video.paused ? '▶ REPRODUCIR' : '❚❚ PAUSAR';
  }

  async function togglePlayback() {
    if (!video.src || S.isRecording) return;

    if (video.paused) {
      try {
        await video.play();
      } catch (err) {
        console.warn('[playback] No se pudo reproducir el video:', err);
      }
    } else {
      video.pause();
    }

    syncButton();
  }

  playBtn.addEventListener('click', togglePlayback);
  video.addEventListener('play', syncButton);
  video.addEventListener('pause', syncButton);
  video.addEventListener('ended', syncButton);
  video.addEventListener('loadedmetadata', syncButton);

  // Keep the independent playback control coherent with the recording state.
  setInterval(syncButton, 250);
  syncButton();
})();
