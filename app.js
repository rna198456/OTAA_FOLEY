/**
 * app.js — Foley Recorder v4
 *
 * Nuevas features:
 *  - Biblioteca: selector de calzado (radio) + superficies (multi-select + fader por capa)
 *  - Cada evento graba layers = [{ fwId, surface, rrIdx, gainMult }]
 *  - Preview y Export arrancan desde el timecode seleccionado (no desde 0)
 *  - Zoom: ancla siempre al inicio del área visible (no al centro)
 *  - Scrollbar de timeline más grande y fácil de arrastrar
 *  - Drag vertical en impulso = volumen del evento completo
 */
'use strict';

// ── State ─────────────────────────────────────────────────────────────────
const S = {
  lib: null,          // parsed library.json

  // Selections
  selectedFw:      null,    // { id, label, emoji }
  activeSurfaces:  {},      // surfaceId → gainMult (0–2). Present = active

  // Events recorded
  events:         [],       // [{ id, time, gain, layers, label, color }]

  // Video
  videoLoaded:    false,
  videoDuration:  0,

  // Playback state
  isRecording:    false,
  isPreviewing:   false,
  startTimecode:  0,        // where playback begins (video.currentTime at rec/preview start)

  // Selected event (for editing)
  selectedEvId:   null,

  // Timeline zoom
  zoom:           1,
  scrollOffset:   0,        // seconds from left

  // Drag on canvas
  drag: null,
  // { evId, mode:'move'|'gain', startX, startY, startTime, startGain, moved }

  // Pinch
  pinch: null,

  previewTimers: [],
};

const ZOOM_MIN = 1, ZOOM_MAX = 32, ZOOM_STEP = Math.sqrt(2);
let evSeq = 0;
const newId = () => 'ev_' + (++evSeq);

// ── DOM ───────────────────────────────────────────────────────────────────
const $   = id => document.getElementById(id);
const video         = $('video-el');
const dropHint      = $('drop-hint');
const videoZone     = $('video-zone');
const wfCanvas      = $('waveform');
const wfOuter       = $('waveform-outer');
const wfCtx         = wfCanvas.getContext('2d');
const progressWrap  = $('progress-wrap');
const progressFill  = $('progress-fill');
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
const fwGrid        = $('fw-grid');
const surfaceList   = $('surface-list');
const btnTrigger    = $('btn-trigger');
const triggerLabel  = $('trigger-label');
const triggerIcon   = $('trigger-icon');
const sessionLog    = $('session-log');
const tooltip       = $('event-tooltip');
const tooltipName   = $('tooltip-name');
const tooltipVol    = $('tooltip-vol');
const tooltipVolLbl = $('tooltip-vol-label');
const tooltipChange = $('tooltip-change');
const tooltipDelete = $('tooltip-delete');
const modalOverlay  = $('modal-overlay');
const modalContent  = $('modal-content');
const modalCancel   = $('modal-cancel');
const btnZoomIn     = $('btn-zoom-in');
const btnZoomOut    = $('btn-zoom-out');
const btnZoomFit    = $('btn-zoom-fit');
const zoomLabel     = $('zoom-label');
const scrollTrack   = $('tl-scroll-track');
const scrollThumb   = $('tl-scroll-thumb');

// ── Formatting ────────────────────────────────────────────────────────────
const fmt = t => {
  const m = Math.floor(t / 60).toString().padStart(2, '0');
  const s = (t % 60).toFixed(2).padStart(5, '0');
  return `${m}:${s}`;
};

// ── Zoom & scroll ─────────────────────────────────────────────────────────
function visDur() { return (S.videoDuration || 10) / S.zoom; }

function clampScroll() {
  const max = Math.max(0, (S.videoDuration || 0) - visDur());
  S.scrollOffset = Math.max(0, Math.min(S.scrollOffset, max));
}

function xToTime(x) {
  return S.scrollOffset + (x / (wfCanvas.offsetWidth || 1)) * visDur();
}
function timeToX(t) {
  return ((t - S.scrollOffset) / visDur()) * (wfCanvas.offsetWidth || 1);
}

// zoom anchors to left edge of visible area (not center)
function setZoom(z) {
  const anchorTime = S.scrollOffset;   // keep left edge fixed
  S.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
  S.scrollOffset = anchorTime;
  clampScroll();
  updateZoomUI();
  drawWaveform();
  updateScrollbar();
}

