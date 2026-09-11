/* dynamic-layout.js — HUELLA
 * Adapts the video/timeline balance to the current task:
 * - RECORDING / PLAYBACK: video maximized, compact timeline.
 * - PAUSED / STOPPED: video gives space back to timeline for zoom/editing.
 */
'use strict';

(() => {
  if (typeof S === 'undefined') return;

  const video = document.getElementById('video-el');
  const panel = document.getElementById('timeline-panel');
  const outer = document.getElementById('waveform-outer');
  const canvas = document.getElementById('waveform');
  if (!video || !panel || !outer || !canvas) return;

  const style = document.createElement('style');
  style.id = 'huella-dynamic-layout-style';
  style.textContent = `
    /* Remove all legacy reserve space from the old floating editor. */
    #waveform-outer {
      min-height: 0 !important;
      padding-bottom: 0 !important;
    }

    #timeline-panel {
      transition: padding .18s ease, gap .18s ease;
    }

    /* LIVE = recording or playback: give the video maximum vertical room. */
    body.huella-live #waveform,
    body.huella-live #waveform-outer {
      transition: height .18s ease, min-height .18s ease;
    }
    body.huella-live #waveform {
      height: 62px !important;
    }

    /* The canvas renderer keeps its original internal 120 px bitmap while
       live mode visually compresses it. The tiny time labels at the bottom
       therefore become illegible; hide only that label strip while live. */
    body.huella-live #waveform-outer::after {
      content: '';
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: 12px;
      background: #0D0D0F;
      pointer-events: none;
      z-index: 2;
    }

    body.huella-live #timeline-panel {
      padding-top: 5px;
      padding-bottom: 6px;
      gap: 4px;
    }

    /* EDIT = paused/stopped: enlarge the timeline for precision work. */
    body.huella-edit #waveform {
      height: 150px !important;
    }

    body.huella-edit #timeline-panel {
      padding-top: 7px;
      padding-bottom: 8px;
      gap: 6px;
    }

    @media(max-width:700px){
      body.huella-live #waveform {
        height: 56px !important;
      }
      body.huella-live #waveform-outer::after {
        height: 10px;
      }
      body.huella-edit #waveform {
        height: 112px !important;
      }
    }
  `;
  document.head.appendChild(style);

  let lastLive = null;

  function updateLayout() {
    const live = !!S.isRecording || !!S.isPreviewing || !video.paused;
    if (live === lastLive) return;
    lastLive = live;
    document.body.classList.toggle('huella-live', live);
    document.body.classList.toggle('huella-edit', !live);

    /* Let the latest layout state redraw through the existing renderer. */
    if (typeof drawWaveform === 'function') {
      requestAnimationFrame(() => drawWaveform());
    }
  }

  // Keep the state synchronized with native video transport events.
  ['play', 'playing', 'pause', 'ended', 'emptied', 'loadedmetadata'].forEach(type => {
    video.addEventListener(type, updateLayout, true);
  });

  // App state flags (recording / HUELLA playback) change outside the native
  // video events, so use a very light polling loop to catch those transitions.
  const timer = window.setInterval(updateLayout, 120);

  // Stop the timer if the page is discarded.
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });

  updateLayout();
})();
