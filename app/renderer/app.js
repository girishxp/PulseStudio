const $ = (id) => document.getElementById(id);

// v0.2.123 diagnostic isolation: disable My Voice highlighting end-to-end.
// This deliberately leaves speaker diarization/transcription unchanged.
const MY_VOICE_HIGHLIGHTS_ENABLED = false;

const FAST_TOOLTIP_DELAY_MS = 120;
const FAST_TOOLTIP_MINI_MODE_DELAY_MS = 90;
const fastTooltipState = {
  target: null,
  text: '',
  showTimer: null,
  tooltip: null,
  previousDescribedBy: null,
  mutationObserver: null,
  suppressHoverUntil: 0
};

function fastTooltipTarget(node) {
  const element = node instanceof Element ? node : node?.parentElement;
  return element?.closest?.('[title], [data-fast-tooltip-title]') || null;
}

function fastTooltipDelay(target) {
  const requested = Number(target?.dataset?.tooltipDelay);
  if (Number.isFinite(requested) && requested >= 0) return requested;
  return target?.classList?.contains('compact-record-kind-button') ? FAST_TOOLTIP_MINI_MODE_DELAY_MS : FAST_TOOLTIP_DELAY_MS;
}

function positionFastTooltip() {
  const target = fastTooltipState.target;
  const tooltip = fastTooltipState.tooltip;
  if (!target || !tooltip || !fastTooltipState.text || !document.documentElement.contains(target)) return;
  const rect = target.getBoundingClientRect();
  if (!rect.width && !rect.height) return;

  tooltip.style.left = '0px';
  tooltip.style.top = '0px';
  const tooltipRect = tooltip.getBoundingClientRect();
  const edge = 8;
  const gap = 8;
  const maxLeft = Math.max(edge, window.innerWidth - tooltipRect.width - edge);
  const left = Math.min(maxLeft, Math.max(edge, rect.left + (rect.width - tooltipRect.width) / 2));
  let top = rect.top - tooltipRect.height - gap;
  if (top < edge) top = Math.min(window.innerHeight - tooltipRect.height - edge, rect.bottom + gap);
  tooltip.style.left = `${Math.round(left)}px`;
  tooltip.style.top = `${Math.max(edge, Math.round(top))}px`;
}

function restoreFastTooltipTarget(target) {
  if (!target) return;
  const stored = target.dataset.fastTooltipTitle;
  const customOnly = target.dataset.tooltipCustomOnly === 'true';
  if (customOnly) {
    // Keep custom-only help out of the native browser title system. Native title
    // bubbles can become sticky when a compact Electron window is activated,
    // moved, or restored underneath the pointer.
    target.removeAttribute('title');
    if (stored != null) target.dataset.fastTooltipTitle = stored;
  } else {
    if (stored != null && !target.hasAttribute('title')) target.setAttribute('title', stored);
    delete target.dataset.fastTooltipTitle;
  }
  const previous = fastTooltipState.previousDescribedBy;
  if (previous == null) target.removeAttribute('aria-describedby');
  else target.setAttribute('aria-describedby', previous);
}

function hideFastTooltip() {
  clearTimeout(fastTooltipState.showTimer);
  fastTooltipState.showTimer = null;
  const target = fastTooltipState.target;
  fastTooltipState.target = null;
  fastTooltipState.text = '';
  restoreFastTooltipTarget(target);
  fastTooltipState.previousDescribedBy = null;
  const tooltip = fastTooltipState.tooltip;
  if (!tooltip) return;
  tooltip.classList.remove('is-visible');
  tooltip.setAttribute('aria-hidden', 'true');
  if (tooltip.matches?.(':popover-open')) tooltip.hidePopover?.();
}

function showFastTooltip(target) {
  if (!target || target === fastTooltipState.target) return;
  if (target.dataset.tooltipHoverOnly === 'true' && Date.now() < fastTooltipState.suppressHoverUntil) return;
  if (document.body.classList.contains('manual-window-dragging')) return;
  hideFastTooltip();
  const text = String(target.getAttribute('title') || target.dataset.fastTooltipTitle || '').trim();
  if (!text) return;

  target.dataset.fastTooltipTitle = text;
  target.removeAttribute('title');
  fastTooltipState.target = target;
  fastTooltipState.text = text;
  fastTooltipState.previousDescribedBy = target.getAttribute('aria-describedby');
  const tooltip = fastTooltipState.tooltip;
  if (!tooltip) return;
  const describedBy = [fastTooltipState.previousDescribedBy, tooltip.id].filter(Boolean).join(' ');
  target.setAttribute('aria-describedby', describedBy);
  tooltip.textContent = text;

  fastTooltipState.showTimer = setTimeout(() => {
    if (fastTooltipState.target !== target || !document.documentElement.contains(target)) return;
    if (tooltip.showPopover && !tooltip.matches(':popover-open')) tooltip.showPopover();
    tooltip.setAttribute('aria-hidden', 'false');
    positionFastTooltip();
    // Make hover help visible immediately after the configured delay. Avoid an
    // extra animation-frame wait so icon-only controls feel responsive even
    // when the renderer is busy with layout/media work.
    tooltip.classList.add('is-visible');
  }, fastTooltipDelay(target));
}

function showFastTooltipForClick(target, duration = 1800) {
  if (!target || document.body.classList.contains('manual-window-dragging')) return;
  hideFastTooltip();
  const text = String(target.getAttribute('title') || target.dataset.fastTooltipTitle || '').trim();
  if (!text) return;

  target.dataset.fastTooltipTitle = text;
  target.removeAttribute('title');
  fastTooltipState.target = target;
  fastTooltipState.text = text;
  fastTooltipState.previousDescribedBy = target.getAttribute('aria-describedby');
  const tooltip = fastTooltipState.tooltip;
  if (!tooltip) return;
  const describedBy = [fastTooltipState.previousDescribedBy, tooltip.id].filter(Boolean).join(' ');
  target.setAttribute('aria-describedby', describedBy);
  tooltip.textContent = text;
  if (tooltip.showPopover && !tooltip.matches(':popover-open')) tooltip.showPopover();
  tooltip.setAttribute('aria-hidden', 'false');
  positionFastTooltip();
  tooltip.classList.add('is-visible');
  fastTooltipState.showTimer = setTimeout(() => {
    if (fastTooltipState.target === target) hideFastTooltip();
  }, Math.max(700, Number(duration) || 1800));
}

function initFastTooltips() {
  if (fastTooltipState.tooltip) return;
  const tooltip = document.createElement('div');
  tooltip.id = 'fastTooltip';
  tooltip.className = 'fast-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.setAttribute('aria-hidden', 'true');
  tooltip.setAttribute('popover', 'manual');
  document.body.appendChild(tooltip);
  fastTooltipState.tooltip = tooltip;

  document.addEventListener('pointerover', (event) => {
    const target = fastTooltipTarget(event.target);
    if (!target || target === fastTooltipState.target || target.dataset.tooltipClickOnly === 'true') return;
    showFastTooltip(target);
  }, true);
  document.addEventListener('pointerout', (event) => {
    const target = fastTooltipState.target;
    if (!target || !target.contains(event.target)) return;
    if (event.relatedTarget && target.contains(event.relatedTarget)) return;
    hideFastTooltip();
  }, true);
  document.addEventListener('pointerdown', () => {
    // Clicking or starting a window drag should never leave hover help floating
    // over the Mini Controller. A short suppression window also ignores the
    // synthetic pointer-over events Electron/macOS can emit as a window activates.
    fastTooltipState.suppressHoverUntil = Date.now() + 650;
    hideFastTooltip();
  }, true);
  document.addEventListener('focusin', (event) => {
    const target = fastTooltipTarget(event.target);
    if (target && target.dataset.tooltipHoverOnly !== 'true' && target.dataset.tooltipClickOnly !== 'true') showFastTooltip(target);
  }, true);
  document.addEventListener('focusout', (event) => {
    if (fastTooltipState.target === event.target) hideFastTooltip();
  }, true);
  window.addEventListener('focus', () => {
    fastTooltipState.suppressHoverUntil = Date.now() + 650;
    hideFastTooltip();
  });
  window.addEventListener('blur', hideFastTooltip);
  window.addEventListener('resize', positionFastTooltip, { passive: true });
  window.addEventListener('scroll', positionFastTooltip, { passive: true, capture: true });

  fastTooltipState.mutationObserver = new MutationObserver((records) => {
    const active = fastTooltipState.target;
    if (!active) return;
    for (const record of records) {
      if (record.target !== active || record.attributeName !== 'title' || !active.hasAttribute('title')) continue;
      const updated = String(active.getAttribute('title') || '').trim();
      if (!updated) continue;
      active.dataset.fastTooltipTitle = updated;
      active.removeAttribute('title');
      fastTooltipState.text = updated;
      tooltip.textContent = updated;
      positionFastTooltip();
    }
  });
  fastTooltipState.mutationObserver.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['title'] });
}

const PLAYER_ICONS = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="player-play-shape" d="m8 5 11 7-11 7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>',
  volume: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 10h3l4-4v12l-4-4H5z"/><path d="M15 9.5a4 4 0 0 1 0 5"/><path d="M17.5 7a7 7 0 0 1 0 10"/></svg>',
  muted: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 10h3l4-4v12l-4-4H5z"/><path d="m16 10 5 5M21 10l-5 5"/></svg>'
};

function setPlayerIcon(id, name, title) {
  const button = $(id);
  if (!button || !PLAYER_ICONS[name]) return;
  button.innerHTML = PLAYER_ICONS[name];
  if (title) { button.title = title; button.setAttribute('aria-label', title); }
}

function loadFavoriteRecordingPaths() {
  try {
    const parsed = JSON.parse(localStorage.getItem('favoriteRecordingPaths') || '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'string' && value) : []);
  } catch {
    return new Set();
  }
}

function loadPreferredCaptureSource() {
  try {
    const parsed = JSON.parse(localStorage.getItem('preferredCaptureSource') || 'null');
    if (!parsed || typeof parsed !== 'object') return null;
    return { id: String(parsed.id || ''), name: String(parsed.name || ''), kind: String(parsed.kind || '') };
  } catch {
    return null;
  }
}

function persistPreferredCaptureSource(source) {
  if (!source) return;
  state.preferredCaptureSource = { id: source.id || '', name: source.name || '', kind: source.kind || '' };
  localStorage.setItem('preferredCaptureSource', JSON.stringify(state.preferredCaptureSource));
}

const state = {
  sources: [],
  selectedSourceId: null,
  preferredCaptureSource: loadPreferredCaptureSource(),
  captureStreams: [],
  captureVideos: [],
  compositeStream: null,
  mixedStream: null,
  micStream: null,
  speechMicStream: null,
  processedMicStream: null,
  micRecorder: null,
  micWriteQueue: Promise.resolve(),
  neuralMicRecorder: null,
  neuralMicWriteQueue: Promise.resolve(),
  neuralMicMethod: 'none',
  webcamStream: null,
  webcamVideo: null,
  applicationAudioPath: null,
  activeRecordingMeta: null,
  platformInfo: null,
  mediaRecorder: null,
  audioContext: null,
  deepFilterProcessor: null,
  rnnoiseSourceNode: null,
  rnnoiseNode: null,
  rnnoiseDestination: null,
  analyser: null,
  systemAnalyser: null,
  mainAudioDestination: null,
  systemAudioSourceNode: null,
  preflightMicStream: null,
  preflightMicContext: null,
  preflightMicAnalyser: null,
  preflightMicMeterHandle: null,
  preflightMicToken: 0,
  preflightMicHealth: 'Checking…',
  timerHandle: null,
  meterHandle: null,
  compositorHandle: null,
  compositorTimer: null,
  compositorVideoFrameHandle: null,
  compositorVideoFrameTarget: null,
  captureReconnectInProgress: false,
  captureReconnectGeneration: 0,
  captureReconnectRetryTimer: null,
  recordingWriteError: null,
  recordingMicMuted: false,
  recordingMicCanStart: false,
  recordingMicStarting: false,
  recordingMicStartOffsetMs: null,
  recordingMicMimeType: '',
  recordingNeuralMicMimeType: '',
  recordingChunkQueueDepth: 0,
  recordingChunkMaxWriteMs: 0,
  cursorPollTimer: null,
  cursorPollBusy: false,
  compositeCanvas: null,
  compositeContext: null,
  compositeLayout: null,
  directCapturePassThrough: false,
  cursorPoint: null,
  nativeCursorCapture: false,
  recentKeystrokes: [],
  unsubscribeKeystroke: null,
  regionNormalized: null,
  regionSourceId: null,
  regionDraft: null,
  regionDragging: false,
  regionDragStart: null,
  startedAt: 0,
  totalPausedMs: 0,
  pauseStartedAt: 0,
  writeQueue: Promise.resolve(),
  savedPath: null,
  recordingsDirectory: '',
  recordings: [],
  categories: [],
  categoryFilter: '__all__',
  libraryQuickFilter: 'all',
  favoriteRecordingPaths: loadFavoriteRecordingPaths(),
  selectedPlaybackPath: null,
  playbackTranscript: { text: '', srt: '' },
  playbackInsights: { overview: '', chapters: [], summaryBullets: [], actionItems: [] },
  insightsLoading: false,
  subtitleCues: [],
  subtitleTimingApproximate: false,
  transcriptTargetPath: null,
  transcriptTxtPath: '',
  transcriptSrtPath: '',
  localSrt: '',
  isStarting: false,
  isStopping: false,
  finalizingRecordingSessions: new Set(),
  recordingStopSequence: 0,
  transcriptVisible: localStorage.getItem('playbackTranscriptVisible') !== '0',
  transcribingPaths: new Set(),
  trimStart: 0,
  trimEnd: null,
  currentWorkspace: 'capture',
  playbackSelectionToken: 0,
  playbackRepairAttempts: new Set(),
  viewMode: 'full',
  playerFullscreen: false,
  pendingSeekTarget: null,
  seekResetTimer: null,
  trimDragHandle: null,
  unsubscribeFullscreen: null,
  settingsCollapsed: false,
  recordAdvancedCollapsed: localStorage.getItem('recordAdvancedCollapsed') !== '0',
  appToolsCollapsed: localStorage.getItem('appToolsCollapsed') !== '0',
  transparencyPercent: 0,
  alwaysOnTop: false,
  windowCapturePrivacyEnabled: true,
  windowCapturePrivacySupported: true,
  windowCapturePrivacyEffective: true,
  playbackSidebarWidth: 300,
  librarySearch: '',
  librarySearchMatches: new Map(),
  librarySearchTimer: null,
  waveformSamples: [],
  waveformHasAudio: false,
  playbackMarkers: [],
  playbackVoiceHighlights: [],
  voiceHighlightsVisible: localStorage.getItem('voiceHighlightsVisible') !== '0',
  pendingMarkers: [],
  liveVoiceHighlights: [],
  liveVoiceHighlightActive: null,
  liveVoiceHighlightCandidateFrames: 0,
  liveVoiceHighlightReleaseUntil: 0,
  voiceHighlightHistory: [],
  voiceHighlightNoiseFloorDb: -58,
  voiceHighlightLeakGainDb: null,
  voiceHighlightTimer: null,
  voiceHighlightMicAnalyser: null,
  voiceHighlightMicSourceNode: null,
  voiceHighlightLastRenderAt: 0,
  bookmarkClickTimer: null,
  bookmarkEditorAutoSaveTimer: null,
  recordingBookmarkEditorMarkerId: '',
  recordingBookmarkEditorTimer: null,
  bookmarkDialogSeconds: 0,
  bookmarkDialogMarkerId: '',
  bookmarkDialogWasPlaying: false,
  bookmarkOverlayTimer: null,
  lastBookmarkClockTime: null,
  editCuts: [],
  editBusy: false,
  readinessTimer: null,
  unsubscribeShortcuts: null,
  batchSelectionMode: false,
  batchSelectedPaths: new Set(),
  transcriptSearchMatches: [],
  transcriptSearchPosition: -1,
  transcriptActiveCueIndex: -1,
  playbackCueIndex: -1,
  transcriptView: localStorage.getItem('transcriptView') || 'raw',
  speakerSegments: [],
  speakerCount: 0,
  speakerLoading: false,
  speakerError: '',
  speakerDefinitions: [],
  speakerRecordingPath: null,
  aiJobs: new Map(),
  activeAiJobId: null,
  unsubscribeAiStatus: null,
  unsubscribeVoiceHighlightsUpdated: null,
  aiStatusTicker: null,
  trimZoom: Math.max(1, Math.min(12, Number(localStorage.getItem('trimZoom')) || 1)),
  trimSnapSilence: localStorage.getItem('trimSnapSilence') !== '0',
  insightCorrectionBusy: false,
  speakerCorrectionsCollapsed: localStorage.getItem('speakerCorrectionsCollapsed') === '1',
  insightsPanelCollapsed: localStorage.getItem('insightsPanelCollapsed') === '1',
  chaptersCollapsed: localStorage.getItem('chaptersCollapsed') === '1',
  meetingSummaryCollapsed: localStorage.getItem('meetingSummaryCollapsed') === '1',
  actionItemsCollapsed: localStorage.getItem('actionItemsCollapsed') === '1',
  compactCaptureCollapsed: localStorage.getItem('compactCaptureCollapsed') !== '0',
  timelinePreviewTimer: null,
  timelinePreviewTarget: null,
  timelinePreviewLastSeek: -1,
  playbackVolume: clamp(Number(localStorage.getItem('playbackVolume') ?? 1), 0, 1),
  playbackSpeedValue: Number(localStorage.getItem('playbackSpeed') || 1) || 1,
  subtitlePreference: localStorage.getItem('playbackSubtitles') === '1',
  playbackToolbarObserver: null,
  latestUpdateStatus: null,
  unsubscribeUpdateStatus: null,
  updateDialogRetryTimer: null,
  lastDiagnostics: null,
  compactFeedbackTimer: null,
  compactFitFrame: 0,
  compactFitObserver: null,
  waveformRenderFrame: 0,
  waveformResizeObserver: null,
  storageWarningLevel: 'none',
  storageWarningToastAt: 0,
  recoveryNoticeData: null,
  startupRecoveryBusy: false,
  recordingStartHardBlocked: false,
  recordingStartHardBlockReason: '',
  unsubscribeStartupRecovery: null,
  unsubscribeRecoveryNotice: null,
  unsubscribeCloseBlocked: null,
  recordingPerfSampleTimer: null,
  recordingPerfLogTimer: null,
  recordingPerfLastTick: 0,
  recordingPerfMaxDriftMs: 0,
  recordingAutoStopReason: '',
  recordingHealthTimer: null,
  recordingHealth: { level: 'idle', message: '' },
  recordingHealthLastAlertKey: '',
  recordingCheckpointTimer: null,
  chapterSidebarVisible: localStorage.getItem('chapterSidebarVisible') === '1',
  voiceEnrollmentProfile: null,
  voiceEnrollmentBusy: false,
  voiceEnrollmentStream: null,
  voiceEnrollmentRecorder: null,
  voiceEnrollmentTimer: null
};

function friendlyTechnicalText(message) {
  let text = String(message || '');
  const replacements = [
    [/\bcomputer audio\b/gi, 'system audio'],
    [/\ball-computer audio\b/gi, 'all system audio'],
    [/\bDiarization\b/gi, 'Speaker detection'],
    [/\bdiarization\b/gi, 'speaker detection'],
    [/Loading Whisper model[^.]*\.?/gi, 'Preparing transcription…'],
    [/Downloading Whisper(?: Small)?/gi, 'Downloading transcription model'],
    [/Downloading Speaker Segmentation/gi, 'Downloading speaker-detection model'],
    [/Downloading Speaker Voice Matching/gi, 'Downloading speaker-detection model'],
    [/Downloading Speech Detection/gi, 'Downloading speech-analysis model'],
    [/Whisper model/gi, 'transcription model'],
    [/Qwen(?:2\.5)?[^ ]*/gi, 'meeting-insights model'],
    [/Silero VAD/gi, 'speech analysis'],
    [/FFmpeg/gi, 'media processor'],
    [/Starting local model…/gi, 'Preparing local AI…'],
    [/Queued/gi, 'Waiting to start'],
    [/Analyzing complete recording…/gi, 'Listening to the recording…'],
    [/Formatting transcript…/gi, 'Finishing transcript…'],
    [/Recovering phrase (\d+) of (\d+)…/gi, 'Reviewing speech section $1 of $2…'],
    [/Loading speaker segmentation[^.]*\.?/gi, 'Preparing speaker detection…'],
    [/Loading speaker embedding[^.]*\.?/gi, 'Preparing speaker detection…'],
    [/Loading meeting[^.]*model[^.]*\.?/gi, 'Preparing meeting insights…'],
    [/Loading speech[^.]*model[^.]*\.?/gi, 'Preparing speech analysis…']
  ];
  for (const [pattern, value] of replacements) text = text.replace(pattern, value);
  return text.replace(/\s{2,}/g, ' ').trim();
}

function friendlyErrorText(message) {
  const raw = String(message?.message || message || 'Something went wrong.');
  if (/Could not create (?:MP4|M4A)|final output validation|Recovery copy protected|source capture was left in the recovery folder/i.test(raw)) {
    return 'Recording could not be saved normally. Your source recording is protected for recovery. Use Recover below to try again.';
  }
  if (/FFmpeg|media processor|binary was not found/i.test(raw)) {
    return 'A required media component is unavailable. Reinstall or repair PulseStudio, then try again. Your existing recordings are not affected.';
  }
  if (/local AI worker|AI processing timed out/i.test(raw)) {
    return 'Local AI stopped unexpectedly. Your recording is safe; retry the AI action when convenient.';
  }
  if (/permission|not allowed|denied|restricted/i.test(raw)) return friendlyTechnicalText(raw);
  return friendlyTechnicalText(raw);
}

function setStatus(message, isError = false) {
  const text = isError ? friendlyErrorText(message) : friendlyTechnicalText(message);
  $('permissionBox').textContent = text;
  $('permissionBox').classList.toggle('error', isError);
  const compactStatus = $('compactStatus');
  if (compactStatus) {
    compactStatus.textContent = text || '';
    compactStatus.classList.toggle('error', isError);
  }
}

function showToast(message, tone = 'success', duration = 2200) {
  if (!message) return;
  let host = document.getElementById('toastHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toastHost';
    host.className = 'toast-host';
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  const toast = document.createElement('div');
  toast.className = `app-toast ${tone}`;
  toast.textContent = message;
  host.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 180);
  }, duration);
}

function showRecoveryNotice(data = {}) {
  const panel = $('recoveryNotice');
  if (!panel) return;
  state.recoveryNoticeData = { ...data };
  const recovered = Boolean(data.recovered);
  $('recoveryNoticeTitle').textContent = recovered ? 'Recording recovered' : (data.title || 'Unfinished recording found');
  $('recoveryNoticeDetail').textContent = recovered
    ? (data.detail || 'Your recording was recovered successfully and is available in Playback.')
    : (data.detail || 'Your recording data is safe. You can retry recovery now or inspect the protected files.');
  const hideActions = recovered || Boolean(data.none) || Boolean(data.informational);
  $('retryRecovery').classList.toggle('hidden', hideActions);
  $('showRecoveryFiles').classList.toggle('hidden', hideActions);
  $('discardRecovery')?.classList.toggle('hidden', hideActions);
  if ($('discardRecovery')) $('discardRecovery').disabled = Boolean(state.startupRecoveryBusy);
  panel.classList.toggle('recovered', recovered);
  panel.classList.toggle('informational', Boolean(data.informational));
  panel.classList.remove('hidden');
  scheduleCompactWindowFit();
}

function hideRecoveryNotice() {
  state.recoveryNoticeData = null;
  $('recoveryNotice')?.classList.add('hidden');
  scheduleCompactWindowFit();
}

function friendlyAiDetail(detail) {
  return friendlyTechnicalText(detail || '');
}

function compactDesiredContentHeight() {
  // v0.2.57: the normal Mini HUD is intentionally fixed at 262 x 84. Only an
  // explicitly expanded compact setup is allowed to request extra vertical space.
  if (state.compactCaptureCollapsed) return 84;
  const shell = document.querySelector('.app-shell');
  if (!shell) return 84;
  const rect = shell.getBoundingClientRect();
  return Math.max(84, Math.ceil(Math.max(rect.height, shell.scrollHeight || 0) + 2));
}

function scheduleCompactWindowFit() {
  if (state.viewMode !== 'compact' || !window.recorderAPI.fitCompactWindow) return;
  if (state.compactFitFrame) cancelAnimationFrame(state.compactFitFrame);
  state.compactFitFrame = requestAnimationFrame(() => {
    state.compactFitFrame = 0;
    const height = compactDesiredContentHeight();
    if (height > 0) window.recorderAPI.fitCompactWindow(height).catch(() => {});
  });
}

function installCompactFitObserver() {
  if (state.compactFitObserver || typeof ResizeObserver === 'undefined') return;
  const shell = document.querySelector('.app-shell');
  if (!shell) return;
  state.compactFitObserver = new ResizeObserver(() => scheduleCompactWindowFit());
  state.compactFitObserver.observe(shell);
}

function showCompactFeedback(message, duration = 1700) {
  const target = $('compactFeedback');
  if (!target || !message) return;
  clearTimeout(state.compactFeedbackTimer);
  target.textContent = message;
  target.classList.remove('hidden');
  requestAnimationFrame(() => { target.classList.add('show'); scheduleCompactWindowFit(); });
  state.compactFeedbackTimer = setTimeout(() => {
    target.classList.remove('show');
    setTimeout(() => { target.classList.add('hidden'); scheduleCompactWindowFit(); }, 150);
  }, duration);
}

function renderRecordingHealth(level = 'idle', message = '') {
  const normalized = ['ok', 'warning', 'error'].includes(level) ? level : 'idle';
  state.recordingHealth = { level: normalized, message: String(message || '') };
  const compact = $('compactHealthIndicator');
  if (compact) {
    compact.classList.toggle('hidden', normalized === 'idle');
    compact.dataset.level = normalized;
    compact.title = message || 'Recording health';
    compact.setAttribute('aria-label', message || 'Recording health');
  }
  const full = $('recordingHealthBadge');
  if (full) {
    full.classList.toggle('hidden', normalized === 'idle');
    full.dataset.level = normalized;
    const text = $('recordingHealthText');
    if (text) text.textContent = normalized === 'ok' ? 'Recording healthy' : (message || 'Recording health warning');
    full.title = message || 'Recording health';
  }
}

function captureDeviceMetadataSnapshot() {
  const serializeTrack = (track) => ({
    kind: track.kind,
    label: String(track.label || '').slice(0, 180),
    readyState: track.readyState,
    enabled: Boolean(track.enabled),
    muted: Boolean(track.muted),
    settings: track.getSettings?.() || {}
  });
  return {
    captureTracks: state.captureStreams.flatMap((stream) => stream?.getTracks?.() || []).map(serializeTrack),
    mixedTracks: (state.mixedStream?.getTracks?.() || []).map(serializeTrack),
    microphoneTracks: (state.micStream?.getAudioTracks?.() || []).map(serializeTrack),
    processedMicrophoneTracks: (state.processedMicStream?.getAudioTracks?.() || []).map(serializeTrack)
  };
}

async function evaluateRecordingHealth() {
  const active = Boolean(state.mediaRecorder && state.mediaRecorder.state !== 'inactive' && state.startedAt);
  if (!active) { renderRecordingHealth('idle', ''); return; }
  let main = null;
  try { main = await window.recorderAPI.getRecordingHealth?.(); } catch {}
  let level = 'ok';
  let message = 'Recording healthy';
  if (state.captureReconnectInProgress) { level = 'warning'; message = 'Display capture disconnected · reconnecting'; }
  else if (state.recordingWriteError || main?.lastWriteError) { level = 'error'; message = 'Disk write interrupted'; }
  else if (state.mediaRecorder?.state === 'inactive') { level = 'error'; message = 'Media encoder stopped unexpectedly'; }
  else if ((state.mixedStream?.getVideoTracks?.() || []).some((track) => track.readyState !== 'live')) { level = 'error'; message = 'Video capture track unavailable'; }
  else if (state.recordingMicCanStart && !state.recordingMicMuted && !(state.micStream?.getAudioTracks?.() || []).some((track) => track.readyState === 'live')) { level = 'warning'; message = 'Microphone temporarily unavailable'; }
  else if (state.activeRecordingMeta?.systemAudioMode === 'system' && !state.captureStreams.some((stream) => (stream?.getAudioTracks?.() || []).some((track) => track.readyState === 'live'))) { level = 'warning'; message = 'System audio temporarily unavailable'; }
  else if (state.activeRecordingMeta?.systemAudioMode === 'application' && main && !main.applicationAudioActive && !main.applicationAudioTempActive) { level = 'warning'; message = 'Selected application audio temporarily unavailable'; }
  else if (Number(main?.freeBytes) > 0 && Number(main.freeBytes) < 256 * 1024 * 1024) { level = 'warning'; message = 'Recording storage is running low'; }
  else if (Number(main?.chunkAgeMs) > 5000 && state.mediaRecorder?.state === 'recording') { level = 'warning'; message = 'Recording writer delayed'; }

  const prior = state.recordingHealth || { level: 'idle', message: '' };
  renderRecordingHealth(level, message);
  const key = `${level}:${message}`;
  if (level !== 'ok' && key !== state.recordingHealthLastAlertKey && (prior.level !== level || prior.message !== message)) {
    state.recordingHealthLastAlertKey = key;
    if (state.viewMode === 'compact') showCompactFeedback(message, 2800);
    else setStatus(message, level === 'error');
    window.recorderAPI.logEvent?.(level === 'error' ? 'error' : 'warn', 'renderer.recording-health-transition', { level, message, health: main || {} });
  } else if (level === 'ok') state.recordingHealthLastAlertKey = '';
}

function startRecordingHealthMonitor() {
  clearInterval(state.recordingHealthTimer);
  evaluateRecordingHealth();
  state.recordingHealthTimer = setInterval(evaluateRecordingHealth, 1000);
}

function stopRecordingHealthMonitor() {
  clearInterval(state.recordingHealthTimer);
  state.recordingHealthTimer = null;
  renderRecordingHealth('idle', '');
}

async function checkpointActiveRecording(reason = 'interval') {
  if (!state.startedAt || !state.activeRecordingMeta || !window.recorderAPI.checkpointRecording) return;
  const durationSeconds = Math.max(0.2, elapsedMs() / 1000);
  const voiceHighlights = MY_VOICE_HIGHLIGHTS_ENABLED ? normalizeLiveVoiceHighlights(durationSeconds) : [];
  const visibleAi = currentVisibleAiJob();
  try {
    await window.recorderAPI.checkpointRecording({
      reason,
      elapsedMs: elapsedMs(),
      markers: [...state.pendingMarkers],
      ...(MY_VOICE_HIGHLIGHTS_ENABLED ? { voiceHighlights } : {}),
      sourceName: state.activeRecordingMeta.sourceName || '',
      sourceId: state.activeRecordingMeta.sourceId || '',
      sourceDisplayId: state.activeRecordingMeta.sourceDisplayId || '',
      captureMode: state.activeRecordingMeta.captureMode || '',
      captureDeviceMetadata: captureDeviceMetadataSnapshot(),
      processingStatus: visibleAi ? { task: visibleAi.task || '', state: visibleAi.state || '', progress: visibleAi.progress ?? null, label: visibleAi.label || '' } : {}
    });
  } catch (error) {
    window.recorderAPI.logEvent?.('warn', 'renderer.recording-checkpoint-failed', { reason, error: String(error?.message || error || '') });
  }
}

function startRecordingCheckpointTimer() {
  clearInterval(state.recordingCheckpointTimer);
  checkpointActiveRecording('recording-start');
  state.recordingCheckpointTimer = setInterval(() => checkpointActiveRecording('interval'), 15000);
}

function stopRecordingCheckpointTimer() {
  clearInterval(state.recordingCheckpointTimer);
  state.recordingCheckpointTimer = null;
}

function currentVisibleAiJob() {
  const jobs = [...state.aiJobs.values()];
  const active = jobs.find((job) => job.id === state.activeAiJobId && ['running', 'cancelling'].includes(job.state));
  // A queued low-priority task must never mask the task that is actually using the
  // local AI worker. That made meeting notes look frozen at 0% while, for example,
  // speaker detection was really running in front of it.
  return active
    || jobs.find((job) => ['running', 'cancelling'].includes(job.state))
    || jobs.find((job) => job.state === 'queued')
    || jobs.slice().reverse().find((job) => ['complete', 'deferred', 'error', 'cancelled'].includes(job.state))
    || null;
}

function renderCompactAiStatus() {
  const mini = $('compactAiMiniStatus');
  if (!mini) return;
  const recordingActive = Boolean(state.mediaRecorder && state.mediaRecorder.state !== 'inactive');
  const activeStates = new Set(['running', 'queued', 'cancelling']);
  const job = currentVisibleAiJob();
  const compactSuppressedJob = job?.task === 'transcribe';
  if (state.viewMode !== 'compact' || !recordingActive || !job || !activeStates.has(job.state) || compactSuppressedJob) {
    mini.classList.add('hidden');
    scheduleCompactWindowFit();
    return;
  }
  const progress = job.progress == null ? null : Number.isFinite(Number(job.progress)) ? clamp(Number(job.progress), 0, 1) : null;
  const compactFile = String(job.recordingName || '').trim();
  $('compactAiMiniLabel').textContent = [friendlyTechnicalText(job.label || 'Processing previous recording'), compactFile].filter(Boolean).join(' · ');
  $('compactAiMiniProgress').textContent = progress == null ? '' : `${Math.round(progress * 100)}%`;
  mini.dataset.state = job.state || 'running';
  mini.classList.remove('hidden');
  scheduleCompactWindowFit();
}

function renderPlaybackProcessingStatus() {
  const badge = $('playbackProcessingBadge');
  if (!badge) return;
  if (!state.selectedPlaybackPath) { badge.classList.add('hidden'); return; }
  const selected = state.recordings.find((item) => item.path === state.selectedPlaybackPath);
  const selectedName = selected?.name || state.selectedPlaybackPath.split(/[\\/]/).pop() || '';
  const matchingJobs = [...state.aiJobs.values()].filter((job) => {
    const jobPath = String(job.recordingPath || '');
    const jobName = String(job.recordingName || '');
    return (jobPath && jobPath === state.selectedPlaybackPath) || (jobName && jobName === selectedName);
  });
  const job = matchingJobs.find((item) => ['running', 'cancelling'].includes(item.state)) || matchingJobs.find((item) => item.state === 'queued');
  let text = '';
  let stateName = 'ready';
  if (job) {
    const pct = Number.isFinite(Number(job.progress)) ? ` ${Math.round(clamp(Number(job.progress), 0, 1) * 100)}%` : '';
    if (job.task === 'transcribe') text = `Transcribing${pct}`;
    else if (job.task === 'diarize') text = `Identifying speakers${pct}`;
    else if (job.task === 'meeting-insights') text = `Building notes${pct}`;
    else text = `${friendlyTechnicalText(job.label || 'Processing')}${pct}`;
    if (job.state === 'queued') text += ' · queued';
    stateName = job.state === 'queued' ? 'queued' : 'working';
  } else if (state.transcribingPaths.has(state.selectedPlaybackPath)) {
    text = 'Transcribing…'; stateName = 'working';
  } else if (state.speakerLoading && state.speakerRecordingPath === state.selectedPlaybackPath) {
    text = 'Identifying speakers…'; stateName = 'working';
  } else if (state.playbackTranscript?.text || state.playbackTranscript?.srt) {
    text = 'Ready'; stateName = 'ready';
  } else {
    text = 'Preparing…'; stateName = 'queued';
  }
  badge.textContent = text;
  badge.dataset.state = stateName;
  badge.classList.remove('hidden');
}

function renderAiStatusCenter() {
  const center = $('aiStatusCenter');
  if (!center) return;
  const activeStates = new Set(['running', 'queued', 'cancelling']);
  const active = currentVisibleAiJob();
  if (!active) { center.classList.add('hidden'); renderCompactAiStatus(); renderPlaybackProcessingStatus(); return; }
  center.classList.remove('hidden');
  center.dataset.state = active.state || 'running';
  const baseLabel = friendlyTechnicalText(active.label || 'Local AI');
  const queuedLabel = baseLabel.replace(/^Generating\s+/i, '').replace(/^Detecting\s+/i, 'Speaker detection ');
  $('aiStatusLabel').textContent = active.state === 'queued' ? `${queuedLabel} queued` : baseLabel;
  const file = $('aiStatusFile');
  const recordingName = String(active.recordingName || '').trim();
  if (file) {
    file.textContent = recordingName ? `File: ${recordingName}` : '';
    file.classList.toggle('hidden', !recordingName);
    file.title = recordingName;
  }
  const rawProgress = active.progress == null ? null : Number.isFinite(Number(active.progress)) ? clamp(Number(active.progress), 0, 1) : null;
  const progress = active.state === 'queued' ? null : rawProgress;
  const approximate = String(active.phase || '').endsWith('-estimate');
  const pct = progress == null ? '' : `${approximate ? '~' : ''}${Math.round(progress * 100)}%`;
  const now = Date.now();
  const firstSeen = Number(active._firstSeenAt || active.createdAt || active.startedAt || active.updatedAt || now);
  const lastUpdate = Number(active._receivedAt || active.updatedAt || firstSeen);
  const elapsedMs = Math.max(0, now - firstSeen);
  const quietMs = Math.max(0, now - lastUpdate);
  let detail = friendlyAiDetail(active.detail || '');
  if (active.state === 'queued') {
    const blocker = [...state.aiJobs.values()].find((job) => ['running', 'cancelling'].includes(job.state));
    detail = blocker
      ? `Waiting for ${friendlyTechnicalText(blocker.label || 'another local AI task').toLowerCase()} to finish`
      : (elapsedMs > 10000 ? 'Waiting for the local AI worker to become available' : 'Waiting to start');
  } else if (active.state === 'running' && quietMs > 45000) detail = 'Still working — no new progress update yet';
  const elapsed = elapsedMs >= 8000 ? `Elapsed ${formatTime(elapsedMs)}` : '';
  $('aiStatusDetail').textContent = [detail, pct, elapsed].filter(Boolean).join(' · ') || friendlyTechnicalText(active.state);
  $('aiProgressFill').style.width = `${progress == null ? (active.state === 'running' ? 22 : 0) : progress * 100}%`;
  const progressTrack = $('aiProgressTrack');
  if (progressTrack) {
    const numericProgress = progress == null ? 0 : Math.round(progress * 100);
    progressTrack.setAttribute('aria-valuenow', String(numericProgress));
    progressTrack.setAttribute('aria-valuetext', active.state === 'queued' ? 'Queued' : progress == null ? 'Working' : `${approximate ? 'About ' : ''}${numericProgress}% complete`);
    progressTrack.classList.toggle('activity', active.state === 'running' && (approximate || progress == null || quietMs > 45000));
  }
  const hint = $('aiStatusHint');
  if (hint) {
    const recordingActive = Boolean(state.mediaRecorder && state.mediaRecorder.state !== 'inactive');
    const showHint = activeStates.has(active.state);
    hint.textContent = state.currentWorkspace === 'playback'
      ? 'You can keep reviewing recordings while this continues.'
      : recordingActive
        ? 'Background processing continues without interrupting this recording.'
        : 'You can start another recording while this continues.';
    hint.classList.toggle('hidden', !showHint);
  }
  $('cancelAiJob').disabled = !active.cancellable || !activeStates.has(active.state);
  $('cancelAiJob').dataset.jobId = active.id || '';
  renderCompactAiStatus();
  renderPlaybackProcessingStatus();
}

function placeAiStatusForView() {
  const center = $('aiStatusCenter');
  const recordingActive = Boolean(state.mediaRecorder && state.mediaRecorder.state !== 'inactive');
  const target = state.currentWorkspace === 'playback'
    ? $('playbackAiStatusSlot')
    : recordingActive
      ? $('recordingActiveAiStatusSlot')
      : $('recordingAiStatusSlot');
  if (center && target && center.parentElement !== target) target.appendChild(center);
  renderCompactAiStatus();
}

function handleAiStatus(status) {
  if (!status?.id) return;
  const previous = state.aiJobs.get(status.id) || {};
  const now = Date.now();
  const next = {
    ...previous,
    ...status,
    _firstSeenAt: previous._firstSeenAt || Number(status.createdAt) || now,
    _receivedAt: now,
    _progressChangedAt: Number(previous.progress) === Number(status.progress) ? (previous._progressChangedAt || now) : now
  };
  state.aiJobs.set(status.id, next);
  if (['running', 'cancelling'].includes(status.state)) state.activeAiJobId = status.id;
  else if (state.activeAiJobId === status.id && ['complete', 'error', 'cancelled'].includes(status.state)) state.activeAiJobId = null;
  renderAiStatusCenter();
  if (['complete', 'deferred', 'cancelled', 'error'].includes(status.state)) {
    setTimeout(() => {
      const current = state.aiJobs.get(status.id);
      if (current && ['complete', 'deferred', 'cancelled', 'error'].includes(current.state)) state.aiJobs.delete(status.id);
      renderAiStatusCenter();
    }, status.state === 'error' ? 12000 : status.state === 'deferred' ? 5500 : 3500);
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function even(value) {
  const n = Math.max(2, Math.round(value));
  return n % 2 === 0 ? n : n + 1;
}

function formatTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${sec}`;
}

function formatPreciseSeconds(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const ms = Math.floor((value % 1) * 1000);
  const total = Math.floor(value);
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}.${String(ms).padStart(3, '0')}`;
}

function formatBytes(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatFreeSpace(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return 'Unknown';
  if (value >= 1024 ** 3) return `${(value / (1024 ** 3)).toFixed(value >= 10 * 1024 ** 3 ? 0 : 1)} GB free`;
  return `${Math.max(0, value / (1024 ** 2)).toFixed(0)} MB free`;
}

function setReadinessItem(id, level, value) {
  const item = $(id);
  if (!item) return;
  item.classList.remove('ready', 'warn', 'error');
  item.classList.add(level);
  const strong = item.querySelector('strong');
  if (strong) strong.textContent = value;
}

function formatDate(ms) {
  try { return new Date(ms).toLocaleString(); } catch { return ''; }
}

function formatRecordingListDate(ms, group = '') {
  try {
    const date = new Date(ms);
    if (!Number.isFinite(date.getTime())) return '';
    const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (group === 'Today' || group === 'Yesterday') return time;
    return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${time}`;
  } catch { return ''; }
}

function recordingDateGroup(ms) {
  const date = new Date(ms);
  if (!Number.isFinite(date.getTime())) return 'Earlier';
  const today = new Date();
  const todayDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const itemDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const daysAgo = Math.round((todayDay - itemDay) / 86400000);
  if (daysAgo <= 0) return 'Today';
  if (daysAgo === 1) return 'Yesterday';
  if (daysAgo <= 6) return 'Earlier this week';
  return 'Earlier';
}

function recordingFolderDisplayName(directory) {
  const parts = String(directory || '').split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || 'Movies / Videos';
}

function updatePlaybackFolderLabel(directory) {
  const label = $('recordingsFolderLabel');
  const pill = $('recordingsFolderPill');
  if (label) label.textContent = recordingFolderDisplayName(directory);
  if (pill) pill.title = directory ? `Recording folder: ${directory}` : 'Recording folder';
}

function persistFavoriteRecordingPaths() {
  localStorage.setItem('favoriteRecordingPaths', JSON.stringify([...state.favoriteRecordingPaths]));
}

function setRecordingFavorite(recordingPath, favorite) {
  if (!recordingPath) return;
  if (favorite) state.favoriteRecordingPaths.add(recordingPath);
  else state.favoriteRecordingPaths.delete(recordingPath);
  persistFavoriteRecordingPaths();
}

function formatDuration(seconds, fallback = '—') {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return fallback;
  const total = Math.floor(value);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function elapsedMs() {
  if (!state.startedAt) return 0;
  const now = state.pauseStartedAt || Date.now();
  return now - state.startedAt - state.totalPausedMs;
}

function updateTimerDisplay() {
  const value = formatTime(elapsedMs());
  $('timer').textContent = value;
  $('recordingDuration').textContent = value;
  if ($('compactRecordingDuration')) $('compactRecordingDuration').textContent = value;
}

function setStartButtonPhase(phase = 'idle', countdown = 0) {
  const active = phase === 'recording';
  const full = $('startButton');
  const compact = $('compactStartButton');
  if (full && !active) {
    full.classList.toggle('is-preparing', phase === 'preparing' || phase === 'countdown' || phase === 'saving');
    full.textContent = phase === 'countdown' ? `Starting in ${countdown}…` : phase === 'saving' ? 'Saving…' : phase === 'preparing' ? 'Preparing…' : '● Start recording';
    full.setAttribute('aria-label', phase === 'countdown' ? `Recording starts in ${countdown} seconds` : phase === 'saving' ? 'Saving stopped recording' : phase === 'preparing' ? 'Preparing recording' : 'Start recording');
    full.title = full.getAttribute('aria-label');
  }
  if (compact && !active) {
    compact.textContent = phase === 'countdown' ? `${countdown}s…` : phase === 'saving' ? 'Saving…' : phase === 'preparing' ? 'Preparing…' : '● Start';
    compact.setAttribute('aria-label', phase === 'countdown' ? `Recording starts in ${countdown} seconds` : phase === 'saving' ? 'Saving stopped recording' : phase === 'preparing' ? 'Preparing recording' : 'Start recording');
    compact.title = compact.getAttribute('aria-label');
  }
}

function recordStartBlockReason() {
  // Background recovery never blocks a new capture. The main process detaches the
  // previous session into its own manifest and pauses recovery if recording starts.
  if (state.recordingStartHardBlocked) return state.recordingStartHardBlockReason || 'A protected recording needs recovery before another recording can start';
  if (state.isStopping) return 'Securing the recording that just stopped';
  if (state.isStarting) return 'Preparing recording';
  return '';
}

function syncRecordStartAvailability() {
  const recordingActive = Boolean(state.mediaRecorder && state.mediaRecorder.state !== 'inactive');
  let reason = recordStartBlockReason();
  // During a normal active recording this primary control is the Stop button and
  // must remain usable. Transitional start/stop phases still keep it disabled.
  if (recordingActive && !state.isStarting && !state.isStopping) reason = '';
  const disabled = Boolean(reason);
  for (const id of ['startButton', 'compactStartButton']) {
    const button = $(id);
    if (!button) continue;
    button.disabled = disabled;
    if (!recordingActive && reason) {
      button.title = reason;
      button.setAttribute('aria-label', reason);
    } else if (!recordingActive && !state.isStarting) {
      button.title = 'Start recording';
      button.setAttribute('aria-label', 'Start recording');
    }
  }
}

function setRecordConfigurationLocked(active) {
  document.body.classList.toggle('recording-config-locked', Boolean(active));
  const controls = document.querySelectorAll([
    '#captureMode', '#chooseRegion', '#refreshSources',
    '#compactSourceSelect', '#compactCaptureMode', '#compactChooseRegion', '#compactQuality', '#compactFrameRate',
    '#settingsContent input', '#settingsContent select',
    '#recordAdvancedContent input', '#recordAdvancedContent select', '#recordAdvancedContent button',
    '#recordQuickControls input', '#recordQuickControls select', '#recordQuickControls button', '#compactRecordingKindControl button',
    '#appToolsContent button:not(#windowCapturePrivacyToggle)',
    '#recordDestinationChange'
  ].join(','));
  controls.forEach((control) => {
    if (active) {
      if (control.dataset.recordingLockPreviousDisabled == null) control.dataset.recordingLockPreviousDisabled = control.disabled ? '1' : '0';
      control.disabled = true;
    } else if (control.dataset.recordingLockPreviousDisabled != null) {
      control.disabled = control.dataset.recordingLockPreviousDisabled === '1';
      delete control.dataset.recordingLockPreviousDisabled;
    }
  });
  $('sourceGrid')?.classList.toggle('recording-locked', Boolean(active));
  syncQuickRecordingControls();
  syncPreflightMicMuteButton();
}

function recordingCountdownSeconds() {
  const value = Number($('recordCountdown')?.value || 0);
  return value === 3 || value === 5 ? value : 0;
}

async function runRecordingCountdown() {
  const total = recordingCountdownSeconds();
  if (!total) return;
  for (let remaining = total; remaining > 0; remaining -= 1) {
    setStartButtonPhase('countdown', remaining);
    setStatus(`Recording starts in ${remaining}…`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  setStartButtonPhase('preparing');
  setStatus('Starting capture…');
}

function compactRecordingFolderLabel(value) {
  const parts = String(value || '').replace(/\\/g, '/').split('/').filter(Boolean);
  if (!parts.length) return 'Recording folder';
  const preferred = parts.findIndex((part) => /^(Movies|Videos)$/i.test(part));
  const start = preferred >= 0 ? preferred : Math.max(0, parts.length - 2);
  return parts.slice(start).join(' / ');
}

function updateRecordDestinationIndicator(directory = state.recordingsDirectory) {
  const label = $('recordDestinationLabel');
  const line = $('recordDestinationLine');
  if (!label || !line) return;
  const full = String(directory || '');
  label.textContent = compactRecordingFolderLabel(full);
  line.title = full || 'Recording folder';
}

function stopRecordingPerformanceTelemetry() {
  clearInterval(state.recordingPerfSampleTimer);
  clearInterval(state.recordingPerfLogTimer);
  state.recordingPerfSampleTimer = null;
  state.recordingPerfLogTimer = null;
  state.recordingPerfLastTick = 0;
  state.recordingPerfMaxDriftMs = 0;
}

function logRecordingPerformance(reason = 'heartbeat') {
  try {
    const tracks = (state.captureStreams || []).flatMap((stream) => stream?.getTracks?.() || []).map((track) => ({
      kind: track.kind,
      readyState: track.readyState,
      muted: Boolean(track.muted),
      enabled: Boolean(track.enabled),
      settings: track.getSettings?.() || {}
    }));
    const memory = performance?.memory ? {
      usedJsHeapBytes: Number(performance.memory.usedJSHeapSize || 0),
      totalJsHeapBytes: Number(performance.memory.totalJSHeapSize || 0)
    } : null;
    window.recorderAPI.logEvent?.('info', 'renderer.recording-performance', {
      reason,
      viewMode: state.viewMode,
      mediaRecorderState: state.mediaRecorder?.state || 'inactive',
      directCapturePassThrough: Boolean(state.directCapturePassThrough),
      maxEventLoopDriftMs: Math.round(state.recordingPerfMaxDriftMs || 0),
      recordingChunkQueueDepth: Number(state.recordingChunkQueueDepth || 0),
      recordingChunkMaxWriteMs: Math.round(state.recordingChunkMaxWriteMs || 0),
      memory,
      tracks
    });
    state.recordingPerfMaxDriftMs = 0;
    state.recordingChunkMaxWriteMs = 0;
  } catch {}
}

function startRecordingPerformanceTelemetry() {
  stopRecordingPerformanceTelemetry();
  state.recordingPerfLastTick = performance.now();
  state.recordingPerfSampleTimer = setInterval(() => {
    const now = performance.now();
    const expected = state.recordingPerfLastTick + 5000;
    state.recordingPerfMaxDriftMs = Math.max(state.recordingPerfMaxDriftMs, Math.max(0, now - expected));
    state.recordingPerfLastTick = now;
  }, 5000);
  state.recordingPerfLogTimer = setInterval(() => logRecordingPerformance('30s-heartbeat'), 30000);
  logRecordingPerformance('recording-start');
}

function recordingMicrophoneTracks() {
  const tracks = [];
  for (const stream of [state.micStream, state.speechMicStream, state.processedMicStream]) {
    for (const track of stream?.getAudioTracks?.() || []) if (!tracks.includes(track)) tracks.push(track);
  }
  return tracks;
}

function syncRecordingMicrophoneToggles() {
  const active = Boolean(state.mediaRecorder && state.mediaRecorder.state !== 'inactive');
  // Keep the in-recording mic control visible even when a recording started with
  // Mic disabled. The microphone can then be started on demand without changing the
  // saved pre-recording preference. Until that first enable, the icon remains muted.
  const available = active && (state.recordingMicCanStart || recordingMicrophoneTracks().length > 0);
  for (const id of ['compactRecordingMicToggle', 'recordingMicToggle']) {
    const button = $(id);
    if (!button) continue;
    button.classList.toggle('hidden', !available);
    button.classList.toggle('is-muted', Boolean(state.recordingMicMuted));
    button.disabled = !available || Boolean(state.recordingMicStarting);
    button.setAttribute('aria-pressed', state.recordingMicMuted ? 'true' : 'false');
    const label = state.recordingMicStarting
      ? 'Starting microphone'
      : (state.recordingMicMuted ? 'Unmute microphone' : 'Mute microphone');
    button.setAttribute('aria-label', label);
    if (id === 'compactRecordingMicToggle') {
      button.dataset.fastTooltipTitle = label;
      button.dataset.tooltipDelay = '700';
      button.dataset.tooltipHoverOnly = 'true';
      button.dataset.tooltipCustomOnly = 'true';
      button.removeAttribute('title');
    } else {
      button.title = label;
    }
  }
  syncPreflightMicMuteButton();
}

function attachRecordingMicrophoneLifecycle(stream) {
  stream?.getAudioTracks?.().forEach((track) => {
    track.addEventListener('ended', () => {
      const message = 'The microphone source disconnected while recording. Video/system audio will continue, but local microphone audio may be missing after this point.';
      window.recorderAPI.logEvent?.('warn', 'renderer.microphone-track-ended', { elapsedMs: elapsedMs(), settings: track.getSettings?.() || {} });
      setStatus(message, true);
      showToast('Microphone disconnected — recording continues', 'warning', 7000);
    }, { once: true });
    track.addEventListener('mute', () => window.recorderAPI.logEvent?.('warn', 'renderer.microphone-track-muted', { elapsedMs: elapsedMs() }));
    track.addEventListener('unmute', () => window.recorderAPI.logEvent?.('info', 'renderer.microphone-track-unmuted', { elapsedMs: elapsedMs() }));
  });
}

function createRawMicrophoneRecorder(stream) {
  if (!stream?.getAudioTracks?.().length) return null;
  const micOptions = { audioBitsPerSecond: 192_000 };
  const mimeType = state.recordingMicMimeType || chooseMicrophoneMimeType();
  if (mimeType) micOptions.mimeType = mimeType;
  const recorder = new MediaRecorder(stream, micOptions);
  recorder.addEventListener('dataavailable', (event) => {
    if (!event.data || event.data.size === 0) return;
    state.micWriteQueue = state.micWriteQueue.then(async () => {
      const data = await event.data.arrayBuffer();
      await window.recorderAPI.appendMicrophoneChunk(data);
    });
  });
  recorder.addEventListener('error', (event) => {
    const detail = friendlyErrorText(event.error || 'Check the microphone and try again.');
    setStatus(`Microphone capture stopped unexpectedly. ${detail}`, true);
    window.recorderAPI.logEvent?.('error', 'renderer.microphone-recorder-error', { error: String(event.error?.message || event.error || detail), elapsedMs: elapsedMs() });
  });
  return recorder;
}

function createNeuralMicrophoneRecorder(stream) {
  if (!stream?.getAudioTracks?.().length) return null;
  const neuralOptions = { audioBitsPerSecond: 192_000 };
  const mimeType = state.recordingNeuralMicMimeType || chooseMicrophoneMimeType();
  if (mimeType) neuralOptions.mimeType = mimeType;
  const recorder = new MediaRecorder(stream, neuralOptions);
  recorder.addEventListener('dataavailable', (event) => {
    if (!event.data || event.data.size === 0) return;
    state.neuralMicWriteQueue = state.neuralMicWriteQueue.then(async () => {
      const data = await event.data.arrayBuffer();
      await window.recorderAPI.appendNeuralMicrophoneChunk(data);
    });
  });
  recorder.addEventListener('error', (event) => {
    console.warn(`Speech-processed microphone candidate error: ${event.error?.message || 'Unknown recorder error'}`);
  });
  return recorder;
}

async function startRecordingMicrophoneOnDemand(source = 'mini-controller') {
  if (!state.mediaRecorder || state.mediaRecorder.state === 'inactive') return false;
  if (recordingMicrophoneTracks().length > 0) return true;
  if (state.recordingMicStarting) return false;
  state.recordingMicStarting = true;
  syncRecordingMicrophoneToggles();
  try {
    state.micStream = await createMicStream(true);
    if (!state.micStream?.getAudioTracks?.().length) throw new Error('The microphone did not provide an audio track.');
    attachRecordingMicrophoneLifecycle(state.micStream);

    state.speechMicStream = null;
    state.processedMicStream = null;
    if (['enhanced', 'strong'].includes($('noiseReduction')?.value || '')) {
      await prepareNoiseSuppressedMicrophoneSidecar(state.micStream, { forceSpeech: true });
    }

    // The microphone sidecar starts at this point, not at recording time zero. The
    // saved offset is applied as leading silence during final mixing so the mic stays
    // synchronized with the screen/system audio timeline.
    state.recordingMicStartOffsetMs = Math.max(0, elapsedMs());
    if (state.activeRecordingMeta) {
      state.activeRecordingMeta.microphoneStartOffsetMs = state.recordingMicStartOffsetMs;
      state.activeRecordingMeta.neuralMicrophoneMethod = state.neuralMicMethod || 'none';
    }
    state.micRecorder = createRawMicrophoneRecorder(state.micStream);
    state.neuralMicRecorder = createNeuralMicrophoneRecorder(state.processedMicStream);
    state.micRecorder?.start(2000);
    state.neuralMicRecorder?.start(2000);
    // My Voice highlighting is disabled in v0.2.123 for audio-path isolation.
    if (MY_VOICE_HIGHLIGHTS_ENABLED) {
      attachReadOnlyVoiceHighlightMicAnalyser();
      startLiveVoiceHighlightAnalysis();
    }
    if (state.mediaRecorder.state === 'paused') {
      try { if (state.micRecorder?.state === 'recording') state.micRecorder.pause(); } catch {}
      try { if (state.neuralMicRecorder?.state === 'recording') state.neuralMicRecorder.pause(); } catch {}
    }
    window.recorderAPI.logEvent?.('info', 'renderer.recording-microphone-started-late', {
      source,
      elapsedMs: state.recordingMicStartOffsetMs,
      noiseReduction: $('noiseReduction')?.value || 'off',
      neuralMethod: state.neuralMicMethod || 'none'
    });
    return true;
  } catch (error) {
    state.micStream?.getTracks?.().forEach((track) => { try { track.stop(); } catch {} });
    state.speechMicStream?.getTracks?.().forEach((track) => { try { track.stop(); } catch {} });
    state.processedMicStream?.getTracks?.().forEach((track) => { try { track.stop(); } catch {} });
    state.micStream = null;
    state.speechMicStream = null;
    state.processedMicStream = null;
    state.micRecorder = null;
    state.neuralMicRecorder = null;
    const detail = friendlyErrorText(error);
    setStatus(`Microphone could not be enabled for this recording. ${detail}`, true);
    showToast('Microphone could not be enabled', 'warning', 3200);
    window.recorderAPI.logEvent?.('error', 'renderer.recording-microphone-late-start-failed', { source, error: detail, elapsedMs: elapsedMs() });
    return false;
  } finally {
    state.recordingMicStarting = false;
    syncRecordingMicrophoneToggles();
  }
}

async function setRecordingMicrophoneMuted(muted, source = 'mini') {
  if (!state.mediaRecorder || state.mediaRecorder.state === 'inactive') return false;
  const next = Boolean(muted);
  if (!next && recordingMicrophoneTracks().length === 0) {
    const started = await startRecordingMicrophoneOnDemand(source);
    if (!started) return false;
  }
  const tracks = recordingMicrophoneTracks();
  if (tracks.length) tracks.forEach((track) => { try { track.enabled = !next; } catch {} });
  state.recordingMicMuted = next;
  syncRecordingMicrophoneToggles();
  if (next) {
    setCompactActivityMeter('mic', 0, 'Muted');
    setRecordAudioMeter('preflightMicRow', 'preflightMicMeter', 'preflightMicLevel', 0, 'Muted', 'muted');
  }
  window.recorderAPI.logEvent?.('info', 'renderer.recording-microphone-toggle', { muted: next, source, elapsedMs: elapsedMs() });
  if (state.viewMode === 'compact' || String(source).includes('mini')) {
    showCompactFeedback(next ? 'Microphone muted for this recording' : 'Microphone recording resumed', 900);
  } else {
    showToast(next ? 'Mic muted' : 'Mic on', next ? 'warning' : 'success', 1100);
  }
  syncPreflightMicMuteButton();
  checkpointActiveRecording('microphone-toggle');
  return true;
}

async function toggleRecordingMicrophoneMute(source = 'mini-controller') {
  return setRecordingMicrophoneMuted(!state.recordingMicMuted, source);
}

function setRecordingUi(active) {
  setRecordConfigurationLocked(active);
  document.body.classList.toggle('compact-recording-active', Boolean(active));
  document.body.classList.toggle('recording-in-progress', Boolean(active));
  // Full View performance mode temporarily removes native translucency/vibrancy
  // while capture is active. Mini remains unchanged because its tiny surface is not
  // a meaningful compositor load.
  window.recorderAPI.setRecordingPerformanceMode?.(Boolean(active) && state.viewMode !== 'compact').catch(() => {});
  if (active) startRecordingPerformanceTelemetry(); else stopRecordingPerformanceTelemetry();
  if (!active) {
    state.recordingMicMuted = false;
    document.body.classList.remove('compact-recording-paused');
    // A readiness cycle was deliberately suppressed during capture. Refresh once,
    // after the recording UI has left its performance-critical state.
    setTimeout(() => updateReadiness().catch(() => {}), 0);
  }
  $('recordingDurationBox').classList.toggle('hidden', !active);
  for (const id of ['startButton', 'compactStartButton']) {
    const button = $(id);
    if (!button) continue;
    const compactButton = id === 'compactStartButton';
    if (compactButton) {
      button.innerHTML = active
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2"/></svg><span>Stop</span>'
        : '<span class="compact-record-button-dot" aria-hidden="true"></span><span>Start</span>';
    } else {
      button.textContent = active ? '■ Stop recording' : '● Start recording';
    }
    button.classList.toggle('record', !compactButton && !active);
    button.classList.toggle('stop', !compactButton && active);
    button.classList.toggle('is-recording', compactButton && active);
    button.classList.remove('is-preparing');
    button.setAttribute('aria-label', active ? 'Stop recording' : 'Start recording');
    button.title = active ? 'Stop recording' : 'Start recording';
  }
  for (const id of ['pausePrimaryButton', 'compactPauseButton', 'bookmarkPrimaryButton', 'compactBookmarkButton']) {
    const button = $(id);
    if (!button) continue;
    button.classList.toggle('hidden', !active);
    button.disabled = !active;
  }
  if ($('compactRecordingState')) $('compactRecordingState').textContent = active ? 'REC' : 'READY';
  if ($('compactMicActivity')) $('compactMicActivity').style.width = '0%';
  if ($('compactSystemActivity')) $('compactSystemActivity').style.width = '0%';
  if ($('compactMicActivityLabel')) $('compactMicActivityLabel').textContent = active ? (state.recordingMicMuted ? 'Muted' : (recordingMicrophoneTracks().length ? 'Live' : 'Off')) : 'Off';
  syncRecordingMicrophoneToggles();
  if ($('compactSystemActivityLabel')) $('compactSystemActivityLabel').textContent = active ? ($('systemAudio')?.checked ? 'Live' : 'Off') : 'Off';
  if ($('changeRecordingFolder')) $('changeRecordingFolder').disabled = active;
  if ($('resetRecordingFolder')) $('resetRecordingFolder').disabled = active;
  placeAiStatusForView();
  renderCompactAiStatus();
  renderVoiceEnrollmentStatus();
  if (state.viewMode === 'compact') {
    window.recorderAPI.setCompactRecordingState?.(Boolean(active)).catch(() => {});
    scheduleCompactWindowFit();
  }
  if (!active) {
    updatePauseButtons(false);
    $('timer').textContent = '00:00:00';
    $('recordingDuration').textContent = '00:00:00';
    if ($('compactRecordingDuration')) $('compactRecordingDuration').textContent = '00:00:00';
  }
}

function applyThumbnailSize(value) {
  const size = Math.max(50, Math.min(420, Number(value) || 250));
  document.documentElement.style.setProperty('--thumbnail-size', `${size}px`);
  $('thumbnailSize').value = String(size);
  $('thumbnailSizeValue').textContent = `${size} px`;
  localStorage.setItem('thumbnailSize', String(size));
}

function applyUiTheme(theme) {
  const next = theme === 'studio' ? 'studio' : 'classic';
  document.documentElement.dataset.uiTheme = next;
  localStorage.setItem('uiTheme', next);
  document.querySelectorAll('[data-ui-theme-choice]').forEach((button) => {
    const selected = button.dataset.uiThemeChoice === next;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-checked', selected ? 'true' : 'false');
  });
  scheduleCompactWindowFit();
}

function openThemesDialog() {
  const dialog = $('themesDialog');
  if (!dialog) return;
  applyUiTheme(localStorage.getItem('uiTheme') || document.documentElement.dataset.uiTheme || 'classic');
  dialog.showModal();
}

function applyTheme(theme) {
  const next = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  const isDark = next === 'dark';
  const themeButton = $('themeToggle');
  if (themeButton) {
    themeButton.innerHTML = isDark
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.5"/><path d="M12 2.8v2.1M12 19.1v2.1M2.8 12h2.1M19.1 12h2.1M5.5 5.5 7 7M17 17l1.5 1.5M18.5 5.5 17 7M7 17l-1.5 1.5"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.2 15.2A7.4 7.4 0 0 1 8.8 4.8 7.8 7.8 0 1 0 19.2 15.2Z"/></svg>';
    themeButton.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
    themeButton.setAttribute('aria-label', themeButton.title);
  }
  localStorage.setItem('theme', next);
  scheduleCompactWindowFit();
}

function updatePauseButtons(paused) {
  const label = paused ? 'Resume' : 'Pause';
  for (const id of ['pauseButton', 'pausePrimaryButton', 'compactPauseButton']) {
    const button = $(id);
    if (!button) continue;
    const compactButton = id === 'compactPauseButton';
    if (compactButton) {
      button.innerHTML = paused
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7Z"/></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="5" width="3.5" height="14" rx="1"/><rect x="13.5" y="5" width="3.5" height="14" rx="1"/></svg>';
    } else {
      button.textContent = paused ? '▶ Resume' : '❚❚ Pause';
    }
    button.title = label;
    button.setAttribute('aria-label', `${label} recording`);
    button.classList.toggle('resume', paused);
  }
  $('recordingDurationBox')?.classList.toggle('paused', paused);
  document.body.classList.toggle('compact-recording-paused', Boolean(paused));
  if ($('compactRecordingState')) $('compactRecordingState').textContent = paused ? 'PAUSED' : ((state.mediaRecorder && state.mediaRecorder.state !== 'inactive') ? 'REC' : 'READY');
  scheduleCompactWindowFit();
  if (paused) {
    if ($('compactMicActivity')) $('compactMicActivity').style.width = '0%';
    if ($('compactSystemActivity')) $('compactSystemActivity').style.width = '0%';
    if ($('compactMicActivityLabel')) $('compactMicActivityLabel').textContent = 'Paused';
    if ($('compactSystemActivityLabel')) $('compactSystemActivityLabel').textContent = 'Paused';
  }
}

async function applyViewMode(mode, resizeWindow = true) {
  const compact = mode === 'compact';
  state.viewMode = compact ? 'compact' : 'full';
  document.body.classList.toggle('compact-mode', compact);
  placeAiStatusForView();
  if (compact) $('stickyPlaybackControls')?.classList.remove('is-visible');
  $('fullViewButton').classList.toggle('active', !compact);
  $('compactViewButton').classList.toggle('active', compact);
  $('fullViewButton').setAttribute('aria-pressed', String(!compact));
  $('compactViewButton').setAttribute('aria-pressed', String(compact));
  $('playbackWorkspaceTab').classList.toggle('hidden', compact);
  $('brandTitle').textContent = compact ? 'Mini Controller' : 'Capture, play back, and transcribe';
  if ($('compactCaptureMode')) $('compactCaptureMode').value = $('captureMode')?.value || 'source';
  if ($('compactQuality')) $('compactQuality').value = $('quality')?.value || '1080';
  if ($('compactFrameRate')) $('compactFrameRate').value = $('frameRate')?.value || '30';
  if (compact && state.currentWorkspace === 'playback') setWorkspace('capture');
  applyCompactCaptureCollapsed(state.compactCaptureCollapsed, false);
  localStorage.setItem('viewMode', state.viewMode);
  if (resizeWindow) {
    if (compact) stopPreflightMicMonitor();
    else if (state.currentWorkspace === 'capture' && (!state.mediaRecorder || state.mediaRecorder.state === 'inactive')) refreshPreflightMicMonitor();
    try { await window.recorderAPI.setCompactMode(compact); } catch {}
    if (compact) {
      const active = Boolean(state.mediaRecorder && state.mediaRecorder.state !== 'inactive');
      try { await window.recorderAPI.setCompactRecordingState?.(active); } catch {}
      const privacyStatus = await window.recorderAPI.getWindowCapturePrivacy?.().catch(() => null);
      if (privacyStatus) renderWindowCapturePrivacy(privacyStatus);
    }
  }
  const recordingActive = Boolean(state.mediaRecorder && state.mediaRecorder.state !== 'inactive');
  try { await window.recorderAPI.setRecordingPerformanceMode?.(recordingActive && !compact); } catch {}
  // v0.2.126: transparency is a Mini View preference only. Apply it after any
  // recording-performance transition so that switching Full -> Mini during an
  // active recording cannot accidentally leave Mini opaque, while Full is still
  // forced to 100% opacity by the main process.
  await applyTransparency(state.transparencyPercent, false);
  try { await window.recorderAPI.setAlwaysOnTop(compact && state.alwaysOnTop); } catch {}
  renderCompactAiStatus();
  if (compact) { installCompactFitObserver(); scheduleCompactWindowFit(); }
}

function applySettingsCollapsed(collapsed) {
  state.settingsCollapsed = Boolean(collapsed);
  $('settingsContent')?.classList.toggle('hidden', state.settingsCollapsed);
  const button = $('settingsCollapseButton');
  if (button) {
    button.setAttribute('aria-expanded', String(!state.settingsCollapsed));
    button.classList.toggle('collapsed', state.settingsCollapsed);
    const icon = button.querySelector('.settings-collapse-icon');
    if (icon) icon.textContent = state.settingsCollapsed ? '⌄' : '⌃';
  }
  localStorage.setItem('settingsCollapsed', state.settingsCollapsed ? '1' : '0');
}

function applyRecordAdvancedCollapsed(collapsed, persist = true) {
  state.recordAdvancedCollapsed = Boolean(collapsed);
  $('recordAdvancedContent')?.classList.toggle('hidden', state.recordAdvancedCollapsed);
  const button = $('recordAdvancedToggle');
  if (button) {
    button.setAttribute('aria-expanded', String(!state.recordAdvancedCollapsed));
    button.classList.toggle('collapsed', state.recordAdvancedCollapsed);
    const icon = button.querySelector('.settings-collapse-icon');
    if (icon) icon.textContent = state.recordAdvancedCollapsed ? '⌄' : '⌃';
  }
  if (persist) localStorage.setItem('recordAdvancedCollapsed', state.recordAdvancedCollapsed ? '1' : '0');
}

function applyAppToolsCollapsed(collapsed, persist = true) {
  state.appToolsCollapsed = Boolean(collapsed);
  $('appToolsContent')?.classList.toggle('hidden', state.appToolsCollapsed);
  const button = $('appToolsToggle');
  if (button) {
    button.setAttribute('aria-expanded', String(!state.appToolsCollapsed));
    button.classList.toggle('collapsed', state.appToolsCollapsed);
    const icon = button.querySelector('.settings-collapse-icon');
    if (icon) icon.textContent = state.appToolsCollapsed ? '⌄' : '⌃';
  }
  if (persist) localStorage.setItem('appToolsCollapsed', state.appToolsCollapsed ? '1' : '0');
}


function applyKnowledgeCollapse(buttonId, contentId, collapsed, storageKey = '', persist = true) {
  const button = $(buttonId);
  const content = $(contentId);
  if (content) content.classList.toggle('hidden', Boolean(collapsed));
  if (button) {
    button.setAttribute('aria-expanded', String(!collapsed));
    button.classList.toggle('collapsed', Boolean(collapsed));
    const chevron = button.querySelector('.knowledge-collapse-chevron');
    if (chevron) chevron.textContent = collapsed ? '⌄' : '⌃';
    const label = button.querySelector('.knowledge-collapse-label');
    if (label) label.textContent = collapsed ? 'Expand' : 'Collapse';
    const sectionName = buttonId === 'insightsPanelToggle' ? 'Chapters & meeting insights' : buttonId === 'speakerCorrectionsToggle' ? 'Speaker corrections' : '';
    if (sectionName) {
      const action = collapsed ? 'Expand' : 'Collapse';
      button.setAttribute('aria-label', `${action} ${sectionName}`);
      button.title = `${action} ${sectionName}`;
    }
  }
  if (persist && storageKey) localStorage.setItem(storageKey, collapsed ? '1' : '0');
}

function applyInsightsCollapseState(persist = false) {
  applyKnowledgeCollapse('insightsPanelToggle', 'insightsContent', state.insightsPanelCollapsed, 'insightsPanelCollapsed', persist);
  applyKnowledgeCollapse('chaptersToggle', 'chaptersContent', state.chaptersCollapsed, 'chaptersCollapsed', persist);
  applyKnowledgeCollapse('meetingSummaryToggle', 'meetingSummaryContent', state.meetingSummaryCollapsed, 'meetingSummaryCollapsed', persist);
  applyKnowledgeCollapse('actionItemsToggle', 'actionItemsContent', state.actionItemsCollapsed, 'actionItemsCollapsed', persist);
}

function wireWindowDragging() {
  // Both Full and Compact use the ordinary arrow cursor and explicit pointer-following
  // movement. Compact therefore does not need a native drag-region cursor/behavior, and
  // blank chrome/background areas remain draggable while actual controls stay clickable.
  const interactiveSelector = [
    'button', 'input', 'select', 'textarea', 'a', '[role="button"]', '[contenteditable="true"]',
    '.topbar-actions', '.workspace-tab-group', '.workspace-playback-actions', '.compact-action-cluster'
  ].join(',');
  let dragging = false;
  let activePointerId = null;
  let moveFrame = 0;
  const captureSurface = document.documentElement;

  const eligibleTarget = (target) => {
    if (!target?.closest) return false;
    if (state.viewMode === 'compact') {
      return Boolean(target.closest('.topbar, #workspacePanel, .compact-recorder-card, .app-shell'));
    }
    return Boolean(target.closest('.full-window-top-drag-strip, .topbar, .workspace-nav'));
  };

  const finish = (event) => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('manual-window-dragging');
    if (moveFrame) { cancelAnimationFrame(moveFrame); moveFrame = 0; }
    try { captureSurface.releasePointerCapture?.(activePointerId); } catch {}
    activePointerId = null;
    window.recorderAPI.endWindowDrag?.();
    event?.preventDefault?.();
  };

  document.addEventListener('pointerdown', (event) => {
    if (state.playerFullscreen || event.button !== 0) return;
    if (event.target.closest?.(interactiveSelector)) return;
    if (!eligibleTarget(event.target)) return;
    dragging = true;
    activePointerId = event.pointerId;
    try { captureSurface.setPointerCapture?.(event.pointerId); } catch {}
    document.body.classList.add('manual-window-dragging');
    window.recorderAPI.beginWindowDrag?.();
    event.preventDefault();
  });
  document.addEventListener('pointermove', (event) => {
    if (!dragging || event.pointerId !== activePointerId || moveFrame) return;
    moveFrame = requestAnimationFrame(() => {
      moveFrame = 0;
      if (dragging) window.recorderAPI.moveWindowDrag?.();
    });
  });
  document.addEventListener('pointerup', finish);
  document.addEventListener('pointercancel', finish);
  document.addEventListener('lostpointercapture', finish);
  window.addEventListener('blur', finish);
}

async function applyTransparency(percent, persist = true) {
  const allowed = [0, 10, 20, 30, 50];
  const requested = Number(percent);
  const value = allowed.includes(requested) ? requested : 0;
  state.transparencyPercent = value;
  try { await window.recorderAPI.setWindowTransparency(value); } catch {}
  if ($('transparencyButton')) {
    const valueLabel = $('transparencyValue');
    if (valueLabel) valueLabel.textContent = state.viewMode === 'compact' ? `${value}%` : `Mini ${value}%`;
    const transparencyHelp = state.viewMode === 'compact'
      ? `Mini View transparency: ${value}%`
      : `Mini View transparency: ${value}% — Full View stays opaque; switch to Mini View to see this setting.`;
    $('transparencyButton').removeAttribute('title');
    $('transparencyButton').dataset.fastTooltipTitle = transparencyHelp;
    $('transparencyButton').setAttribute('aria-label', transparencyHelp);
    $('transparencyButton').classList.toggle('mini-only-setting-pending', state.viewMode !== 'compact' && value > 0);
    if (fastTooltipState.target === $('transparencyButton')) {
      fastTooltipState.text = transparencyHelp;
      if (fastTooltipState.tooltip) fastTooltipState.tooltip.textContent = transparencyHelp;
    }
  }
  if (persist) localStorage.setItem('transparencyPercent', String(value));
}

async function applyAlwaysOnTop(enabled, persist = true) {
  state.alwaysOnTop = Boolean(enabled);
  const effective = state.viewMode === 'compact' && state.alwaysOnTop;
  try { await window.recorderAPI.setAlwaysOnTop(effective); } catch {}
  const button = $('alwaysOnTopButton');
  if (button) {
    button.classList.toggle('active', state.alwaysOnTop);
    button.setAttribute('aria-pressed', String(state.alwaysOnTop));
    button.title = state.alwaysOnTop ? 'Always on top is enabled' : 'Keep Mini Controller above other windows';
    button.setAttribute('aria-label', button.title);
  }
  if (persist) localStorage.setItem('compactAlwaysOnTop', state.alwaysOnTop ? '1' : '0');
}

function renderWindowCapturePrivacy(status = {}) {
  const button = $('windowCapturePrivacyToggle');
  const detail = $('windowCapturePrivacyDetail');
  const indicator = $('compactPrivacyIndicator');
  const supported = status.supported !== false;
  const enabled = Boolean(status.enabled);
  const effective = typeof status.effective === 'boolean' ? Boolean(status.effective) : enabled;
  const active = supported && enabled && effective;
  state.windowCapturePrivacyEnabled = enabled;
  state.windowCapturePrivacySupported = supported;
  state.windowCapturePrivacyEffective = effective;
  if (button) {
    button.classList.toggle('is-on', enabled && supported);
    button.classList.toggle('is-unavailable', !supported);
    button.setAttribute('aria-pressed', String(enabled && supported));
    button.disabled = !supported;
  }
  if (indicator) {
    const indicatorState = !supported ? 'unavailable' : active ? 'active' : enabled ? 'unavailable' : 'off';
    indicator.dataset.state = indicatorState;
    indicator.classList.toggle('is-active', indicatorState === 'active');
    indicator.classList.toggle('is-off', indicatorState === 'off');
    indicator.classList.toggle('is-unavailable', indicatorState === 'unavailable');
    indicator.setAttribute('aria-label', indicatorState === 'active'
      ? 'Screen sharing privacy active'
      : indicatorState === 'off'
        ? 'Screen sharing privacy off'
        : 'Screen sharing privacy unavailable');
  }
  if (detail) {
    detail.textContent = !supported
      ? 'Unavailable on this operating system.'
      : enabled
        ? 'On — compatible screen shares and screenshots should hide this window.'
        : 'Off — PulseStudio can appear in screen shares and screenshots.';
  }
}

async function setWindowCapturePrivacy(enabled, showFeedback = true) {
  const button = $('windowCapturePrivacyToggle');
  if (!button || button.disabled) return;
  // Update immediately so the switch never feels delayed while the native call completes.
  renderWindowCapturePrivacy({ enabled: Boolean(enabled), supported: state.windowCapturePrivacySupported });
  try {
    const status = await window.recorderAPI.setWindowCapturePrivacy(Boolean(enabled));
    renderWindowCapturePrivacy(status || { enabled: Boolean(enabled), supported: true });
    if (showFeedback) {
      showToast(status?.enabled
        ? 'Screen sharing privacy is on.'
        : 'PulseStudio can now be captured or shared.');
    }
  } catch (error) {
    const fallback = await window.recorderAPI.getWindowCapturePrivacy?.().catch(() => null);
    if (fallback) renderWindowCapturePrivacy(fallback);
    if (showFeedback) showToast(friendlyErrorText(error), 'warning', 4200);
  }
}


function applyCompactCaptureCollapsed(collapsed, persist = true) {
  state.compactCaptureCollapsed = Boolean(collapsed);
  const content = $('compactCaptureSettingsContent');
  const button = $('compactCaptureSettingsToggle');
  if (content) content.classList.toggle('hidden', state.compactCaptureCollapsed);
  if (button) {
    button.setAttribute('aria-expanded', String(!state.compactCaptureCollapsed));
    button.classList.toggle('expanded', !state.compactCaptureCollapsed);
    const chevron = button.querySelector('.compact-capture-chevron');
    if (chevron) chevron.textContent = state.compactCaptureCollapsed ? '⌄' : '⌃';
  }
  if ($('compactChooseRegion')) $('compactChooseRegion').classList.toggle('hidden', state.compactCaptureCollapsed || ($('compactCaptureMode')?.value !== 'region'));
  if (persist) localStorage.setItem('compactCaptureCollapsed', state.compactCaptureCollapsed ? '1' : '0');
}

function applyPlaybackSidebarWidth(width, persist = true) {
  const layout = document.querySelector('.playback-layout');
  if (!layout) return;
  const available = Math.max(700, layout.clientWidth || 1000);
  const maxWidth = Math.max(300, Math.min(560, available - 500));
  const value = Math.round(clamp(Number(width) || 300, 220, maxWidth));
  state.playbackSidebarWidth = value;
  layout.style.setProperty('--playlist-width', `${value}px`);
  const splitter = $('playbackSplitter');
  if (splitter) {
    splitter.setAttribute('aria-valuemin', '220');
    splitter.setAttribute('aria-valuemax', String(maxWidth));
    splitter.setAttribute('aria-valuenow', String(value));
  }
  if (persist) localStorage.setItem('playbackSidebarWidth', String(value));
}

function initPlaybackSplitter() {
  const splitter = $('playbackSplitter');
  const layout = document.querySelector('.playback-layout');
  if (!splitter || !layout) return;
  applyPlaybackSidebarWidth(Number(localStorage.getItem('playbackSidebarWidth') || 300), false);

  let dragging = false;
  const move = (event) => {
    if (!dragging) return;
    const rect = layout.getBoundingClientRect();
    applyPlaybackSidebarWidth(event.clientX - rect.left, false);
  };
  const stop = () => {
    if (!dragging) return;
    dragging = false;
    splitter.classList.remove('dragging');
    localStorage.setItem('playbackSidebarWidth', String(state.playbackSidebarWidth));
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', stop);
  };
  splitter.addEventListener('pointerdown', (event) => {
    if (window.matchMedia('(max-width: 900px)').matches) return;
    event.preventDefault();
    dragging = true;
    splitter.classList.add('dragging');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  });
  splitter.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    applyPlaybackSidebarWidth(state.playbackSidebarWidth + (event.key === 'ArrowRight' ? 20 : -20));
  });
  window.addEventListener('resize', () => { applyPlaybackSidebarWidth(state.playbackSidebarWidth, false); scheduleWaveformRender(); });
}

function renderCompactSourcePicker() {
  const picker = $('compactSourceSelect');
  if (!picker) return;
  picker.innerHTML = state.sources.map((source) => `<option value="${escapeHtml(source.id)}">${escapeHtml(source.kind === 'screen' ? 'Display · ' : 'Window · ')}${escapeHtml(source.name)}</option>`).join('');
  if (state.selectedSourceId && [...picker.options].some((option) => option.value === state.selectedSourceId)) picker.value = state.selectedSourceId;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
}

function setWorkspace(name) {
  const playback = name === 'playback' && state.viewMode !== 'compact';
  state.currentWorkspace = playback ? 'playback' : 'capture';
  $('captureWorkspaceTab').classList.toggle('active', !playback);
  $('playbackWorkspaceTab').classList.toggle('active', playback);
  $('captureWorkspaceTab').setAttribute('aria-selected', String(!playback));
  $('playbackWorkspaceTab').setAttribute('aria-selected', String(playback));
  $('captureView').classList.toggle('hidden', playback);
  $('playbackView').classList.toggle('hidden', !playback);
  $('recordRightRail').classList.toggle('hidden', playback);
  $('mainLayout').classList.toggle('playback-mode', playback);
  document.querySelectorAll('.playback-only').forEach((element) => element.classList.toggle('hidden', !playback));
  $('transcriptPanel').classList.toggle('hidden', !playback || !state.selectedPlaybackPath);
  placeAiStatusForView();
  if (!playback) $('stickyPlaybackControls')?.classList.remove('is-visible');
  // The completion card belongs to the Record workspace only; never show it below Playback.
  if (playback) {
    stopPreflightMicMonitor();
    $('resultPanel').classList.add('hidden');
    requestAnimationFrame(() => {
      applyPlaybackSidebarWidth(state.playbackSidebarWidth, false);
      // Repaint after Playback becomes visible. The extra scheduled frame lets
      // Chromium finish layout before measuring the waveform canvases.
      scheduleWaveformRender();
    });
    refreshRecordings();
  } else {
    if (state.savedPath && !state.mediaRecorder) $('resultPanel').classList.remove('hidden');
    if (!state.mediaRecorder || state.mediaRecorder.state === 'inactive') refreshPreflightMicMonitor();
  }
}

function updateTranscriptActions() {
  const hasText = Boolean($('transcriptText').value.trim());
  $('toggleTranscript').disabled = !hasText;
  $('copyTranscript').disabled = !hasText;
  $('exportTxt').disabled = !hasText;
  $('exportSrt').disabled = !hasText;
  const hasFiles = Boolean(state.transcriptTxtPath || state.transcriptSrtPath);
  $('showTranscriptFiles').disabled = !hasFiles;
  if ($('moreShowTranscriptFiles')) $('moreShowTranscriptFiles').disabled = !hasFiles;
  $('transcriptDisplay').classList.toggle('hidden', !state.transcriptVisible);
  $('toggleTranscript').textContent = state.transcriptVisible ? 'Hide transcript' : 'Display transcript';
  localStorage.setItem('playbackTranscriptVisible', state.transcriptVisible ? '1' : '0');
}

function setTranscriptTarget(recordingPath) {
  state.transcriptTargetPath = recordingPath || null;
  const show = Boolean(recordingPath) && state.currentWorkspace === 'playback' && state.selectedPlaybackPath === recordingPath;
  $('transcriptPanel').classList.toggle('hidden', !show);
}

function updateCaptureModeUi() {
  const mode = $('captureMode').value;
  $('regionTools').classList.toggle('hidden', mode !== 'region');
  $('allDisplaysNote').classList.toggle('hidden', mode !== 'all');
  $('sourceGrid').classList.toggle('source-grid-muted', mode === 'all');
  if (mode === 'region') updateRegionSummary();
}

function clearRegionSelection() {
  state.regionNormalized = null;
  state.regionSourceId = null;
  state.regionDraft = null;
  $('regionSelection').classList.add('hidden');
  $('applyRegion').disabled = true;
  $('regionDialogSummary').textContent = 'Drag to select an area.';
  updateRegionSummary();
}

function updateRegionSummary() {
  if (!state.regionNormalized || state.regionSourceId !== state.selectedSourceId) {
    $('regionSummary').textContent = 'No region selected';
    updateRecordReadySummary();
    return;
  }
  const r = state.regionNormalized;
  $('regionSummary').textContent = `${Math.round(r.w * 100)}% × ${Math.round(r.h * 100)}% of selected source`;
  updateRecordReadySummary();
}

function renderDeferredSourceAccess(message = 'Screen access will be requested only when you choose Refresh or start recording.') {
  state.sources = [];
  state.selectedSourceId = null;
  $('sourceGrid').innerHTML = `<div class="empty">${escapeHtml(message)}</div>`;
  renderCompactSourcePicker();
  updateRegionSummary();
  updateRecordReadySummary();
}

function renderScreenRecordingPermissionHelp(detail = '', permissionTarget = 'PulseStudio') {
  state.sources = [];
  state.selectedSourceId = null;
  const target = String(permissionTarget || 'PulseStudio');
  const isElectronHost = target === 'Electron';
  const intro = isElectronHost
    ? "This local macOS package runs through Electron's stable signed host so screen permission survives PulseStudio updates. In macOS Privacy settings, the permission target for this build is <b>Electron</b>; an older app permission row from previous local builds can be ignored."
    : 'If <b>PulseStudio</b> is already enabled in macOS, choose <b>Refresh</b>. The app checks the real capture capability instead of repeatedly asking macOS for permission.';
  const extra = detail ? `<div class="screen-permission-recovery">${escapeHtml(detail)}</div>` : '';
  $('sourceGrid').innerHTML = `
    <div class="screen-permission-help" role="status">
      <strong id="screenPermissionHelpTitle">Screen Recording access is required</strong>
      <span>${intro}</span>
      <ol>
        <li>Open <b>System Settings → Privacy &amp; Security → Screen &amp; System Audio Recording</b>.</li>
        <li>Make sure <b>${escapeHtml(target)}</b> is enabled.</li>
        <li>Return here and choose <b>Refresh</b>.</li>
        <li>If macOS explicitly asks you to quit/reopen after changing the switch, do that once.</li>
      </ol>
      ${extra}
      <div class="screen-permission-actions">
        <button class="button primary small" id="permissionRefreshSources" type="button">Refresh</button>
        <button class="button secondary small" id="openScreenRecordingSettings" type="button">Open System Settings</button>
      </div>
    </div>`;

  $('openScreenRecordingSettings')?.addEventListener('click', async () => {
    const opened = await window.recorderAPI.openScreenRecordingSettings?.().catch((error) => ({ opened: false, error: friendlyErrorText(error) }));
    if (!opened?.opened) showToast('Open System Settings → Privacy & Security → Screen & System Audio Recording.');
  });
  $('permissionRefreshSources')?.addEventListener('click', refreshSources);
  renderCompactSourcePicker();
  updateRegionSummary();
  updateRecordReadySummary();
}

async function screenPermissionContext() {
  if (state.platformInfo?.platform !== 'darwin') return { target: 'PulseStudio', status: '' };
  try {
    const permissions = await window.recorderAPI.getPermissions();
    return { target: permissions?.screenPermissionTarget || 'PulseStudio', status: String(permissions?.screen || '') };
  } catch {
    return { target: 'PulseStudio', status: '' };
  }
}

async function initializeCaptureSources() {
  // Capability first: an actual desktop-source enumeration is more reliable than
  // Electron's cached getMediaAccessStatus('screen') value on recent macOS builds.
  // This also means an already-enabled PulseStudio is never blocked by a stale
  // status value before the app has even tried to capture.
  return refreshSources();
}

async function refreshSources() {
  $('sourceGrid').innerHTML = '<div class="empty">Loading screens and windows…</div>';
  try {
    state.sources = await window.recorderAPI.listSources();
    if (state.sources.length) {
      renderSources();
      await updateReadiness().catch(() => {});
      return true;
    }
    if (state.platformInfo?.platform === 'darwin') {
      const permission = await screenPermissionContext();
      const detail = permission.status === 'granted'
        ? `macOS reports ${permission.target} as enabled, but no capture sources were returned. Quit PulseStudio completely, reopen it with the macOS launcher, then Refresh once.`
        : `macOS did not return any capture sources for ${permission.target}. Enable that entry, then Refresh.`;
      renderScreenRecordingPermissionHelp(detail, permission.target);
      return false;
    }
    renderSources();
    return false;
  } catch (error) {
    if (state.platformInfo?.platform === 'darwin') {
      const permission = await screenPermissionContext();
      const prefix = permission.status === 'granted'
        ? `macOS reports ${permission.target} as enabled, but the capture-source API still failed.`
        : `macOS did not allow ${permission.target} to enumerate capture sources.`;
      renderScreenRecordingPermissionHelp(`${prefix} ${friendlyErrorText(error)}`, permission.target);
      return false;
    }
    $('sourceGrid').innerHTML = `<div class="empty">Could not load screens and windows. ${escapeHtml(friendlyErrorText(error))}</div>`;
    return false;
  }
}

function renderSources() {
  if (!state.sources.length) {
    $('sourceGrid').innerHTML = '<div class="empty">No screens or windows were found.</div>';
    return;
  }
  if (!state.sources.some((source) => source.id === state.selectedSourceId)) state.selectedSourceId = null;
  if (!state.selectedSourceId && state.preferredCaptureSource) {
    const preferred = state.sources.find((source) => source.id === state.preferredCaptureSource.id)
      || state.sources.find((source) => source.kind === state.preferredCaptureSource.kind && source.name === state.preferredCaptureSource.name);
    if (preferred) state.selectedSourceId = preferred.id;
  }
  $('sourceGrid').innerHTML = state.sources.map((source) => `
    <div class="source-card ${source.id === state.selectedSourceId ? 'selected' : ''}" data-source-id="${escapeHtml(source.id)}">
      <img class="source-thumb" src="${source.thumbnail}" alt="" />
      <div class="source-name">
        ${source.icon ? `<img src="${source.icon}" alt="" />` : ''}
        <span title="${escapeHtml(source.name)}">${escapeHtml(source.name)}</span>
        <small>${source.kind === 'screen' ? 'Display' : 'Window'}</small>
      </div>
    </div>
  `).join('');

  renderCompactSourcePicker();

  document.querySelectorAll('.source-card').forEach((card) => {
    card.addEventListener('click', async () => {
      if (document.body.classList.contains('recording-config-locked')) return;
      const changed = state.selectedSourceId !== card.dataset.sourceId;
      state.selectedSourceId = card.dataset.sourceId;
      persistPreferredCaptureSource(selectedSource());
      await window.recorderAPI.selectSource(state.selectedSourceId);
      if (changed && state.regionSourceId && state.regionSourceId !== state.selectedSourceId) clearRegionSelection();
      renderSources();
      updateRegionSummary();
      previewFilenameTemplate();
      updateReadiness();
    });
  });

  if (!state.selectedSourceId && state.sources[0]) {
    state.selectedSourceId = state.sources[0].id;
    persistPreferredCaptureSource(state.sources[0]);
    window.recorderAPI.selectSource(state.selectedSourceId);
    renderSources();
    renderCompactSourcePicker();
  }
}

function selectedSource() {
  return state.sources.find((source) => source.id === state.selectedSourceId) || null;
}

async function openRegionDialog() {
  const source = selectedSource();
  if (!source) return setStatus('Choose a screen or window before selecting a region.', true);
  $('regionImage').src = source.thumbnail;
  state.regionDraft = state.regionSourceId === source.id ? state.regionNormalized : null;
  if (state.regionDraft) renderRegionBox(state.regionDraft);
  else {
    $('regionSelection').classList.add('hidden');
    $('applyRegion').disabled = true;
    $('regionDialogSummary').textContent = 'Drag to select an area.';
  }
  $('regionDialog').showModal();
}

function regionPointFromEvent(event) {
  const rect = $('regionStage').getBoundingClientRect();
  return {
    x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((event.clientY - rect.top) / rect.height, 0, 1)
  };
}

function normalizedRegionFromPoints(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(a.x - b.x);
  const h = Math.abs(a.y - b.y);
  return { x, y, w, h };
}

function renderRegionBox(region) {
  if (!region || region.w < 0.01 || region.h < 0.01) {
    $('regionSelection').classList.add('hidden');
    $('applyRegion').disabled = true;
    return;
  }
  const box = $('regionSelection');
  box.classList.remove('hidden');
  box.style.left = `${region.x * 100}%`;
  box.style.top = `${region.y * 100}%`;
  box.style.width = `${region.w * 100}%`;
  box.style.height = `${region.h * 100}%`;
  $('applyRegion').disabled = false;
  $('regionDialogSummary').textContent = `Region: ${Math.round(region.w * 100)}% × ${Math.round(region.h * 100)}%`;
}

async function updateReadiness() {
  if (!$('readinessStrip')) return;
  // Readiness is a pre-recording concern. Re-running permission, recovery, storage,
  // and UI checks every 15 seconds while capturing adds avoidable main/renderer IPC
  // to the same process that must keep pointer interaction responsive. During an
  // active capture, the live audio meter + recording telemetry are the only periodic
  // status work; readiness resumes immediately after Stop.
  const recordingActive = Boolean(state.mediaRecorder && state.mediaRecorder.state !== 'inactive');
  if (recordingActive) return;
  const issues = [];
  try {
    const recoveryState = await window.recorderAPI.getStartupRecoveryState?.().catch(() => null);
    if (recoveryState) applyStartupRecoveryState(recoveryState);
    const info = await window.recorderAPI.getReadiness();
    const source = selectedSource();
    const mode = $('captureMode')?.value || 'source';
    const audioOnly = $('recordingKind')?.value === 'audio';
    const computerAudioEnabled = Boolean($('systemAudio')?.checked);
    const computerAudioMode = $('computerAudioMode')?.value || 'system';
    const sourceRequired = !audioOnly || computerAudioEnabled;
    const sourceReady = !sourceRequired || (mode === 'all' ? state.sources.some((item) => item.kind === 'screen') : Boolean(source));
    const regionReady = audioOnly || mode !== 'region' || (state.regionNormalized && state.regionSourceId === state.selectedSourceId);
    const screenDenied = sourceRequired && !sourceReady && info.screen && (info.screen === 'denied' || info.screen === 'restricted');
    if (!sourceReady) { setReadinessItem('readySource', 'error', 'Choose source'); issues.push('Choose a recording source.'); }
    else if (!regionReady) { setReadinessItem('readySource', 'warn', 'Set region'); issues.push('Select the recording region.'); }
    else if (screenDenied) { setReadinessItem('readySource', 'error', 'Permission'); issues.push('Screen access is blocked. Enable Screen Recording in your system privacy settings.'); }
    else setReadinessItem('readySource', 'ready', !sourceRequired ? 'Not required' : mode === 'all' ? 'All displays' : mode === 'region' ? 'Region ready' : 'Ready');

    if (!$('microphone')?.checked) setReadinessItem('readyMic', 'ready', 'Off');
    else if (info.microphone === 'denied' || info.microphone === 'restricted') { setReadinessItem('readyMic', 'error', 'Permission'); issues.push('Microphone access is blocked. Enable Microphone access in your system privacy settings.'); }
    else if (info.microphone === 'not-determined') setReadinessItem('readyMic', 'warn', 'Permission?');
    else setReadinessItem('readyMic', 'ready', 'Ready');

    if (!computerAudioEnabled) setReadinessItem('readyAudio', 'ready', 'Off');
    else if (computerAudioMode === 'application') {
      if (!source || source.kind !== 'window') { setReadinessItem('readyAudio', 'error', 'Select window'); issues.push('Application-only audio requires a selected window.'); }
      else if (!state.platformInfo?.applicationAudioSupported) { setReadinessItem('readyAudio', 'error', 'Unavailable'); issues.push(state.platformInfo?.applicationAudioCapability?.message || 'Application-only audio is unavailable on this operating system.'); }
      else setReadinessItem('readyAudio', 'ready', 'Selected app');
    } else setReadinessItem('readyAudio', 'ready', 'System audio');

    if (!$('webcamOverlay')?.checked || audioOnly) setReadinessItem('readyCamera', 'ready', audioOnly ? 'Audio only' : 'Off');
    else if (info.camera === 'denied' || info.camera === 'restricted') { setReadinessItem('readyCamera', 'error', 'Permission'); issues.push('Camera access is blocked. Enable Camera access in your system privacy settings.'); }
    else if (info.camera === 'not-determined') setReadinessItem('readyCamera', 'warn', 'Permission?');
    else setReadinessItem('readyCamera', 'ready', 'Ready');

    const free = Number(info.freeBytes);
    const availableTime = formatAvailableRecordingTime(free);
    const storageLabel = Number.isFinite(free) ? `${formatFreeSpace(free)}${availableTime ? ` · ${availableTime} at current quality` : ''}` : 'Unknown';
    if ($('recordingStorageHealth')) $('recordingStorageHealth').textContent = Number.isFinite(free)
      ? `Storage: ${formatFreeSpace(free)}${availableTime ? ` · about ${availableTime.replace(/^~/, '')} recordable at current quality` : ''}`
      : 'Storage: free space could not be determined.';
    const perHour = currentEstimatedBytesPerHour();
    const estimatedMinutes = Number.isFinite(free) && perHour > 0 ? (free / perHour) * 60 : Infinity;
    let storageLevel = 'ready';
    if (!Number.isFinite(free)) {
      storageLevel = 'warn';
      setReadinessItem('readyStorage', 'warn', 'Unknown');
    } else if (free < 1 * 1024 ** 3 || estimatedMinutes < 15) {
      storageLevel = 'error';
      setReadinessItem('readyStorage', 'error', storageLabel);
      issues.push(`Storage is critically low. ${storageLabel}. Stop soon or lower recording quality.`);
    } else if (free < 10 * 1024 ** 3 || estimatedMinutes < 90) {
      storageLevel = 'warn';
      setReadinessItem('readyStorage', 'warn', storageLabel);
      issues.push(`${storageLabel}. Consider freeing space or lowering recording quality.`);
    } else setReadinessItem('readyStorage', 'ready', storageLabel);

    if (recordingActive && storageLevel !== state.storageWarningLevel && storageLevel !== 'ready') {
      const now = Date.now();
      if (now - state.storageWarningToastAt > 15000) {
        showToast(storageLevel === 'error' ? `Storage critically low · ${storageLabel}` : `Storage running low · ${storageLabel}`, storageLevel === 'error' ? 'error' : 'warning', 5200);
        state.storageWarningToastAt = now;
      }
    }
    state.storageWarningLevel = storageLevel;
  } catch (error) {
    setReadinessItem('readyStorage', 'warn', 'Check failed');
    issues.push('One readiness check could not be completed. You can retry by refreshing the Record tab.');
  }
  if (state.recordingStartHardBlocked) {
    issues.unshift(state.recordingStartHardBlockReason || 'A protected recording needs recovery before another recording can start.');
  } else if (state.startupRecoveryBusy) {
    issues.unshift('A previous recording is being recovered in the background. You can start a new recording now; recording takes priority and will pause recovery.');
  }
  const warning = $('readinessWarning');
  const warningText = $('readinessWarningText');
  if (warning) {
    if (warningText) warningText.textContent = issues.join(' ');
    else warning.textContent = issues.join(' ');
    warning.classList.toggle('hidden', !issues.length);
  }
  $('cancelRecoveryButton')?.classList.toggle('hidden', !state.startupRecoveryBusy);

  const summary = $('readinessSummary');
  const summaryTitle = $('readinessSummaryTitle');
  const summaryText = $('readinessSummaryText');
  if (summary && summaryTitle && summaryText) {
    const levels = ['readySource', 'readyMic', 'readyAudio', 'readyCamera', 'readyStorage']
      .map((id) => $(id))
      .filter(Boolean);
    const hasError = levels.some((item) => item.classList.contains('error')) || state.recordingStartHardBlocked;
    const hasWarning = levels.some((item) => item.classList.contains('warn')) || state.startupRecoveryBusy;
    summary.classList.remove('ready', 'warn', 'error');
    if (state.recordingStartHardBlocked) {
      summary.classList.add('error');
      summaryTitle.textContent = 'Recovery needed';
      summaryText.textContent = state.recordingStartHardBlockReason || 'Recover the protected recording before starting another recording.';
      summary.querySelector('.readiness-summary-icon').textContent = '!';
    } else if (state.startupRecoveryBusy) {
      summary.classList.add('warn');
      summaryTitle.textContent = 'Ready · recovery in background';
      summaryText.textContent = 'You can record now. Starting a recording pauses recovery so capture keeps priority.';
      summary.querySelector('.readiness-summary-icon').textContent = '✓';
    } else if (hasError) {
      summary.classList.add('error');
      summaryTitle.textContent = 'Attention needed';
      summaryText.textContent = 'Fix the items marked in red before recording.';
      summary.querySelector('.readiness-summary-icon').textContent = '!';
    } else if (hasWarning) {
      summary.classList.add('warn');
      summaryTitle.textContent = 'Ready with warnings';
      summaryText.textContent = 'Recording can start, but review the highlighted items.';
      summary.querySelector('.readiness-summary-icon').textContent = '!';
    } else {
      summary.classList.add('ready');
      summaryTitle.textContent = 'Ready to record';
      summaryText.textContent = 'All required checks passed.';
      summary.querySelector('.readiness-summary-icon').textContent = '✓';
    }
  }
  updatePreflightSystemIdleState();
  updateRecordReadySummary();
  syncRecordStartAvailability();
}


function renderWaveform(canvas, samples, options = {}) {
  if (!canvas) return false;
  const rect = canvas.getBoundingClientRect();
  // Do not resize/clear a canvas while its workspace is hidden. A display:none
  // ancestor reports a 0x0 box; writing a 1x1 backing store here erases the
  // waveform and caused it to disappear after Record/Playback view changes.
  if (rect.width < 2 || rect.height < 2) return false;
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (!samples?.length) {
    ctx.strokeStyle = 'rgba(142,142,147,.28)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2); ctx.stroke();
    return true;
  }
  const step = Math.max(1, Math.ceil(samples.length / Math.max(1, width)));
  const bars = Math.ceil(samples.length / step);
  const barWidth = width / Math.max(1, bars);
  const mid = height / 2;
  const maxAmp = Math.max(2, mid - 2);
  const fallbackColor = options.trim ? 'rgba(100,210,255,.78)' : 'rgba(100,210,255,.72)';
  const segments = Array.isArray(options.speakerSegments) ? options.speakerSegments : [];
  const duration = Math.max(0, Number(options.duration) || 0);
  let segmentIndex = 0;
  ctx.lineWidth = Math.max(1, Math.min(2, barWidth * .72));
  let bar = 0;
  for (let i = 0; i < samples.length; i += step, bar += 1) {
    let peak = 0;
    for (let j = i; j < Math.min(samples.length, i + step); j += 1) peak = Math.max(peak, Number(samples[j]) || 0);
    const x = bar * barWidth + barWidth / 2;
    const amp = Math.max(1, peak * maxAmp);
    let color = fallbackColor;
    if (segments.length && duration > 0 && window.PulseStudioSpeakerTools) {
      const seconds = ((i + step / 2) / samples.length) * duration;
      while (segmentIndex < segments.length - 1 && Number(segments[segmentIndex]?.end) < seconds) segmentIndex += 1;
      const segment = segments[segmentIndex];
      if (segment && seconds >= Number(segment.start) && seconds <= Number(segment.end)) color = window.PulseStudioSpeakerTools.color(segment.speaker || segment.displayName, .78);
    }
    ctx.strokeStyle = color;
    ctx.beginPath(); ctx.moveTo(x, mid - amp); ctx.lineTo(x, mid + amp); ctx.stroke();
  }
  return true;
}

function scheduleWaveformRender() {
  if (state.waveformRenderFrame) cancelAnimationFrame(state.waveformRenderFrame);
  state.waveformRenderFrame = requestAnimationFrame(() => {
    state.waveformRenderFrame = 0;
    renderAllWaveforms();
  });
}

function initWaveformResizeObserver() {
  if (state.waveformResizeObserver || typeof ResizeObserver === 'undefined') return;
  const targets = [$('waveformTimeline'), $('trimRangeShell')].filter(Boolean);
  if (!targets.length) return;
  state.waveformResizeObserver = new ResizeObserver(() => {
    if (state.currentWorkspace === 'playback' && state.selectedPlaybackPath) scheduleWaveformRender();
  });
  targets.forEach((target) => state.waveformResizeObserver.observe(target));
}

function renderAllWaveforms() {
  const duration = Number($('playbackVideo')?.duration) || Number(state.recordings.find((item) => item.path === state.selectedPlaybackPath)?.durationSeconds) || 0;
  const speakerOptions = { duration, speakerSegments: state.speakerSegments };
  renderWaveform($('playbackWaveform'), state.waveformSamples, speakerOptions);
  renderWaveform($('trimWaveform'), state.waveformSamples, { ...speakerOptions, trim: true });
}

function isDefaultBookmarkLabel(label = '') {
  return /^Bookmark\s+\d+$/i.test(String(label || '').trim());
}

function bookmarkMarkerLabelHtml(marker) {
  const label = String(marker?.label || '').trim();
  if (!label || isDefaultBookmarkLabel(label)) return '';
  return `<span class="timeline-marker-label">${escapeHtml(label)}</span>`;
}

function wirePlaybackMarkerInteractions(layer) {
  layer?.querySelectorAll('[data-playback-bookmark-id]').forEach((markerButton) => {
    markerButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const marker = state.playbackMarkers.find((item) => item.id === markerButton.dataset.playbackBookmarkId);
      if (!marker) return;
      const video = $('playbackVideo');
      if (video) video.currentTime = Number.isFinite(video.duration) ? clamp(Number(marker.seconds) || 0, 0, video.duration) : Math.max(0, Number(marker.seconds) || 0);
      state.pendingSeekTarget = null;
      updatePlaybackClock();
      showPlaybackBookmarkOverlay(marker);
      $('playerStatus').textContent = `Bookmark · ${marker.label || 'Bookmark'} · ${formatDuration(marker.seconds, '00:00')}`;
      openBookmarkInlineEditor(marker);
    });
  });
}

function renderPlaybackVoiceHighlights() {
  const duration = Number($('playbackVideo')?.duration) || Number(state.recordings.find((item) => item.path === state.selectedPlaybackPath)?.durationSeconds) || 0;
  const layer = $('playbackVoiceHighlightLayer');
  const segments = Array.isArray(state.playbackVoiceHighlights) ? state.playbackVoiceHighlights : [];
  if (layer) {
    layer.classList.toggle('hidden', !state.voiceHighlightsVisible || !segments.length || duration <= 0);
    layer.innerHTML = duration > 0 && state.voiceHighlightsVisible ? segments.map((segment) => {
      const left = clamp(((Number(segment.start) || 0) / duration) * 100, 0, 100);
      const width = clamp(((Math.max(0, Number(segment.end) - Number(segment.start))) / duration) * 100, 0.18, 100 - left);
      return `<span class="timeline-my-voice-segment" style="left:${left}%;width:${width}%" title="My voice · ${escapeHtml(formatDuration(segment.start, '00:00'))}–${escapeHtml(formatDuration(segment.end, '00:00'))}"></span>`;
    }).join('') : '';
  }
  const button = $('toggleVoiceHighlights');
  if (button) {
    const count = segments.length;
    button.disabled = count === 0;
    button.classList.toggle('active', state.voiceHighlightsVisible && count > 0);
    button.setAttribute('aria-pressed', String(state.voiceHighlightsVisible && count > 0));
    button.setAttribute('aria-label', count ? `${state.voiceHighlightsVisible ? 'Hide' : 'Show'} my voice highlights, ${count} sections` : 'My voice highlights unavailable');
    button.title = count ? `${state.voiceHighlightsVisible ? 'Hide' : 'Show'} my voice highlights · ${count} section${count === 1 ? '' : 's'}` : 'My voice highlights unavailable for this recording';
    const countNode = button.querySelector('.voice-highlight-button-count');
    if (countNode) countNode.textContent = count ? String(count) : '';
  }
}

function playbackNavigationItems() {
  const bookmarks = (state.playbackMarkers || []).map((marker) => ({
    type: 'bookmark', seconds: Math.max(0, Number(marker.seconds) || 0), id: marker.id,
    title: isDefaultBookmarkLabel(marker.label) ? 'Bookmark' : (String(marker.label || '').trim() || 'Bookmark'),
    detail: 'Bookmark'
  }));
  const voice = (state.playbackVoiceHighlights || []).map((segment, index) => ({
    type: 'voice', seconds: Math.max(0, Number(segment.start) || 0), end: Math.max(0, Number(segment.end) || 0), id: `voice-${index}`,
    title: 'You spoke', detail: `${Math.max(0.1, (Number(segment.end) || 0) - (Number(segment.start) || 0)).toFixed(1)}s`
  }));
  const chapters = (state.playbackInsights?.chapters || []).map((chapter, index) => ({
    type: 'chapter', seconds: Math.max(0, Number(chapter.startSeconds) || 0), id: `chapter-${index}`,
    title: String(chapter.title || `Chapter ${index + 1}`), detail: 'Chapter'
  }));
  return [...bookmarks, ...voice, ...chapters].sort((a, b) => a.seconds - b.seconds || ({ bookmark: 0, voice: 1, chapter: 2 }[a.type] - ({ bookmark: 0, voice: 1, chapter: 2 }[b.type]))).slice(0, 300);
}

function renderPlaybackChapterSidebar() {
  const sidebar = $('playbackChapterSidebar');
  const list = $('playbackChapterSidebarList');
  const shell = $('videoPlayerShell');
  const toggle = $('toggleChapterSidebar');
  if (!sidebar || !list || !shell || !toggle) return;
  const hasRecording = Boolean(state.selectedPlaybackPath);
  toggle.disabled = !hasRecording;
  const timelineAction = state.chapterSidebarVisible ? 'Hide recording timeline' : 'Show recording timeline';
  toggle.title = timelineAction;
  toggle.setAttribute('aria-label', timelineAction);
  toggle.setAttribute('aria-pressed', String(state.chapterSidebarVisible));
  sidebar.classList.toggle('hidden', !hasRecording || !state.chapterSidebarVisible);
  shell.classList.toggle('chapters-open', hasRecording && state.chapterSidebarVisible);
  if (!hasRecording || !state.chapterSidebarVisible) return;
  const items = playbackNavigationItems();
  list.innerHTML = items.length ? items.map((item) => {
    const icon = item.type === 'bookmark' ? '◆' : item.type === 'voice' ? '●' : '§';
    const edit = item.type === 'bookmark' ? `<button type="button" class="playback-chapter-edit" data-chapter-edit-bookmark="${escapeHtml(item.id)}" aria-label="Edit bookmark text">Edit</button>` : '';
    return `<div class="playback-chapter-row playback-chapter-${item.type}"><button type="button" class="playback-chapter-jump" data-chapter-seconds="${item.seconds}"><span class="playback-chapter-icon" aria-hidden="true">${icon}</span><time>${escapeHtml(formatDuration(item.seconds, '00:00'))}</time><span class="playback-chapter-copy"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)}</small></span></button>${edit}</div>`;
  }).join('') : '<span class="helper">Bookmarks, My Voice sections, and generated chapters will appear here.</span>';
  list.querySelectorAll('[data-chapter-seconds]').forEach((button) => button.addEventListener('click', () => jumpPlaybackTo(Number(button.dataset.chapterSeconds) || 0, true)));
  list.querySelectorAll('[data-chapter-edit-bookmark]').forEach((button) => button.addEventListener('click', (event) => {
    event.preventDefault(); event.stopPropagation();
    const marker = state.playbackMarkers.find((item) => item.id === button.dataset.chapterEditBookmark);
    if (marker) openBookmarkInlineEditor(marker);
  }));
}

function renderPlaybackMarkers() {
  const duration = Number($('playbackVideo')?.duration) || Number(state.recordings.find((item) => item.path === state.selectedPlaybackPath)?.durationSeconds) || 0;
  renderPlaybackVoiceHighlights();
  const layer = $('playbackMarkerLayer');
  if (layer) {
    if (duration > 0) {
      const bookmarkTicks = state.playbackMarkers.map((marker) => `<button type="button" class="timeline-marker" data-playback-bookmark-id="${escapeHtml(marker.id)}" style="left:${clamp((marker.seconds / duration) * 100, 0, 100)}%" title="${escapeHtml(marker.label)} · ${escapeHtml(formatDuration(marker.seconds, '00:00'))} · Click to edit marker text" aria-label="Bookmark ${escapeHtml(marker.label)} at ${escapeHtml(formatDuration(marker.seconds, '00:00'))}; click to edit marker text">${bookmarkMarkerLabelHtml(marker)}</button>`).join('');
      const chapterTicks = (state.playbackInsights?.chapters || []).slice(1).map((chapter) => `<span class="timeline-chapter-marker" style="left:${clamp(((Number(chapter.startSeconds) || 0) / duration) * 100, 0, 100)}%" title="Chapter · ${escapeHtml(chapter.title || '')}"></span>`).join('');
      const speakerTicks = (state.speakerSegments || []).map((segment) => {
        const speaker = segment.displayName || segment.speaker || `Speaker ${Number(segment.id) + 1}`;
        const colorClass = window.PulseStudioSpeakerTools?.className(segment.speaker || speaker) || '';
        const left = clamp(((Number(segment.start) || 0) / duration) * 100, 0, 100);
        const width = clamp(((Math.max(0, Number(segment.end) - Number(segment.start))) / duration) * 100, 0.15, 100 - left);
        return `<span class="timeline-speaker-segment ${colorClass}" style="left:${left}%;width:${width}%" title="${escapeHtml(speaker)} · ${escapeHtml(formatDuration(segment.start, '00:00'))}"></span>`;
      }).join('');
      layer.innerHTML = speakerTicks + bookmarkTicks + chapterTicks;
      wirePlaybackMarkerInteractions(layer);
    } else layer.innerHTML = '';
  }
  // Bookmark management lives in the player toolbar. Named markers are also
  // rendered directly on the waveform so they behave like playback markers.
  updatePlaybackBookmarkNavigation();
  renderPlaybackChapterSidebar();
}

async function loadPlaybackEnhancements(recordingPath, selectionToken) {
  state.waveformSamples = [];
  state.waveformHasAudio = false;
  state.playbackMarkers = [];
  state.playbackVoiceHighlights = [];
  renderAllWaveforms();
  renderPlaybackMarkers();
  const [waveform, markers, voiceHighlights] = await Promise.all([
    window.recorderAPI.getRecordingWaveform(recordingPath, 1400).catch(() => ({ samples: [], hasAudio: false })),
    window.recorderAPI.getRecordingMarkers(recordingPath).catch(() => []),
    MY_VOICE_HIGHLIGHTS_ENABLED
      ? (window.recorderAPI.getRecordingVoiceHighlights?.(recordingPath) || Promise.resolve([])).catch(() => [])
      : Promise.resolve([])
  ]);
  if (selectionToken !== state.playbackSelectionToken || state.selectedPlaybackPath !== recordingPath) return;
  state.waveformSamples = waveform.samples || [];
  state.waveformHasAudio = Boolean(waveform.hasAudio);
  state.playbackMarkers = Array.isArray(markers) ? markers : [];
  state.playbackVoiceHighlights = Array.isArray(voiceHighlights) ? voiceHighlights : [];
  const selected = state.recordings.find((item) => item.path === recordingPath);
  if ($('playbackMediaBadge') && selected) {
    $('playbackMediaBadge').textContent = selected.mediaType === 'audio' ? 'Audio' : (state.waveformHasAudio ? 'Video + Audio' : 'Video');
  }
  renderAllWaveforms();
  renderPlaybackMarkers();
}

async function applyLibrarySearch(query) {
  const q = String(query || '').trim();
  if (state.librarySearch !== q) clearBatchSelectionForFilterChange();
  state.librarySearch = q;
  $('clearLibrarySearch')?.classList.toggle('hidden', !q);
  if (!q) { state.librarySearchMatches = new Map(); renderRecordings(); updatePlaybackClipNavigation(); return; }
  try {
    const matches = await window.recorderAPI.searchRecordings(q);
    if (state.librarySearch !== q) return;
    state.librarySearchMatches = new Map((matches || []).map((item) => [item.path, item]));
    renderRecordings();
    updatePlaybackClipNavigation();
  } catch (error) {
    setStatus(`Could not search recordings. ${friendlyErrorText(error)}`, true);
  }
}

function scheduleLibrarySearch(query) {
  clearTimeout(state.librarySearchTimer);
  state.librarySearchTimer = setTimeout(() => applyLibrarySearch(query), 180);
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightedTranscriptHtml(text, query) {
  const source = String(text || '');
  const q = String(query || '').trim();
  if (!q) return escapeHtml(source).replace(/\n/g, '<br>');
  const pattern = new RegExp(`(${escapeRegex(q)})`, 'ig');
  return source.split(pattern).map((part, index) => index % 2
    ? `<mark>${escapeHtml(part)}</mark>`
    : escapeHtml(part).replace(/\n/g, '<br>')).join('');
}

function normalizeTranscriptView(value) {
  return ['raw', 'speakers', 'timecoded'].includes(String(value)) ? String(value) : 'raw';
}

function cueSpeaker(cue) {
  if (!cue || !state.speakerSegments.length) return null;
  let best = null;
  let bestOverlap = 0;
  for (const segment of state.speakerSegments) {
    const overlap = Math.max(0, Math.min(cue.end, segment.end) - Math.max(cue.start, segment.start));
    if (overlap > bestOverlap) { bestOverlap = overlap; best = segment; }
  }
  if (best) return best.displayName || best.speaker || `Speaker ${Number(best.id) + 1}`;
  const midpoint = (cue.start + cue.end) / 2;
  let nearest = null;
  let distance = Infinity;
  for (const segment of state.speakerSegments) {
    const center = (segment.start + segment.end) / 2;
    const d = Math.abs(center - midpoint);
    if (d < distance) { distance = d; nearest = segment; }
  }
  return distance <= 1.5 && nearest ? (nearest.displayName || nearest.speaker || `Speaker ${Number(nearest.id) + 1}`) : null;
}

function speakerColorKey(displayName) {
  return state.speakerDefinitions.find((item) => (item.name || item.speaker) === displayName)?.speaker || displayName || 'Speaker';
}

function buildSpeakerTurns() {
  if (!state.subtitleCues.length) return [];
  const turns = [];
  for (let index = 0; index < state.subtitleCues.length; index += 1) {
    const cue = state.subtitleCues[index];
    const detected = cueSpeaker(cue);
    const speaker = detected || 'Speaker';
    const previous = turns[turns.length - 1];
    const canMerge = previous && previous.speaker === speaker && cue.start - previous.end <= 2.2;
    if (canMerge) {
      previous.cues.push({ ...cue, index });
      previous.end = cue.end;
    } else {
      turns.push({ speaker, start: cue.start, end: cue.end, cues: [{ ...cue, index }] });
    }
  }
  return turns;
}

function transcriptCueFragmentHtml(cue, index, query, className = 'speaker-cue-fragment') {
  const matchClass = state.transcriptSearchMatches.includes(index) ? ' search-match' : '';
  const activeClass = index === state.transcriptActiveCueIndex ? ' is-search-active' : '';
  const playingClass = index === state.playbackCueIndex ? ' is-playing' : '';
  return `<button class="${className}${matchClass}${activeClass}${playingClass}" type="button" data-transcript-cue-index="${index}" title="Jump video to ${escapeHtml(formatDuration(cue.start, '00:00'))}">${highlightedTranscriptHtml(cue.text.replace(/\n/g, ' '), query)}</button>`;
}

function wireTranscriptCueButtons(root) {
  root?.querySelectorAll('[data-transcript-cue-index]').forEach((button) => button.addEventListener('click', () => {
    activateTranscriptCue(Number(button.dataset.transcriptCueIndex), true, true);
  }));
}

function renderSpeakerTranscript(query) {
  const list = $('transcriptSpeakerList');
  if (!list) return;
  if (!state.subtitleCues.length) {
    const plain = $('transcriptText')?.value.trim() || '';
    list.innerHTML = plain ? `<div class="transcript-speaker-turn"><div class="speaker-turn-header"><strong>Speaker</strong></div><div class="speaker-turn-text">${highlightedTranscriptHtml(plain, query)}</div></div>` : '<div class="transcript-search-empty">Transcript is not available yet.</div>';
    return;
  }
  const turns = buildSpeakerTurns();
  list.innerHTML = turns.map((turn) => {
    const first = turn.cues[0];
    const colorClass = window.PulseStudioSpeakerTools?.className(speakerColorKey(turn.speaker)) || '';
    return `<article class="transcript-speaker-turn ${colorClass}" role="listitem">
      <div class="speaker-turn-header"><strong>${escapeHtml(turn.speaker)}</strong><button type="button" class="speaker-turn-time" data-transcript-cue-index="${first.index}" title="Jump to ${escapeHtml(formatDuration(turn.start, '00:00'))}">${escapeHtml(formatDuration(turn.start, '00:00'))}</button></div>
      <div class="speaker-turn-text">${turn.cues.map((cue) => transcriptCueFragmentHtml(cue, cue.index, query)).join(' ')}</div>
    </article>`;
  }).join('');
  wireTranscriptCueButtons(list);
}

function renderRawTranscript(query) {
  const raw = $('transcriptRawView');
  if (!raw) return;
  if (!state.subtitleCues.length) {
    const plain = $('transcriptText')?.value.trim() || '';
    raw.innerHTML = plain ? highlightedTranscriptHtml(plain, query) : '<div class="transcript-search-empty">Transcript is not available yet.</div>';
    return;
  }
  raw.innerHTML = `<p>${state.subtitleCues.map((cue, index) => transcriptCueFragmentHtml(cue, index, query, 'raw-cue-fragment')).join(' ')}</p>`;
  wireTranscriptCueButtons(raw);
}

function applyTranscriptViewUi() {
  state.transcriptView = normalizeTranscriptView(state.transcriptView);
  const mapping = {
    speakers: $('transcriptSpeakerList'),
    timecoded: $('transcriptCueList'),
    raw: $('transcriptRawView')
  };
  Object.entries(mapping).forEach(([view, element]) => element?.classList.toggle('hidden', view !== state.transcriptView));
  document.querySelectorAll('[data-transcript-view]').forEach((button) => {
    const active = button.dataset.transcriptView === state.transcriptView;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function setTranscriptView(view, persist = true) {
  state.transcriptView = normalizeTranscriptView(view);
  if (persist) localStorage.setItem('transcriptView', state.transcriptView);
  renderTranscriptCueList();
  if (state.transcriptActiveCueIndex >= 0) requestAnimationFrame(() => scrollTranscriptCueIntoView(state.transcriptActiveCueIndex));
}

function renderTranscriptCueList() {
  const list = $('transcriptCueList');
  if (!list) return;
  const query = $('transcriptSearch')?.value.trim() || '';
  if (!state.subtitleCues.length) {
    const plain = $('transcriptText')?.value.trim() || '';
    list.innerHTML = plain
      ? `<div class="transcript-plain-text">${highlightedTranscriptHtml(plain, query)}</div>`
      : '<div class="transcript-search-empty">Transcript is not available yet.</div>';
    renderSpeakerTranscript(query);
    renderRawTranscript(query);
    applyTranscriptViewUi();
    return;
  }
  const matched = new Set(state.transcriptSearchMatches);
  list.innerHTML = state.subtitleCues.map((cue, index) => {
    const classes = [
      'transcript-cue-row',
      matched.has(index) ? 'search-match' : '',
      index === state.transcriptActiveCueIndex ? 'is-search-active' : ''
    ].filter(Boolean).join(' ');
    const speaker = cueSpeaker(cue) || 'Speaker';
    const colorClass = window.PulseStudioSpeakerTools?.className(speakerColorKey(speaker)) || '';
    return `<button class="${classes}" type="button" data-transcript-cue-index="${index}" title="Jump video to ${escapeHtml(formatDuration(cue.start, '00:00'))}">
      <time>${escapeHtml(formatDuration(cue.start, '00:00'))}</time>
      <span class="transcript-speaker-chip ${colorClass}"><i aria-hidden="true"></i>${escapeHtml(speaker)}</span>
      <span class="transcript-cue-text">${highlightedTranscriptHtml(cue.text, query)}</span>
    </button>`;
  }).join('');
  wireTranscriptCueButtons(list);
  renderSpeakerTranscript(query);
  renderRawTranscript(query);
  applyTranscriptViewUi();
  updateTranscriptCuePlaybackHighlight();
}

function updateTranscriptSearchNavigation() {
  const count = $('transcriptSearchCount');
  const prev = $('transcriptSearchPrev');
  const next = $('transcriptSearchNext');
  const total = state.transcriptSearchMatches.length;
  const position = total && state.transcriptSearchPosition >= 0 ? state.transcriptSearchPosition + 1 : 0;
  if (count) count.textContent = total ? `${position} of ${total}` : '0 matches';
  if (prev) prev.disabled = !total;
  if (next) next.disabled = !total;
}

function scrollTranscriptCueIntoView(cueIndex, behavior = 'smooth') {
  const root = state.transcriptView === 'speakers' ? $('transcriptSpeakerList') : state.transcriptView === 'raw' ? $('transcriptRawView') : $('transcriptCueList');
  const row = root?.querySelector(`[data-transcript-cue-index="${cueIndex}"]`);
  if (!root || !row) return;

  // Keep transcript navigation scoped to its own scroll container. Using
  // Element.scrollIntoView() here can also scroll ancestor containers (and the
  // document), which pulls the playback video off screen while it is playing.
  const rootRect = root.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const rowCenter = rowRect.top - rootRect.top + root.scrollTop + (rowRect.height / 2);
  const targetTop = Math.max(0, rowCenter - (root.clientHeight / 2));
  if (typeof root.scrollTo === 'function') root.scrollTo({ top: targetTop, behavior });
  else root.scrollTop = targetTop;

  row.classList.remove('search-pulse');
  void row.offsetWidth;
  row.classList.add('search-pulse');
  setTimeout(() => row.classList.remove('search-pulse'), 650);
}

async function robustSeekPlayback(seconds, autoplay = true) {
  const video = $('playbackVideo');
  const target = Math.max(0, Number(seconds) || 0);
  const recordingPath = state.selectedPlaybackPath;
  const selectionToken = state.playbackSelectionToken;
  const applySeek = async () => {
    if (selectionToken !== state.playbackSelectionToken || recordingPath !== state.selectedPlaybackPath) return;
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
    const resolved = duration == null ? target : clamp(target, 0, duration);
    try { video.currentTime = resolved; } catch {}
    state.pendingSeekTarget = resolved;
    updatePlaybackClock();
    if (autoplay) { try { await video.play(); } catch {} }
  };
  if (video.readyState >= 1) {
    await applySeek();
    return;
  }
  state.pendingSeekTarget = target;
  $('playerStatus').textContent = `Loading ${formatDuration(target, '00:00')}…`;
  video.addEventListener('loadedmetadata', () => { applySeek(); }, { once: true });
}

async function activateTranscriptCue(cueIndex, autoplay = true, scroll = true) {
  const cue = state.subtitleCues[Number(cueIndex)];
  if (!cue) return;
  state.transcriptActiveCueIndex = Number(cueIndex);
  const matchPosition = state.transcriptSearchMatches.indexOf(Number(cueIndex));
  if (matchPosition >= 0) state.transcriptSearchPosition = matchPosition;
  renderTranscriptCueList();
  renderTranscriptSearchResults(false);
  updateTranscriptSearchNavigation();
  if (scroll) scrollTranscriptCueIntoView(Number(cueIndex));
  $('transcriptStatus').textContent = `Jumped to ${formatDuration(cue.start, '00:00')}.`;
  await robustSeekPlayback(cue.start, autoplay);
}

function moveTranscriptSearchMatch(direction) {
  const total = state.transcriptSearchMatches.length;
  if (!total) return;
  let next = state.transcriptSearchPosition;
  if (next < 0) next = direction >= 0 ? 0 : total - 1;
  else next = (next + direction + total) % total;
  state.transcriptSearchPosition = next;
  activateTranscriptCue(state.transcriptSearchMatches[next], true, true);
}

function renderTranscriptSearchResults(resetPosition = true) {
  const input = $('transcriptSearch');
  const results = $('transcriptSearchResults');
  if (!input || !results) return;
  const q = input.value.trim().toLowerCase();
  $('clearTranscriptSearch')?.classList.toggle('hidden', !q);
  if (!q) {
    state.transcriptSearchMatches = [];
    state.transcriptSearchPosition = -1;
    state.transcriptActiveCueIndex = -1;
    results.classList.add('hidden');
    results.innerHTML = '';
    updateTranscriptSearchNavigation();
    renderTranscriptCueList();
    return;
  }
  state.transcriptSearchMatches = state.subtitleCues
    .map((cue, index) => ({ cue, index }))
    .filter(({ cue }) => String(cue.text || '').toLowerCase().includes(q))
    .map(({ index }) => index);
  if (resetPosition) state.transcriptSearchPosition = state.transcriptSearchMatches.length ? 0 : -1;
  if (state.transcriptSearchPosition >= state.transcriptSearchMatches.length) state.transcriptSearchPosition = state.transcriptSearchMatches.length - 1;
  state.transcriptActiveCueIndex = state.transcriptSearchPosition >= 0 ? state.transcriptSearchMatches[state.transcriptSearchPosition] : -1;
  results.classList.remove('hidden');
  if (!state.transcriptSearchMatches.length) {
    results.innerHTML = '<div class="transcript-search-empty">No timestamped transcript matches.</div>';
    updateTranscriptSearchNavigation();
    renderTranscriptCueList();
    return;
  }
  results.innerHTML = state.transcriptSearchMatches.slice(0, 80).map((cueIndex) => {
    const cue = state.subtitleCues[cueIndex];
    const active = cueIndex === state.transcriptActiveCueIndex ? ' is-active' : '';
    return `<button class="transcript-search-result${active}" type="button" data-cue-index="${cueIndex}"><time>${escapeHtml(formatDuration(cue.start, '00:00'))}</time><span>${highlightedTranscriptHtml(cue.text.replace(/\n/g, ' '), q)}</span></button>`;
  }).join('');
  results.querySelectorAll('[data-cue-index]').forEach((button) => button.addEventListener('click', () => activateTranscriptCue(Number(button.dataset.cueIndex), true, true)));
  updateTranscriptSearchNavigation();
  renderTranscriptCueList();
  if (resetPosition && state.transcriptActiveCueIndex >= 0) {
    requestAnimationFrame(() => scrollTranscriptCueIntoView(state.transcriptActiveCueIndex));
  }
}

function updateTranscriptCuePlaybackHighlight() {
  if (!state.subtitleCues.length) { state.playbackCueIndex = -1; return; }
  const video = $('playbackVideo');
  const current = video.currentTime || 0;
  let activeIndex = state.subtitleCues.findIndex((cue) => current >= cue.start && current <= cue.end);
  if (activeIndex < 0) activeIndex = state.subtitleCues.findLastIndex ? state.subtitleCues.findLastIndex((cue) => cue.start <= current) : -1;
  const changed = activeIndex !== state.playbackCueIndex;
  state.playbackCueIndex = activeIndex;
  for (const root of [$('transcriptSpeakerList'), $('transcriptCueList'), $('transcriptRawView')]) {
    if (!root) continue;
    root.querySelectorAll('.is-playing').forEach((row) => row.classList.remove('is-playing'));
    if (activeIndex >= 0) root.querySelectorAll(`[data-transcript-cue-index="${activeIndex}"]`).forEach((row) => row.classList.add('is-playing'));
  }
  // Playback must never take over the user's scroll position. The current cue
  // is highlighted above, but following it is intentionally manual so the
  // video remains watchable while the transcript continues to update.
  if (!changed || activeIndex < 0) return;
}

async function jumpPlaybackTo(seconds, autoplay = true) {
  await robustSeekPlayback(seconds, autoplay);
}


function insightCopyText(kind = 'all') {
  const insights = state.playbackInsights || {};
  const lines = [];
  if (kind === 'all' || kind === 'chapters') {
    if ((insights.chapters || []).length) {
      lines.push('CHAPTERS');
      for (const chapter of insights.chapters) lines.push(`${formatDuration(chapter.startSeconds, '00:00')}  ${chapter.title}`);
      lines.push('');
    }
  }
  if (kind === 'all' || kind === 'summary') {
    if (insights.overview || (insights.summaryBullets || []).length) {
      lines.push('MEETING SUMMARY');
      if (insights.overview) lines.push(insights.overview, '');
      for (const item of insights.summaryBullets || []) {
        const label = String(item.type || 'key_point').replace(/_/g, ' ').toUpperCase();
        lines.push(`- [${label}] [${formatDuration(item.seconds, '00:00')}] ${item.text}`);
      }
      lines.push('');
    }
  }
  if (kind === 'all' || kind === 'actions') {
    lines.push('ACTION ITEMS');
    if ((insights.actionItems || []).length) {
      for (const item of insights.actionItems) {
        const meta = [item.owner ? `Owner: ${item.owner}` : '', item.due ? `Due: ${item.due}` : ''].filter(Boolean).join(' · ');
        lines.push(`- [${formatDuration(item.seconds, '00:00')}] ${item.text}${meta ? ` (${meta})` : ''}`);
      }
    } else lines.push('- No explicit action items detected.');
  }
  return lines.join('\n').trim();
}

function wireInsightTimestampButtons(root = $('insightsPanel')) {
  if (!root) return;
  root.querySelectorAll('[data-insight-seconds]').forEach((button) => {
    button.addEventListener('click', () => jumpPlaybackTo(Number(button.dataset.insightSeconds), true));
  });
}

function insightCorrectionSelect(item, currentClassification = '') {
  const value = currentClassification === 'decision' || currentClassification === 'risk' || currentClassification === 'action' ? currentClassification : '';
  return `<span class="insight-correction-control"><select class="insight-correction-select" data-insight-correct="1" data-insight-text="${escapeHtml(item.text || '')}" data-insight-seconds="${Number(item.seconds) || 0}" aria-label="Correct meeting insight classification">
    <option value="" ${value ? '' : 'selected'}>Correct…</option>
    <option value="decision" ${value === 'decision' ? 'selected' : ''}>Decision</option>
    <option value="action" ${value === 'action' ? 'selected' : ''}>Action</option>
    <option value="risk" ${value === 'risk' ? 'selected' : ''}>Risk</option>
    <option value="not_relevant">Not relevant</option>
  </select></span>`;
}

function wireInsightCorrectionControls() {
  $('insightsPanel')?.querySelectorAll('[data-insight-correct]').forEach((select) => select.addEventListener('change', async () => {
    const classification = select.value;
    if (!classification || !state.selectedPlaybackPath || state.insightCorrectionBusy) return;
    state.insightCorrectionBusy = true;
    select.disabled = true;
    try {
      const updated = await window.recorderAPI.correctRecordingInsight(state.selectedPlaybackPath, {
        text: select.dataset.insightText || '',
        seconds: Number(select.dataset.insightSeconds) || 0,
        classification
      });
      state.playbackInsights = updated || state.playbackInsights;
      $('insightsStatus').textContent = classification === 'not_relevant'
        ? 'Insight marked not relevant and removed. Transcript text was not changed.'
        : `Insight reclassified as ${classification === 'action' ? 'Action' : classification === 'decision' ? 'Decision' : 'Risk'}. Transcript text was not changed.`;
      renderPlaybackInsights();
    } catch (error) {
      $('insightsStatus').textContent = `Could not save that change. ${friendlyErrorText(error)}`;
      select.disabled = false;
    } finally { state.insightCorrectionBusy = false; }
  }));
}

function renderPlaybackInsights() {
  const insights = state.playbackInsights || { overview: '', chapters: [], summaryBullets: [], actionItems: [] };
  const chapters = Array.isArray(insights.chapters) ? insights.chapters : [];
  const summary = Array.isArray(insights.summaryBullets) ? insights.summaryBullets : [];
  const actions = Array.isArray(insights.actionItems) ? insights.actionItems : [];
  const overview = String(insights.overview || '').trim();
  $('regenerateInsights').disabled = !state.selectedPlaybackPath || state.insightsLoading || !state.playbackTranscript?.text;
  $('copyAllInsights').disabled = !overview && !chapters.length && !summary.length && !actions.length;
  $('copySummary').disabled = !overview && !summary.length;
  $('copyActionItems').disabled = !actions.length;

  const overviewBox = $('meetingOverview');
  if (overviewBox) {
    overviewBox.textContent = overview;
    overviewBox.classList.toggle('hidden', !overview);
  }

  $('chapterList').innerHTML = chapters.length
    ? chapters.map((chapter, index) => `<button class="chapter-row" type="button" data-insight-seconds="${Number(chapter.startSeconds) || 0}"><time>${escapeHtml(formatDuration(chapter.startSeconds, '00:00'))}</time><span><strong>${escapeHtml(chapter.title || `Chapter ${index + 1}`)}</strong>${chapter.preview ? `<small>${escapeHtml(chapter.preview)}</small>` : ''}</span></button>`).join('')
    : '<span class="helper">No clear topic chapters could be identified.</span>';

  const summaryTypeLabel = (type) => ({ decision: 'Decision', outcome: 'Outcome', risk: 'Risk', open_question: 'Open question', key_point: 'Key point' }[type] || 'Key point');
  $('summaryList').innerHTML = summary.length
    ? summary.map((item) => `<div class="insight-line summary-insight-line ${item.corrected ? 'is-corrected' : ''}"><span class="insight-type insight-type-${escapeHtml(item.type || 'key_point')}">${escapeHtml(summaryTypeLabel(item.type))}</span><button type="button" class="insight-time" data-insight-seconds="${Number(item.seconds) || 0}">${escapeHtml(formatDuration(item.seconds, '00:00'))}</button><span class="insight-copy">${escapeHtml(item.text)}</span>${insightCorrectionSelect(item, item.type)}</div>`).join('')
    : '<span class="helper">No high-confidence meeting outcomes were identified yet. Regenerate after the transcript is complete.</span>';

  $('actionItemList').innerHTML = actions.length
    ? actions.map((item) => {
        const meta = [item.owner ? `Owner: ${item.owner}` : '', item.due ? `Due: ${item.due}` : ''].filter(Boolean);
        return `<div class="insight-line action-line ${item.corrected ? 'is-corrected' : ''}"><span class="action-check" aria-hidden="true">✓</span><button type="button" class="insight-time" data-insight-seconds="${Number(item.seconds) || 0}">${escapeHtml(formatDuration(item.seconds, '00:00'))}</button><span class="insight-copy"><strong class="action-item-text">${escapeHtml(item.text)}</strong>${meta.length ? `<small class="action-item-meta">${meta.map(escapeHtml).join(' · ')}</small>` : '<small class="action-item-meta">Owner / due date were not explicitly stated.</small>'}</span>${insightCorrectionSelect(item, 'action')}</div>`;
      }).join('')
    : '<div class="no-action-items"><strong>No explicit action items found.</strong><span>The transcript does not contain a clear commitment, assignment, request, or agreed next step.</span></div>';
  const hasAnyInsights = Boolean(overview || chapters.length || summary.length || actions.length);
  $('insightsPanel')?.classList.toggle('is-empty-collapsed', !hasAnyInsights && !state.insightsLoading);
  if (!hasAnyInsights && !state.insightsLoading) applyKnowledgeCollapse('insightsPanelToggle', 'insightsContent', true, null, false);
  else applyKnowledgeCollapse('insightsPanelToggle', 'insightsContent', state.insightsPanelCollapsed, null, false);
  applyKnowledgeCollapse('chaptersToggle', 'chaptersContent', chapters.length ? state.chaptersCollapsed : true, null, false);
  applyKnowledgeCollapse('meetingSummaryToggle', 'meetingSummaryContent', (overview || summary.length) ? state.meetingSummaryCollapsed : true, null, false);
  applyKnowledgeCollapse('actionItemsToggle', 'actionItemsContent', actions.length ? state.actionItemsCollapsed : true, null, false);
  wireInsightTimestampButtons();
  wireInsightCorrectionControls();
  renderPlaybackMarkers();
}

async function loadPlaybackInsights(recordingPath, selectionToken = state.playbackSelectionToken, force = false) {
  if (!recordingPath || state.insightsLoading) return;
  window.recorderAPI.logEvent?.('info', 'ai.insights-started', { force: Boolean(force) });
  state.insightsLoading = true;
  $('insightsStatus').textContent = force ? 'Enhancing meeting summary and action items locally…' : 'Preparing meeting summary and action items from the transcript…';
  renderPlaybackInsights();
  try {
    const insights = force
      ? await window.recorderAPI.regenerateRecordingInsights(recordingPath)
      : await window.recorderAPI.getRecordingInsights(recordingPath);
    if (selectionToken !== state.playbackSelectionToken || state.selectedPlaybackPath !== recordingPath) return;
    state.playbackInsights = insights || { overview: '', chapters: [], summaryBullets: [], actionItems: [] };
    window.recorderAPI.logEvent?.('info', 'ai.insights-completed', { force: Boolean(force), method: insights?.method || '', chapterCount: state.playbackInsights.chapters?.length || 0, actionItemCount: state.playbackInsights.actionItems?.length || 0 });
    $('insightsStatus').textContent = String(insights?.method || '').includes('ai-busy')
      ? 'Quick meeting analysis is ready. Enhanced notes were deferred because transcription and other active AI work have priority.'
      : 'Meeting analysis ready. Review the timestamped outcomes and explicit follow-ups below.';
  } catch (error) {
    if (selectionToken !== state.playbackSelectionToken || state.selectedPlaybackPath !== recordingPath) return;
    state.playbackInsights = { overview: '', chapters: [], summaryBullets: [], actionItems: [] };
    window.recorderAPI.logEvent?.('error', 'ai.insights-failed', { force: Boolean(force), errorName: error?.name || 'Error' });
    $('insightsStatus').textContent = /Transcript is not ready/i.test(error.message || '')
      ? 'Transcript is still being generated. Meeting insights will appear automatically when it is ready.'
      : `Meeting insights could not be generated. ${friendlyErrorText(error)}`;
  } finally {
    if (selectionToken === state.playbackSelectionToken && state.selectedPlaybackPath === recordingPath) {
      state.insightsLoading = false;
      renderPlaybackInsights();
    }
  }
}

async function addRecordingBookmark(label = '') {
  if (!state.mediaRecorder || state.mediaRecorder.state === 'inactive') return;
  const seconds = elapsedMs() / 1000;
  const marker = { id: `marker-${Date.now()}`, seconds, label: String(label || `Bookmark ${state.pendingMarkers.length + 1}`) };
  state.pendingMarkers.push(marker);
  setStatus(`Bookmark added at ${formatPreciseSeconds(seconds)}.`);
  checkpointActiveRecording('bookmark-added');
  openRecordingBookmarkTextEditor(marker);
}

function closeRecordingBookmarkTextEditor({ showDefaultCompactFeedback = false } = {}) {
  const editor = $('recordingBookmarkTextEditor');
  if (!editor) return;
  clearTimeout(state.recordingBookmarkEditorTimer);
  state.recordingBookmarkEditorTimer = null;
  const markerId = state.recordingBookmarkEditorMarkerId;
  const marker = markerId ? state.pendingMarkers.find((item) => item.id === markerId) : null;
  editor.classList.add('hidden');
  state.recordingBookmarkEditorMarkerId = '';
  scheduleCompactWindowFit();
  if (showDefaultCompactFeedback && marker && state.viewMode === 'compact') {
    showCompactFeedback(`Bookmark added · ${formatDuration(marker.seconds, '00:00')}`, 1500);
  }
}

function openRecordingBookmarkTextEditor(marker) {
  const editor = $('recordingBookmarkTextEditor');
  const input = $('recordingBookmarkTextInput');
  if (!editor || !input || !marker) return;
  clearTimeout(state.recordingBookmarkEditorTimer);
  state.recordingBookmarkEditorTimer = null;
  state.recordingBookmarkEditorMarkerId = marker.id;
  $('recordingBookmarkTextTime').textContent = formatDuration(Number(marker.seconds) || 0, '00:00');
  input.value = isDefaultBookmarkLabel(marker.label) ? '' : String(marker.label || '');
  editor.classList.remove('hidden');
  scheduleCompactWindowFit();
  requestAnimationFrame(() => { input.focus(); input.select(); });

  // Mini Controller gives the user a one-second grace period to start typing.
  // If no custom text is started, keep the default bookmark, close the editor,
  // and replace it with the lightweight "Bookmark added" confirmation.
  if (state.viewMode === 'compact') {
    state.recordingBookmarkEditorTimer = setTimeout(() => {
      if (state.recordingBookmarkEditorMarkerId !== marker.id || state.viewMode !== 'compact') return;
      const value = String(input.value || '').trim();
      if (value) return; // The user started typing; let them finish and Save/Enter normally.
      closeRecordingBookmarkTextEditor({ showDefaultCompactFeedback: true });
    }, 1000);
  }
}

function saveRecordingBookmarkTextEditor() {
  const markerId = state.recordingBookmarkEditorMarkerId;
  if (!markerId) return closeRecordingBookmarkTextEditor();
  const marker = state.pendingMarkers.find((item) => item.id === markerId);
  if (!marker) return closeRecordingBookmarkTextEditor();
  const value = String($('recordingBookmarkTextInput')?.value || '').trim().replace(/\s+/g, ' ').slice(0, 48);
  if (value) marker.label = value;
  setStatus(`Bookmark saved · ${marker.label} · ${formatPreciseSeconds(marker.seconds)}.`);
  checkpointActiveRecording('bookmark-edited');
  if (state.viewMode === 'compact') {
    showCompactFeedback(value
      ? `Bookmark saved · ${marker.label} · ${formatDuration(marker.seconds, '00:00')}`
      : `Bookmark added · ${formatDuration(marker.seconds, '00:00')}`, 1500);
  }
  closeRecordingBookmarkTextEditor();
}

function showPlaybackBookmarkOverlay(marker) {
  const overlay = $('bookmarkMarkerOverlay');
  if (!overlay || !marker) return;
  const label = String(marker.label || 'Bookmark').trim() || 'Bookmark';
  $('bookmarkMarkerOverlayLabel').textContent = label;
  $('bookmarkMarkerOverlayTime').textContent = formatDuration(Number(marker.seconds) || 0, '00:00');
  overlay.classList.remove('hidden');
  clearTimeout(state.bookmarkOverlayTimer);
  state.bookmarkOverlayTimer = setTimeout(() => overlay.classList.add('hidden'), 2600);
}

function updatePlaybackBookmarkOverlay(currentTime) {
  const current = Math.max(0, Number(currentTime) || 0);
  const previous = state.lastBookmarkClockTime;
  state.lastBookmarkClockTime = current;
  const video = $('playbackVideo');
  if (video?.paused || previous == null || current < previous || current - previous > 2.5) return;
  const marker = state.playbackMarkers.find((item) => Number(item.seconds) > previous + 0.01 && Number(item.seconds) <= current + 0.08);
  if (marker) showPlaybackBookmarkOverlay(marker);
}

function positionBookmarkInlineEditor(seconds) {
  const timeline = $('waveformTimeline');
  const editor = $('bookmarkInlineEditor');
  if (!timeline || !editor) return;
  const duration = Number($('playbackVideo')?.duration) || Number(state.recordings.find((item) => item.path === state.selectedPlaybackPath)?.durationSeconds) || 0;
  const width = Math.max(1, timeline.clientWidth || 1);
  const ratio = duration > 0 ? clamp((Math.max(0, Number(seconds) || 0) / duration), 0, 1) : 0;
  const anchorX = ratio * width;
  const editorHalf = Math.min(92, Math.max(38, width / 2 - 4));
  const visualCenter = width <= editorHalf * 2 ? width / 2 : clamp(anchorX, editorHalf, width - editorHalf);
  editor.style.left = `${visualCenter}px`;
  editor.style.setProperty('--bookmark-editor-arrow-shift', `${anchorX - visualCenter}px`);
}

function closeBookmarkInlineEditor({ resume = true } = {}) {
  clearTimeout(state.bookmarkEditorAutoSaveTimer);
  state.bookmarkEditorAutoSaveTimer = null;
  const editor = $('bookmarkInlineEditor');
  if (!editor || editor.classList.contains('hidden')) return;
  editor.classList.add('hidden');
  const shouldResume = resume && state.bookmarkDialogWasPlaying && state.selectedPlaybackPath;
  state.bookmarkDialogWasPlaying = false;
  state.bookmarkDialogMarkerId = '';
  state.bookmarkDialogSeconds = 0;
  if (shouldResume) $('playbackVideo')?.play().catch(() => {});
}

function openBookmarkInlineEditor(marker = null) {
  if (!state.selectedPlaybackPath) return;
  const editor = $('bookmarkInlineEditor');
  const input = $('bookmarkInlineInput');
  const video = $('playbackVideo');
  if (!editor || !input || !video) return;
  clearTimeout(state.bookmarkClickTimer);
  state.bookmarkClickTimer = null;
  state.bookmarkDialogMarkerId = marker?.id || '';
  state.bookmarkDialogSeconds = marker ? Math.max(0, Number(marker.seconds) || 0) : Math.max(0, Number(video.currentTime) || 0);
  state.bookmarkDialogWasPlaying = !video.paused;
  if (state.bookmarkDialogWasPlaying) video.pause();
  input.value = marker && !isDefaultBookmarkLabel(marker.label) ? String(marker.label || '') : '';
  input.placeholder = marker ? 'Edit marker text' : 'Marker text';
  editor.classList.remove('hidden');
  editor.classList.toggle('is-editing', Boolean(marker));
  positionBookmarkInlineEditor(state.bookmarkDialogSeconds);
  clearTimeout(state.bookmarkEditorAutoSaveTimer);
  state.bookmarkEditorAutoSaveTimer = null;
  if (!marker) {
    state.bookmarkEditorAutoSaveTimer = setTimeout(() => {
      state.bookmarkEditorAutoSaveTimer = null;
      const activeEditor = $('bookmarkInlineEditor');
      const activeInput = $('bookmarkInlineInput');
      if (!activeEditor || activeEditor.classList.contains('hidden') || state.bookmarkDialogMarkerId) return;
      if (String(activeInput?.value || '').trim()) return;
      void saveBookmarkInlineEditor();
    }, 2000);
  }
  requestAnimationFrame(() => { input.focus(); input.select(); });
}

async function saveBookmarkInlineEditor() {
  if (!state.selectedPlaybackPath) return;
  const markerId = state.bookmarkDialogMarkerId;
  const label = String($('bookmarkInlineInput')?.value || '').trim().replace(/\s+/g, ' ').slice(0, 48);
  const seconds = Math.max(0, Number(state.bookmarkDialogSeconds) || 0);
  try {
    let savedId = markerId;
    if (markerId) {
      const index = state.playbackMarkers.findIndex((item) => item.id === markerId);
      if (index < 0) throw new Error('Bookmark marker was not found.');
      state.playbackMarkers[index] = { ...state.playbackMarkers[index], label: label || state.playbackMarkers[index].label || `Bookmark ${index + 1}` };
    } else {
      savedId = `marker-${Date.now()}`;
      state.playbackMarkers.push({ id: savedId, seconds, label: label || `Bookmark ${state.playbackMarkers.length + 1}` });
    }
    state.playbackMarkers.sort((a, b) => a.seconds - b.seconds);
    state.playbackMarkers = await window.recorderAPI.saveRecordingMarkers(state.selectedPlaybackPath, state.playbackMarkers);
    const savedMarker = state.playbackMarkers.find((item) => item.id === savedId) || null;
    renderPlaybackMarkers();
    renderAllWaveforms();
    if (savedMarker) showPlaybackBookmarkOverlay(savedMarker);
    $('playerStatus').textContent = `${markerId ? 'Bookmark updated' : 'Bookmark added'} · ${savedMarker?.label || label || 'Bookmark'}`;
    showToast(markerId ? 'Bookmark updated' : 'Bookmark added');
    closeBookmarkInlineEditor();
  } catch (error) {
    $('playerStatus').textContent = `Could not save bookmark marker. ${friendlyErrorText(error)}`;
    $('bookmarkInlineInput')?.focus();
  }
}

function scheduleQuickPlaybackBookmark(button = null) {
  clearTimeout(state.bookmarkClickTimer);
  state.bookmarkClickTimer = setTimeout(() => {
    state.bookmarkClickTimer = null;
    if (button) pulsePlayerControl(button);
    addPlaybackBookmark();
  }, 230);
}

async function addPlaybackBookmark(label = '', secondsOverride = null) {
  if (!state.selectedPlaybackPath) return;
  const seconds = secondsOverride == null ? Math.max(0, Number($('playbackVideo').currentTime) || 0) : Math.max(0, Number(secondsOverride) || 0);
  const marker = { id: `marker-${Date.now()}`, seconds, label: String(label || '').trim().slice(0, 48) || `Bookmark ${state.playbackMarkers.length + 1}` };
  state.playbackMarkers.push(marker);
  state.playbackMarkers.sort((a, b) => a.seconds - b.seconds);
  try {
    state.playbackMarkers = await window.recorderAPI.saveRecordingMarkers(state.selectedPlaybackPath, state.playbackMarkers);
    renderPlaybackMarkers();
    renderAllWaveforms();
    showPlaybackBookmarkOverlay(state.playbackMarkers.find((item) => item.id === marker.id) || marker);
    $('playerStatus').textContent = `Bookmark added · ${marker.label} · ${formatPreciseSeconds(seconds)}`;
    showToast('Bookmark added');
  } catch (error) { $('playerStatus').textContent = `Could not save bookmark. ${friendlyErrorText(error)}`; }
}

function playbackBookmarkTargets(currentTime = Number($('playbackVideo')?.currentTime) || 0) {
  const markers = Array.isArray(state.playbackMarkers) ? state.playbackMarkers : [];
  const epsilon = 0.35;
  let previous = null;
  let next = null;
  for (const marker of markers) {
    const seconds = Math.max(0, Number(marker?.seconds) || 0);
    if (seconds < currentTime - epsilon) previous = marker;
    else if (seconds > currentTime + epsilon) { next = marker; break; }
  }
  return { previous, next };
}

function playbackBookmarkAtCurrentPosition(currentTime = Number($('playbackVideo')?.currentTime) || 0, tolerance = 0.85) {
  const markers = Array.isArray(state.playbackMarkers) ? state.playbackMarkers : [];
  let best = null;
  let bestDistance = Infinity;
  markers.forEach((marker, index) => {
    const seconds = Math.max(0, Number(marker?.seconds) || 0);
    const distance = Math.abs(seconds - currentTime);
    if (distance <= tolerance && distance < bestDistance) {
      best = { marker, index, distance };
      bestDistance = distance;
    }
  });
  return best;
}

function updatePlaybackBookmarkNavigation() {
  const hasRecording = Boolean(state.selectedPlaybackPath);
  const { previous, next } = playbackBookmarkTargets();
  const current = playbackBookmarkAtCurrentPosition();
  const previousButtons = [$('previousBookmark'), $('stickyPreviousBookmark')];
  const nextButtons = [$('nextBookmark'), $('stickyNextBookmark')];
  const addButtons = [$('addBookmarkPlayer'), $('stickyAddBookmark')];
  const deleteButtons = [$('deleteBookmarkPlayer'), $('stickyDeleteBookmark')];
  for (const button of previousButtons) {
    if (!button) continue;
    button.disabled = !hasRecording || !previous;
    button.title = previous ? `Previous bookmark · ${formatDuration(previous.seconds, '00:00')} · ${previous.label || 'Bookmark'}` : 'No previous bookmark';
  }
  for (const button of nextButtons) {
    if (!button) continue;
    button.disabled = !hasRecording || !next;
    button.title = next ? `Next bookmark · ${formatDuration(next.seconds, '00:00')} · ${next.label || 'Bookmark'}` : 'No next bookmark';
  }
  for (const button of addButtons) if (button) button.disabled = !hasRecording;
  for (const button of deleteButtons) {
    if (!button) continue;
    button.disabled = !hasRecording || !current;
    button.title = current
      ? `Delete ${current.marker.label || 'bookmark'} · ${formatDuration(current.marker.seconds, '00:00')}`
      : 'Jump to a bookmark to delete it';
  }
}

function seekToPlaybackBookmark(direction) {
  if (!state.selectedPlaybackPath) return;
  const video = $('playbackVideo');
  const { previous, next } = playbackBookmarkTargets(video?.currentTime || 0);
  const marker = direction < 0 ? previous : next;
  if (!marker || !video) return;
  const target = Number(marker.seconds) || 0;
  video.currentTime = Number.isFinite(video.duration) ? clamp(target, 0, video.duration) : Math.max(0, target);
  state.pendingSeekTarget = null;
  updatePlaybackClock();
  showPlaybackBookmarkOverlay(marker);
  $('playerStatus').textContent = `${direction < 0 ? 'Previous' : 'Next'} bookmark · ${marker.label || 'Bookmark'} · ${formatDuration(target, '00:00')}`;
}

async function deletePlaybackBookmarkAtCurrentPosition() {
  if (!state.selectedPlaybackPath) return;
  const current = playbackBookmarkAtCurrentPosition();
  if (!current) {
    $('playerStatus').textContent = 'Jump to a bookmark first, then delete it.';
    updatePlaybackBookmarkNavigation();
    return;
  }
  const removed = current.marker;
  const nextMarkers = state.playbackMarkers.filter((_, index) => index !== current.index);
  try {
    state.playbackMarkers = await window.recorderAPI.saveRecordingMarkers(state.selectedPlaybackPath, nextMarkers);
    renderPlaybackMarkers();
    renderAllWaveforms();
    $('playerStatus').textContent = `Bookmark deleted · ${formatDuration(removed.seconds, '00:00')}`;
    showToast('Bookmark deleted');
  } catch (error) {
    $('playerStatus').textContent = `Could not delete bookmark. ${friendlyErrorText(error)}`;
  }
}

async function refreshRecordings() {
  try {
    const result = await window.recorderAPI.listRecordings();
    state.recordingsDirectory = result.directory;
    state.recordings = result.files || [];
    state.categories = result.categories || [];
    updatePlaybackFolderLabel(result.directory);
    $('autosaveFolder').textContent = result.directory;
    if ($('recordingFolderPath')) { $('recordingFolderPath').textContent = result.directory; $('recordingFolderPath').title = result.directory; }
    updateRecordDestinationIndicator(result.directory);
    if (state.librarySearch) {
      const matches = await window.recorderAPI.searchRecordings(state.librarySearch).catch(() => []);
      state.librarySearchMatches = new Map((matches || []).map((item) => [item.path, item]));
    } else state.librarySearchMatches = new Map();
    updateCategoryFilterOptions();
    updateQuickFilterUi();
    for (const selectedPath of [...state.batchSelectedPaths]) {
      if (!state.recordings.some((item) => item.path === selectedPath)) state.batchSelectedPaths.delete(selectedPath);
    }
    renderRecordings();
    updateBatchDeleteUi();
    if (state.currentWorkspace === 'playback' && state.recordings.length) {
      const selectedStillExists = state.selectedPlaybackPath && state.recordings.some((item) => item.path === state.selectedPlaybackPath);
      if (!selectedStillExists) await selectPlaybackRecording(state.recordings[0]);
    }
  } catch (error) {
    $('recordingList').innerHTML = `<div class="empty">Could not load recordings. ${escapeHtml(friendlyErrorText(error))}</div>`;
  }
}

async function applyRecordingFolderChange(result, message) {
  if (!result || result.canceled) return;
  state.recordingsDirectory = result.directory || state.recordingsDirectory;
  updatePlaybackFolderLabel(state.recordingsDirectory);
  if ($('autosaveFolder')) $('autosaveFolder').textContent = state.recordingsDirectory;
  if ($('recordingFolderPath')) { $('recordingFolderPath').textContent = state.recordingsDirectory; $('recordingFolderPath').title = state.recordingsDirectory; }
  updateRecordDestinationIndicator(state.recordingsDirectory);
  resetPlaybackSelection();
  await refreshRecordings();
  setStatus(message || `Recording folder changed to ${state.recordingsDirectory}.`);
}

async function chooseRecordingFolder() {
  try {
    const result = await window.recorderAPI.chooseRecordingsFolder();
    await applyRecordingFolderChange(result, result?.canceled ? '' : `New recordings will save to ${result.directory}.`);
  } catch (error) {
    setStatus(`Could not change the recording folder. ${friendlyErrorText(error)}`, true);
  }
}

async function resetRecordingFolder() {
  try {
    const result = await window.recorderAPI.resetRecordingsFolder();
    await applyRecordingFolderChange(result, `Recording folder reset to ${result.directory}.`);
  } catch (error) {
    setStatus(`Could not reset the recording folder. ${friendlyErrorText(error)}`, true);
  }
}

function updateTimelineHoverPreview(event) {
  const timeline = $('waveformTimeline');
  const preview = $('timelineHoverPreview');
  const previewVideo = $('timelinePreviewVideo');
  if (!timeline || !preview || !previewVideo || !state.selectedPlaybackPath) return;
  if (!previewVideo.getAttribute('src') && previewVideo.dataset.pendingSrc) {
    previewVideo.src = previewVideo.dataset.pendingSrc;
    previewVideo.load();
  }
  const playbackVideo = $('playbackVideo');
  const selected = state.recordings.find((item) => item.path === state.selectedPlaybackPath);
  const duration = Number.isFinite(playbackVideo?.duration) && playbackVideo.duration > 0 ? playbackVideo.duration : Number(selected?.durationSeconds || 0);
  if (!duration) return;
  const rect = timeline.getBoundingClientRect();
  const x = clamp(event.clientX - rect.left, 0, rect.width);
  const seconds = clamp((x / Math.max(1, rect.width)) * duration, 0, duration);
  preview.classList.remove('hidden');
  preview.classList.toggle('time-only', selected?.mediaType === 'audio');
  const previewWidth = selected?.mediaType === 'audio' ? 76 : 166;
  preview.style.left = `${clamp(x, previewWidth / 2 + 4, rect.width - previewWidth / 2 - 4)}px`;
  $('timelineHoverTime').textContent = formatDuration(seconds, '00:00');
  state.timelinePreviewTarget = seconds;
  if (selected?.mediaType === 'audio') return;
  if (state.timelinePreviewTimer) return;
  state.timelinePreviewTimer = setTimeout(() => {
    state.timelinePreviewTimer = null;
    const target = state.timelinePreviewTarget;
    if (!Number.isFinite(target) || !previewVideo.src) return;
    if (Math.abs((previewVideo.currentTime || 0) - target) < 0.2 && state.timelinePreviewLastSeek >= 0) return;
    state.timelinePreviewLastSeek = target;
    try { previewVideo.currentTime = target; } catch {}
  }, 90);
}

function hideTimelineHoverPreview() {
  $('timelineHoverPreview')?.classList.add('hidden');
  state.timelinePreviewTarget = null;
}

function updateCategoryFilterOptions() {
  const filter = $('categoryFilter');
  if (!filter) return;
  const selected = state.categoryFilter || '__all__';
  const options = ['<option value="__all__">All categories</option>', '<option value="Uncategorized">Uncategorized</option>']
    .concat(state.categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`));
  filter.innerHTML = options.join('');
  if ([...filter.options].some((option) => option.value === selected)) filter.value = selected;
  else {
    filter.value = '__all__';
    state.categoryFilter = '__all__';
  }
}

function recordingCategoryOptions(selectedCategory) {
  const categories = ['Uncategorized', ...state.categories];
  return categories.map((category) => `<option value="${escapeHtml(category)}" ${category === selectedCategory ? 'selected' : ''}>${escapeHtml(category)}</option>`).join('');
}

function recordingMatchesQuickFilter(recording) {
  const filter = state.libraryQuickFilter || 'all';
  if (filter === 'video') return recording.mediaType === 'video';
  if (filter === 'audio') return recording.mediaType === 'audio';
  if (filter === 'favorites') return state.favoriteRecordingPaths.has(recording.path);
  return true;
}

function updateQuickFilterUi() {
  const counts = {
    all: state.recordings.length,
    video: state.recordings.filter((item) => item.mediaType === 'video').length,
    audio: state.recordings.filter((item) => item.mediaType === 'audio').length,
    favorites: state.recordings.filter((item) => state.favoriteRecordingPaths.has(item.path)).length
  };
  const countTargets = {
    quickFilterAllCount: counts.all,
    quickFilterVideoCount: counts.video,
    quickFilterAudioCount: counts.audio,
    quickFilterFavoritesCount: counts.favorites
  };
  for (const [id, value] of Object.entries(countTargets)) {
    const el = $(id);
    if (el) el.textContent = String(value);
  }
  document.querySelectorAll('[data-library-filter]').forEach((button) => {
    const active = button.dataset.libraryFilter === state.libraryQuickFilter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function setLibraryQuickFilter(filter) {
  const allowed = new Set(['all', 'video', 'audio', 'favorites']);
  state.libraryQuickFilter = allowed.has(filter) ? filter : 'all';
  clearBatchSelectionForFilterChange();
  updateQuickFilterUi();
  renderRecordings();
  updatePlaybackClipNavigation();
}

function updateBatchDeleteUi() {
  const bar = $('batchDeleteBar');
  const toggle = $('batchSelectButton');
  if (!bar || !toggle) return;
  bar.classList.toggle('hidden', !state.batchSelectionMode);
  toggle.textContent = state.batchSelectionMode ? 'Selecting' : 'Select';
  toggle.setAttribute('aria-pressed', String(state.batchSelectionMode));

  const existing = new Set(state.recordings.map((item) => item.path));
  for (const selectedPath of [...state.batchSelectedPaths]) {
    if (!existing.has(selectedPath)) state.batchSelectedPaths.delete(selectedPath);
  }

  const selectedRecordings = state.recordings.filter((item) => state.batchSelectedPaths.has(item.path));
  const selectedCount = selectedRecordings.length;
  const selectedBytes = selectedRecordings.reduce((sum, item) => sum + (Number(item.size) || 0), 0);
  const visible = visiblePlaybackRecordings();
  const selectedVisibleCount = visible.filter((item) => state.batchSelectedPaths.has(item.path)).length;
  const selectAll = $('batchSelectAll');
  if (selectAll) {
    selectAll.checked = visible.length > 0 && selectedVisibleCount === visible.length;
    selectAll.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visible.length;
    selectAll.disabled = !visible.length;
  }
  const summary = $('batchSelectionSummary');
  if (summary) summary.textContent = selectedCount ? `${selectedCount} selected · ${formatBytes(selectedBytes)}` : '0 selected';
  const deleteButton = $('batchDeleteSelected');
  if (deleteButton) {
    deleteButton.disabled = !selectedCount;
    deleteButton.textContent = selectedCount ? `Move to Trash (${selectedCount})` : 'Move to Trash';
  }
}

function setBatchSelectionMode(enabled) {
  state.batchSelectionMode = Boolean(enabled);
  if (!state.batchSelectionMode) state.batchSelectedPaths.clear();
  renderRecordings();
  updateBatchDeleteUi();
}

function clearBatchSelectionForFilterChange() {
  if (!state.batchSelectionMode || !state.batchSelectedPaths.size) return;
  state.batchSelectedPaths.clear();
  updateBatchDeleteUi();
}

async function deleteSelectedRecordings() {
  const selected = state.recordings.filter((item) => state.batchSelectedPaths.has(item.path));
  if (!selected.length) return;
  const totalBytes = selected.reduce((sum, item) => sum + (Number(item.size) || 0), 0);
  const confirmed = window.confirm(`Move ${selected.length} recording${selected.length === 1 ? '' : 's'} (${formatBytes(totalBytes)}) to system Trash?\n\nThe matching TXT transcript file will move to Trash too; any legacy SRT sidecar from an older build moves with it. Library-only bookmarks, categories, speaker labels, and cached meeting insights will be removed. The media files can be restored from your operating system Trash.`);
  if (!confirmed) return;

  const selectedPaths = selected.map((item) => item.path);
  const selectedPlaybackWasDeleted = state.selectedPlaybackPath && state.batchSelectedPaths.has(state.selectedPlaybackPath);
  try {
    const result = await window.recorderAPI.deleteRecordingsBatch(selectedPaths);
    const failed = result?.failed || [];
    const failedPaths = new Set(failed.map((item) => item.path).filter(Boolean));
    for (const deletedPath of selectedPaths) {
      if (!failedPaths.has(deletedPath)) {
        state.favoriteRecordingPaths.delete(deletedPath);
        state.transcribingPaths.delete(deletedPath);
      }
    }
    persistFavoriteRecordingPaths();
    state.batchSelectedPaths.clear();
    if (selectedPlaybackWasDeleted) resetPlaybackSelection();
    await refreshRecordings();
    updateBatchDeleteUi();
    const deletedCount = Number(result?.deletedCount) || 0;
    if (failed.length) {
      setStatus(`Moved ${deletedCount} recording${deletedCount === 1 ? '' : 's'} to Trash; ${failed.length} could not be moved.`, true);
    } else {
      setStatus(`Moved ${deletedCount} recording${deletedCount === 1 ? '' : 's'} and companion transcript files to system Trash.`);
      showToast(`Moved ${deletedCount} recording${deletedCount === 1 ? '' : 's'} to Trash`);
    }
  } catch (error) {
    setStatus(`Could not move the selected recordings to Trash. ${friendlyErrorText(error)}`, true);
  }
}

function recordingItemMarkup(recording) {
  const baseName = recording.name.replace(/\.(?:mp4|m4a|mp3)$/i, '');
  const isBusy = state.transcribingPaths.has(recording.path);
  const markerBadge = recording.markerCount ? `<span class="recording-marker-count">◆ ${recording.markerCount}</span>` : '';
  const batchSelected = state.batchSelectedPaths.has(recording.path);
  const batchCheckbox = state.batchSelectionMode
    ? `<label class="recording-batch-check"><input class="recording-batch-checkbox" type="checkbox" ${batchSelected ? 'checked' : ''} aria-label="Select ${escapeHtml(recording.name)} for moving to Trash" /><span aria-hidden="true"></span></label>`
    : '';
  const favorite = state.favoriteRecordingPaths.has(recording.path);
  const dateGroup = recordingDateGroup(recording.modifiedMs);
  const mediaLabel = recording.mediaType === 'audio' ? 'Audio recording' : 'Video recording';
  return `
    <div class="recording-item ${recording.path === state.selectedPlaybackPath ? 'active' : ''} ${state.batchSelectionMode ? 'batch-mode' : ''} ${batchSelected ? 'batch-selected' : ''}" data-recording-path="${escapeHtml(recording.path)}">
      <div class="recording-item-line">
        ${batchCheckbox}
        <button class="recording-select" type="button">
          <span class="recording-main-copy">
            <span class="recording-title-row"><span class="recording-type-icon ${recording.mediaType === 'audio' ? 'audio' : 'video'}" role="img" aria-label="${mediaLabel}"></span><span class="recording-item-name">${escapeHtml(recording.name)}${markerBadge}</span></span>
            <span class="recording-meta-row"><span class="recording-item-meta">${escapeHtml(formatRecordingListDate(recording.modifiedMs, dateGroup))} · ${escapeHtml(formatDuration(recording.durationSeconds, 'Duration …'))} · ${escapeHtml(formatBytes(recording.size))}</span></span>
          </span>
        </button>
        <button class="recording-favorite-button ${favorite ? 'active' : ''}" type="button" aria-label="${favorite ? 'Remove' : 'Add'} ${escapeHtml(recording.name)} ${favorite ? 'from' : 'to'} Favorites" aria-pressed="${favorite}">${favorite ? '★' : '☆'}</button>
        <button class="recording-rename-button" type="button" ${isBusy ? 'disabled' : ''} aria-label="Rename ${escapeHtml(recording.name)}">✎</button>
        <button class="recording-delete-button" type="button" aria-label="Move ${escapeHtml(recording.name)} to Trash">🗑</button>
        <select class="recording-category-select" aria-label="Category for ${escapeHtml(recording.name)}">${recordingCategoryOptions(recording.category || 'Uncategorized')}</select>
      </div>
      <div class="recording-rename-editor hidden">
        <input class="recording-rename-input" value="${escapeHtml(baseName)}" aria-label="New recording name" />
        <button class="button primary tiny recording-rename-save" type="button">Save</button>
        <button class="button secondary tiny recording-rename-cancel" type="button">Cancel</button>
      </div>
    </div>`;
}

function renderRecordings() {
  updateQuickFilterUi();
  if (!state.recordings.length) {
    $('recordingList').innerHTML = '<div class="empty library-empty-state"><strong>No recordings yet</strong><span>Your recordings will appear here after you finish your first capture.</span></div>';
    return;
  }

  const recordings = visiblePlaybackRecordings();
  const groups = new Map();
  for (const recording of recordings) {
    const group = recordingDateGroup(recording.modifiedMs);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(recording);
  }

  const groupOrder = ['Today', 'Yesterday', 'Earlier this week', 'Earlier'];
  const sections = groupOrder
    .filter((group) => groups.has(group))
    .map((group) => {
      const items = groups.get(group) || [];
      return `<section class="recording-section recording-date-section" data-date-group="${escapeHtml(group)}">
        <div class="recording-section-header"><span>${escapeHtml(group)}</span><span class="recording-section-count">${items.length}</span></div>
        ${items.map(recordingItemMarkup).join('')}
      </section>`;
    });

  if (!sections.length) {
    const message = state.librarySearch
      ? 'No recordings match this search.'
      : state.libraryQuickFilter === 'favorites'
        ? 'No favorite recordings yet. Click ☆ beside a recording to add it.'
        : state.libraryQuickFilter === 'audio'
          ? 'No audio recordings found.'
          : state.libraryQuickFilter === 'video'
            ? 'No video recordings found.'
            : 'No recordings in this category.';
    sections.push(`<div class="empty library-empty-state"><strong>Nothing here yet</strong><span>${escapeHtml(message)}</span></div>`);
  }
  $('recordingList').innerHTML = sections.join('');

  document.querySelectorAll('.recording-item').forEach((row) => {
    const recordingPath = row.dataset.recordingPath;
    const recording = state.recordings.find((item) => item.path === recordingPath);
    if (!recording) return;
    row.querySelector('.recording-select')?.addEventListener('click', () => {
      if (state.batchSelectionMode) {
        if (state.batchSelectedPaths.has(recording.path)) state.batchSelectedPaths.delete(recording.path);
        else state.batchSelectedPaths.add(recording.path);
        renderRecordings();
        updateBatchDeleteUi();
        return;
      }
      selectPlaybackRecording(recording);
    });
    row.querySelector('.recording-batch-checkbox')?.addEventListener('change', (event) => {
      if (event.target.checked) state.batchSelectedPaths.add(recording.path);
      else state.batchSelectedPaths.delete(recording.path);
      row.classList.toggle('batch-selected', event.target.checked);
      updateBatchDeleteUi();
    });
    row.querySelector('.recording-favorite-button')?.addEventListener('click', (event) => {
      event.stopPropagation();
      setRecordingFavorite(recording.path, !state.favoriteRecordingPaths.has(recording.path));
      renderRecordings();
      updatePlaybackClipNavigation();
    });
    row.querySelector('.recording-rename-button')?.addEventListener('click', () => startInlineRename(recordingPath));
    row.querySelector('.recording-delete-button')?.addEventListener('click', () => moveRecordingToTrash(recording));
    row.querySelector('.recording-rename-cancel')?.addEventListener('click', () => closeInlineRename(row));
    row.querySelector('.recording-rename-save')?.addEventListener('click', () => commitInlineRename(recording, row));
    row.querySelector('.recording-rename-input')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') commitInlineRename(recording, row);
      if (event.key === 'Escape') closeInlineRename(row);
    });
    row.querySelector('.recording-category-select')?.addEventListener('change', async (event) => {
      try {
        await window.recorderAPI.setRecordingCategory(recording.path, event.target.value);
        await refreshRecordings();
      } catch (error) {
        setStatus(`Could not update the category. ${friendlyErrorText(error)}`, true);
      }
    });
  });
  updateBatchDeleteUi();
}

function resetPlaybackSelection() {
  closeBookmarkInlineEditor({ resume: false });
  ++state.playbackSelectionToken;
  state.selectedPlaybackPath = null;
  state.playbackTranscript = { text: '', srt: '' };
  state.speakerSegments = [];
  state.speakerCount = 0;
  state.speakerDefinitions = [];
  state.speakerRecordingPath = null;
  state.speakerLoading = false;
  state.speakerError = '';
  state.waveformSamples = [];
  state.playbackMarkers = [];
  state.lastBookmarkClockTime = null;
  clearTimeout(state.bookmarkOverlayTimer);
  $('bookmarkMarkerOverlay')?.classList.add('hidden');
  clearSubtitleTrack();
  renderAllWaveforms();
  renderPlaybackMarkers();
  renderPlaybackChapterSidebar();
  renderPlaybackProcessingStatus();
  renderSpeakerCorrectionPanel();
  const video = $('playbackVideo');
  video.pause();
  video.removeAttribute('src');
  video.load();
  const previewVideo = $('timelinePreviewVideo');
  if (previewVideo) { previewVideo.pause(); previewVideo.removeAttribute('src'); previewVideo.removeAttribute('data-pending-src'); previewVideo.load(); }
  hideTimelineHoverPreview();
  $('playbackEmpty').classList.remove('hidden');
  $('videoPlayerShell').classList.add('hidden');
  $('videoPlayerShell').classList.remove('media-loading', 'audio-only-player', 'video-player-mode');
  $('videoPlayerShell').style.removeProperty('--playback-aspect');
  $('playbackMediaLoading')?.classList.add('hidden');
  $('playbackDetails').classList.add('hidden');
  $('stickyPlaybackControls')?.classList.remove('is-visible');
  closePlaybackMoreMenu();
  if ($('waveformPlayhead')) $('waveformPlayhead').style.left = '0%';
  $('transcriptPanel').classList.add('hidden');
  $('playbackTranscriptPreview').classList.add('hidden');
  $('playerStatus').textContent = '';
  state.trimStart = 0;
  state.trimEnd = null;
}

async function moveRecordingToTrash(recording) {
  if (!recording) return;
  const confirmed = window.confirm(`Move “${recording.name}” to system Trash?\n\nThe recording and its TXT transcript file will move to Trash and can be restored there. Any legacy SRT sidecar from an older build moves with it.`);
  if (!confirmed) return;
  try {
    if (state.selectedPlaybackPath === recording.path) resetPlaybackSelection();
    const wasProcessing = state.transcribingPaths.has(recording.path);
    if (wasProcessing) showToast('Stopping local processing and moving clip to Trash…', 'warning', 2600);
    await window.recorderAPI.deleteRecording(recording.path);
    state.transcribingPaths.delete(recording.path);
    setRecordingFavorite(recording.path, false);
    await refreshRecordings();
    setStatus(`Moved ${recording.name} and its transcript files to system Trash.`);
    showToast('Moved to Trash');
  } catch (error) {
    setStatus(`Could not move the recording to Trash. ${friendlyErrorText(error)}`, true);
  }
}

function startInlineRename(recordingPath) {
  document.querySelectorAll('.recording-rename-editor').forEach((editor) => editor.classList.add('hidden'));
  const row = [...document.querySelectorAll('.recording-item')].find((item) => item.dataset.recordingPath === recordingPath);
  if (!row) return;
  const editor = row.querySelector('.recording-rename-editor');
  editor?.classList.remove('hidden');
  const input = row.querySelector('.recording-rename-input');
  input?.focus();
  input?.select();
}

function closeInlineRename(row) {
  row?.querySelector('.recording-rename-editor')?.classList.add('hidden');
}

async function commitInlineRename(recording, row) {
  const input = row?.querySelector('.recording-rename-input');
  if (!input) return;
  const requestedName = input.value.trim();
  if (!requestedName) return;
  const wasSelected = state.selectedPlaybackPath === recording.path;
  const wasSaved = state.savedPath === recording.path;
  try {
    const renamed = await window.recorderAPI.renameRecording(recording.path, requestedName);
    if (state.favoriteRecordingPaths.has(recording.path)) {
      state.favoriteRecordingPaths.delete(recording.path);
      state.favoriteRecordingPaths.add(renamed.path);
      persistFavoriteRecordingPaths();
    }
    if (wasSelected) state.selectedPlaybackPath = renamed.path;
    if (wasSaved) {
      state.savedPath = renamed.path;
      $('savedPath').textContent = renamed.path;
    }
    if (state.transcriptTargetPath === recording.path) state.transcriptTargetPath = renamed.path;
    await refreshRecordings();
    if (wasSelected) {
      const updated = state.recordings.find((item) => item.path === renamed.path);
      if (updated) await selectPlaybackRecording(updated);
    }
    showToast('Recording renamed');
  } catch (error) {
    setStatus(`Could not rename the recording. ${friendlyErrorText(error)}`, true);
    input.focus();
  }
}

function subtitleControlEnabled() {
  return $('playerSubtitleControl')?.getAttribute('aria-pressed') === 'true';
}

function setSubtitleControlEnabled(enabled) {
  const control = $('playerSubtitleControl');
  if (!control) return;
  control.setAttribute('aria-pressed', enabled ? 'true' : 'false');
}

function setSubtitleControlAvailable(available) {
  const control = $('playerSubtitleControl');
  if (!control) return;
  control.disabled = !available;
  if (!available) setSubtitleControlEnabled(false);
}

function updatePlaybackSubtitleControlState() {
  const control = $('playerSubtitleControl');
  if (!control) return;
  const available = !control.disabled && state.subtitleCues.length > 0;
  const enabled = available && subtitleControlEnabled();
  control.classList.toggle('cc-unavailable', !available);
  control.classList.toggle('cc-available', available && !enabled);
  control.classList.toggle('cc-enabled', enabled);
  const approximate = Boolean(state.subtitleTimingApproximate);
  control.title = !available
    ? 'Captions unavailable for this recording'
    : enabled
      ? `${approximate ? 'Transcript captions on (approximate timing)' : 'Captions on'} · click to hide`
      : `${approximate ? 'Transcript captions available (approximate timing)' : 'Captions available'} · click to show`;
  control.setAttribute('aria-label', !available ? 'Captions unavailable for this recording' : enabled ? 'Turn captions off' : 'Turn captions on');
}

function clearSubtitleTrack() {
  state.subtitleCues = [];
  state.subtitleTimingApproximate = false;
  state.playbackCueIndex = -1;
  setSubtitleControlEnabled(false);
  setSubtitleControlAvailable(false);
  const overlay = $('subtitleOverlay');
  if (overlay) {
    overlay.textContent = '';
    overlay.classList.add('hidden');
  }
  updatePlaybackSubtitleControlState();
}

function subtitleTimestampToSeconds(value) {
  const match = String(value || '').trim().match(/^(\d+):(\d+):(\d+)[,.](\d+)$/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(`0.${match[4].padEnd(3, '0').slice(0, 3)}`);
}

function parseSrtCues(srt) {
  const normalized = String(srt || '').replace(/\r/g, '').trim();
  if (!normalized) return [];
  const cues = [];
  for (const block of normalized.split(/\n{2,}/)) {
    const lines = block.split('\n').filter((line) => line.length);
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0) continue;
    const [rawStart, rawEnd] = lines[timingIndex].split('-->').map((part) => part.trim().split(/\s+/)[0]);
    const start = subtitleTimestampToSeconds(rawStart);
    const end = subtitleTimestampToSeconds(rawEnd);
    const text = lines.slice(timingIndex + 1).join('\n').trim();
    if (start == null || end == null || end <= start || !text) continue;
    cues.push({ start, end, text });
  }
  return cues.sort((a, b) => a.start - b.start);
}

function approximateSubtitleCuesFromTranscript(text, durationSeconds) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned || /^\[(?:No audio track was captured|No speech detected)\]/i.test(cleaned)) return [];
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) return [];

  const sentenceParts = cleaned.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [cleaned];
  const chunks = [];
  for (const sentence of sentenceParts) {
    const words = String(sentence || '').trim().split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i += 11) {
      const piece = words.slice(i, i + 11).join(' ').trim();
      if (piece) chunks.push(piece);
    }
  }
  if (!chunks.length) return [];
  const weights = chunks.map((chunk) => Math.max(1, chunk.split(/\s+/).length));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || chunks.length;
  let consumed = 0;
  return chunks.map((chunk, index) => {
    const start = (consumed / totalWeight) * duration;
    consumed += weights[index];
    const next = (consumed / totalWeight) * duration;
    const end = Math.min(duration, Math.max(start + 0.8, next));
    return { start, end, text: chunk };
  }).filter((cue) => cue.end > cue.start);
}

function updateSubtitleOverlay() {
  const overlay = $('subtitleOverlay');
  if (!overlay) return;
  if (!subtitleControlEnabled() || !state.subtitleCues.length) {
    overlay.textContent = '';
    overlay.classList.add('hidden');
    return;
  }
  const current = $('playbackVideo').currentTime || 0;
  const active = state.subtitleCues.find((cue) => current >= cue.start && current <= cue.end);
  if (!active) {
    overlay.textContent = '';
    overlay.classList.add('hidden');
    return;
  }
  overlay.textContent = active.text;
  overlay.classList.remove('hidden');
}

function attachSubtitleTrack(srt, show) {
  state.subtitleCues = parseSrtCues(srt);
  state.subtitleTimingApproximate = false;
  setSubtitleControlAvailable(state.subtitleCues.length > 0);
  setSubtitleControlEnabled(Boolean(show && state.subtitleCues.length));
  updateSubtitleOverlay();
  updatePlaybackSubtitleControlState();
}

function attachApproximateSubtitleTrack(text, durationSeconds, show) {
  if (state.subtitleCues.length) return true;
  const cues = approximateSubtitleCuesFromTranscript(text, durationSeconds);
  if (!cues.length) return false;
  state.subtitleCues = cues;
  state.subtitleTimingApproximate = true;
  setSubtitleControlAvailable(true);
  setSubtitleControlEnabled(Boolean(show));
  updateSubtitleOverlay();
  updatePlaybackSubtitleControlState();
  return true;
}

function updateTrimUi() {
  const video = $('playbackVideo');
  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : Math.max(1, Number(state.trimEnd) || 1);
  const end = state.trimEnd == null ? duration : clamp(state.trimEnd, 0, duration);
  state.trimStart = clamp(state.trimStart, 0, Math.max(0, end - 0.05));
  state.trimEnd = Math.max(state.trimStart + 0.05, end);
  $('trimStartValue').textContent = formatPreciseSeconds(state.trimStart);
  $('trimEndValue').textContent = formatPreciseSeconds(state.trimEnd);
  const startPct = clamp((state.trimStart / duration) * 100, 0, 100);
  const endPct = clamp((state.trimEnd / duration) * 100, 0, 100);
  $('trimSelectionFill').style.left = `${startPct}%`;
  $('trimSelectionFill').style.width = `${Math.max(0, endPct - startPct)}%`;
  $('trimStartHandle').style.left = `${startPct}%`;
  $('trimEndHandle').style.left = `${endPct}%`;
  const playPct = clamp(((video.currentTime || 0) / duration) * 100, 0, 100);
  $('trimPlayhead').style.left = `${playPct}%`;
}

function applyTrimZoom(value = state.trimZoom, keepPlayheadVisible = false) {
  state.trimZoom = clamp(Math.round(Number(value) || 1), 1, 12);
  localStorage.setItem('trimZoom', String(state.trimZoom));
  const shell = $('trimRangeShell');
  const viewport = $('trimZoomViewport');
  if (shell) shell.style.width = `${state.trimZoom * 100}%`;
  if ($('trimZoom')) $('trimZoom').value = String(state.trimZoom);
  if ($('trimZoomValue')) $('trimZoomValue').textContent = `${state.trimZoom}×`;
  requestAnimationFrame(() => {
    renderAllWaveforms();
    if (keepPlayheadVisible && viewport && shell) {
      const video = $('playbackVideo');
      const duration = Number(video?.duration) || 0;
      if (duration > 0) viewport.scrollLeft = Math.max(0, ((video.currentTime || 0) / duration) * shell.scrollWidth - viewport.clientWidth / 2);
    }
  });
}

function maybeSnapTrimSeconds(seconds) {
  if (!state.trimSnapSilence || !$('trimSnapSilence')?.checked || !window.PulseStudioTrimTools) return seconds;
  const video = $('playbackVideo');
  const duration = Number(video?.duration) || 0;
  if (!duration || !state.waveformSamples?.length) return seconds;
  return window.PulseStudioTrimTools.snapToQuiet(state.waveformSamples, duration, seconds, state.trimZoom >= 6 ? 0.8 : state.trimZoom >= 3 ? 1.2 : 2.0);
}

function trimSecondsFromClientX(clientX) {
  const shell = $('trimRangeShell');
  const video = $('playbackVideo');
  if (!shell || !Number.isFinite(video.duration) || video.duration <= 0) return null;
  const rect = shell.getBoundingClientRect();
  if (!rect.width) return null;
  return clamp((clientX - rect.left) / rect.width, 0, 1) * video.duration;
}

function setTrimBoundary(which, seconds, seekVideo = true, snapToSilence = true) {
  const video = $('playbackVideo');
  if (!Number.isFinite(video.duration) || video.duration <= 0 || !Number.isFinite(seconds)) return;
  if (snapToSilence) seconds = maybeSnapTrimSeconds(seconds);
  if (which === 'start') {
    const end = state.trimEnd == null ? video.duration : state.trimEnd;
    state.trimStart = clamp(seconds, 0, Math.max(0, end - 0.05));
    if (seekVideo) video.currentTime = state.trimStart;
  } else {
    state.trimEnd = clamp(seconds, state.trimStart + 0.05, video.duration);
    if (seekVideo) video.currentTime = state.trimEnd;
  }
  updateTrimUi();
}

function beginTrimDrag(which, event) {
  event.preventDefault();
  event.stopPropagation();
  state.trimDragHandle = which;
  event.currentTarget.setPointerCapture?.(event.pointerId);
  const seconds = trimSecondsFromClientX(event.clientX);
  if (seconds != null) setTrimBoundary(which, seconds, true, false);
}

function moveTrimDrag(event) {
  if (!state.trimDragHandle) return;
  const seconds = trimSecondsFromClientX(event.clientX);
  if (seconds != null) setTrimBoundary(state.trimDragHandle, seconds, true, false);
}

function endTrimDrag(event) {
  if (!state.trimDragHandle) return;
  const which = state.trimDragHandle;
  try { event.currentTarget.releasePointerCapture?.(event.pointerId); } catch {}
  state.trimDragHandle = null;
  const value = which === 'start' ? state.trimStart : state.trimEnd;
  if (Number.isFinite(value)) setTrimBoundary(which, value, true, true);
}

async function selectPlaybackRecording(recording) {
  window.recorderAPI.logEvent?.('info', 'playback.recording-selected', { durationSeconds: Number(recording?.durationSeconds || 0), recordingKind: recording?.kind || recording?.recordingKind || '' });
  closeBookmarkInlineEditor({ resume: false });
  const selectionToken = ++state.playbackSelectionToken;
  state.selectedPlaybackPath = recording.path;
  state.currentWorkspace = 'playback';
  renderPlaybackProcessingStatus();
  if ($('transcriptSearch')) $('transcriptSearch').value = '';
  if ($('transcriptSearchResults')) { $('transcriptSearchResults').innerHTML = ''; $('transcriptSearchResults').classList.add('hidden'); }
  state.transcriptSearchMatches = [];
  state.transcriptSearchPosition = -1;
  state.transcriptActiveCueIndex = -1;
  state.playbackCueIndex = -1;
  updateTranscriptSearchNavigation();
  $('clearTranscriptSearch')?.classList.add('hidden');
  if ($('transcriptCueList')) $('transcriptCueList').innerHTML = '';
  if ($('transcriptSpeakerList')) $('transcriptSpeakerList').innerHTML = '';
  if ($('transcriptRawView')) $('transcriptRawView').innerHTML = '';
  state.speakerSegments = []; state.speakerCount = 0; state.speakerDefinitions = []; state.speakerRecordingPath = null; state.speakerLoading = false; state.speakerError = '';
  if ($('speakerDetectionStatus')) $('speakerDetectionStatus').textContent = 'Speaker view clusters recurring voices locally.';
  renderRecordings();

  const video = $('playbackVideo');
  clearSubtitleTrack();
  video.pause();

  $('playbackEmpty').classList.add('hidden');
  const playerShell = $('videoPlayerShell');
  const audioOnlyPlayback = recording.mediaType === 'audio';
  // Commit the new media type before changing the element source. This prevents a
  // previous audio-only selection (or the empty video's intrinsic 0×0 size) from
  // flashing for one frame while a video selection starts loading.
  playerShell.classList.toggle('audio-only-player', audioOnlyPlayback);
  playerShell.classList.toggle('video-player-mode', !audioOnlyPlayback);
  playerShell.classList.toggle('media-loading', !audioOnlyPlayback);
  playerShell.classList.remove('hidden');
  $('playbackMediaLoading')?.classList.toggle('hidden', audioOnlyPlayback);
  if ($('playbackMediaLoadingText')) $('playbackMediaLoadingText').textContent = audioOnlyPlayback ? 'Loading audio…' : 'Loading video…';
  video.setAttribute('aria-busy', audioOnlyPlayback ? 'false' : 'true');
  video.dataset.selectionToken = String(selectionToken);
  delete video.dataset.enhancementsToken;
  $('playbackDetails').classList.remove('hidden');
  $('transcriptPanel').classList.remove('hidden');
  $('audioOnlyPlayerState')?.classList.toggle('hidden', !audioOnlyPlayback);
  if ($('audioOnlyPlayerTitle')) $('audioOnlyPlayerTitle').textContent = recording.name || 'Audio recording';
  if ($('audioOnlyPlayerMeta')) $('audioOnlyPlayerMeta').textContent = `${formatDuration(recording.durationSeconds, 'Loading…')} · Audio-only recording`;
  $('snapshotPlayback').disabled = audioOnlyPlayback;
  $('snapshotPlayback').classList.toggle('hidden', audioOnlyPlayback);
  $('snapshotPlayback').title = audioOnlyPlayback ? 'Snapshots are unavailable for audio-only recordings' : 'Save snapshot of current frame';
  $('playbackFullscreen').classList.toggle('hidden', audioOnlyPlayback);

  const separator = recording.url.includes('?') ? '&' : '?';
  const selectionUrl = `${recording.url}${separator}selection=${selectionToken}`;
  playerShell.style.setProperty('--playback-aspect', '16 / 9');
  video.dataset.selectionToken = String(selectionToken);
  video.src = selectionUrl;
  video.playbackRate = state.playbackSpeedValue;
  video.volume = state.playbackVolume;
  // Assigning src starts loading; an extra empty load() cycle here used to expose
  // the compact/audio-shaped viewport before Chromium discovered the video frame.
  video.load();
  const timelinePreviewVideo = $('timelinePreviewVideo');
  if (timelinePreviewVideo) {
    timelinePreviewVideo.pause();
    timelinePreviewVideo.removeAttribute('src');
    timelinePreviewVideo.removeAttribute('data-pending-src');
    timelinePreviewVideo.load();
    if (recording.mediaType !== 'audio') {
      // Do not make a second read/decoder compete with the main player during
      // selection. The hover-preview source is attached only when the user first
      // asks for a timeline preview.
      timelinePreviewVideo.dataset.pendingSrc = `${recording.url}${separator}preview=${selectionToken}`;
    }
    state.timelinePreviewLastSeek = -1;
  }
  hideTimelineHoverPreview();

  $('playbackFileName').textContent = recording.name;
  if ($('playbackMediaBadge')) $('playbackMediaBadge').textContent = recording.mediaType === 'audio' ? 'Audio' : 'Video';
  if ($('playbackSizeBadge')) $('playbackSizeBadge').textContent = formatBytes(recording.size);
  $('playbackDurationBadge').textContent = formatDuration(recording.durationSeconds, 'Loading…');
  $('playbackTotalTime').textContent = formatDuration(recording.durationSeconds, 'Loading…');
  $('playbackCurrentTime').textContent = '00:00:00';
  setPlayerIcon('playPausePlayback', 'play', 'Play (Space)');
  state.playbackTranscript = { text: '', srt: '' };
  state.playbackInsights = { overview: '', chapters: [], summaryBullets: [], actionItems: [] };
  state.insightsLoading = false;
  $('insightsStatus').textContent = 'Waiting for transcript…';
  renderPlaybackInsights();
  $('subtitleBadge').textContent = 'Loading transcript…';
  $('subtitleBadge').classList.remove('ready');
  setSubtitleControlEnabled(false);
  setSubtitleControlAvailable(false);
  updatePlaybackSubtitleControlState();
  $('openPlaybackTranscript').disabled = true;
  $('copyPlaybackTranscript').disabled = true;
  $('transcriptText').value = '';
  state.localSrt = '';
  state.transcriptTxtPath = '';
  state.transcriptSrtPath = '';
  $('transcriptStatus').textContent = 'Loading transcript for the selected clip…';
  updateTranscriptActions();
  $('renamePlaybackFile').disabled = state.transcribingPaths.has(recording.path);
  $('playbackTranscriptPreview').classList.add('hidden');
  $('openPlaybackTranscript').textContent = 'Transcript';
  $('trimStatus').textContent = '';
  $('playerStatus').textContent = '';
  $('playbackProgress').value = '0';
  state.trimStart = 0;
  state.trimEnd = recording.durationSeconds || null;
  state.editCuts = [];
  updateTrimUi();
  renderEditCuts();
  updatePlaybackClipNavigation();
  setTranscriptTarget(recording.path);

  window.recorderAPI.setActiveRecording(recording.path).catch(() => {});
  if (audioOnlyPlayback) loadPlaybackEnhancements(recording.path, selectionToken).catch(() => {});

  try {
    const transcript = await window.recorderAPI.getRecordingTranscript(recording.path);
    if (selectionToken !== state.playbackSelectionToken || state.selectedPlaybackPath !== recording.path) return;
    const hasTranscript = Boolean(transcript.text || transcript.srt);
    const needsRefresh = Boolean(transcript.needsRefresh);
    if (needsRefresh) {
      // Keep an existing transcript usable while a better pass runs. In particular,
      // captions should not disappear just because transcript quality verification
      // decided to refresh the text in the background.
      state.playbackTranscript = transcript;
      $('subtitleBadge').textContent = 'Transcript available · refreshing…';
      $('subtitleBadge').classList.add('ready');
      $('openPlaybackTranscript').disabled = !transcript.text;
      $('copyPlaybackTranscript').disabled = !transcript.text;
      $('playbackTranscriptPreview').textContent = transcript.text || '';
      attachSubtitleTrack(transcript.srt, state.subtitlePreference);
      if (!state.subtitleCues.length && transcript.text) {
        attachApproximateSubtitleTrack(transcript.text, recording.durationSeconds, state.subtitlePreference);
      }
      updatePlaybackSubtitleControlState();
      loadTranscriptIntoPanel(recording.path, transcript, true);
      $('transcriptStatus').textContent = 'The saved transcript is usable now. A higher-quality pass is running in the background.';
      if (!state.transcribingPaths.has(recording.path)) runAutomaticTranscription(recording.path, false, true);
    } else {
      state.playbackTranscript = transcript;
      $('subtitleBadge').textContent = hasTranscript ? 'Transcript available' : 'No transcript';
      $('subtitleBadge').classList.toggle('ready', hasTranscript);
      $('openPlaybackTranscript').disabled = !transcript.text;
      $('copyPlaybackTranscript').disabled = !transcript.text;
      $('playbackTranscriptPreview').textContent = transcript.text || '';
      attachSubtitleTrack(transcript.srt, state.subtitlePreference);
      if (!state.subtitleCues.length && transcript.text) {
        attachApproximateSubtitleTrack(transcript.text, recording.durationSeconds, state.subtitlePreference);
      }
      updatePlaybackSubtitleControlState();
      loadTranscriptIntoPanel(recording.path, transcript, false);
      if (hasTranscript) {
        loadPlaybackSpeakers(recording.path, selectionToken, false).catch(() => {});
        loadPlaybackInsights(recording.path, selectionToken, false).catch(() => {});
      }
      if (!hasTranscript && !state.transcribingPaths.has(recording.path)) runAutomaticTranscription(recording.path, false);
    }
  } catch (error) {
    if (selectionToken !== state.playbackSelectionToken || state.selectedPlaybackPath !== recording.path) return;
    state.playbackTranscript = { text: '', srt: '' };
    $('subtitleBadge').textContent = 'Transcript error';
    $('subtitleBadge').classList.remove('ready');
    setSubtitleControlAvailable(false);
    updatePlaybackSubtitleControlState();
    $('openPlaybackTranscript').disabled = true;
    $('copyPlaybackTranscript').disabled = true;
    clearSubtitleTrack();
    $('transcriptStatus').textContent = friendlyErrorText(error);
  }
}

function visiblePlaybackRecordings() {
  const filter = state.categoryFilter || '__all__';
  let recordings = filter === '__all__'
    ? state.recordings
    : state.recordings.filter((item) => (item.category || 'Uncategorized') === filter);
  recordings = recordings.filter(recordingMatchesQuickFilter);
  if (state.librarySearch) recordings = recordings.filter((item) => state.librarySearchMatches.has(item.path));
  return recordings;
}

function selectedPlaybackIndex() {
  return visiblePlaybackRecordings().findIndex((item) => item.path === state.selectedPlaybackPath);
}

function updatePlaybackClipNavigation() {
  const recordings = visiblePlaybackRecordings();
  const index = recordings.findIndex((item) => item.path === state.selectedPlaybackPath);
  $('previousClip').disabled = index < 0 || index >= recordings.length - 1;
  $('nextClip').disabled = index <= 0;
}

async function selectPlaybackRelative(direction) {
  const recordings = visiblePlaybackRecordings();
  const index = recordings.findIndex((item) => item.path === state.selectedPlaybackPath);
  if (index < 0) return;
  const target = recordings[index + direction];
  if (target) await selectPlaybackRecording(target);
}

function seekPlayback(deltaSeconds) {
  const video = $('playbackVideo');
  if (!state.selectedPlaybackPath || !Number.isFinite(video.duration) || video.duration <= 0) return;
  const base = Number.isFinite(state.pendingSeekTarget) ? state.pendingSeekTarget : (video.currentTime || 0);
  const target = clamp(base + Number(deltaSeconds || 0), 0, video.duration);
  state.pendingSeekTarget = target;
  video.currentTime = target;
  updatePlaybackClock();
  clearTimeout(state.seekResetTimer);
  state.seekResetTimer = setTimeout(() => { state.pendingSeekTarget = null; }, 220);
}

function pulsePlayerControl(button) {
  if (!button) return;
  button.classList.remove('control-pulse');
  void button.offsetWidth;
  button.classList.add('control-pulse');
  setTimeout(() => button.classList.remove('control-pulse'), 150);
}

async function togglePlayback() {
  const video = $('playbackVideo');
  if (!state.selectedPlaybackPath) return;
  if (video.paused) {
    try { await video.play(); } catch (error) { $('playerStatus').textContent = `Could not start playback. ${friendlyErrorText(error)}`; }
  } else video.pause();
}

function setPlayerFullscreenUi(fullscreen) {
  state.playerFullscreen = Boolean(fullscreen);
  document.body.classList.toggle('player-fullscreen', state.playerFullscreen);
  $('playbackFullscreen').title = state.playerFullscreen ? 'Exit full screen' : 'Full screen';
  $('playbackFullscreen').setAttribute('aria-label', $('playbackFullscreen').title);
}

function updatePlaybackClock() {
  const video = $('playbackVideo');
  const current = video.currentTime || 0;
  $('playbackCurrentTime').textContent = formatDuration(current, '00:00');
  const total = Number.isFinite(video.duration) ? video.duration : null;
  $('playbackTotalTime').textContent = formatDuration(total, 'Loading…');
  if (Number.isFinite(total) && total > 0) {
    $('playbackDurationBadge').textContent = formatDuration(total);
    if ($('audioOnlyPlayerMeta') && $('videoPlayerShell')?.classList.contains('audio-only-player')) $('audioOnlyPlayerMeta').textContent = `${formatDuration(current, '00:00')} / ${formatDuration(total, '00:00')} · Audio-only recording`;
    const progress = clamp(current / total, 0, 1);
    $('playbackProgress').value = String(Math.round(progress * 1000));
    if ($('waveformPlayhead')) $('waveformPlayhead').style.left = `${progress * 100}%`;
    if ($('stickyPlaybackTime')) $('stickyPlaybackTime').textContent = `${formatDuration(current, '00:00')} / ${formatDuration(total, '00:00')}`;
  } else {
    $('playbackProgress').value = '0';
    if ($('waveformPlayhead')) $('waveformPlayhead').style.left = '0%';
    if ($('stickyPlaybackTime')) $('stickyPlaybackTime').textContent = '00:00 / 00:00';
  }
  if ($('stickyPlayPause')) $('stickyPlayPause').textContent = video.paused ? '▶' : '❚❚';
  updateSubtitleOverlay();
  updatePlaybackSubtitleControlState();
  updatePlaybackBookmarkOverlay(current);
  updatePlaybackBookmarkNavigation();
  updateTranscriptCuePlaybackHighlight();
  updateTrimUi();
}

function renderSpeakerCorrectionPanel() {
  const panel = $('speakerCorrectionPanel');
  if (!panel) return;
  const speakers = state.speakerRecordingPath === state.selectedPlaybackPath && Array.isArray(state.speakerDefinitions) ? state.speakerDefinitions : [];
  panel.classList.toggle('hidden', !state.selectedPlaybackPath || speakers.length < 1);
  if (!speakers.length) { panel.innerHTML = ''; return; }
  const rows = speakers.map((entry) => {
    const colorClass = window.PulseStudioSpeakerTools?.className(entry.speaker) || '';
    const options = speakers.filter((other) => other.speaker !== entry.speaker).map((other) => `<option value="${escapeHtml(other.speaker)}">${escapeHtml(other.name || other.speaker)}</option>`).join('');
    return `<div class="speaker-correction-row ${colorClass}" data-speaker="${escapeHtml(entry.speaker)}">
      <span class="speaker-identity"><span class="speaker-swatch" style="background:var(--speaker-color)"></span><strong>${escapeHtml(entry.speaker)}</strong></span>
      <input class="speaker-name-input" type="text" maxlength="80" value="${escapeHtml(entry.name === entry.speaker ? '' : entry.name)}" placeholder="Name, e.g. John" aria-label="Name for ${escapeHtml(entry.speaker)}" />
      <button class="button secondary tiny speaker-name-save" type="button">Save name</button>
      <select class="speaker-merge-select" aria-label="Merge ${escapeHtml(entry.speaker)} into another speaker"><option value="">Merge into…</option>${options}</select>
      <button class="button secondary tiny speaker-merge-button" type="button" ${options ? '' : 'disabled'}>Merge</button>
    </div>`;
  }).join('');
  panel.innerHTML = `<div class="speaker-correction-heading"><span class="knowledge-collapse-copy"><strong>Speaker corrections</strong><span>Rename or merge labels. Transcript text stays read-only.</span></span><button class="knowledge-collapse-action-button" id="speakerCorrectionsToggle" type="button" aria-expanded="${String(!state.speakerCorrectionsCollapsed)}" aria-controls="speakerCorrectionsContent" aria-label="${state.speakerCorrectionsCollapsed ? 'Expand' : 'Collapse'} Speaker corrections" title="${state.speakerCorrectionsCollapsed ? 'Expand' : 'Collapse'} Speaker corrections"><span class="knowledge-collapse-label">${state.speakerCorrectionsCollapsed ? 'Expand' : 'Collapse'}</span><span class="knowledge-collapse-chevron" aria-hidden="true">${state.speakerCorrectionsCollapsed ? '⌄' : '⌃'}</span></button></div><div id="speakerCorrectionsContent" class="speaker-correction-content ${state.speakerCorrectionsCollapsed ? 'hidden' : ''}">${rows}</div>`;
  panel.querySelector('#speakerCorrectionsToggle')?.addEventListener('click', () => {
    state.speakerCorrectionsCollapsed = !state.speakerCorrectionsCollapsed;
    applyKnowledgeCollapse('speakerCorrectionsToggle', 'speakerCorrectionsContent', state.speakerCorrectionsCollapsed, 'speakerCorrectionsCollapsed', true);
  });
  panel.querySelectorAll('.speaker-correction-row').forEach((row) => {
    const speaker = row.dataset.speaker;
    const save = async () => {
      try {
        const result = await window.recorderAPI.setRecordingSpeakerName(state.selectedPlaybackPath, speaker, row.querySelector('.speaker-name-input')?.value || '');
        state.speakerSegments = Array.isArray(result?.segments) ? result.segments : [];
        state.speakerDefinitions = Array.isArray(result?.speakers) ? result.speakers : [];
        state.speakerCount = Number(result?.speakerCount) || 0;
        renderSpeakerCorrectionPanel(); renderTranscriptCueList(); renderPlaybackMarkers(); renderAllWaveforms();
        $('speakerDetectionStatus').textContent = 'Speaker name correction saved locally.';
        showToast('Speaker name updated');
      } catch (error) { $('speakerDetectionStatus').textContent = `Could not save the speaker name. ${friendlyErrorText(error)}`; }
    };
    row.querySelector('.speaker-name-save')?.addEventListener('click', save);
    row.querySelector('.speaker-name-input')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') save(); });
    row.querySelector('.speaker-merge-button')?.addEventListener('click', async () => {
      const target = row.querySelector('.speaker-merge-select')?.value;
      if (!target) return;
      const targetLabel = state.speakerDefinitions.find((item) => item.speaker === target)?.name || target;
      try {
        const result = await window.recorderAPI.mergeRecordingSpeakers(state.selectedPlaybackPath, speaker, target);
        state.speakerSegments = Array.isArray(result?.segments) ? result.segments : [];
        state.speakerDefinitions = Array.isArray(result?.speakers) ? result.speakers : [];
        state.speakerCount = Number(result?.speakerCount) || 0;
        renderSpeakerCorrectionPanel(); renderTranscriptCueList(); renderPlaybackMarkers(); renderAllWaveforms();
        $('speakerDetectionStatus').textContent = `Merged ${speaker} into ${targetLabel}.`;
        showToast('Speaker labels merged');
      } catch (error) { $('speakerDetectionStatus').textContent = `Could not merge those speakers. ${friendlyErrorText(error)}`; }
    });
  });
}

async function loadPlaybackSpeakers(recordingPath, selectionToken, force = false) {
  window.recorderAPI.logEvent?.('info', 'ai.speaker-detection-started', { force: Boolean(force) });
  state.speakerSegments = [];
  state.speakerCount = 0;
  state.speakerDefinitions = [];
  state.speakerRecordingPath = null;
  state.speakerLoading = true;
  state.speakerError = '';
  const status = $('speakerDetectionStatus');
  if (status) status.textContent = 'Detecting speakers locally…';
  renderTranscriptCueList();
  try {
    const result = force
      ? await window.recorderAPI.regenerateRecordingSpeakers(recordingPath)
      : await window.recorderAPI.getRecordingSpeakers(recordingPath);
    if (selectionToken !== state.playbackSelectionToken || recordingPath !== state.selectedPlaybackPath) return;
    state.speakerSegments = Array.isArray(result?.segments) ? result.segments : [];
    state.speakerCount = Number(result?.speakerCount) || 0;
    state.speakerDefinitions = Array.isArray(result?.speakers) ? result.speakers : [];
    state.speakerRecordingPath = recordingPath;
    state.speakerError = '';
    window.recorderAPI.logEvent?.('info', 'ai.speaker-detection-completed', { force: Boolean(force), speakerCount: state.speakerCount });
    if (status) status.textContent = state.speakerCount > 1
      ? `${state.speakerCount} recurring voices detected in this recording.`
      : state.speakerCount === 1 ? '1 recurring voice detected.' : 'No distinct speakers detected.';
  } catch (error) {
    if (selectionToken !== state.playbackSelectionToken || recordingPath !== state.selectedPlaybackPath) return;
    state.speakerSegments = [];
    state.speakerCount = 0;
    state.speakerDefinitions = [];
    state.speakerRecordingPath = null;
    state.speakerError = friendlyErrorText(error);
    window.recorderAPI.logEvent?.('error', 'ai.speaker-detection-failed', { force: Boolean(force), errorName: error?.name || 'Error' });
    if (status) status.textContent = 'Speaker detection unavailable; showing paragraph grouping.';
  } finally {
    if (selectionToken === state.playbackSelectionToken && recordingPath === state.selectedPlaybackPath) {
      state.speakerLoading = false;
      renderSpeakerCorrectionPanel();
      renderTranscriptCueList();
      renderPlaybackMarkers();
      renderAllWaveforms();
    }
  }
}

function loadTranscriptIntoPanel(recordingPath, transcript, preserveStatus = true) {
  setTranscriptTarget(recordingPath);
  $('transcriptText').value = transcript.text || '';
  state.localSrt = transcript.srt || '';
  state.transcriptTxtPath = transcript.txtPath || '';
  state.transcriptSrtPath = transcript.srtPath || '';
  if (!preserveStatus) {
    $('transcriptStatus').textContent = transcript.text ? '' : 'Transcript is not ready yet.';
  }
  updateTranscriptActions();
  renderTranscriptSearchResults();
  renderTranscriptCueList();
}

async function loadAudioDevices(requestPermission = false) {
  try {
    if (requestPermission) {
      await window.recorderAPI.requestMicrophonePermission();
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      probe.getTracks().forEach((track) => track.stop());
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices.filter((d) => d.kind === 'audioinput');
    const current = $('microphoneDevice').value;
    const preferred = localStorage.getItem('microphoneDevice') || 'default';
    $('microphoneDevice').innerHTML = '<option value="default">System default</option>' + mics.map((mic) =>
      `<option value="${escapeHtml(mic.deviceId)}">${escapeHtml(mic.label || 'Microphone')}</option>`
    ).join('');
    const candidate = current && current !== 'default' ? current : preferred;
    if ([...$('microphoneDevice').options].some((o) => o.value === candidate)) $('microphoneDevice').value = candidate;
    else $('microphoneDevice').value = 'default';
  } catch (error) {
    setStatus(`Microphone is unavailable. ${friendlyErrorText(error)}`, true);
  }
}


function setRecordAudioMeter(rowId, fillId, labelId, percent, label, tone = '') {
  const row = $(rowId);
  const fill = $(fillId);
  const labelNode = $(labelId);
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
  if (fill) fill.style.width = `${safePercent}%`;
  if (labelNode) labelNode.textContent = label;
  if (row) {
    row.classList.remove('low', 'good', 'high', 'muted', 'live');
    if (tone) row.classList.add(tone);
  }
}

function setCompactActivityMeter(kind, percent, label) {
  const isMic = kind === 'mic';
  const fill = $(isMic ? 'compactMicActivity' : 'compactSystemActivity');
  const labelNode = $(isMic ? 'compactMicActivityLabel' : 'compactSystemActivityLabel');
  const meter = fill?.closest?.('.compact-live-meter') || null;
  const safePercent = clamp(Number(percent) || 0, 0, 100);
  const normalizedLabel = String(label || '');
  const isPaused = normalizedLabel === 'Paused';
  const isLive = Boolean(normalizedLabel) && normalizedLabel !== 'Off' && !isPaused;
  if (fill) fill.style.width = `${safePercent}%`;
  if (labelNode) labelNode.textContent = normalizedLabel;
  meter?.classList.toggle('is-live', isLive);
  meter?.classList.toggle('has-signal', isLive && safePercent >= 1);
  meter?.classList.toggle('is-paused', isPaused);
}

function analyserDbfs(analyser, buffer = null) {
  if (!analyser) return { db: -100, percent: 0 };
  const data = buffer && buffer.length === analyser.fftSize ? buffer : new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(data);
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < data.length; i += 1) {
    const sample = Math.abs(data[i]);
    sum += sample * sample;
    if (sample > peak) peak = sample;
  }
  const rms = Math.sqrt(sum / Math.max(1, data.length));
  const db = 20 * Math.log10(Math.max(rms, 0.00001));
  const peakDb = 20 * Math.log10(Math.max(peak, 0.00001));
  // Keep health decisions based on RMS dB, but make the visual meter responsive
  // to short system-audio peaks as well. This prevents real system activity from
  // looking permanently disabled/grey when the RMS level is modest.
  const visualDb = Math.max(db, peakDb - 10);
  const percent = Math.max(0, Math.min(100, ((visualDb + 72) / 64) * 100));
  return { db, percent };
}

function micHealthForDb(db) {
  if (db > -8) return { label: 'Too loud', tone: 'high' };
  if (db >= -46) return { label: 'Good', tone: 'good' };
  return { label: 'Low', tone: 'low' };
}

function stopPreflightMicMonitor(resetUi = true) {
  state.preflightMicToken += 1;
  cancelAnimationFrame(state.preflightMicMeterHandle);
  state.preflightMicMeterHandle = null;
  state.preflightMicStream?.getTracks?.().forEach((track) => track.stop());
  state.preflightMicStream = null;
  if (state.preflightMicContext) state.preflightMicContext.close().catch(() => {});
  state.preflightMicContext = null;
  state.preflightMicAnalyser = null;
  if (resetUi) {
    if (!$('microphone')?.checked) {
      state.preflightMicHealth = 'Off';
      setRecordAudioMeter('preflightMicRow', 'preflightMicMeter', 'preflightMicLevel', 0, 'Off', 'muted');
    } else {
      state.preflightMicHealth = 'Paused';
      setRecordAudioMeter('preflightMicRow', 'preflightMicMeter', 'preflightMicLevel', 0, 'Paused', 'muted');
    }
    updateRecordReadySummary();
  }
}

async function refreshPreflightMicMonitor() {
  // v0.2.95: the Full View microphone control is a recording preference, not a
  // continuous pre-recording monitor. Keeping getUserMedia() open here caused
  // macOS to show its microphone-in-use indicator even though recording had not
  // started. The live microphone stream is now opened only by startRecording().
  stopPreflightMicMonitor(false);
  const token = ++state.preflightMicToken;
  if (!$('microphone')?.checked) {
    state.preflightMicHealth = 'Off';
    setRecordAudioMeter('preflightMicRow', 'preflightMicMeter', 'preflightMicLevel', 0, 'Off', 'muted');
    updateRecordReadySummary();
    return;
  }
  if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') return;
  if (state.currentWorkspace !== 'capture' || state.viewMode === 'compact' || state.isStarting || state.isStopping) {
    state.preflightMicHealth = 'On';
    setRecordAudioMeter('preflightMicRow', 'preflightMicMeter', 'preflightMicLevel', 0, 'On', 'live');
    updateRecordReadySummary();
    return;
  }
  const info = await window.recorderAPI.getReadiness().catch(() => null);
  if (token !== state.preflightMicToken) return;
  if (info?.microphone === 'denied' || info?.microphone === 'restricted') {
    state.preflightMicHealth = 'Permission';
    setRecordAudioMeter('preflightMicRow', 'preflightMicMeter', 'preflightMicLevel', 0, 'Permission', 'high');
  } else {
    // A not-yet-determined permission is intentionally not requested here. macOS
    // will ask only when the user actually starts a recording with Mic enabled.
    state.preflightMicHealth = 'On';
    setRecordAudioMeter('preflightMicRow', 'preflightMicMeter', 'preflightMicLevel', 0, 'On', 'live');
  }
  updateRecordReadySummary();
}

function updatePreflightSystemIdleState() {
  if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') return;
  if (!$('systemAudio')?.checked) {
    setRecordAudioMeter('preflightSystemRow', 'preflightSystemMeter', 'preflightSystemLevel', 0, 'Off', 'muted');
    return;
  }
  const mode = $('computerAudioMode')?.value === 'application' ? 'App ready' : 'Ready';
  setRecordAudioMeter('preflightSystemRow', 'preflightSystemMeter', 'preflightSystemLevel', 0, mode, 'muted');
}

function updateRecordReadySummary() {
  const target = $('recordReadySummaryLine');
  const textTarget = $('recordReadySummaryText');
  const icon = $('recordReadySummaryIcon');
  if (!target || !textTarget) return;
  const audioOnly = recordingKindValue() === 'audio';
  const mode = $('captureMode')?.value || 'source';
  let capture = 'Source';
  if (audioOnly && !$('systemAudio')?.checked) capture = 'Audio only';
  else if (mode === 'all') capture = 'All displays';
  else if (mode === 'region') capture = state.regionNormalized ? 'Region ready' : 'Region';
  else capture = selectedSource()?.name || 'Choose source';
  const mic = $('microphone')?.checked ? `Mic ${state.preflightMicHealth || 'on'}` : 'Mic off';
  const system = $('systemAudio')?.checked ? ($('computerAudioMode')?.value === 'application' ? 'App audio' : 'System audio') : 'System audio off';
  const qualityValue = $('quality')?.value || '1080';
  const qualityLabel = qualityValue === 'native' ? 'Native' : `${qualityValue}p`;
  const quality = audioOnly ? 'M4A' : `${qualityLabel} · ${frameRateValue()} FPS · ${videoCodecValue() === 'h265' ? 'H.265' : 'H.264'}`;
  let size = '';
  if (window.PulseStudioEstimate) {
    const bytes = window.PulseStudioEstimate.estimateBytesPerHour({
      recordingKind: audioOnly ? 'audio' : 'video',
      videoBitrate: recordingVideoBitrate(),
      codec: videoCodecValue(),
      microphone: Boolean($('microphone')?.checked),
      computerAudio: Boolean($('systemAudio')?.checked)
    });
    size = `~${formatBytes(bytes)}/hour`;
  }
  const warningText = $('readinessWarningText')?.textContent?.trim() || '';
  const readiness = $('readinessSummary');
  const tone = readiness?.classList.contains('error') ? 'error' : readiness?.classList.contains('warn') ? 'warn' : 'ready';
  target.classList.remove('ready', 'warn', 'error');
  target.classList.add(tone);
  if (tone !== 'ready' && warningText) {
    textTarget.textContent = warningText;
    if (icon) icon.textContent = '!';
  } else {
    textTarget.textContent = [capture, mic, system, quality, size].filter(Boolean).join('  ·  ');
    if (icon) icon.textContent = '✓';
  }
  target.title = textTarget.textContent;
}

async function loadCameraDevices(requestPermission = false) {
  try {
    if (requestPermission) {
      await window.recorderAPI.requestCameraPermission();
      const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      probe.getTracks().forEach((track) => track.stop());
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter((d) => d.kind === 'videoinput');
    const current = $('cameraDevice')?.value || 'default';
    if ($('cameraDevice')) {
      $('cameraDevice').innerHTML = '<option value="default">System default</option>' + cameras.map((camera) =>
        `<option value="${escapeHtml(camera.deviceId)}">${escapeHtml(camera.label || 'Camera')}</option>`
      ).join('');
      if ([...$('cameraDevice').options].some((o) => o.value === current)) $('cameraDevice').value = current;
    }
  } catch (error) {
    setStatus(`Camera is unavailable. ${friendlyErrorText(error)}`, true);
  }
}

async function createWebcamStream() {
  if (!$('webcamOverlay')?.checked || recordingKindValue() === 'audio') return null;
  const selected = $('cameraDevice')?.value || 'default';
  const video = selected === 'default'
    ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } }
    : { deviceId: { exact: selected }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } };
  return navigator.mediaDevices.getUserMedia({ video, audio: false });
}

function frameRateValue() {
  const value = Number($('frameRate')?.value);
  return [15, 25, 30, 60].includes(value) ? value : 30;
}

function videoCodecValue() {
  return $('videoCodec')?.value === 'h265' ? 'h265' : 'h264';
}

function qualityTargetHeight() {
  const value = $('quality').value;
  if (value === '720') return 720;
  if (value === '1440') return 1440;
  if (value === 'native') return null;
  return 1080;
}

function outputDimensions(aspect, nativeWidth, nativeHeight) {
  const targetHeight = qualityTargetHeight();
  let width;
  let height;
  if (targetHeight) {
    height = targetHeight;
    width = targetHeight * aspect;
  } else {
    width = nativeWidth;
    height = nativeHeight;
  }
  const maxDimension = 7680;
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return { width: even(width * scale), height: even(height * scale) };
}

function chooseMimeType() {
  const candidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}


function chooseAudioMimeType() {
  const candidates = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

function chooseMicrophoneMimeType() {
  // Opus/WebM is preferred for the temporary microphone sidecar because it is
  // chunk-friendly and FFmpeg can recover it reliably after an interrupted recording.
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || chooseAudioMimeType();
}

function recordingKindValue() {
  return $('recordingKind')?.value === 'audio' ? 'audio' : 'video';
}

function syncQuickRecordingControls() {
  const audioOnly = recordingKindValue() === 'audio';
  const currentKind = audioOnly ? 'audio' : 'video';
  const recordingLocked = Boolean($('recordingKind')?.disabled);
  document.querySelectorAll('[data-recording-kind]').forEach((button) => {
    const selected = button.dataset.recordingKind === currentKind;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    if (button.classList.contains('compact-record-kind-button')) {
      button.disabled = recordingLocked;
      const label = button.dataset.recordingKind === 'audio' ? 'Audio Only' : 'Video + Audio';
      button.title = recordingLocked
        ? 'Recording mode is locked while recording'
        : selected ? `${label} selected` : `Switch to ${label}`;
    }
  });

  const webcamEnabled = Boolean($('webcamOverlay')?.checked);
  const webcamToggle = $('webcamQuickToggle');
  const webcamDetail = $('webcamQuickDetail');
  if (webcamToggle) {
    webcamToggle.disabled = audioOnly || recordingLocked;
    webcamToggle.classList.toggle('is-on', webcamEnabled && !audioOnly);
    webcamToggle.classList.toggle('is-unavailable', audioOnly);
    webcamToggle.setAttribute('aria-pressed', webcamEnabled && !audioOnly ? 'true' : 'false');
    webcamToggle.title = recordingLocked
      ? 'Recording settings are locked while recording'
      : audioOnly
        ? 'Webcam overlay is available with Video + Audio'
        : webcamEnabled ? 'Turn webcam overlay off' : 'Turn webcam overlay on';
  }
  if (webcamDetail) webcamDetail.textContent = audioOnly
    ? 'Available with Video + Audio'
    : webcamEnabled ? 'Camera will appear on the recording' : 'Add your camera on top of the recording';
}

function setRecordingKindFromQuickControl(kind) {
  const control = $('recordingKind');
  if (!control || control.disabled) return;
  const next = kind === 'audio' ? 'audio' : 'video';

  // Apply the active state synchronously on pointer activation so Mini View
  // never shows a white/hover-only intermediate state while the underlying
  // select change propagates through the rest of the recording setup UI.
  document.querySelectorAll('[data-recording-kind]').forEach((button) => {
    const selected = button.dataset.recordingKind === next;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });

  if (control.value === next) {
    syncQuickRecordingControls();
    return;
  }
  control.value = next;
  control.dispatchEvent(new Event('change', { bubbles: true }));
}

function syncPreflightMicMuteButton() {
  const button = $('preflightMicMuteButton');
  if (!button) return;
  const recordingActive = Boolean(state.mediaRecorder && state.mediaRecorder.state !== 'inactive');
  const micAvailable = state.recordingMicCanStart || recordingMicrophoneTracks().length > 0;
  const muted = recordingActive ? Boolean(state.recordingMicMuted) : !$('microphone')?.checked;
  const locked = recordingActive ? (!micAvailable || Boolean(state.recordingMicStarting)) : Boolean($('microphone')?.disabled);
  button.classList.toggle('is-muted', muted);
  button.disabled = locked;
  button.setAttribute('aria-pressed', muted ? 'true' : 'false');
  const label = locked ? 'Microphone unavailable' : muted ? 'Unmute microphone in PulseStudio' : 'Mute microphone in PulseStudio';
  button.setAttribute('aria-label', label);
  button.title = label;
}

function computerAudioModeValue() {
  if (!$('systemAudio')?.checked) return 'off';
  return $('computerAudioMode')?.value === 'application' ? 'application' : 'system';
}

function filenameTemplateForStyle(style = $('filenameStyle')?.value || 'friendly') {
  if (style === 'timestamp') return 'Screen_Recording_{datetime}';
  if (style === 'custom') return String($('filenameTemplate')?.value || localStorage.getItem('customFilenameTemplate') || 'Screen Recording {date} {time}');
  return 'Screen Recording {date} {time}';
}

function applyFilenameStyle(style, persist = true) {
  const value = ['friendly', 'timestamp', 'custom'].includes(style) ? style : 'friendly';
  if ($('filenameStyle')) $('filenameStyle').value = value;
  const row = $('filenameTemplateRow');
  const input = $('filenameTemplate');
  if (row) row.classList.toggle('hidden', value !== 'custom');
  if (input) {
    if (value === 'custom') input.value = localStorage.getItem('customFilenameTemplate') || input.value || 'Screen Recording {date} {time}';
    else input.value = filenameTemplateForStyle(value);
  }
  const help = $('filenameTemplateHelp');
  if (help) help.textContent = value === 'custom'
    ? 'Tokens: {date}, {time}, {datetime}, {source}, {mode}, {type}.'
    : value === 'timestamp'
      ? 'Uses a compact, sortable date/time name.'
      : 'Uses a friendly Screen Recording date/time name.';
  if (persist) localStorage.setItem('filenameStyle', value);
  previewFilenameTemplate();
}

function previewFilenameTemplate() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const source = selectedSource()?.name || 'Source';
  const type = recordingKindValue() === 'audio' ? 'Audio' : 'Video';
  const mode = $('captureMode')?.value || 'capture';
  let value = filenameTemplateForStyle();
  value = value.replace(/\{date\}/gi, date).replace(/\{time\}/gi, time).replace(/\{datetime\}/gi, `${date}_${time}`).replace(/\{source\}/gi, source).replace(/\{mode\}/gi, mode).replace(/\{type\}/gi, type);
  value = value.replace(/[\\/:*?"<>|]/g, '-').trim() || `Screen Recording ${date} ${time}`;
  const previewName = `${value}.${recordingKindValue() === 'audio' ? 'm4a' : 'mp4'}`;
  $('filenamePreview').textContent = previewName;
  if ($('autosavePattern')) $('autosavePattern').textContent = previewName;
}

function updateRecordingKindUi() {
  const audioOnly = recordingKindValue() === 'audio';
  document.body.classList.toggle('audio-only-recording', audioOnly);
  for (const id of ['quality', 'frameRate', 'videoCodec', 'showCursor', 'highlightCursor', 'showKeystrokes', 'webcamOverlay']) {
    const control = $(id);
    if (!control) continue;
    const macInputSafetyBlock = id === 'showKeystrokes' && state.platformInfo?.keystrokeOverlaySupported === false;
    control.disabled = audioOnly || macInputSafetyBlock;
    if (macInputSafetyBlock) control.checked = false;
  }
  if ($('webcamSettings')) $('webcamSettings').classList.toggle('hidden', audioOnly || !$('webcamOverlay')?.checked);
  syncQuickRecordingControls();
  previewFilenameTemplate();
  updateRecordingSizeEstimate();
  updateReadiness();
}

function recordingVideoBitrate() {
  const base = $('quality').value === '720' ? 4_000_000
    : $('quality').value === '1440' ? 14_000_000
      : $('quality').value === 'native' ? 16_000_000 : 8_000_000;
  const fpsScale = frameRateValue() === 60 ? 1.5 : frameRateValue() === 30 ? 1 : frameRateValue() === 25 ? 0.85 : 0.62;
  return Math.round(base * fpsScale);
}

function updateRecordingSizeEstimate() {
  const box = $('recordingSizeEstimate');
  if (!box || !window.PulseStudioEstimate) return;
  const audioOnly = recordingKindValue() === 'audio';
  const codec = videoCodecValue();
  const bytesPerHour = window.PulseStudioEstimate.estimateBytesPerHour({
    recordingKind: audioOnly ? 'audio' : 'video',
    videoBitrate: recordingVideoBitrate(),
    codec,
    microphone: Boolean($('microphone')?.checked),
    computerAudio: Boolean($('systemAudio')?.checked)
  });
  const bytesPerMinute = bytesPerHour / 60;
  const encoder = audioOnly ? '' : (codec === 'h265' ? state.platformInfo?.videoEncoding?.h265 : state.platformInfo?.videoEncoding?.h264);
  const encoderNote = audioOnly ? '' : (encoder ? ' · hardware encoding available' : ' · software encoding');
  box.innerHTML = `<strong>Estimated size:</strong> ~${escapeHtml(formatBytes(bytesPerHour))}/hour · ~${escapeHtml(formatBytes(bytesPerMinute))}/minute${escapeHtml(encoderNote)}. Actual size varies with screen motion and content.`;
  updateRecordReadySummary();
}


function currentEstimatedBytesPerHour() {
  if (!window.PulseStudioEstimate) return 0;
  return window.PulseStudioEstimate.estimateBytesPerHour({
    recordingKind: recordingKindValue() === 'audio' ? 'audio' : 'video',
    videoBitrate: recordingVideoBitrate(),
    codec: videoCodecValue(),
    microphone: Boolean($('microphone')?.checked),
    computerAudio: Boolean($('systemAudio')?.checked)
  });
}

function formatAvailableRecordingTime(freeBytes) {
  const perHour = currentEstimatedBytesPerHour();
  const free = Number(freeBytes);
  if (!Number.isFinite(free) || free <= 0 || !Number.isFinite(perHour) || perHour <= 0) return '';
  const hours = free / perHour;
  if (hours >= 10) return `~${Math.floor(hours)} h`;
  if (hours >= 1) return `~${hours.toFixed(1)} h`;
  return `~${Math.max(1, Math.floor(hours * 60))} min`;
}

async function createMicStream(force = false) {
  if (!force && !$('microphone').checked) return null;
  const noise = $('noiseReduction').value;
  const selectedDevice = $('microphoneDevice').value;
  const sourcePreserving = noise === 'enhanced' || noise === 'strong' || noise === 'off';
  const audio = {
    deviceId: selectedDevice === 'default' ? undefined : { exact: selectedDevice },
    // Enhanced/Strong deliberately capture a source-preserving microphone track.
    // Browser noise suppression/voice isolation can erase speech when a fan masks it,
    // so those modes now defer denoising until after Stop where the raw sidecar is safe.
    noiseSuppression: sourcePreserving ? false : true,
    // Use browser acoustic echo cancellation only when computer/application audio is
    // actually part of the capture. Running WebRTC AEC on a mic-only recording can
    // soften/pump speech even though there is no playback reference to cancel.
    // Fan/noise suppression remains entirely in the source-preserving offline path.
    echoCancellation: computerAudioModeValue() !== 'off',
    autoGainControl: sourcePreserving ? false : true,
    sampleRate: { ideal: 48000 },
    channelCount: { ideal: 1 }
  };
  const supported = navigator.mediaDevices?.getSupportedConstraints?.() || {};
  if (supported.voiceIsolation) audio.voiceIsolation = false;
  return navigator.mediaDevices.getUserMedia({ audio, video: false });
}

async function createSpeechOptimizedMicStream(force = false) {
  if (!force && !$('microphone').checked) return null;
  const noise = $('noiseReduction').value;
  if (noise !== 'enhanced' && noise !== 'strong') return null;
  const selectedDevice = $('microphoneDevice').value;
  const audio = {
    deviceId: selectedDevice === 'default' ? undefined : { exact: selectedDevice },
    // v0.2.30 audio fix: keep the first stream untouched for recovery, but acquire a
    // second speech-oriented stream using Chromium/WebRTC's conferencing processing.
    // This is much closer to the path used by meeting applications than asking a
    // general-purpose spectral denoiser to solve direct fan/wind turbulence alone.
    noiseSuppression: true,
    autoGainControl: true,
    echoCancellation: computerAudioModeValue() !== 'off',
    sampleRate: { ideal: 48000 },
    channelCount: { ideal: 1 }
  };
  const supported = navigator.mediaDevices?.getSupportedConstraints?.() || {};
  if (supported.voiceIsolation) audio.voiceIsolation = true;
  const stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
  const track = stream.getAudioTracks()[0];
  if (!track) {
    stream.getTracks().forEach((item) => item.stop());
    throw new Error('Speech-optimized microphone stream did not provide an audio track.');
  }
  return stream;
}

function capturePlan() {
  const mode = $('captureMode').value;
  if (mode === 'all') {
    const screens = state.sources.filter((source) => source.kind === 'screen');
    if (!screens.length) throw new Error('No display sources are available.');
    return { mode, sources: screens };
  }
  const source = selectedSource();
  if (!source) throw new Error('Choose a screen or window first.');
  if (mode === 'region') {
    if (!state.regionNormalized || state.regionSourceId !== source.id) throw new Error('Set the recording region before starting.');
  }
  return { mode, sources: [source] };
}

async function acquireCaptureSource(source, audioRequested, mode) {
  await window.recorderAPI.selectSource(source.id);
  // For a normal single-source recording, let the operating system capture the
  // pointer natively. It is smoother than polling the main process and redrawing
  // a synthetic cursor into every frame. Region/all-display capture still uses
  // the custom path because the pointer must be remapped into a crop/composite.
  const shouldUseOsCursor = mode === 'source' && $('showCursor').checked;
  if (mode === 'source') state.nativeCursorCapture = Boolean(shouldUseOsCursor);
  const videoConstraints = {
    frameRate: { ideal: frameRateValue(), max: frameRateValue() },
    cursor: shouldUseOsCursor ? 'always' : 'never'
  };

  // Full-display capture can arrive from macOS/Windows at the panel's native Retina/
  // HiDPI size even when the user selected 1080p or 1440p output. Asking Chromium for
  // the intended working size first avoids decoding a 4K/5K frame only to immediately
  // scale it back down on the recorder canvas. This is a best-effort optimization;
  // unsupported display tracks simply keep their native dimensions.
  let requestedCaptureSize = null;
  if (mode === 'source' && source?.kind === 'screen' && qualityTargetHeight()) {
    const bounds = source.displayBounds;
    if (bounds && Number(bounds.width) > 0 && Number(bounds.height) > 0) {
      const scale = Math.max(1, Number(source.displayScaleFactor) || 1);
      const nativeWidth = Math.max(1, Number(bounds.width) * scale);
      const nativeHeight = Math.max(1, Number(bounds.height) * scale);
      requestedCaptureSize = outputDimensions(nativeWidth / nativeHeight, nativeWidth, nativeHeight);
      videoConstraints.width = { ideal: requestedCaptureSize.width };
      videoConstraints.height = { ideal: requestedCaptureSize.height };
    }
  }

  const stream = await navigator.mediaDevices.getDisplayMedia({ video: videoConstraints, audio: audioRequested });
  const videoTrack = stream.getVideoTracks()[0];
  if (videoTrack && requestedCaptureSize && typeof videoTrack.applyConstraints === 'function') {
    try {
      await videoTrack.applyConstraints({
        width: { ideal: requestedCaptureSize.width, max: requestedCaptureSize.width },
        height: { ideal: requestedCaptureSize.height, max: requestedCaptureSize.height },
        frameRate: { ideal: frameRateValue(), max: frameRateValue() }
      });
    } catch (error) {
      console.debug('Display capture kept its native source size; recorder output scaling remains active.', error);
    }
  }
  return { source, stream };
}

function videoForStream(stream) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    const onReady = async () => {
      try {
        await video.play();
        resolve(video);
      } catch (error) { reject(error); }
    };
    video.addEventListener('loadedmetadata', onReady, { once: true });
    video.addEventListener('error', () => reject(new Error('Could not prepare a captured display for composition.')), { once: true });
  });
}

function buildCompositeLayout(plan, captures) {
  if (plan.mode !== 'all') {
    const video = captures[0].video;
    const region = plan.mode === 'region' ? state.regionNormalized : { x: 0, y: 0, w: 1, h: 1 };
    const crop = {
      x: Math.round(region.x * video.videoWidth),
      y: Math.round(region.y * video.videoHeight),
      w: Math.max(1, Math.round(region.w * video.videoWidth)),
      h: Math.max(1, Math.round(region.h * video.videoHeight))
    };
    const aspect = crop.w / crop.h;
    const dims = outputDimensions(aspect, crop.w, crop.h);
    return { mode: plan.mode, width: dims.width, height: dims.height, crop, items: [{ ...captures[0], x: 0, y: 0, w: dims.width, h: dims.height }] };
  }

  const haveBounds = captures.every((item) => item.source.displayBounds && Number.isFinite(item.source.displayBounds.width));
  if (haveBounds) {
    const minX = Math.min(...captures.map((item) => item.source.displayBounds.x));
    const minY = Math.min(...captures.map((item) => item.source.displayBounds.y));
    const maxX = Math.max(...captures.map((item) => item.source.displayBounds.x + item.source.displayBounds.width));
    const maxY = Math.max(...captures.map((item) => item.source.displayBounds.y + item.source.displayBounds.height));
    const virtualW = Math.max(1, maxX - minX);
    const virtualH = Math.max(1, maxY - minY);
    const maxScale = Math.max(1, ...captures.map((item) => Number(item.source.displayScaleFactor) || 1));
    const dims = outputDimensions(virtualW / virtualH, virtualW * maxScale, virtualH * maxScale);
    const items = captures.map((item) => {
      const b = item.source.displayBounds;
      return {
        ...item,
        x: ((b.x - minX) / virtualW) * dims.width,
        y: ((b.y - minY) / virtualH) * dims.height,
        w: (b.width / virtualW) * dims.width,
        h: (b.height / virtualH) * dims.height
      };
    });
    return { mode: 'all', width: dims.width, height: dims.height, minX, minY, virtualW, virtualH, items };
  }

  const totalW = captures.reduce((sum, item) => sum + item.video.videoWidth, 0);
  const maxH = Math.max(...captures.map((item) => item.video.videoHeight));
  const dims = outputDimensions(totalW / maxH, totalW, maxH);
  let x = 0;
  const items = captures.map((item) => {
    const width = (item.video.videoWidth / totalW) * dims.width;
    const mapped = { ...item, x, y: 0, w: width, h: dims.height };
    x += width;
    return mapped;
  });
  return { mode: 'all-fallback', width: dims.width, height: dims.height, items };
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function cursorOnComposite(layout) {
  const point = state.cursorPoint;
  if (!point) return null;
  if (layout.mode === 'all') {
    const item = layout.items.find((entry) => {
      const b = entry.source.displayBounds;
      return b && point.x >= b.x && point.x < b.x + b.width && point.y >= b.y && point.y < b.y + b.height;
    });
    if (!item) return null;
    const b = item.source.displayBounds;
    return {
      x: item.x + ((point.x - b.x) / b.width) * item.w,
      y: item.y + ((point.y - b.y) / b.height) * item.h
    };
  }
  if (layout.mode === 'all-fallback') return null;
  const item = layout.items[0];
  const b = item.source.displayBounds;
  if (!b || item.source.kind !== 'screen') return null;
  if (point.x < b.x || point.x >= b.x + b.width || point.y < b.y || point.y >= b.y + b.height) return null;
  const rawX = ((point.x - b.x) / b.width) * item.video.videoWidth;
  const rawY = ((point.y - b.y) / b.height) * item.video.videoHeight;
  const crop = layout.crop;
  if (rawX < crop.x || rawX > crop.x + crop.w || rawY < crop.y || rawY > crop.y + crop.h) return null;
  return {
    x: ((rawX - crop.x) / crop.w) * layout.width,
    y: ((rawY - crop.y) / crop.h) * layout.height
  };
}

function drawCursorOverlay(ctx, layout) {
  const showCursor = $('showCursor').checked;
  const highlight = $('highlightCursor').checked;
  const drawSyntheticCursor = showCursor && !state.nativeCursorCapture;
  if (!drawSyntheticCursor && !highlight) return;
  const point = cursorOnComposite(layout);
  if (!point) return;
  const scale = Math.max(1, Math.min(layout.width, layout.height) / 1080);
  if (highlight) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(point.x, point.y, 22 * scale, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(250, 204, 21, 0.28)';
    ctx.fill();
    ctx.lineWidth = 3 * scale;
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.95)';
    ctx.stroke();
    ctx.restore();
  }
  if (drawSyntheticCursor) {
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.scale(scale, scale);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 25);
    ctx.lineTo(7, 18);
    ctx.lineTo(13, 31);
    ctx.lineTo(19, 28);
    ctx.lineTo(13, 16);
    ctx.lineTo(23, 16);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 2.5;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

function drawKeystrokeOverlay(ctx, layout) {
  if (!$('showKeystrokes').checked) return;
  const now = Date.now();
  state.recentKeystrokes = state.recentKeystrokes.filter((item) => now - item.at < 1800).slice(-3);
  if (!state.recentKeystrokes.length) return;
  const label = state.recentKeystrokes.map((item) => item.label).join('   •   ');
  const fontSize = Math.max(18, Math.round(layout.height * 0.025));
  ctx.save();
  ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  const metrics = ctx.measureText(label);
  const padX = fontSize * 0.75;
  const padY = fontSize * 0.45;
  const width = metrics.width + padX * 2;
  const height = fontSize + padY * 2;
  const x = Math.max(12, (layout.width - width) / 2);
  const y = layout.height - height - Math.max(24, layout.height * 0.04);
  drawRoundedRect(ctx, x, y, Math.min(width, layout.width - 24), height, fontSize * 0.45);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(label, layout.width / 2, y + height / 2, layout.width - 48);
  ctx.restore();
}

function drawWebcamOverlay(ctx, layout) {
  const video = state.webcamVideo;
  if (!video || video.readyState < 2 || !$('webcamOverlay')?.checked || recordingKindValue() === 'audio') return;
  const sizeSetting = $('webcamSize')?.value || 'medium';
  const fraction = sizeSetting === 'small' ? 0.17 : sizeSetting === 'large' ? 0.31 : 0.23;
  let width = Math.max(160, Math.round(layout.width * fraction));
  let height = Math.max(100, Math.round(width * (video.videoHeight || 9) / Math.max(1, video.videoWidth || 16)));
  if (height > layout.height * 0.38) {
    height = Math.round(layout.height * 0.38);
    width = Math.round(height * (video.videoWidth || 16) / Math.max(1, video.videoHeight || 9));
  }
  const margin = Math.max(18, Math.round(layout.width * 0.018));
  const position = $('webcamPosition')?.value || 'bottom-right';
  const left = position.endsWith('left');
  const top = position.startsWith('top');
  const x = left ? margin : layout.width - width - margin;
  const y = top ? margin : layout.height - height - margin;
  const shape = $('webcamShape')?.value || 'rounded';
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.35)';
  ctx.shadowBlur = Math.max(8, Math.round(layout.width * 0.008));
  ctx.shadowOffsetY = Math.max(2, Math.round(layout.height * 0.004));
  if (shape === 'circle') {
    const diameter = Math.min(width, height);
    const cx = x + width / 2;
    const cy = y + height / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, diameter / 2, 0, Math.PI * 2);
    ctx.clip();
    const sourceAspect = (video.videoWidth || 16) / Math.max(1, video.videoHeight || 9);
    const cropW = sourceAspect > 1 ? (video.videoHeight || 1) : (video.videoWidth || 1);
    const sx = sourceAspect > 1 ? ((video.videoWidth - cropW) / 2) : 0;
    const sy = sourceAspect > 1 ? 0 : ((video.videoHeight - cropW) / 2);
    ctx.drawImage(video, sx, sy, cropW, cropW, cx - diameter / 2, cy - diameter / 2, diameter, diameter);
  } else {
    drawRoundedRect(ctx, x, y, width, height, Math.max(14, width * 0.06));
    ctx.clip();
    ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight, x, y, width, height);
  }
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,.8)';
  ctx.lineWidth = Math.max(2, layout.width * 0.002);
  if (shape === 'circle') {
    const diameter = Math.min(width, height);
    ctx.beginPath();
    ctx.arc(x + width / 2, y + height / 2, diameter / 2, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    drawRoundedRect(ctx, x, y, width, height, Math.max(14, width * 0.06));
    ctx.stroke();
  }
  ctx.restore();
}

function startCursorPolling(plan) {
  clearInterval(state.cursorPollTimer);
  // Native single-source cursor capture needs no polling unless a highlight ring
  // is requested. Cropped and multi-display composites still need coordinates.
  const needsMappedCursor = plan.mode === 'all' || plan.mode === 'region' || (plan.sources.some((source) => source.kind === 'screen') && !state.nativeCursorCapture);
  const needsHighlightPosition = Boolean($('highlightCursor').checked && plan.sources.some((source) => source.kind === 'screen'));
  const needsCursorPosition = needsMappedCursor || needsHighlightPosition;
  if (!needsCursorPosition || (!$('showCursor').checked && !$('highlightCursor').checked)) return;
  const interval = Math.max(24, Math.round(1000 / Math.min(30, frameRateValue())));
  const poll = async () => {
    if (state.cursorPollBusy) return;
    state.cursorPollBusy = true;
    try { state.cursorPoint = await window.recorderAPI.getCursorPosition(); } catch {}
    state.cursorPollBusy = false;
  };
  poll();
  state.cursorPollTimer = setInterval(poll, interval);
}

async function buildCompositeStream(plan, captures) {
  // v0.2.88 performance path: a normal single screen/window recording does not
  // need to copy every captured frame through a full-size renderer canvas. Passing
  // the OS capture track straight to MediaRecorder removes the largest per-frame
  // workload from the Full View renderer and keeps pointer/UI handling responsive.
  // Region/all-display capture and visual overlays still use the compositor because
  // they genuinely need cropping/drawing.
  const needsStableMacScreenRelay = state.platformInfo?.platform === 'darwin'
    && plan.mode === 'source'
    && captures[0]?.source?.kind === 'screen';
  const directPassThrough = plan.mode === 'source'
    && captures.length === 1
    && Boolean(captures[0]?.stream?.getVideoTracks?.()[0])
    && !needsStableMacScreenRelay
    && !$('webcamOverlay')?.checked
    && !$('highlightCursor')?.checked
    && !$('showKeystrokes')?.checked;
  if (directPassThrough) {
    state.directCapturePassThrough = true;
    state.captureVideos = [];
    state.compositeCanvas = null;
    state.compositeContext = null;
    state.compositeLayout = null;
    clearTimeout(state.compositorTimer);
    state.compositorTimer = null;
    const videoTrack = captures[0].stream.getVideoTracks()[0];
    return new MediaStream([videoTrack]);
  }

  state.directCapturePassThrough = false;
  const prepared = [];
  for (const capture of captures) prepared.push({ ...capture, video: await videoForStream(capture.stream) });
  state.captureVideos = prepared.map((item) => item.video);
  const layout = buildCompositeLayout(plan, prepared);
  state.compositeLayout = layout;
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  state.compositeCanvas = canvas;
  state.compositeContext = ctx;

  // Full View used to redraw this full-size recording canvas on every display refresh
  // (60/120 Hz on many Macs) even though the recording itself was normally 25/30 FPS.
  // That renderer work can starve ordinary UI/pointer handling. Follow real captured
  // video frames instead and use only a slow watchdog while the native source is stalled.
  const targetInterval = Math.max(16, Math.round(1000 / frameRateValue()));
  const stallInterval = Math.max(140, targetInterval * 4);
  let lastPaintAt = 0;

  const drawFrame = (now = performance.now()) => {
    if (!state.compositeCanvas || !state.compositeContext || state.compositeLayout !== layout) return false;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (layout.mode === 'source' || layout.mode === 'region') {
      const item = layout.items[0];
      const c = layout.crop;
      if (item.video?.readyState >= 2) ctx.drawImage(item.video, c.x, c.y, c.w, c.h, 0, 0, layout.width, layout.height);
    } else {
      for (const item of layout.items) {
        if (item.video?.readyState >= 2) ctx.drawImage(item.video, 0, 0, item.video.videoWidth, item.video.videoHeight, item.x, item.y, item.w, item.h);
      }
    }
    drawWebcamOverlay(ctx, layout);
    drawCursorOverlay(ctx, layout);
    drawKeystrokeOverlay(ctx, layout);
    lastPaintAt = now;
    return true;
  };

  const cancelScheduledFrame = () => {
    clearTimeout(state.compositorTimer);
    state.compositorTimer = null;
    if (state.compositorVideoFrameTarget && state.compositorVideoFrameHandle != null && typeof state.compositorVideoFrameTarget.cancelVideoFrameCallback === 'function') {
      try { state.compositorVideoFrameTarget.cancelVideoFrameCallback(state.compositorVideoFrameHandle); } catch {}
    }
    state.compositorVideoFrameHandle = null;
    state.compositorVideoFrameTarget = null;
  };

  const scheduleNextFrame = () => {
    if (!state.compositeCanvas || state.compositeLayout !== layout) return;
    cancelScheduledFrame();
    const primaryVideo = layout.items[0]?.video;
    if (primaryVideo && typeof primaryVideo.requestVideoFrameCallback === 'function' && primaryVideo.readyState >= 2) {
      state.compositorVideoFrameTarget = primaryVideo;
      state.compositorVideoFrameHandle = primaryVideo.requestVideoFrameCallback((now) => {
        clearTimeout(state.compositorTimer);
        state.compositorTimer = null;
        state.compositorVideoFrameHandle = null;
        state.compositorVideoFrameTarget = null;
        // The capture constraints normally already match the selected FPS. Keep a
        // small guard in case the OS still delivers faster frames.
        if (!lastPaintAt || now - lastPaintAt >= targetInterval * 0.72) drawFrame(now);
        scheduleNextFrame();
      });
      // If sleep/wake or a display reconfiguration stalls the native frame callback,
      // keep the canvas track alive at low cost and notice a newly reconnected video.
      state.compositorTimer = setTimeout(() => {
        if (state.compositorVideoFrameTarget && state.compositorVideoFrameHandle != null && typeof state.compositorVideoFrameTarget.cancelVideoFrameCallback === 'function') {
          try { state.compositorVideoFrameTarget.cancelVideoFrameCallback(state.compositorVideoFrameHandle); } catch {}
        }
        state.compositorVideoFrameHandle = null;
        state.compositorVideoFrameTarget = null;
        state.compositorTimer = null;
        drawFrame();
        scheduleNextFrame();
      }, stallInterval);
      return;
    }
    state.compositorTimer = setTimeout(() => {
      state.compositorTimer = null;
      drawFrame();
      scheduleNextFrame();
    }, primaryVideo?.readyState >= 2 ? targetInterval : stallInterval);
  };

  // Initialize the relay before MediaRecorder sees it. The canvas output track stays
  // stable even if the underlying screen capture must later be reconnected.
  drawFrame();
  scheduleNextFrame();
  startCursorPolling(plan);
  return canvas.captureStream(frameRateValue());
}

let deepFilterLibraryPromise = null;
let rnnoiseLibraryPromise = null;
let rnnoiseBinaryPromise = null;

async function createDeepFilterSuppressorNode(audioContext, mode) {
  if (!deepFilterLibraryPromise) deepFilterLibraryPromise = import('appasset://deepfilter/index.esm.js');
  const library = await deepFilterLibraryPromise;
  const Processor = library?.DeepFilterNet3Core || library?.DeepFilterNet3Processor;
  if (!Processor) throw new Error('DeepFilterNet3 processor API is unavailable.');
  const processor = new Processor({
    sampleRate: 48000,
    noiseReductionLevel: 0,
    // Pin the model host explicitly. v1.3 uses external DeepFilterNet3 assets; the
    // renderer CSP allows only this HTTPS origin. If it cannot be reached, RNNoise
    // remains the automatic local fallback and the untouched raw mic is still safe.
    assetConfig: { cdnUrl: 'https://cdn.mezon.ai/AI/models/datas/noise_suppression/deepfilternet3' }
  });
  let timeoutId = 0;
  try {
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('DeepFilterNet3 initialization timed out; using local neural fallback.')), 18000);
    });
    await Promise.race([processor.initialize(), timeout]);
  } catch (error) {
    try { processor.destroy?.(); } catch {}
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
  const node = await processor.createAudioWorkletNode(audioContext);
  // A neural copy is now recorded in parallel with the untouched raw mic. These
  // levels are intentionally below the old 95/82 settings: DeepFilter does the
  // separation work, while the raw sidecar remains available for speech-safety fallback.
  const suppression = mode === 'strong' ? 78 : 66;
  if (typeof processor.setSuppressionLevel === 'function') processor.setSuppressionLevel(suppression);
  state.deepFilterProcessor = processor;
  return node;
}

async function createRnnoiseSuppressorNode(audioContext) {
  let library;
  try {
    if (!rnnoiseLibraryPromise) rnnoiseLibraryPromise = import('appasset://noise/index.js');
    library = await rnnoiseLibraryPromise;
  } catch (error) {
    rnnoiseLibraryPromise = null;
    throw new Error(`RNNoise module load failed: ${error?.message || error}`);
  }
  if (!library?.loadRnnoise || !library?.RnnoiseWorkletNode) throw new Error('RNNoise module API is unavailable.');
  try {
    // @sapphi-red/web-noise-suppressor selects the SIMD binary on modern Chromium.
    // v0.2.103 supplied only the non-SIMD URL, so Apple Silicon/modern Chromium could
    // call fetch(undefined) and RNNoise silently fell back to the noisier WebRTC path.
    if (!rnnoiseBinaryPromise) rnnoiseBinaryPromise = library.loadRnnoise({
      url: 'appasset://noise/rnnoise.wasm',
      simdUrl: 'appasset://noise/rnnoise_simd.wasm'
    });
    const wasmBinary = await rnnoiseBinaryPromise;
    await audioContext.audioWorklet.addModule('appasset://noise/rnnoise/workletProcessor.js');
    return new library.RnnoiseWorkletNode(audioContext, { wasmBinary, maxChannels: 1 });
  } catch (error) {
    rnnoiseBinaryPromise = null;
    throw new Error(`RNNoise WASM/worklet load failed: ${error?.message || error}`);
  }
}


async function createLocalNeuralNoiseSuppressedMicStream(audioContext, micStream) {
  if (!audioContext || !micStream?.getAudioTracks?.().length) throw new Error('A live microphone and AudioContext are required for RNNoise.');
  const source = audioContext.createMediaStreamSource(micStream);
  const suppressor = await createRnnoiseSuppressorNode(audioContext);
  const destination = audioContext.createMediaStreamDestination();
  try {
    source.connect(suppressor);
    suppressor.connect(destination);
    const track = destination.stream.getAudioTracks()[0];
    if (!track) throw new Error('RNNoise did not produce an output audio track.');
    state.rnnoiseSourceNode = source;
    state.rnnoiseNode = suppressor;
    state.rnnoiseDestination = destination;
    return new MediaStream([track]);
  } catch (error) {
    try { source.disconnect(); } catch {}
    try { suppressor.disconnect?.(); } catch {}
    try { suppressor.destroy?.(); } catch {}
    destination.stream?.getTracks?.().forEach((track) => { try { track.stop(); } catch {} });
    throw error;
  }
}

async function prepareNoiseSuppressedMicrophoneSidecar(micStream, options = {}) {
  const mode = $('noiseReduction')?.value || 'off';
  state.processedMicStream = null;
  state.neuralMicMethod = 'none';
  if (!micStream?.getAudioTracks?.().length || !['enhanced', 'strong'].includes(mode)) return null;

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!state.audioContext || state.audioContext.state === 'closed') state.audioContext = new AudioContextClass({ sampleRate: 48000 });
  await state.audioContext.resume();

  // v0.2.104: Enhanced/Strong use the bundled local RNNoise AudioWorklet as the
  // primary noise-suppression candidate. This is a sidecar only: the source-preserving
  // microphone recorder remains untouched for recovery/fallback, so neural suppression
  // can never erase the only copy of the user's voice.
  try {
    setStatus('Preparing local neural fan/noise suppression…');
    const stream = await createLocalNeuralNoiseSuppressedMicStream(state.audioContext, micStream);
    state.processedMicStream = stream;
    state.neuralMicMethod = 'rnnoise-local-neural';
    return stream;
  } catch (error) {
    console.warn('Local RNNoise microphone suppression unavailable; using Chromium speech processing fallback.', error);
    window.recorderAPI.logEvent?.('warn', 'renderer.rnnoise-unavailable', { error: String(error?.message || error || '') });
  }

  // Keep the existing conferencing-style Chromium path as a fallback on machines
  // where AudioWorklet/WASM cannot initialize. It remains a second stream and never
  // changes the recoverable source microphone.
  try {
    state.speechMicStream = await createSpeechOptimizedMicStream(Boolean(options.forceSpeech));
    if (!state.speechMicStream?.getAudioTracks?.().length) throw new Error('Speech-optimized microphone did not provide an audio track.');
    state.processedMicStream = new MediaStream(state.speechMicStream.getAudioTracks());
    const settings = state.speechMicStream.getAudioTracks()[0]?.getSettings?.() || {};
    if (settings.voiceIsolation) state.neuralMicMethod = 'chromium-voice-isolation';
    else if (settings.noiseSuppression) state.neuralMicMethod = 'webrtc-noise-suppression';
    else state.neuralMicMethod = 'webrtc-speech-processing';
    return state.processedMicStream;
  } catch (error) {
    console.warn('Speech-optimized microphone fallback unavailable; source-preserving offline cleanup will be used.', error);
    state.speechMicStream = null;
    state.processedMicStream = null;
    state.neuralMicMethod = 'none';
    return null;
  }
}

async function buildMixedStream(videoStream, sourceStreams, micStream) {
  const videoTracks = videoStream?.getVideoTracks?.() || [];
  const systemTrack = computerAudioModeValue() === 'system' ? sourceStreams.flatMap((stream) => stream.getAudioTracks())[0] : null;
  const hasMic = micStream && micStream.getAudioTracks().length > 0;
  const needsSilentTrack = computerAudioModeValue() === 'application' || recordingKindValue() === 'audio';
  state.processedMicStream = null;
  state.neuralMicMethod = 'none';
  if (!systemTrack && !hasMic && !needsSilentTrack) return new MediaStream(videoTracks);

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  state.audioContext = new AudioContextClass({ sampleRate: 48000 });
  await state.audioContext.resume();
  const mainDestination = state.audioContext.createMediaStreamDestination();

  state.mainAudioDestination = mainDestination;
  state.systemAudioSourceNode = null;
  state.systemAnalyser = null;
  if (systemTrack) {
    const systemSource = state.audioContext.createMediaStreamSource(new MediaStream([systemTrack]));
    state.systemAudioSourceNode = systemSource;
    systemSource.connect(mainDestination);
    state.systemAnalyser = state.audioContext.createAnalyser();
    state.systemAnalyser.fftSize = 256;
    state.systemAnalyser.smoothingTimeConstant = 0.72;
    systemSource.connect(state.systemAnalyser);
  }

  if (hasMic && ['enhanced', 'strong'].includes($('noiseReduction')?.value || '')) {
    await prepareNoiseSuppressedMicrophoneSidecar(micStream);
  }

  state.analyser = state.audioContext.createAnalyser();
  state.analyser.fftSize = 256;
  const meterStream = state.processedMicStream?.getAudioTracks?.().length ? state.processedMicStream : (hasMic ? micStream : mainDestination.stream);
  const meterSource = state.audioContext.createMediaStreamSource(meterStream);
  meterSource.connect(state.analyser);

  // Main recording excludes microphone audio. The untouched source and optional
  // conferencing-processed candidate are finalized separately, then the safest clean
  // result is selected and mixed after Stop.
  const mainAudioTracks = (systemTrack || needsSilentTrack) ? mainDestination.stream.getAudioTracks() : [];
  return new MediaStream([...videoTracks, ...mainAudioTracks]);
}


function voiceHighlightFrequencyProfile(analyser, frequencyData, sampleRate = state.audioContext?.sampleRate || 48000) {
  if (!analyser || !frequencyData) return null;
  analyser.getFloatFrequencyData(frequencyData);
  const nyquist = (Number(sampleRate) || 48000) / 2;
  const hzPerBin = nyquist / Math.max(1, frequencyData.length);
  const bands = [[180, 550], [550, 1200], [1200, 2400], [2400, 3900]];
  const bandDb = bands.map(([low, high]) => {
    const start = Math.max(0, Math.floor(low / hzPerBin));
    const end = Math.min(frequencyData.length - 1, Math.ceil(high / hzPerBin));
    let power = 0;
    let count = 0;
    for (let i = start; i <= end; i += 1) {
      const db = Number.isFinite(frequencyData[i]) ? frequencyData[i] : -100;
      power += 10 ** (db / 10);
      count += 1;
    }
    return count ? 10 * Math.log10(Math.max(1e-10, power / count)) : -100;
  });
  const voicePower = bandDb.reduce((sum, db) => sum + 10 ** (db / 10), 0) / Math.max(1, bandDb.length);
  const voiceDb = 10 * Math.log10(Math.max(1e-10, voicePower));
  const lowEnd = Math.min(frequencyData.length - 1, Math.ceil(170 / hzPerBin));
  let lowPower = 0;
  let lowCount = 0;
  for (let i = 0; i <= lowEnd; i += 1) {
    const db = Number.isFinite(frequencyData[i]) ? frequencyData[i] : -100;
    lowPower += 10 ** (db / 10);
    lowCount += 1;
  }
  const lowDb = 10 * Math.log10(Math.max(1e-10, lowPower / Math.max(1, lowCount)));
  const mean = bandDb.reduce((a, b) => a + b, 0) / Math.max(1, bandDb.length);
  const profile = bandDb.map((db) => db - mean);
  return { bandDb, profile, voiceDb, lowDb };
}

function renderVoiceEnrollmentStatus() {
  const status = $('voiceEnrollmentStatus');
  const enrollButton = $('voiceEnrollButton');
  const clearButton = $('voiceClearButton');
  const progress = $('voiceEnrollmentProgress');
  if (!status || !enrollButton || !clearButton || !progress) return;
  const profile = state.voiceEnrollmentProfile;
  const recordingActive = Boolean(state.mediaRecorder && state.mediaRecorder.state !== 'inactive');
  enrollButton.disabled = state.voiceEnrollmentBusy || recordingActive;
  clearButton.disabled = state.voiceEnrollmentBusy || recordingActive || !profile?.enrolled;
  clearButton.classList.toggle('hidden', !profile?.enrolled);
  if (!state.voiceEnrollmentBusy) progress.classList.add('hidden');
  if (state.voiceEnrollmentBusy) status.textContent = 'Listening locally · speak naturally for about 15 seconds…';
  else if (profile?.enrolled) {
    const date = profile.createdAt ? new Date(profile.createdAt) : null;
    const when = date && Number.isFinite(date.getTime()) ? date.toLocaleDateString() : 'saved locally';
    status.textContent = `Enrolled · ${when} · improves My Voice and speaker matching. Recorded audio is never changed by this profile.`;
  } else status.textContent = 'Optional · improves My Voice and speaker matching without changing recorded audio.';
}

async function refreshVoiceEnrollmentStatus() {
  try { state.voiceEnrollmentProfile = await window.recorderAPI.getVoiceProfile?.(); }
  catch { state.voiceEnrollmentProfile = { enrolled: false, spectralFingerprint: [] }; }
  renderVoiceEnrollmentStatus();
  return state.voiceEnrollmentProfile;
}

async function enrollMyVoice() {
  if (state.voiceEnrollmentBusy || (state.mediaRecorder && state.mediaRecorder.state !== 'inactive')) return;
  state.voiceEnrollmentBusy = true;
  renderVoiceEnrollmentStatus();
  const progress = $('voiceEnrollmentProgress');
  const fill = $('voiceEnrollmentProgressFill');
  const countdown = $('voiceEnrollmentCountdown');
  progress?.classList.remove('hidden');
  if (fill) fill.style.width = '0%';
  if (countdown) countdown.textContent = '15s';
  let stream = null;
  let context = null;
  let sampleTimer = null;
  let countdownTimer = null;
  try {
    const selectedDevice = $('microphoneDevice')?.value || 'default';
    const constraints = {
      deviceId: selectedDevice === 'default' ? undefined : { exact: selectedDevice },
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true,
      sampleRate: { ideal: 48000 },
      channelCount: { ideal: 1 }
    };
    const supported = navigator.mediaDevices?.getSupportedConstraints?.() || {};
    if (supported.voiceIsolation) constraints.voiceIsolation = true;
    stream = await navigator.mediaDevices.getUserMedia({ audio: constraints, video: false });
    state.voiceEnrollmentStream = stream;
    const mimeType = chooseMicrophoneMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 128000 } : { audioBitsPerSecond: 128000 });
    state.voiceEnrollmentRecorder = recorder;
    const chunks = [];
    recorder.addEventListener('dataavailable', (event) => { if (event.data?.size) chunks.push(event.data); });
    const done = new Promise((resolve, reject) => {
      recorder.addEventListener('stop', resolve, { once: true });
      recorder.addEventListener('error', (event) => reject(event.error || new Error('Voice enrollment recorder failed.')), { once: true });
    });
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    context = new AudioCtx({ sampleRate: 48000 });
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.36;
    source.connect(analyser);
    const timeData = new Float32Array(analyser.fftSize);
    const freqData = new Float32Array(analyser.frequencyBinCount);
    const profiles = [];
    sampleTimer = setInterval(() => {
      const level = analyserDbfs(analyser, timeData);
      if (level.db < -56) return;
      const profile = voiceHighlightFrequencyProfile(analyser, freqData, context.sampleRate);
      if (profile?.profile?.length) profiles.push(profile.profile);
    }, 100);
    const started = performance.now();
    countdownTimer = setInterval(() => {
      const elapsed = Math.max(0, performance.now() - started);
      const remaining = Math.max(0, 15 - elapsed / 1000);
      if (fill) fill.style.width = `${clamp((elapsed / 15000) * 100, 0, 100)}%`;
      if (countdown) countdown.textContent = `${Math.ceil(remaining)}s`;
    }, 100);
    recorder.start(1000);
    await new Promise((resolve) => setTimeout(resolve, 15000));
    if (recorder.state !== 'inactive') recorder.stop();
    await done;
    clearInterval(sampleTimer); sampleTimer = null;
    clearInterval(countdownTimer); countdownTimer = null;
    if (fill) fill.style.width = '100%';
    if (countdown) countdown.textContent = 'Building…';
    const spectralFingerprint = profiles.length ? profiles[0].map((_, index) => profiles.reduce((sum, profile) => sum + (Number(profile[index]) || 0), 0) / profiles.length) : [];
    const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
    const audioData = await blob.arrayBuffer();
    const result = await window.recorderAPI.enrollVoiceProfile({ audioData, mimeType: blob.type, spectralFingerprint });
    state.voiceEnrollmentProfile = result;
    showToast('My Voice profile enrolled');
    window.recorderAPI.logEvent?.('info', 'renderer.voice-profile-enrolled', { speechSeconds: result?.speechSeconds || 0, spectralBands: spectralFingerprint.length });
  } catch (error) {
    setStatus(`Could not enroll My Voice. ${friendlyErrorText(error)}`, true);
    showToast('My Voice enrollment did not complete');
  } finally {
    clearInterval(sampleTimer);
    clearInterval(countdownTimer);
    try { if (state.voiceEnrollmentRecorder?.state && state.voiceEnrollmentRecorder.state !== 'inactive') state.voiceEnrollmentRecorder.stop(); } catch {}
    try { stream?.getTracks?.().forEach((track) => track.stop()); } catch {}
    try { await context?.close?.(); } catch {}
    state.voiceEnrollmentStream = null;
    state.voiceEnrollmentRecorder = null;
    state.voiceEnrollmentBusy = false;
    renderVoiceEnrollmentStatus();
  }
}

async function clearMyVoiceProfile() {
  if (state.voiceEnrollmentBusy || (state.mediaRecorder && state.mediaRecorder.state !== 'inactive')) return;
  try {
    state.voiceEnrollmentProfile = await window.recorderAPI.clearVoiceProfile?.();
    renderVoiceEnrollmentStatus();
    showToast('My Voice profile cleared');
  } catch (error) { setStatus(`Could not clear My Voice profile. ${friendlyErrorText(error)}`, true); }
}

function voiceHighlightProfileSimilarity(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = Number(a[i]) || 0;
    const bv = Number(b[i]) || 0;
    dot += av * bv;
    aa += av * av;
    bb += bv * bv;
  }
  if (aa < 0.01 || bb < 0.01) return 0;
  return clamp(dot / Math.sqrt(aa * bb), -1, 1);
}

function voiceHighlightPearson(a, b) {
  if (!a?.length || a.length !== b?.length || a.length < 4) return 0;
  const ma = a.reduce((sum, value) => sum + value, 0) / a.length;
  const mb = b.reduce((sum, value) => sum + value, 0) / b.length;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i] - ma;
    const bv = b[i] - mb;
    num += av * bv;
    da += av * av;
    db += bv * bv;
  }
  if (da < 0.5 || db < 0.5) return 0;
  return clamp(num / Math.sqrt(da * db), -1, 1);
}

function voiceHighlightLeakMatch(nowMs) {
  const history = state.voiceHighlightHistory;
  if (!history.length) return { matched: false, score: 0, gainDb: null, residualDb: 99 };
  const recentMic = history.filter((frame) => nowMs - frame.t <= 900 && frame.t <= nowMs);
  if (recentMic.length < 5) return { matched: false, score: 0, gainDb: null, residualDb: 99 };
  let best = { score: 0, gainDb: null, residualDb: 99, matched: false };
  // MacBook speaker -> built-in mic leakage varies with device position and volume.
  // Cover the common 40-360 ms acoustic path instead of assuming one ~100 ms echo.
  for (const delayMs of [40, 60, 80, 100, 120, 150, 180, 220, 260, 300, 360]) {
    const micSeries = [];
    const sysSeries = [];
    const similarities = [];
    const gains = [];
    for (const mic of recentMic) {
      if (mic.micDb < -58) continue;
      const target = mic.t - delayMs;
      let sys = null;
      let distance = Infinity;
      for (const candidate of history) {
        const d = Math.abs(candidate.t - target);
        if (d < distance && d <= 55) { distance = d; sys = candidate; }
      }
      if (!sys || sys.sysDb < -58) continue;
      micSeries.push(mic.micDb);
      sysSeries.push(sys.sysDb);
      similarities.push(voiceHighlightProfileSimilarity(mic.micProfile, sys.sysProfile));
      gains.push(mic.micDb - sys.sysDb);
    }
    if (micSeries.length < 4) continue;
    const corr = voiceHighlightPearson(micSeries, sysSeries);
    const spectral = similarities.reduce((sum, value) => sum + value, 0) / similarities.length;
    const score = Math.max(0, corr) * 0.64 + Math.max(0, spectral) * 0.36;
    const sortedGains = gains.slice().sort((a, b) => a - b);
    const gainDb = sortedGains[Math.floor(sortedGains.length / 2)] ?? null;
    const current = history[history.length - 1];
    let currentSystem = null;
    let currentDistance = Infinity;
    const currentTarget = nowMs - delayMs;
    for (const candidate of history) {
      const d = Math.abs(candidate.t - currentTarget);
      if (d < currentDistance && d <= 55) { currentDistance = d; currentSystem = candidate; }
    }
    let residualDb = 99;
    if (current && currentSystem && gainDb != null && currentSystem.sysDb > -58) residualDb = current.micDb - (currentSystem.sysDb + gainDb);
    if (score > best.score) best = { score, gainDb, residualDb, matched: score >= 0.64 };
  }
  return best;
}

function normalizeLiveVoiceHighlights(durationSeconds = Math.max(0, elapsedMs() / 1000)) {
  const raw = state.liveVoiceHighlights
    .concat(state.liveVoiceHighlightActive ? [{ ...state.liveVoiceHighlightActive, end: durationSeconds }] : [])
    .map((segment) => ({
      start: clamp(Number(segment.start) || 0, 0, durationSeconds),
      end: clamp(Number(segment.end) || 0, 0, durationSeconds),
      confidence: clamp(Number(segment.confidence) || 0.75, 0, 1),
      method: 'mic-system-readonly'
    }))
    .filter((segment) => segment.end - segment.start >= 0.18)
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const segment of raw) {
    const previous = merged[merged.length - 1];
    if (previous && segment.start - previous.end <= 0.34) {
      previous.end = Math.max(previous.end, segment.end);
      previous.confidence = Math.max(previous.confidence, segment.confidence);
    } else merged.push({ ...segment });
  }
  return merged;
}

function renderVoiceHighlightTrack(track, segments, durationSeconds, activeSegment = null) {
  if (!track) return;
  const duration = Math.max(0.2, Number(durationSeconds) || 0.2);
  const list = segments.concat(activeSegment ? [{ ...activeSegment, end: durationSeconds, active: true }] : []);
  track.innerHTML = list.slice(-160).map((segment) => {
    const start = clamp(Number(segment.start) || 0, 0, duration);
    const end = clamp(Number(segment.end) || start, start, duration);
    const left = clamp((start / duration) * 100, 0, 100);
    const width = clamp(((end - start) / duration) * 100, 0.25, Math.max(0.25, 100 - left));
    return `<i class="voice-highlight-segment${segment.active ? ' is-live' : ''}" style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%"></i>`;
  }).join('');
}

function renderLiveVoiceHighlights(force = false) {
  const now = performance.now();
  if (!force && now - state.voiceHighlightLastRenderAt < 180) return;
  state.voiceHighlightLastRenderAt = now;
  const active = Boolean(state.mediaRecorder && state.mediaRecorder.state !== 'inactive');
  const hasMic = recordingMicrophoneTracks().length > 0 && !state.recordingMicMuted;
  const visible = active && (hasMic || state.liveVoiceHighlights.length || state.liveVoiceHighlightActive);
  $('recordingVoiceHighlights')?.classList.toggle('hidden', !visible);
  $('compactVoiceHighlights')?.classList.toggle('hidden', !visible);
  const durationSeconds = Math.max(0.2, elapsedMs() / 1000);
  renderVoiceHighlightTrack($('recordingVoiceHighlightTrack'), state.liveVoiceHighlights, durationSeconds, state.liveVoiceHighlightActive);
  renderVoiceHighlightTrack($('compactVoiceHighlightTrack'), state.liveVoiceHighlights, durationSeconds, state.liveVoiceHighlightActive);
  const count = normalizeLiveVoiceHighlights(durationSeconds).length;
  if ($('recordingVoiceHighlightCount')) $('recordingVoiceHighlightCount').textContent = count ? `${count} section${count === 1 ? '' : 's'}` : 'Listening';
  if ($('compactVoiceHighlightCount')) $('compactVoiceHighlightCount').textContent = count ? String(count) : 'Live';
}

function closeLiveVoiceHighlight(endSeconds, confidence = 0.76) {
  const active = state.liveVoiceHighlightActive;
  if (!active) return;
  const end = Math.max(Number(active.start) || 0, Number(endSeconds) || 0);
  if (end - active.start >= 0.18) state.liveVoiceHighlights.push({ start: active.start, end, confidence: Math.max(active.confidence || 0, confidence) });
  state.liveVoiceHighlightActive = null;
  state.liveVoiceHighlightCandidateFrames = 0;
}

function resetLiveVoiceHighlightAnalysis() {
  clearTimeout(state.voiceHighlightTimer);
  state.voiceHighlightTimer = null;
  try { state.voiceHighlightMicSourceNode?.disconnect?.(); } catch {}
  state.voiceHighlightMicSourceNode = null;
  state.voiceHighlightMicAnalyser = null;
  state.liveVoiceHighlights = [];
  state.liveVoiceHighlightActive = null;
  state.liveVoiceHighlightCandidateFrames = 0;
  state.liveVoiceHighlightReleaseUntil = 0;
  state.voiceHighlightHistory = [];
  state.voiceHighlightNoiseFloorDb = -58;
  state.voiceHighlightLeakGainDb = null;
  state.voiceHighlightLastRenderAt = 0;
  renderLiveVoiceHighlights(true);
}

function stopLiveVoiceHighlightAnalysis(finalize = true) {
  clearTimeout(state.voiceHighlightTimer);
  state.voiceHighlightTimer = null;
  if (finalize && state.liveVoiceHighlightActive) closeLiveVoiceHighlight(Math.max(0, elapsedMs() / 1000), 0.75);
  renderLiveVoiceHighlights(true);
}

function attachReadOnlyVoiceHighlightMicAnalyser() {
  try { state.voiceHighlightMicSourceNode?.disconnect?.(); } catch {}
  state.voiceHighlightMicSourceNode = null;
  state.voiceHighlightMicAnalyser = null;
  if (!state.audioContext) return null;

  // Prefer the conferencing-processed observation stream for My Voice. It is a
  // read-only branch with AEC/noise suppression/voice isolation enabled and is much
  // better at rejecting Teams/Zoom audio leaking from the MacBook speakers. The raw
  // microphone remains the fallback only when that observation stream is unavailable.
  // Neither branch is connected back to the recording mixer.
  const stream = state.processedMicStream?.getAudioTracks?.().length
    ? state.processedMicStream
    : state.micStream;
  if (!stream?.getAudioTracks?.().length) return null;
  try {
    const source = state.audioContext.createMediaStreamSource(stream);
    const analyser = state.audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.48;
    source.connect(analyser);
    state.voiceHighlightMicSourceNode = source;
    state.voiceHighlightMicAnalyser = analyser;
    return analyser;
  } catch (error) {
    console.debug('Read-only My Voice analyser was unavailable.', error);
    return null;
  }
}

function startLiveVoiceHighlightAnalysis() {
  clearTimeout(state.voiceHighlightTimer);
  const micAnalyser = state.voiceHighlightMicAnalyser || state.analyser;
  if (!micAnalyser) { renderLiveVoiceHighlights(true); return; }
  const systemAnalyser = state.systemAnalyser;
  const micTime = new Float32Array(micAnalyser.fftSize);
  const sysTime = systemAnalyser ? new Float32Array(systemAnalyser.fftSize) : null;
  const micFreq = new Float32Array(micAnalyser.frequencyBinCount);
  const sysFreq = systemAnalyser ? new Float32Array(systemAnalyser.frequencyBinCount) : null;
  const tick = () => {
    const recorderActive = Boolean(state.mediaRecorder && state.mediaRecorder.state !== 'inactive');
    if (!recorderActive) { state.voiceHighlightTimer = null; return; }
    const nowMs = Math.max(0, elapsedMs());
    const paused = state.mediaRecorder?.state === 'paused';
    const micAvailable = recordingMicrophoneTracks().length > 0 && !state.recordingMicMuted;
    if (paused || !micAvailable) {
      closeLiveVoiceHighlight(nowMs / 1000, 0.7);
      renderLiveVoiceHighlights();
      state.voiceHighlightTimer = setTimeout(tick, 90);
      return;
    }

    const micLevel = analyserDbfs(micAnalyser, micTime);
    const micProfile = voiceHighlightFrequencyProfile(micAnalyser, micFreq);
    let sysLevel = { db: -100, percent: 0 };
    let sysProfile = null;
    if (systemAnalyser && sysTime && sysFreq) {
      sysLevel = analyserDbfs(systemAnalyser, sysTime);
      sysProfile = voiceHighlightFrequencyProfile(systemAnalyser, sysFreq);
    }
    const frame = {
      t: nowMs,
      micDb: micLevel.db,
      sysDb: sysLevel.db,
      micProfile: micProfile?.profile || [],
      sysProfile: sysProfile?.profile || []
    };
    state.voiceHighlightHistory.push(frame);
    while (state.voiceHighlightHistory.length > 42 || (state.voiceHighlightHistory[0] && nowMs - state.voiceHighlightHistory[0].t > 3200)) state.voiceHighlightHistory.shift();

    const currentFloor = state.voiceHighlightNoiseFloorDb;
    const voiceLift = micProfile ? micProfile.voiceDb - currentFloor : micLevel.db - currentFloor;
    const lowDominance = micProfile ? micProfile.lowDb - micProfile.voiceDb : 0;
    const energySpeech = micLevel.db > Math.max(-54, currentFloor + 7.5)
      && (!micProfile || micProfile.voiceDb > Math.max(-58, currentFloor + 4.5))
      && lowDominance < 8.5;
    if (!energySpeech && micLevel.db < currentFloor + 4) {
      state.voiceHighlightNoiseFloorDb = clamp(currentFloor * 0.96 + micLevel.db * 0.04, -72, -42);
    }

    const leak = systemAnalyser ? voiceHighlightLeakMatch(nowMs) : { matched: false, score: 0, gainDb: null, residualDb: 99 };
    if (leak.matched && leak.gainDb != null) {
      state.voiceHighlightLeakGainDb = state.voiceHighlightLeakGainDb == null
        ? leak.gainDb
        : state.voiceHighlightLeakGainDb * 0.88 + leak.gainDb * 0.12;
    }
    const systemSpeaking = sysLevel.db > -55;
    const residualOwnVoice = leak.matched && leak.residualDb >= 6.5;
    const enrolledFingerprint = state.voiceEnrollmentProfile?.enrolled ? state.voiceEnrollmentProfile.spectralFingerprint : null;
    const enrolledSimilarity = micProfile?.profile?.length && enrolledFingerprint?.length
      ? voiceHighlightProfileSimilarity(micProfile.profile, enrolledFingerprint)
      : null;
    const enrollmentRejectsRemoteLeak = systemSpeaking && leak.matched && leak.score >= 0.54
      && enrolledSimilarity != null && enrolledSimilarity < 0.08 && !residualOwnVoice;
    const likelyRemoteLeak = energySpeech && systemSpeaking && leak.matched && leak.score >= 0.66 && !residualOwnVoice;
    const localSpeech = energySpeech && !likelyRemoteLeak && !enrollmentRejectsRemoteLeak && voiceLift > 5.5;

    if (localSpeech) {
      state.liveVoiceHighlightCandidateFrames += 1;
      state.liveVoiceHighlightReleaseUntil = nowMs + 330;
      if (!state.liveVoiceHighlightActive && state.liveVoiceHighlightCandidateFrames >= 2) {
        const start = Math.max(0, (nowMs - 170) / 1000);
        const enrollmentBoost = enrolledSimilarity != null && enrolledSimilarity >= 0.45 ? 0.06 : 0;
        state.liveVoiceHighlightActive = { start, confidence: clamp(0.66 + Math.min(0.25, Math.max(0, voiceLift - 6) / 28) + (systemSpeaking ? 0 : 0.05) + enrollmentBoost, 0.58, 0.96) };
      } else if (state.liveVoiceHighlightActive) {
        state.liveVoiceHighlightActive.confidence = Math.max(state.liveVoiceHighlightActive.confidence || 0, clamp(0.68 + Math.max(0, voiceLift - 7) / 35, 0.68, 0.96));
      }
    } else {
      state.liveVoiceHighlightCandidateFrames = Math.max(0, state.liveVoiceHighlightCandidateFrames - 1);
      if (state.liveVoiceHighlightActive && nowMs >= state.liveVoiceHighlightReleaseUntil) closeLiveVoiceHighlight(Math.max(state.liveVoiceHighlightActive.start, (nowMs - 120) / 1000), 0.74);
    }
    renderLiveVoiceHighlights();
    state.voiceHighlightTimer = setTimeout(tick, 90);
  };
  tick();
}

function startMeter() {
  clearTimeout(state.meterHandle);
  const micAnalyser = state.analyser;
  const systemAnalyser = state.systemAnalyser;
  if (!micAnalyser && !systemAnalyser) {
    $('audioMeter').style.width = '0%';
    updatePreflightSystemIdleState();
    return;
  }
  const frequencyData = micAnalyser ? new Uint8Array(micAnalyser.frequencyBinCount) : null;
  const micTimeData = micAnalyser ? new Float32Array(micAnalyser.fftSize) : null;
  const systemTimeData = systemAnalyser ? new Float32Array(systemAnalyser.fftSize) : null;
  const tick = () => {
    const paused = state.mediaRecorder?.state === 'paused';
    if (micAnalyser && frequencyData) {
      micAnalyser.getByteFrequencyData(frequencyData);
      const avg = frequencyData.reduce((a, b) => a + b, 0) / frequencyData.length;
      $('audioMeter').style.width = `${Math.min(100, avg * 1.25)}%`;
      if (recordingMicrophoneTracks().length > 0 && !state.recordingMicMuted) {
        const level = analyserDbfs(micAnalyser, micTimeData);
        const health = micHealthForDb(level.db);
        state.preflightMicHealth = health.label;
        setRecordAudioMeter('preflightMicRow', 'preflightMicMeter', 'preflightMicLevel', level.percent, health.label, health.tone);
        setCompactActivityMeter('mic', paused ? 0 : level.percent, paused ? 'Paused' : health.label);
      } else {
        const mutedLabel = state.recordingMicMuted ? 'Muted' : 'Off';
        setRecordAudioMeter('preflightMicRow', 'preflightMicMeter', 'preflightMicLevel', 0, mutedLabel, 'muted');
        setCompactActivityMeter('mic', 0, mutedLabel);
      }
    } else {
      $('audioMeter').style.width = '0%';
      const micLabel = state.recordingMicMuted ? 'Muted' : (recordingMicrophoneTracks().length ? 'Active' : 'Off');
      setRecordAudioMeter('preflightMicRow', 'preflightMicMeter', 'preflightMicLevel', 0, micLabel, state.recordingMicMuted || recordingMicrophoneTracks().length === 0 ? 'muted' : 'live');
      setCompactActivityMeter('mic', 0, paused ? 'Paused' : micLabel);
    }
    if (!$('systemAudio')?.checked) {
      setRecordAudioMeter('preflightSystemRow', 'preflightSystemMeter', 'preflightSystemLevel', 0, 'Off', 'muted');
      setCompactActivityMeter('system', 0, 'Off');
    } else if (systemAnalyser) {
      const level = analyserDbfs(systemAnalyser, systemTimeData);
      setRecordAudioMeter('preflightSystemRow', 'preflightSystemMeter', 'preflightSystemLevel', level.percent, 'Live', 'live');
      setCompactActivityMeter('system', paused ? 0 : level.percent, paused ? 'Paused' : 'Live');
    } else {
      const appMode = $('computerAudioMode')?.value === 'application';
      setRecordAudioMeter('preflightSystemRow', 'preflightSystemMeter', 'preflightSystemLevel', 0, appMode ? 'App active' : 'Active', 'live');
      setCompactActivityMeter('system', paused ? 0 : (appMode ? 34 : 18), paused ? 'Paused' : (appMode ? 'App' : 'Active'));
    }
    // Do not keep a requestAnimationFrame loop alive at the display's 60/120 Hz
    // while recording. The meters are informational, so a low-frequency timer keeps
    // the renderer mostly asleep between user input events and materially reduces
    // long-session Full View pointer contention.
    const meterInterval = state.viewMode === 'compact' ? 120 : 1000;
    state.meterHandle = setTimeout(tick, meterInterval);
  };
  tick();
}

function cleanupStreams() {
  if (state.micRecorder && state.micRecorder.state !== 'inactive') {
    try { state.micRecorder.stop(); } catch {}
  }
  if (state.neuralMicRecorder && state.neuralMicRecorder.state !== 'inactive') {
    try { state.neuralMicRecorder.stop(); } catch {}
  }
  state.micRecorder = null;
  state.neuralMicRecorder = null;
  for (const stream of [...state.captureStreams, state.compositeStream, state.micStream, state.speechMicStream, state.processedMicStream, state.webcamStream, state.mixedStream]) {
    stream?.getTracks().forEach((track) => track.stop());
  }
  state.captureStreams = [];
  state.captureVideos.forEach((video) => { try { video.pause(); video.srcObject = null; } catch {} });
  state.captureVideos = [];
  state.compositeStream = null;
  state.directCapturePassThrough = false;
  state.compositeCanvas = null;
  state.compositeContext = null;
  state.compositeLayout = null;
  state.micStream = null;
  state.recordingMicMuted = false;
  state.recordingMicCanStart = false;
  state.recordingMicStarting = false;
  state.recordingMicStartOffsetMs = null;
  state.recordingMicMimeType = '';
  state.recordingNeuralMicMimeType = '';
  state.speechMicStream = null;
  state.processedMicStream = null;
  state.micWriteQueue = Promise.resolve();
  state.neuralMicWriteQueue = Promise.resolve();
  state.neuralMicMethod = 'none';
  state.webcamStream = null;
  if (state.webcamVideo) { try { state.webcamVideo.pause(); state.webcamVideo.srcObject = null; } catch {} }
  state.webcamVideo = null;
  state.mixedStream = null;
  clearTimeout(state.meterHandle);
  state.meterHandle = null;
  clearTimeout(state.voiceHighlightTimer);
  state.voiceHighlightTimer = null;
  try { state.voiceHighlightMicSourceNode?.disconnect?.(); } catch {}
  state.voiceHighlightMicSourceNode = null;
  state.voiceHighlightMicAnalyser = null;
  cancelAnimationFrame(state.compositorHandle);
  clearTimeout(state.compositorTimer);
  state.compositorTimer = null;
  if (state.compositorVideoFrameTarget && state.compositorVideoFrameHandle != null && typeof state.compositorVideoFrameTarget.cancelVideoFrameCallback === 'function') {
    try { state.compositorVideoFrameTarget.cancelVideoFrameCallback(state.compositorVideoFrameHandle); } catch {}
  }
  state.compositorVideoFrameHandle = null;
  state.compositorVideoFrameTarget = null;
  state.captureReconnectGeneration += 1;
  state.captureReconnectInProgress = false;
  clearTimeout(state.captureReconnectRetryTimer);
  state.captureReconnectRetryTimer = null;
  clearInterval(state.cursorPollTimer);
  state.cursorPollTimer = null;
  state.cursorPoint = null;
  state.nativeCursorCapture = false;
  state.recentKeystrokes = [];
  $('audioMeter').style.width = '0%';
  setCompactActivityMeter('mic', 0, 'Off');
  setCompactActivityMeter('system', 0, 'Off');
  if (state.deepFilterProcessor) {
    try { state.deepFilterProcessor.destroy?.(); } catch {}
    state.deepFilterProcessor = null;
  }
  try { state.rnnoiseSourceNode?.disconnect?.(); } catch {}
  try { state.rnnoiseNode?.disconnect?.(); } catch {}
  try { state.rnnoiseNode?.destroy?.(); } catch {}
  state.rnnoiseSourceNode = null;
  state.rnnoiseNode = null;
  state.rnnoiseDestination = null;
  if (state.audioContext) state.audioContext.close().catch(() => {});
  try { state.systemAudioSourceNode?.disconnect?.(); } catch {}
  state.audioContext = null;
  state.analyser = null;
  state.systemAnalyser = null;
  state.mainAudioDestination = null;
  state.systemAudioSourceNode = null;
  state.compositeCanvas = null;
  state.compositeContext = null;
  state.compositeLayout = null;
  $('preview').srcObject = null;
  window.recorderAPI.setKeystrokeCaptureEnabled(false).catch(() => {});
}

function captureSourceIdentityMatches(candidate, source) {
  if (!candidate || candidate.kind !== 'screen') return false;
  if (source?.displayId && candidate.displayId && String(source.displayId) === String(candidate.displayId)) return true;
  if (source?.id && candidate.id === source.id) return true;
  return Boolean(source?.name && candidate.name === source.name);
}

function attachCaptureSourceLifecycle(capture, captureIndex) {
  if (!capture?.stream) return;
  const videoTrack = capture.stream.getVideoTracks()[0];
  const audioTrack = capture.stream.getAudioTracks()[0];
  let muteReconnectTimer = null;
  videoTrack?.addEventListener('ended', () => {
    clearTimeout(muteReconnectTimer);
    handleCaptureSourceEnded(capture.source, 'video', captureIndex);
  }, { once: true });
  videoTrack?.addEventListener('mute', () => {
    window.recorderAPI.logEvent?.('warn', 'renderer.capture-track-muted', {
      kind: 'video', sourceName: capture.source?.name || '', sourceId: capture.source?.id || '',
      elapsedMs: elapsedMs(), directCapturePassThrough: Boolean(state.directCapturePassThrough), settings: videoTrack.getSettings?.() || {}
    });
    if (capture.source?.kind !== 'screen' || state.activeRecordingMeta?.captureMode !== 'source') return;
    clearTimeout(muteReconnectTimer);
    if (state.directCapturePassThrough) {
      // A muted native track can resume by itself after a short OS/session event. Do
      // not tear down a healthy file merely because no frames are arriving briefly.
      // MediaRecorder keeps the container valid and the unmute event clears this state.
      muteReconnectTimer = setTimeout(() => {
        if (videoTrack.muted && videoTrack.readyState === 'live' && state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
          setStatus('The display is temporarily not providing frames. Recording remains open and will continue automatically when the display resumes.', true);
        }
      }, 2200);
      return;
    }
    muteReconnectTimer = setTimeout(() => {
      if (videoTrack.muted && videoTrack.readyState === 'live') void reconnectEntireScreenCapture(capture.source, captureIndex);
    }, 1800);
  });
  videoTrack?.addEventListener('unmute', () => {
    clearTimeout(muteReconnectTimer);
    muteReconnectTimer = null;
    window.recorderAPI.logEvent?.('info', 'renderer.capture-track-unmuted', {
      kind: 'video', sourceName: capture.source?.name || '', sourceId: capture.source?.id || '', elapsedMs: elapsedMs()
    });
  });
  audioTrack?.addEventListener('mute', () => window.recorderAPI.logEvent?.('warn', 'renderer.system-audio-track-muted', {
    sourceName: capture.source?.name || '', sourceId: capture.source?.id || '', elapsedMs: elapsedMs()
  }));
  audioTrack?.addEventListener('unmute', () => window.recorderAPI.logEvent?.('info', 'renderer.system-audio-track-unmuted', {
    sourceName: capture.source?.name || '', sourceId: capture.source?.id || '', elapsedMs: elapsedMs()
  }));
  audioTrack?.addEventListener('ended', () => handleCaptureSourceEnded(capture.source, 'audio', captureIndex), { once: true });
}

async function reconnectEntireScreenCapture(source, captureIndex = 0) {
  if (state.captureReconnectInProgress || state.isStopping || !state.mediaRecorder || state.mediaRecorder.state === 'inactive') return false;
  if (source?.kind !== 'screen' || state.activeRecordingMeta?.captureMode !== 'source' || state.compositeLayout?.mode !== 'source') return false;
  state.captureReconnectInProgress = true;
  clearTimeout(state.captureReconnectRetryTimer);
  state.captureReconnectRetryTimer = null;
  const generation = ++state.captureReconnectGeneration;
  setStatus('Entire-screen capture was interrupted by the OS. Reconnecting the same display while the recording stays protected…', true);
  showToast('Screen capture interrupted — reconnecting', 'warning', 4200);
  const waits = [150, 450, 900, 1600, 2800, 4500];
  let replacementStream = null;
  let replacementVideo = null;
  try {
    for (let attempt = 0; attempt < waits.length; attempt += 1) {
      if (generation !== state.captureReconnectGeneration || state.isStopping || !state.mediaRecorder || state.mediaRecorder.state === 'inactive') return false;
      if (waits[attempt]) await new Promise((resolve) => setTimeout(resolve, waits[attempt]));
      try {
        const available = await window.recorderAPI.listSources();
        const candidate = (available || []).find((item) => captureSourceIdentityMatches(item, source));
        if (!candidate) continue;
        await window.recorderAPI.selectSource(candidate.id);
        const wantsSystemAudio = computerAudioModeValue() === 'system';
        const replacement = await acquireCaptureSource(candidate, wantsSystemAudio, 'source');
        replacementStream = replacement.stream;
        replacementVideo = await videoForStream(replacementStream);
        if (generation !== state.captureReconnectGeneration || state.isStopping || !state.mediaRecorder || state.mediaRecorder.state === 'inactive') {
          replacementStream.getTracks().forEach((track) => track.stop());
          try { replacementVideo.pause(); replacementVideo.srcObject = null; } catch {}
          return false;
        }

        const item = state.compositeLayout?.items?.[0];
        if (!item) throw new Error('The screen relay is no longer active.');
        const oldStream = state.captureStreams[captureIndex];
        const oldVideo = state.captureVideos[captureIndex];
        item.source = candidate;
        item.stream = replacementStream;
        item.video = replacementVideo;
        state.compositeLayout.crop = { x: 0, y: 0, w: Math.max(1, replacementVideo.videoWidth), h: Math.max(1, replacementVideo.videoHeight) };
        state.captureStreams[captureIndex] = replacementStream;
        state.captureVideos[captureIndex] = replacementVideo;

        // If system audio belonged to the same display capture, reconnect that
        // source into the existing AudioContext destination too. The destination's
        // output track never changes, so MediaRecorder remains on the same stable
        // audio track just like the canvas relay keeps the video track stable.
        const replacementAudioTrack = replacementStream.getAudioTracks()[0];
        if (replacementAudioTrack && state.audioContext && state.mainAudioDestination) {
          try { state.systemAudioSourceNode?.disconnect?.(); } catch {}
          const replacementAudioSource = state.audioContext.createMediaStreamSource(new MediaStream([replacementAudioTrack]));
          replacementAudioSource.connect(state.mainAudioDestination);
          if (state.systemAnalyser) replacementAudioSource.connect(state.systemAnalyser);
          state.systemAudioSourceNode = replacementAudioSource;
        }

        attachCaptureSourceLifecycle({ source: candidate, stream: replacementStream }, captureIndex);
        if (state.activeRecordingMeta) {
          state.activeRecordingMeta.sourceName = candidate.name || state.activeRecordingMeta.sourceName;
          state.activeRecordingMeta.sourceDisplayId = candidate.displayId || state.activeRecordingMeta.sourceDisplayId || '';
          state.activeRecordingMeta.sourceId = candidate.id || state.activeRecordingMeta.sourceId || '';
        }
        try { oldStream?.getTracks?.().forEach((track) => track.stop()); } catch {}
        try { oldVideo?.pause(); if (oldVideo) oldVideo.srcObject = null; } catch {}
        replacementStream = null;
        replacementVideo = null;
        clearTimeout(state.captureReconnectRetryTimer);
        state.captureReconnectRetryTimer = null;
        setStatus('Entire-screen capture reconnected to the same display. Recording continued without replacing the recording stream.');
        showToast('Screen capture reconnected');
        return true;
      } catch (error) {
        if (replacementStream) { try { replacementStream.getTracks().forEach((track) => track.stop()); } catch {} }
        if (replacementVideo) { try { replacementVideo.pause(); replacementVideo.srcObject = null; } catch {} }
        replacementStream = null;
        replacementVideo = null;
        console.warn(`Screen reconnect attempt ${attempt + 1} failed:`, error);
      }
    }
    setStatus('The OS did not restore the entire-screen source yet. The recorder relay is keeping the file structurally valid with the last available frame and will retry the same display automatically.', true);
    showToast('Screen source still unavailable — recording file remains protected', 'warning', 7000);
    clearTimeout(state.captureReconnectRetryTimer);
    state.captureReconnectRetryTimer = setTimeout(() => {
      state.captureReconnectRetryTimer = null;
      if (!state.isStopping && state.mediaRecorder && state.mediaRecorder.state !== 'inactive') void reconnectEntireScreenCapture(source, captureIndex);
    }, 20000);
    return false;
  } finally {
    if (generation === state.captureReconnectGeneration) state.captureReconnectInProgress = false;
  }
}

function handleCaptureSourceEnded(source, kind = 'video', captureIndex = 0) {
  if (state.isStopping || !state.mediaRecorder || state.mediaRecorder.state === 'inactive') return;
  if (kind === 'video' && source?.kind === 'screen' && state.activeRecordingMeta?.captureMode === 'source') {
    if (state.directCapturePassThrough) {
      // The smooth path records the OS screen track directly. If that track actually
      // ends (not just mutes), changing MediaRecorder's track set mid-file is unsafe.
      // Seal the chunks we already have instead of risking a corrupt MP4.
      const reason = 'The operating system ended the entire-screen capture source.';
      setStatus(`${reason} Saving the recording captured so far.`, true);
      showToast('Screen source ended — saving the recording safely', 'warning', 8000);
      window.recorderAPI.logEvent?.('error', 'renderer.capture-track-ended', { kind: 'video', sourceName: source?.name || '', sourceId: source?.id || '', directCapturePassThrough: true, elapsedMs: elapsedMs() });
      setTimeout(() => {
        if (state.mediaRecorder && !state.isStopping) stopRecording({ automaticReason: reason, forceFinalize: state.mediaRecorder.state === 'inactive' });
      }, 0);
      return;
    }
    // Composite/overlay recordings use a stable canvas relay, so the encoded
    // MediaRecorder track remains alive while the same display is reconnected.
    void reconnectEntireScreenCapture(source, captureIndex);
    return;
  }
  const sourceName = String(source?.name || 'the selected source');
  const at = formatTime(elapsedMs());
  const isAudio = kind === 'audio';
  const message = isAudio
    ? `System audio from “${sourceName}” was interrupted at ${at}. The recording is still running; microphone/video capture will continue.`
    : `Screen capture from “${sourceName}” was interrupted at ${at}. The recording relay is still running so the file remains valid; the affected section may hold the last frame until capture is available again.`;
  console.warn(message);
  window.recorderAPI.logEvent?.('warn', 'renderer.capture-track-interrupted', { kind, sourceName, sourceId: source?.id || '', elapsedMs: elapsedMs(), message });
  setStatus(message, true);
  showToast(isAudio ? 'System audio interrupted — recording is still running' : 'Screen source interrupted — recording file remains protected', 'warning', 6500);
}

async function startRecording() {
  if (state.isStarting || state.isStopping || (state.mediaRecorder && state.mediaRecorder.state !== 'inactive')) return;
  state.isStarting = true;
  stopPreflightMicMonitor(false);
  setRecordConfigurationLocked(true);
  setStartButtonPhase('preparing');
  $('startButton').disabled = true;
  $('compactStartButton').disabled = true;
  setStatus('Preparing recording…');
  try {
    const recordingKind = recordingKindValue();
    const audioOnly = recordingKind === 'audio';
    const audioMode = computerAudioModeValue();
    const needsSource = !audioOnly || audioMode !== 'off';
    // Source enumeration is intentionally lazy when macOS has not yet granted Screen
    // Recording access. Pressing Start is an explicit user action, so this is the
    // earliest point at which an unavoidable OS screen-permission prompt may appear.
    if (needsSource && !state.sources.length) {
      const loaded = await refreshSources();
      if (!loaded) throw new Error('No screen or window source is available. Allow Screen Recording access if macOS asks, then try again.');
    }
    const plan = needsSource ? capturePlan() : { mode: 'audio', sources: [] };
    state.nativeCursorCapture = false;
    const selected = plan.sources[0] || selectedSource();

    if (audioMode === 'application') {
      if (!selected || selected.kind !== 'window') throw new Error('Selected-application audio requires a window source. Choose the application window you want to record.');
      if (!state.platformInfo?.applicationAudioSupported) throw new Error('Selected-application audio is not available on this operating system in this build.');
      const appAudio = await window.recorderAPI.startApplicationAudioCapture({ windowTitle: selected.name, sourceId: selected.id });
      state.applicationAudioPath = appAudio?.path || null;
      if (!state.applicationAudioPath) throw new Error('The application-audio helper did not start.');
    } else {
      state.applicationAudioPath = null;
    }

    const needsDisplayCapture = !audioOnly || audioMode === 'system';
    const captureSources = needsDisplayCapture ? (audioOnly ? plan.sources.slice(0, 1) : plan.sources) : [];
    const captures = [];
    for (let index = 0; index < captureSources.length; index += 1) {
      captures.push(await acquireCaptureSource(captureSources[index], audioMode === 'system' && index === 0, plan.mode));
    }
    state.captureStreams = captures.map((item) => item.stream);

    if (audioMode === 'system' && !state.captureStreams.some((stream) => stream.getAudioTracks().length)) {
      setStatus('Capture started, but the OS did not provide a system-audio track. Check screen/system-audio permissions.', true);
    }

    if (!audioOnly && $('highlightCursor').checked && plan.sources.length === 1 && plan.sources[0].kind === 'window') {
      setStatus('Mouse highlighting is available for display/region/all-display capture. Window capture will still follow the Show cursor setting.');
    }

    if (!audioOnly && $('showKeystrokes').checked) {
      const hook = await window.recorderAPI.setKeystrokeCaptureEnabled(true);
      if (!hook?.enabled) {
        setStatus(hook?.disabledForPlatform
          ? 'Recording continues normally. Show keystrokes is disabled on macOS so keyboard and mouse remain responsive after sleep/wake.'
          : 'Recording will continue normally, but the keystroke overlay is unavailable. Check accessibility/input permissions if you want to use it.', true);
      }
    }

    if (!audioOnly && $('webcamOverlay')?.checked) {
      state.webcamStream = await createWebcamStream();
      state.webcamVideo = state.webcamStream ? await videoForStream(state.webcamStream) : null;
    }

    state.compositeStream = audioOnly ? null : await buildCompositeStream(plan, captures);
    const microphoneInitiallyEnabled = Boolean($('microphone')?.checked);
    state.recordingMicCanStart = true;
    state.recordingMicStarting = false;
    state.recordingMicMuted = !microphoneInitiallyEnabled;
    state.recordingMicStartOffsetMs = microphoneInitiallyEnabled ? 0 : null;
    state.micStream = await createMicStream();
    attachRecordingMicrophoneLifecycle(state.micStream);
    state.speechMicStream = null;
    state.mixedStream = await buildMixedStream(state.compositeStream, state.captureStreams, state.micStream);

    await runRecordingCountdown();

    const mimeType = audioOnly ? chooseAudioMimeType() : chooseMimeType();
    const microphoneNoiseMode = $('noiseReduction')?.value || 'off';
    // Reserve recoverable microphone sidecars even when Mic starts Off. This lets the
    // Mini/Full in-recording control enable the microphone later without restarting
    // the PulseStudio. Empty reserved files are discarded automatically.
    const microphoneMimeType = chooseMicrophoneMimeType();
    const neuralMicrophoneMimeType = chooseMicrophoneMimeType();
    state.recordingMicMimeType = microphoneMimeType || 'audio/webm';
    state.recordingNeuralMicMimeType = neuralMicrophoneMimeType || 'audio/webm';
    state.activeRecordingMeta = {
      recordingKind,
      filenameTemplate: filenameTemplateForStyle(),
      sourceName: selected?.name || 'Audio',
      sourceId: selected?.id || '',
      sourceDisplayId: selected?.displayId || '',
      sourceKind: selected?.kind || '',
      captureMode: plan.mode,
      applicationAudio: audioMode === 'application',
      systemAudioMode: audioMode,
      videoCodec: videoCodecValue(),
      frameRate: frameRateValue(),
      noiseReduction: microphoneNoiseMode,
      microphoneCaptureProfile: (microphoneNoiseMode === 'enhanced' || microphoneNoiseMode === 'strong' || microphoneNoiseMode === 'off') ? 'source-preserving' : 'browser-standard',
      microphoneInitiallyEnabled,
      microphoneStartOffsetMs: state.recordingMicStartOffsetMs,
      neuralMicrophoneMethod: state.neuralMicMethod || 'none'
    };
    await window.recorderAPI.beginRecordingFile({
      mimeType: mimeType || (audioOnly ? 'audio/webm' : 'video/webm'),
      recordingKind,
      filenameTemplate: state.activeRecordingMeta.filenameTemplate,
      hasMicrophone: true,
      microphoneMimeType: microphoneMimeType || 'audio/webm',
      hasNeuralMicrophone: ['enhanced', 'strong'].includes(microphoneNoiseMode),
      neuralMicrophoneMimeType: neuralMicrophoneMimeType || 'audio/webm',
      neuralMicrophoneMethod: state.neuralMicMethod || 'none',
      microphoneNoiseMode,
      meta: state.activeRecordingMeta
    });
    state.writeQueue = Promise.resolve();
    state.recordingWriteError = null;
    state.recordingChunkQueueDepth = 0;
    state.recordingChunkMaxWriteMs = 0;
    state.micWriteQueue = Promise.resolve();
    state.neuralMicWriteQueue = Promise.resolve();

    const options = { audioBitsPerSecond: 192_000 };
    if (!audioOnly) options.videoBitsPerSecond = recordingVideoBitrate();
    if (mimeType) options.mimeType = mimeType;
    state.mediaRecorder = new MediaRecorder(state.mixedStream, options);

    state.mediaRecorder.addEventListener('dataavailable', (event) => {
      if (!event.data || event.data.size === 0) return;
      const chunk = event.data;
      state.recordingChunkQueueDepth += 1;
      state.writeQueue = state.writeQueue.then(async () => {
        const writeStarted = performance.now();
        try {
          if (state.recordingWriteError) return;
          const data = await chunk.arrayBuffer();
          await window.recorderAPI.appendRecordingChunk(data);
        } catch (error) {
          state.recordingWriteError = error instanceof Error ? error : new Error(String(error));
          console.error('Recording chunk write failed; stopping safely to protect the recorded data.', state.recordingWriteError);
          const reason = `A recording chunk could not be written: ${friendlyErrorText(state.recordingWriteError)}`;
          setStatus(`${reason} Stopping safely to protect the data already written.`, true);
          window.recorderAPI.logEvent?.('error', 'renderer.recording-chunk-write-failed', { error: String(state.recordingWriteError?.message || state.recordingWriteError || ''), elapsedMs: elapsedMs() });
          setTimeout(() => { if (state.mediaRecorder && !state.isStopping) stopRecording({ automaticReason: reason, forceFinalize: state.mediaRecorder.state === 'inactive' }); }, 0);
        } finally {
          state.recordingChunkQueueDepth = Math.max(0, state.recordingChunkQueueDepth - 1);
          state.recordingChunkMaxWriteMs = Math.max(state.recordingChunkMaxWriteMs || 0, performance.now() - writeStarted);
        }
      });
    });

    state.mediaRecorder.addEventListener('error', (event) => {
      const recorderError = event.error || new Error('The media encoder reported an unexpected error.');
      const reason = `The media encoder stopped unexpectedly: ${friendlyErrorText(recorderError)}`;
      setStatus(`${reason} Saving the captured portion.`, true);
      window.recorderAPI.logEvent?.('error', 'renderer.media-recorder-error', { error: String(recorderError?.message || recorderError || ''), elapsedMs: elapsedMs() });
      setTimeout(() => { if (state.mediaRecorder && !state.isStopping) stopRecording({ automaticReason: reason, forceFinalize: state.mediaRecorder.state === 'inactive' }); }, 0);
    });
    state.mediaRecorder.addEventListener('stop', () => {
      if (state.isStopping || !state.startedAt) return;
      const reason = state.recordingHealth?.level && state.recordingHealth.level !== 'ok' && state.recordingHealth.message ? state.recordingHealth.message : 'The capture pipeline stopped without a user Stop command.';
      window.recorderAPI.logEvent?.('error', 'renderer.media-recorder-unexpected-stop', { elapsedMs: elapsedMs(), tracks: (state.mixedStream?.getTracks?.() || []).map((track) => ({ kind: track.kind, readyState: track.readyState, muted: Boolean(track.muted) })) });
      setTimeout(() => { if (state.mediaRecorder && !state.isStopping) stopRecording({ automaticReason: reason, forceFinalize: true }); }, 0);
    });

    state.micRecorder = createRawMicrophoneRecorder(state.micStream);
    state.neuralMicRecorder = createNeuralMicrophoneRecorder(state.processedMicStream);

    captures.forEach((capture, captureIndex) => attachCaptureSourceLifecycle(capture, captureIndex));

    // Smaller video chunks reduce the large ArrayBuffer/IPC allocation bursts that
    // can briefly stall pointer/compositor work in long Full View recordings. Audio
    // sidecars remain at 2 s because their chunks are tiny.
    state.mediaRecorder.start(500);
    state.micRecorder?.start(2000);
    state.neuralMicRecorder?.start(2000);
    window.recorderAPI.logEvent?.('info', 'renderer.recording-started', {
      captureMode: plan.mode,
      sourceName: selected?.name || '',
      sourceKind: selected?.kind || '',
      quality: $('quality')?.value || '',
      requestedFrameRate: frameRateValue(),
      requestedCodec: videoCodecValue(),
      mediaRecorderMimeType: state.mediaRecorder?.mimeType || mimeType || '',
      directCapturePassThrough: Boolean(state.directCapturePassThrough),
      systemAudio: audioMode,
      microphone: Boolean(state.micStream?.getAudioTracks?.().length),
      captureTracks: captures.flatMap((capture) => capture.stream?.getTracks?.() || []).map((track) => ({ kind: track.kind, settings: track.getSettings?.() || {} }))
    });
    state.pendingMarkers = [];
    if (MY_VOICE_HIGHLIGHTS_ENABLED) {
      resetLiveVoiceHighlightAnalysis();
      attachReadOnlyVoiceHighlightMicAnalyser();
    } else {
      state.liveVoiceHighlights = [];
      state.liveVoiceHighlightActive = null;
    }
    state.startedAt = Date.now();
    state.totalPausedMs = 0;
    state.pauseStartedAt = 0;
    startRecordingHealthMonitor();
    startRecordingCheckpointTimer();
    setRecordingUi(true);
    updateTimerDisplay();
    state.timerHandle = setInterval(updateTimerDisplay, state.viewMode === 'compact' ? 250 : 1000);

    // Keep the capture compositor dedicated to encoding. Rendering the captured
    // display back inside Full View can create recursive self-preview and a delayed
    // second cursor, which makes the pointer look sticky/flickery over the recorder.
    // The lightweight recording toolbar and meters remain visible.
    $('preview').srcObject = null;
    $('preview').classList.add('hidden');
    $('recorderPanel').classList.remove('hidden');
    $('resultPanel').classList.add('hidden');
    $('transcriptPanel').classList.add('hidden');
    startMeter();
    if (MY_VOICE_HIGHLIGHTS_ENABLED) startLiveVoiceHighlightAnalysis();
    const audioLabel = audioMode === 'application' ? 'selected-application audio' : audioMode === 'system' ? 'system audio' : 'microphone/audio';
    setStatus(audioOnly
      ? `Recording audio only with ${audioLabel}. M4A saves automatically when stopped.`
      : `Recording ${plan.mode === 'all' ? 'all displays' : plan.mode === 'region' ? 'selected region' : 'selected source'} at ${$('quality').value} / ${frameRateValue()} FPS / ${videoCodecValue() === 'h265' ? 'H.265' : 'H.264'}. MP4 saves automatically when stopped.`);
  } catch (error) {
    cleanupStreams();
    state.pendingMarkers = [];
    state.applicationAudioPath = null;
    state.activeRecordingMeta = null;
    await window.recorderAPI.cancelRecording().catch(() => {});
    setRecordingUi(false);
    setStartButtonPhase('idle');
    setStatus(`Could not start recording. ${friendlyErrorText(error)}`, true);
  } finally {
    state.isStarting = false;
    syncRecordStartAvailability();
    if (!state.mediaRecorder || state.mediaRecorder.state === 'inactive') {
      setRecordConfigurationLocked(false);
      setStartButtonPhase('idle');
    }
    if ((!state.mediaRecorder || state.mediaRecorder.state === 'inactive') && state.currentWorkspace === 'capture') refreshPreflightMicMonitor();
  }
}

function stoppedRecordingUiIsIdle() {
  return !state.isStarting && !state.isStopping && (!state.mediaRecorder || state.mediaRecorder.state === 'inactive');
}

async function finalizeStoppedRecording(sealed, context) {
  const sessionId = sealed?.sessionId;
  if (!sessionId) return { ok: false, error: new Error('Stopped recording did not create a save session.') };
  state.finalizingRecordingSessions.add(sessionId);
  try {
    const result = await window.recorderAPI.finalizeSealedRecording(sessionId);
    if (context.markers.length && Number(result?.markerCount || 0) < context.markers.length) {
      // Compatibility fallback only. v0.2.92 persists runtime bookmarks in the main
      // process before the finalized recording is released from its recovery session.
      await window.recorderAPI.saveRecordingMarkers(result.path, context.markers);
    }
    if (context.stopSequence === state.recordingStopSequence) state.savedPath = result.path;
    await refreshRecordings();
    runAutomaticTranscription(result.path, false);
    return { ok: true, result };
  } catch (error) {
    const protectedForRecovery = /Recovery copy protected|source capture was left in the recovery folder|could not create (?:MP4|M4A)/i.test(String(error?.message || ''));
    if (protectedForRecovery) {
      showRecoveryNotice({
        title: 'Recording needs recovery',
        detail: 'The source recording is protected. You can keep recording normally and recover this file later.'
      });
    }
    return { ok: false, error, protectedForRecovery };
  } finally {
    state.finalizingRecordingSessions.delete(sessionId);
  }
}

async function stopRecording(options = {}) {
  if (state.isStopping || !state.mediaRecorder || (state.mediaRecorder.state === 'inactive' && !options?.forceFinalize)) return;
  const mainRecorderAlreadyInactive = state.mediaRecorder.state === 'inactive';
  state.isStopping = true;
  closeRecordingBookmarkTextEditor();
  const automaticReason = String(options?.automaticReason || state.recordingAutoStopReason || '').trim();
  state.recordingAutoStopReason = '';
  $('stopButton').disabled = true;
  $('pauseButton').disabled = true;
  $('snapshotRecording').disabled = true;
  $('startButton').disabled = true;
  $('compactStartButton').disabled = true;
  const recordingMeta = { ...(state.activeRecordingMeta || {}) };
  const kind = recordingMeta.recordingKind || recordingKindValue();
  const microphoneNoiseMode = recordingMeta.noiseReduction || $('noiseReduction')?.value || 'off';
  const hadSeparateMicrophone = Boolean(state.micRecorder && state.micRecorder.state !== 'inactive');
  const hadNeuralMicrophone = Boolean(state.neuralMicRecorder && state.neuralMicRecorder.state !== 'inactive');
  const markers = [...state.pendingMarkers];
  const stopSequence = ++state.recordingStopSequence;
  const durationMs = elapsedMs();
  await checkpointActiveRecording('recording-stop').catch(() => {});
  stopRecordingCheckpointTimer();
  stopRecordingHealthMonitor();
  if (MY_VOICE_HIGHLIGHTS_ENABLED) stopLiveVoiceHighlightAnalysis(true);
  const voiceHighlights = MY_VOICE_HIGHLIGHTS_ENABLED ? normalizeLiveVoiceHighlights(Math.max(0, durationMs / 1000)) : [];
  window.recorderAPI.logEvent?.(automaticReason ? 'warn' : 'info', 'renderer.recording-stop-requested', {
    durationMs,
    automatic: Boolean(automaticReason),
    automaticReason,
    mediaRecorderState: state.mediaRecorder?.state || 'unknown'
  });
  setStatus(automaticReason ? `Recording stopped early: ${automaticReason}. Saving what was captured…` : 'Stopping recording…', Boolean(automaticReason));
  clearInterval(state.timerHandle);
  updateTimerDisplay();

  const mainStop = mainRecorderAlreadyInactive ? Promise.resolve() : new Promise((resolve) => {
    state.mediaRecorder.addEventListener('stop', resolve, { once: true });
    try { state.mediaRecorder.stop(); } catch { resolve(); }
  });
  const micStop = hadSeparateMicrophone ? new Promise((resolve) => {
    state.micRecorder.addEventListener('stop', resolve, { once: true });
    try { state.micRecorder.stop(); } catch { resolve(); }
  }) : Promise.resolve();
  const neuralMicStop = hadNeuralMicrophone ? new Promise((resolve) => {
    state.neuralMicRecorder.addEventListener('stop', resolve, { once: true });
    try { state.neuralMicRecorder.stop(); } catch { resolve(); }
  }) : Promise.resolve();
  await Promise.all([mainStop, micStop, neuralMicStop]);

  // Do not advertise a new Start until this recording has actually been normalized,
  // validated and removed from the recovery queue. This short save barrier prevents
  // the previous build's background HEVC/audio/AI work from competing with the next
  // capture and eliminates the normal Stop -> immediate "recovery" cycle.
  setRecordingUi(false);
  setStartButtonPhase('saving');
  setStatus(automaticReason ? `Recording stopped early: ${automaticReason}. Finalizing the captured file…` : 'Saving and validating recording…', Boolean(automaticReason));

  let applicationAudioPath = state.applicationAudioPath;
  const microphoneStartOffsetMs = Number.isFinite(state.recordingMicStartOffsetMs) ? Math.max(0, state.recordingMicStartOffsetMs) : 0;
  try {
    await state.writeQueue.catch(() => {});
    const recordingWriteError = state.recordingWriteError;
    await state.micWriteQueue.catch(() => {});
    await state.neuralMicWriteQueue.catch(() => {});
    if (applicationAudioPath) {
      const stopped = await window.recorderAPI.stopApplicationAudioCapture();
      applicationAudioPath = stopped?.path || applicationAudioPath;
    }
    cleanupStreams();

    const finalizeMeta = {
      durationMs,
      recordingKind: kind,
      filenameTemplate: recordingMeta.filenameTemplate,
      sourceName: recordingMeta.sourceName,
      captureMode: recordingMeta.captureMode,
      applicationAudioPath,
      microphoneNoiseMode,
      microphoneStartOffsetMs,
      videoCodec: recordingMeta.videoCodec || videoCodecValue(),
      frameRate: recordingMeta.frameRate || frameRateValue(),
      neuralMicrophoneMethod: recordingMeta.neuralMicrophoneMethod || 'none',
      writeInterrupted: Boolean(recordingWriteError),
      writeInterruptionReason: recordingWriteError ? friendlyErrorText(recordingWriteError) : '',
      automaticStopReason: automaticReason,
      markers,
      ...(MY_VOICE_HIGHLIGHTS_ENABLED ? { voiceHighlights, voiceHighlightMethod: 'mic-system-readonly' } : {})
    };

    const sealed = await window.recorderAPI.sealRecording(finalizeMeta);
    state.pendingMarkers = [];
    state.mediaRecorder = null;
    state.recordingWriteError = null;
    state.applicationAudioPath = null;
    state.activeRecordingMeta = null;
    state.recordingStartHardBlocked = false;
    state.recordingStartHardBlockReason = '';

    const saved = await finalizeStoppedRecording(sealed, { durationMs, kind, markers, stopSequence, automaticReason });
    state.isStopping = false;
    $('stopButton').disabled = false;
    $('pauseButton').disabled = false;
    $('snapshotRecording').disabled = false;
    setStartButtonPhase('idle');
    syncRecordStartAvailability();
    updatePreflightSystemIdleState();
    $('recorderPanel').classList.add('hidden');
    if (state.currentWorkspace === 'capture') refreshPreflightMicMonitor();
    resetLiveVoiceHighlightAnalysis();

    if (saved.ok) {
      const label = kind === 'audio' ? 'Audio recording' : 'Recording';
      if (automaticReason) {
        setStatus(`${label} stopped early and was saved. ${automaticReason}`, true);
        // Mini View already exposes the exact reason through its error-status line.
        // Keep the save confirmation compact instead of covering the controller with
        // the large global warning toast shown in older builds.
        if (state.viewMode === 'compact') showCompactFeedback('⚠ Recording saved early · see reason above', 4200);
        else showToast(`Recording stopped early · saved safely`, 'warning', 8000);
        showRecoveryNotice({
          title: 'Recording stopped early',
          detail: `${automaticReason} The captured portion was saved successfully.`,
          informational: true
        });
      } else {
        setStatus(`${label} saved and validated. Ready for a new recording.`);
        // Mini View uses only the quiet inline feedback. Do not also emit the global
        // toast, which is visually large relative to the tiny controller.
        if (state.viewMode === 'compact') showCompactFeedback(`${label} saved`, 900);
        else showToast(`${label} saved`);
      }
      window.recorderAPI.logEvent?.('info', 'renderer.recording-save-complete', {
        durationMs,
        outputPath: saved.result?.path || '',
        automaticStopReason: automaticReason
      });
    } else {
      const detail = friendlyErrorText(saved.error);
      setStatus(`Recording stopped, but saving needs attention. ${detail}`, true);
      showToast('Recording source protected for recovery', 'warning', 6500);
      window.recorderAPI.logEvent?.('error', 'renderer.recording-save-failed', { durationMs, error: String(saved.error?.message || saved.error || ''), automaticStopReason: automaticReason });
    }
  } catch (error) {
    cleanupStreams();
    state.pendingMarkers = markers;
    state.mediaRecorder = null;
    state.recordingWriteError = null;
    state.applicationAudioPath = null;
    state.activeRecordingMeta = null;
    state.isStopping = false;
    resetLiveVoiceHighlightAnalysis();
    $('stopButton').disabled = false;
    $('pauseButton').disabled = false;
    $('snapshotRecording').disabled = false;
    // Even a seal failure must not block a new capture. The main process has already
    // preserved any active source into the recovery area wherever possible.
    state.recordingStartHardBlocked = false;
    state.recordingStartHardBlockReason = '';
    setRecordingUi(false);
    setStartButtonPhase('idle');
    syncRecordStartAvailability();
    setStatus(`Recording stopped, but its save session needs recovery. ${friendlyErrorText(error)}`, true);
    showRecoveryNotice({ title: 'Recording needs recovery', detail: 'The unfinished source is protected. You can start another recording now and recover this file later.' });
    window.recorderAPI.logEvent?.('error', 'renderer.recording-seal-failed', { durationMs, error: String(error?.message || error || ''), automaticStopReason: automaticReason });
  }
}

async function togglePause() {
  if (!state.mediaRecorder) return;
  if (state.mediaRecorder.state === 'recording') {
    state.mediaRecorder.pause();
    if (state.micRecorder?.state === 'recording') state.micRecorder.pause();
    state.pauseStartedAt = Date.now();
    updatePauseButtons(true);
    if (state.activeRecordingMeta?.applicationAudio) {
      try { await window.recorderAPI.pauseApplicationAudioCapture(); }
      catch (error) { setStatus(`Recording is paused, but selected-app audio did not pause normally. ${friendlyErrorText(error)}`, true); }
    }
    setStatus('Recording paused. Resume continues in the same recording file.');
  } else if (state.mediaRecorder.state === 'paused') {
    if (state.activeRecordingMeta?.applicationAudio) {
      try { await window.recorderAPI.resumeApplicationAudioCapture(); }
      catch (error) { setStatus(`Could not resume selected-app audio. ${friendlyErrorText(error)}`, true); return; }
    }
    state.mediaRecorder.resume();
    if (state.micRecorder?.state === 'paused') state.micRecorder.resume();
    state.totalPausedMs += Date.now() - state.pauseStartedAt;
    state.pauseStartedAt = 0;
    updatePauseButtons(false);
    setStatus('Recording resumed in the same file.');
  }
  checkpointActiveRecording(state.mediaRecorder?.state === 'paused' ? 'recording-paused' : 'recording-resumed');
  updateTimerDisplay();
}


function canvasToPngArrayBuffer(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) return reject(new Error('Could not create the snapshot image.'));
      resolve(await blob.arrayBuffer());
    }, 'image/png');
  });
}

async function takeLiveSnapshot() {
  if (!state.compositeCanvas) return setStatus('A live recording must be running before taking a snapshot.', true);
  try {
    const data = await canvasToPngArrayBuffer(state.compositeCanvas);
    const result = await window.recorderAPI.saveSnapshot(data);
    setStatus(`Snapshot saved: ${result.path}`);
  } catch (error) {
    setStatus(`Could not save the snapshot. ${friendlyErrorText(error)}`, true);
  }
}

async function takePlaybackSnapshot() {
  if (!state.selectedPlaybackPath) return;
  const selected = state.recordings.find((item) => item.path === state.selectedPlaybackPath);
  if (selected?.mediaType === 'audio') { $('playerStatus').textContent = 'Snapshots are not available for audio-only recordings.'; return; }
  try {
    const video = $('playbackVideo');
    const duration = Number.isFinite(video.duration) ? video.duration : null;
    const seconds = duration ? clamp(video.currentTime || 0, 0, Math.max(0, duration - 0.05)) : (video.currentTime || 0);
    const result = await window.recorderAPI.saveRecordingFrameSnapshot(state.selectedPlaybackPath, seconds);
    $('playerStatus').textContent = `Snapshot saved at ${formatPreciseSeconds(seconds)} in ${result.directory}`;
  } catch (error) {
    $('playerStatus').textContent = `Could not save the snapshot. ${friendlyErrorText(error)}`;
  }
}

function normalizeEditCuts(cuts) {
  const video = $('playbackVideo');
  const duration = Number.isFinite(video.duration) && video.duration > 0
    ? video.duration
    : Number(state.recordings.find((item) => item.path === state.selectedPlaybackPath)?.durationSeconds || 0);
  if (!duration) return [];
  const normalized = (Array.isArray(cuts) ? cuts : []).map((cut) => ({
    startSeconds: clamp(Number(cut.startSeconds) || 0, 0, duration),
    endSeconds: clamp(Number(cut.endSeconds) || 0, 0, duration)
  })).map((cut) => ({ startSeconds: Math.min(cut.startSeconds, cut.endSeconds), endSeconds: Math.max(cut.startSeconds, cut.endSeconds) }))
    .filter((cut) => cut.endSeconds - cut.startSeconds >= 0.1)
    .sort((a, b) => a.startSeconds - b.startSeconds);
  const merged = [];
  for (const cut of normalized) {
    const previous = merged[merged.length - 1];
    if (previous && cut.startSeconds <= previous.endSeconds + 0.02) previous.endSeconds = Math.max(previous.endSeconds, cut.endSeconds);
    else merged.push({ ...cut });
  }
  return merged;
}

function renderEditCuts() {
  state.editCuts = normalizeEditCuts(state.editCuts);
  const list = $('cutSegmentList');
  const overlay = $('cutSegmentOverlay');
  const video = $('playbackVideo');
  const duration = Number.isFinite(video.duration) && video.duration > 0
    ? video.duration
    : Number(state.recordings.find((item) => item.path === state.selectedPlaybackPath)?.durationSeconds || 0);
  if (!state.editCuts.length) {
    list.innerHTML = '<span class="helper">No sections marked for removal.</span>';
    overlay.innerHTML = '';
    $('cutSummary').textContent = 'Original remains unchanged. Add one or more cut ranges to create a cleaned copy.';
    $('clearCutSegments').disabled = true;
    $('saveMultiCutCopy').disabled = true;
    return;
  }
  list.innerHTML = state.editCuts.map((cut, index) => {
    const length = cut.endSeconds - cut.startSeconds;
    return `<div class="cut-segment-row"><span class="cut-index">Cut ${index + 1}</span><code>${formatPreciseSeconds(cut.startSeconds)} → ${formatPreciseSeconds(cut.endSeconds)}</code><span>${formatPreciseSeconds(length)}</span><button class="cut-remove" type="button" data-cut-index="${index}" title="Remove this cut" aria-label="Remove cut ${index + 1}">×</button></div>`;
  }).join('');
  list.querySelectorAll('[data-cut-index]').forEach((button) => button.addEventListener('click', () => {
    state.editCuts.splice(Number(button.dataset.cutIndex), 1);
    renderEditCuts();
  }));
  overlay.innerHTML = duration > 0 ? state.editCuts.map((cut) => {
    const left = (cut.startSeconds / duration) * 100;
    const width = ((cut.endSeconds - cut.startSeconds) / duration) * 100;
    return `<span class="cut-overlay-range" style="left:${left}%;width:${width}%"></span>`;
  }).join('') : '';
  const removed = state.editCuts.reduce((total, cut) => total + cut.endSeconds - cut.startSeconds, 0);
  const remaining = Math.max(0, duration - removed);
  $('cutSummary').textContent = `${state.editCuts.length} cut${state.editCuts.length === 1 ? '' : 's'} · remove ${formatPreciseSeconds(removed)} · cleaned copy about ${formatPreciseSeconds(remaining)}. Original file is never overwritten.`;
  $('clearCutSegments').disabled = state.editBusy;
  $('saveMultiCutCopy').disabled = state.editBusy;
}

function addCurrentRangeToCuts() {
  const video = $('playbackVideo');
  const end = state.trimEnd == null ? video.duration : state.trimEnd;
  if (!Number.isFinite(end) || end - state.trimStart < 0.1) {
    $('trimStatus').textContent = 'Select at least 0.1 seconds with the trim handles before adding a cut.';
    return;
  }
  state.editCuts.push({ startSeconds: state.trimStart, endSeconds: end });
  state.editCuts = normalizeEditCuts(state.editCuts);
  renderEditCuts();
  $('trimStatus').textContent = 'Selected section added to the cut list. Adjust the handles to mark another section.';
}

function setEditingBusy(busy) {
  state.editBusy = Boolean(busy);
  for (const id of ['saveTrimmedCopy', 'addCutSegment', 'clearCutSegments', 'saveMultiCutCopy', 'exportPlaybackAudio']) {
    const element = $(id);
    if (element) element.disabled = busy || ((id === 'clearCutSegments' || id === 'saveMultiCutCopy') && !state.editCuts.length);
  }
}

async function saveMultiCutCopy() {
  if (!state.selectedPlaybackPath || !state.editCuts.length || state.editBusy) return;
  const video = $('playbackVideo');
  const duration = Number.isFinite(video.duration) ? video.duration : Number(state.recordings.find((item) => item.path === state.selectedPlaybackPath)?.durationSeconds || 0);
  const cuts = normalizeEditCuts(state.editCuts);
  const removed = cuts.reduce((total, cut) => total + cut.endSeconds - cut.startSeconds, 0);
  if (!duration || removed >= duration - 0.1) {
    $('trimStatus').textContent = 'The cuts would remove the entire recording. Keep at least 0.1 seconds.';
    return;
  }
  if (removed / duration > 0.8) showToast(`Cleaned copy will keep about ${Math.max(0, Math.round((1 - removed / duration) * 100))}% of the recording. The original stays unchanged.`, 'warning', 4200);
  setEditingBusy(true);
  $('trimStatus').textContent = `Creating cleaned copy from ${cuts.length} cut${cuts.length === 1 ? '' : 's'}…`;
  try {
    const result = await window.recorderAPI.multiTrimRecording(state.selectedPlaybackPath, cuts);
    $('trimStatus').textContent = `Cleaned copy saved: ${result.path}. The original was left unchanged.`;
    state.editCuts = [];
    await refreshRecordings();
    const edited = state.recordings.find((item) => item.path === result.path);
    if (edited) await selectPlaybackRecording(edited);
    runAutomaticTranscription(result.path, false);
  } catch (error) {
    $('trimStatus').textContent = `Could not create the edited copy. ${friendlyErrorText(error)}`;
  } finally {
    setEditingBusy(false);
    renderEditCuts();
  }
}

async function exportPlaybackAudio() {
  if (!state.selectedPlaybackPath || state.editBusy) return;
  const format = $('exportAudioFormat')?.value === 'mp3' ? 'mp3' : 'm4a';
  setEditingBusy(true);
  $('playerStatus').textContent = `Exporting audio-only ${format.toUpperCase()}…`;
  try {
    const result = await window.recorderAPI.exportRecordingAudio(state.selectedPlaybackPath, format);
    $('playerStatus').textContent = `Audio exported: ${result.path}`;
    showToast('Audio export complete');
    await refreshRecordings();
    const exported = state.recordings.find((item) => item.path === result.path);
    if (exported) await selectPlaybackRecording(exported);
  } catch (error) {
    $('playerStatus').textContent = `Could not export the audio. ${friendlyErrorText(error)}`;
  } finally {
    setEditingBusy(false);
    renderEditCuts();
  }
}

async function saveTrimmedCopy() {
  if (!state.selectedPlaybackPath) return;
  const video = $('playbackVideo');
  const end = state.trimEnd == null ? video.duration : state.trimEnd;
  if (!Number.isFinite(end) || end <= state.trimStart) {
    $('trimStatus').textContent = 'Set a valid trim end after the trim start.';
    return;
  }
  $('saveTrimmedCopy').disabled = true;
  $('trimStatus').textContent = `Creating trimmed copy · ${formatPreciseSeconds(state.trimStart)} → ${formatPreciseSeconds(end)}…`;
  try {
    const result = await window.recorderAPI.trimRecording(state.selectedPlaybackPath, state.trimStart, end);
    $('trimStatus').textContent = `Trimmed copy saved: ${result.path}. Automatic transcription is starting.`;
    showToast('Trimmed copy saved');
    await refreshRecordings();
    const trimmed = state.recordings.find((item) => item.path === result.path);
    if (trimmed) await selectPlaybackRecording(trimmed);
    runAutomaticTranscription(result.path, false);
  } catch (error) {
    $('trimStatus').textContent = `Could not create the trimmed copy. ${friendlyErrorText(error)}`;
  } finally {
    $('saveTrimmedCopy').disabled = false;
  }
}

async function runAutomaticTranscription(recordingPath, focusPanel = true, force = false) {
  if (!recordingPath || state.transcribingPaths.has(recordingPath)) return;
  window.recorderAPI.logEvent?.('info', 'ai.transcription-started', { force: Boolean(force) });
  state.transcribingPaths.add(recordingPath);
  if (state.selectedPlaybackPath === recordingPath) $('renamePlaybackFile').disabled = true;
  if (focusPanel && state.currentWorkspace === 'playback' && state.selectedPlaybackPath === recordingPath) {
    setTranscriptTarget(recordingPath);
  }
  const showTranscriptProgress = focusPanel || state.selectedPlaybackPath === recordingPath || state.transcriptTargetPath === recordingPath;
  if (showTranscriptProgress) $('transcriptStatus').textContent = 'Generating transcript…';
  renderRecordings();
  try {
    const result = await window.recorderAPI.transcribeAutomatic(recordingPath, { force });
    if (state.transcriptTargetPath === recordingPath || focusPanel) {
      $('transcriptText').value = result.text || '';
      state.localSrt = result.srtText || '';
      state.transcriptTxtPath = result.txtPath || '';
      state.transcriptSrtPath = result.srtPath || '';
      updateTranscriptActions();
      $('transcriptStatus').textContent = '';
    }
    if (state.selectedPlaybackPath === recordingPath) {
      const transcript = await window.recorderAPI.getRecordingTranscript(recordingPath);
      state.playbackTranscript = transcript;
      attachSubtitleTrack(transcript.srt, state.subtitlePreference);
      if (!state.subtitleCues.length && transcript.text) {
        attachApproximateSubtitleTrack(transcript.text, $('playbackVideo').duration || null, state.subtitlePreference);
      }
      updatePlaybackSubtitleControlState();
      $('subtitleBadge').textContent = 'Transcript available';
      $('subtitleBadge').classList.add('ready');
      $('openPlaybackTranscript').disabled = !transcript.text;
      $('copyPlaybackTranscript').disabled = !transcript.text;
      $('playbackTranscriptPreview').textContent = transcript.text || '';
      loadTranscriptIntoPanel(recordingPath, transcript, false);
      loadPlaybackSpeakers(recordingPath, state.playbackSelectionToken, false).catch(() => {});
      loadPlaybackInsights(recordingPath, state.playbackSelectionToken, false).catch(() => {});
    }
    window.recorderAPI.logEvent?.('info', 'ai.transcription-completed', { force: Boolean(force), wordCountBucket: analyticsWordCountBucket(result.text || '') });
    if (stoppedRecordingUiIsIdle()) setStatus(`Transcript saved automatically for ${recordingPath.split(/[\\/]/).pop()}.`);
  } catch (error) {
    const cancelled = /recording was deleted|processing was cancelled|AI processing was cancelled|cancelled because the recording was deleted/i.test(String(error?.message || ''));
    if (cancelled) {
      window.recorderAPI.logEvent?.('warn', 'ai.transcription-cancelled', { force: Boolean(force) });
      if ((state.transcriptTargetPath === recordingPath || focusPanel) && state.selectedPlaybackPath === recordingPath) $('transcriptStatus').textContent = 'Transcription cancelled.';
    } else {
      window.recorderAPI.logEvent?.('error', 'ai.transcription-failed', { force: Boolean(force), errorName: error?.name || 'Error' });
      if (state.transcriptTargetPath === recordingPath || focusPanel) {
        $('transcriptStatus').textContent = `Transcript could not finish. ${friendlyErrorText(error)} Select the recording again to retry.`;
      }
      if (stoppedRecordingUiIsIdle()) setStatus(`Recording saved safely, but the transcript could not finish. ${friendlyErrorText(error)}`, true);
    }
  } finally {
    state.transcribingPaths.delete(recordingPath);
    if (state.selectedPlaybackPath === recordingPath) $('renamePlaybackFile').disabled = false;
    await refreshRecordings();
  }
}

function closePlaybackMoreMenu() {
  const menu = $('playbackMoreMenu');
  const button = $('playbackMoreButton');
  menu?.classList.add('hidden');
  button?.setAttribute('aria-expanded', 'false');
}

function togglePlaybackMoreMenu() {
  const menu = $('playbackMoreMenu');
  const button = $('playbackMoreButton');
  if (!menu || !button) return;
  const opening = menu.classList.contains('hidden');
  if (opening) closeSeekOptionsMenu();
  menu.classList.toggle('hidden', !opening);
  button.setAttribute('aria-expanded', String(opening));
}

function closeSeekOptionsMenu() {
  $('seekOptionsMenu')?.classList.add('hidden');
  $('seekOptionsToggle')?.setAttribute('aria-expanded', 'false');
}

function toggleSeekOptionsMenu() {
  const menu = $('seekOptionsMenu');
  const button = $('seekOptionsToggle');
  if (!menu || !button) return;
  const opening = menu.classList.contains('hidden');
  if (opening) closePlaybackMoreMenu();
  menu.classList.toggle('hidden', !opening);
  button.setAttribute('aria-expanded', String(opening));
}

function togglePlaybackMute() {
  const video = $('playbackVideo');
  if (!video) return;
  video.muted = !video.muted;
  const muted = video.muted || video.volume === 0;
  setPlayerIcon('playbackMute', muted ? 'muted' : 'volume', muted ? 'Unmute (M)' : 'Mute (M)');
  if ($('stickyPlaybackVolume')) $('stickyPlaybackVolume').value = String(video.volume);
}

function seekWaveformFromPointer(event) {
  const timeline = $('waveformTimeline');
  const video = $('playbackVideo');
  if (!timeline || !video || !Number.isFinite(video.duration) || video.duration <= 0) return;
  if (event.target?.closest?.('.timeline-hover-preview')) return;
  const rect = timeline.getBoundingClientRect();
  const x = clamp(event.clientX - rect.left, 0, rect.width);
  const target = (x / Math.max(1, rect.width)) * video.duration;
  state.pendingSeekTarget = target;
  video.currentTime = target;
  updatePlaybackClock();
}

function initStickyPlaybackControls() {
  const toolbar = document.querySelector('#videoPlayerShell .player-toolbar');
  const sticky = $('stickyPlaybackControls');
  if (!toolbar || !sticky) return;
  state.playbackToolbarObserver?.disconnect?.();
  state.playbackToolbarObserver = new IntersectionObserver((entries) => {
    const visible = entries[0]?.isIntersecting;
    sticky.classList.toggle('is-visible', !visible && Boolean(state.selectedPlaybackPath) && state.currentWorkspace === 'playback');
  }, { threshold: 0.12 });
  state.playbackToolbarObserver.observe(toolbar);
}

function applyPlaybackPreferences() {
  const volume = clamp(state.playbackVolume, 0, 1);
  const speed = [0.5,0.75,1,1.25,1.5,2].includes(state.playbackSpeedValue) ? state.playbackSpeedValue : 1;
  state.playbackSpeedValue = speed;
  if ($('playbackVolume')) $('playbackVolume').value = String(volume);
  if ($('stickyPlaybackVolume')) $('stickyPlaybackVolume').value = String(volume);
  if ($('playbackSpeed')) $('playbackSpeed').value = String(speed);
  const video = $('playbackVideo');
  if (video) { video.volume = volume; video.playbackRate = speed; }
}

function plainTextToSrt(text) {
  const cleaned = String(text || '').trim();
  if (!cleaned) return '';
  return `1\n00:00:00,000 --> 99:59:59,000\n${cleaned}\n`;
}


function formatModelSize(bytes) { return Number(bytes) > 0 ? formatBytes(Number(bytes)) : '—'; }

async function refreshModelManager() {
  const list = $('modelManagerList');
  if (!list) return;
  list.innerHTML = '<div class="empty">Checking local AI models…</div>';
  try {
    const result = await window.recorderAPI.listLocalModels();
    $('modelManagerSummary').textContent = `${formatBytes(result.cacheBytes || 0)} used by local AI models`;
    list.innerHTML = (result.models || []).map((model) => `
      <div class="model-manager-row" data-model-id="${escapeHtml(model.id)}">
        <div class="model-manager-copy"><strong>${escapeHtml(model.name)}${model.recommended ? ' <span class="model-recommended">Recommended</span>' : ''}</strong><span>${escapeHtml(model.purpose)}</span><code>${escapeHtml(model.modelId)}</code></div>
        <div class="model-manager-status"><strong class="${model.installed ? 'installed' : ''}">${model.installed ? '✓ Installed' : 'Not installed'}</strong><span>${escapeHtml(formatModelSize(model.bytes))}</span></div>
        <button class="button ${model.installed ? 'secondary' : 'primary'} small model-action" type="button" data-model-action="${model.installed ? 'remove' : 'download'}">${model.installed ? 'Remove' : 'Download'}</button>
      </div>`).join('');
    list.querySelectorAll('.model-action').forEach((button) => button.addEventListener('click', async () => {
      const row = button.closest('[data-model-id]');
      const id = row?.dataset.modelId;
      if (!id) return;
      const action = button.dataset.modelAction;
      if (action === 'remove' && !confirm('Remove this local AI model? Recordings and transcripts will not be deleted.')) return;
      button.disabled = true;
      button.textContent = action === 'download' ? 'Downloading…' : 'Removing…';
      try {
        if (action === 'download') await window.recorderAPI.downloadLocalModel(id);
        else await window.recorderAPI.removeLocalModel(id);
        showToast(action === 'download' ? 'AI model ready' : 'AI model removed');
      } catch (error) { showToast(friendlyErrorText(error), 'error', 4200); }
      await refreshModelManager();
      await refreshDiagnostics();
    }));
  } catch (error) { list.innerHTML = `<div class="empty">Could not load local AI models. ${escapeHtml(friendlyErrorText(error))}</div>`; }
}

function scheduleUpdateDialogOpen() {
  if (state.updateDialogRetryTimer) clearTimeout(state.updateDialogRetryTimer);
  state.updateDialogRetryTimer = null;
  const dialog = $('updateAvailableDialog');
  if (!dialog || dialog.open) return;
  const tryOpen = () => {
    state.updateDialogRetryTimer = null;
    const value = state.latestUpdateStatus || {};
    const shouldOpen = value.state === 'available' || value.state === 'downloading' || value.state === 'ready' || value.state === 'installing' || (value.state === 'error' && Boolean(value.availableVersion));
    if (!shouldOpen || dialog.open) return;
    const anotherDialogOpen = Array.from(document.querySelectorAll('dialog[open]')).some((node) => node !== dialog);
    if (anotherDialogOpen) {
      state.updateDialogRetryTimer = setTimeout(tryOpen, 250);
      return;
    }
    try { dialog.showModal(); } catch {}
  };
  tryOpen();
}

function renderUpdateDialog(value = {}) {
  const dialog = $('updateAvailableDialog');
  if (!dialog) return;
  const active = value.state === 'available' || value.state === 'downloading' || value.state === 'ready' || value.state === 'installing' || (value.state === 'error' && Boolean(value.availableVersion));
  if (!active) {
    if (state.updateDialogRetryTimer) clearTimeout(state.updateDialogRetryTimer);
    state.updateDialogRetryTimer = null;
    if (dialog.open) dialog.close();
    return;
  }

  const version = value.availableVersion ? `v${value.availableVersion}` : 'New version';
  if ($('updateAvailableVersion')) $('updateAvailableVersion').textContent = version;
  if ($('updateReleaseNotes')) $('updateReleaseNotes').textContent = value.releaseNotes || 'No release notes were provided for this build.';
  if ($('updateAvailableStatus')) $('updateAvailableStatus').textContent = value.message || `PulseStudio ${version} is available.`;

  const progressWrap = $('updateProgressWrap');
  const progressBar = $('updateProgressBar');
  const progressText = $('updateProgressText');
  const showProgress = value.state === 'downloading' || value.state === 'ready';
  progressWrap?.classList.toggle('hidden', !showProgress);
  if (progressBar) progressBar.value = Math.max(0, Math.min(100, Math.round(Number(value.progress || 0) * 100)));
  if (progressText) progressText.textContent = value.state === 'ready' ? 'Download verified · ready to install' : `Downloading · ${Math.round(Number(value.progress || 0) * 100)}%`;

  const primary = $('updatePrimaryAction');
  const later = $('updateRemindLater');
  const skip = $('updateSkipVersion');
  const choosing = value.state === 'available' || (value.state === 'error' && value.canDownload);
  later?.classList.toggle('hidden', !choosing);
  skip?.classList.toggle('hidden', !choosing);
  dialog.querySelector('.update-available-actions')?.classList.toggle('single-action', !choosing);
  if (primary) {
    primary.disabled = value.state === 'downloading' || value.state === 'installing' || (value.state === 'error' && !value.canDownload);
    primary.textContent = value.state === 'downloading'
      ? 'Downloading…'
      : value.state === 'ready'
        ? 'Install & Reopen'
        : value.state === 'installing'
          ? 'Installing…'
          : value.state === 'error'
            ? 'Retry Update'
            : 'Update Now';
  }
  scheduleUpdateDialogOpen();
}

function updateUpdateUi(status) {
  state.latestUpdateStatus = status || state.latestUpdateStatus || {};
  const value = state.latestUpdateStatus;
  const deferredLabel = ({
    recording: 'Paused · recording in progress',
    saving: 'Paused · saving recording',
    recovery: 'Paused · recovery running',
    ai: 'Paused · local AI running',
    background: 'Paused · background work running'
  })[String(value.blocker || '')] || 'Paused · background work running';
  const labels = {
    development: 'Installed app only', unconfigured: 'Not configured', unavailable: 'Unavailable', idle: 'Automatic checks enabled',
    checking: 'Checking…', current: 'Up to date', available: `Update available${value.availableVersion ? ` · v${value.availableVersion}` : ''}`,
    downloading: value.progress != null ? `Downloading · ${Math.round(value.progress * 100)}%` : 'Downloading…',
    deferred: deferredLabel, reminded: 'Reminder postponed', skipped: `Skipped${value.availableVersion ? ` · v${value.availableVersion}` : ''}`,
    ready: `Update ready${value.availableVersion ? ` · v${value.availableVersion}` : ''}`, installing: 'Installing and reopening…', error: 'Update issue'
  };
  if ($('diagnosticUpdate')) { $('diagnosticUpdate').textContent = labels[value.state] || value.message || 'Unknown'; $('diagnosticUpdate').title = value.message || ''; }
  const updateDetail = $('diagnosticUpdateDetail');
  if (updateDetail) {
    updateDetail.textContent = value.state === 'deferred' && value.message
      ? value.message
      : 'PulseStudio checks GitHub Releases automatically. Active recording/save, recovery, or local AI work can briefly pause an update; a protected recovery item that is not running never blocks updates.';
    updateDetail.classList.toggle('warning-text', value.state === 'deferred');
  }
  $('installUpdate')?.classList.toggle('hidden', value.state !== 'ready');
  renderUpdateDialog(value);
}

function updateAnalyticsUi(status) {
  const value = status || {};
  const toggle = $('analyticsToggle');
  const statusNode = $('analyticsStatus');
  const detail = $('analyticsDetail');
  if (toggle) {
    toggle.disabled = !value.configured;
    toggle.classList.toggle('is-on', Boolean(value.enabled));
    toggle.setAttribute('aria-pressed', value.enabled ? 'true' : 'false');
  }
  if (statusNode) {
    statusNode.textContent = !value.configured
      ? 'Analytics backend not configured yet.'
      : value.enabled
        ? (value.lastError ? 'On · waiting to reconnect' : 'On · anonymous usage metrics enabled')
        : 'Off · no usage analytics are sent';
  }
  if (detail) detail.textContent = !value.configured
    ? 'Owner setup required before distributed copies can report analytics.'
    : 'Version, OS, sessions, feature use, recording reliability, and update adoption only.';
  if ($('diagnosticAnalytics')) $('diagnosticAnalytics').textContent = !value.configured ? 'Not configured' : value.enabled ? '✓ Anonymous analytics on' : 'Off';
}

async function showAnalyticsReminderIfDisabled() {
  const status = await window.recorderAPI.getAnalyticsStatus?.().catch(() => null);
  if (!status?.configured || status.enabled) return false;
  const dialog = $('analyticsReminderDialog');
  if (!dialog || dialog.open) return false;
  const returnToMini = state.viewMode === 'compact';
  if (returnToMini) await applyViewMode('full', true);
  dialog.dataset.returnToMini = returnToMini ? '1' : '0';
  dialog.showModal();
  return true;
}

async function closeAnalyticsReminder() {
  const dialog = $('analyticsReminderDialog');
  const returnToMini = dialog?.dataset.returnToMini === '1';
  dialog?.close();
  if (returnToMini) await applyViewMode('compact', true);
}

const anonymousUsageGroups = Object.freeze({
  compactMacCloseButton: 'window', compactMacMinimizeButton: 'window', transparencyButton: 'window', themeToggle: 'appearance', alwaysOnTopButton: 'window', compactFullViewButton: 'window', themesButton: 'appearance', helpButton: 'help', aboutButton: 'diagnostics',
  captureWorkspaceTab: 'navigation', playbackWorkspaceTab: 'navigation', fullViewButton: 'window', compactViewButton: 'window', refreshRecordings: 'library', openRecordingsFolder: 'library', refreshSources: 'capture', chooseRegion: 'capture', compactCaptureSettingsToggle: 'capture', compactChooseRegion: 'capture',
  compactRecordingMicToggle: 'recording', compactRecordingKindVideoButton: 'recording', compactRecordingKindAudioButton: 'recording', compactPauseButton: 'recording', compactBookmarkButton: 'bookmarks', compactStartButton: 'recording',
  showInFolder: 'library', copySavedPath: 'library', clearLibrarySearch: 'library', newCategoryButton: 'library', batchSelectButton: 'library', batchDeleteSelected: 'library', batchCancelSelection: 'library', bookmarkInlineSave: 'bookmarks',
  previousClip: 'playback', previousBookmark: 'bookmarks', addBookmarkPlayer: 'bookmarks', deleteBookmarkPlayer: 'bookmarks', nextBookmark: 'bookmarks', nextClip: 'playback', playPausePlayback: 'playback', seekOptionsToggle: 'playback', toggleVoiceHighlights: 'my_voice', snapshotPlayback: 'snapshot', playerSubtitleControl: 'captions', playbackMute: 'playback', playbackFullscreen: 'playback', toggleChapterSidebar: 'timeline', hideChapterSidebar: 'timeline',
  stickyPreviousBookmark: 'bookmarks', stickyAddBookmark: 'bookmarks', stickyDeleteBookmark: 'bookmarks', stickyNextBookmark: 'bookmarks', stickySeekBack: 'playback', stickyPlayPause: 'playback', stickySeekForward: 'playback', renamePlaybackFile: 'library', openPlaybackTranscript: 'transcription', showPlaybackFile: 'library', exportPlaybackAudio: 'export', playbackMoreButton: 'playback', copyPlaybackPath: 'library', copyPlaybackTranscript: 'transcription',
  moreShowTranscriptFiles: 'transcription', showTranscriptFiles: 'transcription', transcriptViewRaw: 'transcription', transcriptViewSpeakers: 'transcription', transcriptViewTimecoded: 'transcription', toggleTranscript: 'transcription', copyTranscript: 'transcription', exportTxt: 'export', exportSrt: 'export', clearTranscriptSearch: 'transcription', transcriptSearchPrev: 'transcription', transcriptSearchNext: 'transcription',
  copyAllInsights: 'insights', regenerateInsights: 'insights', insightsPanelToggle: 'insights', chaptersToggle: 'insights', meetingSummaryToggle: 'insights', copySummary: 'insights', actionItemsToggle: 'insights', copyActionItems: 'insights',
  trimStartHandle: 'editing', trimEndHandle: 'editing', setTrimStart: 'editing', setTrimEnd: 'editing', saveTrimmedCopy: 'editing', addCutSegment: 'editing', clearCutSegments: 'editing', saveMultiCutCopy: 'editing',
  cancelRecoveryButton: 'recovery', recordingKindVideoButton: 'recording', recordingKindAudioButton: 'recording', webcamQuickToggle: 'webcam', preflightMicMuteButton: 'microphone', recordDestinationChange: 'recording', startButton: 'recording', cancelAiJob: 'ai', recordingMicToggle: 'microphone', pausePrimaryButton: 'recording', bookmarkPrimaryButton: 'bookmarks', retryRecovery: 'recovery', showRecoveryFiles: 'recovery', discardRecovery: 'recovery', recoverDiagnostics: 'recovery', discardRecoveryDiagnostics: 'recovery', stopBackgroundWork: 'recovery', dismissRecoveryNotice: 'recovery',
  settingsCollapseButton: 'settings', recordAdvancedToggle: 'settings', changeRecordingFolder: 'settings', resetRecordingFolder: 'settings', appToolsToggle: 'settings', windowCapturePrivacyToggle: 'privacy', analyticsToggle: 'privacy', voiceEnrollButton: 'my_voice', voiceClearButton: 'my_voice', openModelManager: 'ai', openDiagnostics: 'diagnostics', sendFeedback: 'feedback', exportDiagnosticsQuick: 'diagnostics', snapshotRecording: 'snapshot', bookmarkRecording: 'bookmarks', pauseButton: 'recording', stopButton: 'recording', recordingBookmarkTextSave: 'bookmarks', clearRegion: 'capture', applyRegion: 'capture', createCategoryConfirm: 'library',
  exportDiagnostics: 'diagnostics', copyDiagnostics: 'diagnostics', openLogs: 'diagnostics', sendFeedbackDiagnostics: 'feedback', checkUpdates: 'updates', installUpdate: 'updates', openModelsFolder: 'ai', refreshModels: 'ai', themeClassicChoice: 'appearance', themeStudioChoice: 'appearance', themesAppearanceToggle: 'appearance', analyticsReminderContinue: 'privacy', analyticsReminderEnable: 'privacy', firstRunChooseFolder: 'onboarding', completeFirstRun: 'onboarding'
});

const anonymousSafeValues = new Set([
  'captureMode','compactCaptureMode','compactQuality','compactFrameRate','playbackSpeed','exportAudioFormat',
  'webcamPosition','webcamSize','webcamShape','computerAudioMode','noiseReduction','quality','frameRate','videoCodec','filenameStyle','recordCountdown'
]);

function wireAnonymousUsageInstrumentation() {
  if (document.documentElement.dataset.analyticsInstrumentation === '1') return;
  document.documentElement.dataset.analyticsInstrumentation = '1';
  document.addEventListener('click', (event) => {
    const control = event.target?.closest?.('button[id]');
    if (!control?.id) return;
    window.recorderAPI.logEvent?.('info', 'ui.control-used', {
      control: control.id,
      controlType: 'button',
      group: anonymousUsageGroups[control.id] || 'other',
      action: 'click'
    });
  }, true);
  document.addEventListener('change', (event) => {
    const control = event.target;
    if (!control?.id || !['SELECT', 'INPUT'].includes(control.tagName)) return;
    if (control.tagName === 'INPUT' && !['checkbox', 'range'].includes(String(control.type || '').toLowerCase())) return;
    const payload = {
      control: control.id,
      controlType: control.tagName.toLowerCase(),
      group: ['microphone','microphoneDevice','noiseReduction'].includes(control.id) ? 'microphone' : ['systemAudio','computerAudioMode'].includes(control.id) ? 'system_audio' : control.id.startsWith('webcam') || control.id === 'cameraDevice' ? 'webcam' : 'settings',
      action: 'change'
    };
    if (control.type === 'checkbox') payload.value = control.checked ? 'on' : 'off';
    else if (anonymousSafeValues.has(control.id)) payload.value = String(control.value || '').slice(0, 60);
    else if (control.type === 'range') payload.value = 'adjusted';
    window.recorderAPI.logEvent?.('info', 'ui.control-used', payload);
  }, true);
  window.addEventListener('error', (event) => {
    window.recorderAPI.logEvent?.('error', 'renderer.javascript-error', { errorName: event.error?.name || 'Error' });
  });
  window.addEventListener('unhandledrejection', (event) => {
    window.recorderAPI.logEvent?.('error', 'renderer.unhandled-rejection', { errorName: event.reason?.name || 'Error' });
  });
}

function analyticsWordCountBucket(text) {
  const count = String(text || '').trim().split(/\s+/).filter(Boolean).length;
  if (count < 50) return '<50';
  if (count < 250) return '50-249';
  if (count < 1000) return '250-999';
  if (count < 5000) return '1k-4.9k';
  return '5k+';
}

async function openFeedbackPage() {
  const result = await window.recorderAPI.sendFeedback?.().catch((error) => ({ opened: false, error: friendlyErrorText(error) }));
  if (!result?.opened) showToast(result?.error || 'Could not open the PulseStudio feedback page.', 'warning', 4200);
}

function permissionHealthLabel(value, optional = false) {
  const normalized = String(value || '').toLowerCase();
  if (['granted', 'authorized', 'system-managed'].includes(normalized)) return '✓ Ready';
  if (normalized === 'not-determined') return optional ? 'Not used yet' : 'Will ask when needed';
  if (['denied', 'restricted'].includes(normalized)) return 'Needs attention';
  return optional ? 'Not used yet' : 'System managed';
}

async function refreshDiagnostics() {
  if (!$('diagnosticBuild')) return;
  try {
    const d = await window.recorderAPI.getDiagnostics();
    state.lastDiagnostics = d;
    $('aboutVersion').textContent = d.version || state.platformInfo?.version || '0.2.129';
    $('diagnosticBuild').textContent = d.packaged ? 'Installed / packaged' : 'Development build';
    $('diagnosticPlatform').textContent = `${d.platform} · ${d.arch} · ${d.release}`;
    const encoding = d.videoEncoding || {};
    $('diagnosticEncoder').textContent = encoding.h264 || encoding.h265 || 'Automatic software fallback';
    $('diagnosticFolder').textContent = compactRecordingFolderLabel(d.recordingsDirectory || '');
    $('diagnosticFolder').title = d.recordingsDirectory || '';
    $('diagnosticStorage').textContent = Number.isFinite(Number(d.freeBytes)) ? formatFreeSpace(Number(d.freeBytes)) : 'Could not check';
    $('diagnosticScreenPermission').textContent = permissionHealthLabel(d.permissions?.screen);
    $('diagnosticMicPermission').textContent = permissionHealthLabel(d.permissions?.microphone);
    $('diagnosticCameraPermission').textContent = permissionHealthLabel(d.permissions?.camera, true);
    $('diagnosticAi').textContent = d.ai?.activeJobs
      ? `${d.ai.activeJobs} local AI task${d.ai.activeJobs === 1 ? '' : 's'} active`
      : (d.ai?.workerAlive ? '✓ Ready' : 'Ready when needed');
    $('diagnosticModels').textContent = `${d.models?.installed || 0}/${d.models?.total || 0} installed · ${formatBytes(d.models?.bytes || 0)}`;
    if (d.recovery?.active) $('diagnosticRecovery').textContent = 'Recording in progress';
    else if (d.recovery?.recovering) $('diagnosticRecovery').textContent = `Recovering${d.recovery.pending ? ` · ${d.recovery.pending} protected` : ''}`;
    else if (Number(d.recovery?.finalizing || 0) > 0) $('diagnosticRecovery').textContent = `Saving ${d.recovery.finalizing} recording${d.recovery.finalizing === 1 ? '' : 's'}`;
    else if (d.recovery?.pending) $('diagnosticRecovery').textContent = `${d.recovery.pending} protected · ${Number(d.recovery.paused || 0) ? 'recovery paused' : 'recovery idle'}`;
    else $('diagnosticRecovery').textContent = '✓ None pending';
    updateAnalyticsUi(d.analytics);
    updateUpdateUi(d.update);

    const canActOnPendingRecovery = Number(d.recovery?.pending || 0) > 0 && !d.recovery?.active && !d.recovery?.recovering && Number(d.recovery?.finalizing || 0) === 0;
    $('recoverDiagnostics')?.classList.toggle('hidden', !canActOnPendingRecovery);
    $('discardRecoveryDiagnostics')?.classList.toggle('hidden', !canActOnPendingRecovery);
    $('stopBackgroundWork')?.classList.toggle('hidden', !d.background?.cancellable);

    const permissionProblem = ['screen', 'microphone'].some((key) => ['denied', 'restricted'].includes(String(d.permissions?.[key] || '').toLowerCase()));
    const storageProblem = Number.isFinite(Number(d.freeBytes)) && Number(d.freeBytes) < 10 * 1024 ** 3;
    const recoveryProblem = Number(d.recovery?.pending || 0) > 0;
    const overall = $('diagnosticOverall');
    const overallDetail = $('diagnosticOverallDetail');
    const overallIcon = $('diagnosticOverallIcon');
    const card = $('diagnosticsHealthCard');
    card?.classList.remove('good', 'warn');
    if (permissionProblem) {
      if (overall) overall.textContent = 'A few items need attention';
      if (overallDetail) overallDetail.textContent = 'A required permission is currently blocked.';
      if (overallIcon) overallIcon.textContent = '!';
      card?.classList.add('warn');
    } else if (recoveryProblem) {
      if (overall) overall.textContent = d.recovery?.recovering ? 'Recovering an unfinished recording' : 'A protected recording needs attention';
      if (overallDetail) {
        overallDetail.textContent = d.recovery?.recovering
          ? 'Recovery is running now. You can let it finish or use Stop background work; a stalled automatic recovery is paused automatically.'
          : 'The unfinished recording is protected, but recovery is not running and updates are not blocked. Recover it now or discard it if you no longer need it.';
      }
      if (overallIcon) overallIcon.textContent = '!';
      card?.classList.add('warn');
    } else if (storageProblem) {
      if (overall) overall.textContent = 'PulseStudio is ready';
      if (overallDetail) overallDetail.textContent = 'Storage is getting low; consider freeing space before a long recording.';
      if (overallIcon) overallIcon.textContent = '✓';
      card?.classList.add('warn');
    } else {
      if (overall) overall.textContent = 'Everything looks good';
      if (overallDetail) overallDetail.textContent = 'Recording, local AI, storage, and recovery checks are ready.';
      if (overallIcon) overallIcon.textContent = '✓';
      card?.classList.add('good');
    }
    return d;
  } catch (error) {
    $('diagnosticBuild').textContent = 'Could not run diagnostics';
    if ($('diagnosticOverall')) $('diagnosticOverall').textContent = 'Diagnostics could not finish';
    if ($('diagnosticOverallDetail')) $('diagnosticOverallDetail').textContent = friendlyErrorText(error);
    return null;
  }
}

async function openAboutDiagnostics() { $('aboutDialog').showModal(); await refreshDiagnostics(); }

async function discardRecoveryFromUi() {
  const pending = Number(state.lastDiagnostics?.recovery?.pending || 0);
  const label = pending > 1 ? `${pending} protected recordings` : 'the protected unfinished recording';
  const confirmed = window.confirm(`Discard ${label}?\n\nThis permanently removes the protected recovery source. This cannot be undone.`);
  if (!confirmed) return false;
  const result = await window.recorderAPI.discardRecovery?.().catch((error) => ({ ok: false, reason: friendlyErrorText(error) }));
  if (!result?.ok) {
    showToast(result?.reason || 'Could not discard the protected recovery.', 'warning', 4800);
    return false;
  }
  hideRecoveryNotice();
  showToast(result.message || 'Protected recovery discarded');
  await updateReadiness().catch(() => {});
  if ($('aboutDialog')?.open) await refreshDiagnostics();
  if (state.latestUpdateStatus?.state === 'deferred') {
    const status = await window.recorderAPI.checkForUpdates().catch(() => null);
    if (status) updateUpdateUi(status);
  }
  return true;
}

async function stopBackgroundWorkFromUi() {
  const button = $('stopBackgroundWork');
  if (button) { button.disabled = true; button.textContent = 'Stopping…'; }
  try {
    const result = await window.recorderAPI.stopBackgroundWork?.().catch((error) => ({ ok: false, reason: friendlyErrorText(error) }));
    if (!result?.ok) {
      showToast(result?.reason || 'Background work could not be stopped.', 'warning', 4800);
      return false;
    }
    showToast(result.idle ? 'Background work stopped. PulseStudio is idle.' : (result.remainingBlocker || 'Background work is still stopping.'), result.idle ? 'success' : 'warning', 4800);
    await updateReadiness().catch(() => {});
    if ($('aboutDialog')?.open) await refreshDiagnostics();
    if (result.idle && state.latestUpdateStatus?.state === 'deferred') {
      const status = await window.recorderAPI.checkForUpdates().catch(() => null);
      if (status) updateUpdateUi(status);
    }
    return Boolean(result.idle);
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Stop background work'; }
  }
}

function applyStartupRecoveryState(payload = {}) {
  const busy = Boolean(payload?.inProgress);
  state.startupRecoveryBusy = busy;
  const stopping = Boolean(payload?.stopping);
  const cancelButton = $('cancelRecoveryButton');
  if (cancelButton) {
    cancelButton.classList.toggle('hidden', !busy);
    cancelButton.disabled = stopping;
    cancelButton.textContent = stopping ? 'Stopping…' : 'Stop recovery';
  }
  if ($('discardRecovery')) $('discardRecovery').disabled = busy;
  const recordingActive = Boolean(state.mediaRecorder && state.mediaRecorder.state !== 'inactive');
  syncRecordStartAvailability();
  if (!recordingActive && !state.isStarting && !state.isStopping && busy) {
    setStatus(stopping
      ? 'Stopping previous-recording recovery… Your protected source remains available.'
      : 'Recovering a previous recording automatically in the background. You can stop it or start a new recording at any time.');
  }
  if ($('aboutDialog')?.open) void refreshDiagnostics();
}

async function consumeStartupRecoveryNotice() {
  const recovery = await window.recorderAPI.getRecoveryStatus().catch(() => null);
  if (!recovery?.message) return null;
  if (recovery.cancelled || recovery.paused) {
    setStatus('Previous-recording recovery is paused. The protected source can be recovered later.');
    if ((recovery.title || '').toLowerCase().includes('for recording') || /yielded to recording/i.test(recovery.title || '') || /new recording started/i.test(recovery.message || '')) {
      // Recording has priority. Do not cover the capture controls with a recovery card
      // merely because background salvage politely yielded to the new recording.
      showToast('Previous recovery paused while recording', 'warning', 3200);
    } else {
      showRecoveryNotice({ title: recovery.title || 'Recovery paused', detail: recovery.message || 'The unfinished recording remains protected and can be recovered later.' });
    }
  } else if (recovery.recovered) {
    state.recordingStartHardBlocked = false;
    state.recordingStartHardBlockReason = '';
    syncRecordStartAvailability();
    setStatus('An unfinished recording was recovered successfully.');
    showRecoveryNotice({ recovered: true, detail: recovery.message || 'Your recording was recovered successfully and is available in Playback.' });
    showToast('Recovered unfinished recording');
    if (recovery.path) { await refreshRecordings(); runAutomaticTranscription(recovery.path, false); }
  } else {
    setStatus('An unfinished recording is protected. Recovery is idle and does not block updates.', false);
    showRecoveryNotice({
      title: recovery.title || 'Unfinished recording found',
      detail: recovery.message || 'Your recording data is safe. PulseStudio can recover it while idle, or you can discard the protected copy if you no longer need it.'
    });
  }
  if ($('aboutDialog')?.open) await refreshDiagnostics();
  return recovery;
}

async function showFirstRunSetupIfNeeded() {
  if (localStorage.getItem('firstRunSetupCompleted') === '1') return false;
  const dialog = $('firstRunDialog');
  const returnToMini = state.viewMode === 'compact';
  if (returnToMini) await applyViewMode('full', true);
  dialog.dataset.returnToMini = returnToMini ? '1' : '0';
  $('firstRunFolder').textContent = `Current folder: ${compactRecordingFolderLabel(state.recordingsDirectory || '')}`;
  dialog.showModal();
  return true;
}


async function init() {
  const savedTheme = localStorage.getItem('theme');
  const preferredTheme = savedTheme || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  applyTheme(preferredTheme);
  applyUiTheme(localStorage.getItem('uiTheme') || 'classic');
  initFastTooltips();
  applyThumbnailSize(localStorage.getItem('thumbnailSize') || 250);
  // Load the saved Mini transparency before the hidden native window is revealed,
  // so a restored Mini View starts directly at the user's chosen opacity.
  {
    const savedTransparency = Number(localStorage.getItem('transparencyPercent') || 0);
    state.transparencyPercent = [0, 10, 20, 30, 50].includes(savedTransparency) ? savedTransparency : 0;
  }
  // v0.2.82: restore the last Full/Mini state before the hidden BrowserWindow is
  // revealed. Prefer the main-process state once it exists; fall back to the
  // existing localStorage value to migrate users from v0.2.81 without a flash.
  const nativeViewState = await window.recorderAPI.getWindowViewState?.().catch(() => null);
  const savedRendererViewMode = localStorage.getItem('viewMode') === 'compact' ? 'compact' : 'full';
  const initialViewMode = nativeViewState?.hasSavedState
    ? (nativeViewState.mode === 'compact' ? 'compact' : 'full')
    : savedRendererViewMode;
  await applyViewMode(initialViewMode, true);
  try { await window.recorderAPI.notifyUiReady?.(); } catch {}
  applySettingsCollapsed(localStorage.getItem('settingsCollapsed') === '1');
  applyRecordAdvancedCollapsed(state.recordAdvancedCollapsed, false);
  applyAppToolsCollapsed(state.appToolsCollapsed, false);
  applyCompactCaptureCollapsed(localStorage.getItem('compactCaptureCollapsed') !== '0', false);
  state.transcriptView = normalizeTranscriptView(localStorage.getItem('transcriptView') || 'raw');
  applyTranscriptViewUi();
  updateTranscriptActions();
  applyPlaybackPreferences();
  setRecordingUi(false);
  state.unsubscribeStartupRecovery = window.recorderAPI.onStartupRecoveryState?.((payload) => {
    applyStartupRecoveryState(payload);
    void updateReadiness();
  });
  state.unsubscribeRecoveryNotice = window.recorderAPI.onRecoveryStatusChanged?.(() => {
    void consumeStartupRecoveryNotice();
  });
  state.unsubscribeCloseBlocked = window.recorderAPI.onWindowCloseBlockedRecording?.(() => {
    showToast('Stop the recording before closing the recorder window.', 'warning', 4200);
    setStatus('Recording is still active. Stop it before closing the window.', true);
  });
  applyStartupRecoveryState(await window.recorderAPI.getStartupRecoveryState?.().catch(() => ({ inProgress: false })) || { inProgress: false });
  if ($('captureMode')) {
    const storedCaptureMode = localStorage.getItem('captureMode');
    if (['source', 'region', 'all'].includes(storedCaptureMode)) $('captureMode').value = storedCaptureMode;
  }
  updateCaptureModeUi();
  if ($('filenameTemplate')) {
    const oldTemplate = localStorage.getItem('filenameTemplate');
    const storedStyle = localStorage.getItem('filenameStyle') || ((oldTemplate && oldTemplate !== 'Electron_{date}_{time}') ? 'custom' : 'friendly');
    if (oldTemplate && oldTemplate !== 'Electron_{date}_{time}') localStorage.setItem('customFilenameTemplate', oldTemplate);
    applyFilenameStyle(storedStyle, false);
  }
  if ($('recordingKind')) $('recordingKind').value = localStorage.getItem('recordingKind') === 'audio' ? 'audio' : 'video';
  if ($('videoCodec')) $('videoCodec').value = localStorage.getItem('videoCodec') === 'h265' ? 'h265' : 'h264';
  if ($('frameRate')) { const storedFps = Number(localStorage.getItem('frameRate')); if ([15,25,30,60].includes(storedFps)) $('frameRate').value = String(storedFps); }
  if ($('quality')) { const storedQuality = localStorage.getItem('quality'); if (['720','1080','1440','native'].includes(storedQuality)) $('quality').value = storedQuality; }
  if ($('compactQuality')) $('compactQuality').value = $('quality')?.value || '1080';
  if ($('compactFrameRate')) $('compactFrameRate').value = $('frameRate')?.value || '30';
  if ($('compactCaptureMode')) $('compactCaptureMode').value = $('captureMode')?.value || 'source';
  if ($('systemAudio') && localStorage.getItem('systemAudioEnabled') != null) $('systemAudio').checked = localStorage.getItem('systemAudioEnabled') !== '0';
  if ($('microphone') && localStorage.getItem('microphoneEnabled') != null) $('microphone').checked = localStorage.getItem('microphoneEnabled') !== '0';
  if ($('computerAudioMode')) $('computerAudioMode').value = localStorage.getItem('computerAudioMode') === 'application' ? 'application' : 'system';
  if ($('recordCountdown')) {
    const storedCountdown = Number(localStorage.getItem('recordCountdown'));
    $('recordCountdown').value = storedCountdown === 3 || storedCountdown === 5 ? String(storedCountdown) : '0';
  }
  if ($('noiseReduction')) {
    const storedNoise = localStorage.getItem('noiseReduction');
    $('noiseReduction').value = ['off', 'standard', 'enhanced', 'strong'].includes(storedNoise) ? storedNoise : 'enhanced';
  }
  $('micSettings')?.classList.toggle('hidden', !$('microphone')?.checked);
  $('computerAudioSettings')?.classList.toggle('hidden', !$('systemAudio')?.checked);
  syncPreflightMicMuteButton();
  updateRecordingKindUi();
  if ($('trimSnapSilence')) $('trimSnapSilence').checked = state.trimSnapSilence;
  applyTrimZoom(state.trimZoom, false);
  updateTrimUi();

  const info = await window.recorderAPI.platformInfo();
  state.platformInfo = info;
  applyStartupRecoveryState({ inProgress: Boolean(info.startupRecoveryInProgress) });
  document.documentElement.dataset.platform = info.platform;
  $('aboutVersion').textContent = info.version || '0.2.129';
  renderWindowCapturePrivacy(await window.recorderAPI.getWindowCapturePrivacy?.().catch(() => ({ enabled: true, supported: info.platform === 'darwin' || info.platform === 'win32' })) || { enabled: true, supported: true });
  const applicationAudioOption = $('computerAudioMode')?.querySelector('option[value="application"]');
  if (applicationAudioOption && !info.applicationAudioSupported) applicationAudioOption.disabled = true;
  if ($('applicationAudioHint')) $('applicationAudioHint').textContent = info.applicationAudioSupported
    ? 'Select an application window to record only that app’s audio. Other application audio will be excluded where the operating system supports it.'
    : (info.applicationAudioCapability?.message || 'Selected application audio is unavailable on this system. System audio remains available.');
  if (!info.applicationAudioSupported && $('computerAudioMode')?.value === 'application') $('computerAudioMode').value = 'system';
  const showKeystrokes = $('showKeystrokes');
  if (showKeystrokes && info.keystrokeOverlaySupported === false) {
    showKeystrokes.checked = false;
    showKeystrokes.disabled = true;
    const row = showKeystrokes.closest('.toggle-row');
    if (row) {
      row.title = info.keystrokeOverlayReason || 'Show keystrokes is unavailable on this Mac.';
      const detail = row.querySelector('span');
      if (detail) detail.textContent = 'Disabled on macOS so keyboard and mouse stay responsive after sleep/wake';
    }
  }
  state.recordingsDirectory = info.recordingsDirectory;
  updatePlaybackFolderLabel(info.recordingsDirectory);
  $('autosaveFolder').textContent = info.recordingsDirectory;
  if ($('recordingFolderPath')) { $('recordingFolderPath').textContent = info.recordingsDirectory; $('recordingFolderPath').title = info.recordingsDirectory; }
  updateRecordDestinationIndicator(info.recordingsDirectory);
  await applyTransparency(Number(localStorage.getItem('transparencyPercent') || 0), false);
  await applyAlwaysOnTop(localStorage.getItem('compactAlwaysOnTop') === '1', false);
  initPlaybackSplitter();
  initWaveformResizeObserver();
  initStickyPlaybackControls();
  document.querySelector('[data-seek="-1"]')?.setAttribute('title', 'Back 1 second (←)');
  document.querySelector('[data-seek="1"]')?.setAttribute('title', 'Forward 1 second (→)');
  document.querySelector('[data-seek="-5"]')?.setAttribute('title', 'Back 5 seconds (J or Shift+←)');
  document.querySelector('[data-seek="5"]')?.setAttribute('title', 'Forward 5 seconds (L or Shift+→)');
  applyInsightsCollapseState(false);
  wireWindowDragging();
  updateRecordingSizeEstimate();

  state.unsubscribeAiStatus = window.recorderAPI.onAiStatus(handleAiStatus);
  state.unsubscribeVoiceHighlightsUpdated = MY_VOICE_HIGHLIGHTS_ENABLED
    ? window.recorderAPI.onRecordingVoiceHighlightsUpdated?.((payload) => {
        if (!payload?.path || payload.path !== state.selectedPlaybackPath) return;
        state.playbackVoiceHighlights = Array.isArray(payload.segments) ? payload.segments : [];
        renderPlaybackMarkers();
        renderPlaybackChapterSidebar();
      })
    : null;
  state.unsubscribeUpdateStatus = window.recorderAPI.onUpdateStatus(updateUpdateUi);
  updateUpdateUi(await window.recorderAPI.getUpdateStatus().catch(() => ({ state: 'unavailable' })));
  state.unsubscribeAnalyticsStatus = window.recorderAPI.onAnalyticsStatus?.(updateAnalyticsUi);
  updateAnalyticsUi(await window.recorderAPI.getAnalyticsStatus?.().catch(() => ({ configured: false, enabled: false })));
  wireAnonymousUsageInstrumentation();
  const aiSnapshot = await window.recorderAPI.getAiStatus().catch(() => null);
  for (const job of aiSnapshot?.jobs || []) handleAiStatus(job);
  clearInterval(state.aiStatusTicker);
  state.aiStatusTicker = setInterval(renderAiStatusCenter, 1000);
  $('cancelAiJob')?.addEventListener('click', async () => {
    const jobId = $('cancelAiJob').dataset.jobId;
    if (!jobId) return;
    // Give immediate visual feedback instead of leaving a queued card looking as
    // though Cancel did nothing while IPC/status delivery catches up.
    const job = state.aiJobs.get(jobId);
    if (job) {
      if (job.state === 'queued') {
        state.aiJobs.set(jobId, { ...job, state: 'cancelled', detail: 'Cancelled', cancellable: false, updatedAt: Date.now(), _receivedAt: Date.now() });
      } else if (job.state === 'running') {
        state.aiJobs.set(jobId, { ...job, state: 'cancelling', detail: 'Cancelling…', cancellable: false, updatedAt: Date.now(), _receivedAt: Date.now() });
      }
      renderAiStatusCenter();
    }
    const cancelled = await window.recorderAPI.cancelAiJob(jobId).catch(() => false);
    if (!cancelled && job) {
      state.aiJobs.delete(jobId);
      renderAiStatusCenter();
    }
  });

  state.unsubscribeKeystroke = window.recorderAPI.onKeystroke((payload) => {
    if (!$('showKeystrokes').checked || !state.mediaRecorder || state.mediaRecorder.state === 'inactive') return;
    if (!payload?.label) return;
    state.recentKeystrokes.push({ label: payload.label, at: payload.at || Date.now() });
    state.recentKeystrokes = state.recentKeystrokes.slice(-6);
  });

  await initializeCaptureSources();
  await refreshRecordings();
  await loadAudioDevices(false);
  if (MY_VOICE_HIGHLIGHTS_ENABLED) await refreshVoiceEnrollmentStatus();
  await loadCameraDevices(false);
  await consumeStartupRecoveryNotice();
  await updateReadiness();
  refreshPreflightMicMonitor();
  clearInterval(state.readinessTimer);
  state.readinessTimer = setInterval(updateReadiness, 15000);

  $('captureWorkspaceTab').addEventListener('click', () => setWorkspace('capture'));
  $('playbackWorkspaceTab').addEventListener('click', () => setWorkspace('playback'));
  $('refreshSources').addEventListener('click', refreshSources);
  $('refreshRecordings').addEventListener('click', refreshRecordings);
  $('openRecordingsFolder').addEventListener('click', () => window.recorderAPI.openRecordingsFolder());
  $('librarySearch').addEventListener('input', (event) => scheduleLibrarySearch(event.target.value));
  $('clearLibrarySearch').addEventListener('click', () => { $('librarySearch').value = ''; applyLibrarySearch(''); $('librarySearch').focus(); });
  document.querySelectorAll('[data-library-filter]').forEach((button) => {
    button.addEventListener('click', () => setLibraryQuickFilter(button.dataset.libraryFilter));
  });
  $('categoryFilter').addEventListener('change', (event) => {
    clearBatchSelectionForFilterChange();
    state.categoryFilter = event.target.value;
    renderRecordings();
    updatePlaybackClipNavigation();
  });
  $('batchSelectButton').addEventListener('click', () => setBatchSelectionMode(!state.batchSelectionMode));
  $('batchCancelSelection').addEventListener('click', () => setBatchSelectionMode(false));
  $('batchSelectAll').addEventListener('change', (event) => {
    const visible = visiblePlaybackRecordings();
    if (event.target.checked) visible.forEach((item) => state.batchSelectedPaths.add(item.path));
    else visible.forEach((item) => state.batchSelectedPaths.delete(item.path));
    renderRecordings();
    updateBatchDeleteUi();
  });
  $('batchDeleteSelected').addEventListener('click', deleteSelectedRecordings);
  $('newCategoryButton').addEventListener('click', () => {
    $('categoryNameInput').value = '';
    $('categoryDialogStatus').textContent = '';
    $('categoryDialog').showModal();
    setTimeout(() => $('categoryNameInput').focus(), 0);
  });
  const createCategory = async () => {
    const name = $('categoryNameInput').value.trim();
    if (!name) {
      $('categoryDialogStatus').textContent = 'Enter a category name.';
      return;
    }
    try {
      const result = await window.recorderAPI.createRecordingCategory(name);
      state.categories = result.categories || state.categories;
      state.categoryFilter = '__all__';
      updateCategoryFilterOptions();
      renderRecordings();
      $('categoryDialog').close();
    } catch (error) {
      $('categoryDialogStatus').textContent = friendlyErrorText(error);
    }
  };
  $('createCategoryConfirm').addEventListener('click', createCategory);
  $('categoryNameInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') createCategory();
  });
  $('thumbnailSize').addEventListener('input', (event) => applyThumbnailSize(event.target.value));
  $('fullViewButton').addEventListener('click', () => applyViewMode('full'));
  $('compactViewButton').addEventListener('click', () => applyViewMode('compact'));
  $('compactFullViewButton')?.addEventListener('click', () => applyViewMode('full'));
  $('compactMacMinimizeButton')?.addEventListener('click', () => window.recorderAPI.minimizeWindow?.());
  $('compactMacCloseButton')?.addEventListener('click', () => window.recorderAPI.closeWindow?.());
  $('settingsCollapseButton').addEventListener('click', () => applySettingsCollapsed(!state.settingsCollapsed));
  $('recordAdvancedToggle')?.addEventListener('click', () => applyRecordAdvancedCollapsed(!state.recordAdvancedCollapsed));
  $('appToolsToggle')?.addEventListener('click', () => applyAppToolsCollapsed(!state.appToolsCollapsed));
  if (MY_VOICE_HIGHLIGHTS_ENABLED) $('voiceEnrollButton')?.addEventListener('click', enrollMyVoice);
  if (MY_VOICE_HIGHLIGHTS_ENABLED) $('voiceClearButton')?.addEventListener('click', clearMyVoiceProfile);
  $('windowCapturePrivacyToggle')?.addEventListener('click', () => setWindowCapturePrivacy(!state.windowCapturePrivacyEnabled));
  $('transparencyButton').addEventListener('click', async () => {
    const levels = [0, 10, 20, 30, 50];
    const currentIndex = Math.max(0, levels.indexOf(state.transparencyPercent));
    const nextValue = levels[(currentIndex + 1) % levels.length];
    await applyTransparency(nextValue);
    showFastTooltipForClick($('transparencyButton'), 1800);
  });
  $('alwaysOnTopButton').addEventListener('click', () => applyAlwaysOnTop(!state.alwaysOnTop));
  $('compactCaptureSettingsToggle').addEventListener('click', () => applyCompactCaptureCollapsed(!state.compactCaptureCollapsed));
  $('compactCaptureMode').addEventListener('change', () => {
    $('captureMode').value = $('compactCaptureMode').value;
    localStorage.setItem('captureMode', $('captureMode').value);
    updateCaptureModeUi();
    $('compactChooseRegion').classList.toggle('hidden', state.compactCaptureCollapsed || $('compactCaptureMode').value !== 'region');
    previewFilenameTemplate();
    updateReadiness();
  });
  $('compactQuality').addEventListener('change', () => {
    $('quality').value = $('compactQuality').value;
    localStorage.setItem('quality', $('quality').value);
    updateRecordingSizeEstimate();
    updateReadiness();
  });
  $('compactFrameRate').addEventListener('change', () => {
    $('frameRate').value = $('compactFrameRate').value;
    localStorage.setItem('frameRate', $('frameRate').value);
    updateRecordingSizeEstimate();
    updateReadiness();
  });
  $('compactChooseRegion').addEventListener('click', openRegionDialog);
  $('compactSourceSelect').addEventListener('change', async (event) => {
    const changed = state.selectedSourceId !== event.target.value;
    state.selectedSourceId = event.target.value;
    persistPreferredCaptureSource(selectedSource());
    await window.recorderAPI.selectSource(state.selectedSourceId);
    if (changed && state.regionSourceId && state.regionSourceId !== state.selectedSourceId) clearRegionSelection();
    renderSources();
    updateRegionSummary();
    previewFilenameTemplate();
    updateReadiness();
  });
  $('themeToggle').addEventListener('click', () => { const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; window.recorderAPI.logEvent?.('info', 'ui.theme_changed', { theme: next }); applyTheme(next); });
  $('themesButton')?.addEventListener('click', openThemesDialog);
  $('themeClassicChoice')?.addEventListener('click', () => { window.recorderAPI.logEvent?.('info', 'ui.studio_theme_changed', { ui_theme: 'classic' }); applyUiTheme('classic'); });
  $('themeStudioChoice')?.addEventListener('click', () => { window.recorderAPI.logEvent?.('info', 'ui.studio_theme_changed', { ui_theme: 'studio' }); applyUiTheme('studio'); });
  $('themesAppearanceToggle')?.addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  $('captureMode').addEventListener('change', () => { localStorage.setItem('captureMode', $('captureMode').value); if ($('compactCaptureMode')) $('compactCaptureMode').value = $('captureMode').value; updateCaptureModeUi(); previewFilenameTemplate(); updateReadiness(); });
  $('chooseRegion').addEventListener('click', openRegionDialog);

  $('regionStage').addEventListener('pointerdown', (event) => {
    event.preventDefault();
    state.regionDragging = true;
    state.regionDragStart = regionPointFromEvent(event);
    state.regionDraft = { x: state.regionDragStart.x, y: state.regionDragStart.y, w: 0, h: 0 };
    $('regionStage').setPointerCapture?.(event.pointerId);
  });
  $('regionStage').addEventListener('pointermove', (event) => {
    if (!state.regionDragging) return;
    state.regionDraft = normalizedRegionFromPoints(state.regionDragStart, regionPointFromEvent(event));
    renderRegionBox(state.regionDraft);
  });
  const finishRegionDrag = (event) => {
    if (!state.regionDragging) return;
    state.regionDragging = false;
    state.regionDraft = normalizedRegionFromPoints(state.regionDragStart, regionPointFromEvent(event));
    if (state.regionDraft.w < 0.02 || state.regionDraft.h < 0.02) state.regionDraft = null;
    renderRegionBox(state.regionDraft);
  };
  $('regionStage').addEventListener('pointerup', finishRegionDrag);
  $('regionStage').addEventListener('pointercancel', finishRegionDrag);
  $('clearRegion').addEventListener('click', clearRegionSelection);
  $('applyRegion').addEventListener('click', () => {
    if (!state.regionDraft) return;
    state.regionNormalized = { ...state.regionDraft };
    state.regionSourceId = state.selectedSourceId;
    updateRegionSummary();
    updateReadiness();
    $('regionDialog').close();
  });

  $('helpButton').addEventListener('click', () => $('helpDialog').showModal());
  $('aboutButton').addEventListener('click', openAboutDiagnostics);
  $('openDiagnostics')?.addEventListener('click', openAboutDiagnostics);
  $('analyticsToggle')?.addEventListener('click', async () => {
    const button = $('analyticsToggle');
    if (!button || button.disabled) return;
    const next = button.getAttribute('aria-pressed') !== 'true';
    const status = await window.recorderAPI.setAnalyticsEnabled(next).catch(() => null);
    if (status) updateAnalyticsUi(status);
  });
  $('sendFeedback')?.addEventListener('click', openFeedbackPage);
  $('sendFeedbackDiagnostics')?.addEventListener('click', openFeedbackPage);
  $('analyticsReminderEnable')?.addEventListener('click', async () => {
    const button = $('analyticsReminderEnable');
    if (button) button.disabled = true;
    const status = await window.recorderAPI.setAnalyticsEnabled(true).catch(() => null);
    if (status) updateAnalyticsUi(status);
    await closeAnalyticsReminder();
    if (button) button.disabled = false;
  });
  $('analyticsReminderContinue')?.addEventListener('click', closeAnalyticsReminder);
  $('openModelManager')?.addEventListener('click', async () => { $('modelManagerDialog').showModal(); await refreshModelManager(); });
  $('refreshModels')?.addEventListener('click', refreshModelManager);
  $('openModelsFolder')?.addEventListener('click', () => window.recorderAPI.openLocalModelsFolder());
  $('firstRunChooseFolder')?.addEventListener('click', async () => { await chooseRecordingFolder(); $('firstRunFolder').textContent = `Current folder: ${compactRecordingFolderLabel(state.recordingsDirectory || '')}`; });
  $('completeFirstRun')?.addEventListener('click', async () => { const dialog = $('firstRunDialog'); const returnToMini = dialog?.dataset.returnToMini === '1'; localStorage.setItem('firstRunSetupCompleted', '1'); dialog?.close(); if (returnToMini) await applyViewMode('compact', true); });
  $('cancelRecoveryButton')?.addEventListener('click', async () => {
    const button = $('cancelRecoveryButton');
    if (!button || button.disabled) return;
    button.disabled = true;
    button.textContent = 'Stopping…';
    try {
      const result = await window.recorderAPI.cancelRecovery();
      if (!result?.requested) {
        state.startupRecoveryBusy = false;
        applyStartupRecoveryState({ inProgress: false });
      }
      showRecoveryNotice({ title: result?.paused ? 'Recovery paused' : 'Recovery stopping', detail: result?.message || 'Stopping recovery. The unfinished recording remains protected.' });
      await updateReadiness();
      if ($('aboutDialog')?.open) await refreshDiagnostics();
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Stop recovery';
      showToast(`Could not stop recovery. ${friendlyErrorText(error)}`, 'warning', 4200);
    }
  });
  $('retryRecovery')?.addEventListener('click', async () => {
    $('retryRecovery').disabled = true;
    $('retryRecovery').textContent = 'Recovering…';
    try {
      const result = await window.recorderAPI.retryRecovery();
      if (result?.cancelled) {
        showRecoveryNotice({ title: 'Recovery stopped', detail: result.message || 'The unfinished recording remains protected and can be recovered later.' });
      } else if (result?.recovered) {
        state.recordingStartHardBlocked = false;
        state.recordingStartHardBlockReason = '';
        syncRecordStartAvailability();
        showRecoveryNotice({ recovered: true, detail: result.none ? 'No unfinished recordings need recovery.' : 'Your recording was recovered successfully and is available in Playback.' });
        if (result.path) { await refreshRecordings(); runAutomaticTranscription(result.path, false); }
        await updateReadiness();
      } else if (result?.busy) {
        $('recoveryNoticeDetail').textContent = result.message || 'Finish the current recording before recovery.';
      } else {
        $('recoveryNoticeDetail').textContent = result?.message || 'Recovery needs another attempt. Your source files remain protected.';
      }
    } catch (error) { $('recoveryNoticeDetail').textContent = friendlyErrorText(error); }
    finally {
      $('retryRecovery').disabled = false;
      $('retryRecovery').textContent = 'Recover';
      if ($('aboutDialog')?.open) await refreshDiagnostics();
    }
  });
  $('recoverDiagnostics')?.addEventListener('click', () => $('retryRecovery')?.click());
  $('discardRecovery')?.addEventListener('click', discardRecoveryFromUi);
  $('discardRecoveryDiagnostics')?.addEventListener('click', discardRecoveryFromUi);
  $('stopBackgroundWork')?.addEventListener('click', stopBackgroundWorkFromUi);
  $('showRecoveryFiles')?.addEventListener('click', () => window.recorderAPI.openRecoveryFolder());
  $('dismissRecoveryNotice')?.addEventListener('click', hideRecoveryNotice);
  const firstRunShown = await showFirstRunSetupIfNeeded();
  if (firstRunShown) {
    $('firstRunDialog')?.addEventListener('close', () => { setTimeout(() => { void showAnalyticsReminderIfDisabled(); }, 180); }, { once: true });
  } else {
    await showAnalyticsReminderIfDisabled();
  }
  $('copyDiagnostics')?.addEventListener('click', async () => { const d = state.lastDiagnostics || await refreshDiagnostics(); if (!d) return; await window.recorderAPI.copyText(JSON.stringify(d, null, 2)); showToast('Diagnostics copied'); });
  async function exportDiagnosticsFromUi(triggerButton = null) {
    const buttons = [$('exportDiagnostics'), $('exportDiagnosticsQuick')].filter(Boolean);
    try {
      buttons.forEach((button) => { button.disabled = true; });
      if (triggerButton) triggerButton.textContent = 'Exporting…';
      const includeRecording = Boolean($('diagnosticsIncludeRecording')?.checked && state.selectedPlaybackPath);
      const result = await window.recorderAPI.exportDiagnostics({ includeRecording, recordingPath: includeRecording ? state.selectedPlaybackPath : '' });
      if (result?.cancelled) return;
      showToast(includeRecording ? 'Diagnostics ZIP exported with selected recording' : 'Diagnostics ZIP exported');
    } catch (error) { showToast(`Could not export diagnostics. ${friendlyErrorText(error)}`, 'error', 4800); }
    finally {
      buttons.forEach((button) => { button.disabled = false; });
      if ($('exportDiagnostics')) $('exportDiagnostics').textContent = 'Export Diagnostics ZIP';
      if ($('exportDiagnosticsQuick')) $('exportDiagnosticsQuick').textContent = 'Export Diagnostics ZIP';
    }
  }
  $('exportDiagnostics')?.addEventListener('click', (event) => exportDiagnosticsFromUi(event.currentTarget));
  $('exportDiagnosticsQuick')?.addEventListener('click', (event) => exportDiagnosticsFromUi(event.currentTarget));
  $('openLogs')?.addEventListener('click', async () => {
    const dir = await window.recorderAPI.openLogFolder?.().catch(() => null);
    if (dir) showToast('Opened diagnostic logs');
  });
  $('checkUpdates')?.addEventListener('click', async () => { $('diagnosticUpdate').textContent = 'Checking…'; const result = await window.recorderAPI.checkForUpdates().catch((error) => ({ state: 'error', message: friendlyErrorText(error) })); updateUpdateUi(result); });
  $('installUpdate')?.addEventListener('click', async () => { const result = await window.recorderAPI.installUpdate(); if (!result?.ok) showToast(result?.reason || 'The update will wait until PulseStudio is idle.', 'warning', 4200); });
  $('updatePrimaryAction')?.addEventListener('click', async () => {
    const current = state.latestUpdateStatus || {};
    try {
      if (current.state === 'ready') {
        const install = await window.recorderAPI.installUpdate();
        if (!install?.ok) showToast(install?.reason || 'Finish the current activity before restarting.', 'warning', 4200);
        return;
      }
      const downloaded = await window.recorderAPI.downloadUpdate();
      updateUpdateUi(downloaded);
      if (downloaded?.state === 'ready') {
        const install = await window.recorderAPI.installUpdate();
        if (!install?.ok) showToast(install?.reason || 'Finish the current activity before restarting.', 'warning', 4200);
      } else if (downloaded?.state === 'error') {
        showToast(downloaded.message || 'The update could not be downloaded.', 'error', 4800);
      }
    } catch (error) {
      showToast(`The update could not continue. ${friendlyErrorText(error)}`, 'error', 4800);
    }
  });
  $('updateRemindLater')?.addEventListener('click', async () => {
    const result = await window.recorderAPI.remindUpdateLater().catch((error) => ({ ok: false, reason: friendlyErrorText(error) }));
    if (!result?.ok) return showToast(result?.reason || 'Could not postpone the update reminder.', 'warning', 4200);
    updateUpdateUi(result.status);
    showToast('Update reminder postponed');
  });
  $('updateSkipVersion')?.addEventListener('click', async () => {
    const result = await window.recorderAPI.skipUpdateVersion().catch((error) => ({ ok: false, reason: friendlyErrorText(error) }));
    if (!result?.ok) return showToast(result?.reason || 'Could not skip this version.', 'warning', 4200);
    updateUpdateUi(result.status);
    showToast(`Skipped PulseStudio v${result.status?.availableVersion || ''}`.trim());
  });
  $('updateAvailableDialog')?.addEventListener('cancel', (event) => {
    const current = state.latestUpdateStatus || {};
    if (current.state === 'downloading' || current.state === 'installing') { event.preventDefault(); return; }
    if (current.state === 'available' || (current.state === 'error' && current.canDownload)) {
      event.preventDefault();
      $('updateRemindLater')?.click();
    }
  });
  document.querySelectorAll('[data-close-dialog]').forEach((button) => {
    button.addEventListener('click', () => $(button.dataset.closeDialog)?.close());
  });

  const toggleRecordingFromPrimary = async () => {
    if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') await stopRecording();
    else await startRecording();
  };
  $('startButton').addEventListener('click', toggleRecordingFromPrimary);
  $('compactStartButton').addEventListener('click', toggleRecordingFromPrimary);
  $('stopButton').addEventListener('click', stopRecording);
  $('pauseButton').addEventListener('click', togglePause);
  $('pausePrimaryButton').addEventListener('click', togglePause);
  $('compactPauseButton').addEventListener('click', togglePause);
  $('compactRecordingMicToggle')?.addEventListener('click', () => toggleRecordingMicrophoneMute('mini-controller'));
  $('recordingMicToggle')?.addEventListener('click', () => toggleRecordingMicrophoneMute('full-view'));
  $('bookmarkPrimaryButton').addEventListener('click', () => addRecordingBookmark());
  $('bookmarkRecording').addEventListener('click', () => addRecordingBookmark());
  $('compactBookmarkButton').addEventListener('click', () => addRecordingBookmark());
  $('snapshotRecording').addEventListener('click', takeLiveSnapshot);
  document.querySelectorAll('[data-recording-kind]').forEach((button) => {
    button.addEventListener('click', () => setRecordingKindFromQuickControl(button.dataset.recordingKind));
  });
  $('webcamQuickToggle')?.addEventListener('click', () => {
    if (recordingKindValue() === 'audio' || $('webcamQuickToggle')?.disabled) return;
    const checkbox = $('webcamOverlay');
    if (!checkbox) return;
    checkbox.checked = !checkbox.checked;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
  });
  $('preflightMicMuteButton')?.addEventListener('click', () => {
    const recordingActive = Boolean(state.mediaRecorder && state.mediaRecorder.state !== 'inactive');
    if (recordingActive) {
      toggleRecordingMicrophoneMute('full-view-audio-check');
      return;
    }
    const checkbox = $('microphone');
    if (!checkbox || checkbox.disabled || $('preflightMicMuteButton')?.disabled) return;
    checkbox.checked = !checkbox.checked;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
  });
  $('microphone').addEventListener('change', async () => {
    localStorage.setItem('microphoneEnabled', $('microphone').checked ? '1' : '0');
    syncPreflightMicMuteButton();
    updateRecordingSizeEstimate();
    $('micSettings').classList.toggle('hidden', !$('microphone').checked);
    if ($('microphone').checked) await loadAudioDevices(false);
    await updateReadiness();
    refreshPreflightMicMonitor();
  });

  $('systemAudio').addEventListener('change', () => {
    localStorage.setItem('systemAudioEnabled', $('systemAudio').checked ? '1' : '0');
    updateRecordingSizeEstimate();
    $('computerAudioSettings')?.classList.toggle('hidden', !$('systemAudio').checked);
    updatePreflightSystemIdleState();
    updateReadiness();
  });
  $('computerAudioMode').addEventListener('change', () => {
    localStorage.setItem('computerAudioMode', $('computerAudioMode').value);
    updateReadiness();
  });
  $('noiseReduction').addEventListener('change', () => {
    localStorage.setItem('noiseReduction', $('noiseReduction').value);
    updateReadiness();
  });
  $('quality').addEventListener('change', () => { localStorage.setItem('quality', $('quality').value); if ($('compactQuality')) $('compactQuality').value = $('quality').value; updateRecordingSizeEstimate(); updateReadiness(); });
  $('frameRate').addEventListener('change', () => { localStorage.setItem('frameRate', $('frameRate').value); if ($('compactFrameRate')) $('compactFrameRate').value = $('frameRate').value; updateRecordingSizeEstimate(); updateReadiness(); });
  $('videoCodec').addEventListener('change', () => { localStorage.setItem('videoCodec', $('videoCodec').value); updateRecordingSizeEstimate(); updateReadiness(); });
  $('recordingKind').addEventListener('change', () => {
    localStorage.setItem('recordingKind', $('recordingKind').value);
    updateRecordingKindUi();
  });
  $('filenameStyle')?.addEventListener('change', () => applyFilenameStyle($('filenameStyle').value, true));
  $('filenameTemplate').addEventListener('input', () => {
    localStorage.setItem('customFilenameTemplate', $('filenameTemplate').value);
    localStorage.setItem('filenameTemplate', $('filenameTemplate').value);
    if ($('filenameStyle')?.value !== 'custom') applyFilenameStyle('custom', true);
    else previewFilenameTemplate();
  });
  $('webcamOverlay').addEventListener('change', async () => {
    $('webcamSettings').classList.toggle('hidden', !$('webcamOverlay').checked || recordingKindValue() === 'audio');
    syncQuickRecordingControls();
    if ($('webcamOverlay').checked && recordingKindValue() !== 'audio') await loadCameraDevices(true);
    updateReadiness();
  });
  $('cameraDevice').addEventListener('change', updateReadiness);
  $('microphoneDevice').addEventListener('change', async () => { localStorage.setItem('microphoneDevice', $('microphoneDevice').value || 'default'); await updateReadiness(); refreshPreflightMicMonitor(); });
  $('recordCountdown')?.addEventListener('change', () => localStorage.setItem('recordCountdown', $('recordCountdown').value));

  $('showInFolder').addEventListener('click', () => state.savedPath && window.recorderAPI.showInFolder(state.savedPath));
  $('copySavedPath').addEventListener('click', async () => {
    if (!state.savedPath) return;
    await window.recorderAPI.copyText(state.savedPath);
    $('savedSummary').textContent = 'Recording path copied to clipboard.';
  });
  $('changeRecordingFolder')?.addEventListener('click', chooseRecordingFolder);
  $('recordDestinationChange')?.addEventListener('click', chooseRecordingFolder);
  $('resetRecordingFolder')?.addEventListener('click', resetRecordingFolder);

  $('showPlaybackFile').addEventListener('click', () => { if (state.selectedPlaybackPath) window.recorderAPI.showInFolder(state.selectedPlaybackPath); closePlaybackMoreMenu(); });
  $('copyPlaybackPath').addEventListener('click', async () => {
    if (state.selectedPlaybackPath) { await window.recorderAPI.copyText(state.selectedPlaybackPath); showToast('Recording path copied'); }
    closePlaybackMoreMenu();
  });
  $('renamePlaybackFile').addEventListener('click', () => {
    if (state.selectedPlaybackPath) startInlineRename(state.selectedPlaybackPath);
  });
  $('playbackMoreButton')?.addEventListener('click', (event) => { event.stopPropagation(); togglePlaybackMoreMenu(); });
  $('playbackMoreMenu')?.addEventListener('click', (event) => event.stopPropagation());
  document.addEventListener('click', closePlaybackMoreMenu);
  $('moreShowTranscriptFiles')?.addEventListener('click', () => {
    const target = state.transcriptTxtPath || state.transcriptSrtPath || state.transcriptTargetPath;
    if (target) window.recorderAPI.showInFolder(target);
    closePlaybackMoreMenu();
  });
  $('previousClip').addEventListener('click', () => { pulsePlayerControl($('previousClip')); selectPlaybackRelative(1); });
  $('nextClip').addEventListener('click', () => { pulsePlayerControl($('nextClip')); selectPlaybackRelative(-1); });
  document.querySelectorAll('[data-seek]').forEach((button) => {
    button.addEventListener('click', () => { pulsePlayerControl(button); seekPlayback(Number(button.dataset.seek)); closeSeekOptionsMenu(); });
  });
  $('seekOptionsToggle')?.addEventListener('click', (event) => { event.stopPropagation(); toggleSeekOptionsMenu(); });
  $('seekOptionsMenu')?.addEventListener('click', (event) => event.stopPropagation());
  document.addEventListener('click', closeSeekOptionsMenu);
  $('playPausePlayback').addEventListener('click', () => { pulsePlayerControl($('playPausePlayback')); togglePlayback(); });
  $('waveformTimeline')?.addEventListener('pointermove', updateTimelineHoverPreview);
  $('waveformTimeline')?.addEventListener('pointerdown', seekWaveformFromPointer);
  $('waveformTimeline')?.addEventListener('pointerleave', hideTimelineHoverPreview);
  $('waveformTimeline')?.addEventListener('pointercancel', hideTimelineHoverPreview);
  if (MY_VOICE_HIGHLIGHTS_ENABLED) $('toggleVoiceHighlights')?.addEventListener('click', () => {
    if (!state.playbackVoiceHighlights.length) return;
    state.voiceHighlightsVisible = !state.voiceHighlightsVisible;
    localStorage.setItem('voiceHighlightsVisible', state.voiceHighlightsVisible ? '1' : '0');
    renderPlaybackVoiceHighlights();
    window.recorderAPI.logEvent?.('info', 'playback.voice_highlights_toggled', { visible: state.voiceHighlightsVisible });
  });
  $('toggleChapterSidebar')?.addEventListener('click', () => {
    if (!state.selectedPlaybackPath) return;
    state.chapterSidebarVisible = !state.chapterSidebarVisible;
    localStorage.setItem('chapterSidebarVisible', state.chapterSidebarVisible ? '1' : '0');
    renderPlaybackChapterSidebar();
    window.recorderAPI.logEvent?.('info', 'playback.timeline_toggled', { visible: state.chapterSidebarVisible });
  });
  $('hideChapterSidebar')?.addEventListener('click', () => {
    state.chapterSidebarVisible = false;
    localStorage.setItem('chapterSidebarVisible', '0');
    renderPlaybackChapterSidebar();
  });

  $('playbackSpeed').addEventListener('change', () => {
    state.playbackSpeedValue = Number($('playbackSpeed').value) || 1;
    $('playbackVideo').playbackRate = state.playbackSpeedValue;
    localStorage.setItem('playbackSpeed', String(state.playbackSpeedValue));
    window.recorderAPI.logEvent?.('info', 'playback.speed_changed', { speed: state.playbackSpeedValue });
  });
  $('playbackProgress').addEventListener('input', (event) => {
    const video = $('playbackVideo');
    if (!Number.isFinite(video.duration) || video.duration <= 0) return;
    const target = (Number(event.target.value) / 1000) * video.duration;
    state.pendingSeekTarget = target;
    video.currentTime = target;
    updatePlaybackClock();
  });
  $('playbackProgress').addEventListener('change', () => { state.pendingSeekTarget = null; });
  $('playbackVolume').addEventListener('input', (event) => {
    const video = $('playbackVideo');
    state.playbackVolume = clamp(Number(event.target.value), 0, 1);
    video.volume = state.playbackVolume;
    if (video.volume > 0) video.muted = false;
    if ($('stickyPlaybackVolume')) $('stickyPlaybackVolume').value = String(state.playbackVolume);
    localStorage.setItem('playbackVolume', String(state.playbackVolume));
    setPlayerIcon('playbackMute', video.muted || video.volume === 0 ? 'muted' : 'volume', video.muted || video.volume === 0 ? 'Unmute (M)' : 'Mute (M)');
  });
  $('playbackMute').addEventListener('click', () => { pulsePlayerControl($('playbackMute')); togglePlaybackMute(); });
  $('stickyPlaybackVolume')?.addEventListener('input', (event) => {
    state.playbackVolume = clamp(Number(event.target.value), 0, 1);
    const video = $('playbackVideo'); video.volume = state.playbackVolume; if (video.volume > 0) video.muted = false;
    $('playbackVolume').value = String(state.playbackVolume);
    localStorage.setItem('playbackVolume', String(state.playbackVolume));
  });
  $('stickyPlayPause')?.addEventListener('click', togglePlayback);
  $('stickySeekBack')?.addEventListener('click', () => seekPlayback(-10));
  $('stickySeekForward')?.addEventListener('click', () => seekPlayback(10));
  $('previousBookmark')?.addEventListener('click', () => { pulsePlayerControl($('previousBookmark')); seekToPlaybackBookmark(-1); });
  $('addBookmarkPlayer')?.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); pulsePlayerControl($('addBookmarkPlayer')); openBookmarkInlineEditor(); });
  $('deleteBookmarkPlayer')?.addEventListener('click', () => { pulsePlayerControl($('deleteBookmarkPlayer')); deletePlaybackBookmarkAtCurrentPosition(); });
  $('nextBookmark')?.addEventListener('click', () => { pulsePlayerControl($('nextBookmark')); seekToPlaybackBookmark(1); });
  $('stickyPreviousBookmark')?.addEventListener('click', () => seekToPlaybackBookmark(-1));
  $('stickyAddBookmark')?.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); openBookmarkInlineEditor(); });
  $('stickyDeleteBookmark')?.addEventListener('click', deletePlaybackBookmarkAtCurrentPosition);
  $('stickyNextBookmark')?.addEventListener('click', () => seekToPlaybackBookmark(1));
  $('playbackFullscreen').addEventListener('click', async () => {
    pulsePlayerControl($('playbackFullscreen'));
    try { const fsState = await window.recorderAPI.togglePlayerFullscreen(); setPlayerFullscreenUi(fsState); window.recorderAPI.logEvent?.('info', 'playback.fullscreen_toggled', { enabled: Boolean(fsState) }); }
    catch (error) { $('playerStatus').textContent = `Could not enter Full Screen. ${friendlyErrorText(error)}`; }
  });
  $('playbackVideo').addEventListener('click', () => {
    pulsePlayerControl($('playPausePlayback'));
    togglePlayback();
  });
  $('videoPlayerShell').addEventListener('dblclick', async (event) => {
    if (event.target.closest('.player-toolbar')) return;
    try { const fsState = await window.recorderAPI.togglePlayerFullscreen(); setPlayerFullscreenUi(fsState); window.recorderAPI.logEvent?.('info', 'playback.fullscreen_toggled', { enabled: Boolean(fsState) }); } catch {}
  });
  $('bookmarkInlineSave')?.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); saveBookmarkInlineEditor(); });
  $('bookmarkInlineInput')?.addEventListener('click', (event) => event.stopPropagation());
  $('bookmarkInlineInput')?.addEventListener('dblclick', (event) => event.stopPropagation());
  $('bookmarkInlineInput')?.addEventListener('input', () => {
    if (String($('bookmarkInlineInput')?.value || '').trim()) {
      clearTimeout(state.bookmarkEditorAutoSaveTimer);
      state.bookmarkEditorAutoSaveTimer = null;
    }
  });
  $('bookmarkInlineInput')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); saveBookmarkInlineEditor(); }
    else if (event.key === 'Escape') { event.preventDefault(); closeBookmarkInlineEditor(); }
  });
  $('bookmarkInlineEditor')?.addEventListener('click', (event) => event.stopPropagation());
  $('recordingBookmarkTextSave')?.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); saveRecordingBookmarkTextEditor(); });
  $('recordingBookmarkTextInput')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); saveRecordingBookmarkTextEditor(); }
    else if (event.key === 'Escape') { event.preventDefault(); closeRecordingBookmarkTextEditor({ showDefaultCompactFeedback: state.viewMode === 'compact' }); }
  });
  $('recordingBookmarkTextEditor')?.addEventListener('pointerdown', (event) => event.stopPropagation());
  document.addEventListener('pointerdown', (event) => {
    const editor = $('bookmarkInlineEditor');
    if (editor && !editor.classList.contains('hidden') && !editor.contains(event.target)) closeBookmarkInlineEditor();
    const recordingEditor = $('recordingBookmarkTextEditor');
    if (recordingEditor && !recordingEditor.classList.contains('hidden') && !recordingEditor.contains(event.target)) {
      closeRecordingBookmarkTextEditor({ showDefaultCompactFeedback: state.viewMode === 'compact' });
    }
  });
  $('playerSubtitleControl').addEventListener('click', () => {
    const control = $('playerSubtitleControl');
    if (!control || control.disabled || !state.subtitleCues.length) return;
    const next = !subtitleControlEnabled();
    setSubtitleControlEnabled(next);
    state.subtitlePreference = next;
    localStorage.setItem('playbackSubtitles', state.subtitlePreference ? '1' : '0');
    updateSubtitleOverlay();
    updatePlaybackSubtitleControlState();
    window.recorderAPI.logEvent?.('info', 'playback.captions_toggled', { enabled: next });
  });
  $('openPlaybackTranscript').addEventListener('click', () => {
    if (!state.selectedPlaybackPath) return;
    state.transcriptVisible = true;
    loadTranscriptIntoPanel(state.selectedPlaybackPath, state.playbackTranscript, false);
    $('transcriptPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.recorderAPI.logEvent?.('info', 'playback.transcript_opened', {});
  });
  $('copyPlaybackTranscript').addEventListener('click', async () => {
    if (state.playbackTranscript.text) { await window.recorderAPI.copyText(state.playbackTranscript.text); showToast('Transcript copied'); }
    closePlaybackMoreMenu();
  });
  $('snapshotPlayback').addEventListener('click', () => { pulsePlayerControl($('snapshotPlayback')); window.recorderAPI.logEvent?.('info', 'playback.snapshot', {}); takePlaybackSnapshot(); });
  $('playbackVideo').addEventListener('loadeddata', () => {
    const video = $('playbackVideo');
    const shell = $('videoPlayerShell');
    const selectedPath = state.selectedPlaybackPath;
    const selected = state.recordings.find((item) => item.path === selectedPath);
    const token = Number(video.dataset.selectionToken || 0);
    if (!selected || selected.mediaType === 'audio' || !token || token !== state.playbackSelectionToken) return;
    const width = Number(video.videoWidth) || 16;
    const height = Number(video.videoHeight) || 9;
    shell?.style.setProperty('--playback-aspect', `${width} / ${height}`);
    // Resize the reserved video viewport and reveal the first real video frame in
    // the same paint. The user never sees the audio/compact intermediate state.
    requestAnimationFrame(() => {
      if (token !== state.playbackSelectionToken || state.selectedPlaybackPath !== selectedPath) return;
      shell?.classList.remove('media-loading');
      $('playbackMediaLoading')?.classList.add('hidden');
      video.setAttribute('aria-busy', 'false');
    });
    if (selectedPath && video.dataset.enhancementsToken !== String(token)) {
      video.dataset.enhancementsToken = String(token);
      loadPlaybackEnhancements(selectedPath, token).catch(() => {});
    }
  });
  $('playbackVideo').addEventListener('loadedmetadata', () => {
    const video = $('playbackVideo');
    const token = Number(video.dataset.selectionToken || 0);
    if (token && token !== state.playbackSelectionToken) return;
    state.trimStart = 0;
    state.trimEnd = Number.isFinite(video.duration) ? video.duration : null;
    updateTrimUi();
    updatePlaybackClock();
    if (state.selectedPlaybackPath && Number.isFinite(video.duration)) {
      const selected = state.recordings.find((item) => item.path === state.selectedPlaybackPath);
      if (selected) selected.durationSeconds = video.duration;
      if ($('audioOnlyPlayerMeta') && $('videoPlayerShell')?.classList.contains('audio-only-player')) $('audioOnlyPlayerMeta').textContent = `00:00 / ${formatDuration(video.duration, '00:00')} · Audio-only recording`;
      renderRecordings();
      updatePlaybackClipNavigation();
      renderPlaybackMarkers();
      renderAllWaveforms();
      renderEditCuts();
      if (!state.subtitleCues.length && state.playbackTranscript?.text) {
        attachApproximateSubtitleTrack(state.playbackTranscript.text, video.duration, state.subtitlePreference);
      }
    }
  });
  $('playbackVideo').addEventListener('durationchange', updatePlaybackClock);
  $('playbackVideo').addEventListener('timeupdate', updatePlaybackClock);
  $('playbackVideo').addEventListener('seeked', () => { state.pendingSeekTarget = null; $('playerStatus').textContent = ''; });
  $('playbackVideo').addEventListener('waiting', () => { $('playerStatus').textContent = 'Buffering…'; });
  $('playbackVideo').addEventListener('playing', () => { $('playerStatus').textContent = ''; });
  $('playbackVideo').addEventListener('play', () => { setPlayerIcon('playPausePlayback', 'pause', 'Pause (Space)'); updatePlaybackClock(); });
  $('playbackVideo').addEventListener('pause', () => { setPlayerIcon('playPausePlayback', 'play', 'Play (Space)'); updatePlaybackClock(); });
  $('playbackVideo').addEventListener('ended', () => { setPlayerIcon('playPausePlayback', 'play', 'Play (Space)'); updatePlaybackClock(); });
  setPlayerIcon('playPausePlayback', 'play', 'Play (Space)');
  setPlayerIcon('playbackMute', 'volume', 'Mute (M)');
  $('playbackVideo').addEventListener('error', async () => {
    const video = $('playbackVideo');
    const token = Number(video.dataset.selectionToken || 0);
    if (token && token !== state.playbackSelectionToken) return;
    const error = video.error;
    const selectedPath = state.selectedPlaybackPath;
    const selected = state.recordings.find((item) => item.path === selectedPath);

    // v0.2.89 can self-heal the malformed fragmented MP4 files produced by the
    // v0.2.88 raw-passthrough finalizer. Attempt a safe remux/transcode once per
    // selected file; the original is replaced only after a repaired copy decodes.
    if (selectedPath && selected?.mediaType !== 'audio' && !state.playbackRepairAttempts.has(selectedPath)) {
      state.playbackRepairAttempts.add(selectedPath);
      $('videoPlayerShell')?.classList.add('media-loading');
      $('playbackMediaLoading')?.classList.remove('hidden');
      if ($('playbackMediaLoadingText')) $('playbackMediaLoadingText').textContent = 'Repairing video for playback…';
      $('trimStatus').textContent = 'The video container did not open normally. Trying a safe local repair…';
      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
        await window.recorderAPI.repairRecordingMedia(selectedPath);
        if (token && token !== state.playbackSelectionToken) return;
        await refreshRecordings();
        const repaired = state.recordings.find((item) => item.path === selectedPath);
        if (!repaired) throw new Error('The repaired recording could not be found in the library.');
        showToast('Video container repaired');
        await selectPlaybackRecording(repaired);
        return;
      } catch (repairError) {
        console.warn('Automatic playback repair failed.', repairError);
        $('trimStatus').textContent = `Playback could not load this recording. ${friendlyErrorText(repairError || error)} The original file was left unchanged.`;
      }
    } else {
      $('trimStatus').textContent = `Playback could not load this recording. ${error?.message ? friendlyErrorText(error) + ' ' : ''}Try Refresh, then select it again.`;
    }
    $('videoPlayerShell')?.classList.remove('media-loading');
    $('playbackMediaLoading')?.classList.add('hidden');
    video.setAttribute('aria-busy', 'false');
  });
  $('setTrimStart').addEventListener('click', () => setTrimBoundary('start', $('playbackVideo').currentTime || 0, true, true));
  $('setTrimEnd').addEventListener('click', () => setTrimBoundary('end', $('playbackVideo').currentTime || 0, true, true));
  $('trimZoom').addEventListener('input', (event) => applyTrimZoom(event.target.value, true));
  $('trimSnapSilence').addEventListener('change', (event) => {
    state.trimSnapSilence = Boolean(event.target.checked);
    localStorage.setItem('trimSnapSilence', state.trimSnapSilence ? '1' : '0');
    $('trimStatus').textContent = state.trimSnapSilence ? 'Trim handles will snap to nearby quiet points when released.' : 'Silence snapping is off.';
  });
  for (const [id, which] of [['trimStartHandle', 'start'], ['trimEndHandle', 'end']]) {
    const handle = $(id);
    handle.addEventListener('pointerdown', (event) => beginTrimDrag(which, event));
    handle.addEventListener('pointermove', moveTrimDrag);
    handle.addEventListener('pointerup', endTrimDrag);
    handle.addEventListener('pointercancel', endTrimDrag);
  }
  $('trimRangeShell').addEventListener('pointerdown', (event) => {
    if (event.target.closest('.trim-handle')) return;
    const seconds = trimSecondsFromClientX(event.clientX);
    if (seconds == null) return;
    const distanceStart = Math.abs(seconds - state.trimStart);
    const distanceEnd = Math.abs(seconds - (state.trimEnd ?? $('playbackVideo').duration));
    setTrimBoundary(distanceStart <= distanceEnd ? 'start' : 'end', seconds);
  });
  $('saveTrimmedCopy').addEventListener('click', saveTrimmedCopy);
  $('addCutSegment').addEventListener('click', addCurrentRangeToCuts);
  $('clearCutSegments').addEventListener('click', () => { state.editCuts = []; renderEditCuts(); $('trimStatus').textContent = 'Cut list cleared.'; });
  $('saveMultiCutCopy').addEventListener('click', saveMultiCutCopy);
  $('exportPlaybackAudio').addEventListener('click', exportPlaybackAudio);

  $('insightsPanelToggle')?.addEventListener('click', () => { state.insightsPanelCollapsed = !state.insightsPanelCollapsed; applyKnowledgeCollapse('insightsPanelToggle', 'insightsContent', state.insightsPanelCollapsed, 'insightsPanelCollapsed', true); });
  $('chaptersToggle')?.addEventListener('click', () => { state.chaptersCollapsed = !state.chaptersCollapsed; applyKnowledgeCollapse('chaptersToggle', 'chaptersContent', state.chaptersCollapsed, 'chaptersCollapsed', true); });
  $('meetingSummaryToggle')?.addEventListener('click', () => { state.meetingSummaryCollapsed = !state.meetingSummaryCollapsed; applyKnowledgeCollapse('meetingSummaryToggle', 'meetingSummaryContent', state.meetingSummaryCollapsed, 'meetingSummaryCollapsed', true); });
  $('actionItemsToggle')?.addEventListener('click', () => { state.actionItemsCollapsed = !state.actionItemsCollapsed; applyKnowledgeCollapse('actionItemsToggle', 'actionItemsContent', state.actionItemsCollapsed, 'actionItemsCollapsed', true); });

  $('regenerateInsights').addEventListener('click', () => {
    if (state.selectedPlaybackPath) loadPlaybackInsights(state.selectedPlaybackPath, state.playbackSelectionToken, true);
  });
  $('copyAllInsights').addEventListener('click', async () => {
    const text = insightCopyText('all');
    if (text) { await window.recorderAPI.copyText(text); $('insightsStatus').textContent = 'Meeting notes copied to clipboard.'; showToast('Meeting notes copied'); }
  });
  $('copySummary').addEventListener('click', async () => {
    const text = insightCopyText('summary');
    if (text) { await window.recorderAPI.copyText(text); $('insightsStatus').textContent = 'Meeting summary copied to clipboard.'; showToast('Meeting summary copied'); }
  });
  $('copyActionItems').addEventListener('click', async () => {
    const text = insightCopyText('actions');
    if (text) { await window.recorderAPI.copyText(text); $('insightsStatus').textContent = 'Action items copied to clipboard.'; showToast('Action items copied'); }
  });

  document.querySelectorAll('[data-transcript-view]').forEach((button) => button.addEventListener('click', () => setTranscriptView(button.dataset.transcriptView, true)));
  applyTranscriptViewUi();

  $('transcriptSearch').addEventListener('input', () => renderTranscriptSearchResults(true));
  $('transcriptSearch').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    moveTranscriptSearchMatch(event.shiftKey ? -1 : 1);
  });
  $('clearTranscriptSearch').addEventListener('click', () => { $('transcriptSearch').value = ''; renderTranscriptSearchResults(true); $('transcriptSearch').focus(); });
  $('transcriptSearchPrev').addEventListener('click', () => moveTranscriptSearchMatch(-1));
  $('transcriptSearchNext').addEventListener('click', () => moveTranscriptSearchMatch(1));

  $('toggleTranscript').addEventListener('click', () => {
    state.transcriptVisible = !state.transcriptVisible;
    updateTranscriptActions();
  });
  $('copyTranscript').addEventListener('click', async () => {
    const text = $('transcriptText').value.trim();
    if (!text) return;
    await window.recorderAPI.copyText(text);
    $('transcriptStatus').textContent = 'Transcript copied to clipboard.';
    showToast('Transcript copied');
  });
  $('showTranscriptFiles').addEventListener('click', () => {
    const target = state.transcriptTxtPath || state.transcriptSrtPath || state.transcriptTargetPath;
    if (target) window.recorderAPI.showInFolder(target);
  });
  $('exportTxt').addEventListener('click', async () => {
    const content = $('transcriptText').value;
    if (!content.trim()) return;
    const result = await window.recorderAPI.exportTranscript({ format: 'txt', content, recordingPath: state.transcriptTargetPath });
    if (!result.canceled) { $('transcriptStatus').textContent = 'TXT transcript exported.'; showToast('TXT transcript exported'); }
  });
  $('exportSrt').addEventListener('click', async () => {
    const content = state.localSrt || plainTextToSrt($('transcriptText').value);
    if (!content.trim()) return;
    const result = await window.recorderAPI.exportTranscript({ format: 'srt', content, recordingPath: state.transcriptTargetPath });
    if (!result.canceled) { $('transcriptStatus').textContent = 'SRT subtitle file exported.'; showToast('SRT subtitles exported'); }
  });

  state.unsubscribeShortcuts = window.recorderAPI.onShortcutAction(async (action) => {
    window.recorderAPI.logEvent?.('info', 'ui.shortcut-used', { shortcut: String(action || ''), context: state.currentWorkspace || 'capture' });
    if (action === 'record-toggle') {
      if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') await stopRecording();
      else await startRecording();
    } else if (action === 'pause-toggle') {
      if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') togglePause();
    } else if (action === 'bookmark') {
      if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') await addRecordingBookmark();
      else if (state.selectedPlaybackPath) openBookmarkInlineEditor();
    } else if (action === 'snapshot') {
      if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') await takeLiveSnapshot();
      else if (state.selectedPlaybackPath) await takePlaybackSnapshot();
    } else if (action === 'compact-toggle') {
      await applyViewMode(state.viewMode === 'compact' ? 'full' : 'compact');
    }
  });
  state.unsubscribeFullscreen = window.recorderAPI.onFullscreenChanged(setPlayerFullscreenUi);
  document.addEventListener('keydown', async (event) => {
    const targetTag = event.target?.tagName?.toLowerCase();
    const typing = ['input', 'textarea', 'select'].includes(targetTag) || event.target?.isContentEditable;
    if (!typing && (event.key === 'F1' || (event.key === '?' && !event.metaKey && !event.ctrlKey && !event.altKey))) {
      event.preventDefault();
      if (!$('shortcutsDialog').open) $('shortcutsDialog').showModal();
      return;
    }
    if (event.key === 'Escape' && state.playerFullscreen) {
      event.preventDefault();
      try { setPlayerFullscreenUi(await window.recorderAPI.exitPlayerFullscreen()); } catch {}
      return;
    }
    if (state.currentWorkspace !== 'playback' || !state.selectedPlaybackPath) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      state.transcriptVisible = true; updateTranscriptActions();
      $('transcriptSearch')?.focus(); $('transcriptSearch')?.select?.();
      return;
    }
    const tag = event.target?.tagName?.toLowerCase();
    if (['input', 'textarea', 'select', 'button'].includes(tag)) return;
    if (event.code === 'Space') { event.preventDefault(); window.recorderAPI.logEvent?.('info', 'ui.shortcut-used', { shortcut: 'space', context: 'playback' }); togglePlayback(); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); window.recorderAPI.logEvent?.('info', 'ui.shortcut-used', { shortcut: event.shiftKey ? 'shift-left' : 'left', context: 'playback' }); seekPlayback(event.shiftKey ? -5 : -1); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); window.recorderAPI.logEvent?.('info', 'ui.shortcut-used', { shortcut: event.shiftKey ? 'shift-right' : 'right', context: 'playback' }); seekPlayback(event.shiftKey ? 5 : 1); }
    else if (event.key.toLowerCase() === 'j') { event.preventDefault(); window.recorderAPI.logEvent?.('info', 'ui.shortcut-used', { shortcut: 'j', context: 'playback' }); seekPlayback(-5); }
    else if (event.key.toLowerCase() === 'l') { event.preventDefault(); window.recorderAPI.logEvent?.('info', 'ui.shortcut-used', { shortcut: 'l', context: 'playback' }); seekPlayback(5); }
    else if (event.key.toLowerCase() === 'b') { event.preventDefault(); window.recorderAPI.logEvent?.('info', 'ui.shortcut-used', { shortcut: 'b', context: 'playback' }); openBookmarkInlineEditor(); }
    else if (event.key.toLowerCase() === 'm') { event.preventDefault(); window.recorderAPI.logEvent?.('info', 'ui.shortcut-used', { shortcut: 'm', context: 'playback' }); togglePlaybackMute(); }
  });

  // View mode was already restored before the first visible frame.
}

window.addEventListener('beforeunload', () => {
  stopPreflightMicMonitor(false);
  cleanupStreams();
  clearSubtitleTrack();
  state.unsubscribeKeystroke?.();
  state.unsubscribeShortcuts?.();
  state.unsubscribeFullscreen?.();
  state.unsubscribeAiStatus?.();
  state.unsubscribeStartupRecovery?.();
  state.unsubscribeRecoveryNotice?.();
  state.unsubscribeCloseBlocked?.();
  state.playbackToolbarObserver?.disconnect?.();
  fastTooltipState.mutationObserver?.disconnect?.();
  clearTimeout(fastTooltipState.showTimer);
  clearInterval(state.readinessTimer);
});

init().catch((error) => setStatus(`PulseStudio could not finish starting. ${friendlyErrorText(error)}`, true));
