/**
 * app.js — Foley Recorder v2
 *
 * Features:
 *  - Carga library.json y pre-cachea samples del servidor
 *  - Round-robin automático por categoría
 *  - Cambio de superficie durante grabación
 *  - Playback de previsualización (video + audio events)
 *  - Edición en timeline: drag para mover, tooltip para borrar/cambiar sample
 *  - Export WAV offline sin latencia
 *  - Responsive: desktop split / mobile stacked
 */

'use strict';

// ── State ─────────────────────────────────────────────────────────────────
const S = {
  library:        [],      // parsed library.json categories
  userCats:       [],      // user-added sample groups
  selectedCat:    null,    // { id, label, color, emoji, samples, isUser, userId }
  events:         [],      // [{ id, catId, label, color, sampleFiles, rrIdx, isUser, userId, time }]
  videoLoaded:    false,
  videoDuration:  0,
  isRecording:    false,
  isPreviewing:   false,
  selectedEventId:null,    // event being edited
  dragState:      null,    // { eventId, startX, startTime }
  previewSources: [],      // AudioBufferSourceNode[] during preview
  previewCtx:     null,    // AudioContext used for preview scheduling
};

let evIdSeq = 0;
const newEvId = () => 'ev_' + (++evIdSeq);

// ── DOM ───────────────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const video        = $('video-el');
const dropHint     = $('drop-hint');
const videoZone    = $('video-zone');
const wfCanvas     = $('waveform');
const wfCtx        = wfCanvas.getContext('2d');
const progressFill = $('progress-fill');
const timecodeEl   = $('timecode');
const recIndicator = $('rec-indicator');
const playIndicator= $('play-indicator');
const btnRecord    = $('btn-record');
const btnStop      = $('btn-stop');
const btnPreview   = $('btn-preview');
const btnExport    = $('btn-export');
const exportStatus = $('export-status');
const eventCount   = $('event-count');
const hintBar      = $('hint-bar');
const hintName     = $('hint-name');
const hintRr       = $('hint-rr');
const libraryGrid  = $('library-grid');
const libraryLoading=$('library-loading');
const sessionLog   = $('session-log');
const tooltip      = $('event-tooltip');
const tooltipName  = $('tooltip-name');
const tooltipChange= $('tooltip-change');
const tooltipDelete= $('tooltip-delete');
const modalOverlay = $('modal-overlay');
const modalGrid    = $('modal-grid');
const modalCancel  = $('modal-cancel');
const progressWrap = $('progress-wrap');

// ── Utils ─────────────────────────────────────────────────────────────────
const fmtTime = t => {
  const m = Math.floor(t/60).toString().padStart(2,'0');
  const s = (t%60).toFixed(2).padStart(5,'0');
  return `${m}:${s}`;
};

const CSS_COLORS = {
  wood:'#8B5E3C', parquet:'#A0724A', cemento:'#6B6B6B',
  grava:'#9B8B6A', metal:'#5A8A9F', custom:'#9B6FD4',
};
const resolveColor = c => CSS_COLORS[c] || c || '#D4870A';

// ── Library load ──────────────────────────────────────────────────────────
async function loadLibrary() {
  try {
    const res = await fetch('library.json');
    if (!res.ok) throw new Error('no library.json');
    const data = await res.json();
    S.library = data.categories || [];
  } catch(e) {
    console.warn('[app] library.json not found, using built-in only');
    S.library = [];
  }
  renderLibrary();
  libraryLoading.classList.add('hidden');

  // Pre-load all server samples in background
  S.library.forEach(cat => AudioEngine.preloadCategory(cat));
}

// ── Render library grid ───────────────────────────────────────────────────
function renderLibrary() {
  libraryGrid.innerHTML = '';

  const allCats = [
    ...S.library,
    ...S.userCats,
  ];

  // Built-in synth fallback categories if library is empty
  const synthCats = [
    { id:'madera',  label:'Madera',   emoji:'🪵', color:'#8B5E3C', samples:[], _synth:true },
    { id:'cemento', label:'Cemento',  emoji:'🏗️', color:'#6B6B6B', samples:[], _synth:true },
    { id:'grava',   label:'Grava',    emoji:'🪨', color:'#9B8B6A', samples:[], _synth:true },
    { id:'metal',   label:'Metal',    emoji:'⚙️', color:'#5A8A9F', samples:[], _synth:true },
  ];
  const display = allCats.length ? allCats : synthCats;

  display.forEach(cat => {
    const card = makeCatCard(cat);
    libraryGrid.appendChild(card);
  });
}

