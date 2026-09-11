/* punch-in-removal.js — OTAA_FOLEY
 * Punch-In is obsolete in the current incremental-recording workflow.
 * This compatibility layer removes the legacy control after enhancements.js
 * creates it, while leaving the normal GRABAR flow untouched.
 */
'use strict';

(() => {
  if (typeof S === 'undefined') return;

  const removeLegacyPunchUI = () => {
    document.getElementById('punch-control')?.remove();
  };

  // enhancements.js creates the control synchronously during script loading.
  removeLegacyPunchUI();

  // Also guard against any legacy re-insertion by later UI code.
  const observer = new MutationObserver(removeLegacyPunchUI);
  observer.observe(document.body, { childList: true, subtree: true });

  // The obsolete mode is never enabled because its only toggle is removed.
  // Keep normal recording semantics explicit for compatibility with legacy code.
  window.__otaaPunchInDisabled = true;
})();
