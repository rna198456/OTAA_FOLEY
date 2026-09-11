/* timeline-ui-refinement.js — HUELLA
 * Compact timeline + integrated single-event editor.
 * The individual event editor uses the same in-flow pattern as the group bar,
 * so it never overlays the video or covers the timeline.
 */
'use strict';

(() => {
  if (typeof S === 'undefined') return;

  const panel = document.getElementById('timeline-panel');
  const progress = document.getElementById('progress-wrap');
  const tooltip = document.getElementById('event-tooltip');
  const tooltipVol = document.getElementById('tooltip-vol');
  const timeline = document.getElementById('waveform');
  if (!panel || !progress || !timeline) return;

  // Compact the waveform without changing its interaction model.
  const style = document.createElement('style');
  style.id = 'huella-timeline-refinement-style';
  style.textContent = `
    #waveform { height: 96px !important; }
    #waveform-outer { margin-bottom: 0; }
    #timeline-panel { gap: 4px; padding-top: 6px; padding-bottom: 7px; }
    #event-edit-bar {
      display:none;
      align-items:center;
      justify-content:space-between;
      gap:8px;
      padding:5px 0;
      min-height:30px;
      font-family:var(--mono);
      font-size:8px;
      color:var(--amber);
      flex-wrap:wrap;
      border-top:1px solid var(--border);
    }
    #event-edit-bar .event-edit-label {
      overflow:hidden;
      text-overflow:ellipsis;
      white-space:nowrap;
      min-width:100px;
      color:var(--text);
    }
    #event-edit-bar .event-edit-tools {
      display:flex;
      align-items:center;
      gap:8px;
      flex-wrap:wrap;
      margin-left:auto;
    }
    #event-edit-bar .event-edit-volume {
      display:flex;
      align-items:center;
      gap:5px;
      min-width:190px;
    }
    #event-edit-bar .event-edit-volume input {
      width:110px;
      cursor:pointer;
      accent-color:var(--amber);
    }
    #event-edit-bar .event-edit-value {
      min-width:54px;
      text-align:right;
      color:var(--amber);
      font-weight:600;
    }
    #event-edit-bar button {
      border:1px solid var(--border);
      background:transparent;
      color:var(--sub);
      border-radius:4px;
      padding:5px 8px;
      font:600 8px var(--mono);
      cursor:pointer;
      white-space:nowrap;
    }
    #event-edit-bar #event-edit-change {
      border-color:var(--amber);
      background:rgba(212,135,10,.08);
      color:var(--amber);
    }
    #event-edit-bar #event-edit-close:hover { color:var(--red); border-color:var(--red); }
    #event-edit-bar button:hover { color:var(--text); border-color:var(--sub); }
    #event-edit-bar.hidden { display:none !important; }

    /* The legacy tooltip stays in the DOM for compatibility, but no longer floats. */
    #event-tooltip { display:none !important; }

    @media(max-width:700px){
      #waveform { height:78px !important; }
      #event-edit-bar { align-items:flex-start; }
      #event-edit-bar .event-edit-tools { width:100%; margin-left:0; }
      #event-edit-bar .event-edit-volume { flex:1; min-width:0; }
      #event-edit-bar .event-edit-volume input { flex:1; width:auto; }
    }
  `;
  document.head.appendChild(style);

  const bar = document.createElement('div');
  bar.id = 'event-edit-bar';
  bar.className = 'hidden';
  bar.innerHTML = `
    <span class="event-edit-label" id="event-edit-label"></span>
    <div class="event-edit-tools">
      <div class="event-edit-volume">
        <span style="color:var(--sub);white-space:nowrap">VOL.</span>
        <input id="event-edit-volume-slider" type="range" min="0" max="200" step="1" value="100" aria-label="Volumen del evento">
        <span id="event-edit-volume-value" class="event-edit-value">100% · 0 dB</span>
      </div>
      <button id="event-edit-change" type="button">CAMBIAR</button>
      <button id="event-edit-close" type="button">CERRAR</button>
    </div>`;
  panel.insertBefore(bar, progress);

  const label = document.getElementById('event-edit-label');
  const slider = document.getElementById('event-edit-volume-slider');
  const value = document.getElementById('event-edit-volume-value');
  const change = document.getElementById('event-edit-change');
  const close = document.getElementById('event-edit-close');

  const gainToDb = gain => {
    if (gain <= 0) return '-∞ dB';
    const db = 20 * Math.log10(gain);
    return `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`;
  };

  function selectedEvent() {
    return S.events.find(ev => ev.id === S.selectedEvId) || null;
  }

  function updateBar(ev = selectedEvent()) {
    if (!ev) {
      bar.classList.add('hidden');
      bar.style.display = 'none';
      return;
    }
    bar.classList.remove('hidden');
    bar.style.display = 'flex';
    label.textContent = `${ev.label || 'Evento'} · ${typeof fmt === 'function' ? fmt(ev.time) : ''}`;
    const gain = Math.max(0, Math.min(2, ev.gain ?? 1));
    slider.value = String(Math.round(gain * 100));
    value.textContent = `${Math.round(gain * 100)}% · ${gainToDb(gain)}`;
  }

  // Replace the floating tooltip positioning with the in-flow editor bar.
  const originalPositionTooltip = typeof positionTooltip === 'function' ? positionTooltip : null;
  positionTooltip = function () {
    const ev = selectedEvent();
    updateBar(ev);
    if (tooltip) tooltip.classList.add('hidden');
    if (originalPositionTooltip) {
      // Do not call the original geometry code: the tooltip must never float.
    }
  };

  const originalHideTooltip = typeof hideTooltip === 'function' ? hideTooltip : null;
  hideTooltip = function () {
    if (originalHideTooltip) originalHideTooltip.apply(this, arguments);
    updateBar(null);
  };

  // Keep the integrated slider synchronized with timeline vertical-drag edits.
  const originalSyncTooltipVol = typeof syncTooltipVol === 'function' ? syncTooltipVol : null;
  syncTooltipVol = function (ev) {
    if (originalSyncTooltipVol) originalSyncTooltipVol.apply(this, arguments);
    updateBar(ev || selectedEvent());
  };

  // Use the existing event-volume implementation through the hidden legacy
  // control, preserving current gain behavior and compatibility.
  slider.addEventListener('input', () => {
    const ev = selectedEvent();
    if (!ev) return;
    if (tooltipVol) {
      tooltipVol.value = slider.value;
      tooltipVol.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      ev.gain = Number(slider.value) / 100;
    }
    updateBar(ev);
    if (typeof updateLogRow === 'function') updateLogRow(ev);
    if (typeof drawWaveform === 'function') drawWaveform();
  });

  change.addEventListener('click', e => {
    e.preventDefault();
    e.stopImmediatePropagation();
    const ev = selectedEvent();
    if (ev && typeof openChangeModal === 'function') openChangeModal(ev.id);
  }, true);

  close.addEventListener('click', e => {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (typeof hideTooltip === 'function') hideTooltip();
    else updateBar(null);
  }, true);

  // Initial state.
  updateBar();
})();
