/**
 * app.js — Foley Recorder v3
 *
 * Nuevas features vs v2:
 *  - Timeline zoom: rueda del mouse, pinch (mobile), botones +/−/FIT
 *  - Scroll horizontal de timeline cuando hay zoom
 *  - Volumen por evento: drag vertical en impulso + slider en tooltip
 *  - Visualización de amplitude (altura del impulso proporcional al gain)
 *  - Fix mobile: library-col con overflow-y correcto
 *  - Render a 48 kHz
 */
'use strict';

// ── State ─────────────────────────────────────────────────────────────────
const S = {
  library:        [],
  userCats:       [],
  selectedCat:    null,
  // events: { id, catId, label, color, sampleFiles, rrIdx,
  //           isUser, userId, time, gain }
  events:         [],
  videoLoaded:    false,
  videoDuration:  0,
  isRecording:    false,
  isPreviewing:   false,
  selectedEvId:   null,

  // Timeline zoom & scroll
  zoom:           1,       // 1× – 32×
  scrollOffset:   0,       // seconds from left edge

  // Drag state
  drag: null,
  // { evId, mode:'move'|'gain', startX, startY, startTime, startGain, moved }

  // Pinch state
  pinch: null,
  // { dist, zoom, scroll }

  previewTimers: [],
};

const ZOOM_MIN = 1, ZOOM_MAX = 32, ZOOM_STEP = 1.6;
let evIdSeq = 0;
const newEvId = () => 'ev_' + (++evIdSeq);

// ── DOM ───────────────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const video         = $('video-el');
const dropHint      = $('drop-hint');
const videoZone     = $('video-zone');
const wfCanvas      = $('waveform');
const wfCtx         = wfCanvas.getContext('2d');
const wfOuter       = $('waveform-outer');
const progressFill  = $('progress-fill');
const progressWrap  = $('progress-wrap');
const timecodeEl    = $('timecode');
const recIndicator  = $('rec-indicator');
const playIndicator = $('play-indicator');
const btnRecord     = $('btn-record');
const btnStop       = $('btn-stop');
const btnPreview    = $('btn-preview');
const btnExport     = $('btn-export');
const exportStatus  = $('export-status');
const eventCount    = $('event-count');
const hintBar       = $('hint-bar');
const hintName      = $('hint-name');
const hintRr        = $('hint-rr');
const libraryGrid   = $('library-grid');
const libraryLoading= $('library-loading');
const sessionLog    = $('session-log');
const tooltip       = $('event-tooltip');
const tooltipName   = $('tooltip-name');
const tooltipChange = $('tooltip-change');
const tooltipDelete = $('tooltip-delete');
const tooltipVol    = $('tooltip-vol');
const tooltipVolLbl = $('tooltip-vol-label');
const modalOverlay  = $('modal-overlay');
const modalGrid     = $('modal-grid');
const modalCancel   = $('modal-cancel');
const btnZoomIn     = $('btn-zoom-in');
const btnZoomOut    = $('btn-zoom-out');
const btnZoomFit    = $('btn-zoom-fit');
const zoomLabel     = $('zoom-label');
const scrollThumb   = $('tl-scrollbar-thumb');
const scrollWrap    = $('tl-scrollbar-wrap');

// ── Utils ─────────────────────────────────────────────────────────────────
const fmtTime = t => {
  const m = Math.floor(t / 60).toString().padStart(2, '0');
  const s = (t % 60).toFixed(2).padStart(5, '0');
  return `${m}:${s}`;
};

const CSS_COLORS = {
  '#8B5E3C':'#8B5E3C', '#A0724A':'#A0724A',
  '#6B6B6B':'#6B6B6B', '#9B8B6A':'#9B8B6A',
  '#5A8A9F':'#5A8A9F', '#9B6FD4':'#9B6FD4',
};
const resolveColor = c => c || '#D4870A';

// ── Zoom helpers ──────────────────────────────────────────────────────────

/** Visible duration in seconds given current zoom */
function visibleDur() {
  return (S.videoDuration || 10) / S.zoom;
}

/** Clamp scrollOffset so we never scroll past the end */
function clampScroll() {
  const maxOff = Math.max(0, (S.videoDuration || 0) - visibleDur());
  S.scrollOffset = Math.max(0, Math.min(S.scrollOffset, maxOff));
}

