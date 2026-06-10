/**
 * app.js — Foley Recorder · UI & Orquestación
 *
 * Flujo principal:
 *  1. Usuario carga video
 *  2. Selecciona sample de la biblioteca
 *  3. Presiona GRABAR → video reproduce desde 00:00
 *  4. Hace click / espacio en samples → se registran eventos (sampleId + videoTime)
 *     El audio se reproduce en tiempo real (preview), pero NO se graba en stream.
 *  5. Presiona DETENER (o el video termina)
 *  6. Presiona EXPORTAR WAV → OfflineAudioContext renderiza todos los eventos
 *     perfectamente sincronizados → descarga .wav sin latencia
 */

'use strict';

// ── Biblioteca de samples ────────────────────────────────────────────────
const LIBRARY = [
  {
    category: 'Madera',
    cssColor: 'var(--wood)',
    samples: [
      { id: 'w1', name: 'Tablón seco',    emoji: '🪵' },
      { id: 'w2', name: 'Parquet viejo',  emoji: '🪵' },
      { id: 'w3', name: 'Escalera',       emoji: '🪵' },
    ],
  },
  {
    category: 'Cemento',
    cssColor: 'var(--cement)',
    samples: [
      { id: 'c1', name: 'Interior liso',    emoji: '🏗️' },
      { id: 'c2', name: 'Exterior rugoso',  emoji: '🏗️' },
    ],
  },
  {
    category: 'Grava',
    cssColor: 'var(--gravel)',
    samples: [
      { id: 'g1', name: 'Grava fina', emoji: '🪨' },
      { id: 'g2', name: 'Cascajo',    emoji: '🪨' },
    ],
  },
  {
    category: 'Metal',
    cssColor: 'var(--metal)',
    samples: [
      { id: 'm1', name: 'Chapa',             emoji: '⚙️' },
      { id: 'm2', name: 'Escalera metálica', emoji: '⚙️' },
    ],
  },
];

// ── Estado ───────────────────────────────────────────────────────────────
const state = {
  videoLoaded:     false,
  isRecording:     false,
  selectedSample:  null,    // { id, name, cssColor, isUser }
  events:          [],      // [{ sampleId, isUser, time, name, cssColor }]
  userSamples:     [],      // [{ id, name, isUser:true, cssColor }]
  videoDuration:   0,
  rafId:           null,
};

// ── DOM refs ─────────────────────────────────────────────────────────────
const $  = (sel) => document.querySelector(sel);
const video       = $('#video-el');
const dropHint    = $('#drop-hint');
const videoZone   = $('#video-zone');
const waveformEl  = $('#waveform');
const progressFill= $('#progress-bar-fill');
const timecodeEl  = $('#timecode');
const recIndicator= $('#rec-indicator');
const btnRecord   = $('#btn-record');
const btnStop     = $('#btn-stop');
const btnExport   = $('#btn-export');
const exportStatus= $('#export-status');
const eventCount  = $('#event-count');
const hintBar     = $('#hint-bar');
const hintSample  = $('#hint-sample-name');
const libraryScroll = $('#library-scroll');
const sessionLog  = $('#session-log');
const videoInput  = $('#video-file-input');
const customInput = $('#custom-sample-input');

// Waveform canvas context
const wCtx = waveformEl.getContext('2d');

// ── Formateo timecode ─────────────────────────────────────────────────────
function fmtTime(t) {
  const m = Math.floor(t / 60).toString().padStart(2, '0');
  const s = (t % 60).toFixed(2).padStart(5, '0');
  return `${m}:${s}`;
}

// ── Video load ────────────────────────────────────────────────────────────
function loadVideo(file) {
  if (!file || !file.type.startsWith('video/')) return;
  const url = URL.createObjectURL(file);
  video.src = url;
  video.style.display = 'block';
  dropHint.style.display = 'none';
  videoZone.classList.remove('drag-over');

  video.onloadedmetadata = () => {
    state.videoLoaded    = true;
    state.videoDuration  = video.duration;
    state.events         = [];
    btnRecord.disabled   = false;
    btnExport.disabled   = true;
    updateEventCount();
    drawWaveform();
  };
  video.onended = stopRecording;
}

