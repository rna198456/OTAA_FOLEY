/* branding.js — HUELLA
 * Visible brand layer. Keeps the historical repository path unchanged
 * while presenting HUELLA as the application's public identity.
 */
'use strict';

(() => {
  document.title = 'HUELLA · Laboratorio de Foley · Cátedra Corti';

  // Legacy export code still builds the download name internally.
  // Rewrite only that visible filename, without touching the export audio.
  const originalAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (typeof this.download === 'string' && this.download.startsWith('Foley Recorder OTAA ')) {
      this.download = this.download.replace(/^Foley Recorder OTAA /, 'HUELLA Foley ');
    }
    return originalAnchorClick.call(this);
  };
})();