function makeCatCard(cat) {
  const isSelected = S.selectedCat && S.selectedCat.id === cat.id;
  const total      = cat.samples ? cat.samples.length : 0;
  const nextIdx    = AudioEngine.getRrIdx(cat.id, total);

  const card = document.createElement('div');
  card.className = 'cat-card';
  card.dataset.catId = cat.id;

  // Header (non-clickable on mobile since we always show trigger)
  const hdr = document.createElement('div');
  hdr.className = 'cat-card-header';
  hdr.innerHTML = `
    <span class="cat-dot" style="background:${cat.color}"></span>
    <span class="cat-label-text">${cat.emoji} ${cat.label}</span>
    ${total > 1 ? `<span class="cat-rr-badge">${total} vars</span>` : ''}
    ${isSelected ? `<span class="cat-selected-badge" style="background:${cat.color}"></span>` : ''}
  `;

  // Big trigger button
  const trigger = document.createElement('button');
  trigger.className = 'cat-trigger' + (isSelected ? ' selected' : '');
  trigger.dataset.catId = cat.id;

  const nextLabel = total > 1
    ? `${cat.samples[nextIdx % total].label}`
    : total === 1
      ? cat.samples[0].label
      : '(síntesis)';

  trigger.innerHTML = `
    <span style="font-size:18px">${cat.emoji}</span>
    <span style="flex:1">${cat.label}</span>
    <span style="font-family:var(--mono);font-size:9px;color:var(--sub)">${nextLabel}</span>
  `;
  trigger.addEventListener('click',      () => triggerCategory(cat));
  trigger.addEventListener('touchstart', (e) => { e.preventDefault(); triggerCategory(cat); },
    { passive:false });

  card.appendChild(hdr);
  card.appendChild(trigger);
  return card;
}

function refreshLibraryUI() {
  // Just update selected states and rr labels without full re-render
  document.querySelectorAll('.cat-trigger').forEach(btn => {
    const catId = btn.dataset.catId;
    const isSelected = S.selectedCat && S.selectedCat.id === catId;
    btn.classList.toggle('selected', isSelected);
  });
}

function flashCatCard(catId) {
  const btn = libraryGrid.querySelector(`.cat-trigger[data-cat-id="${catId}"]`);
  if (!btn) return;
  btn.classList.add('flash');
  setTimeout(() => btn.classList.remove('flash'), 110);
}