function updateZoomUI() {
  const z = S.zoom;
  zoomLabel.textContent =
    z <= 1 ? '1×' : z <= 2 ? '2×' : z <= 4 ? '4×' :
    z <= 8 ? '8×' : z <= 16 ? '16×' : '32×';
  btnZoomOut.disabled = S.zoom <= ZOOM_MIN;
  btnZoomIn.disabled  = S.zoom >= ZOOM_MAX;
}

function updateScrollbar() {
  const dur = S.videoDuration || 1;
  const vis = visDur();
  if (S.zoom <= 1) { scrollThumb.style.display = 'none'; return; }
  scrollThumb.style.display = 'block';
  const tw = scrollTrack.offsetWidth;
  const w  = Math.max(28, (vis / dur) * tw);
  const x  = Math.min((S.scrollOffset / dur) * tw, tw - w);
  scrollThumb.style.width = w + 'px';
  scrollThumb.style.left  = x + 'px';
}

// Zoom buttons
btnZoomIn.addEventListener('click',  () => setZoom(S.zoom * ZOOM_STEP));
btnZoomOut.addEventListener('click', () => setZoom(S.zoom / ZOOM_STEP));
btnZoomFit.addEventListener('click', () => { S.zoom = 1; S.scrollOffset = 0; updateZoomUI(); drawWaveform(); updateScrollbar(); });

// Wheel zoom — anchor to cursor position
wfOuter.addEventListener('wheel', e => {
  e.preventDefault();
  const rect = wfCanvas.getBoundingClientRect();
  const anchorT = xToTime(e.clientX - rect.left);
  const prev = S.zoom;
  S.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, S.zoom * (e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP)));
  // Keep anchor time at same pixel
  const ratio = (anchorT - S.scrollOffset) / (S.videoDuration / prev || 1);
  S.scrollOffset = anchorT - ratio * visDur();
  clampScroll();
  updateZoomUI(); drawWaveform(); updateScrollbar();
}, { passive: false });

// Scrollbar drag
let _sbDrag = null;
scrollThumb.addEventListener('mousedown', e => {
  e.preventDefault();
  _sbDrag = { startX: e.clientX, startOff: S.scrollOffset };
});
scrollThumb.addEventListener('touchstart', e => {
  e.preventDefault();
  _sbDrag = { startX: e.touches[0].clientX, startOff: S.scrollOffset };
}, { passive: false });
document.addEventListener('mousemove', e => {
  if (!_sbDrag) return;
  const dx = e.clientX - _sbDrag.startX;
  S.scrollOffset = _sbDrag.startOff + (dx / scrollTrack.offsetWidth) * (S.videoDuration || 1);
  clampScroll(); drawWaveform(); updateScrollbar();
});
document.addEventListener('touchmove', e => {
  if (!_sbDrag) return;
  const dx = e.touches[0].clientX - _sbDrag.startX;
  S.scrollOffset = _sbDrag.startOff + (dx / scrollTrack.offsetWidth) * (S.videoDuration || 1);
  clampScroll(); drawWaveform(); updateScrollbar();
}, { passive: false });
document.addEventListener('mouseup',  () => { _sbDrag = null; });
document.addEventListener('touchend', () => { _sbDrag = null; });

// ── Library init ──────────────────────────────────────────────────────────
async function loadLibrary() {
  try {
    const res = await fetch('library.json');
    S.lib = await res.json();
  } catch {
    // Fallback si library.json no se puede cargar
    S.lib = {
      footwear: [
        { id:'botas',      label:'Botas',      emoji:'👢' },
        { id:'zapatillas', label:'Zapatillas', emoji:'👟' },
        { id:'tacos',      label:'Tacos',      emoji:'👠' },
        { id:'descalzo',   label:'Descalzo',   emoji:'🦶' },
      ],
      surfaces: [
        { id:'agua',    label:'Agua',    emoji:'🌊', color:'#3A7AB0', samples:[] },
        { id:'arena',   label:'Arena',   emoji:'🏖️', color:'#9B8B6A', samples:[] },
        { id:'asfalto', label:'Asfalto', emoji:'🛣️', color:'#5A5A6A', samples:[] },
        { id:'hojas',   label:'Hojas',   emoji:'🍂', color:'#8B6914', samples:[] },
        { id:'humedo',  label:'Húmedo',  emoji:'💧', color:'#5A8A9F', samples:[] },
        { id:'madera',  label:'Madera',  emoji:'🪵', color:'#8B5E3C', samples:[] },
        { id:'pasto',   label:'Pasto',   emoji:'🌿', color:'#4A7A3A', samples:[] },
        { id:'piedras', label:'Piedras', emoji:'🪨', color:'#7A6A5A', samples:[] },
      ],
    };
  }
  renderFootwear();
  renderSurfaces();
  $('library-loading') && $('library-loading').classList.add('hidden');
}