videoInput.addEventListener('change', (e) => loadVideo(e.target.files[0]));

videoZone.addEventListener('dragover',  (e) => { e.preventDefault(); videoZone.classList.add('drag-over'); });
videoZone.addEventListener('dragleave', ()  => videoZone.classList.remove('drag-over'));
videoZone.addEventListener('drop',      (e) => { e.preventDefault(); loadVideo(e.dataTransfer.files[0]); });

// Click on zone to pick file (when no video loaded)
videoZone.addEventListener('click', (e) => {
  if (!state.videoLoaded && e.target === videoZone) videoInput.click();
});

// ── Custom sample load ────────────────────────────────────────────────────
customInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const { id, name } = await AudioEngine.loadUserSample(file);
    const sample = { id, name, isUser: true, cssColor: 'var(--custom)', emoji: '🎵' };
    state.userSamples.push(sample);
    renderUserCategory();
  } catch (err) {
    console.error('Error cargando sample:', err);
    showExportStatus('Error al cargar el audio', 3000);
  }
  e.target.value = '';
});

// ── Library render ────────────────────────────────────────────────────────
function renderLibrary() {
  libraryScroll.innerHTML = '';
  LIBRARY.forEach(cat => renderCategory(cat.category, cat.cssColor, cat.samples, false));
  renderUserCategory();
}

function renderUserCategory() {
  // Remove old user category if exists
  const old = libraryScroll.querySelector('.cat-user');
  if (old) old.remove();

  if (!state.userSamples.length) return;

  const wrap = document.createElement('div');
  wrap.className = 'cat-user';
  wrap.style.marginBottom = '16px';

  const label = document.createElement('div');
  label.className = 'cat-label';
  label.innerHTML = `<span class="cat-dot" style="background:var(--custom)"></span>Mis Samples`;
  wrap.appendChild(label);

  state.userSamples.forEach(s => {
    wrap.appendChild(makeSampleBtn(s, true));
  });
  libraryScroll.appendChild(wrap);
}

function renderCategory(catName, cssColor, samples, isUser) {
  const wrap = document.createElement('div');
  wrap.style.marginBottom = '16px';

  const label = document.createElement('div');
  label.className = 'cat-label';
  label.innerHTML = `<span class="cat-dot" style="background:${cssColor}"></span>${catName}`;
  wrap.appendChild(label);

  samples.forEach(s => {
    const full = { ...s, cssColor, isUser };
    wrap.appendChild(makeSampleBtn(full, isUser));
  });
  libraryScroll.appendChild(wrap);
}

function makeSampleBtn(sample, isUser) {
  const btn = document.createElement('button');
  btn.className = 'sample-btn';
  btn.dataset.id = sample.id;
  btn.innerHTML = `
    <span class="sample-emoji">${sample.emoji || '🎵'}</span>
    <span class="sample-name">${sample.name}</span>
    <span class="sample-sel-dot" style="background:${sample.cssColor};display:none"></span>
  `;
  btn.addEventListener('click', () => triggerSample(sample));
  return btn;
}

function selectSampleUI(sample) {
  // Deselect all
  document.querySelectorAll('.sample-btn').forEach(b => {
    b.classList.remove('selected');
    b.querySelector('.sample-sel-dot').style.display = 'none';
  });
  // Select new
  const btn = libraryScroll.querySelector(`[data-id="${sample.id}"]`);
  if (btn) {
    btn.classList.add('selected');
    btn.querySelector('.sample-sel-dot').style.display = 'block';
  }
}

function flashSampleBtn(id) {
  const btn = libraryScroll.querySelector(`[data-id="${id}"]`);
  if (!btn) return;
  btn.classList.add('flash');
  setTimeout(() => btn.classList.remove('flash'), 110);
}

