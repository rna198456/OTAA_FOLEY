/* final-fixes.js — OTAA_FOLEY
 * Consolidated timeline / playback interaction layer.
 *
 * - No ENSAYO / GRABACIÓN selector.
 * - REPRODUCCIÓN is the only play/pause transport.
 * - Space only fires the selected Foley combination while recording.
 * - Event drag: horizontal = time, vertical = gain.
 * - Empty-area drag = multi-select; selected events are highlighted and can be deleted.
 * - Event editing uses pointer events so mouse and touch share one interaction model.
 * - Event combination editor preserves event id, time and global gain.
 * - WAV export: 48 kHz / 24-bit stereo, sequential filename.
 */
'use strict';

(() => {
  if (typeof S === 'undefined') return;

  const video = document.getElementById('video-el');
  const canvas = document.getElementById('waveform');
  const outer = document.getElementById('waveform-outer');
  const timelinePanel = document.getElementById('timeline-panel');
  const playbackBtn = document.getElementById('btn-preview');
  const exportBtn = document.getElementById('btn-export');
  const zoomIn = document.getElementById('btn-zoom-in');
  const zoomOut = document.getElementById('btn-zoom-out');
  const zoomFit = document.getElementById('btn-zoom-fit');
  const zoomLabel = document.getElementById('zoom-label');
  const tooltip = document.getElementById('event-tooltip');
  const tooltipChange = document.getElementById('tooltip-change');

  if (!video || !canvas || !outer || !timelinePanel || !playbackBtn) return;

  // Remove the obsolete mode UI if an older enhancement layer still creates it.
  document.getElementById('mode-control')?.remove();

  // ────────────────────────────────────────────────────────────────────────
  // Timeline renderer
  // ────────────────────────────────────────────────────────────────────────
  const CANVAS_H = 120;
  const MAX_ZOOM = 128;
  const ZSTEP = Math.sqrt(2);
  const selectedIds = new Set();
  let gesture = null;
  let suppressNextClick = false;

  const visDur = () => (S.videoDuration || 10) / S.zoom;
  const clampScroll = () => {
    const max = Math.max(0, (S.videoDuration || 0) - visDur());
    S.scrollOffset = Math.max(0, Math.min(S.scrollOffset, max));
  };

  const canvasX = e => e.clientX - canvas.getBoundingClientRect().left;
  const canvasY = e => e.clientY - canvas.getBoundingClientRect().top;
  const timeAtX = x => S.scrollOffset + (x / Math.max(1, canvas.offsetWidth)) * visDur();
  const xAtTime = t => ((t - S.scrollOffset) / Math.max(0.000001, visDur())) * canvas.offsetWidth;

  function updateZoomUI() {
    const z = S.zoom;
    zoomLabel.textContent = z >= 100 ? Math.round(z) + '×' : (Math.round(z * 10) / 10) + '×';
    zoomOut.disabled = z <= 1;
    zoomIn.disabled = z >= MAX_ZOOM;
  }

  function drawTimeline() {
    const W = outer.clientWidth || 400;
    canvas.width = Math.max(1, Math.round(W));
    canvas.height = CANVAS_H;
    canvas.style.height = CANVAS_H + 'px';

    const ctx = canvas.getContext('2d');
    const H = CANVAS_H;
    const MID = H / 2;
    const MAXAMP = MID * 0.78;
    const vis = visDur();

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0D0D0F';
    ctx.fillRect(0, 0, W, H);

    const gridN = Math.max(4, Math.min(30, Math.round(S.zoom * 5)));
    ctx.strokeStyle = '#1E1E22';
    ctx.lineWidth = 1;
    for (let i = 1; i < gridN; i++) {
      const x = i / gridN * W;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(0, MID); ctx.lineTo(W, MID); ctx.stroke();

    ctx.fillStyle = '#3A3A3E';
    ctx.font = '9px IBM Plex Mono,monospace';
    ctx.textAlign = 'left';
    const step = vis / gridN;
    for (let i = 0; i <= gridN; i++) {
      const t = S.scrollOffset + i * step;
      if (t > (S.videoDuration || 0) + 0.02) break;
      ctx.fillText(fmt(t), i / gridN * W + 3, H - 4);
    }

    S.events.forEach(ev => {
      const x = xAtTime(ev.time);
      if (x < -15 || x > W + 15) return;

      const gain = Math.max(0, Math.min(2, ev.gain ?? 1));
      const amp = Math.max(6, MAXAMP * gain / 2);
      const active = ev.id === S.selectedEvId || selectedIds.has(ev.id);
      const col = ev.color || '#D4870A';

      ctx.globalAlpha = active ? 1 : 0.82;
      ctx.strokeStyle = col;
      ctx.lineWidth = active ? 4 : 2;
      ctx.beginPath(); ctx.moveTo(x, MID); ctx.lineTo(x, MID - amp); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, MID); ctx.lineTo(x, MID + amp); ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(x, MID - amp, active ? 6 : 3.5, 0, Math.PI * 2); ctx.fill();

      if (active) {
        ctx.strokeStyle = '#E8E4DC';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, MID - amp, 10, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#E8E4DC';
        ctx.font = 'bold 9px IBM Plex Mono,monospace';
        ctx.textAlign = 'center';
        ctx.fillText(Math.round(gain * 100) + '%', x, MID - amp - 14);
        ctx.textAlign = 'left';
      }
      ctx.globalAlpha = 1;
    });

    if (S.videoDuration > 0) {
      const px = xAtTime(video.currentTime);
      if (px >= 0 && px <= W) {
        ctx.strokeStyle = S.isRecording ? '#E8403A' : (S.isPreviewing ? '#3A9E6A' : '#7A7A7A');
        ctx.lineWidth = S.isRecording ? 2 : 1.5;
        ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
        if (S.isRecording) {
          ctx.fillStyle = '#E8403A'; ctx.globalAlpha = 1;
          ctx.beginPath(); ctx.arc(px, 9, 5, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    }

    if (gesture?.type === 'select') {
      const a = Math.max(0, Math.min(W, gesture.startX));
      const b = Math.max(0, Math.min(W, gesture.currentX));
      const left = Math.min(a, b);
      const width = Math.abs(b - a);
      ctx.fillStyle = 'rgba(212,135,10,.13)';
      ctx.fillRect(left, 0, width, H);
      ctx.strokeStyle = 'rgba(212,135,10,.75)';
      ctx.lineWidth = 1;
      ctx.strokeRect(left + .5, .5, Math.max(1, width - 1), H - 1);
    }
  }

  // Replace all later redraw requests with the consolidated renderer.
  drawWaveform = drawTimeline;
  drawTimeline();

  // ────────────────────────────────────────────────────────────────────────
  // Zoom
  // ────────────────────────────────────────────────────────────────────────
  function zoomAround(anchorTime, ratio, nextZoom) {
    const z = Math.max(1, Math.min(MAX_ZOOM, nextZoom));
    const r = Math.max(0, Math.min(1, ratio));
    S.zoom = z;
    S.scrollOffset = anchorTime - r * visDur();
    clampScroll();
    updateZoomUI();
    drawTimeline();
    updateScrollbar();
  }

  setZoom = nextZoom => {
    const selected = S.events.find(ev => ev.id === S.selectedEvId);
    const focus = selected ? selected.time : video.currentTime;
    const visible = visDur();
    const ratio = visible > 0 ? (focus - S.scrollOffset) / visible : 0.5;
    zoomAround(focus, ratio, nextZoom);
  };

  zoomIn.addEventListener('click', e => {
    e.preventDefault(); e.stopImmediatePropagation();
    setZoom(S.zoom * ZSTEP);
  }, true);
  zoomOut.addEventListener('click', e => {
    e.preventDefault(); e.stopImmediatePropagation();
    setZoom(S.zoom / ZSTEP);
  }, true);
  zoomFit.addEventListener('click', e => {
    e.preventDefault(); e.stopImmediatePropagation();
    S.zoom = 1; S.scrollOffset = 0;
    updateZoomUI(); drawTimeline(); updateScrollbar();
  }, true);

  outer.addEventListener('wheel', e => {
    e.preventDefault(); e.stopImmediatePropagation();
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const ratio = x / Math.max(1, canvas.offsetWidth);
    const anchor = timeAtX(x);
    zoomAround(anchor, ratio, S.zoom * (e.deltaY < 0 ? ZSTEP : 1 / ZSTEP));
  }, { capture: true, passive: false });

  // ────────────────────────────────────────────────────────────────────────
  // Event hit-testing and editing
  // ────────────────────────────────────────────────────────────────────────
  function nearestEvent(x) {
    let hit = null;
    let best = 14;
    S.events.forEach(ev => {
      const d = Math.abs(xAtTime(ev.time) - x);
      if (d <= best) { best = d; hit = ev; }
    });
    return hit;
  }

  function rememberBeforeChange() {
    // enhancements.js owns the actual history stacks. Its wrapped delete/fire
    // functions are used where possible; timeline edits are still restored by
    // the existing undo system when it captured the gesture.
  }

  canvas.addEventListener('pointerdown', e => {
    if (S.isRecording || S.isPreviewing || e.button !== 0) return;

    const x = canvasX(e);
    const hit = nearestEvent(x);

    e.preventDefault();
    e.stopImmediatePropagation();
    canvas.setPointerCapture?.(e.pointerId);

    if (hit) {
      selectedIds.clear();
      S.selectedEvId = hit.id;
      gesture = {
        type: 'event',
        evId: hit.id,
        startX: x,
        startY: canvasY(e),
        lastX: x,
        lastY: canvasY(e),
        startTime: hit.time,
        startGain: hit.gain ?? 1,
        mode: null,
        moved: false,
      };
      drawTimeline();
      positionTooltip();
      return;
    }

    selectedIds.clear();
    gesture = {
      type: 'select',
      startX: x,
      currentX: x,
      pointerId: e.pointerId,
      moved: false,
    };
    drawTimeline();
  }, true);

  canvas.addEventListener('pointermove', e => {
    if (!gesture || S.isRecording || S.isPreviewing) return;
    if (gesture.pointerId != null && gesture.pointerId !== e.pointerId) return;

    const x = canvasX(e);
    const y = canvasY(e);
    const dx = x - gesture.startX;
    const dy = y - gesture.startY;

    if (gesture.type === 'select') {
      if (Math.abs(dx) < 6) return;
      gesture.currentX = x;
      gesture.moved = true;
      e.preventDefault(); e.stopImmediatePropagation();
      drawTimeline();
      return;
    }

    if (!gesture.moved && Math.hypot(dx, dy) < 5) return;
    gesture.moved = true;
    if (!gesture.mode) gesture.mode = Math.abs(dx) >= Math.abs(dy) ? 'time' : 'gain';

    const ev = S.events.find(item => item.id === gesture.evId);
    if (!ev) return;

    e.preventDefault(); e.stopImmediatePropagation();

    if (gesture.mode === 'time') {
      ev.time = Math.max(0, Math.min(S.videoDuration || 999,
        gesture.startTime + (dx / Math.max(1, canvas.offsetWidth)) * visDur()));
      S.events.sort((a, b) => a.time - b.time);
      updateLogRow(ev);
    } else {
      ev.gain = Math.max(0, Math.min(2,
        gesture.startGain - (dy / Math.max(1, canvas.offsetHeight / 2)) * 2));
      syncTooltipVol(ev);
      updateLogRow(ev);
    }
    drawTimeline();
    positionTooltip();
  }, true);

  canvas.addEventListener('pointerup', e => {
    if (!gesture) return;
    if (gesture.pointerId != null && gesture.pointerId !== e.pointerId) return;

    const g = gesture;
    gesture = null;
    e.preventDefault(); e.stopImmediatePropagation();

    if (g.type === 'select') {
      if (!g.moved) {
        drawTimeline();
        return;
      }
      const a = Math.min(g.startX, g.currentX);
      const b = Math.max(g.startX, g.currentX);
      const t1 = timeAtX(a);
      const t2 = timeAtX(b);
      selectedIds.clear();
      S.events.forEach(ev => {
        if (ev.time >= t1 && ev.time <= t2) selectedIds.add(ev.id);
      });
      S.selectedEvId = selectedIds.size === 1 ? [...selectedIds][0] : null;
      if (typeof hideTooltip === 'function') hideTooltip();
      suppressNextClick = true;
      updateMultiBar();
      drawTimeline();
      return;
    }

    if (g.moved) {
      suppressNextClick = true;
      S.selectedEvId = g.evId;
      positionTooltip();
      drawTimeline();
    } else {
      // A plain click selects the event and opens the menu, with no movement.
      selectedIds.clear();
      S.selectedEvId = g.evId;
      positionTooltip();
      updateMultiBar();
      drawTimeline();
    }
  }, true);

  canvas.addEventListener('pointercancel', e => {
    gesture = null;
    drawTimeline();
    updateMultiBar();
  }, true);

  // Suppress the old app.js mouse/touch click path after pointer gestures.
  canvas.addEventListener('click', e => {
    if (suppressNextClick) {
      suppressNextClick = false;
      e.preventDefault(); e.stopImmediatePropagation();
    }
  }, true);

  // ────────────────────────────────────────────────────────────────────────
  // Multi-selection toolbar + keyboard deletion
  // ────────────────────────────────────────────────────────────────────────
  const multiBar = document.createElement('div');
  multiBar.id = 'multi-selection-bar';
  multiBar.innerHTML = '<span id="multi-selection-label"></span><button id="multi-selection-delete" type="button">BORRAR SELECCIÓN</button>';
  timelinePanel.insertBefore(multiBar, document.getElementById('progress-wrap'));

  const multiLabel = document.getElementById('multi-selection-label');
  const multiDelete = document.getElementById('multi-selection-delete');

  function updateMultiBar() {
    const n = selectedIds.size;
    multiBar.classList.toggle('hidden', n === 0);
    multiLabel.textContent = n === 0 ? '' : `${n} INSTRUCCIÓN${n === 1 ? '' : 'ES'} SELECCIONADA${n === 1 ? '' : 'S'}`;
  }

  function deleteSelectedEvents() {
    if (!selectedIds.size || S.isRecording || S.isPreviewing) return;

    const ids = [...selectedIds];
    const first = ids.shift();

    // Route one deletion through the existing wrapped deleteEvent so the whole
    // pre-delete state remains available to Undo; remove the rest as one batch.
    if (typeof deleteEvent === 'function') {
      deleteEvent(first);
    } else {
      S.events = S.events.filter(ev => ev.id !== first);
    }

    const rest = new Set(ids);
    S.events = S.events.filter(ev => !rest.has(ev.id));
    selectedIds.clear();
    S.selectedEvId = null;
    if (typeof hideTooltip === 'function') hideTooltip();
    updateEventCount();
    rebuildLog();
    drawTimeline();
    updateMultiBar();
    playbackBtn.disabled = false;
    if (exportBtn) exportBtn.disabled = S.events.length === 0;
  }

  multiDelete.addEventListener('click', e => {
    e.preventDefault(); e.stopImmediatePropagation();
    deleteSelectedEvents();
  }, true);

  document.addEventListener('keydown', e => {
    if ((e.code !== 'Delete' && e.code !== 'Backspace') || e.defaultPrevented) return;
    const t = e.target;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (!selectedIds.size || S.isRecording || S.isPreviewing) return;
    e.preventDefault(); e.stopImmediatePropagation();
    deleteSelectedEvents();
  }, true);

  // ────────────────────────────────────────────────────────────────────────
  // Playback: one transport, always from the current playhead
  // ────────────────────────────────────────────────────────────────────────
  let playbackBusy = false;

  startPreview = async function () {
    if (!S.videoLoaded || playbackBusy) return;
    playbackBusy = true;
    S.isPreviewing = true;
    S.previewTimers.forEach(clearTimeout);
    S.previewTimers = [];

    const startAt = video.currentTime;
    S.startTimecode = startAt;
    const ctx = AudioEngine.getCtx();

    S.events.filter(ev => ev.time >= startAt).forEach(ev => {
      const delay = Math.max(0, (ev.time - startAt) * 1000);
      S.previewTimers.push(setTimeout(() => {
        if (!S.isPreviewing) return;
        const eventGain = ev.gain ?? 1;
        const layers = (ev.layers || []).map(layer => ({
          ...layer,
          gainMult: (layer.gainMult ?? 1) * eventGain,
        }));
        AudioEngine.scheduleLayers(layers, ctx.currentTime + 0.02);
      }, delay));
    });

    try {
      await video.play();
      playbackBtn.textContent = '❚❚ PAUSAR';
      document.getElementById('play-indicator')?.classList.remove('hidden');
      startRaf();
    } catch (err) {
      S.isPreviewing = false;
      S.previewTimers.forEach(clearTimeout);
      S.previewTimers = [];
    } finally {
      playbackBusy = false;
    }
  };

  stopPreview = function () {
    S.isPreviewing = false;
    S.previewTimers.forEach(clearTimeout);
    S.previewTimers = [];
    video.pause();
    playbackBtn.textContent = '▶ REPRODUCCIÓN';
    document.getElementById('play-indicator')?.classList.add('hidden');
  };

  playbackBtn.addEventListener('click', async e => {
    e.preventDefault(); e.stopImmediatePropagation();
    if (!S.videoLoaded || S.isRecording) return;
    if (S.isPreviewing || !video.paused) stopPreview();
    else await startPreview();
  }, true);

  video.addEventListener('ended', () => {
    if (S.isPreviewing) stopPreview();
    playbackBtn.textContent = '▶ REPRODUCCIÓN';
  });
  video.addEventListener('pause', () => {
    if (!S.isPreviewing) playbackBtn.textContent = '▶ REPRODUCCIÓN';
  });
  video.addEventListener('play', () => {
    if (!S.isRecording) playbackBtn.textContent = '❚❚ PAUSAR';
  });

  // Space is ONLY the recording trigger.
  document.addEventListener('keydown', e => {
    if (e.code !== 'Space' || e.repeat) return;
    const t = e.target;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (!S.isRecording) return;
    const trigger = document.getElementById('btn-trigger');
    if (!trigger || trigger.disabled) return;
    e.preventDefault(); e.stopImmediatePropagation();
    fireTrigger();
  }, true);

  // ────────────────────────────────────────────────────────────────────────
  // Combination editor: preserve event identity, timing, gain and existing
  // sample index whenever a currently-used surface remains selected.
  // ────────────────────────────────────────────────────────────────────────
  const modalOverlay = document.getElementById('modal-overlay');
  const modalContent = document.getElementById('modal-content');
  if (modalOverlay && modalContent) {
    openChangeModal = function (evId) {
      const target = S.events.find(ev => ev.id === evId);
      if (!target) return;

      modalContent.innerHTML = '';
      const info = document.createElement('p');
      info.style.cssText = 'font-size:11px;color:var(--sub);margin-bottom:10px;font-family:var(--mono)';
      info.textContent = 'Seleccioná nuevo calzado y superficies:';
      modalContent.appendChild(info);

      let tempFw = (S.lib.footwear || []).find(f => f.id === target.layers?.[0]?.fwId) || S.lib.footwear?.[0];

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
        if (layer.surface?.id) tempSurfs[layer.surface.id] = {
          gainMult: layer.gainMult ?? 1,
          rrIdx: layer.rrIdx ?? 0,
        };
      });

      const surfWrap = document.createElement('div');
      (S.lib.surfaces || []).forEach(surf => {
        const row = document.createElement('div');
        row.className = 'surface-row';

        const cb = document.createElement('button');
        cb.className = 'surf-check' + (tempSurfs[surf.id] ? ' selected' : '');
        cb.style.borderColor = tempSurfs[surf.id] ? (surf.color || '') : '';
        cb.innerHTML = `<span class="surf-emoji">${surf.emoji}</span><span class="surf-name">${surf.label}</span>`;

        const fader = document.createElement('div');
        const initial = tempSurfs[surf.id]?.gainMult ?? 1;
        fader.className = 'surf-fader-wrap' + (tempSurfs[surf.id] ? '' : ' hidden');
        fader.innerHTML = `<input type="range" class="surf-fader" min="0" max="200" step="1" value="${Math.round(initial * 100)}"/><span class="surf-fader-val">${Math.round(initial * 100)}%</span>`;
        fader.querySelector('input').addEventListener('input', ev => {
          if (!tempSurfs[surf.id]) tempSurfs[surf.id] = { gainMult: 1, rrIdx: 0 };
          tempSurfs[surf.id].gainMult = Number(ev.target.value) / 100;
          fader.querySelector('.surf-fader-val').textContent = ev.target.value + '%';
        });

        cb.addEventListener('click', () => {
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
        drawTimeline();
        positionTooltip();
        rebuildLog();
        updateMultiBar();
      });
      modalContent.appendChild(apply);
      modalOverlay.classList.remove('hidden');
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // 48 kHz / 24-bit WAV, sequential filename
  // ────────────────────────────────────────────────────────────────────────
  function wav24FromWav16(blob16) {
    return blob16.arrayBuffer().then(ab => {
      const src = new DataView(ab);
      const nCh = src.getUint16(22, true);
      const sr = src.getUint32(24, true);
      const bits = src.getUint16(34, true);
      if (nCh !== 2 || sr !== 48000 || bits !== 16) throw new Error('Formato base inesperado');

      const dataBytes = src.getUint32(40, true);
      const frames = dataBytes / (nCh * 2);
      const outDataBytes = frames * nCh * 3;
      const out = new ArrayBuffer(44 + outDataBytes);
      const v = new DataView(out);
      const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };

      ws(0, 'RIFF'); v.setUint32(4, 36 + outDataBytes, true);
      ws(8, 'WAVE'); ws(12, 'fmt '); v.setUint32(16, 16, true);
      v.setUint16(20, 1, true); v.setUint16(22, nCh, true);
      v.setUint32(24, sr, true); v.setUint32(28, sr * nCh * 3, true);
      v.setUint16(32, nCh * 3, true); v.setUint16(34, 24, true);
      ws(36, 'data'); v.setUint32(40, outDataBytes, true);

      let so = 44;
      let d = 44;
      for (let i = 0; i < frames * nCh; i++) {
        const s16 = src.getInt16(so, true); so += 2;
        const q = Math.max(-1, Math.min(1, s16 / 32768));
        let q24 = Math.round(q * 8388607);
        if (q24 < 0) q24 += 16777216;
        v.setUint8(d, q24 & 255);
        v.setUint8(d + 1, (q24 >> 8) & 255);
        v.setUint8(d + 2, (q24 >> 16) & 255);
        d += 3;
      }
      return new Blob([out], { type: 'audio/wav' });
    });
  }

  if (exportBtn) {
    exportBtn.addEventListener('click', async e => {
      e.preventDefault(); e.stopImmediatePropagation();
      if (!S.events.length) return;
      exportBtn.disabled = true;
      const status = document.getElementById('export-status');
      if (status) status.textContent = 'Renderizando 48 kHz / 24-bit…';
      try {
        const blob16 = await AudioEngine.renderToWav(S.events, S.videoDuration, 48000);
        const blob24 = await wav24FromWav16(blob16);
        const key = 'otaa_foley_export_number';
        const num = Number(localStorage.getItem(key) || 0) + 1;
        localStorage.setItem(key, String(num));

        const url = URL.createObjectURL(blob24);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Foley Recorder OTAA ${num}.wav`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        if (status) {
          status.textContent = `✓ Foley Recorder OTAA ${num}.wav`;
          setTimeout(() => { status.textContent = ''; }, 3500);
        }
      } catch (err) {
        if (status) {
          status.textContent = 'Error: ' + err.message;
          setTimeout(() => { status.textContent = ''; }, 4000);
        }
      } finally {
        exportBtn.disabled = false;
      }
    }, true);
  }

  video.addEventListener('loadedmetadata', () => {
    S.zoom = 1;
    S.scrollOffset = 0;
    selectedIds.clear();
    S.selectedEvId = null;
    updateZoomUI();
    updateMultiBar();
    drawTimeline();
    updateScrollbar();
    playbackBtn.disabled = false;
  });

  window.addEventListener('resize', () => {
    drawTimeline();
    updateScrollbar();
    positionTooltip();
  });

  setInterval(() => {
    drawTimeline();
    updateMultiBar();
  }, 180);

  updateZoomUI();
  updateMultiBar();
})();
