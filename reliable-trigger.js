/* reliable-trigger.js — OTAA_FOLEY
 * Reliable layer playback for sidebar + recording trigger.
 *
 * Guarantees:
 * - every active surface is represented as its own layer;
 * - all WAVs for each footwear+surface combination are preloaded before play;
 * - each combination uses a shuffle-bag, so every available sample is heard
 *   once before any sample repeats (when there are multiple samples);
 * - all selected surfaces play together on the same trigger;
 * - the exact rrIdx used is stored in the recorded event for deterministic
 *   preview/export later.
 */
'use strict';

(() => {
  if (typeof S === 'undefined') return;

  const btnTrigger = document.getElementById('btn-trigger');
  const video = document.getElementById('video-el');
  if (!btnTrigger || !video) return;

  const bags = new Map();
  const lastPicked = new Map();
  let busy = false;

  function layersFromCurrentSelection() {
    if (typeof buildLayers !== 'function') return [];
    return (buildLayers() || []).filter(layer => layer && layer.surface);
  }

  function shuffle(values) {
    for (let i = values.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [values[i], values[j]] = [values[j], values[i]];
    }
    return values;
  }

  function nextIndex(key, total) {
    if (total <= 1) return 0;
    let bag = bags.get(key);
    if (!bag || bag.length === 0) {
      bag = shuffle(Array.from({ length: total }, (_, i) => i));
      const previous = lastPicked.get(key);
      if (previous !== undefined && bag[0] === previous) {
        const swapWith = 1 + Math.floor(Math.random() * (bag.length - 1));
        [bag[0], bag[swapWith]] = [bag[swapWith], bag[0]];
      }
    }
    const idx = bag.shift();
    bags.set(key, bag);
    lastPicked.set(key, idx);
    return idx;
  }

  function canonicalize(layers) {
    const surfaces = S.lib?.surfaces || [];
    return layers.map(layer => {
      const surface = surfaces.find(s => s.id === layer.surface?.id) || layer.surface;
      return { ...layer, surface };
    }).filter(layer => layer.surface);
  }

  async function triggerReliable() {
    if (busy || !S.videoLoaded) return;
    const layers = canonicalize(layersFromCurrentSelection());
    if (!layers.length) return;

    busy = true;
    try {
      AudioEngine.getCtx();
      if (typeof AudioEngine.preloadLayers === 'function') {
        await AudioEngine.preloadLayers(layers);
      }

      const now = AudioEngine.getCtx().currentTime + 0.01;
      const playable = layers.map(layer => {
        const total = Array.isArray(layer.surface?.samples) ? layer.surface.samples.length : 0;
        const key = `${layer.fwId}_${layer.surface.id}`;
        const rrIdx = nextIndex(key, total);
        return { ...layer, rrIdx };
      });

      AudioEngine.scheduleLayers(playable, now);

      btnTrigger.classList.add('flash');
      setTimeout(() => btnTrigger.classList.remove('flash'), 100);

      if (S.isRecording) {
        const fw = S.selectedFw;
        const ev = {
          id: typeof newId === 'function' ? newId() : `ev_${Date.now()}`,
          time: video.currentTime,
          gain: 1.0,
          layers: playable.map(layer => ({
            fwId: layer.fwId,
            surface: layer.surface,
            gainMult: layer.gainMult ?? 1,
            rrIdx: Number.isFinite(layer.rrIdx) ? layer.rrIdx : 0,
          })),
          label: `${fw?.emoji || '👣'} ${fw?.label || playable[0].fwId} · ${playable.map(l => l.surface.label).join('+')}`,
          color: playable[0]?.surface?.color || '#D4870A',
        };
        S.events.push(ev);
        if (typeof updateEventCount === 'function') updateEventCount();
        if (typeof addLogRow === 'function') addLogRow(ev);
        if (typeof drawWaveform === 'function') drawWaveform();
      }
    } finally {
      busy = false;
    }
  }

  btnTrigger.addEventListener('pointerdown', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!btnTrigger.disabled) triggerReliable();
  }, true);

  window.addEventListener('keydown', event => {
    if (event.code !== 'Space' || event.repeat) return;
    const target = event.target;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (!S.isRecording) return;
    if (btnTrigger.disabled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    triggerReliable();
  }, true);

  // After lateral footwear/surface changes, preload the complete active set.
  document.addEventListener('pointerup', event => {
    const el = event.target?.closest?.('.fw-btn, .surf-check');
    if (!el) return;
    setTimeout(() => {
      const layers = canonicalize(layersFromCurrentSelection());
      if (layers.length && typeof AudioEngine.preloadLayers === 'function') {
        AudioEngine.preloadLayers(layers).catch(() => {});
      }
    }, 0);
  }, true);

  // After applying an individual or group combination, prepare every edited
  // event immediately rather than waiting for the next preview.
  document.addEventListener('click', event => {
    const el = event.target?.closest?.('#modal-content .btn-amber');
    if (!el) return;
    setTimeout(() => {
      if (typeof normalizeEvents === 'function') normalizeEvents();
      const allLayers = (S.events || []).flatMap(ev => ev.layers || []);
      if (typeof AudioEngine.preloadLayers === 'function' && allLayers.length) {
        AudioEngine.preloadLayers(allLayers).catch(() => {});
      }
    }, 0);
  }, true);

  window.triggerReliableFoley = triggerReliable;
})();