// ── Sample trigger ────────────────────────────────────────────────────────
function triggerSample(sample) {
  // Always wake AudioContext
  AudioEngine.getCtx();

  // Play preview (real-time, no latency concern — this is just monitoring)
  AudioEngine.playSample(sample.id, sample.isUser);
  flashSampleBtn(sample.id);

  // Select
  state.selectedSample = sample;
  selectSampleUI(sample);
  updateHint();

  // Record event (only if recording)
  if (state.isRecording && video) {
    state.events.push({
      sampleId:  sample.id,
      isUser:    sample.isUser || false,
      time:      video.currentTime,
      name:      sample.name,
      cssColor:  sample.cssColor,
    });
    updateEventCount();
    addLogRow(sample, video.currentTime);
    drawWaveform();
  }
}

// ── Keyboard shortcut: Space = selected sample ───────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && state.selectedSample && state.isRecording) {
    e.preventDefault();
    triggerSample(state.selectedSample);
  }
});

// ── Record ────────────────────────────────────────────────────────────────
btnRecord.addEventListener('click', startRecording);
btnStop.addEventListener('click',   stopRecording);

function startRecording() {
  if (!state.videoLoaded) return;
  AudioEngine.getCtx();  // unlock on user gesture

  state.events    = [];
  state.isRecording = true;

  video.currentTime = 0;
  video.play();

  // UI state
  btnRecord.style.display = 'none';
  btnStop.style.display   = 'inline-block';
  btnStop.disabled        = false;
  btnExport.disabled      = true;
  recIndicator.classList.remove('hidden');
  updateEventCount();
  updateHint();
  clearLog();
  drawWaveform();

  startRaf();
}

function stopRecording() {
  if (!state.isRecording) return;
  state.isRecording = false;

  video.pause();

  btnStop.style.display   = 'none';
  btnRecord.style.display = 'inline-block';
  btnRecord.disabled      = false;
  recIndicator.classList.add('hidden');
  btnExport.disabled      = (state.events.length === 0);
  hintBar.classList.add('hidden');
}

// ── Export WAV (offline render) ───────────────────────────────────────────
btnExport.addEventListener('click', async () => {
  if (!state.events.length) return;

  btnExport.disabled = true;
  showExportStatus('Renderizando offline…');

  try {
    const wavBlob = await AudioEngine.renderToWav(
      state.events,
      state.videoDuration,
      44100
    );
    const url  = URL.createObjectURL(wavBlob);
    const name = (video.src
      ? decodeURIComponent(video.src.split('/').pop()).replace(/\.[^.]+$/, '')
      : 'sesion');
    const a = document.createElement('a');
    a.href     = url;
    a.download = `foley_${name}_${Date.now()}.wav`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showExportStatus('✓ WAV descargado', 4000);
  } catch (err) {
    console.error(err);
    showExportStatus('Error en el render: ' + err.message, 4000);
  } finally {
    btnExport.disabled = false;
  }
});

function showExportStatus(msg, clearAfter = 0) {
  exportStatus.textContent = msg;
  if (clearAfter) setTimeout(() => { exportStatus.textContent = ''; }, clearAfter);
}

// ── RAF loop: timecode + progress ─────────────────────────────────────────
function startRaf() {
  cancelAnimationFrame(state.rafId);
  function tick() {
    if (!video) return;
    const t  = video.currentTime;
    const d  = state.videoDuration || 1;
    timecodeEl.textContent = fmtTime(t);
    progressFill.style.width = `${(t / d) * 100}%`;
    if (state.isRecording) {
      drawWaveform();
    }
    state.rafId = requestAnimationFrame(tick);
  }
  state.rafId = requestAnimationFrame(tick);
}

// Also keep timecode updated when not recording
video.addEventListener('timeupdate', () => {
  if (!state.isRecording) {
    timecodeEl.textContent = fmtTime(video.currentTime);
    progressFill.style.width = `${(video.currentTime / (state.videoDuration || 1)) * 100}%`;
  }
});

// ── Click on progress bar to seek ────────────────────────────────────────
$('#progress-bar-wrap').addEventListener('click', (e) => {
  if (state.isRecording) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const ratio = (e.clientX - rect.left) / rect.width;
  video.currentTime = ratio * state.videoDuration;
  drawWaveform();
});