// ── Footwear selector ─────────────────────────────────────────────────────
function renderFootwear() {
  fwGrid.innerHTML = '';
  S.lib.footwear.forEach(fw => {
    const btn = document.createElement('button');
    btn.className = 'fw-btn';
    btn.dataset.fwId = fw.id;
    btn.innerHTML = `<span class="fw-emoji">${fw.emoji}</span><span class="fw-label">${fw.label}</span>`;
    btn.addEventListener('pointerdown', e => { e.preventDefault(); selectFootwear(fw); });
    fwGrid.appendChild(btn);
  });
}

function selectFootwear(fw) {
  S.selectedFw = fw;
  document.querySelectorAll('.fw-btn').forEach(b =>
    b.classList.toggle('selected', b.dataset.fwId === fw.id));
  // Preload all surfaces for this footwear
  if (S.lib.surfaces) {
    S.lib.surfaces.forEach(surf => AudioEngine.preloadSurface(fw.id, surf));
  }
  updateTrigger();
}

// ── Surface selector + faders ─────────────────────────────────────────────
function renderSurfaces() {
  surfaceList.innerHTML = '';
  (S.lib.surfaces || []).forEach(surf => {
    const row = document.createElement('div');
    row.className = 'surface-row';
    row.dataset.surfId = surf.id;

    const checkbox = document.createElement('button');
    checkbox.className = 'surf-check';
    checkbox.dataset.surfId = surf.id;
    checkbox.innerHTML = `<span class="surf-emoji">${surf.emoji}</span><span class="surf-name">${surf.label}</span>`;
    checkbox.addEventListener('pointerdown', e => { e.preventDefault(); toggleSurface(surf); });

    const faderWrap = document.createElement('div');
    faderWrap.className = 'surf-fader-wrap hidden';
    faderWrap.dataset.surfId = surf.id;
    faderWrap.innerHTML = `
      <input type="range" class="surf-fader" min="0" max="200" step="1" value="100"
             data-surf-id="${surf.id}" />
      <span class="surf-fader-val">100%</span>`;
    faderWrap.querySelector('.surf-fader').addEventListener('input', e => {
      const val = parseInt(e.target.value);
      S.activeSurfaces[surf.id] = val / 100;
      faderWrap.querySelector('.surf-fader-val').textContent = val + '%';
    });

    row.appendChild(checkbox);
    row.appendChild(faderWrap);
    surfaceList.appendChild(row);
  });
}

function toggleSurface(surf) {
  if (S.activeSurfaces[surf.id] !== undefined) {
    delete S.activeSurfaces[surf.id];
  } else {
    S.activeSurfaces[surf.id] = 1.0;
  }
  // Update UI
  document.querySelectorAll('.surf-check').forEach(b => {
    if (b.dataset.surfId === surf.id) {
      b.classList.toggle('selected', S.activeSurfaces[surf.id] !== undefined);
      b.style.borderColor = S.activeSurfaces[surf.id] !== undefined
        ? (S.lib.surfaces.find(s => s.id === surf.id)?.color || '#D4870A')
        : '';
    }
  });
  const faderWrap = surfaceList.querySelector(`.surf-fader-wrap[data-surf-id="${surf.id}"]`);
  if (faderWrap) {
    faderWrap.classList.toggle('hidden', S.activeSurfaces[surf.id] === undefined);
  }
  updateTrigger();
}

function buildLayers() {
  if (!S.selectedFw || !Object.keys(S.activeSurfaces).length) return [];
  return Object.entries(S.activeSurfaces).map(([surfId, gainMult]) => {
    const surface = S.lib.surfaces.find(s => s.id === surfId);
    return { fwId: S.selectedFw.id, surface, gainMult };
  });
}

function updateTrigger() {
  const layers = buildLayers();
  const ok = layers.length > 0;
  btnTrigger.disabled = !ok;
  if (!ok) {
    triggerLabel.textContent = S.selectedFw
      ? 'Seleccioná al menos una superficie'
      : 'Seleccioná calzado y superficie';
    triggerIcon.textContent = S.selectedFw ? S.selectedFw.emoji : '👣';
  } else {
    triggerIcon.textContent = S.selectedFw.emoji;
    const surfNames = layers.map(l => l.surface.label).join(' + ');
    triggerLabel.textContent = `${S.selectedFw.label} · ${surfNames}`;
  }
  updateHint();
}