/** Convert canvas pixel X → video time (accounting for zoom & scroll) */
function xToTime(x) {
  const W = wfCanvas.offsetWidth || 1;
  return S.scrollOffset + (x / W) * visibleDur();
}

/** Convert video time → canvas pixel X */
function timeToX(t) {
  const W = wfCanvas.offsetWidth || 1;
  return ((t - S.scrollOffset) / visibleDur()) * W;
}

function setZoom(z, anchorTime) {
  // anchorTime: keep this time at the same pixel after zoom
  const prevVis = visibleDur();
  S.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
  const newVis = visibleDur();

  if (anchorTime !== undefined) {
    // Adjust scroll so anchorTime stays at same relative position
    const ratio = (anchorTime - S.scrollOffset) / prevVis;
    S.scrollOffset = anchorTime - ratio * newVis;
  }
  clampScroll();
  updateZoomUI();
  drawWaveform();
  updateScrollbar();
}

function updateZoomUI() {
  const z = S.zoom;
  zoomLabel.textContent = z < 2 ? '1×' : z < 4 ? '2×' : z < 8 ? '4×' :
                          z < 16 ? '8×' : z < 24 ? '16×' : '32×';
  btnZoomOut.disabled = S.zoom <= ZOOM_MIN;
  btnZoomIn.disabled  = S.zoom >= ZOOM_MAX;
}

function updateScrollbar() {
  const dur = S.videoDuration || 1;
  const vis = visibleDur();
  if (S.zoom <= 1) {
    scrollThumb.style.display = 'none';
    return;
  }
  scrollThumb.style.display = 'block';
  const ww = scrollWrap.offsetWidth;
  const tw = Math.max(20, (vis / dur) * ww);
  const tx = (S.scrollOffset / dur) * ww;
  scrollThumb.style.width = tw + 'px';
  scrollThumb.style.left  = Math.min(tx, ww - tw) + 'px';
}

// ── Zoom buttons ──────────────────────────────────────────────────────────
btnZoomIn.addEventListener('click', () => {
  const mid = S.scrollOffset + visibleDur() / 2;
  setZoom(S.zoom * ZOOM_STEP, mid);
});
btnZoomOut.addEventListener('click', () => {
  const mid = S.scrollOffset + visibleDur() / 2;
  setZoom(S.zoom / ZOOM_STEP, mid);
});
btnZoomFit.addEventListener('click', () => {
  S.zoom = 1; S.scrollOffset = 0;
  updateZoomUI(); drawWaveform(); updateScrollbar();
});

// ── Wheel zoom ────────────────────────────────────────────────────────────
wfOuter.addEventListener('wheel', e => {
  e.preventDefault();
  const rect      = wfCanvas.getBoundingClientRect();
  const px        = e.clientX - rect.left;
  const anchorT   = xToTime(px);
  const factor    = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
  setZoom(S.zoom * factor, anchorT);
}, { passive: false });

// ── Scrollbar drag ────────────────────────────────────────────────────────
let _sbDrag = null;
scrollThumb.addEventListener('mousedown', e => {
  e.preventDefault();
  _sbDrag = { startX: e.clientX, startOff: S.scrollOffset };
});
document.addEventListener('mousemove', e => {
  if (!_sbDrag) return;
  const dx  = e.clientX - _sbDrag.startX;
  const ww  = scrollWrap.offsetWidth;
  const dt  = (dx / ww) * (S.videoDuration || 1);
  S.scrollOffset = _sbDrag.startOff + dt;
  clampScroll();
  drawWaveform();
  updateScrollbar();
});
document.addEventListener('mouseup', () => { _sbDrag = null; });

// ── Library ───────────────────────────────────────────────────────────────
async function loadLibrary() {
  try {
    const res = await fetch('library.json');
    if (!res.ok) throw new Error('404');
    const data = await res.json();
    S.library = data.categories || [];
  } catch {
    S.library = [];
  }
  renderLibrary();
  libraryLoading.classList.add('hidden');
  S.library.forEach(cat => AudioEngine.preloadCategory(cat));
}

