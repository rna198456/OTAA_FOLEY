/* group-edit.js — OTAA_FOLEY
 * Group editing + keyboard transport.
 *
 * Keeps group editing separate from the individual event editor. It mirrors
 * the empty-area selection gesture and applies one common footwear/surface/
 * sample configuration to every selected event, preserving id/time/gain.
 */
'use strict';

(() => {
  if (typeof S === 'undefined') return;

  const canvas = document.getElementById('waveform');
  const timelinePanel = document.getElementById('timeline-panel');
  const video = document.getElementById('video-el');
  if (!canvas || !timelinePanel || !video) return;

  let groupSelection = new Set();
  let selectGesture = null;
  let lastSelectedRange = null;

  const visibleDuration = () => (S.videoDuration || 10) / Math.max(1, S.zoom || 1);
  const xToTime = x => S.scrollOffset + (x / Math.max(1, canvas.offsetWidth)) * visibleDuration();
  const timeToX = t => ((t - S.scrollOffset) / Math.max(0.000001, visibleDuration())) * canvas.offsetWidth;

  const bar = document.createElement('div');
  bar.id = 'group-edit-bar';
  bar.style.cssText = [
    'display:none', 'align-items:center', 'justify-content:space-between', 'gap:8px',
    'padding:5px 0', 'font-family:var(--mono)', 'font-size:8px', 'color:var(--amber)'
  ].join(';');
  bar.innerHTML = '<span id="group-edit-label"></span><div style="display:flex;gap:5px"><button id="group-edit-change" type="button" style="border:1px solid var(--amber);background:rgba(212,135,10,.08);color:var(--amber);border-radius:4px;padding:5px 8px;font:600 8px var(--mono);cursor:pointer">CAMBIAR GRUPO</button><button id="group-edit-clear" type="button" style="border:1px solid var(--border);background:transparent;color:var(--sub);border-radius:4px;padding:5px 7px;font:600 8px var(--mono);cursor:pointer">LIMPIAR</button></div>';
  timelinePanel.insertBefore(bar, document.getElementById('progress-wrap'));

  const label = bar.querySelector('#group-edit-label');
  const changeBtn = bar.querySelector('#group-edit-change');
  const clearBtn = bar.querySelector('#group-edit-clear');

  function updateBar() {
    const n = groupSelection.size;
    bar.style.display = n ? 'flex' : 'none';
    label.textContent = n ? `${n} INSTRUCCIÓN${n === 1 ? '' : 'ES'} SELECCIONADA${n === 1 ? '' : 'S'}` : '';
  }

  function render() {
    if (typeof drawWaveform === 'function') drawWaveform();
    updateBar();
  }

  function selectedEventsFromRange(a, b) {
    const t1 = xToTime(Math.min(a, b));
    const t2 = xToTime(Math.max(a, b));
    const ids = new Set();
    S.events.forEach(ev => {
      if (ev.time >= t1 && ev.time <= t2) ids.add(ev.id);
    });
    return ids;
  }

  // Mirror the final-fixes empty-area selection gesture.
  document.addEventListener('pointerdown', e => {
    if (e.target !== canvas || e.button !== 0 || S.isRecording || S.isPreviewing || !S.videoLoaded) return;
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const hit = S.events.some(ev => Math.abs(timeToX(ev.time) - x) <= 14);
    if (hit) {
      selectGesture = null;
      return;
    }
    selectGesture = { x, y, pointerId: e.pointerId, currentX: x, moved: false };
  }, true);

  document.addEventListener('pointermove', e => {
    if (!selectGesture || e.pointerId !== selectGesture.pointerId) return;
    if (Math.hypot(e.clientX - (canvas.getBoundingClientRect().left + selectGesture.x), e.clientY - (canvas.getBoundingClientRect().top + selectGesture.y)) <= 6) return;
    const r = canvas.getBoundingClientRect();
    selectGesture.currentX = e.clientX - r.left;
    selectGesture.moved = true;
  }, true);

  document.addEventListener('pointerup', e => {
    if (!selectGesture || e.pointerId !== selectGesture.pointerId) return;
    const g = selectGesture;
    selectGesture = null;
    if (!g.moved || S.isRecording || S.isPreviewing || !S.videoLoaded) return;
    groupSelection = selectedEventsFromRange(g.x, g.currentX);
    lastSelectedRange = { a: g.x, b: g.currentX };
    S.selectedEvId = groupSelection.size === 1 ? [...groupSelection][0] : null;
    render();
  }, true);

  document.addEventListener('pointercancel', e => {
    if (selectGesture?.pointerId === e.pointerId) selectGesture = null;
  }, true);

  function clearGroupSelection() {
    groupSelection.clear();
    lastSelectedRange = null;
    if (typeof hideTooltip === 'function') hideTooltip();
    render();
  }

  clearBtn.addEventListener('click', e => {
    e.preventDefault(); e.stopImmediatePropagation();
    clearGroupSelection();
  }, true);

  // Apply the same configuration to all selected events.
  function openGroupModal() {
    const targets = S.events.filter(ev => groupSelection.has(ev.id));
    if (!targets.length || !S.lib) return;

    const overlay = document.getElementById('modal-overlay');
    const content = document.getElementById('modal-content');
    if (!overlay || !content) return;

    content.innerHTML = '';
    const info = document.createElement('p');
    info.style.cssText = 'font-size:11px;color:var(--sub);margin-bottom:10px;font-family:var(--mono)';
    info.textContent = `Editar ${targets.length} instrucciones a la vez. Se conservarán tiempo y volumen de cada una.`;
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
      b.addEventListener('click', () => {
        tempFw = fw;
        fwRow.querySelectorAll('.fw-btn').forEach(x => x.classList.toggle('selected', x === b));
      });
      fwRow.appendChild(b);
    });
    content.appendChild(fwRow);

    const tempSurfs = {};
    const firstLayers = targets[0].layers || [];
    firstLayers.forEach(layer => {
      if (layer.surface?.id) tempSurfs[layer.surface.id] = { gainMult: layer.gainMult ?? 1, rrIdx: layer.rrIdx ?? 0 };
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

      const data = tempSurfs[surf.id] || { gainMult: 1, rrIdx: 0 };
      const fader = document.createElement('div');
      fader.className = 'surf-fader-wrap' + (active ? '' : ' hidden');
      fader.innerHTML = `<input type="range" class="surf-fader" min="0" max="200" step="1" value="${Math.round((data.gainMult ?? 1) * 100)}"/><span class="surf-fader-val">${Math.round((data.gainMult ?? 1) * 100)}%</span>`;
      fader.querySelector('input').addEventListener('input', ev => {
        if (!tempSurfs[surf.id]) tempSurfs[surf.id] = { gainMult: 1, rrIdx: 0 };
        tempSurfs[surf.id].gainMult = Number(ev.target.value) / 100;
        fader.querySelector('.surf-fader-val').textContent = ev.target.value + '%';
      });

      let sampleRow = null;
      function addSampleSelect() {
        const samples = Array.isArray(surf.samples) ? surf.samples : [];
        if (!samples.length) return null;
        const sr = document.createElement('div');
        sr.className = 'sample-select-row';
        sr.innerHTML = `<span class="sample-select-label">PASO</span>`;
        const select = document.createElement('select');
        select.className = 'sample-select';
        samples.forEach((sample, index) => {
          const op = document.createElement('option');
          op.value = String(index);
          op.textContent = sample.label || `Paso ${index + 1}`;
          op.selected = index === Number(tempSurfs[surf.id]?.rrIdx ?? 0);
          select.appendChild(op);
        });
        select.addEventListener('change', () => {
          if (!tempSurfs[surf.id]) tempSurfs[surf.id] = { gainMult: 1, rrIdx: 0 };
          tempSurfs[surf.id].rrIdx = Number(select.value);
        });
        sr.appendChild(select);
        return sr;
      }
      if (active) sampleRow = addSampleSelect();

      cb.addEventListener('click', () => {
        if (tempSurfs[surf.id]) {
          delete tempSurfs[surf.id];
          cb.classList.remove('selected'); cb.style.borderColor = '';
          fader.classList.add('hidden');
          sampleRow?.remove(); sampleRow = null;
        } else {
          tempSurfs[surf.id] = { gainMult: 1, rrIdx: 0 };
          cb.classList.add('selected'); cb.style.borderColor = surf.color || '';
          fader.classList.remove('hidden');
          sampleRow = addSampleSelect();
        }
      });

      row.appendChild(cb);
      row.appendChild(fader);
      if (sampleRow) row.appendChild(sampleRow);
      surfWrap.appendChild(row);
    });
    content.appendChild(surfWrap);

    const apply = document.createElement('button');
    apply.className = 'btn btn-amber btn-sm';
    apply.style.cssText = 'width:100%;margin-top:10px';
    apply.textContent = 'APLICAR AL GRUPO';
    apply.addEventListener('click', () => {
      if (!Object.keys(tempSurfs).length) return;
      const sharedLayers = Object.entries(tempSurfs).map(([sid, data]) => ({
        fwId: tempFw.id,
        surface: (S.lib.surfaces || []).find(s => s.id === sid),
        gainMult: data.gainMult,
        rrIdx: data.rrIdx ?? 0,
      }));

      targets.forEach(ev => {
        ev.layers = sharedLayers.map(layer => ({ ...layer, surface: layer.surface ? { ...layer.surface } : layer.surface }));
        ev.label = `${tempFw.emoji} ${tempFw.label} · ${ev.layers.map(l => l.surface?.label || '').join('+')}`;
        ev.color = ev.layers[0]?.surface?.color || '#D4870A';
      });

      if (typeof rebuildLog === 'function') rebuildLog();
      overlay.classList.add('hidden');
      S.selectedEvId = null;
      if (typeof positionTooltip === 'function') positionTooltip();
      render();
    });
    content.appendChild(apply);
    overlay.classList.remove('hidden');
  }

  changeBtn.addEventListener('click', e => {
    e.preventDefault(); e.stopImmediatePropagation();
    openGroupModal();
  }, true);

  // Space: recording = Foley trigger (handled by final-fixes); otherwise it is
  // the playback transport and toggles PLAY/STOP from the current playhead.
  document.addEventListener('keydown', e => {
    if (e.code !== 'Space' || e.repeat) return;
    const t = e.target;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (S.isRecording) return;
    if (!S.videoLoaded || typeof startPreview !== 'function') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (S.isPreviewing) {
      if (typeof stopPreview === 'function') stopPreview();
    } else {
      startPreview();
    }
  }, false);

  updateBar();
})();