// ── Trigger ───────────────────────────────────────────────────────────────
// pointerdown fires once on both mouse and touch — avoids the
// double-fire / 300ms delay of click+touchstart combo on mobile.
btnTrigger.addEventListener('pointerdown', e => {
  e.preventDefault();
  if (btnTrigger.disabled) return;
  fireTrigger();
});

function fireTrigger() {
  const layers = buildLayers();
  if (!layers.length) return;
  AudioEngine.getCtx();

  // Play real-time
  const results = AudioEngine.playLayers(layers);

  // Flash trigger button
  btnTrigger.classList.add('flash');
  setTimeout(() => btnTrigger.classList.remove('flash'), 100);

  // Record event
  if (S.isRecording && video) {
    const rrLayers = layers.map((l, i) => ({
      fwId:     l.fwId,
      surface:  l.surface,
      gainMult: l.gainMult,
      rrIdx:    results[i]?.rrIdx || 0,
    }));
    const surfColors = layers.map(l => l.surface.color);
    const ev = {
      id:     newId(),
      time:   video.currentTime,
      gain:   1.0,
      layers: rrLayers,
      label:  `${S.selectedFw.emoji} ${S.selectedFw.label} · ${layers.map(l => l.surface.label).join('+')}`,
      color:  surfColors[0] || '#D4870A',
    };
    S.events.push(ev);
    updateEventCount();
    addLogRow(ev);
    drawWaveform();
  }
}

// Keyboard: space = fire
document.addEventListener('keydown', e => {
  if (e.code === 'Space' && S.isRecording && !btnTrigger.disabled) {
    e.preventDefault(); fireTrigger();
  }
  if (e.code === 'Escape') { hideTooltip(); closeModal(); }
  if ((e.code === 'Delete' || e.code === 'Backspace') && S.selectedEvId && !S.isRecording) {
    e.preventDefault(); deleteEvent(S.selectedEvId);
  }
});