function renderLibrary() {
  libraryGrid.innerHTML = '';
  const SYNTH_CATS = [
    { id:'madera',  label:'Madera',  emoji:'🪵', color:'#8B5E3C', samples:[] },
    { id:'cemento', label:'Cemento', emoji:'🏗️', color:'#6B6B6B', samples:[] },
    { id:'grava',   label:'Grava',   emoji:'🪨', color:'#9B8B6A', samples:[] },
    { id:'metal',   label:'Metal',   emoji:'⚙️', color:'#5A8A9F', samples:[] },
  ];
  const display = [...(S.library.length ? S.library : SYNTH_CATS), ...S.userCats];
  display.forEach(cat => libraryGrid.appendChild(makeCatCard(cat)));
}

function makeCatCard(cat) {
  const isSel  = S.selectedCat && S.selectedCat.id === cat.id;
  const total  = cat.samples ? cat.samples.length : 0;
  const nextLbl = total > 1
    ? cat.samples[AudioEngine.getRrIdx(cat.id, total) % total].label
    : total === 1 ? cat.samples[0].label : '(síntesis)';

  const card    = document.createElement('div');
  card.className = 'cat-card';
  card.dataset.catId = cat.id;

  const hdr = document.createElement('div');
  hdr.className = 'cat-card-header';
  hdr.innerHTML = `
    <span class="cat-dot" style="background:${cat.color}"></span>
    <span class="cat-label-text">${cat.emoji} ${cat.label}</span>
    ${total > 1 ? `<span class="cat-rr-badge">${total} vars</span>` : ''}
    ${isSel ? `<span class="cat-selected-badge" style="background:${cat.color}"></span>` : ''}`;

  const trigger = document.createElement('button');
  trigger.className = 'cat-trigger' + (isSel ? ' selected' : '');
  trigger.dataset.catId = cat.id;
  trigger.innerHTML = `
    <span style="font-size:18px">${cat.emoji}</span>
    <span style="flex:1">${cat.label}</span>
    <span class="cat-rr-next">${nextLbl}</span>`;

  trigger.addEventListener('click', () => triggerCategory(cat));
  trigger.addEventListener('touchstart', e => { e.preventDefault(); triggerCategory(cat); }, { passive: false });

  card.appendChild(hdr);
  card.appendChild(trigger);
  return card;
}

function refreshLibraryUI() {
  document.querySelectorAll('.cat-trigger').forEach(btn => {
    btn.classList.toggle('selected', S.selectedCat && btn.dataset.catId === S.selectedCat.id);
  });
}

function flashCatCard(catId) {
  const btn = libraryGrid.querySelector(`.cat-trigger[data-cat-id="${catId}"]`);
  if (!btn) return;
  btn.classList.add('flash');
  setTimeout(() => btn.classList.remove('flash'), 110);
}

// ── Trigger ───────────────────────────────────────────────────────────────
function triggerCategory(cat) {
  AudioEngine.getCtx();
  const { rrIdx } = AudioEngine.playSample(cat.id, cat.samples || [], cat.isUser || false, cat.userId || null, 1);
  flashCatCard(cat.id);
  S.selectedCat = cat;
  refreshLibraryUI();
  updateHint();

  if (S.isRecording && video) {
    const ev = {
      id: newEvId(),
      catId: cat.id, label: cat.label, color: cat.color,
      sampleFiles: cat.samples || [],
      rrIdx, isUser: cat.isUser || false, userId: cat.userId || null,
      time: video.currentTime,
      gain: 1.0,
    };
    S.events.push(ev);
    updateEventCount();
    addLogRow(ev);
    drawWaveform();
  }
}

// ── Video ─────────────────────────────────────────────────────────────────
function loadVideo(file) {
  if (!file || !file.type.startsWith('video/')) return;
  video.src = URL.createObjectURL(file);
  video.style.display = 'block';
  dropHint.style.display = 'none';
  video.onloadedmetadata = () => {
    S.videoLoaded  = true;
    S.videoDuration = video.duration;
    S.events = [];
    S.zoom = 1; S.scrollOffset = 0;
    btnRecord.disabled = false;
    btnPreview.disabled = true;
    btnExport.disabled  = true;
    updateEventCount();
    updateZoomUI();
    drawWaveform();
    updateScrollbar();
    hideTooltip();
  };
  video.onended = () => {
    if (S.isRecording)  stopRecording();
    if (S.isPreviewing) stopPreview();
  };
}

