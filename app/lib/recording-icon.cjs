'use strict';

const path = require('node:path');

// Dock artwork follows capture, independently of the longer save/AI lifecycle.
// Icon failures must never interrupt recording or make the app fail to launch.
function createRecordingIconController({ app, nativeImage, assetsDirectory, platform = process.platform, onError = () => {} }) {
  let recording = false;
  let appliedPath = '';
  const cache = new Map();
  const idlePath = path.join(assetsDirectory, 'pulsestudio-icon.png');
  const recordingPath = path.join(assetsDirectory, 'pulsestudio-icon-recording.png');

  function loadIcon(filePath) {
    if (cache.has(filePath)) return cache.get(filePath);
    const icon = nativeImage.createFromPath(filePath);
    if (!icon || icon.isEmpty()) return null;
    cache.set(filePath, icon);
    return icon;
  }

  function applyCurrentState() {
    if (platform !== 'darwin' || !app?.dock?.setIcon || (app.isReady && !app.isReady())) return false;
    try {
      const requestedPath = recording ? recordingPath : idlePath;
      const requestedIcon = loadIcon(requestedPath);
      const targetPath = requestedIcon ? requestedPath : idlePath;
      const icon = requestedIcon || loadIcon(idlePath);
      if (!icon) return false;
      if (appliedPath === targetPath) return true;
      app.dock.setIcon(icon);
      appliedPath = targetPath;
      return true;
    } catch (error) {
      try { onError(error); } catch {}
      return false;
    }
  }

  function setRecording(active) {
    recording = Boolean(active);
    return applyCurrentState();
  }

  return { setRecording, applyCurrentState, isRecording: () => recording };
}

module.exports = { createRecordingIconController };
