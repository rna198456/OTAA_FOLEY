/* interaction-polish.js — OTAA_FOLEY
 * Final compatibility / interaction layer.
 *
 * - Stops legacy mouse/touch canvas handlers from competing with the
 *   consolidated pointer-event timeline interaction.
 * - Event editor changes footwear and active surfaces only.
 * - No sample/step dropdown is exposed in the editor.
 * - Keeps REPRODUCCIÓN available as soon as a video is loaded.
 * - Allows a simple tap/click on an empty timeline area to seek the video.
 * - Reuses the existing ✕ button as a close button for the event popup.
 */
'use strict';

(() => {
  if (typeof S === 'undefined') return;

  const canvas = document.getElementById('waveform');
  const video = document.getElementById('video-el');
  const playbackBtn = document.getElementById('btn-preview');
  const modalOverlay = document.getElementById('modal-overlay');
  const modalContent = document.getElementById('modal-content');
  const tooltipDelete = document.getElementById('tooltip-delete');

  if (!canvas || !modalOverlay || !modalContent) return;

  // Legacy canvas handlers are owned by final-fixes.js now.
  ['mousedown', 'mousemove', 'mouseup', 'mouseleave', 'touchstart', 'touchmove', 'touchend'].forEach(type => {
    canvas.addEventListener(type, event => {
      if (S.isRecording) return;
      event.stopImmediatePropagation();
    }, true);
  });

  // REPRODUCCIÓN is also the normal video transport and therefore must be
  // usable immediately after a video has valid metadata.
  function enablePlaybackForLoadedVideo() {
    if (!playbackBtn || !video) return;
    if (S.videoLoaded || (Number.isFinite(video.duration) && video.duration > 0)) {
      S.videoLoaded = true;
      if (!S.videoDuration && Number.isFinite(video.duration)) S.videoDuration = video.duration;
      playbackBtn.disabled = false;
    }
  }
  ['loadedmetadata', 'durationchange', 'canplay'].forEach(type => {
    video?.addEventListener(type, enablePlaybackForLoadedVideo);
  });
  enablePlaybackForLoadedVideo();

  // Keep the transport enabled after ending a recording, even if no event was
  // recorded. The video itself is still a valid thing to play/stop.
  if (typeof stopRecording === 'function' && playbackBtn) {
    const originalStopRecording = stopRecording;
    stopRecording = function (...args) {
      const result = originalStopRecording.apply(this, args);
      if (S.videoLoaded && !S.isRecording) playbackBtn.disabled = false;
      return result;
    };
  }

  // Reliable seek on a free timeline area. Event clicks remain event editing.
  let tap = null;

  document.addEventListener('pointerdown', event => {
    if (event.target !== canvas || event.button !== 0) return;
    if (S.isRecording || S.isPreviewing || !S.videoLoaded) return;
    const rect = canvas.getBoundingClientRect();
    tap = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      pointerId: event.pointerId,
    };
  }, true);

  document.addEventListener('pointerup', event => {
    if (!tap || event.pointerId !== tap.pointerId) return;
    const start = tap;
    tap = null;

    if (S.isRecording || S.isPreviewing || !S.videoLoaded || S.videoDuration <= 0) return;

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (Math.hypot(x - start.x, y - start.y) > 6) return;
    if (x < 0 || x > rect.width || y < 0 || y > rect.height) return;

    const width = Math.max(1, canvas.offsetWidth);
    const visibleDuration = (S.videoDuration || 10) / Math.max(1, S.zoom || 1);
    const timeAtX = S.scrollOffset + (x / width) * visibleDuration;

    for (const ev of S.events) {
      const ex = ((ev.time - S.scrollOffset) / Math.max(0.000001, visibleDuration)) * width;
      if (Math.abs(ex - x) <= 14) return;
    }

    video.currentTime = Math.max(0, Math.min(S.videoDuration, timeAtX));
    if (typeof drawWaveform === 'function') drawWaveform();
  }, true);

  document.addEventListener('pointercancel', event => {
    if (tap?.pointerId === event.pointerId) tap = null;
  }, true);

  // ✕ now closes the event popup. Deletion is handled by Delete/Backspace and
  // the group-selection delete action.
  if (tooltipDelete) {
    tooltipDelete.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (typeof hideTooltip === 'function') hideTooltip();
    }, true);
    tooltipDelete.title = 'Cerrar';
    tooltipDelete.setAttribute('aria-label', 'Cerrar');
  }

  // Individual event editor: footwear + surfaces only. Existing rrIdx values
  // are deliberately preserved and are no longer exposed as a UI selector.
  openChangeModal = function (evId) {
    const target = S.events.find(ev => ev.id === evId);
    if (!target) return;

    const title = document.querySelector('#modal-box .modal-title');
    if (title) title.textContent = 'Cambiar combinación del evento';
    modalContent.innerHTML = '';

    const info = document.createElement('p');
    info.style.cssText = 'font-size:11px;color:var(--sub);margin-bottom:10px;font-family:var(--mono)';
    info.textContent = 'Cambiá calzado y una o más superficies:';
    modalContent.appendChild(info);

    let tempFw = (S.lib.footwear || []).find(f => f.id === target.layers?.[0]?.fwId) || S.lib.footwear?.[0];
    if (!tempFw) return;

    const fwRow = document.createElement('div');
    fwRow.className = 'fw-grid';
    fwRow.style.marginBottom = '10px';
    (S.lib.footwear || []).forEach(fw => {
      const b = document.createElement('button');
      b.className = 'fw-btn' + (fw.id === tempFw.id ? ' selected' : '');
      b.innerHTML = `<span class="fw-emoji">${fw.emoji}</span><span class="fw-label">${fw.label}</span>`;
      b.addEventListener('click', event => {
        event.preventDefault();
        tempFw = fw;
        fwRow.querySelectorAll('.fw-btn').forEach(x => x.classList.toggle('selected', x === b));
      });
      fwRow.appendChild(b);
    });
    modalContent.appendChild(fwRow);

    const tempSurfs = {};
    (target.layers || []).forEach(layer => {
      if (layer.surface?.id) {
        tempSurfs[layer.surface.id] = { gainMult: layer.gainMult ?? 1, rrIdx: layer.rrIdx ?? 0 };
      }
    });

    const surfWrap = document.createElement('div');
    (S.lib.surfaces || []).forEach(surf => {
      const row = document.createElement('div');
      row.className = 'surface-row';

      const active = !!tempSurfs[surf.id];
      const cb = document.createElement('button');
      cb.className = 'surf-check' + (active ? ' selected' : '');
      cb.style.borderColor = active ? (surf.color || '') : '';
      cb.innerHTML = `<span class="surf-emoji">${surf.emoji}</span><span class="surf-name">${surf.label}</span>`;

      const data = tempSurfs[surf.id] || { gainMult: 1 };
      const fader = document.createElement('div');
      fader.className = 'surf-fader-wrap' + (active ? '' : ' hidden');
      fader.innerHTML = `<input type="range" class="surf-fader" min="0" max="200" step="1" value="${Math.round((data.gainMult ?? 1) * 100)}"/><span class="surf-fader-val">${Math.round((data.gainMult ?? 1) * 100)}%</span>`;
      fader.querySelector('input').addEventListener('input', event => {
        if (!tempSurfs[surf.id]) tempSurfs[surf.id] = { gainMult: 1, rrIdx: 0 };
        tempSurfs[surf.id].gainMult = Number(event.target.value) / 100;
        fader.querySelector('.surf-fader-val').textContent = event.target.value + '%';
      });

      cb.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation();
        if (tempSurfs[surf.id]) {
          delete tempSurfs[surf.id];
          cb.classList.remove('selected');
          cb.style.borderColor = '';
          fader.classList.add('hidden');
        } else {
          tempSurfs[surf.id] = { gainMult: 1, rrIdx: 0 };
          cb.classList.add('selected');
          cb.style.borderColor = surf.color || '';
          fader.classList.remove('hidden');
        }
      });

      row.appendChild(cb);
      row.appendChild(fader);
      surfWrap.appendChild(row);
    });
    modalContent.appendChild(surfWrap);

    const hint = document.createElement('div');
    hint.style.cssText = 'font:8px var(--mono);color:var(--dark);margin-top:8px';
    hint.textContent = 'Los pasos/samples grabados de cada evento se conservan.';
    modalContent.appendChild(hint);

    const apply = document.createElement('button');
    apply.className = 'btn btn-amber btn-sm';
    apply.style.cssText = 'width:100%;margin-top:10px';
    apply.textContent = 'APLICAR';
    apply.addEventListener('click', event => {
      event.preventDefault(); event.stopImmediatePropagation();
      const current = S.events.find(ev => ev.id === target.id);
      if (!current || !Object.keys(tempSurfs).length) return;

      const oldLayers = current.layers || [];
      current.layers = Object.entries(tempSurfs).map(([sid, data]) => {
        const surface = (S.lib.surfaces || []).find(s => s.id === sid);
        const old = oldLayers.find(l => l.surface?.id === sid);
        return {
          fwId: tempFw.id,
          surface,
          gainMult: data.gainMult,
          rrIdx: old?.rrIdx ?? 0,
        };
      });
      current.label = `${tempFw.emoji} ${tempFw.label} · ${current.layers.map(l => l.surface?.label || '').join('+')}`;
      current.color = current.layers[0]?.surface?.color || '#D4870A';
      S.selectedEvId = current.id;

      modalOverlay.classList.add('hidden');
      if (typeof drawWaveform === 'function') drawWaveform();
      if (typeof positionTooltip === 'function') positionTooltip();
      if (typeof rebuildLog === 'function') rebuildLog();
    });
    modalContent.appendChild(apply);
    modalOverlay.classList.remove('hidden');
  };
})();