$('video-file-input').addEventListener('change',   e => loadVideo(e.target.files[0]));
$('video-file-input-2').addEventListener('change', e => loadVideo(e.target.files[0]));
videoZone.addEventListener('dragover',  e => { e.preventDefault(); videoZone.classList.add('drag-over'); });
videoZone.addEventListener('dragleave', ()  => videoZone.classList.remove('drag-over'));
videoZone.addEventListener('drop',      e  => { e.preventDefault(); loadVideo(e.dataTransfer.files[0]); });

// ── Custom samples ────────────────────────────────────────────────────────
$('custom-sample-input').addEventListener('change', async e => {
  for (const file of e.target.files) {
    try {
      const { id, name } = await AudioEngine.loadUserSample(file);
      S.userCats.push({ id, label: name, emoji: '🎵', color: '#9B6FD4',
        samples: [{ file: null, label: name }], isUser: true, userId: id });
    } catch (err) { console.error(err); }
  }
  renderLibrary();
  e.target.value = '';
});

// ── Record ────────────────────────────────────────────────────────────────
btnRecord.addEventListener('click', startRecording);
btnStop.addEventListener('click',   stopRecording);

function startRecording() {
  if (!S.videoLoaded) return;
  AudioEngine.getCtx();
  S.events = []; S.isRecording = true;
  video.currentTime = 0;
  video.play();
  btnRecord.style.display = 'none';
  btnStop.style.display   = 'inline-block'; btnStop.disabled = false;
  btnPreview.disabled = true; btnExport.disabled = true;
  recIndicator.classList.remove('hidden');
  updateEventCount(); clearLog(); hideTooltip(); drawWaveform(); startRaf();
}

function stopRecording() {
  if (!S.isRecording) return;
  S.isRecording = false;
  video.pause();
  btnStop.style.display   = 'none';
  btnRecord.style.display = 'inline-block'; btnRecord.disabled = false;
  recIndicator.classList.add('hidden');
  hintBar.classList.add('hidden');
  btnPreview.disabled = S.events.length === 0;
  btnExport.disabled  = S.events.length === 0;
}

// ── Preview ───────────────────────────────────────────────────────────────
btnPreview.addEventListener('click', () => { S.isPreviewing ? stopPreview() : startPreview(); });

async function startPreview() {
  if (!S.events.length || !S.videoLoaded) return;
  S.isPreviewing = true;
  S.previewTimers.forEach(clearTimeout);
  S.previewTimers = [];

  const ctx   = AudioEngine.getCtx();
  const now   = ctx.currentTime;
  const delay = 0.05;

  S.events.forEach(ev => {
    const ms = Math.max(0, ev.time - video.currentTime) * 1000 + delay * 1000;
    const t  = S.previewTimers.push(setTimeout(() => {
      if (!S.isPreviewing) return;
      AudioEngine.scheduleEvent(ev, ctx.currentTime);
    }, ms));
  });

  video.currentTime = 0;
  await video.play();
  btnPreview.textContent = '■ DETENER';
  playIndicator.classList.remove('hidden');
  startRaf();
}

function stopPreview() {
  S.isPreviewing = false;
  S.previewTimers.forEach(clearTimeout);
  S.previewTimers = [];
  video.pause();
  btnPreview.textContent = '▶ ESCUCHAR';
  playIndicator.classList.add('hidden');
}

video.addEventListener('ended', () => { if (S.isPreviewing) stopPreview(); });

// ── Export ────────────────────────────────────────────────────────────────
btnExport.addEventListener('click', async () => {
  if (!S.events.length) return;
  btnExport.disabled = true;
  setStatus('Renderizando 48 kHz…');
  try {
    const blob = await AudioEngine.renderToWav(S.events, S.videoDuration, 48000);
    const url  = URL.createObjectURL(blob);
    const base = video.src
      ? decodeURIComponent(video.src.split('/').pop()).replace(/\.[^.]+$/, '')
      : 'sesion';
    const a = document.createElement('a');
    a.href = url; a.download = `foley_${base}_48k_${Date.now()}.wav`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setStatus('✓ WAV 48 kHz descargado', 4000);
  } catch (err) {
    setStatus('Error: ' + err.message, 4000);
  } finally {
    btnExport.disabled = false;
  }
});

