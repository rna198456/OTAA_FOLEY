/* export-fix.js — HUELLA
 * Exportación WAV única y explícita.
 * Toma el nombre del campo ARCHIVO y escribe en la carpeta elegida.
 * Captura el clic antes de los listeners legacy de app.js/branding.js.
 */
'use strict';

(() => {
  const btnExport = document.getElementById('btn-export');
  const exportStatus = document.getElementById('export-status');
  if (!btnExport) return;

  let directoryHandle = null;
  let choosing = false;
  let exporting = false;

  const supportsPicker = () => typeof window.showDirectoryPicker === 'function';

  function status(text, temporary = false) {
    if (!exportStatus) return;
    exportStatus.textContent = text;
    if (temporary) {
      setTimeout(() => {
        if (exportStatus.textContent === text) exportStatus.textContent = '';
      }, 3500);
    }
  }

  function filename() {
    const input = document.getElementById('wav-filename');
    let value = input ? input.value.trim() : '';
    value = value.replace(/\.wav$/i, '');
    value = value.replace(/[\\/:*?"<>|]/g, '_').replace(/[\u0000-\u001F]/g, '').trim();
    return (value || 'HUELLA Foley 1') + '.wav';
  }

  function updateFolderLabel() {
    const label = document.getElementById('wav-folder-label');
    if (label) label.textContent = directoryHandle ? `📁 ${directoryHandle.name}` : (supportsPicker() ? '📁 CARPETA DE EXPORTACIÓN' : '📥 DESCARGA DEL NAVEGADOR');
    const button = document.getElementById('wav-folder-change');
    if (button) button.textContent = directoryHandle ? 'Cambiar' : 'Elegir';
  }

  async function chooseFolder() {
    if (!supportsPicker() || choosing) return false;
    choosing = true;
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      directoryHandle = handle;
      updateFolderLabel();
      status(`📁 ${handle.name}`, true);
      return true;
    } catch (err) {
      if (err?.name !== 'AbortError') console.warn('HUELLA: selector de carpeta', err);
      return false;
    } finally {
      choosing = false;
    }
  }

  async function saveInFolder(blob, name) {
    if (!directoryHandle) return false;
    try {
      let permission = await directoryHandle.queryPermission({ mode: 'readwrite' });
      if (permission !== 'granted') permission = await directoryHandle.requestPermission({ mode: 'readwrite' });
      if (permission !== 'granted') return false;
      const file = await directoryHandle.getFileHandle(name, { create: true });
      const writable = await file.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (err) {
      console.warn('HUELLA: escritura WAV', err);
      return false;
    }
  }

  async function exportWav() {
    if (exporting || !window.S?.events?.length) return;
    exporting = true;
    btnExport.disabled = true;
    const name = filename();
    status(`Renderizando 48 kHz · ${name}`);

    try {
      if (!directoryHandle && supportsPicker()) {
        // Must happen during the user's click activation, before render/awaits.
        await chooseFolder();
      }

      const blob = await AudioEngine.renderToWav(S.events, S.videoDuration, 48000);

      if (directoryHandle && await saveInFolder(blob, name)) {
        status(`✓ Guardado · ${name}`, true);
        return;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      status(`✓ WAV 48 kHz descargado · ${name}`, true);
    } catch (err) {
      console.error('HUELLA WAV export:', err);
      status('Error: ' + (err?.message || err), true);
    } finally {
      exporting = false;
      btnExport.disabled = false;
    }
  }

  // This is the key: document capture executes before the button reaches
  // app.js or branding.js listeners, so there is only one active exporter.
  document.addEventListener('click', event => {
    if (event.target === btnExport || btnExport.contains(event.target)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void exportWav();
    }
  }, true);

  // Folder button is also captured so its action uses this module's handle.
  document.addEventListener('click', event => {
    const button = document.getElementById('wav-folder-change');
    if (!button) return;
    if (event.target === button || button.contains(event.target)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void chooseFolder();
    }
  }, true);

  updateFolderLabel();
})();