// ── Video load ────────────────────────────────────────────────────────────
function loadVideo(file) {
  if (!file || !file.type.startsWith('video/')) return;
  video.src = URL.createObjectURL(file);
  video.style.display = 'block';
  dropHint.style.display = 'none';
  video.onloadedmetadata = () => {
    S.videoLoaded = true; S.videoDuration = video.duration;
    S.events = []; S.zoom = 1; S.scrollOffset = 0;
    btnRecord.disabled = false;
    btnPreview.disabled = true; btnExport.disabled = true;
    updateEventCount(); updateZoomUI(); drawWaveform(); updateScrollbar(); hideTooltip();
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

// Click on drop zone when no video
videoZone.addEventListener('click', e => {
  if (!S.videoLoaded && e.target === videoZone) $('video-file-input').click();
});

// ── Custom samples ────────────────────────────────────────────────────────
$('custom-sample-input').addEventListener('change', async e => {
  // Custom samples are added as standalone layers (user category)
  for (const file of e.target.files) {
    try { await AudioEngine.loadUserSample(file); } catch {}
  }
  e.target.value = '';
});

// ── Record ────────────────────────────────────────────────────────────────
btnRecord.addEventListener('click', startRecording);
btnStop.addEventListener('click',   stopRecording);

function startRecording() {
  if (!S.videoLoaded) return;
  AudioEngine.getCtx();
  // Start from current timecode position (wherever the user seeked)
  S.startTimecode = video.currentTime;
  S.events = []; S.isRecording = true;
  video.play();
  btnRecord.style.display = 'none';
  btnStop.style.display   = 'inline-block'; btnStop.disabled = false;
  btnPreview.disabled = true; btnExport.disabled = true;
  recIndicator.classList.remove('hidden');
  updateEventCount(); clearLog(); hideTooltip(); drawWaveform(); startRaf();
}

function stopRecording() {
  if (!S.isRecording) return;
  S.isRecording = false; video.pause();
  btnStop.style.display   = 'none';
  btnRecord.style.display = 'inline-block'; btnRecord.disabled = false;
  recIndicator.classList.add('hidden');
  hintBar.classList.add('hidden');
  btnPreview.disabled = S.events.length === 0;
  btnExport.disabled  = S.events.length === 0;
}

// ── Preview — starts from current video timecode ──────────────────────────
btnPreview.addEventListener('click', () => S.isPreviewing ? stopPreview() : startPreview());

async function startPreview() {
  if (!S.events.length || !S.videoLoaded) return;
  S.isPreviewing = true;
  S.previewTimers.forEach(clearTimeout); S.previewTimers = [];

  // Start from the current position of the video (wherever user seeked)
  const startAt  = video.currentTime;
  S.startTimecode = startAt;
  const ctx      = AudioEngine.getCtx();

  // Schedule only events that are at or after startAt
  S.events.filter(ev => ev.time >= startAt).forEach(ev => {
    const delayMs = (ev.time - startAt) * 1000;
    S.previewTimers.push(setTimeout(() => {
      if (!S.isPreviewing) return;
      AudioEngine.scheduleLayers(ev.layers, ctx.currentTime + 0.02);
    }, delayMs));
  });

  await video.play();
  btnPreview.textContent = '■ DETENER';
  playIndicator.classList.remove('hidden');
  startRaf();
}

function stopPreview() {
  S.isPreviewing = false;
  S.previewTimers.forEach(clearTimeout); S.previewTimers = [];
  video.pause();
  btnPreview.textContent = '▶ ESCUCHAR';
  playIndicator.classList.add('hidden');
}

// ── Export — 48 kHz, all events regardless of timecode ───────────────────
btnExport.addEventListener('click', async () => {
  if (!S.events.length) return;
  btnExport.disabled = true; setStatus('Renderizando 48 kHz…');
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
  } catch (err) { setStatus('Error: ' + err.message, 4000); }
  finally { btnExport.disabled = false; }
});

function setStatus(msg, clr = 0) {
  exportStatus.textContent = msg;
  if (clr) setTimeout(() => exportStatus.textContent = '', clr);
}

// ── Progress bar / seek ───────────────────────────────────────────────────
progressWrap.addEventListener('click', e => {
  if (S.isRecording) return;
  const r = (e.clientX - progressWrap.getBoundingClientRect().left) / progressWrap.offsetWidth;
  video.currentTime = r * S.videoDuration;
  drawWaveform();
});

// ── RAF loop ──────────────────────────────────────────────────────────────
let _rafId = null;
function startRaf() {
  cancelAnimationFrame(_rafId);
  (function tick() {
    const t = video.currentTime, d = S.videoDuration || 1;
    timecodeEl.textContent   = fmt(t);
    progressFill.style.width = `${(t / d) * 100}%`;
    if (S.isRecording || S.isPreviewing) {
      // Auto-scroll to follow playhead
      if (S.zoom > 1) {
        const vis = visDur();
        if (t > S.scrollOffset + vis * 0.82) {
          S.scrollOffset = t - vis * 0.15;
          clampScroll(); updateScrollbar();
        }
      }
      drawWaveform();
    }
    _rafId = requestAnimationFrame(tick);
  })();
}

video.addEventListener('timeupdate', () => {
  if (!S.isRecording && !S.isPreviewing) {
    timecodeEl.textContent   = fmt(video.currentTime);
    progressFill.style.width = `${(video.currentTime / (S.videoDuration || 1)) * 100}%`;
  }
});

// ── Waveform ──────────────────────────────────────────────────────────────
function drawWaveform() {
  const W = wfOuter.clientWidth || 400;
  const H = 88;
  if (wfCanvas.width !== W)  wfCanvas.width  = W;
  if (wfCanvas.height !== H) wfCanvas.height = H;

  wfCtx.clearRect(0, 0, W, H);
  wfCtx.fillStyle = '#0D0D0F'; wfCtx.fillRect(0, 0, W, H);

  const vis   = visDur();
  const MID   = H / 2;
  const MAXAMP= MID * 0.86;

  // Grid
  const gridN = Math.max(4, Math.min(24, Math.round(S.zoom * 5)));
  wfCtx.strokeStyle = '#1E1E22'; wfCtx.lineWidth = 1;
  for (let i = 1; i < gridN; i++) {
    const x = (i / gridN) * W;
    wfCtx.beginPath(); wfCtx.moveTo(x, 0); wfCtx.lineTo(x, H); wfCtx.stroke();
  }
  wfCtx.beginPath(); wfCtx.moveTo(0, MID); wfCtx.lineTo(W, MID); wfCtx.stroke();

  // Time ruler
  wfCtx.fillStyle = '#3A3A3E'; wfCtx.font = '8px IBM Plex Mono,monospace'; wfCtx.textAlign = 'left';
  const step = vis / gridN;
  for (let i = 0; i <= gridN; i++) {
    const t = S.scrollOffset + i * step;
    if (t > (S.videoDuration || 0) + 0.02) break;
    wfCtx.fillText(fmt(t), (i / gridN) * W + 2, H - 3);
  }

  // Events
  S.events.forEach(ev => {
    const x   = timeToX(ev.time);
    if (x < -12 || x > W + 12) return;
    const gain = ev.gain ?? 1;
    const amp  = Math.max(5, MAXAMP * Math.min(gain, 2) / 2);
    const col  = ev.color || '#D4870A';
    const isSel= ev.id === S.selectedEvId;

    wfCtx.globalAlpha = isSel ? 1 : 0.82;
    wfCtx.strokeStyle = col; wfCtx.lineWidth = isSel ? 3 : 2;
    wfCtx.beginPath(); wfCtx.moveTo(x, MID); wfCtx.lineTo(x, MID - amp); wfCtx.stroke();
    wfCtx.beginPath(); wfCtx.moveTo(x, MID); wfCtx.lineTo(x, MID + amp); wfCtx.stroke();
    wfCtx.fillStyle = col;
    wfCtx.beginPath(); wfCtx.arc(x, MID - amp, isSel ? 5 : 3.5, 0, Math.PI * 2); wfCtx.fill();

    if (isSel) {
      wfCtx.strokeStyle = 'rgba(255,255,255,.25)'; wfCtx.lineWidth = 1;
      wfCtx.beginPath(); wfCtx.arc(x, MID - amp, 9, 0, Math.PI * 2); wfCtx.stroke();
      wfCtx.fillStyle = '#E8E4DC'; wfCtx.font = 'bold 8px IBM Plex Mono,monospace';
      wfCtx.textAlign = 'center';
      wfCtx.fillText(Math.round(gain * 100) + '%', x, MID - amp - 13);
      wfCtx.textAlign = 'left';
    }
    wfCtx.globalAlpha = 1;
  });

  // Playhead
  if (S.videoDuration > 0) {
    const px = timeToX(video.currentTime);
    if (px >= 0 && px <= W) {
      wfCtx.strokeStyle = S.isRecording ? '#E8403A' : (S.isPreviewing ? '#3A9E6A' : '#7A7A7A');
      wfCtx.lineWidth = S.isRecording ? 2 : 1.5;
      wfCtx.globalAlpha = 0.85;
      wfCtx.beginPath(); wfCtx.moveTo(px, 0); wfCtx.lineTo(px, H); wfCtx.stroke();
      if (S.isRecording) {
        wfCtx.fillStyle = '#E8403A'; wfCtx.globalAlpha = 1;
        wfCtx.beginPath(); wfCtx.arc(px, 9, 5, 0, Math.PI * 2); wfCtx.fill();
      }
      wfCtx.globalAlpha = 1;
    }
  }
}

window.addEventListener('resize', () => { drawWaveform(); updateScrollbar(); positionTooltip(); });

// ── Canvas interaction ────────────────────────────────────────────────────
const HIT = 12;

function evtCoords(e) {
  const rect  = wfCanvas.getBoundingClientRect();
  const touch = e.touches ? e.touches[0] : e;
  return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
}

function nearestEvent(cx) {
  let best = null, bestD = HIT;
  S.events.forEach(ev => {
    const d = Math.abs(timeToX(ev.time) - cx);
    if (d < bestD) { bestD = d; best = ev; }
  });
  return best;
}

function onDown(e) {
  if (S.isRecording) return;
  if (e.button !== undefined && e.button !== 0) return;
  e.preventDefault();
  const { x, y } = evtCoords(e);
  const hit = nearestEvent(x);
  if (hit) {
    S.selectedEvId = hit.id;
    const H = wfCanvas.height, MID = H / 2;
    const amp = Math.max(5, (MID * 0.86) * Math.min(hit.gain ?? 1, 2) / 2);
    const nearPeak = Math.abs(y - (MID - amp)) < 14;
    S.drag = { evId: hit.id, mode: nearPeak ? 'gain' : 'move',
      startX: x, startY: y, startTime: hit.time, startGain: hit.gain ?? 1, moved: false };
    drawWaveform(); positionTooltip();
  } else {
    S.selectedEvId = null; S.drag = null; hideTooltip();
    if (S.videoDuration > 0 && !S.isPreviewing) {
      video.currentTime = Math.max(0, Math.min(S.videoDuration, xToTime(x)));
    }
    drawWaveform();
  }
}

function onMove(e) {
  if (!S.drag || S.isRecording) return;
  e.preventDefault();
  const { x, y } = evtCoords(e);
  const dx = x - S.drag.startX, dy = y - S.drag.startY;
  if (!S.drag.moved && Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
  S.drag.moved = true;
  const ev = S.events.find(e => e.id === S.drag.evId);
  if (!ev) return;
  if (S.drag.mode === 'move') {
    ev.time = Math.max(0, Math.min(S.videoDuration || 999,
      S.drag.startTime + (dx / (wfCanvas.offsetWidth || 1)) * visDur()));
    updateLogRow(ev);
  } else {
    ev.gain = Math.max(0, Math.min(2, S.drag.startGain - (dy / (wfCanvas.height / 2)) * 2));
    syncTooltipVol(ev);
    updateLogRow(ev);
  }
  drawWaveform(); positionTooltip();
}

function onUp() {
  if (S.drag?.moved) {
    S.events.sort((a, b) => a.time - b.time);
    rebuildLog(); drawWaveform(); positionTooltip();
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

// Pinch-to-zoom
wfCanvas.addEventListener('touchstart', e => {
  if (e.touches.length !== 2) return;
  e.preventDefault();
  const dx = e.touches[0].clientX - e.touches[1].clientX;
  const dy = e.touches[0].clientY - e.touches[1].clientY;
  S.pinch = { dist: Math.hypot(dx, dy), zoom: S.zoom };
}, { passive: false });
wfCanvas.addEventListener('touchmove', e => {
  if (e.touches.length !== 2 || !S.pinch) return;
  e.preventDefault();
  const dx = e.touches[0].clientX - e.touches[1].clientX;
  const dy = e.touches[0].clientY - e.touches[1].clientY;
  setZoom(S.pinch.zoom * (Math.hypot(dx, dy) / S.pinch.dist));
}, { passive: false });
wfCanvas.addEventListener('touchend', () => { S.pinch = null; });

// ── Tooltip ───────────────────────────────────────────────────────────────
function positionTooltip() {
  const ev = S.events.find(e => e.id === S.selectedEvId);
  if (!ev) { hideTooltip(); return; }
  const x   = timeToX(ev.time);
  const W   = wfCanvas.offsetWidth;
  const col = ev.color || '#D4870A';
  tooltipName.textContent = `${ev.label}  ${fmt(ev.time)}`;
  tooltipName.style.color = col;
  syncTooltipVol(ev);
  tooltip.classList.remove('hidden');
  const tw  = tooltip.offsetWidth;
  let left  = x - tw / 2;
  tooltip.style.left = Math.max(4, Math.min(W - tw - 4, left)) + 'px';
  tooltip.style.top  = (wfCanvas.offsetHeight + 4) + 'px';
}

function syncTooltipVol(ev) {
  const g = ev.gain ?? 1;
  tooltipVol.value = Math.round(g * 100);
  tooltipVolLbl.textContent = Math.round(g * 100) + '%';
}

function hideTooltip() { tooltip.classList.add('hidden'); S.selectedEvId = null; }

tooltipVol.addEventListener('input', () => {
  const ev = S.events.find(e => e.id === S.selectedEvId);
  if (!ev) return;
  ev.gain = parseFloat(tooltipVol.value) / 100;
  tooltipVolLbl.textContent = Math.round(ev.gain * 100) + '%';
  updateLogRow(ev); drawWaveform();
});
tooltipDelete.addEventListener('click', () => { if (S.selectedEvId) deleteEvent(S.selectedEvId); });
tooltipChange.addEventListener('click', () => { if (S.selectedEvId) openChangeModal(S.selectedEvId); });

function deleteEvent(id) {
  S.events = S.events.filter(e => e.id !== id);
  S.selectedEvId = null; hideTooltip();
  updateEventCount(); rebuildLog(); drawWaveform();
  btnPreview.disabled = S.events.length === 0;
  btnExport.disabled  = S.events.length === 0;
}

// ── Change modal ──────────────────────────────────────────────────────────
function openChangeModal(evId) {
  modalContent.innerHTML = '';
  const ev = S.events.find(e => e.id === evId);
  if (!ev) return;
  const info = document.createElement('p');
  info.style.cssText = 'font-size:11px;color:var(--sub);margin-bottom:10px;font-family:var(--mono)';
  info.textContent = 'Seleccioná nuevo calzado y superficies:';
  modalContent.appendChild(info);

  // Mini footwear picker
  const fwRow = document.createElement('div');
  fwRow.className = 'fw-grid'; fwRow.style.marginBottom = '10px';
  let tempFw = S.lib.footwear.find(f => f.id === ev.layers[0]?.fwId) || S.lib.footwear[0];
  S.lib.footwear.forEach(fw => {
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

  // Mini surface picker
  let tempSurfs = {};
  ev.layers.forEach(l => { tempSurfs[l.surface.id] = l.gainMult ?? 1; });
  const surfDiv = document.createElement('div');
  S.lib.surfaces.forEach(surf => {
    const row = document.createElement('div');
    row.className = 'surface-row';
    const cb = document.createElement('button');
    cb.className = 'surf-check' + (tempSurfs[surf.id] !== undefined ? ' selected' : '');
    cb.style.borderColor = tempSurfs[surf.id] !== undefined ? (surf.color || '') : '';
    cb.innerHTML = `<span class="surf-emoji">${surf.emoji}</span><span class="surf-name">${surf.label}</span>`;
    const fw = document.createElement('div');
    fw.className = 'surf-fader-wrap' + (tempSurfs[surf.id] !== undefined ? '' : ' hidden');
    fw.innerHTML = `<input type="range" class="surf-fader" min="0" max="200" step="1"
      value="${Math.round((tempSurfs[surf.id] ?? 1) * 100)}"/>
      <span class="surf-fader-val">${Math.round((tempSurfs[surf.id] ?? 1) * 100)}%</span>`;
    fw.querySelector('.surf-fader').addEventListener('input', e => {
      tempSurfs[surf.id] = parseInt(e.target.value) / 100;
      fw.querySelector('.surf-fader-val').textContent = e.target.value + '%';
    });
    cb.addEventListener('click', () => {
      if (tempSurfs[surf.id] !== undefined) { delete tempSurfs[surf.id]; cb.classList.remove('selected'); cb.style.borderColor=''; fw.classList.add('hidden'); }
      else { tempSurfs[surf.id] = 1; cb.classList.add('selected'); cb.style.borderColor = surf.color||''; fw.classList.remove('hidden'); }
    });
    row.appendChild(cb); row.appendChild(fw); surfDiv.appendChild(row);
  });
  modalContent.appendChild(surfDiv);

  const applyBtn = document.createElement('button');
  applyBtn.className = 'btn btn-amber btn-sm'; applyBtn.style.cssText = 'width:100%;margin-top:10px';
  applyBtn.textContent = 'Aplicar';
  applyBtn.addEventListener('click', () => {
    if (!Object.keys(tempSurfs).length) return;
    ev.layers = Object.entries(tempSurfs).map(([sid, gm]) => ({
      fwId: tempFw.id, surface: S.lib.surfaces.find(s => s.id === sid),
      gainMult: gm, rrIdx: 0,
    }));
    ev.label = `${tempFw.emoji} ${tempFw.label} · ${ev.layers.map(l => l.surface.label).join('+')}`;
    ev.color  = ev.layers[0]?.surface?.color || '#D4870A';
    closeModal(); drawWaveform(); positionTooltip(); rebuildLog();
  });
  modalContent.appendChild(applyBtn);
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
  const col = ev.color || '#D4870A';
  const g   = Math.round((ev.gain ?? 1) * 100);
  row.innerHTML = `
    <span class="log-name" style="color:${col}">${ev.label}</span>
    <span class="log-tc">${fmt(ev.time)}</span>
    <span class="log-vol">${g}%</span>`;
  return row;
}

function updateLogRow(ev) {
  const row = sessionLog.querySelector(`[data-ev-id="${ev.id}"]`);
  if (!row) return;
  const tc = row.querySelector('.log-tc'), vl = row.querySelector('.log-vol');
  if (tc) tc.textContent = fmt(ev.time);
  if (vl) vl.textContent = Math.round((ev.gain ?? 1) * 100) + '%';
}

function rebuildLog() {
  sessionLog.innerHTML = '';
  [...S.events].reverse().forEach(ev => sessionLog.appendChild(makeLogRow(ev)));
}
function clearLog() { sessionLog.innerHTML = ''; }

function updateEventCount() {
  const n = S.events.length;
  eventCount.textContent = `${n} evento${n !== 1 ? 's' : ''}`;
}

function updateHint() {
  if (S.isRecording) {
    hintName.textContent = S.selectedFw ? `${S.selectedFw.emoji} ${S.selectedFw.label}` : '—';
    hintBar.classList.remove('hidden');
  } else {
    hintBar.classList.add('hidden');
  }
}

// ── Init ──────────────────────────────────────────────────────────────────
loadLibrary();
updateZoomUI();
startRaf();
drawWaveform();