function setStatus(msg, clr = 0) {
  exportStatus.textContent = msg;
  if (clr) setTimeout(() => exportStatus.textContent = '', clr);
}

// ── RAF ───────────────────────────────────────────────────────────────────
let _rafId = null;
function startRaf() {
  cancelAnimationFrame(_rafId);
  function tick() {
    const t = video.currentTime, d = S.videoDuration || 1;
    timecodeEl.textContent   = fmtTime(t);
    progressFill.style.width = `${(t / d) * 100}%`;

    // Auto-scroll timeline during rec/preview to follow playhead
    if (S.isRecording || S.isPreviewing) {
      if (S.zoom > 1) {
        const vis = visibleDur();
        // Scroll when playhead reaches 80% of visible area
        if (t > S.scrollOffset + vis * 0.8) {
          S.scrollOffset = t - vis * 0.2;
          clampScroll();
          updateScrollbar();
        }
      }
      drawWaveform();
    }
    _rafId = requestAnimationFrame(tick);
  }
  _rafId = requestAnimationFrame(tick);
}

video.addEventListener('timeupdate', () => {
  if (!S.isRecording && !S.isPreviewing) {
    timecodeEl.textContent   = fmtTime(video.currentTime);
    progressFill.style.width = `${(video.currentTime / (S.videoDuration || 1)) * 100}%`;
  }
});

// Progress bar seek
progressWrap.addEventListener('click', e => {
  if (S.isRecording) return;
  const r = (e.clientX - progressWrap.getBoundingClientRect().left) / progressWrap.offsetWidth;
  video.currentTime = r * S.videoDuration;
  drawWaveform();
});

// ── Keyboard ──────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.code === 'Space' && S.selectedCat && S.isRecording) {
    e.preventDefault(); triggerCategory(S.selectedCat);
  }
  if (e.code === 'Escape') { hideTooltip(); closeModal(); }
  if ((e.code === 'Delete' || e.code === 'Backspace') && S.selectedEvId && !S.isRecording) {
    e.preventDefault(); deleteEvent(S.selectedEvId);
  }
});

