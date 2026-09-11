/* branding.js — HUELLA
 * Visible brand layer.
 */
'use strict';

(() => {
  document.title = 'HUELLA · Laboratorio de Foley · Cátedra Corti';

  const btnExport = document.getElementById('btn-export');
  const controlsRow = document.getElementById('controls-row');

  // ── Editable WAV filename ──────────────────────────────────────────────
  // The field sits immediately beside the WAV button. The extension is added
  // automatically, and invalid filename characters are removed on export.
  if (btnExport && controlsRow && !document.getElementById('wav-filename')) {
    const filenameWrap = document.createElement('label');
    filenameWrap.id = 'wav-filename-wrap';
    filenameWrap.title = 'Nombre del archivo WAV';
    filenameWrap.innerHTML = `
      <span>ARCHIVO</span>
      <input id="wav-filename" type="text" value="HUELLA Foley 1" maxlength="120"
        aria-label="Nombre del archivo WAV" autocomplete="off" spellcheck="false" />`;

    btnExport.insertAdjacentElement('afterend', filenameWrap);

    const filenameInput = filenameWrap.querySelector('#wav-filename');
    const updateFilenameHint = () => {
      const value = filenameInput.value.trim();
      filenameInput.title = value ? `${value}.wav` : 'HUELLA Foley 1.wav';
    };
    filenameInput.addEventListener('input', updateFilenameHint);
    filenameInput.addEventListener('focus', event => event.target.select());
    updateFilenameHint();

    // Enable/disable together with the WAV export button.
    const syncDisabled = () => {
      filenameInput.disabled = !!btnExport.disabled;
      filenameWrap.classList.toggle('disabled', filenameInput.disabled);
    };
    syncDisabled();
    new MutationObserver(syncDisabled).observe(btnExport, { attributes: true, attributeFilter: ['disabled'] });
  }

  // ── Export filename override ───────────────────────────────────────────
  const originalAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (typeof this.download === 'string' && /\.wav$/i.test(this.download)) {
      const filenameInput = document.getElementById('wav-filename');
      let requested = filenameInput ? filenameInput.value.trim() : '';

      // Fall back to the current HUELLA filename when the field is empty.
      if (!requested) requested = 'HUELLA Foley 1';

      // Keep the user's extension optional and normalize illegal Windows/path chars.
      requested = requested.replace(/\.wav$/i, '');
      requested = requested.replace(/[\\/:*?"<>|]/g, '_').replace(/[\u0000-\u001F]/g, '').trim();
      if (!requested) requested = 'HUELLA Foley 1';

      this.download = `${requested}.wav`;
    }
    return originalAnchorClick.call(this);
  };
})();
