/* interaction-polish.js — OTAA_FOLEY
 * Final compatibility / sample-editing layer.
 *
 * - Stops the legacy mouse/touch canvas handlers from competing with the
 *   consolidated pointer-event timeline interaction.
 * - Extends the event combination menu so each active surface can choose
 *   the exact recorded sample/step (rrIdx).
 */
'use strict';

(() => {
  if (typeof S === 'undefined') return;

  const canvas = document.getElementById('waveform');
  const modalOverlay = document.getElementById('modal-overlay');
  const modalContent = document.getElementById('modal-content');
  if (!canvas || !modalOverlay || !modalContent) return;

  // The consolidated pointer-event layer owns the timeline. Prevent the old
  // mousedown/touchstart handlers in app.js from executing as well.
  ['mousedown', 'mousemove', 'mouseup', 'mouseleave', 'touchstart', 'touchmove', 'touchend'].forEach(type => {
    canvas.addEventListener(type, event => {
      if (S.isRecording) return;
      event.stopImmediatePropagation();
    }, true);
  });

  // Explicit sample/step selector in the event editor.
  openChangeModal = function (evId) {
    const target = S.events.find(ev => ev.id === evId);
    if (!target) return;

    modalContent.innerHTML = '';

    const info = document.createElement('p');
    info.style.cssText = 'font-size:11px;color:var(--sub);margin-bottom:10px;font-family:var(--mono)';
    info.textContent = 'Cambiá calzado, superficies y el paso/sample de cada capa:';
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
      if (!samples.length) return;

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
        if (index === Number(data.rrIdx ?? 0)) option.selected = true;
        select.appendChild(option);
      });
      select.addEventListener('change', () => {
        data.rrIdx = Number(select.value);
      });

      sampleRow.appendChild(label);
      sampleRow.appendChild(select);
      container.appendChild(sampleRow);
    }

    function addSurfaceRow(surf) {
      const row = document.createElement('div');
      row.className = 'surface-row';

      const cb = document.createElement('button');
      cb.className = 'surf-check' + (tempSurfs[surf.id] ? ' selected' : '');
      cb.style.borderColor = tempSurfs[surf.id] ? (surf.color || '') : '';
      cb.innerHTML = `<span class="surf-emoji">${surf.emoji}</span><span class="surf-name">${surf.label}</span>`;

      const fader = document.createElement('div');
      const data = tempSurfs[surf.id] || { gainMult: 1, rrIdx: 0 };
      fader.className = 'surf-fader-wrap' + (tempSurfs[surf.id] ? '' : ' hidden');
      fader.innerHTML = `<input type="range" class="surf-fader" min="0" max="200" step="1" value="${Math.round((data.gainMult ?? 1) * 100)}"/><span class="surf-fader-val">${Math.round((data.gainMult ?? 1) * 100)}%</span>`;
      fader.querySelector('input').addEventListener('input', event => {
        if (!tempSurfs[surf.id]) tempSurfs[surf.id] = { gainMult: 1, rrIdx: 0 };
        tempSurfs[surf.id].gainMult = Number(event.target.value) / 100;
        fader.querySelector('.surf-fader-val').textContent = event.target.value + '%';
      });

      cb.addEventListener('click', () => {
        if (tempSurfs[surf.id]) {
          delete tempSurfs[surf.id];
          cb.classList.remove('selected');
          cb.style.borderColor = '';
          fader.classList.add('hidden');
          sampleRow?.remove();
        } else {
          tempSurfs[surf.id] = { gainMult: 1, rrIdx: 0 };
          cb.classList.add('selected');
          cb.style.borderColor = surf.color || '';
          fader.classList.remove('hidden');
          renderSampleSelect(row, surf, tempSurfs[surf.id]);
        }
      });

      row.appendChild(cb);
      row.appendChild(fader);

      let sampleRow = null;
      if (tempSurfs[surf.id]) {
        const before = row.children.length;
        renderSampleSelect(row, surf, tempSurfs[surf.id]);
        sampleRow = row.children[before];
      }

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
      drawWaveform();
      positionTooltip();
      rebuildLog();
    });
    modalContent.appendChild(apply);
    modalOverlay.classList.remove('hidden');
  };
})();
