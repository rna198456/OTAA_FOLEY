/**
 * audio.js — Foley Recorder · Audio Engine
 *
 * Responsabilidades:
 *  - Síntesis procedural de samples builtin (WebAudio)
 *  - Carga y playback de samples de usuario (WAV/MP3)
 *  - Render offline post-grabación → WAV (sin latencia)
 *  - Codificación PCM → WAV blob
 */

'use strict';

window.AudioEngine = (() => {

  // ── Estado interno ──────────────────────────────────────────────────────
  let _ctx = null;
  const _userBuffers = {};   // id → AudioBuffer (samples cargados por el usuario)

  // ── AudioContext (lazy, requiere gesto de usuario) ──────────────────────
  function getCtx() {
    if (!_ctx) {
      _ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (_ctx.state === 'suspended') _ctx.resume();
    return _ctx;
  }

  // ── Configuración tonal por categoría ──────────────────────────────────
  const SYNTH_CONFIGS = {
    w1: { freq: 220, q: 9,  noiseFreq: 2200, noiseLen: 0.13, decay: 0.30, gain: 0.72 },
    w2: { freq: 200, q: 8,  noiseFreq: 2000, noiseLen: 0.14, decay: 0.32, gain: 0.70 },
    w3: { freq: 175, q: 7,  noiseFreq: 1800, noiseLen: 0.16, decay: 0.35, gain: 0.68 },
    c1: { freq:  90, q: 3,  noiseFreq: 3000, noiseLen: 0.08, decay: 0.22, gain: 0.75 },
    c2: { freq:  75, q: 2,  noiseFreq: 2800, noiseLen: 0.10, decay: 0.25, gain: 0.73 },
    g1: { freq: 160, q: 1,  noiseFreq:  900, noiseLen: 0.24, decay: 0.40, gain: 0.65 },
    g2: { freq: 140, q: 1,  noiseFreq:  800, noiseLen: 0.28, decay: 0.44, gain: 0.62 },
    m1: { freq: 520, q: 22, noiseFreq: 4000, noiseLen: 0.05, decay: 0.50, gain: 0.60 },
    m2: { freq: 440, q: 18, noiseFreq: 3500, noiseLen: 0.07, decay: 0.55, gain: 0.58 },
  };

  function _defaultConfig(id) {
    if (id.startsWith('w')) return SYNTH_CONFIGS.w1;
    if (id.startsWith('c')) return SYNTH_CONFIGS.c1;
    if (id.startsWith('g')) return SYNTH_CONFIGS.g1;
    if (id.startsWith('m')) return SYNTH_CONFIGS.m1;
    return SYNTH_CONFIGS.c1;
  }

  // ── Síntesis de un paso a un nodo destino ──────────────────────────────
  function _synthToNode(ctx, id, dest, when = 0) {
    const cfg = SYNTH_CONFIGS[id] || _defaultConfig(id);
    const t   = when || ctx.currentTime;

    // — Nodo raíz de ganancia
    const master = ctx.createGain();
    master.gain.setValueAtTime(cfg.gain, t);
    master.gain.exponentialRampToValueAtTime(0.001, t + cfg.decay + 0.05);
    master.connect(dest);

    // — Cuerpo tonal (oscilador + filtro bandpass)
    const osc    = ctx.createOscillator();
    const bpf    = ctx.createBiquadFilter();
    const oscGain= ctx.createGain();
    bpf.type          = 'bandpass';
    bpf.frequency.value = cfg.freq;
    bpf.Q.value         = cfg.q;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(cfg.freq * 1.6, t);
    osc.frequency.exponentialRampToValueAtTime(cfg.freq * 0.5, t + 0.055);
    oscGain.gain.setValueAtTime(0.55, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + cfg.decay);
    osc.connect(bpf); bpf.connect(oscGain); oscGain.connect(master);
    osc.start(t); osc.stop(t + cfg.decay + 0.06);

    // — Burst de ruido (textura de superficie)
    const nLen    = Math.ceil(ctx.sampleRate * cfg.noiseLen);
    const nBuf    = ctx.createBuffer(1, nLen, ctx.sampleRate);
    const nData   = nBuf.getChannelData(0);
    for (let i = 0; i < nLen; i++) nData[i] = Math.random() * 2 - 1;
    const nSrc    = ctx.createBufferSource();
    const hpf     = ctx.createBiquadFilter();
    const nGain   = ctx.createGain();
    nSrc.buffer       = nBuf;
    hpf.type          = 'highpass';
    hpf.frequency.value = cfg.noiseFreq;
    nGain.gain.setValueAtTime(0.45, t);
    nGain.gain.exponentialRampToValueAtTime(0.001, t + cfg.noiseLen);
    nSrc.connect(hpf); hpf.connect(nGain); nGain.connect(master);
    nSrc.start(t); nSrc.stop(t + cfg.noiseLen + 0.02);
  }

  // ── Playback de un sample de usuario a un nodo destino ─────────────────
  function _userSampleToNode(ctx, id, dest, when = 0) {
    const buf = _userBuffers[id];
    if (!buf) return;
    const src  = ctx.createBufferSource();
    const gain = ctx.createGain();
    src.buffer = buf;
    gain.gain.setValueAtTime(0.85, when || ctx.currentTime);
    src.connect(gain); gain.connect(dest);
    src.start(when || ctx.currentTime);
  }

  // ── API pública ─────────────────────────────────────────────────────────

  /**
   * Carga un archivo de audio de usuario.
   * Devuelve { id, name } para registrar en la biblioteca.
   */
  async function loadUserSample(file) {
    const ctx = getCtx();
    const ab  = await file.arrayBuffer();
    const buf = await ctx.decodeAudioData(ab);
    const id  = 'u_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    _userBuffers[id] = buf;
    return { id, name: file.name.replace(/\.[^.]+$/, '') };
  }

  /**
   * Reproduce un sample en tiempo real (preview / durante grabación).
   * isUser: si el sample es de usuario o builtin.
   */
  function playSample(id, isUser) {
    const ctx = getCtx();
    if (isUser) {
      _userSampleToNode(ctx, id, ctx.destination);
    } else {
      _synthToNode(ctx, id, ctx.destination);
    }
  }

  /**
   * Render offline de todos los eventos grabados → WAV blob.
   *
   * @param {Array}  events   [{ sampleId, isUser, time }]  (time en segundos de video)
   * @param {number} duration Duración total del video (segundos)
   * @param {number} sampleRate Tasa de muestreo (default 44100)
   * @returns {Promise<Blob>}  WAV blob listo para descargar
   */
  async function renderToWav(events, duration, sampleRate = 44100) {
    if (!events.length) throw new Error('Sin eventos para renderizar');

    // Agregar 0.6 s de cola para que el último sample no quede cortado
    const totalDuration = duration + 0.6;
    const offCtx = new OfflineAudioContext(2, Math.ceil(totalDuration * sampleRate), sampleRate);

    for (const ev of events) {
      const when = Math.max(0, ev.time);
      if (ev.isUser) {
        _userSampleToNode(offCtx, ev.sampleId, offCtx.destination, when);
      } else {
        _synthToNode(offCtx, ev.sampleId, offCtx.destination, when);
      }
    }

    const rendered = await offCtx.startRendering();
    return _audioBufferToWav(rendered);
  }

  /**
   * Convierte un AudioBuffer a Blob WAV (PCM 16-bit, stereo).
   */
  function _audioBufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sr          = buffer.sampleRate;
    const numFrames   = buffer.length;
    const bitDepth    = 16;
    const bytesPerSample = bitDepth / 8;
    const blockAlign  = numChannels * bytesPerSample;
    const byteRate    = sr * blockAlign;
    const dataSize    = numFrames * blockAlign;
    const headerSize  = 44;
    const totalSize   = headerSize + dataSize;

    const arrayBuffer = new ArrayBuffer(totalSize);
    const view        = new DataView(arrayBuffer);

    // RIFF header
    _writeString(view, 0,  'RIFF');
    view.setUint32(4,  totalSize - 8,         true);
    _writeString(view, 8,  'WAVE');
    _writeString(view, 12, 'fmt ');
    view.setUint32(16, 16,                    true);  // chunk size
    view.setUint16(20, 1,                     true);  // PCM
    view.setUint16(22, numChannels,           true);
    view.setUint32(24, sr,                    true);
    view.setUint32(28, byteRate,              true);
    view.setUint16(32, blockAlign,            true);
    view.setUint16(34, bitDepth,              true);
    _writeString(view, 36, 'data');
    view.setUint32(40, dataSize,              true);

    // PCM samples (interleaved, clamped to [-1, 1])
    let offset = 44;
    for (let i = 0; i < numFrames; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = buffer.getChannelData(ch < buffer.numberOfChannels ? ch : 0)[i];
        const clamped = Math.max(-1, Math.min(1, sample));
        view.setInt16(offset, clamped * 0x7FFF, true);
        offset += 2;
      }
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
  }

  function _writeString(view, offset, str) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  // ── Expose ──────────────────────────────────────────────────────────────
  return { getCtx, loadUserSample, playSample, renderToWav };

})();
