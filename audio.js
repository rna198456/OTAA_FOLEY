/**
 * audio.js — Foley Recorder v2 · Audio Engine
 *
 * Features:
 *  - Síntesis procedural por categoría (fallback si no hay WAV)
 *  - Carga de buffers desde servidor (WAV/MP3) con caché
 *  - Carga de samples de usuario
 *  - Round-robin dentro de cada categoría
 *  - Render offline → WAV 16-bit stereo (sin latencia de UI)
 */

'use strict';

window.AudioEngine = (() => {

  let _ctx = null;

  // Buffer caches
  const _serverBuffers = {};   // url  → AudioBuffer
  const _userBuffers   = {};   // id   → AudioBuffer

  // Round-robin counters per category id
  const _rrCounters = {};

  function getCtx() {
    if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (_ctx.state === 'suspended') _ctx.resume();
    return _ctx;
  }

  // ── Fetch + decode a server WAV/MP3, with cache ─────────────────────────
  async function _fetchBuffer(url) {
    if (_serverBuffers[url]) return _serverBuffers[url];
    const ctx = getCtx();
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ab  = await res.arrayBuffer();
      const buf = await ctx.decodeAudioData(ab);
      _serverBuffers[url] = buf;
      return buf;
    } catch (e) {
      console.warn(`[audio] Could not load ${url}:`, e.message);
      return null;
    }
  }

  // ── Pre-load all files declared in a category ───────────────────────────
  async function preloadCategory(categoryDef) {
    const urls = categoryDef.samples.map(s => s.file);
    await Promise.all(urls.map(_fetchBuffer));
  }

  // ── Pick next buffer for a category (round-robin) ──────────────────────
  function _pickBuffer(catId, sampleFiles) {
    if (!_rrCounters[catId]) _rrCounters[catId] = 0;
    const idx = _rrCounters[catId] % sampleFiles.length;
    _rrCounters[catId]++;
    const url = sampleFiles[idx].file;
    return { buf: _serverBuffers[url] || null, idx, url };
  }

  // ── Load user file ──────────────────────────────────────────────────────
  async function loadUserSample(file) {
    const ctx = getCtx();
    const ab  = await file.arrayBuffer();
    const buf = await ctx.decodeAudioData(ab);
    const id  = 'u_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
    _userBuffers[id] = buf;
    return { id, name: file.name.replace(/\.[^.]+$/, '') };
  }

  // ── Synth configs (fallback when WAV not loaded) ────────────────────────
  const SYNTH = {
    madera:  { freq:210, q:8,  nf:2100, nl:.13, dc:.30, g:.70 },
    parquet: { freq:190, q:7,  nf:2000, nl:.14, dc:.32, g:.68 },
    cemento: { freq: 80, q:3,  nf:3000, nl:.08, dc:.22, g:.75 },
    grava:   { freq:150, q:1,  nf: 900, nl:.24, dc:.40, g:.65 },
    metal:   { freq:500, q:20, nf:4000, nl:.05, dc:.50, g:.60 },
    default: { freq:160, q:4,  nf:2000, nl:.10, dc:.28, g:.68 },
  };

  function _synthToNode(ctx, catId, dest, when) {
    const t   = when || ctx.currentTime;
    const cfg = SYNTH[catId] || SYNTH.default;
    const master = ctx.createGain();
    master.gain.setValueAtTime(cfg.g, t);
    master.gain.exponentialRampToValueAtTime(0.001, t + cfg.dc + .05);
    master.connect(dest);

    const osc = ctx.createOscillator();
    const bpf = ctx.createBiquadFilter();
    const og  = ctx.createGain();
    bpf.type = 'bandpass'; bpf.frequency.value = cfg.freq; bpf.Q.value = cfg.q;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(cfg.freq*1.6, t);
    osc.frequency.exponentialRampToValueAtTime(cfg.freq*.5, t+.055);
    og.gain.setValueAtTime(.55, t);
    og.gain.exponentialRampToValueAtTime(0.001, t+cfg.dc);
    osc.connect(bpf); bpf.connect(og); og.connect(master);
    osc.start(t); osc.stop(t+cfg.dc+.06);

    const nLen = Math.ceil(ctx.sampleRate * cfg.nl);
    const nb   = ctx.createBuffer(1, nLen, ctx.sampleRate);
    const nd   = nb.getChannelData(0);
    for (let i=0;i<nLen;i++) nd[i]=Math.random()*2-1;
    const ns = ctx.createBufferSource();
    const hpf= ctx.createBiquadFilter();
    const ng = ctx.createGain();
    ns.buffer=nb; hpf.type='highpass'; hpf.frequency.value=cfg.nf;
    ng.gain.setValueAtTime(.45,t);
    ng.gain.exponentialRampToValueAtTime(0.001,t+cfg.nl);
    ns.connect(hpf); hpf.connect(ng); ng.connect(master);
    ns.start(t); ns.stop(t+cfg.nl+.02);
  }

  function _bufferToNode(ctx, buf, dest, when) {
    const t   = when || ctx.currentTime;
    const src = ctx.createBufferSource();
    const g   = ctx.createGain();
    src.buffer = buf;
    g.gain.setValueAtTime(.85, t);
    src.connect(g); g.connect(dest);
    src.start(t);
  }

  // ── Public: play sample (real-time preview) ─────────────────────────────
  // Returns the rr index used (for display)
  function playSample(catId, sampleFiles, isUser, userId) {
    const ctx = getCtx();
    if (isUser) {
      const buf = _userBuffers[userId];
      if (buf) _bufferToNode(ctx, buf, ctx.destination);
      return { rrIdx: 0 };
    }
    const { buf, idx } = _pickBuffer(catId, sampleFiles);
    if (buf) {
      _bufferToNode(ctx, buf, ctx.destination);
    } else {
      _synthToNode(ctx, catId, ctx.destination);
    }
    return { rrIdx: idx };
  }

  // ── Public: render offline → WAV blob ──────────────────────────────────
  // events: [{ catId, sampleFiles, rrIdx, isUser, userId, time }]
  async function renderToWav(events, duration, sr = 44100) {
    if (!events.length) throw new Error('Sin eventos');
    const total   = duration + 0.8;
    const offCtx  = new OfflineAudioContext(2, Math.ceil(total * sr), sr);

    for (const ev of events) {
      const when = Math.max(0, ev.time);
      if (ev.isUser) {
        const buf = _userBuffers[ev.userId];
        if (buf) _bufferToNode(offCtx, buf, offCtx.destination, when);
      } else {
        // Use the exact rrIdx stored at record time
        const fileEntry = ev.sampleFiles[ev.rrIdx % ev.sampleFiles.length];
        const buf = _serverBuffers[fileEntry.file];
        if (buf) {
          _bufferToNode(offCtx, buf, offCtx.destination, when);
        } else {
          _synthToNode(offCtx, ev.catId, offCtx.destination, when);
        }
      }
    }

    const rendered = await offCtx.startRendering();
    return _toWav(rendered);
  }

  function _toWav(buffer) {
    const nCh = buffer.numberOfChannels;
    const sr  = buffer.sampleRate;
    const n   = buffer.length;
    const bps = 2; // 16-bit
    const blk = nCh * bps;
    const ab  = new ArrayBuffer(44 + n * blk);
    const v   = new DataView(ab);
    const ws  = (o,s) => { for(let i=0;i<s.length;i++) v.setUint8(o+i,s.charCodeAt(i)); };
    ws(0,'RIFF'); v.setUint32(4,36+n*blk,true);
    ws(8,'WAVE'); ws(12,'fmt '); v.setUint32(16,16,true);
    v.setUint16(20,1,true); v.setUint16(22,nCh,true);
    v.setUint32(24,sr,true); v.setUint32(28,sr*blk,true);
    v.setUint16(32,blk,true); v.setUint16(34,16,true);
    ws(36,'data'); v.setUint32(40,n*blk,true);
    let o=44;
    for(let i=0;i<n;i++){
      for(let c=0;c<nCh;c++){
        const s=Math.max(-1,Math.min(1,buffer.getChannelData(c<buffer.numberOfChannels?c:0)[i]));
        v.setInt16(o,s*0x7FFF,true); o+=2;
      }
    }
    return new Blob([ab],{type:'audio/wav'});
  }

  // ── Public: current rr index for a category (for display only) ─────────
  function getRrIdx(catId, total) {
    if (!total) return 0;
    return (_rrCounters[catId] || 0) % total;
  }

  return { getCtx, preloadCategory, loadUserSample, playSample, renderToWav, getRrIdx };

})();
