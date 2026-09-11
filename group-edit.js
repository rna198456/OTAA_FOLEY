/* group-edit.js — OTAA_FOLEY
 * Group editing + keyboard transport.
 *
 * Group editor intentionally only changes:
 *   - footwear
 *   - active surfaces + their layer gains
 *   - event volume as a common relative adjustment
 *
 * Sample/step selection is NOT exposed here. Time and event identity remain
 * unchanged. When a footwear/surface combination is applied, each resulting
 * layer receives the next sample from the same shuffle-bag used by live
 * recording, so edited groups keep the global random/no-repeat behavior.
 */
'use strict';

(() => {
  if (typeof S === 'undefined') return;

  const canvas = document.getElementById('waveform');
  const timelinePanel = document.getElementById('timeline-panel');
  const video = document.getElementById('video-el');
  const overlay = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');
  if (!canvas || !timelinePanel || !video || !overlay || !content) return;

  let groupSelection = new Set();
  let selectGesture = null;

  const visibleDuration = () => (S.videoDuration || 10) / Math.max(1, S.zoom || 1);
  const timeToX = t => ((t - S.scrollOffset) / Math.max(0.000001, visibleDuration())) * canvas.offsetWidth;
  const xToTime = x => S.scrollOffset + (x / Math.max(1, canvas.offsetWidth)) * visibleDuration();

  const bar = document.createElement('div');
  bar.id = 'group-edit-bar';
  bar.style.cssText = [
    'display:none', 'align-items:center', 'justify-content:space-between', 'gap:8px',
    'padding:5px 0', 'font-family:var(--mono)', 'font-size:8px', 'color:var(--amber)',
    'flex-wrap:wrap'
  ].join(';');
  bar.innerHTML = `
    <span id="group-edit-label"></span>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <div id="group-edit-volume-wrap" style="display:flex;align-items:center;gap:5px;min-width:190px">
        <span style="color:var(--sub);white-space:nowrap">VOL.</span>
        <input id="group-edit-volume-slider" type="range" min="0" max="200" step="1" value="100"
          aria-label="Volumen del grupo" style="width:130px;cursor:pointer;accent-color:var(--amber)" />
        <span id="group-edit-volume-value" style="min-width:44px;text-align:right;color:var(--amber);font-weight:600">100% · 0 dB</span>
      </div>
      <button id="group-edit-change" type="button" style="border:1px solid var(--amber);background:rgba(212,135,10,.08);color:var(--amber);border-radius:4px;padding:5px 8px;font:600 8px var(--mono);cursor:pointer">CAMBIAR GRUPO</button>
      <button id="group-edit-clear" type="button" style="border:1px solid var(--border);background:transparent;color:var(--sub);border-radius:4px;padding:5px 7px;font:600 8px var(--mono);cursor:pointer">LIMPIAR</button>
    </div>`;
  timelinePanel.insertBefore(bar, document.getElementById('progress-wrap'));

  const label = bar.querySelector('#group-edit-label');
  const changeBtn = bar.querySelector('#group-edit-change');
  const clearBtn = bar.querySelector('#group-edit-clear');
  const volumeSlider = bar.querySelector('#group-edit-volume-slider');
  const volumeValue = bar.querySelector('#group-edit-volume-value');

  function redraw() {
    if (typeof drawWaveform === 'function') drawWaveform();
    updateBar();
  }

  function updateBar() {
    const n = groupSelection.size;
    bar.style.display = n ? 'flex' : 'none';
    label.textContent = n ? `${n} INSTRUCCIÓN${n === 1 ? '' : 'ES'} SELECCIONADA${n === 1 ? '' : 'S'}` : '';
    if (n) syncGroupVolumeUI();
  }

  function selectedTargets() {
    return S.events.filter(ev => groupSelection.has(ev.id));
  }

  function groupAverageGain(targets = selectedTargets()) {
    if (!targets.length) return 1;
    return targets.reduce((sum, ev) => sum + (ev.gain ?? 1), 0) / targets.length;
  }

  function gainToDb(gain) {
    if (gain <= 0) return '-∞ dB';
    const db = 20 * Math.log10(gain);
    return `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`;
  }

  function syncGroupVolumeUI() {
    const targets = selectedTargets();
    if (!targets.length) return;
    const avg = Math.max(0, Math.min(2, groupAverageGain(targets)));
    volumeSlider.value = String(Math.round(avg * 100));
    volumeValue.textContent = `${Math.round(avg * 100)}% · ${gainToDb(avg)}`;
  }

  function applyGroupVolume() {
    const targets = selectedTargets();
    if (!targets.length) return;

    const initialAverage = groupAverageGain(targets);
    const requestedAverage = Number(volumeSlider.value) / 100;
    const delta = requestedAverage - initialAverage;

    targets.forEach(ev => {
      ev.gain = Math.max(0, Math.min(2, (ev.gain ?? 1) + delta));
    });

    const actualAverage = groupAverageGain(targets);
    volumeSlider.value = String(Math.round(actualAverage * 100));
    volumeValue.textContent = `${Math.round(actualAverage * 100)}% · ${gainToDb(actualAverage)}`;
    if (typeof rebuildLog === 'function') rebuildLog();
    if (typeof updateEventCount === 'function') updateEventCount();
    if (typeof hideTooltip === 'function') hideTooltip();
    redraw();
  }

  volumeSlider.addEventListener('input', () => {
    applyGroupVolume();
  });

  function selectRange(a, b) {
    const t1 = xToTime(Math.min(a, b));
    const t2 = xToTime(Math.max(a, b));
    const ids = new Set();
    S.events.forEach(ev => {
      if (ev.time >= t1 && ev.time <= t2) ids.add(ev.id);
    });
    return ids;
  }

  // Synchronize the group selection with the same empty-area drag used by the
  // main timeline interaction layer. This listener runs during document capture,
  // before the canvas target handler is reached.
  document.addEventListener('pointerdown', e => {
    if (e.target !== canvas || e.button !== 0 || S.isRecording || S.isPreviewing || !S.videoLoaded) return;
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const hit = S.events.some(ev => Math.abs(timeToX(ev.time) - x) <= 14);
    if (hit) {
      selectGesture = null;
      groupSelection.clear();
      updateBar();
      return;
    }
    groupSelection.clear();
    updateBar();
    selectGesture = { x, y, pointerId: e.pointerId, currentX: x, moved: false };
  }, true);

  document.addEventListener('pointermove', e => {
    if (!selectGesture || e.pointerId !== selectGesture.pointerId) return;
    const r = canvas.getBoundingClientRect();
    const dx = (e.clientX - r.left) - selectGesture.x;
    const dy = (e.clientY - r.top) - selectGesture.y;
    if (Math.hypot(dx, dy) <= 6) return;
    selectGesture.currentX = e.clientX - r.left;
    selectGesture.moved = true;
  }, true);

  document.addEventListener('pointerup', e => {
    if (!selectGesture || e.pointerId !== selectGesture.pointerId) return;
    const g = selectGesture;
    selectGesture = null;
    if (!g.moved || S.isRecording || S.isPreviewing || !S.videoLoaded) return;
    groupSelection = selectRange(g.x, g.currentX);
    S.selectedEvId = groupSelection.size === 1 ? [...groupSelection][0] : null;
    if (typeof hideTooltip === 'function') hideTooltip();
    window.__otaaGroupSelection = new Set(groupSelection);
    redraw();
  }, true);

  document.addEventListener('pointercancel', e => {
    if (selectGesture?.pointerId === e.pointerId) selectGesture = null;
  }, true);

  clearBtn.addEventListener('click', e => {
    e.preventDefault(); e.stopImmediatePropagation();
    groupSelection.clear();
    window.__otaaGroupSelection = new Set();
    if (typeof hideTooltip === 'function') hideTooltip();
    redraw();
  }, true);

  function openGroupModal() {
    const targets = S.events.filter(ev => groupSelection.has(ev.id));
    if (!targets.length || !S.lib) return;

    const title = document.querySelector('#modal-box .modal-title');
    if (title) title.textContent = 'Cambiar combinación del grupo';
    content.innerHTML = '';

    const info = document.createElement('p');
    info.style.cssText = 'font-size:11px;color:var(--sub);margin-bottom:10px;font-family:var(--mono)';
    info.textContent = `Editar ${targets.length} instrucciones a la vez. Se conservarán tiempo y volumen.`;
    content.appendChild(info);

    let tempFw = (S.lib.footwear || []).find(f => f.id === targets[0].layers?.[0]?.fwId) || S.lib.footwear?.[0];
    if (!tempFw) return;

    const fwRow = document.createElement('div');
    fwRow.className = 'fw-grid';
    fwRow.style.marginBottom = '10px';
    (S.lib.footwear || []).forEach(fw => {
      const b = document.createElement('button');
      b.className = 'fw-btn' + (fw.id === tempFw.id ? ' selected' : '');
      b.innerHTML = `<span class="fw-emoji">${fw.emoji}</span><span class="fw-label">${fw.label}</span>`;
      b.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation();
        tempFw = fw;
        fwRow.querySelectorAll('.fw-btn').forEach(x => x.classList.toggle('selected', x === b));
      });
      fwRow.appendChild(b);
    });
    content.appendChild(fwRow);

    // A surface is initially active only when it is shared by every selected
    // event. This avoids silently inheriting a surface from just the first one.
    const commonIds = (S.lib.surfaces || []).filter(surf =>
      targets.every(ev => (ev.layers || []).some(layer => layer.surface?.id === surf.id))
    ).map(surf => surf.id);
    const tempSurfs = {};
    commonIds.forEach(sid => {
      const layer = targets[0].layers.find(l => l.surface?.id === sid);
      tempSurfs[sid] = { gainMult: layer?.gainMult ?? 1 };
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

      const fader = document.createElement('div');
      fader.className = 'surf-fader-wrap' + (active ? '' : ' hidden');
      fader.innerHTML = `<input type="range" class="surf-fader" min="0" max="200" step="1" value="${Math.round((tempSurfs[surf.id]?.gainMult ?? 1) * 100)}"/><span class="surf-fader-val">${Math.round((tempSurfs[surf.id]?.gainMult ?? 1) * 100)}%</span>`;
      fader.querySelector('input').addEventListener('input', e => {
        if (!tempSurfs[surf.id]) tempSurfs[surf.id] = { gainMult: 1 };
        tempSurfs[surf.id].gainMult = Number(e.target.value) / 100;
        fader.querySelector('.surf-fader-val').textContent = e.target.value + '%';
      });

      cb.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation();
        if (tempSurfs[surf.id]) {
          delete tempSurfs[surf.id];
          cb.classList.remove('selected');
          cb.style.borderColor = '';
          fader.classList.add('hidden');
        } else {
          tempSurfs[surf.id] = { gainMult: 1 };
          cb.classList.add('selected');
          cb.style.borderColor = surf.color || '';
          fader.classList.remove('hidden');
        }
      });

      row.appendChild(cb);
      row.appendChild(fader);
      surfWrap.appendChild(row);
    });
    content.appendChild(surfWrap);

    const hint = document.createElement('div');
    hint.style.cssText = 'font:8px var(--mono);color:var(--dark);margin-top:8px';
    hint.textContent = 'Elegí calzado y una o más superficies. Los eventos conservan tiempo y volumen; sus samples se reasignan siguiendo el orden aleatorio global.';
    content.appendChild(hint);

    const apply = document.createElement('button');
    apply.className = 'btn btn-amber btn-sm';
    apply.style.cssText = 'width:100%;margin-top:10px';
    apply.textContent = 'APLICAR AL GRUPO';
    apply.addEventListener('click', e => {
      e.preventDefault(); e.stopImmediatePropagation();
      const currentTargets = S.events.filter(ev => groupSelection.has(ev.id));
      if (!currentTargets.length || !Object.keys(tempSurfs).length) return;

      const nextLayers = Object.entries(tempSurfs).map(([sid, data]) => ({
        fwId: tempFw.id,
        surface: (S.lib.surfaces || []).find(s => s.id === sid),
        gainMult: data.gainMult,
      }));

      currentTargets.forEach(ev => {
        ev.layers = nextLayers.map(layer => ({
          fwId: layer.fwId,
          surface: layer.surface,
          gainMult: layer.gainMult,
          // Do NOT preserve the old rrIdx here. The edited combination must
          // participate in the same shuffle-bag as live recordings.
          rrIdx: typeof window.allocateFoleySampleIndex === 'function'
            ? window.allocateFoleySampleIndex(layer.fwId, layer.surface)
            : 0,
        }));
        ev.label = `${tempFw.emoji} ${tempFw.label} · ${ev.layers.map(l => l.surface?.label || '').join('+')}`;
        ev.color = ev.layers[0]?.surface?.color || '#D4870A';
      });

      if (typeof rebuildLog === 'function') rebuildLog();
      overlay.classList.add('hidden');
      if (title) title.textContent = 'Cambiar combinación del evento';
      S.selectedEvId = null;
      redraw();
    });
    content.appendChild(apply);
    overlay.classList.remove('hidden');
  }

  changeBtn.addEventListener('click', e => {
    e.preventDefault(); e.stopImmediatePropagation();
    openGroupModal();
  }, true);

  updateBar();
})();
