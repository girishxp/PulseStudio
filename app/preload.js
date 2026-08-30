const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('recorderAPI', {
  platformInfo: () => ipcRenderer.invoke('app:platform-info'),
  getDiagnostics: () => ipcRenderer.invoke('app:diagnostics'),
  exportDiagnostics: (options = {}) => ipcRenderer.invoke('app:export-diagnostics', options || {}),
  logEvent: (level, event, details = {}) => ipcRenderer.send('app:log-event', { level, event, details }),
  openLogFolder: () => ipcRenderer.invoke('app:open-log-folder'),
  sendFeedback: () => ipcRenderer.invoke('app:send-feedback'),
  listLocalModels: () => ipcRenderer.invoke('models:list'),
  downloadLocalModel: (modelId) => ipcRenderer.invoke('models:download', modelId),
  removeLocalModel: (modelId) => ipcRenderer.invoke('models:remove', modelId),
  openLocalModelsFolder: () => ipcRenderer.invoke('models:open-folder'),
  getUpdateStatus: () => ipcRenderer.invoke('update:status'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  remindUpdateLater: () => ipcRenderer.invoke('update:remind-later'),
  skipUpdateVersion: () => ipcRenderer.invoke('update:skip-version'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (callback) => { const listener = (_event, payload) => callback(payload); ipcRenderer.on('update:status', listener); return () => ipcRenderer.removeListener('update:status', listener); },
  getAnalyticsStatus: () => ipcRenderer.invoke('analytics:status'),
  setAnalyticsEnabled: (enabled) => ipcRenderer.invoke('analytics:set-enabled', Boolean(enabled)),
  onAnalyticsStatus: (callback) => { const listener = (_event, payload) => callback(payload); ipcRenderer.on('analytics:status', listener); return () => ipcRenderer.removeListener('analytics:status', listener); },
  listSources: () => ipcRenderer.invoke('capture:list-sources'),
  selectSource: (sourceId) => ipcRenderer.invoke('capture:select-source', sourceId),
  getCursorPosition: () => ipcRenderer.invoke('capture:cursor-position'),
  setKeystrokeCaptureEnabled: (enabled) => ipcRenderer.invoke('capture:keystrokes-enabled', enabled),
  onKeystroke: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('keystroke:event', listener);
    return () => ipcRenderer.removeListener('keystroke:event', listener);
  },
  getPermissions: () => ipcRenderer.invoke('permissions:get'),
  openScreenRecordingSettings: () => ipcRenderer.invoke('permissions:open-screen-settings'),
  requestMicrophonePermission: () => ipcRenderer.invoke('permissions:request-microphone'),
  requestCameraPermission: () => ipcRenderer.invoke('permissions:request-camera'),

  beginRecordingFile: (config) => ipcRenderer.invoke('recording:begin-file', config),
  appendRecordingChunk: (data) => ipcRenderer.invoke('recording:chunk', data),
  appendMicrophoneChunk: (data) => ipcRenderer.invoke('recording:mic-chunk', data),
  appendNeuralMicrophoneChunk: (data) => ipcRenderer.invoke('recording:neural-mic-chunk', data),
  sealRecording: (meta) => ipcRenderer.invoke('recording:seal', meta),
  finalizeSealedRecording: (sessionId) => ipcRenderer.invoke('recording:finalize-sealed', sessionId),
  finalizeRecording: (meta) => ipcRenderer.invoke('recording:finalize', meta),
  cancelRecording: () => ipcRenderer.invoke('recording:cancel'),
  getRecordingHealth: () => ipcRenderer.invoke('recording:health'),
  checkpointRecording: (meta = {}) => ipcRenderer.invoke('recording:checkpoint', meta || {}),
  getRecoveryStatus: () => ipcRenderer.invoke('recording:recovery-status'),
  getStartupRecoveryState: () => ipcRenderer.invoke('recording:startup-recovery-state'),
  onStartupRecoveryState: (callback) => { const listener = (_event, payload) => callback(payload); ipcRenderer.on('recording:startup-recovery-state', listener); return () => ipcRenderer.removeListener('recording:startup-recovery-state', listener); },
  onRecoveryStatusChanged: (callback) => { const listener = () => callback(); ipcRenderer.on('recording:recovery-status-changed', listener); return () => ipcRenderer.removeListener('recording:recovery-status-changed', listener); },
  retryRecovery: () => ipcRenderer.invoke('recording:retry-recovery'),
  cancelRecovery: () => ipcRenderer.invoke('recording:cancel-recovery'),
  openRecoveryFolder: () => ipcRenderer.invoke('recording:open-recovery-folder'),
  getApplicationAudioCapability: () => ipcRenderer.invoke('audio:application-capability'),
  startApplicationAudioCapture: (payload) => ipcRenderer.invoke('audio:application-start', typeof payload === 'string' ? { windowTitle: payload } : (payload || {})),
  stopApplicationAudioCapture: () => ipcRenderer.invoke('audio:application-stop'),
  pauseApplicationAudioCapture: () => ipcRenderer.invoke('audio:application-pause'),
  resumeApplicationAudioCapture: () => ipcRenderer.invoke('audio:application-resume'),
  saveSnapshot: (data) => ipcRenderer.invoke('snapshot:save', { data }),
  saveRecordingFrameSnapshot: (recordingPath, seconds) => ipcRenderer.invoke('snapshot:recording-frame', { recordingPath, seconds }),

  listRecordings: () => ipcRenderer.invoke('recordings:list'),
  searchRecordings: (query) => ipcRenderer.invoke('recordings:search', query),
  getRecordingWaveform: (recordingPath, points = 1200) => ipcRenderer.invoke('recording:waveform', { recordingPath, points }),
  repairRecordingMedia: (recordingPath) => ipcRenderer.invoke('recording:repair-media', recordingPath),
  getRecordingMarkers: (recordingPath) => ipcRenderer.invoke('recording:markers-get', recordingPath),
  saveRecordingMarkers: (recordingPath, markers) => ipcRenderer.invoke('recording:markers-save', { recordingPath, markers }),
  getRecordingVoiceHighlights: (recordingPath) => ipcRenderer.invoke('recording:voice-highlights-get', recordingPath),
  onRecordingVoiceHighlightsUpdated: (callback) => { const listener = (_event, payload) => callback(payload); ipcRenderer.on('recording:voice-highlights-updated', listener); return () => ipcRenderer.removeListener('recording:voice-highlights-updated', listener); },
  getReadiness: () => ipcRenderer.invoke('app:readiness'),
  getVoiceProfile: () => ipcRenderer.invoke('voice:profile-status'),
  enrollVoiceProfile: (payload = {}) => ipcRenderer.invoke('voice:enroll', payload || {}),
  clearVoiceProfile: () => ipcRenderer.invoke('voice:clear'),
  createRecordingCategory: (name) => ipcRenderer.invoke('recordings:category-create', name),
  setRecordingCategory: (recordingPath, category) => ipcRenderer.invoke('recordings:category-set', { recordingPath, category }),
  getRecordingTranscript: (recordingPath) => ipcRenderer.invoke('recordings:transcript', recordingPath),
  getRecordingSpeakers: (recordingPath) => ipcRenderer.invoke('recordings:speakers', recordingPath),
  regenerateRecordingSpeakers: (recordingPath) => ipcRenderer.invoke('recordings:speakers-generate', recordingPath),
  setRecordingSpeakerName: (recordingPath, speaker, name) => ipcRenderer.invoke('recordings:speaker-name', { recordingPath, speaker, name }),
  mergeRecordingSpeakers: (recordingPath, sourceSpeaker, targetSpeaker) => ipcRenderer.invoke('recordings:speaker-merge', { recordingPath, sourceSpeaker, targetSpeaker }),
  getRecordingInsights: (recordingPath) => ipcRenderer.invoke('recordings:insights', recordingPath),
  regenerateRecordingInsights: (recordingPath) => ipcRenderer.invoke('recordings:insights-generate', recordingPath),
  correctRecordingInsight: (recordingPath, item) => ipcRenderer.invoke('recordings:insights-correct', { recordingPath, ...(item || {}) }),
  setActiveRecording: (recordingPath) => ipcRenderer.invoke('recording:set-active', recordingPath),
  renameRecording: (recordingPath, newName) => ipcRenderer.invoke('recording:rename', { recordingPath, newName }),
  deleteRecording: (recordingPath) => ipcRenderer.invoke('recording:delete', { recordingPath }),
  deleteRecordingsBatch: (recordingPaths) => ipcRenderer.invoke('recordings:delete-batch', { recordingPaths }),
  trimRecording: (recordingPath, startSeconds, endSeconds) => ipcRenderer.invoke('recording:trim', { recordingPath, startSeconds, endSeconds }),
  multiTrimRecording: (recordingPath, cutSegments) => ipcRenderer.invoke('recording:multi-trim', { recordingPath, cutSegments }),
  exportRecordingAudio: (recordingPath, format = 'm4a') => ipcRenderer.invoke('recording:export-audio', { recordingPath, format }),

  setCompactMode: (compact) => ipcRenderer.invoke('window:set-compact', Boolean(compact)),
  getWindowViewState: () => ipcRenderer.invoke('window:get-view-state'),
  notifyUiReady: () => ipcRenderer.invoke('window:ui-ready'),
  setCompactRecordingState: (active) => ipcRenderer.invoke('window:set-compact-recording-state', Boolean(active)),
  fitCompactWindow: (contentHeight) => ipcRenderer.invoke('window:fit-compact-content', Number(contentHeight)),
  beginWindowDrag: () => ipcRenderer.send('window:drag-start'),
  moveWindowDrag: () => ipcRenderer.send('window:drag-move'),
  endWindowDrag: () => ipcRenderer.send('window:drag-end'),
  setCompactExpanded: (expanded) => ipcRenderer.invoke('window:set-compact-expanded', Boolean(expanded)),
  setWindowTransparency: (percent) => ipcRenderer.invoke('window:set-transparency', Number(percent)),
  setRecordingPerformanceMode: (enabled) => ipcRenderer.invoke('window:set-recording-performance', Boolean(enabled)),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke('window:set-always-on-top', Boolean(enabled)),
  getWindowCapturePrivacy: () => ipcRenderer.invoke('window:get-capture-privacy'),
  setWindowCapturePrivacy: (enabled) => ipcRenderer.invoke('window:set-capture-privacy', Boolean(enabled)),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  togglePlayerFullscreen: () => ipcRenderer.invoke('window:toggle-player-fullscreen'),
  exitPlayerFullscreen: () => ipcRenderer.invoke('window:exit-player-fullscreen'),
  onShortcutAction: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('shortcut:action', listener);
    return () => ipcRenderer.removeListener('shortcut:action', listener);
  },
  onFullscreenChanged: (callback) => {
    const listener = (_event, value) => callback(Boolean(value));
    ipcRenderer.on('window:fullscreen-changed', listener);
    return () => ipcRenderer.removeListener('window:fullscreen-changed', listener);
  },
  onWindowCloseBlockedRecording: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('window:close-blocked-recording', listener);
    return () => ipcRenderer.removeListener('window:close-blocked-recording', listener);
  },

  transcribeAutomatic: (recordingPath, options = {}) => ipcRenderer.invoke('transcription:automatic', { recordingPath, force: Boolean(options.force) }),
  getAiStatus: () => ipcRenderer.invoke('ai:status'),
  cancelAiJob: (jobId) => ipcRenderer.invoke('ai:cancel', jobId),
  onAiStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('ai:status', listener);
    return () => ipcRenderer.removeListener('ai:status', listener);
  },
  exportTranscript: (payload) => ipcRenderer.invoke('transcript:export', payload),

  showInFolder: (filePath) => ipcRenderer.invoke('file:show-in-folder', filePath),
  getRecordingsFolder: () => ipcRenderer.invoke('folder:get-recordings'),
  chooseRecordingsFolder: () => ipcRenderer.invoke('folder:choose-recordings'),
  resetRecordingsFolder: () => ipcRenderer.invoke('folder:reset-recordings'),
  openRecordingsFolder: () => ipcRenderer.invoke('folder:open-recordings'),
  copyText: (text) => ipcRenderer.invoke('clipboard:copy-text', text)
});
