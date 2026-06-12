/**
 * audio.js — Foley Recorder v4 · Audio Engine
 * - Síntesis procedural por categoría calzado+superficie
 * - Carga/caché de buffers desde servidor
 * - Round-robin por combo (catKey = fw_surface)
 * - Render offline 48 kHz con layers y gain por capa
 */
'use strict';

window.AudioEngine = (() => {

  let _ctx = null;
  const _buffers  = {};   // url    → AudioBuffer
  const _userBufs = {};   // id     → AudioBuffer
  const _rrIdx    = {};   // catKey → int (round-robin counter)

  function getCtx() {
    if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (_ctx.state === 'suspended') _ctx.resume();
    return _ctx;
  }

  // ── Buffer fetch & cache ────────────────────────────────────────────────
  async function _fetch(url) {
    if (_buffers[url]) return _buffers[url];
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await getCtx().decodeAudioData(await res.arrayBuffer());
      _buffers[url] = buf;
      return buf;
    } catch (e) {
      console.warn('[audio] Cannot load', url, e.message);
      return null;
    }
  }

  async function preloadSurface(fwId, surface) {
    const files = _resolveFiles(fwId, surface);
    await Promise.all(files.map(f => _fetch(f.file)));
  }

  // Resolve {{fw}} template
  function _resolveFiles(fwId, surface) {
    return (surface.samples || []).map(s => ({
      ...s,
      file: s.file.replace('{{fw}}', fwId),
    }));
  }

  // ── Round-robin ─────────────────────────────────────────────────────────
  function _pickBuffer(catKey, files) {
    if (!files.length) return { buf: null, idx: 0 };
    if (_rrIdx[catKey] === undefined) _rrIdx[catKey] = 0;
    const idx = _rrIdx[catKey] % files.length;
    _rrIdx[catKey]++;
    return { buf: _buffers[files[idx].file] || null, idx };
  }

  function getRrIdx(catKey, total) {
    return total ? (_rrIdx[catKey] || 0) % total : 0;
  }

  // ── User sample ─────────────────────────────────────────────────────────
  async function loadUserSample(file) {
    const ctx = getCtx();
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    const id  = 'u_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    _userBufs[id] = buf;
    return { id, name: file.name.replace(/\.[^.]+$/, '') };
  }

  // ── Synthesis (fallback) ────────────────────────────────────────────────
  // Maps fw+surface → synthesis character
  const SYNTH = {
    // Bota
    bota_asfalto:     { freq:190, q:9,  nf:2200, nl:.10, dc:.28, g:.72 },
    bota_madera:      { freq:200, q:8,  nf:2000, nl:.12, dc:.30, g:.70 },
    bota_hojas:       { freq:140, q:2,  nf: 600, nl:.26, dc:.36, g:.60 },
    bota_pasto:       { freq:130, q:2,  nf: 500, nl:.22, dc:.32, g:.58 },
    bota_piedras:     { freq:160, q:3,  nf:1000, nl:.18, dc:.34, g:.65 },
    bota_arenosa:     { freq:150, q:2,  nf: 700, nl:.22, dc:.38, g:.63 },
    bota_humeda:      { freq:140, q:4,  nf:1200, nl:.18, dc:.34, g:.67 },
    bota_agua:        { freq:120, q:2,  nf: 600, nl:.28, dc:.45, g:.62 },
    // Zapatilla
    zapatilla_asfalto:{ freq:230, q:8,  nf:2600, nl:.08, dc:.22, g:.68 },
    zapatilla_madera: { freq:220, q:7,  nf:2400, nl:.09, dc:.24, g:.67 },
    zapatilla_hojas:  { freq:120, q:1,  nf: 500, nl:.24, dc:.32, g:.55 },
    zapatilla_pasto:  { freq:110, q:1,  nf: 450, nl:.20, dc:.28, g:.53 },
    zapatilla_piedras:{ freq:170, q:3,  nf:1100, nl:.16, dc:.30, g:.62 },
    zapatilla_arenosa:{ freq:200, q:2,  nf: 800, nl:.20, dc:.35, g:.61 },
    zapatilla_humeda: { freq:170, q:4,  nf:1100, nl:.16, dc:.30, g:.64 },
    zapatilla_agua:   { freq:150, q:2,  nf: 650, nl:.25, dc:.40, g:.60 },
    // Taco
    taco_asfalto:     { freq:420, q:20, nf:3800, nl:.05, dc:.20, g:.78 },
    taco_madera:      { freq:400, q:18, nf:3600, nl:.06, dc:.22, g:.76 },
    taco_hojas:       { freq:240, q:4,  nf:1200, nl:.10, dc:.24, g:.60 },
    taco_pasto:       { freq:220, q:3,  nf:1000, nl:.12, dc:.26, g:.58 },
    taco_piedras:     { freq:340, q:10, nf:2400, nl:.08, dc:.26, g:.70 },
    taco_arenosa:     { freq:300, q:5,  nf:1000, nl:.14, dc:.30, g:.65 },
    taco_humeda:      { freq:280, q:8,  nf:1500, nl:.12, dc:.28, g:.68 },
    taco_agua:        { freq:220, q:4,  nf: 700, nl:.20, dc:.36, g:.62 },
    // Descalzo
    descalzo_asfalto: { freq:150, q:4,  nf:1800, nl:.12, dc:.24, g:.60 },
    descalzo_madera:  { freq:140, q:3,  nf:1500, nl:.14, dc:.26, g:.59 },
    descalzo_hojas:   { freq:100, q:1,  nf: 300, nl:.30, dc:.38, g:.48 },
    descalzo_pasto:   { freq: 90, q:1,  nf: 280, nl:.28, dc:.36, g:.46 },
    descalzo_piedras: { freq:120, q:2,  nf: 800, nl:.18, dc:.30, g:.55 },
    descalzo_arenosa: { freq:120, q:1,  nf: 500, nl:.26, dc:.40, g:.54 },
    descalzo_humeda:  { freq:110, q:2,  nf: 800, nl:.20, dc:.34, g:.57 },
    descalzo_agua:    { freq:100, q:1,  nf: 400, nl:.32, dc:.48, g:.52 },
    default:          { freq:180, q:5,  nf:1800, nl:.12, dc:.28, g:.65 },
  };

  function _synthToNode(ctx, catKey, dest, when, gainMult) {
    const t   = Math.max(when, ctx.currentTime + 0.001);
    const cfg = SYNTH[catKey] || SYNTH.default;
    const gv  = cfg.g * (gainMult ?? 1);

    const master = ctx.createGain();
    master.gain.setValueAtTime(gv, t);
    master.gain.exponentialRampToValueAtTime(0.001, t + cfg.dc + .05);
    master.connect(dest);

    const osc = ctx.createOscillator();
    const bpf = ctx.createBiquadFilter();
    const og  = ctx.createGain();
    bpf.type = 'bandpass'; bpf.frequency.value = cfg.freq; bpf.Q.value = cfg.q;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(cfg.freq * 1.6, t);
    osc.frequency.exponentialRampToValueAtTime(cfg.freq * .5, t + .055);
    og.gain.setValueAtTime(.55, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + cfg.dc);
    osc.connect(bpf); bpf.connect(og); og.connect(master);
    osc.start(t); osc.stop(t + cfg.dc + .07);

    const nLen = Math.ceil(ctx.sampleRate * cfg.nl);
    const nb   = ctx.createBuffer(1, nLen, ctx.sampleRate);
    const nd   = nb.getChannelData(0);
    for (let i = 0; i < nLen; i++) nd[i] = Math.random() * 2 - 1;
    const ns  = ctx.createBufferSource();
    const hpf = ctx.createBiquadFilter();
    const ng  = ctx.createGain();
    ns.buffer = nb; hpf.type = 'highpass'; hpf.frequency.value = cfg.nf;
    ng.gain.setValueAtTime(.45, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + cfg.nl);
    ns.connect(hpf); hpf.connect(ng); ng.connect(master);
    ns.start(t); ns.stop(t + cfg.nl + .03);
  }

  function _bufToNode(ctx, buf, dest, when, gainMult) {
    const t   = Math.max(when, ctx.currentTime + 0.001);
    const src = ctx.createBufferSource();
    const g   = ctx.createGain();
    src.buffer = buf;
    g.gain.setValueAtTime(.85 * (gainMult ?? 1), t);
    src.connect(g); g.connect(dest);
    src.start(t);
    return src;
  }

  // ── Play a single layer ─────────────────────────────────────────────────
  // layer: { fwId, surface, files, gainMult }
  // Returns { rrIdx }
  function _playLayer(ctx, dest, when, layer) {
    const catKey = `${layer.fwId}_${layer.surface.id}`;
    const files  = _resolveFiles(layer.fwId, layer.surface);
    const { buf, idx } = _pickBuffer(catKey, files);
    if (buf) {
      _bufToNode(ctx, buf, dest, when, layer.gainMult ?? 1);
    } else {
      _synthToNode(ctx, catKey, dest, when, layer.gainMult ?? 1);
    }
    return { rrIdx: idx, catKey };
  }

  // ── Public: play all active layers (real-time) ──────────────────────────
  // layers: [{ fwId, surface, files, gainMult, rrIdx }]
  // Returns array of { rrIdx, catKey } per layer
  function playLayers(layers) {
    const ctx = getCtx();
    const now = ctx.currentTime;
    return layers.map(layer => _playLayer(ctx, ctx.destination, now, layer));
  }

  // ── Public: schedule layers at precise time (preview) ──────────────────
  function scheduleLayers(layers, when) {
    const ctx = getCtx();
    layers.forEach(layer => {
      const catKey = `${layer.fwId}_${layer.surface.id}`;
      const files  = _resolveFiles(layer.fwId, layer.surface);
      const file   = files[layer.rrIdx % Math.max(1, files.length)];
      const buf    = file ? _buffers[file.file] : null;
      if (buf) {
        _bufToNode(ctx, ctx.destination, when, { ...layer, gainMult: layer.gainMult ?? 1 });
      } else {
        _synthToNode(ctx, catKey, ctx.destination, when, layer.gainMult ?? 1);
      }
    });
  }

  // ── Public: offline render 48 kHz ───────────────────────────────────────
  // events: [{ time, gain, layers:[{ fwId, surface, rrIdx, gainMult }] }]
  async function renderToWav(events, duration, sr = 48000) {
    if (!events.length) throw new Error('Sin eventos');
    const offCtx = new OfflineAudioContext(2, Math.ceil((duration + 0.8) * sr), sr);

    for (const ev of events) {
      const when     = Math.max(0, ev.time);
      const evGain   = ev.gain ?? 1;
      const masterG  = offCtx.createGain();
      masterG.gain.value = evGain;
      masterG.connect(offCtx.destination);

      for (const layer of (ev.layers || [])) {
        const catKey = `${layer.fwId}_${layer.surface.id}`;
        const files  = _resolveFiles(layer.fwId, layer.surface);
        const file   = files[layer.rrIdx % Math.max(1, files.length)];
        const buf    = file ? _buffers[file.file] : null;
        if (buf) {
          _bufToNode(offCtx, buf, masterG, when, layer.gainMult ?? 1);
        } else {
          _synthToNode(offCtx, catKey, masterG, when, layer.gainMult ?? 1);
        }
      }
    }

    return _toWav(await offCtx.startRendering());
  }

  function _toWav(buffer) {
    const nCh = buffer.numberOfChannels, sr = buffer.sampleRate, n = buffer.length;
    const blk = nCh * 2, ab = new ArrayBuffer(44 + n * blk), v = new DataView(ab);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    ws(0,'RIFF'); v.setUint32(4, 36 + n * blk, true);
    ws(8,'WAVE'); ws(12,'fmt '); v.setUint32(16, 16, true);
    v.setUint16(20,1,true); v.setUint16(22,nCh,true);
    v.setUint32(24,sr,true); v.setUint32(28,sr*blk,true);
    v.setUint16(32,blk,true); v.setUint16(34,16,true);
    ws(36,'data'); v.setUint32(40,n*blk,true);
    let o = 44;
    for (let i = 0; i < n; i++)
      for (let c = 0; c < nCh; c++) {
        v.setInt16(o, Math.max(-1,Math.min(1,buffer.getChannelData(c)[i])) * 0x7FFF, true);
        o += 2;
      }
    return new Blob([ab], { type: 'audio/wav' });
  }

  return { getCtx, preloadSurface, loadUserSample, playLayers, scheduleLayers, renderToWav, getRrIdx };
})();