// ── Trigger a category ────────────────────────────────────────────────────
function triggerCategory(cat) {
  AudioEngine.getCtx();

  const { rrIdx } = AudioEngine.playSample(
    cat.id,
    cat.samples || [],
    cat.isUser || false,
    cat.userId  || null
  );

  flashCatCard(cat.id);
  S.selectedCat = cat;
  refreshLibraryUI();
  updateHint();

  // Record event if recording
  if (S.isRecording && video) {
    const ev = {
      id:          newEvId(),
      catId:       cat.id,
      label:       cat.label,
      color:       cat.color,
      sampleFiles: cat.samples || [],
      rrIdx,
      isUser:      cat.isUser || false,
      userId:      cat.userId || null,
      time:        video.currentTime,
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
  const url = URL.createObjectURL(file);
  video.src = url;
  video.style.display = 'block';
  dropHint.style.display = 'none';

  video.onloadedmetadata = () => {
    S.videoLoaded   = true;
    S.videoDuration = video.duration;
    S.events        = [];
    btnRecord.disabled  = false;
    btnPreview.disabled = true;
    btnExport.disabled  = true;
    updateEventCount();
    drawWaveform();
    hideTooltip();
  };
  video.onended = () => {
    if (S.isRecording)  stopRecording();
    if (S.isPreviewing) stopPreview();
  };
}

$('video-file-input').addEventListener('change',  e => loadVideo(e.target.files[0]));
$('video-file-input-2').addEventListener('change', e => loadVideo(e.target.files[0]));
videoZone.addEventListener('dragover',  e => { e.preventDefault(); videoZone.classList.add('drag-over'); });
videoZone.addEventListener('dragleave', ()  => videoZone.classList.remove('drag-over'));
videoZone.addEventListener('drop',      e  => { e.preventDefault(); loadVideo(e.dataTransfer.files[0]); });

// ── Custom samples ────────────────────────────────────────────────────────
$('custom-sample-input').addEventListener('change', async e => {
  const files = Array.from(e.target.files);
  for (const file of files) {
    try {
      const { id, name } = await AudioEngine.loadUserSample(file);
      // Group all uploaded files under a single "Mis Samples" category
      // Each file becomes its own category so round-robin works per-surface
      const cat = {
        id:       id,
        label:    name,
        emoji:    '🎵',
        color:    '#9B6FD4',
        samples:  [{ file: null, label: name }],
        isUser:   true,
        userId:   id,
      };
      S.userCats.push(cat);
    } catch(err) {
      console.error('[app] Error loading user sample:', err);
    }
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

  S.events      = [];
  S.isRecording = true;

  video.currentTime = 0;
  video.play();

  btnRecord.style.display = 'none';
  btnStop.style.display   = 'inline-block';
  btnStop.disabled        = false;
  btnPreview.disabled     = true;
  btnExport.disabled      = true;
  recIndicator.classList.remove('hidden');
  updateEventCount();
  clearLog();
  hideTooltip();
  drawWaveform();
  startRaf();
}

function stopRecording() {
  if (!S.isRecording) return;
  S.isRecording = false;
  video.pause();

  btnStop.style.display   = 'none';
  btnRecord.style.display = 'inline-block';
  btnRecord.disabled      = false;
  recIndicator.classList.add('hidden');
  hintBar.classList.add('hidden');
  btnPreview.disabled = S.events.length === 0;
  btnExport.disabled  = S.events.length === 0;
}

// ── Preview (play video + audio events) ──────────────────────────────────
btnPreview.addEventListener('click', () => {
  if (S.isPreviewing) stopPreview();
  else startPreview();
});

async function startPreview() {
  if (!S.events.length || !S.videoLoaded) return;
  S.isPreviewing = true;

  // Stop any stale playback
  S.previewSources.forEach(s => { try { s.stop(); } catch(_){} });
  S.previewSources = [];

  const ctx   = AudioEngine.getCtx();
  const now   = ctx.currentTime;
  const start = now + 0.05; // tiny scheduling buffer

  // Schedule all events relative to video start
  S.events.forEach(ev => {
    const when = start + ev.time;
    if (ev.isUser) {
      // routed through audio engine's internal buffer
      AudioEngine.playSample(ev.catId, ev.sampleFiles, true, ev.userId);
    } else {
      const fileEntry = (ev.sampleFiles || [])[ev.rrIdx % Math.max(1,(ev.sampleFiles||[]).length)];
      // We can't easily call playSample with custom `when` from engine,
      // so we schedule directly via the ctx we already have
      _scheduleBuffer(ctx, ev, when);
    }
  });

  video.currentTime = 0;
  await video.play();

  btnPreview.textContent = '■ DETENER';
  playIndicator.classList.remove('hidden');
  startRaf();
}

function _scheduleBuffer(ctx, ev, when) {
  // Use the same rrIdx stored at record time
  const files = ev.sampleFiles || [];
  if (!files.length) {
    // synth fallback — no way to schedule procedural synth precisely here;
    // just play immediately for preview (slight timing offset acceptable)
    return;
  }
  const fileEntry = files[ev.rrIdx % files.length];
  // AudioEngine exposes internal buffers indirectly via renderToWav;
  // for preview we replay via a short OfflineAudioContext trick — but
  // the simplest approach: call AudioEngine.playSample with the known rrIdx.
  // Since we can't set `when` externally, we use setTimeout as best-effort preview.
  const delay = Math.max(0, (when - ctx.currentTime) * 1000);
  setTimeout(() => {
    if (!S.isPreviewing) return;
    AudioEngine.playSample(ev.catId, ev.sampleFiles, ev.isUser, ev.userId);
  }, delay);
}

function stopPreview() {
  S.isPreviewing = false;
  video.pause();
  S.previewSources.forEach(s => { try { s.stop(); } catch(_){} });
  S.previewSources = [];
  btnPreview.textContent = '▶ ESCUCHAR';
  playIndicator.classList.add('hidden');
}

video.addEventListener('ended', stopPreview);

// ── Export WAV ────────────────────────────────────────────────────────────
btnExport.addEventListener('click', async () => {
  if (!S.events.length) return;
  btnExport.disabled = true;
  setStatus('Renderizando offline…');
  try {
    const blob = await AudioEngine.renderToWav(S.events, S.videoDuration);
    const url  = URL.createObjectURL(blob);
    const name = (video.src ? decodeURIComponent(video.src.split('/').pop()).replace(/\.[^.]+$/,'') : 'sesion');
    const a = document.createElement('a');
    a.href = url; a.download = `foley_${name}_${Date.now()}.wav`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setStatus('✓ WAV descargado', 4000);
  } catch(err) {
    setStatus('Error: ' + err.message, 4000);
  } finally {
    btnExport.disabled = false;
  }
});

function setStatus(msg, clear=0) {
  exportStatus.textContent = msg;
  if (clear) setTimeout(() => exportStatus.textContent='', clear);
}

// ── RAF loop ──────────────────────────────────────────────────────────────
let _rafId = null;
function startRaf() {
  cancelAnimationFrame(_rafId);
  function tick() {
    const t = video.currentTime;
    const d = S.videoDuration || 1;
    timecodeEl.textContent    = fmtTime(t);
    progressFill.style.width  = `${(t/d)*100}%`;
    if (S.isRecording || S.isPreviewing) drawWaveform();
    _rafId = requestAnimationFrame(tick);
  }
  _rafId = requestAnimationFrame(tick);
}
video.addEventListener('timeupdate', () => {
  if (!S.isRecording && !S.isPreviewing) {
    timecodeEl.textContent   = fmtTime(video.currentTime);
    progressFill.style.width = `${(video.currentTime/(S.videoDuration||1))*100}%`;
  }
});

// Seek on progress bar click
progressWrap.addEventListener('click', e => {
  if (S.isRecording) return;
  const r = (e.clientX - progressWrap.getBoundingClientRect().left) / progressWrap.offsetWidth;
  video.currentTime = r * S.videoDuration;
  drawWaveform();
});

// ── Keyboard ──────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.code === 'Space' && S.selectedCat && S.isRecording) {
    e.preventDefault();
    triggerCategory(S.selectedCat);
  }
  if (e.code === 'Escape') {
    hideTooltip();
    closeModal();
  }
  if ((e.code === 'Delete' || e.code === 'Backspace') && S.selectedEventId && !S.isRecording) {
    e.preventDefault();
    deleteEvent(S.selectedEventId);
  }
});

// ── Waveform ──────────────────────────────────────────────────────────────
function drawWaveform() {
  const W  = wfCanvas.offsetWidth;
  const H  = wfCanvas.offsetHeight || 68;
  wfCanvas.width  = W;
  wfCanvas.height = H;

  wfCtx.clearRect(0,0,W,H);
  wfCtx.fillStyle = '#0D0D0F';
  wfCtx.fillRect(0,0,W,H);

  // Grid
  wfCtx.strokeStyle = '#1E1E22'; wfCtx.lineWidth = 1;
  for (let i=1;i<10;i++) {
    const x=(i/10)*W;
    wfCtx.beginPath();wfCtx.moveTo(x,0);wfCtx.lineTo(x,H);wfCtx.stroke();
  }
  wfCtx.beginPath();wfCtx.moveTo(0,H/2);wfCtx.lineTo(W,H/2);wfCtx.stroke();

  // Events
  const dur = S.videoDuration || 1;
  S.events.forEach(ev => {
    const x   = (ev.time/dur)*W;
    const mid = H/2;
    const amp = H*.38;
    const col = resolveColor(ev.color);
    const isSel = ev.id === S.selectedEventId;

    wfCtx.globalAlpha = isSel ? 1 : 0.8;
    wfCtx.strokeStyle = col;
    wfCtx.lineWidth   = isSel ? 3 : 2;
    wfCtx.beginPath(); wfCtx.moveTo(x,mid); wfCtx.lineTo(x,mid-amp); wfCtx.stroke();
    wfCtx.beginPath(); wfCtx.moveTo(x,mid); wfCtx.lineTo(x,mid+amp); wfCtx.stroke();

    // Peak dot
    wfCtx.fillStyle = col;
    wfCtx.beginPath(); wfCtx.arc(x, mid-amp, isSel?4:3, 0, Math.PI*2); wfCtx.fill();

    // Selection ring
    if (isSel) {
      wfCtx.strokeStyle = '#fff';
      wfCtx.lineWidth   = 1;
      wfCtx.globalAlpha = 0.4;
      wfCtx.beginPath(); wfCtx.arc(x, mid-amp, 7, 0, Math.PI*2); wfCtx.stroke();
    }
    wfCtx.globalAlpha = 1;
  });

  // Playhead
  if (S.videoDuration > 0) {
    const px = (video.currentTime / dur) * W;
    wfCtx.strokeStyle = S.isRecording ? '#E8403A' : (S.isPreviewing ? '#3A9E6A' : '#E8E4DC');
    wfCtx.lineWidth   = S.isRecording ? 2 : 1.5;
    wfCtx.globalAlpha = 0.85;
    wfCtx.beginPath(); wfCtx.moveTo(px,0); wfCtx.lineTo(px,H); wfCtx.stroke();
    wfCtx.globalAlpha = 1;

    if (S.isRecording) {
      wfCtx.fillStyle = '#E8403A';
      wfCtx.beginPath(); wfCtx.arc(px, 9, 5, 0, Math.PI*2); wfCtx.fill();
    }
  }
}

window.addEventListener('resize', () => { drawWaveform(); positionTooltip(); });

// ── Timeline interaction (click, drag) ───────────────────────────────────
const HIT_RADIUS = 10; // px

function getCanvasX(e) {
  const rect = wfCanvas.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  return clientX - rect.left;
}

function findEventNear(cx) {
  const W = wfCanvas.offsetWidth;
  const dur = S.videoDuration || 1;
  let best = null, bestDist = HIT_RADIUS;
  S.events.forEach(ev => {
    const ex = (ev.time / dur) * W;
    const d  = Math.abs(cx - ex);
    if (d < bestDist) { bestDist = d; best = ev; }
  });
  return best;
}

// Pointer down: select or start drag
function onWfPointerDown(e) {
  if (S.isRecording) return;
  if (e.button !== undefined && e.button !== 0) return;
  e.preventDefault();

  const cx  = getCanvasX(e);
  const hit = findEventNear(cx);

  if (hit) {
    S.selectedEventId = hit.id;
    S.dragState = {
      eventId:   hit.id,
      startX:    cx,
      startTime: hit.time,
      moved:     false,
    };
    drawWaveform();
    positionTooltip();
  } else {
    // Click on empty area: deselect
    S.selectedEventId = null;
    S.dragState = null;
    hideTooltip();
    drawWaveform();

    // Also seek video
    const W = wfCanvas.offsetWidth;
    if (S.videoDuration > 0 && !S.isPreviewing) {
      video.currentTime = (cx / W) * S.videoDuration;
    }
  }
}

function onWfPointerMove(e) {
  if (!S.dragState || S.isRecording) return;
  e.preventDefault();
  const cx = getCanvasX(e);
  const dx = cx - S.dragState.startX;
  if (Math.abs(dx) < 2 && !S.dragState.moved) return;

  S.dragState.moved = true;
  const W    = wfCanvas.offsetWidth;
  const dur  = S.videoDuration || 1;
  const dt   = (dx / W) * dur;
  const newT = Math.max(0, Math.min(dur, S.dragState.startTime + dt));

  const ev = S.events.find(e => e.id === S.dragState.eventId);
  if (ev) {
    ev.time = newT;
    drawWaveform();
    positionTooltip();
    updateLogRow(ev);
  }
}

function onWfPointerUp(e) {
  if (S.dragState && S.dragState.moved) {
    S.dragState = null;
    // Re-sort events by time
    S.events.sort((a,b) => a.time - b.time);
    rebuildLog();
    drawWaveform();
    positionTooltip();
  } else {
    S.dragState = null;
  }
}

// Mouse events
wfCanvas.addEventListener('mousedown',  onWfPointerDown);
wfCanvas.addEventListener('mousemove',  onWfPointerMove);
wfCanvas.addEventListener('mouseup',    onWfPointerUp);
wfCanvas.addEventListener('mouseleave', onWfPointerUp);

// Touch events
wfCanvas.addEventListener('touchstart', onWfPointerDown, { passive:false });
wfCanvas.addEventListener('touchmove',  onWfPointerMove, { passive:false });
wfCanvas.addEventListener('touchend',   onWfPointerUp,   { passive:false });

// ── Tooltip ───────────────────────────────────────────────────────────────
function positionTooltip() {
  const ev = S.events.find(e => e.id === S.selectedEventId);
  if (!ev) { hideTooltip(); return; }

  const W   = wfCanvas.offsetWidth;
  const dur = S.videoDuration || 1;
  const x   = (ev.time / dur) * W;
  const col = resolveColor(ev.color);

  tooltipName.textContent = `${ev.label}  ${fmtTime(ev.time)}`;
  tooltipName.style.color = col;
  tooltip.classList.remove('hidden');

  // Position: centered above impulse
  const tw = tooltip.offsetWidth;
  let left = x - tw/2;
  left = Math.max(4, Math.min(W - tw - 4, left));
  tooltip.style.left = left + 'px';
}

function hideTooltip() {
  tooltip.classList.add('hidden');
  S.selectedEventId = null;
}

tooltipDelete.addEventListener('click', () => {
  if (S.selectedEventId) deleteEvent(S.selectedEventId);
});

tooltipChange.addEventListener('click', () => {
  if (S.selectedEventId) openChangeModal(S.selectedEventId);
});

function deleteEvent(id) {
  S.events = S.events.filter(e => e.id !== id);
  S.selectedEventId = null;
  hideTooltip();
  updateEventCount();
  rebuildLog();
  drawWaveform();
  btnPreview.disabled = S.events.length === 0;
  btnExport.disabled  = S.events.length === 0;
}

// ── Change sample modal ───────────────────────────────────────────────────
function openChangeModal(eventId) {
  modalGrid.innerHTML = '';
  const allCats = [...S.library, ...S.userCats];
  if (!allCats.length) {
    closeModal(); return;
  }
  allCats.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'modal-cat-btn';
    btn.innerHTML = `<span style="font-size:18px">${cat.emoji}</span><span>${cat.label}</span>`;
    btn.addEventListener('click', () => {
      const ev = S.events.find(e => e.id === eventId);
      if (ev) {
        // Pick next rr for the new category
        const { rrIdx } = AudioEngine.playSample(cat.id, cat.samples||[], cat.isUser||false, cat.userId||null);
        ev.catId       = cat.id;
        ev.label       = cat.label;
        ev.color       = cat.color;
        ev.sampleFiles = cat.samples || [];
        ev.rrIdx       = rrIdx;
        ev.isUser      = cat.isUser || false;
        ev.userId      = cat.userId || null;
      }
      closeModal();
      drawWaveform();
      positionTooltip();
      rebuildLog();
    });
    modalGrid.appendChild(btn);
  });
  modalOverlay.classList.remove('hidden');
}