// ── Waveform draw ─────────────────────────────────────────────────────────
function drawWaveform() {
  const W = wfOuter.clientWidth  || wfOuter.offsetWidth  || 400;
  const H = wfCanvas.offsetHeight || 88;
  if (wfCanvas.width !== W)  wfCanvas.width  = W;
  if (wfCanvas.height !== H) wfCanvas.height = H;

  wfCtx.clearRect(0, 0, W, H);
  wfCtx.fillStyle = '#0D0D0F';
  wfCtx.fillRect(0, 0, W, H);

  const vis = visibleDur();
  const dur = S.videoDuration || 1;

  // Grid — number of lines proportional to zoom
  const gridLines = Math.max(4, Math.min(20, Math.floor(S.zoom * 5)));
  wfCtx.strokeStyle = '#1E1E22'; wfCtx.lineWidth = 1;
  for (let i = 1; i < gridLines; i++) {
    const x = (i / gridLines) * W;
    wfCtx.beginPath(); wfCtx.moveTo(x, 0); wfCtx.lineTo(x, H); wfCtx.stroke();
  }
  wfCtx.beginPath(); wfCtx.moveTo(0, H / 2); wfCtx.lineTo(W, H / 2); wfCtx.stroke();

  // Time ruler labels
  wfCtx.fillStyle = '#3A3A3E';
  wfCtx.font = '9px IBM Plex Mono, monospace';
  wfCtx.textAlign = 'left';
  const step = vis / gridLines;
  for (let i = 0; i <= gridLines; i++) {
    const t = S.scrollOffset + i * step;
    if (t > dur + 0.01) break;
    const x = (i / gridLines) * W;
    wfCtx.fillText(fmtTime(t), x + 2, H - 3);
  }

  // Events
  const MID = H / 2;
  const MAX_AMP = MID * 0.88; // max impulse height at gain=2

  S.events.forEach(ev => {
    const x = timeToX(ev.time);
    if (x < -10 || x > W + 10) return; // outside visible range

    const gain  = ev.gain !== undefined ? ev.gain : 1;
    const amp   = Math.max(4, MAX_AMP * (gain / 2));  // gain 0→0, 1→half, 2→full
    const col   = resolveColor(ev.color);
    const isSel = ev.id === S.selectedEvId;

    wfCtx.globalAlpha = isSel ? 1 : 0.82;
    wfCtx.strokeStyle = col;
    wfCtx.lineWidth   = isSel ? 3 : 2;

    // Impulse lines
    wfCtx.beginPath(); wfCtx.moveTo(x, MID); wfCtx.lineTo(x, MID - amp); wfCtx.stroke();
    wfCtx.beginPath(); wfCtx.moveTo(x, MID); wfCtx.lineTo(x, MID + amp); wfCtx.stroke();

    // Peak dot
    wfCtx.fillStyle = col;
    wfCtx.beginPath(); wfCtx.arc(x, MID - amp, isSel ? 5 : 3.5, 0, Math.PI * 2); wfCtx.fill();

    // Gain label on selected
    if (isSel) {
      wfCtx.strokeStyle = 'rgba(255,255,255,0.3)';
      wfCtx.lineWidth = 1;
      wfCtx.beginPath(); wfCtx.arc(x, MID - amp, 8, 0, Math.PI * 2); wfCtx.stroke();
      wfCtx.fillStyle = '#E8E4DC';
      wfCtx.font = 'bold 9px IBM Plex Mono, monospace';
      wfCtx.textAlign = 'center';
      wfCtx.fillText(Math.round(gain * 100) + '%', x, MID - amp - 12);
      wfCtx.textAlign = 'left';
    }

    wfCtx.globalAlpha = 1;
  });

  // Playhead
  if (dur > 0) {
    const px = timeToX(video.currentTime);
    if (px >= 0 && px <= W) {
      wfCtx.strokeStyle = S.isRecording ? '#E8403A' : (S.isPreviewing ? '#3A9E6A' : '#E8E4DC');
      wfCtx.lineWidth   = S.isRecording ? 2 : 1.5;
      wfCtx.globalAlpha = 0.85;
      wfCtx.beginPath(); wfCtx.moveTo(px, 0); wfCtx.lineTo(px, H); wfCtx.stroke();
      if (S.isRecording) {
        wfCtx.fillStyle = '#E8403A';
        wfCtx.globalAlpha = 1;
        wfCtx.beginPath(); wfCtx.arc(px, 9, 5, 0, Math.PI * 2); wfCtx.fill();
      }
      wfCtx.globalAlpha = 1;
    }
  }
}

window.addEventListener('resize', () => { drawWaveform(); updateScrollbar(); positionTooltip(); });

// ── Timeline pointer interaction ──────────────────────────────────────────
const HIT_PX = 12;

function getEvtCoords(e) {
  const rect   = wfCanvas.getBoundingClientRect();
  const touch  = e.touches ? e.touches[0] : e;
  return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
}

function findEventNear(cx) {
  let best = null, bestD = HIT_PX;
  S.events.forEach(ev => {
    const ex = timeToX(ev.time);
    const d  = Math.abs(cx - ex);
    if (d < bestD) { bestD = d; best = ev; }
  });
  return best;
}

// Pointer down
function onDown(e) {
  if (S.isRecording) return;
  if (e.button !== undefined && e.button !== 0) return;
  e.preventDefault();

  const { x, y } = getEvtCoords(e);
  const hit = findEventNear(x);

  if (hit) {
    S.selectedEvId = hit.id;
    const H   = wfCanvas.offsetHeight;
    const MID = H / 2;
    const gain = hit.gain !== undefined ? hit.gain : 1;
    const MAX_AMP = MID * 0.88;
    const amp = Math.max(4, MAX_AMP * (gain / 2));
    const dotY = MID - amp;

    // Mode: if clicking near peak dot → gain drag, else move drag
    const nearPeak = Math.abs(y - dotY) < 14;
    S.drag = {
      evId: hit.id,
      mode: nearPeak ? 'gain' : 'move',
      startX: x, startY: y,
      startTime: hit.time,
      startGain: gain,
      moved: false,
    };
    drawWaveform();
    positionTooltip();
  } else {
    S.selectedEvId = null;
    S.drag = null;
    hideTooltip();
    if (S.videoDuration > 0 && !S.isPreviewing) {
      video.currentTime = Math.max(0, Math.min(S.videoDuration, xToTime(x)));
    }
    drawWaveform();
  }
}

