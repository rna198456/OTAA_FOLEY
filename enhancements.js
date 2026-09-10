/*
 * enhancements.js — OTAA_FOLEY
 *
 * UX / workflow additions layered over the existing Foley Recorder:
 *  - Clear selection summary
 *  - Richer timeline information
 *  - Ensayo / Grabación modes
 *  - Undo / Redo for session edits
 *  - Punch-in recording with IN / OUT range
 *
 * The original audio engine and timeline remain untouched; this file adds
 * workflow controls around the existing functions and state.
 */
'use strict';

(() => {
  // The original app.js is a classic script, so its top-level function
  // declarations and lexical state are available to this following script.
  if (typeof S === 'undefined') return;

  const cloneEvents = events => JSON.parse(JSON.stringify(events || []));
  const hasEvent = id => S.events.some(ev => ev.id === id);
  const dbFromGain = gain => 20 * Math.log10(Math.max(0.0001, gain));
  const fmtDb = gain => {
    const db = dbFromGain(gain);
    return `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`;
  };

  // ────────────────────────────────────────────────────────────────────────
  // UI helpers
  // ────────────────────────────────────────────────────────────────────────
  const libraryHeader = document.getElementById('library-header');
  const timelineToolbar = document.getElementById('timeline-toolbar');
  const controlsRow = document.getElementById('controls-row');
  const modalContent = document.getElementById('modal-content');
  const btnRecord = document.getElementById('btn-record');
  const btnStop = document.getElementById('btn-stop');
  const btnPreview = document.getElementById('btn-preview');
  const btnExport = document.getElementById('btn-export');
  const video = document.getElementById('video-el');

  if (!libraryHeader || !timelineToolbar || !controlsRow || !video) return;

  // ── Selection summary ──────────────────────────────────────────────────
  const selectionSummary = document.createElement('div');
  selectionSummary.id = 'selection-summary';
  selectionSummary.innerHTML = '<span class="selection-title">SELECCIÓN</span><span id="selection-value">—</span>';
  libraryHeader.insertAdjacentElement('afterend', selectionSummary);
  const selectionValue = document.getElementById('selection-value');

  function renderSelectionSummary() {
    if (!S.selectedFw && !Object.keys(S.activeSurfaces).length) {
      selectionValue.textContent = 'Elegí calzado y superficie';
      selectionSummary.classList.remove('has-selection');
      return;
    }

    const fwText = S.selectedFw
      ? `${S.selectedFw.emoji} ${S.selectedFw.label}`
      : 'Sin calzado';

    const surfaces = Object.entries(S.activeSurfaces).map(([id, gain]) => {
      const surf = (S.lib?.surfaces || []).find(s => s.id === id);
      return surf ? `${surf.emoji} ${surf.label} ${Math.round(gain * 100)}%` : id;
    });

    selectionValue.textContent = surfaces.length
      ? `${fwText} · ${surfaces.join(' + ')}`
      : fwText;
    selectionSummary.classList.add('has-selection');
  }

  // Wrap the existing updater so every normal selection refresh also refreshes
  // our summary. Keep the original function's return behavior intact.
  const originalUpdateTrigger = updateTrigger;
  updateTrigger = function () {
    const result = originalUpdateTrigger.apply(this, arguments);
    renderSelectionSummary();
    return result;
  };

  // ── Timeline information ────────────────────────────────────────────────
  const timelineInfo = document.createElement('div');
  timelineInfo.id = 'timeline-info';
  timelineToolbar.insertAdjacentElement('afterend', timelineInfo);

  function updateTimelineInfo() {
    const selected = S.events.find(ev => ev.id === S.selectedEvId);
    const playhead = typeof fmt === 'function' ? fmt(video.currentTime || 0) : '00:00.00';
    const count = S.events.length;

    if (selected) {
      const layers = (selected.layers || []).length;
      const label = selected.label || 'Evento';
      timelineInfo.innerHTML =
        `<span>PLAYHEAD <b>${playhead}</b></span>` +
        `<span>EVENTOS <b>${count}</b></span>` +
        `<span>SELECCIONADO <b>${label}</b></span>` +
        `<span>CAPAS <b>${layers}</b></span>` +
        `<span>GANANCIA <b>${Math.round((selected.gain ?? 1) * 100)}% · ${fmtDb(selected.gain ?? 1)}</b></span>`;
    } else {
      timelineInfo.innerHTML =
        `<span>PLAYHEAD <b>${playhead}</b></span>` +
        `<span>EVENTOS <b>${count}</b></span>` +
        `<span>SELECCIÓN <b>—</b></span>`;
    }
  }
  setInterval(updateTimelineInfo, 100);

  // ── Richer event tooltip ────────────────────────────────────────────────
  const tooltip = document.getElementById('event-tooltip');
  if (tooltip) {
    const tooltipMeta = document.createElement('div');
    tooltipMeta.id = 'tooltip-meta';
    tooltip.appendChild(tooltipMeta);

    const originalPositionTooltip = positionTooltip;
    positionTooltip = function () {
      const result = originalPositionTooltip.apply(this, arguments);
      const ev = S.events.find(e => e.id === S.selectedEvId);
      if (ev) {
        const layerNames = (ev.layers || []).map(layer => {
          const surf = layer.surface || {};
          return `${surf.emoji || ''} ${surf.label || surf.id || 'superficie'} ${Math.round((layer.gainMult ?? 1) * 100)}%`;
        }).join(' · ');
        tooltipMeta.innerHTML =
          `<span>${layerNames || 'Sin capas'}</span>` +
          `<span>Evento: ${fmtDb(ev.gain ?? 1)}</span>`;
        tooltipMeta.style.display = 'flex';
      } else {
        tooltipMeta.style.display = 'none';
      }
      return result;
    };
  }

  // ── Session history: Undo / Redo ────────────────────────────────────────
  const undoStack = [];
  const redoStack = [];
  let lastHistoryKey = '';

  function stateKey(events) {
    return JSON.stringify(events);
  }

  function recordBefore(before) {
    const key = stateKey(before);
    if (key === lastHistoryKey) return;
    undoStack.push(cloneEvents(before));
    redoStack.length = 0;
    lastHistoryKey = key;
    updateHistoryButtons();
  }

  function restoreEvents(events) {
    S.events = cloneEvents(events);
    S.selectedEvId = null;
    hideTooltip();
    updateEventCount();
    rebuildLog();
    drawWaveform();
    updateTimelineInfo();
    btnPreview.disabled = S.events.length === 0;
    btnExport.disabled = S.events.length === 0;
  }

  function undo() {
    if (!undoStack.length || S.isRecording || S.isPreviewing) return;
    const current = cloneEvents(S.events);
    const previous = undoStack.pop();
    redoStack.push(current);
    restoreEvents(previous);
    updateHistoryButtons();
  }

  function redo() {
    if (!redoStack.length || S.isRecording || S.isPreviewing) return;
    const current = cloneEvents(S.events);
    const next = redoStack.pop();
    undoStack.push(current);
    restoreEvents(next);
    updateHistoryButtons();
  }

  const historyControls = document.createElement('div');
  historyControls.id = 'history-controls';
  historyControls.innerHTML = `
    <button id="btn-undo" class="zoom-btn" title="Deshacer (Ctrl/Cmd+Z)" aria-label="Deshacer">↶</button>
    <button id="btn-redo" class="zoom-btn" title="Rehacer (Ctrl/Cmd+Y)" aria-label="Rehacer">↷</button>`;
  timelineToolbar.appendChild(historyControls);

  const btnUndo = document.getElementById('btn-undo');
  const btnRedo = document.getElementById('btn-redo');

  function updateHistoryButtons() {
    btnUndo.disabled = !undoStack.length || S.isRecording || S.isPreviewing;
    btnRedo.disabled = !redoStack.length || S.isRecording || S.isPreviewing;
  }

  btnUndo.addEventListener('click', undo);
  btnRedo.addEventListener('click', redo);

  document.addEventListener('keydown', event => {
    const modifier = event.ctrlKey || event.metaKey;
    if (!modifier || event.altKey) return;
    if (event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    } else if (event.key.toLowerCase() === 'y') {
      event.preventDefault();
      redo();
    }
  });

  // Record history for normal event creation.
  const originalFireTrigger = fireTrigger;
  fireTrigger = function () {
    const before = cloneEvents(S.events);
    originalFireTrigger.apply(this, arguments);
    if (!punchRecording && stateKey(before) !== stateKey(S.events)) {
      recordBefore(before);
    }
    updateHistoryButtons();
  };

  // Record history for deletion.
  const originalDeleteEvent = deleteEvent;
  deleteEvent = function (id) {
    const before = cloneEvents(S.events);
    originalDeleteEvent.apply(this, arguments);
    if (stateKey(before) !== stateKey(S.events)) recordBefore(before);
    updateHistoryButtons();
  };

  // Record timeline drag edits as one action per gesture.
  let dragBefore = null;
  let dragStartKey = '';
  wfCanvas.addEventListener('mousedown', () => {
    if (!S.isRecording) {
      dragBefore = cloneEvents(S.events);
      dragStartKey = stateKey(dragBefore);
    }
  }, true);
  wfCanvas.addEventListener('touchstart', () => {
    if (!S.isRecording) {
      dragBefore = cloneEvents(S.events);
      dragStartKey = stateKey(dragBefore);
    }
  }, true);
  const finishDragHistory = () => {
    if (!dragBefore) return;
    const before = dragBefore;
    dragBefore = null;
    const beforeKey = dragStartKey;
    dragStartKey = '';
    setTimeout(() => {
      if (beforeKey && beforeKey !== stateKey(S.events)) recordBefore(before);
      updateHistoryButtons();
    }, 0);
  };
  wfCanvas.addEventListener('mouseup', finishDragHistory, true);
  wfCanvas.addEventListener('touchend', finishDragHistory, true);
  wfCanvas.addEventListener('mouseleave', () => {
    if (dragBefore && S.drag === null) finishDragHistory();
  }, true);

  // Volume slider in tooltip: one history item per adjustment gesture.
  const tooltipVol = document.getElementById('tooltip-vol');
  let tooltipVolBefore = null;
  if (tooltipVol) {
    tooltipVol.addEventListener('pointerdown', () => {
      if (!S.isRecording) tooltipVolBefore = cloneEvents(S.events);
    }, true);
    tooltipVol.addEventListener('change', () => {
      if (!tooltipVolBefore) return;
      const before = tooltipVolBefore;
      tooltipVolBefore = null;
      if (stateKey(before) !== stateKey(S.events)) recordBefore(before);
      updateHistoryButtons();
    }, true);
  }

  // Change-modal application: capture the state before the Apply action.
  if (modalContent) {
    modalContent.addEventListener('click', event => {
      const apply = event.target.closest('.btn.btn-amber');
      if (!apply) return;
      modalContent.dataset.historyBefore = JSON.stringify(S.events);
    }, true);
    modalContent.addEventListener('click', () => {
      if (!modalContent.dataset.historyBefore) return;
      const before = JSON.parse(modalContent.dataset.historyBefore);
      delete modalContent.dataset.historyBefore;
      setTimeout(() => {
        if (stateKey(before) !== stateKey(S.events)) recordBefore(before);
        updateHistoryButtons();
      }, 0);
    });
  }

  // New video = new editing session, so history starts clean.
  video.addEventListener('loadedmetadata', () => {
    undoStack.length = 0;
    redoStack.length = 0;
    lastHistoryKey = '';
    updateHistoryButtons();
    renderSelectionSummary();
    updateTimelineInfo();
  });

  // ── Ensayo / Grabación modes ────────────────────────────────────────────
  const modeControl = document.createElement('div');
  modeControl.id = 'mode-control';
  modeControl.innerHTML = `
    <span class="mode-label">MODO</span>
    <button id="mode-rehearsal" class="mode-btn" type="button">ENSAYO</button>
    <button id="mode-recording" class="mode-btn active" type="button">GRABACIÓN</button>
    <span id="mode-status">Los disparos se registran en la timeline.</span>`;
  libraryHeader.insertAdjacentElement('afterend', modeControl);

  const modeRehearsal = document.getElementById('mode-rehearsal');
  const modeRecording = document.getElementById('mode-recording');
  const modeStatus = document.getElementById('mode-status');
  let workMode = 'recording';

  function setWorkMode(mode) {
    if (mode === workMode) return;
    if (S.isRecording) stopRecording();
    workMode = mode;
    modeRehearsal.classList.toggle('active', mode === 'rehearsal');
    modeRecording.classList.toggle('active', mode === 'recording');
    modeStatus.textContent = mode === 'rehearsal'
      ? 'Los disparos suenan, pero no se registran.'
      : 'Los disparos se registran en la timeline.';
    btnRecord.disabled = mode === 'rehearsal' || !S.videoLoaded;
    updateHint();
    updateHistoryButtons();
  }

  modeRehearsal.addEventListener('click', () => setWorkMode('rehearsal'));
  modeRecording.addEventListener('click', () => setWorkMode('recording'));

  // In Ensayo, block the existing record button before its normal click
  // handler gets a chance to start recording.
  btnRecord.addEventListener('click', event => {
    if (workMode === 'rehearsal') {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  // Ensayo must never leave recording state behind via keyboard or other code.
  const originalStartRecording = startRecording;
  startRecording = function () {
    if (workMode === 'rehearsal') return;
    return originalStartRecording.apply(this, arguments);
  };

  // ── Punch-in ────────────────────────────────────────────────────────────
  const punchControl = document.createElement('div');
  punchControl.id = 'punch-control';
  punchControl.innerHTML = `
    <button id="btn-punch-toggle" class="btn btn-ghost btn-sm" type="button">PUNCH-IN</button>
    <div id="punch-panel" class="hidden">
      <div class="punch-field">
        <label>IN</label>
        <input id="punch-start" type="number" min="0" step="0.01" value="0" inputmode="decimal">
        <button id="punch-set-start" class="punch-set" type="button" title="Usar posición actual">←</button>
      </div>
      <div class="punch-field">
        <label>OUT</label>
        <input id="punch-end" type="number" min="0" step="0.01" value="0" inputmode="decimal">
        <button id="punch-set-end" class="punch-set" type="button" title="Usar posición actual">←</button>
      </div>
      <span class="punch-help">Reemplaza los eventos dentro del rango.</span>
    </div>`;
  controlsRow.appendChild(punchControl);

  const btnPunchToggle = document.getElementById('btn-punch-toggle');
  const punchPanel = document.getElementById('punch-panel');
  const punchStart = document.getElementById('punch-start');
  const punchEnd = document.getElementById('punch-end');
  const punchSetStart = document.getElementById('punch-set-start');
  const punchSetEnd = document.getElementById('punch-set-end');

  let punchMode = false;
  let punchRecording = false;
  let punchUndoSnapshot = null;
  let punchTimer = null;

  function syncPunchDefaults() {
    if (!S.videoDuration) return;
    const current = Number(video.currentTime || 0);
    if (!Number.isFinite(Number(punchEnd.value)) || Number(punchEnd.value) === 0) {
      punchEnd.value = S.videoDuration.toFixed(2);
    }
    if (Number(punchStart.value) > S.videoDuration) punchStart.value = current.toFixed(2);
    if (Number(punchEnd.value) > S.videoDuration) punchEnd.value = S.videoDuration.toFixed(2);
  }

  function setPunchMode(active) {
    punchMode = active;
    btnPunchToggle.classList.toggle('active', active);
    punchPanel.classList.toggle('hidden', !active);
    btnPunchToggle.textContent = active ? 'PUNCH-IN · ACTIVO' : 'PUNCH-IN';
    if (active) syncPunchDefaults();
    if (punchRecording && !active) stopPunchRecording();
  }

  btnPunchToggle.addEventListener('click', () => setPunchMode(!punchMode));
  punchSetStart.addEventListener('click', () => {
    punchStart.value = (video.currentTime || 0).toFixed(2);
  });
  punchSetEnd.addEventListener('click', () => {
    punchEnd.value = (video.currentTime || 0).toFixed(2);
  });

  function getPunchRange() {
    let start = Number(punchStart.value);
    let end = Number(punchEnd.value);
    if (!Number.isFinite(start)) start = 0;
    if (!Number.isFinite(end)) end = S.videoDuration || 0;
    start = Math.max(0, Math.min(start, S.videoDuration || 0));
    end = Math.max(0, Math.min(end, S.videoDuration || 0));
    return { start, end };
  }

  function startPunchRecording() {
    if (!S.videoLoaded || workMode !== 'recording' || S.isRecording || punchRecording) return;
    const { start, end } = getPunchRange();
    if (end <= start) {
      if (typeof setStatus === 'function') setStatus('Error: IN debe ser menor que OUT', 3000);
      return;
    }

    AudioEngine.getCtx();
    punchUndoSnapshot = cloneEvents(S.events);

    // Punch-in behaves as a replacement of the selected time range.
    S.events = S.events.filter(ev => ev.time < start || ev.time > end);
    updateEventCount();
    rebuildLog();
    S.selectedEvId = null;
    hideTooltip();

    video.currentTime = start;
    S.startTimecode = start;
    S.isRecording = true;
    punchRecording = true;
    video.play();

    btnRecord.style.display = 'none';
    btnStop.style.display = 'inline-block';
    btnStop.disabled = false;
    btnPreview.disabled = true;
    btnExport.disabled = true;
    recIndicator.classList.remove('hidden');
    hintBar.classList.remove('hidden');
    hintName.textContent = 'PUNCH-IN';
    updateHistoryButtons();
    drawWaveform();

    const check = () => {
      if (!punchRecording) return;
      if (video.currentTime >= end || video.ended) {
        stopPunchRecording();
        return;
      }
      punchTimer = requestAnimationFrame(check);
    };
    punchTimer = requestAnimationFrame(check);
  }

  function stopPunchRecording() {
    if (!punchRecording) return;
    punchRecording = false;
    if (punchTimer) cancelAnimationFrame(punchTimer);
    punchTimer = null;

    // Reuse the existing stop workflow for buttons / playback state.
    stopRecording();

    if (punchUndoSnapshot && stateKey(punchUndoSnapshot) !== stateKey(S.events)) {
      recordBefore(punchUndoSnapshot);
    }
    punchUndoSnapshot = null;
    updateHistoryButtons();
  }

  btnRecord.addEventListener('click', event => {
    if (!punchMode || workMode !== 'recording') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    startPunchRecording();
  }, true);

  btnStop.addEventListener('click', () => {
    if (punchRecording) stopPunchRecording();
  }, true);

  video.addEventListener('ended', () => {
    if (punchRecording) stopPunchRecording();
  });

  // Keep the punch range valid whenever a video is loaded.
  video.addEventListener('loadedmetadata', syncPunchDefaults);

  // ── Initial state ───────────────────────────────────────────────────────
  renderSelectionSummary();
  updateTimelineInfo();
  syncPunchDefaults();
  updateHistoryButtons();
})();
