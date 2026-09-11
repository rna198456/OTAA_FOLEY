/* branding.js — HUELLA
 * Visible brand layer + WAV export destination.
 */
'use strict';

(() => {
  document.title = 'HUELLA · Laboratorio de Foley · Cátedra Corti';

  const btnExport = document.getElementById('btn-export');
  const controlsRow = document.getElementById('controls-row');
  const exportStatus = document.getElementById('export-status');

  let exportDirectoryHandle = null;
  let choosingDirectory = false;

  const supportsDirectoryPicker = () => typeof window.showDirectoryPicker === 'function';

  function setExportStatus(message, temporary = false) {
    if (!exportStatus) return;
    exportStatus.textContent = message || '';
    if (temporary && message) {
      window.setTimeout(() => {
        if (exportStatus.textContent === message) exportStatus.textContent = '';
      }, 2800);
    }
  }

  function sanitizeFilename(value) {
    let requested = (value || '').trim();
    if (!requested) requested = 'HUELLA Foley 1';
    requested = requested.replace(/\.wav$/i, '');
    requested = requested.replace(/[\\/:*?"<>|]/g, '_').replace(/[\u0000-\u001F]/g, '').trim();
    return requested || 'HUELLA Foley 1';
  }

  function getFilename() {
    const filenameInput = document.getElementById('wav-filename');
    return `${sanitizeFilename(filenameInput ? filenameInput.value : '')}.wav`;
  }

  function updateFolderUI() {
    const folderWrap = document.getElementById('wav-folder-wrap');
    const folderLabel = document.getElementById('wav-folder-label');
    const folderButton = document.getElementById('wav-folder-change');
    if (!folderWrap || !folderLabel || !folderButton) return;

    folderWrap.classList.toggle('has-folder', !!exportDirectoryHandle);
    folderLabel.textContent = exportDirectoryHandle
      ? `📁 ${exportDirectoryHandle.name}`
      : (supportsDirectoryPicker() ? '📁 CARPETA DE EXPORTACIÓN' : '📥 DESCARGA DEL NAVEGADOR');
    folderButton.textContent = exportDirectoryHandle ? 'Cambiar' : 'Elegir';
    folderButton.title = exportDirectoryHandle ? 'Cambiar carpeta de exportación' : 'Elegir carpeta de exportación';
  }

  async function chooseExportDirectory({required = false} = {}) {
    if (!supportsDirectoryPicker() || choosingDirectory) return false;

    choosingDirectory = true;
    try {
      const handle = await window.showDirectoryPicker({
        mode: 'readwrite',
        startIn: 'downloads'
      });
      exportDirectoryHandle = handle;
      updateFolderUI();
      setExportStatus(`📁 ${handle.name}`, true);
      return true;
    } catch (error) {
      if (error?.name !== 'AbortError') {
        console.warn('HUELLA: no se pudo seleccionar la carpeta de exportación.', error);
        setExportStatus('Carpeta no disponible · descarga del navegador', true);
      } else if (required) {
        setExportStatus('Carpeta no seleccionada · descarga del navegador', true);
      }
      return false;
    } finally {
      choosingDirectory = false;
      updateFolderUI();
    }
  }

  async function ensureExportDirectory() {
    if (exportDirectoryHandle) return true;
    if (!supportsDirectoryPicker()) return false;
    return chooseExportDirectory({required: true});
  }

  async function saveBlobToDirectory(blob, filename) {
    if (!exportDirectoryHandle) return false;

    try {
      const permission = await exportDirectoryHandle.queryPermission({ mode: 'readwrite' });
      if (permission === 'prompt') {
        const requested = await exportDirectoryHandle.requestPermission({ mode: 'readwrite' });
        if (requested !== 'granted') return false;
      } else if (permission !== 'granted') {
        return false;
      }

      const fileHandle = await exportDirectoryHandle.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (error) {
      console.warn('HUELLA: no se pudo escribir el WAV en la carpeta elegida.', error);
      return false;
    }
  }

  // ── Editable WAV filename ──────────────────────────────────────────────
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
      filenameInput.title = value ? `${sanitizeFilename(value)}.wav` : 'HUELLA Foley 1.wav';
    };
    filenameInput.addEventListener('input', updateFilenameHint);
    filenameInput.addEventListener('focus', event => event.target.select());
    updateFilenameHint();

    const style = document.createElement('style');
    style.id = 'huella-wav-filename-style';
    style.textContent = `
      #wav-filename-wrap,
      #wav-folder-wrap {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        height: 32px;
        padding: 0 9px;
        border: 1px solid var(--line, #2b2b2d);
        border-radius: 6px;
        background: var(--panel, #151517);
        box-sizing: border-box;
      }
      #wav-filename-wrap {
        font: 600 9px/1 var(--mono, monospace);
        letter-spacing: .08em;
        color: var(--sub, #8f8f96);
      }
      #wav-filename-wrap input {
        width: 145px;
        min-width: 0;
        border: 0;
        outline: 0;
        background: transparent;
        color: var(--text, #e7e7ea);
        font: 500 11px/1 var(--mono, monospace);
      }
      #wav-filename-wrap input:focus { color: var(--accent, #f0b35b); }
      #wav-filename-wrap.disabled, #wav-folder-wrap.disabled { opacity: .45; }
      #wav-filename-wrap input:disabled, #wav-folder-change:disabled { cursor: not-allowed; }
      #wav-folder-wrap {
        max-width: 255px;
        font: 600 9px/1 var(--mono, monospace);
        letter-spacing: .05em;
        color: var(--sub, #8f8f96);
      }
      #wav-folder-wrap.has-folder { color: var(--text, #e7e7ea); }
      #wav-folder-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 178px; }
      #wav-folder-change {
        flex: 0 0 auto;
        border: 0;
        border-left: 1px solid var(--line, #2b2b2d);
        padding-left: 8px;
        background: transparent;
        color: var(--sub, #8f8f96);
        cursor: pointer;
        font: 600 9px/1 var(--mono, monospace);
        letter-spacing: .04em;
      }
      #wav-folder-change:hover:not(:disabled) { color: var(--accent, #f0b35b); }
      @media (max-width: 700px) {
        #wav-filename-wrap input { width: 100px; }
        #wav-folder-wrap { max-width: 170px; }
        #wav-folder-label { max-width: 105px; }
      }
    `;
    document.head.appendChild(style);

    const syncDisabled = () => {
      filenameInput.disabled = !!btnExport.disabled;
      filenameWrap.classList.toggle('disabled', filenameInput.disabled);
      const folderButton = document.getElementById('wav-folder-change');
      const folderWrap = document.getElementById('wav-folder-wrap');
      if (folderButton) folderButton.disabled = !!btnExport.disabled;
      if (folderWrap) folderWrap.classList.toggle('disabled', !!btnExport.disabled);
    };
    syncDisabled();
    new MutationObserver(syncDisabled).observe(btnExport, { attributes: true, attributeFilter: ['disabled'] });

    const folderWrap = document.createElement('div');
    folderWrap.id = 'wav-folder-wrap';
    folderWrap.innerHTML = `
      <span id="wav-folder-label"></span>
      <button id="wav-folder-change" type="button">Elegir</button>`;
    filenameWrap.insertAdjacentElement('afterend', folderWrap);

    const folderButton = folderWrap.querySelector('#wav-folder-change');
    folderButton.addEventListener('click', async event => {
      event.preventDefault();
      event.stopPropagation();
      await chooseExportDirectory();
    });

    updateFolderUI();
  }

  // ── WAV export — capture the button before app.js ──────────────────────
  // app.js has a legacy export listener registered earlier. This capture-phase
  // listener stops it and performs the complete export using the filename
  // currently visible in the editable field.
  if (btnExport) {
    btnExport.addEventListener('click', async event => {
      event.preventDefault();
      event.stopImmediatePropagation();

      if (!S.events.length) return;

      btnExport.disabled = true;
      const filename = getFilename();
      setExportStatus('Renderizando 48 kHz…');

      try {
        // First export: choose destination before rendering, so the user's
        // gesture remains attached to the directory picker permission request.
        await ensureExportDirectory();

        const blob = await AudioEngine.renderToWav(S.events, S.videoDuration, 48000);

        if (exportDirectoryHandle) {
          const saved = await saveBlobToDirectory(blob, filename);
          if (saved) {
            setExportStatus(`✓ Guardado · ${filename}`, true);
            return;
          }
          setExportStatus('No se pudo guardar en la carpeta · descarga del navegador');
        }

        // Fallback for unsupported browsers or cancelled/failed directory access.
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        setExportStatus(`✓ WAV 48 kHz descargado · ${filename}`, true);
      } catch (err) {
        console.error('HUELLA WAV export:', err);
        setExportStatus('Error: ' + (err?.message || err), true);
      } finally {
        btnExport.disabled = false;
      }
    }, true);
  }
})();