// Pointer move
function onMove(e) {
  if (!S.drag || S.isRecording) return;
  e.preventDefault();
  const { x, y } = getEvtCoords(e);
  const dx = x - S.drag.startX;
  const dy = y - S.drag.startY;

  if (Math.abs(dx) < 2 && Math.abs(dy) < 2 && !S.drag.moved) return;
  S.drag.moved = true;

  const ev = S.events.find(e => e.id === S.drag.evId);
  if (!ev) return;

  if (S.drag.mode === 'move') {
    const dt = (dx / (wfCanvas.offsetWidth || 1)) * visibleDur();
    ev.time = Math.max(0, Math.min(S.videoDuration || 999, S.drag.startTime + dt));
    updateLogRow(ev);
  } else {
    // gain drag: drag up = louder, down = quieter
    // Map ±(H/2) px to 0–2 gain range
    const H = wfCanvas.offsetHeight || 88;
    const deltaGain = -(dy / (H / 2)) * 2;
    ev.gain = Math.max(0, Math.min(2, S.drag.startGain + deltaGain));
    updateTooltipVol(ev);
    updateLogRow(ev);
  }

  drawWaveform();
  positionTooltip();
}

// Pointer up
function onUp() {
  if (S.drag && S.drag.moved) {
    S.events.sort((a, b) => a.time - b.time);
    rebuildLog();
    drawWaveform();
    positionTooltip();
  }
  S.drag = null;
}

wfCanvas.addEventListener('mousedown',  onDown);
wfCanvas.addEventListener('mousemove',  onMove);
wfCanvas.addEventListener('mouseup',    onUp);
wfCanvas.addEventListener('mouseleave', onUp);
wfCanvas.addEventListener('touchstart', onDown, { passive: false });
wfCanvas.addEventListener('touchmove',  onMove, { passive: false });
wfCanvas.addEventListener('touchend',   onUp,   { passive: false });

// ── Pinch-to-zoom (mobile) ────────────────────────────────────────────────
wfCanvas.addEventListener('touchstart', e => {
  if (e.touches.length === 2) {
    e.preventDefault();
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2
                 - wfCanvas.getBoundingClientRect().left;
    S.pinch = { dist: Math.hypot(dx, dy), zoom: S.zoom, anchorTime: xToTime(midX) };
  }
}, { passive: false });

wfCanvas.addEventListener('touchmove', e => {
  if (e.touches.length === 2 && S.pinch) {
    e.preventDefault();
    const dx   = e.touches[0].clientX - e.touches[1].clientX;
    const dy   = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.hypot(dx, dy);
    const factor = dist / S.pinch.dist;
    setZoom(S.pinch.zoom * factor, S.pinch.anchorTime);
  }
}, { passive: false });

wfCanvas.addEventListener('touchend', e => {
  if (e.touches.length < 2) S.pinch = null;
});

// ── Tooltip ───────────────────────────────────────────────────────────────
function positionTooltip() {
  const ev = S.events.find(e => e.id === S.selectedEvId);
  if (!ev) { hideTooltip(); return; }

  const x   = timeToX(ev.time);
  const W   = wfCanvas.offsetWidth;
  const col = resolveColor(ev.color);

  tooltipName.textContent = `${ev.label}  ${fmtTime(ev.time)}`;
  tooltipName.style.color = col;

  const gain = ev.gain !== undefined ? ev.gain : 1;
  tooltipVol.value = Math.round(gain * 100);
  tooltipVolLbl.textContent = Math.round(gain * 100) + '%';

  tooltip.classList.remove('hidden');

  // Position: centered above impulse, clamped to canvas
  const tw  = tooltip.offsetWidth;
  const H_c = wfCanvas.offsetHeight;
  let left  = x - tw / 2;
  left = Math.max(4, Math.min(W - tw - 4, left));
  tooltip.style.left = left + 'px';
  // Place above the canvas (negative top from waveform-inner top)
  tooltip.style.top = (H_c - 4) + 'px'; // below canvas
}

function updateTooltipVol(ev) {
  const gain = ev.gain !== undefined ? ev.gain : 1;
  tooltipVol.value = Math.round(gain * 100);
  tooltipVolLbl.textContent = Math.round(gain * 100) + '%';
}

function hideTooltip() {
  tooltip.classList.add('hidden');
  S.selectedEvId = null;
}