function closeModal() { modalOverlay.classList.add('hidden'); }
modalCancel.addEventListener('click',  closeModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });

// ── Session log ───────────────────────────────────────────────────────────
function addLogRow(ev) {
  const row = makeLogRow(ev);
  sessionLog.insertBefore(row, sessionLog.firstChild);
}

function makeLogRow(ev) {
  const row = document.createElement('div');
  row.className = 'log-row';
  row.dataset.evId = ev.id;
  const col = resolveColor(ev.color);
  row.innerHTML = `
    <span class="log-name" style="color:${col}">${ev.label}</span>
    <span class="log-tc">${fmtTime(ev.time)}</span>
  `;
  return row;
}

function updateLogRow(ev) {
  const row = sessionLog.querySelector(`[data-ev-id="${ev.id}"]`);
  if (!row) return;
  row.querySelector('.log-tc').textContent = fmtTime(ev.time);
}

function rebuildLog() {
  sessionLog.innerHTML = '';
  // Show newest first (highest time first after sort)
  [...S.events].reverse().forEach(ev => {
    sessionLog.appendChild(makeLogRow(ev));
  });
}

function clearLog() { sessionLog.innerHTML = ''; }

// ── Hint bar ──────────────────────────────────────────────────────────────
function updateHint() {
  if (S.isRecording && S.selectedCat) {
    const total = S.selectedCat.samples ? S.selectedCat.samples.length : 0;
    const next  = AudioEngine.getRrIdx(S.selectedCat.id, total);
    hintName.textContent = S.selectedCat.label;
    hintRr.textContent   = total > 1 ? `→ var ${next+1}/${total}` : '';
    hintBar.classList.remove('hidden');
  } else {
    hintBar.classList.add('hidden');
  }
}

function updateEventCount() {
  const n = S.events.length;
  eventCount.textContent = `${n} evento${n!==1?'s':''}`;
}

// ── Init ──────────────────────────────────────────────────────────────────
loadLibrary();
startRaf();
drawWaveform();
