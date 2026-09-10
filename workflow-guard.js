/* Small robustness guards for the workflow enhancement layer. */
'use strict';

(() => {
  const btnRecord = document.getElementById('btn-record');
  const btnPunchToggle = document.getElementById('btn-punch-toggle');
  const modeRehearsal = document.getElementById('mode-rehearsal');
  const modeRecording = document.getElementById('mode-recording');
  const video = document.getElementById('video-el');

  if (!btnRecord || !modeRehearsal || !modeRecording || !video) return;

  // Stop an armed/active punch cleanly before switching back to rehearsal.
  modeRehearsal.addEventListener('click', () => {
    if (btnPunchToggle?.classList.contains('active')) btnPunchToggle.click();
    if (typeof S !== 'undefined' && S.isRecording) stopRecording();
  }, true);

  // Recompute the Record button state after a video is loaded.
  video.addEventListener('loadedmetadata', () => {
    const rehearsal = modeRehearsal.classList.contains('active');
    btnRecord.disabled = rehearsal || (typeof S !== 'undefined' && !S.videoLoaded);
  });

  // Defensive sync if the mode is switched programmatically.
  modeRecording.addEventListener('click', () => {
    btnRecord.disabled = false;
  }, true);
})();
