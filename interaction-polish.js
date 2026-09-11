/* interaction-polish.js — OTAA_FOLEY
 * Final compatibility / interaction layer.
 *
 * - Stops legacy mouse/touch canvas handlers from competing with the
 *   consolidated pointer-event timeline interaction.
 * - Extends the event combination menu so each active surface can choose
 *   the exact recorded sample/step (rrIdx).
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

  // ── Legacy canvas compatibility ────────────────────────────────────────
  // final-fixes.js owns the timeline through Pointer Events. These handlers
  // stop the old app.js mouse/touch path from running in parallel.
  ['mousedown', 'mousemove', 'mouseup', 'mouseleave', 'touchstart', 'touchmove', 'touchend'].forEach(type => {
    canvas.addEventListener(type, event => {
      if (S.isRecording) return;
      event.stopImmediatePropagation();
    }, true);
  });

  // ── Video / playback availability ──────────────────────────────────────
  // app.js intentionally resets REPRODUCCIÓN to disabled when metadata arrives.
  // In the new workflow the button is also the normal video transport, so it
  // must be available immediately after a valid video has been loaded.
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

  // ── Reliable seek on an empty timeline tap ──────────────────────────────
  // Pointer Events on the canvas call preventDefault(), so relying on the
  // synthetic browser "click" is not reliable on every mouse/touch browser.
  // Capture the gesture before final-fixes.js receives it, then seek only when
  // it was a plain tap in free space. Event drags and multi-select drags are
  // left entirely to final-fixes.js.
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

    // Do not seek when the tap is on a recorded instruction; that gesture is
    // reserved for selecting/opening/editing that event.
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

  // ── Event popup close ───────────────────────────────────────────────────
  // The existing ✕ used to delete the selected event. It is now the explicit
  // close control requested for the popup. Deletion remains available through
  // Delete/Backspace and the multi-selection delete action.
  if (tooltipDelete) {
    tooltipDelete.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (typeof hideTooltip === 'function') hideTooltip();
    }, true);
    tooltipDelete.title = 'Cerrar';
    tooltipDelete.setAttribute('aria-label', 'Cerrar');
  }

  // ── Combination + sample editor ────────────────────────────────────────
  openChangeModal = function (evId) {
    const target = S.events.find(ev => ev.id === evId);
    if (!target) return;

    modalContent.innerHTML = '';

    const info = document.createElement('p');
    info.style.cssText = 'font-size:11px;color:var(--sub);margin-bottom:10px;font-family:var(--mono)';
    info.textContent = 'Cambiá calzado, superficies y el paso/sample de cada capa:';
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
      b.addEventListener('click', () => {
        tempFw = fw;
        fwRow.querySelectorAll('.fw-btn').forEach(x => x.classList.toggle('selected', x === b));
      });
      fwRow.appendChild(b);
    });
    modalContent.appendChild(fwRow);

    const tempSurfs = {};
    (target.layers || []).forEach(layer => {
      if (layer.surface?.id) {
        tempSurfs[layer.surface.id] = {
          gainMult: layer.gainMult ?? 1,
          rrIdx: layer.rrIdx ?? 0,
        };
      }
    });

    const surfWrap = document.createElement('div');

    function renderSampleSelect(container, surf, data) {
      const samples = Array.isArray(surf.samples) ? surf.samples : [];
      if (!samples.length) return null;

      const sampleRow = document.createElement('div');
      sampleRow.className = 'sample-select-row';
      const label = document.createElement('span');
      label.className = 'sample-select-label';
      label.textContent = 'PASO';

      const select = document.createElement('select');
      select.className = 'sample-select';
      samples.forEach((sample, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = sample.label || `Paso ${index + 1}`;
        option.selected = index === Number(data.rrIdx ?? 0);
        select.appendChild(option);
      });
      select.addEventListener('change', () => {
        data.rrIdx = Number(select.value);
      });

      sampleRow.appendChild(label);
      sampleRow.appendChild(select);
      container.appendChild(sampleRow);
      return sampleRow;
    }

    function addSurfaceRow(surf) {
      const row = document.createElement('div');
      row.className = 'surface-row';

      const cb = document.createElement('button');
      cb.className = 'surf-check' + (tempSurfs[surf.id] ? ' selected' : '');
      cb.style.borderColor = tempSurfs[surf.id] ? (surf.color || '') : '';
      cb.innerHTML = `<span class="surf-emoji">${surf.emoji}</span><span class="surf-name">${surf.label}</span>`;

      const data = tempSurfs[surf.id] || { gainMult: 1, rrIdx: 0 };
      const fader = document.createElement('div');
      fader.className = 'surf-fader-wrap' + (tempSurfs[surf.id] ? '' : ' hidden');
      fader.innerHTML = `<input type="range" class="surf-fader" min="0" max="200" step="1" value="${Math.round((data.gainMult ?? 1) * 100)}"/><span class="surf-fader-val">${Math.round((data.gainMult ?? 1) * 100)}%</span>`;
      fader.querySelector('input').addEventListener('input', event => {
        if (!tempSurfs[surf.id]) tempSurfs[surf.id] = { gainMult: 1, rrIdx: 0 };
        tempSurfs[surf.id].gainMult = Number(event.target.value) / 100;
        fader.querySelector('.surf-fader-val').textContent = event.target.value + '%';
      });

      let sampleRow = null;
      if (tempSurfs[surf.id]) {
        sampleRow = renderSampleSelect(row, surf, tempSurfs[surf.id]);
      }

      cb.addEventListener('click', () => {
        if (tempSurfs[surf.id]) {
          delete tempSurfs[surf.id];
          cb.classList.remove('selected');
          cb.style.borderColor = '';
          fader.classList.add('hidden');
          sampleRow?.remove();
          sampleRow = null;
        } else {
          tempSurfs[surf.id] = { gainMult: 1, rrIdx: 0 };
          cb.classList.add('selected');
          cb.style.borderColor = surf.color || '';
          fader.classList.remove('hidden');
          sampleRow = renderSampleSelect(row, surf, tempSurfs[surf.id]);
        }
      });

      row.appendChild(cb);
      row.appendChild(fader);
      surfWrap.appendChild(row);
    }

    (S.lib.surfaces || []).forEach(addSurfaceRow);
    modalContent.appendChild(surfWrap);

    const apply = document.createElement('button');
    apply.className = 'btn btn-amber btn-sm';
    apply.style.cssText = 'width:100%;margin-top:10px';
    apply.textContent = 'Aplicar';
    apply.addEventListener('click', () => {
      const current = S.events.find(ev => ev.id === target.id);
      if (!current || !Object.keys(tempSurfs).length) return;

      current.layers = Object.entries(tempSurfs).map(([sid, data]) => ({
        fwId: tempFw.id,
        surface: (S.lib.surfaces || []).find(s => s.id === sid),
        gainMult: data.gainMult,
        rrIdx: data.rrIdx ?? 0,
      }));
      current.label = `${tempFw.emoji} ${tempFw.label} · ${current.layers.map(l => l.surface?.label || '').join('+')}`;
      current.color = current.layers[0]?.surface?.color || '#D4870A';
      S.selectedEvId = current.id;

      closeModal();
      if (typeof drawWaveform === 'function') drawWaveform();
      if (typeof positionTooltip === 'function') positionTooltip();
      if (typeof rebuildLog === 'function') rebuildLog();
    });
    modalContent.appendChild(apply);
    modalOverlay.classList.remove('hidden');
  };
})();
