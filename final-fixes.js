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

  document.getElementById('mode-control')?.remove();

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

    // Time-code labels: keep the grid dense, but only label ticks that have
    // enough horizontal space. This prevents overlap at high zoom levels.
    ctx.fillStyle = '#66666C';
    ctx.font = '9px IBM Plex Mono,monospace';
    ctx.textAlign = 'center';
    const step = vis / gridN;
    const tickPx = W / gridN;
    const labelEvery = Math.max(1, Math.ceil(52 / Math.max(1, tickPx)));
    for (let i = 0; i <= gridN; i++) {
      if (i !== gridN && i % labelEvery !== 0) continue;
      const t = S.scrollOffset + i * step;
      if (t > (S.videoDuration || 0) + 0.02) break;
      const x = Math.max(24, Math.min(W - 24, i / gridN * W));
      ctx.fillText(fmt(t), x, H - 4);
    }
    ctx.textAlign = 'left';

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

  drawWaveform = drawTimeline;
  drawTimeline();

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

  function nearestEvent(x) {
    let hit = null;
    let best = 14;
    S.events.forEach(ev => {
      const d = Math.abs(xAtTime(ev.time) - x);
      if (d <= best) { best = d; hit = ev; }
    });
    return hit;
  }

  function rememberBeforeChange() {}

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
      gesture = { type:'event', evId:hit.id, startX:x, startY:canvasY(e), lastX:x, lastY:canvasY(e), startTime:hit.time, startGain:hit.gain ?? 1, mode:null, moved:false };
      drawTimeline();
      positionTooltip();
      return;
    }
    selectedIds.clear();
    gesture = { type:'select', startX:x, currentX:x, pointerId:e.pointerId, moved:false };
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
      ev.time = Math.max(0, Math.min(S.videoDuration || 999, gesture.startTime + (dx / Math.max(1, canvas.offsetWidth)) * visDur()));
      S.events.sort((a, b) => a.time - b.time);
      updateLogRow(ev);
    } else {
      ev.gain = Math.max(0, Math.min(2, gesture.startGain - (dy / Math.max(1, canvas.offsetHeight / 2)) * 2));
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
      if (!g.moved) { drawTimeline(); return; }
      const a = Math.min(g.startX, g.currentX);
      const b = Math.max(g.startX, g.currentX);
      const t1 = timeAtX(a);
      const t2 = timeAtX(b);
      selectedIds.clear();
      S.events.forEach(ev => { if (ev.time >= t1 && ev.time <= t2) selectedIds.add(ev.id); });
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
      selectedIds.clear();
      S.selectedEvId = g.evId;
      positionTooltip();
      updateMultiBar();
      drawTimeline();
    }
  }, true);

  canvas.addEventListener('pointercancel', () => {
    gesture = null;
    drawTimeline();
    updateMultiBar();
  }, true);

  canvas.addEventListener('click', e => {
    if (suppressNextClick) {
      suppressNextClick = false;
      e.preventDefault(); e.stopImmediatePropagation();
    }
  }, true);

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
    const before = S.events.length;
    S.events = S.events.filter(ev => !selectedIds.has(ev.id));
    if (S.events.length !== before) {
      if (selectedIds.has(S.selectedEvId)) S.selectedEvId = null;
      selectedIds.clear();
      if (typeof updateEventCount === 'function') updateEventCount();
      if (typeof rebuildLog === 'function') rebuildLog();
      if (typeof saveState === 'function') saveState();
      drawTimeline();
      updateScrollbar();
      updateMultiBar();
    }
  }

  multiDelete.addEventListener('click', e => {
    e.preventDefault(); e.stopImmediatePropagation();
    deleteSelectedEvents();
  }, true);

  updateMultiBar();
})();