tooltipVol.addEventListener('input', () => {
  const ev = S.events.find(e => e.id === S.selectedEvId);
  if (!ev) return;
  const g = parseFloat(tooltipVol.value) / 100;
  ev.gain = g;
  tooltipVolLbl.textContent = Math.round(g * 100) + '%';
  updateLogRow(ev);
  drawWaveform();
});

tooltipDelete.addEventListener('click', () => { if (S.selectedEvId) deleteEvent(S.selectedEvId); });
tooltipChange.addEventListener('click', () => { if (S.selectedEvId) openChangeModal(S.selectedEvId); });

function deleteEvent(id) {
  S.events = S.events.filter(e => e.id !== id);
  S.selectedEvId = null;
  hideTooltip();
  updateEventCount();
  rebuildLog();
  drawWaveform();
  btnPreview.disabled = S.events.length === 0;
  btnExport.disabled  = S.events.length === 0;
}

// ── Modal ─────────────────────────────────────────────────────────────────
function openChangeModal(evId) {
  modalGrid.innerHTML = '';
  const all = [...S.library, ...S.userCats];
  if (!all.length) { closeModal(); return; }
  all.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'modal-cat-btn';
    btn.innerHTML = `<span style="font-size:18px">${cat.emoji}</span><span>${cat.label}</span>`;
    btn.addEventListener('click', () => {
      const ev = S.events.find(e => e.id === evId);
      if (ev) {
        const { rrIdx } = AudioEngine.playSample(cat.id, cat.samples || [], cat.isUser || false, cat.userId || null, ev.gain || 1);
        Object.assign(ev, { catId: cat.id, label: cat.label, color: cat.color,
          sampleFiles: cat.samples || [], rrIdx, isUser: cat.isUser || false, userId: cat.userId || null });
      }
      closeModal(); drawWaveform(); positionTooltip(); rebuildLog();
    });
    modalGrid.appendChild(btn);
  });
  modalOverlay.classList.remove('hidden');
}

function closeModal() { modalOverlay.classList.add('hidden'); }
modalCancel.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });

// ── Session log ───────────────────────────────────────────────────────────
function addLogRow(ev) { sessionLog.insertBefore(makeLogRow(ev), sessionLog.firstChild); }

function makeLogRow(ev) {
  const row = document.createElement('div');
  row.className = 'log-row'; row.dataset.evId = ev.id;
  const col = resolveColor(ev.color);
  const gain = ev.gain !== undefined ? ev.gain : 1;
  row.innerHTML = `
    <span style="color:${col}">${ev.label}</span>
    <span class="log-tc">${fmtTime(ev.time)}</span>
    <span class="log-vol">${Math.round(gain * 100)}%</span>`;
  return row;
}

function updateLogRow(ev) {
  const row = sessionLog.querySelector(`[data-ev-id="${ev.id}"]`);
  if (!row) return;
  const gain = ev.gain !== undefined ? ev.gain : 1;
  const tc = row.querySelector('.log-tc');
  const vl = row.querySelector('.log-vol');
  if (tc) tc.textContent = fmtTime(ev.time);
  if (vl) vl.textContent = Math.round(gain * 100) + '%';
}

function rebuildLog() {
  sessionLog.innerHTML = '';
  [...S.events].reverse().forEach(ev => sessionLog.appendChild(makeLogRow(ev)));
}

function clearLog() { sessionLog.innerHTML = ''; }

// ── Hint ──────────────────────────────────────────────────────────────────
function updateHint() {
  if (S.isRecording && S.selectedCat) {
    const total = S.selectedCat.samples ? S.selectedCat.samples.length : 0;
    const next  = AudioEngine.getRrIdx(S.selectedCat.id, total);
    hintName.textContent = S.selectedCat.label;
    hintRr.textContent   = total > 1 ? `→ var ${next + 1}/${total}` : '';
    hintBar.classList.remove('hidden');
  } else {
    hintBar.classList.add('hidden');
  }
}

function updateEventCount() {
  const n = S.events.length;
  eventCount.textContent = `${n} evento${n !== 1 ? 's' : ''}`;
}

// ── Init ──────────────────────────────────────────────────────────────────
loadLibrary();
updateZoomUI();
startRaf();
drawWaveform();
