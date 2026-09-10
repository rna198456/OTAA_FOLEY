/* final-fixes.js — OTAA_FOLEY
 * Final interaction layer:
 * - removes the visible ENSAYO/GRABACION mode selector
 * - keeps REPRODUCCION as the only playback control
 * - Space only fires Foley while recording
 * - larger, sharper timeline with 128x zoom
 * - zoom keeps selected event / playhead focused
 * - event gain drag works against the real canvas height
 * - drag-select multiple events and delete them together
 * - robust event-combination editing
 * - WAV export: 48 kHz / 24-bit stereo, numbered filenames
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

  if (!video || !canvas || !outer || !timelinePanel) return;

  /* ---------------------------------------------------------------
   * Hide obsolete ENSAYO/GRABACION UI. The playback button itself
   * is now the way to audition video before recording.
   * ------------------------------------------------------------- */
  const modeControl = document.getElementById('mode-control');
  if (modeControl) modeControl.remove();

  /* ---------------------------------------------------------------
   * Timeline rendering: same visual language, but the canvas now
   * has a real 120px drawing height, so drag-volume coordinates match.
   * ------------------------------------------------------------- */
  const selectedIds = new Set();
  let selectionDrag = null;
  const H = 120;

  function drawTimeline() {
    const W = outer.clientWidth || 400;
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    canvas.style.height = H + 'px';

    const ctx = canvas.getContext('2d');
    const vis = (S.videoDuration || 10) / S.zoom;
    const MID = H / 2;
    const MAXAMP = MID * 0.78;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0D0D0F';
    ctx.fillRect(0, 0, W, H);

    const gridN = Math.max(4, Math.min(28, Math.round(S.zoom * 5)));
    ctx.strokeStyle = '#1E1E22';
    ctx.lineWidth = 1;
    for (let i = 1; i < gridN; i++) {
      const x = (i / gridN) * W;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(0, MID); ctx.lineTo(W, MID); ctx.stroke();

    ctx.fillStyle = '#3A3A3E';
    ctx.font = '9px IBM Plex Mono,monospace';
    ctx.textAlign = 'left';
    const step = vis / gridN;
    for (let i = 0; i <= gridN; i++) {
      const t = S.scrollOffset + i * step;
      if (t > (S.videoDuration || 0) + 0.02) break;
      ctx.fillText(fmt(t), (i / gridN) * W + 3, H - 4);
    }

    S.events.forEach(ev => {
      const x = timeToX(ev.time);
      if (x < -14 || x > W + 14) return;
      const gain = Math.max(0, Math.min(2, ev.gain ?? 1));
      const amp = Math.max(6, MAXAMP * gain / 2);
      const col = ev.color || '#D4870A';
      const singleSel = ev.id === S.selectedEvId;
      const multiSel = selectedIds.has(ev.id);
      const active = singleSel || multiSel;

      ctx.globalAlpha = active ? 1 : 0.82;
      ctx.strokeStyle = col;
      ctx.lineWidth = active ? 3 : 2;
      ctx.beginPath(); ctx.moveTo(x, MID); ctx.lineTo(x, MID - amp); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, MID); ctx.lineTo(x, MID + amp); ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(x, MID - amp, active ? 5 : 3.5, 0, Math.PI * 2); ctx.fill();

      if (active) {
        ctx.strokeStyle = 'rgba(255,255,255,.28)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, MID - amp, 9, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#E8E4DC';
        ctx.font = 'bold 9px IBM Plex Mono,monospace';
        ctx.textAlign = 'center';
        ctx.fillText(Math.round(gain * 100) + '%', x, MID - amp - 13);
        ctx.textAlign = 'left';
      }
      ctx.globalAlpha = 1;
    });

    const px = timeToX(video.currentTime);
    if (S.videoDuration > 0 && px >= 0 && px <= W) {
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

    if (selectionDrag) {
      const x1 = Math.max(0, Math.min(W, selectionDrag.startX));
      const x2 = Math.max(0, Math.min(W, selectionDrag.currentX));
      const left = Math.min(x1, x2);
      const width = Math.abs(x2 - x1);
      ctx.fillStyle = 'rgba(212,135,10,.10)';
      ctx.fillRect(left, 0, width, H);
      ctx.strokeStyle = 'rgba(212,135,10,.65)';
      ctx.lineWidth = 1;
      ctx.strokeRect(left + .5, .5, Math.max(1, width - 1), H - 1);
    }
  }

  const originalDrawWaveform = drawWaveform;
  drawWaveform = function () {
    drawTimeline();
  };
  drawTimeline();

  /* ---------------------------------------------------------------
   * Zoom: anchor the selected event, otherwise the playhead.
   * ------------------------------------------------------------- */
  const MAX_ZOOM = 128;
  const ZSTEP = Math.sqrt(2);
  const visibleDuration = () => (S.videoDuration || 10) / S.zoom;
  const clampScroll = () => {
    const max = Math.max(0, (S.videoDuration || 0) - visibleDuration());
    S.scrollOffset = Math.max(0, Math.min(S.scrollOffset, max));
  };
  const zoomText = z => z >= 100 ? Math.round(z) + '×' : (Math.round(z * 10) / 10) + '×';
  const updateZoom = () => {
    zoomLabel.textContent = zoomText(S.zoom);
    zoomOut.disabled = S.zoom <= 1;
    zoomIn.disabled = S.zoom >= MAX_ZOOM;
  };
  function zoomAround(time, ratio, next) {
    S.zoom = Math.max(1, Math.min(MAX_ZOOM, next));
    S.scrollOffset = time - Math.max(0, Math.min(1, ratio)) * visibleDuration();
    clampScroll();
    updateZoom();
    drawTimeline();
    updateScrollbar();
  }
  setZoom = function (next) {
    const selected = S.events.find(ev => ev.id === S.selectedEvId);
    const focus = selected ? selected.time : video.currentTime;
    const vis = visibleDuration();
    const ratio = vis ? (focus - S.scrollOffset) / vis : .5;
    zoomAround(focus, ratio, next);
  };
  zoomIn.addEventListener('click', e => { e.preventDefault(); e.stopImmediatePropagation(); setZoom(S.zoom * ZSTEP); }, true);
  zoomOut.addEventListener('click', e => { e.preventDefault(); e.stopImmediatePropagation(); setZoom(S.zoom / ZSTEP); }, true);
  zoomFit.addEventListener('click', e => { e.preventDefault(); e.stopImmediatePropagation(); S.zoom = 1; S.scrollOffset = 0; updateZoom(); drawTimeline(); updateScrollbar(); }, true);
  outer.addEventListener('wheel', e => {
    e.preventDefault(); e.stopImmediatePropagation();
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const ratio = x / Math.max(1, canvas.offsetWidth);
    zoomAround(S.scrollOffset + ratio * visibleDuration(), ratio, S.zoom * (e.deltaY < 0 ? ZSTEP : 1 / ZSTEP));
  }, {capture:true, passive:false});
  updateZoom();

  /* ---------------------------------------------------------------
   * Robust playback preview, including per-event gain.
   * ------------------------------------------------------------- */
  const originalStopPreview = stopPreview;
  startPreview = async function () {
    if (!S.videoLoaded) return;
    S.isPreviewing = true;
    S.previewTimers.forEach(clearTimeout);
    S.previewTimers = [];
    const startAt = video.currentTime;
    S.startTimecode = startAt;
    if (S.events.length) {
      const ctx = AudioEngine.getCtx();
      S.events.filter(ev => ev.time >= startAt).forEach(ev => {
        const delay = Math.max(0, (ev.time - startAt) * 1000);
        S.previewTimers.push(setTimeout(() => {
          if (!S.isPreviewing) return;
          const eventGain = ev.gain ?? 1;
          AudioEngine.scheduleLayers((ev.layers || []).map(layer => ({
            ...layer,
            gainMult: (layer.gainMult ?? 1) * eventGain,
          })), ctx.currentTime + 0.02);
        }, delay));
      });
    }
    try {
      await video.play();
    } catch (err) {
      S.isPreviewing = false;
      S.previewTimers.forEach(clearTimeout); S.previewTimers = [];
      return;
    }
    playbackBtn.textContent = '❚❚ PAUSAR';
    if (typeof playIndicator !== 'undefined') playIndicator.classList.remove('hidden');
    startRaf();
  };
  stopPreview = function () {
    originalStopPreview();
    playbackBtn.textContent = '▶ REPRODUCCIÓN';
  };

  /* Space is exclusively for recorded steps. */
  document.addEventListener('keydown', e => {
    if (e.code !== 'Space' || e.repeat) return;
    const t = e.target;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (!S.isRecording) return;
    const trigger = document.getElementById('btn-trigger');
    if (!trigger || trigger.disabled) return;
    e.preventDefault(); e.stopImmediatePropagation();
    fireTrigger();
  }, true);

  /* ---------------------------------------------------------------
   * Multi-select by drag over empty timeline area.
   * Selection is temporal: the horizontal range covers the full height.
   * ------------------------------------------------------------- */
  function canvasPoint(e) {
    const r = canvas.getBoundingClientRect();
    return {x:e.clientX-r.left, y:e.clientY-r.top};
  }
  function eventNearX(x) {
    let best = null, d = 12;
    S.events.forEach(ev => {
      const dd = Math.abs(timeToX(ev.time) - x);
      if (dd < d) { d = dd; best = ev; }
    });
    return best;
  }
  canvas.addEventListener('pointerdown', e => {
    if (S.isRecording || S.isPreviewing || e.button !== 0) return;
    const p = canvasPoint(e);
    const hit = eventNearX(p.x);
    if (hit) { selectedIds.clear(); return; }
    selectionDrag = {startX:p.x, currentX:p.x, pointerId:e.pointerId, moved:false};
    canvas.setPointerCapture?.(e.pointerId);
  }, true);
  canvas.addEventListener('pointermove', e => {
    if (!selectionDrag || selectionDrag.pointerId !== e.pointerId) return;
    const p = canvasPoint(e);
    const dx = p.x - selectionDrag.startX;
    if (Math.abs(dx) < 6) return;
    selectionDrag.currentX = p.x;
    selectionDrag.moved = true;
    e.preventDefault(); e.stopImmediatePropagation();
    drawTimeline();
  }, true);
  function finishSelection(e) {
    if (!selectionDrag || selectionDrag.pointerId !== e.pointerId) return;
    const s = selectionDrag;
    selectionDrag = null;
    if (!s.moved) { drawTimeline(); return; }
    e.preventDefault(); e.stopImmediatePropagation();
    const a = Math.min(s.startX, s.currentX);
    const b = Math.max(s.startX, s.currentX);
    const t1 = xToTime(a), t2 = xToTime(b);
    selectedIds.clear();
    S.events.forEach(ev => { if (ev.time >= t1 && ev.time <= t2) selectedIds.add(ev.id); });
    S.selectedEvId = selectedIds.size === 1 ? [...selectedIds][0] : null;
    if (typeof hideTooltip === 'function') hideTooltip();
    drawTimeline();
    updateMultiBar();
  }
  canvas.addEventListener('pointerup', finishSelection, true);
  canvas.addEventListener('pointercancel', finishSelection, true);

  /* Keep single-event selection synchronized with the original handler. */
  canvas.addEventListener('click', () => {
    if (selectionDrag) return;
    selectedIds.clear();
    setTimeout(() => { drawTimeline(); updateMultiBar(); }, 0);
  }, true);

  const multiBar = document.createElement('div');
  multiBar.id = 'multi-selection-bar';
  multiBar.innerHTML = '<span id="multi-selection-label"></span><button id="multi-selection-delete" type="button">BORRAR SELECCIÓN</button>';
  timelinePanel.insertBefore(multiBar, document.getElementById('progress-wrap'));
  const multiLabel = document.getElementById('multi-selection-label');
  const multiDelete = document.getElementById('multi-selection-delete');
  function updateMultiBar() {
    const n = selectedIds.size;
    multiBar.classList.toggle('hidden', n < 2);
    multiLabel.textContent = n ? `${n} INSTRUCCIONES SELECCIONADAS` : '';
  }
  multiDelete.addEventListener('click', () => {
    if (selectedIds.size < 1) return;
    S.events = S.events.filter(ev => !selectedIds.has(ev.id));
    selectedIds.clear(); S.selectedEvId = null;
    if (typeof hideTooltip === 'function') hideTooltip();
    updateEventCount(); rebuildLog(); drawTimeline(); updateMultiBar();
    if (typeof btnPreview !== 'undefined') btnPreview.disabled = S.events.length === 0;
    if (typeof btnExport !== 'undefined') btnExport.disabled = S.events.length === 0;
  });
  updateMultiBar();

  document.addEventListener('keydown', e => {
    if ((e.code !== 'Delete' && e.code !== 'Backspace') || S.isRecording || selectedIds.size < 2) return;
    e.preventDefault(); e.stopImmediatePropagation();
    multiDelete.click();
  }, true);

  /* ---------------------------------------------------------------
   * Robust change-combination modal. Preserve the existing event id,
   * time and global gain; only replace its layers/label/color.
   * ------------------------------------------------------------- */
  const modalOverlay = document.getElementById('modal-overlay');
  const modalContent = document.getElementById('modal-content');
  if (modalOverlay && modalContent) {
    openChangeModal = function (evId) {
      const target = S.events.find(ev => ev.id === evId);
      if (!target) return;
      modalContent.innerHTML = '';
      const info = document.createElement('p');
      info.style.cssText='font-size:11px;color:var(--sub);margin-bottom:10px;font-family:var(--mono)';
      info.textContent='Seleccioná nuevo calzado y superficies:';
      modalContent.appendChild(info);

      let tempFw = (S.lib.footwear || []).find(f => f.id === target.layers?.[0]?.fwId) || S.lib.footwear?.[0];
      const fwRow = document.createElement('div'); fwRow.className='fw-grid'; fwRow.style.marginBottom='10px';
      (S.lib.footwear || []).forEach(fw => {
        const b=document.createElement('button'); b.className='fw-btn'+(fw.id===tempFw.id?' selected':'');
        b.innerHTML=`<span class="fw-emoji">${fw.emoji}</span><span class="fw-label">${fw.label}</span>`;
        b.addEventListener('click',()=>{tempFw=fw;fwRow.querySelectorAll('.fw-btn').forEach(x=>x.classList.toggle('selected',x===b));});
        fwRow.appendChild(b);
      });
      modalContent.appendChild(fwRow);

      const tempSurfs={};
      (target.layers || []).forEach(l=>{ if(l.surface?.id) tempSurfs[l.surface.id]={gainMult:l.gainMult ?? 1, rrIdx:l.rrIdx ?? 0}; });
      const surfWrap=document.createElement('div');
      (S.lib.surfaces || []).forEach(surf=>{
        const row=document.createElement('div'); row.className='surface-row';
        const cb=document.createElement('button'); cb.className='surf-check'+(tempSurfs[surf.id]?' selected':''); cb.style.borderColor=tempSurfs[surf.id]?surf.color||'':'';
        cb.innerHTML=`<span class="surf-emoji">${surf.emoji}</span><span class="surf-name">${surf.label}</span>`;
        const fw=document.createElement('div'); fw.className='surf-fader-wrap'+(tempSurfs[surf.id]?'':' hidden');
        const val=tempSurfs[surf.id]?.gainMult ?? 1;
        fw.innerHTML=`<input type="range" class="surf-fader" min="0" max="200" step="1" value="${Math.round(val*100)}"/><span class="surf-fader-val">${Math.round(val*100)}%</span>`;
        fw.querySelector('input').addEventListener('input',ev=>{ if(!tempSurfs[surf.id]) tempSurfs[surf.id]={gainMult:1,rrIdx:0}; tempSurfs[surf.id].gainMult=Number(ev.target.value)/100; fw.querySelector('.surf-fader-val').textContent=ev.target.value+'%'; });
        cb.addEventListener('click',()=>{
          if(tempSurfs[surf.id]){ delete tempSurfs[surf.id]; cb.classList.remove('selected'); cb.style.borderColor=''; fw.classList.add('hidden'); }
          else { tempSurfs[surf.id]={gainMult:1,rrIdx:0}; cb.classList.add('selected'); cb.style.borderColor=surf.color||''; fw.classList.remove('hidden'); }
        });
        row.appendChild(cb); row.appendChild(fw); surfWrap.appendChild(row);
      });
      modalContent.appendChild(surfWrap);

      const apply=document.createElement('button'); apply.className='btn btn-amber btn-sm'; apply.style.cssText='width:100%;margin-top:10px'; apply.textContent='Aplicar';
      apply.addEventListener('click',()=>{
        const current=S.events.find(ev=>ev.id===target.id);
        if(!current || !Object.keys(tempSurfs).length) return;
        current.layers=Object.entries(tempSurfs).map(([sid,data])=>({
          fwId:tempFw.id,
          surface:(S.lib.surfaces || []).find(s=>s.id===sid),
          gainMult:data.gainMult,
          rrIdx:data.rrIdx || 0,
        }));
        current.label=`${tempFw.emoji} ${tempFw.label} · ${current.layers.map(l=>l.surface?.label || '').join('+')}`;
        current.color=current.layers[0]?.surface?.color || '#D4870A';
        S.selectedEvId=current.id;
        closeModal(); drawTimeline(); positionTooltip(); rebuildLog(); updateMultiBar();
      });
      modalContent.appendChild(apply);
      modalOverlay.classList.remove('hidden');
    };
  }

  /* ---------------------------------------------------------------
   * 24-bit WAV export + sequential filename.
   * The existing engine renders the correct offline mix; this converts
   * its PCM WAV payload to a valid 24-bit PCM WAV container.
   * ------------------------------------------------------------- */
  if (exportBtn) {
    exportBtn.addEventListener('click', async e => {
      e.preventDefault(); e.stopImmediatePropagation();
      if (!S.events.length) return;
      exportBtn.disabled = true;
      const status=document.getElementById('export-status');
      if(status) status.textContent='Renderizando 48 kHz / 24-bit…';
      try {
        const blob16=await AudioEngine.renderToWav(S.events,S.videoDuration,48000);
        const ab=await blob16.arrayBuffer();
        const v16=new DataView(ab);
        const nCh=v16.getUint16(22,true), sr=v16.getUint32(24,true), bits=v16.getUint16(34,true);
        if(nCh!==2 || bits!==16) throw new Error('Formato base inesperado');
        const dataSize=v16.getUint32(40,true), samples=dataSize/(nCh*2);
        const out=new ArrayBuffer(44 + samples*nCh*3);
        const v=new DataView(out);
        const ws=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};
        ws(0,'RIFF'); v.setUint32(4,36 + samples*nCh*3,true); ws(8,'WAVE'); ws(12,'fmt ');
        v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,nCh,true);
        v.setUint32(24,sr,true); v.setUint32(28,sr*nCh*3,true); v.setUint16(32,nCh*3,true); v.setUint16(34,24,true);
        ws(36,'data'); v.setUint32(40,samples*nCh*3,true);
        let srcOff=44, dstOff=44;
        for(let i=0;i<samples*nCh;i++){
          const s=v16.getInt16(srcOff,true); srcOff+=2;
          const q=Math.max(-1,Math.min(1,s/32768));
          let q24=Math.round(q*8388607); if(q24<0) q24+=16777216;
          v.setUint8(dstOff,q24&255); v.setUint8(dstOff+1,(q24>>8)&255); v.setUint8(dstOff+2,(q24>>16)&255); dstOff+=3;
        }
        const countKey='otaa_foley_export_number';
        let num=Number(localStorage.getItem(countKey)||0)+1; localStorage.setItem(countKey,String(num));
        const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([out],{type:'audio/wav'}));
        a.download=`Foley Recorder OTAA ${num}.wav`; a.click();
        setTimeout(()=>URL.revokeObjectURL(a.href),2000);
        if(status){status.textContent=`✓ Foley Recorder OTAA ${num}.wav`;setTimeout(()=>status.textContent='',3500);}
      } catch(err){
        if(status) { status.textContent='Error: '+err.message; setTimeout(()=>status.textContent='',4000); }
      } finally { exportBtn.disabled=false; }
    }, true);
  }

  video.addEventListener('loadedmetadata', () => { S.zoom=1; S.scrollOffset=0; selectedIds.clear(); updateZoom(); drawTimeline(); updateScrollbar(); });
  window.addEventListener('resize', () => { drawTimeline(); updateScrollbar(); });
  setInterval(() => { drawTimeline(); updateMultiBar(); }, 200);
})();