// ── Waveform canvas ────────────────────────────────────────────────────────
function drawWaveform() {
  const W = waveformEl.offsetWidth;
  const H = waveformEl.height;
  waveformEl.width = W;  // re-scale to actual pixel width

  wCtx.clearRect(0, 0, W, H);

  // Background
  wCtx.fillStyle = '#0D0D0F';
  wCtx.fillRect(0, 0, W, H);

  // Grid
  wCtx.strokeStyle = '#1E1E22';
  wCtx.lineWidth   = 1;
  for (let i = 1; i < 10; i++) {
    const x = (i / 10) * W;
    wCtx.beginPath(); wCtx.moveTo(x, 0); wCtx.lineTo(x, H); wCtx.stroke();
  }
  wCtx.beginPath(); wCtx.moveTo(0, H/2); wCtx.lineTo(W, H/2); wCtx.stroke();

  // Events
  const dur = state.videoDuration || 1;
  state.events.forEach(ev => {
    const x   = (ev.time / dur) * W;
    const mid = H / 2;
    const amp = H * 0.38;

    // Resolve CSS var to real color
    const col = resolveCssColor(ev.cssColor);

    wCtx.strokeStyle = col;
    wCtx.lineWidth   = 2;
    wCtx.globalAlpha = 0.85;
    wCtx.beginPath(); wCtx.moveTo(x, mid);   wCtx.lineTo(x, mid - amp); wCtx.stroke();
    wCtx.beginPath(); wCtx.moveTo(x, mid);   wCtx.lineTo(x, mid + amp); wCtx.stroke();
    wCtx.fillStyle = col;
    wCtx.beginPath(); wCtx.arc(x, mid - amp, 3, 0, Math.PI * 2); wCtx.fill();
    wCtx.globalAlpha = 1;
  });

  // Playhead
  if (state.videoDuration > 0) {
    const px = (video.currentTime / dur) * W;
    wCtx.strokeStyle = state.isRecording ? '#E8403A' : '#E8E4DC';
    wCtx.lineWidth   = state.isRecording ? 2 : 1.5;
    wCtx.globalAlpha = 0.9;
    wCtx.beginPath(); wCtx.moveTo(px, 0); wCtx.lineTo(px, H); wCtx.stroke();
    wCtx.globalAlpha = 1;

    if (state.isRecording) {
      wCtx.fillStyle = '#E8403A';
      wCtx.beginPath(); wCtx.arc(px, 10, 5, 0, Math.PI * 2); wCtx.fill();
    }
  }
}

// Resolve CSS custom property to hex (needed for canvas)
const CSS_COLOR_MAP = {
  'var(--wood)':   '#8B5E3C',
  'var(--cement)': '#6B6B6B',
  'var(--gravel)': '#9B8B6A',
  'var(--metal)':  '#5A8A9F',
  'var(--custom)': '#9B6FD4',
  'var(--amber)':  '#D4870A',
};
function resolveCssColor(c) {
  return CSS_COLOR_MAP[c] || c || '#D4870A';
}

// Redraw waveform on resize
window.addEventListener('resize', drawWaveform);

// ── Session log ────────────────────────────────────────────────────────────
function addLogRow(sample, t) {
  const row = document.createElement('div');
  row.className = 'log-row';
  const col = resolveCssColor(sample.cssColor);
  row.innerHTML = `
    <span class="log-name" style="color:${col}">${sample.name}</span>
    <span class="log-tc">${fmtTime(t)}</span>
  `;
  sessionLog.insertBefore(row, sessionLog.firstChild);
}

function clearLog() {
  sessionLog.innerHTML = '';
}

// ── Hint bar ───────────────────────────────────────────────────────────────
function updateHint() {
  if (state.isRecording && state.selectedSample) {
    hintSample.textContent = state.selectedSample.name;
    hintBar.classList.remove('hidden');
  } else {
    hintBar.classList.add('hidden');
  }
}

function updateEventCount() {
  eventCount.textContent = `${state.events.length} evento${state.events.length !== 1 ? 's' : ''}`;
}

// ── Init ───────────────────────────────────────────────────────────────────
renderLibrary();
drawWaveform();
