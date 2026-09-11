/* export-fix.js — HUELLA
 * Exportación WAV única y explícita.
 * Toma el nombre del campo ARCHIVO y escribe en la carpeta elegida.
 * Confirma antes de reemplazar un WAV existente.
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

  function getFilename() {
    const input = document.getElementById('wav-filename');
    let value = input ? input.value.trim() : '';
    value = value.replace(/\.wav$/i, '');
    value = value.replace(/[\\/:*?"<>|]/g, '_').replace(/[\u0000-\u001F]/g, '').trim();
    return (value || 'HUELLA Foley 1') + '.wav';
  }

  function updateFolderLabel() {
    const label = document.getElementById('wav-folder-label');
    if (label) {
      label.textContent = directoryHandle
        ? `📁 ${directoryHandle.name}`
        : (supportsPicker() ? '📁 CARPETA DE EXPORTACIÓN' : '📥 DESCARGA DEL NAVEGADOR');
    }
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
      if (err?.name !== 'AbortError') {
        console.warn('HUELLA: selector de carpeta', err);
        status('No se pudo seleccionar la carpeta', true);
      }
      return false;
    } finally {
      choosing = false;
    }
  }

  async function saveInFolder(blob, name) {
    if (!directoryHandle) return false;
    try {
      let permission = await directoryHandle.queryPermission({ mode: 'readwrite' });
      if (permission !== 'granted') {
        permission = await directoryHandle.requestPermission({ mode: 'readwrite' });
      }
      if (permission !== 'granted') return false;

      // Check first, without creating anything.
      let exists = false;
      try {
        await directoryHandle.getFileHandle(name, { create: false });
        exists = true;
      } catch (err) {
        if (err?.name !== 'NotFoundError') throw err;
      }

      if (exists) {
        const replace = window.confirm(`El archivo "${name}" ya existe en la carpeta seleccionada.\n\n¿Querés reemplazarlo?`);
        if (!replace) {
          status(`Exportación cancelada · ${name} ya existe`, true);
          return 'cancelled';
        }
      }

      const fileHandle = await directoryHandle.getFileHandle(name, { create: true });
      const writable = await fileHandle.createWritable();
      try {
        await writable.write(blob);
      } finally {
        await writable.close();
      }
      return true;
    } catch (err) {
      console.warn('HUELLA: escritura WAV', err);
      return false;
    }
  }

  async function exportWav() {
    if (exporting) return;
    if (typeof S === 'undefined' || !Array.isArray(S.events) || !S.events.length) {
      status('No hay eventos para exportar', true);
      return;
    }

    exporting = true;
    btnExport.disabled = true;
    const name = getFilename();
    status(`Renderizando 48 kHz · ${name}`);

    try {
      if (!directoryHandle && supportsPicker()) {
        await chooseFolder();
      }

      const blob = await AudioEngine.renderToWav(S.events, S.videoDuration, 48000);
      if (!(blob instanceof Blob) || blob.size === 0) {
        throw new Error('El render WAV devolvió un archivo vacío.');
      }

      if (directoryHandle) {
        const saved = await saveInFolder(blob, name);
        if (saved === true) {
          status(`✓ Guardado · ${name}`, true);
          return;
        }
        if (saved === 'cancelled') return;
        status('No se pudo guardar en la carpeta · usando descarga normal');
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      status(`✓ WAV 48 kHz descargado · ${name}`, true);
    } catch (err) {
      console.error('HUELLA WAV export:', err);
      status('Error: ' + (err?.message || String(err)), true);
    } finally {
      exporting = false;
      btnExport.disabled = false;
    }
  }

  document.addEventListener('click', event => {
    if (event.target === btnExport || btnExport.contains(event.target)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void exportWav();
    }
  }, true);

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
