const { app, BrowserWindow, Menu, desktopCapturer, ipcMain, session, systemPreferences, shell, clipboard, protocol, net, dialog, screen, powerMonitor, globalShortcut, utilityProcess, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');
const { AsyncLocalStorage } = require('async_hooks');
const { Readable } = require('stream');
const ffmpegPath = require('ffmpeg-static');
const { generateInsights, parseSrtCues, transcriptFingerprint } = require('./insights');
const { windowsApplicationAudioCapability, startWindowsProcessLoopback } = require('./native/windows/WindowsProcessLoopback');
const { atomicWriteJson, RecoveryJournalManager, createPendingRecovery, listPendingRecoveries } = require('./lib/recovery-manager');
const { VideoEncoderManager } = require('./lib/video-encoder');
const { AiWorkerManager } = require('./lib/ai-worker-manager');
const { moveRecordingFamilyToTrash } = require('./lib/trash-manager');
const { applySpeakerCorrections, mergeSpeakerCorrections, normalizeSpeakerKey } = require('./lib/speaker-corrections');
const { basicTranscriptLooksSparse, transcriptWordCount } = require('./lib/transcription-quality');
const { LocalModelManager } = require('./lib/model-manager');
const { RecoveryAwareUpdateManager } = require('./lib/update-manager');
const { ActivityLogger } = require('./lib/activity-logger');
const { refineVoiceHighlightsAgainstReference } = require('./lib/voice-highlights');

const APP_DISPLAY_NAME = 'PulseStudio';
const APP_USER_MODEL_ID = 'com.girishxp.pulsestudio';
const APP_ICON_PATH = path.join(__dirname, 'assets', 'pulsestudio-icon.png');
const APP_USER_DATA_PATH = path.join(app.getPath('appData'), APP_DISPLAY_NAME);
try { app.setPath('userData', APP_USER_DATA_PATH); } catch {}
const activityLogger = new ActivityLogger({
  directory: path.resolve(__dirname, 'logs'),
  fallbackDirectory: path.join(app.getPath('userData'), 'logs'),
  maxBytes: 5 * 1024 * 1024,
  backups: 4
});
function activityLog(level, event, details = {}) {
  return activityLogger.write(level, event, details);
}
activityLog('info', 'app.process-start', {
  appVersion: (() => { try { return app.getVersion(); } catch { return 'unknown'; } })(),
  electron: process.versions.electron,
  chromium: process.versions.chrome,
  node: process.versions.node,
  platform: process.platform,
  arch: process.arch,
  osRelease: os.release(),
  argv: process.argv.slice(1).map((value) => path.basename(String(value || '')))
});
process.on('uncaughtExceptionMonitor', (error, origin) => activityLog('error', 'app.uncaught-exception', { error, origin: String(origin || '') }));
process.on('unhandledRejection', (reason) => activityLog('error', 'app.unhandled-rejection', { error: reason instanceof Error ? reason : String(reason) }));


// v0.2.74 local macOS runtime: the cross-platform ZIP now launches through
// Electron's original Developer-ID-signed host instead of rebuilding an ad-hoc
// app bundle for every PulseStudio version. On macOS 14.2+, force the older
// Screen & System Audio Recording path in that source-host mode so system audio
// does not depend on a usage-description string embedded in Electron.app.
if (process.platform === 'darwin' && !app.isPackaged) {
  try { app.commandLine.appendSwitch('disable-features', 'MacCatapLoopbackAudioForScreenShare'); } catch {}
}

// Application identity: keep the visible UI branded as PulseStudio. Packaged
// builds use the native PulseStudio identity; the local macOS ZIP runs inside
// Electron's stable signed host but still applies the PulseStudio name/icon.
try { app.setName(APP_DISPLAY_NAME); } catch {}
try { process.title = APP_DISPLAY_NAME; } catch {}

function applyApplicationIdentity() {
  try { app.setName(APP_DISPLAY_NAME); } catch {}
  try { process.title = APP_DISPLAY_NAME; } catch {}
  if (process.platform === 'win32') {
    try { app.setAppUserModelId(APP_USER_MODEL_ID); } catch {}
  }
  if (process.platform === 'darwin' && app.dock && fs.existsSync(APP_ICON_PATH)) {
    try {
      const icon = nativeImage.createFromPath(APP_ICON_PATH);
      if (!icon.isEmpty()) app.dock.setIcon(icon);
    } catch {}
  }
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'recording',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true
    }
  },
  {
    scheme: 'appasset',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
]);

// v0.2.59: keep one recorder process per user profile. Relaunching the .command
// file now activates the existing process instead of leaving another Electron
// instance in the Dock with no visible recorder window.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

function installApplicationMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: 'PulseStudio',
      submenu: [
        { role: 'about', label: 'About PulseStudio' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: 'Hide PulseStudio' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: 'Quit PulseStudio' }
      ]
    }] : []),
    { label: 'File', submenu: [isMac ? { role: 'close' } : { role: 'quit', label: 'Exit PulseStudio' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [...(!app.isPackaged && !(process.platform === 'darwin' && process.defaultApp) ? [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }] : []), { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(isMac ? [{ type: 'separator' }, { role: 'front' }] : [{ role: 'close' }])] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

let mainWindow;
let selectedSourceId = null;
let activeWriteStream = null;
let activeTempPath = null;
let activeMimeType = null;
let activeMicWriteStream = null;
let activeMicTempPath = null;
let activeMicMimeType = null;
let activeMicNoiseMode = 'off';
let activeMicBytesWritten = 0;
let activeNeuralMicWriteStream = null;
let activeNeuralMicTempPath = null;
let activeNeuralMicMimeType = null;
let activeNeuralMicMethod = 'none';
let activeNeuralMicBytesWritten = 0;
let activeRecordingKind = 'video';
let activeFilenameTemplate = 'Screen Recording {date} {time}';
let activeRecordingMeta = {};
let activeBytesWritten = 0;
let activeRecordingHealth = {
  startedAt: 0,
  lastChunkAt: 0,
  lastMicChunkAt: 0,
  lastNeuralMicChunkAt: 0,
  lastWriteError: '',
  lastMicWriteError: '',
  lastNeuralMicWriteError: ''
};
let lastRecordingDiagnosticMeta = {};
const sealedRecordingSessions = new Map();
const reservedRecordingOutputPaths = new Set();
let lastRecordingPath = null;
let applicationAudioProcess = null;
let applicationAudioTempPath = null;
let applicationAudioWindowTitle = '';
let applicationAudioSourceId = '';
let applicationAudioSegments = [];
let pendingRecoveryNotice = null;
let startupRecoveryInProgress = false;
let startupRecoveryStarted = false;
let recoveryCancelRequested = false;
let recoveryCancelReason = '';
const activeRecoveryChildren = new Set();
const recoveryProcessContext = new AsyncLocalStorage();
// Per-recording background processing context. It lets Trash cancel FFmpeg extraction,
// transcription, speaker detection and optional AI work for exactly one clip without
// disturbing processing for the next item in the queue.
const recordingProcessingContext = new AsyncLocalStorage();
const activeRecordingProcessingChildren = new Map();
const cancelledRecordingProcessing = new Set();
let appIsQuitting = false;
let keyHook = null;
let keyHookKeyMap = null;
let keyHookListener = null;
let keyHookActive = false;
let fullWindowBounds = null;
let compactWindowBounds = null;
let activeWindowMode = 'full';
let switchingWindowMode = false;
let activeManualWindowDrag = null;
let compactBoundsSaveTimer = null;
let compactPositionRepairTimer = null;
let windowViewStateSaveTimer = null;
// v0.2.89: Full View can be a very large translucent/vibrant surface. While a
// capture is active, temporarily use an opaque/non-vibrant native window so macOS
// and Windows do not spend extra compositor time blending the recorder over the
// same display being captured. The user's transparency preference is restored as
// soon as recording stops or the app switches to Mini View.
let recordingPerformanceWindowState = null;
let recordingPerformanceModeActive = false;
let recordingCaptureActive = false;
let recordingPerformanceLogTimer = null;
let lastRecordingChunkLogAt = 0;
let rendererUiReady = false;
let nativeWindowReadyToShow = false;
let startupWindowShowFailsafeTimer = null;
let recordingsDirectoryOverride = null;
let recordingsDirectoryPreferenceLoaded = false;
// Safe defaults for the optional window-capture privacy preference. These must
// exist before createWindow() reads the preference; otherwise startup can abort
// before the BrowserWindow is created.
let windowCapturePrivacyEnabled = true;
let windowCapturePrivacyPreferenceLoaded = false;
// macOS can report a stale Screen Recording status for the lifetime of the
// current process after the user changes the toggle in System Settings. Once
// desktopCapturer successfully enumerates a real screen source, remember that
// the current process has effective access and use that verified result for
// readiness/diagnostics instead of continuing to display a stale denial.
let screenCaptureVerified = false;
let updateManager = null;
const durationProbeCache = new Map();
const waveformCache = new Map();

// v0.2.64: Mini Controller is a strictly fixed 262 x 84 HUD.
// Its outer BrowserWindow must never grow/shrink from saved bounds, content fitting,
// recording-state changes, native resize gestures, or stale preferences.
const COMPACT_WINDOW_WIDTH = 262;
const COMPACT_WINDOW_HEIGHT = 84;
const FULL_WINDOW_MAX_SIZE = 16384;

function compactWindowStatePath() {
  return path.join(app.getPath('userData'), 'compact-window-state.json');
}

function readSavedCompactWindowBounds() {
  try {
    const parsed = JSON.parse(fs.readFileSync(compactWindowStatePath(), 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    const keys = ['x', 'y', 'width', 'height'];
    if (!keys.every((key) => Number.isFinite(Number(parsed[key])))) return null;
    return Object.fromEntries(keys.map((key) => [key, Math.round(Number(parsed[key]))]));
  } catch {
    return null;
  }
}

function persistCompactWindowBounds(bounds = compactWindowBounds) {
  if (!bounds) return;
  try {
    const target = compactWindowStatePath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temp = `${target}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({
      x: Math.round(bounds.x), y: Math.round(bounds.y),
      width: COMPACT_WINDOW_WIDTH, height: COMPACT_WINDOW_HEIGHT
    }), 'utf8');
    try { fs.rmSync(target, { force: true }); } catch {}
    fs.renameSync(temp, target);
  } catch {}
}

function scheduleCompactWindowBoundsSave(bounds = compactWindowBounds) {
  if (!bounds) return;
  clearTimeout(compactBoundsSaveTimer);
  compactBoundsSaveTimer = setTimeout(() => persistCompactWindowBounds(bounds), 350);
}

// v0.2.82: persist the last actual Full/Mini state in the main process as well
// as renderer localStorage. The main process owns BrowserWindow creation, so it
// needs this state before the renderer exists in order to restore the correct
// size/position without briefly showing Full View first.
function windowViewStatePath() {
  return path.join(app.getPath('userData'), 'window-view-state.json');
}

function readSavedWindowViewState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(windowViewStatePath(), 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    const mode = parsed.mode === 'compact' ? 'compact' : parsed.mode === 'full' ? 'full' : null;
    let savedFullBounds = null;
    if (parsed.fullBounds && typeof parsed.fullBounds === 'object') {
      const keys = ['x', 'y', 'width', 'height'];
      if (keys.every((key) => Number.isFinite(Number(parsed.fullBounds[key])))) {
        savedFullBounds = Object.fromEntries(keys.map((key) => [key, Math.round(Number(parsed.fullBounds[key]))]));
      }
    }
    return mode ? { mode, fullBounds: savedFullBounds } : null;
  } catch {
    return null;
  }
}

function persistWindowViewState() {
  try {
    const target = windowViewStatePath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temp = `${target}.tmp`;
    const payload = {
      mode: activeWindowMode === 'compact' ? 'compact' : 'full',
      fullBounds: fullWindowBounds ? {
        x: Math.round(fullWindowBounds.x), y: Math.round(fullWindowBounds.y),
        width: Math.round(fullWindowBounds.width), height: Math.round(fullWindowBounds.height)
      } : null
    };
    fs.writeFileSync(temp, JSON.stringify(payload, null, 2), 'utf8');
    try { fs.rmSync(target, { force: true }); } catch {}
    fs.renameSync(temp, target);
    return true;
  } catch {
    return false;
  }
}

function scheduleWindowViewStateSave(delay = 250) {
  clearTimeout(windowViewStateSaveTimer);
  windowViewStateSaveTimer = setTimeout(() => {
    windowViewStateSaveTimer = null;
    persistWindowViewState();
  }, Math.max(0, Number(delay) || 0));
}

function normalizeFullWindowBounds(bounds) {
  if (!bounds) return null;
  try {
    const display = screen.getDisplayNearestPoint({
      x: Math.round(Number(bounds.x) + Math.max(1, Number(bounds.width) / 2)),
      y: Math.round(Number(bounds.y) + Math.max(1, Number(bounds.height) / 2))
    });
    const area = display?.workArea || display?.bounds;
    if (!area) return { ...bounds };
    const margin = 8;
    const maxWidth = Math.max(720, area.width - margin * 2);
    const maxHeight = Math.max(560, area.height - margin * 2);
    const width = Math.min(maxWidth, Math.max(720, Math.round(Number(bounds.width) || 1320)));
    const height = Math.min(maxHeight, Math.max(560, Math.round(Number(bounds.height) || 900)));
    const maxX = area.x + area.width - width - margin;
    const maxY = area.y + area.height - height - margin;
    return {
      x: Math.round(Math.max(area.x + margin, Math.min(maxX, Number(bounds.x) || area.x + margin))),
      y: Math.round(Math.max(area.y + margin, Math.min(maxY, Number(bounds.y) || area.y + margin))),
      width, height
    };
  } catch {
    return { ...bounds };
  }
}

function maybeShowStartupWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (!rendererUiReady || !nativeWindowReadyToShow) return false;
  clearTimeout(startupWindowShowFailsafeTimer);
  startupWindowShowFailsafeTimer = null;
  ensureMainWindowVisible();
  return true;
}

function compactDisplayForBounds(bounds) {
  try {
    return screen.getDisplayNearestPoint({
      x: Math.round((bounds?.x || 0) + Math.max(1, (bounds?.width || COMPACT_WINDOW_WIDTH) / 2)),
      y: Math.round((bounds?.y || 0) + Math.max(1, (bounds?.height || COMPACT_WINDOW_HEIGHT) / 2))
    });
  } catch {
    return screen.getPrimaryDisplay();
  }
}

function normalizeCompactBounds(bounds, fallback = null) {
  const base = bounds || fallback || { x: 40, y: 40, width: COMPACT_WINDOW_WIDTH, height: COMPACT_WINDOW_HEIGHT };
  // Size is intentionally fixed so any stale/saved Mini dimensions are migrated.
  const width = COMPACT_WINDOW_WIDTH;
  const height = COMPACT_WINDOW_HEIGHT;
  const display = compactDisplayForBounds({ ...base, width, height });
  const area = display?.workArea || { x: 0, y: 0, width: 1440, height: 900 };
  const margin = 8;
  const maxX = area.x + area.width - width - margin;
  const maxY = area.y + area.height - height - margin;
  return {
    x: Math.round(Math.max(area.x + margin, Math.min(maxX, Number(base.x) || area.x + margin))),
    y: Math.round(Math.max(area.y + margin, Math.min(maxY, Number(base.y) || area.y + margin))),
    width,
    height
  };
}

function snapCompactPosition(x, y, width, height, cursor) {
  const display = screen.getDisplayNearestPoint(cursor || { x, y });
  const area = display.workArea;
  const margin = 8;
  const threshold = 18;
  const left = area.x + margin;
  const top = area.y + margin;
  const right = area.x + area.width - width - margin;
  const bottom = area.y + area.height - height - margin;
  let nextX = Math.max(left, Math.min(right, Math.round(x)));
  let nextY = Math.max(top, Math.min(bottom, Math.round(y)));
  if (Math.abs(nextX - left) <= threshold) nextX = left;
  if (Math.abs(nextX - right) <= threshold) nextX = right;
  if (Math.abs(nextY - top) <= threshold) nextY = top;
  if (Math.abs(nextY - bottom) <= threshold) nextY = bottom;
  return { x: nextX, y: nextY };
}

function compactBoundsForRecordingState(bounds, active) {
  const current = normalizeCompactBounds(bounds);
  const targetWidth = COMPACT_WINDOW_WIDTH;
  const targetHeight = COMPACT_WINDOW_HEIGHT;
  const display = compactDisplayForBounds(current);
  const area = display.workArea;
  const margin = 8;
  const nearRight = Math.abs((current.x + current.width) - (area.x + area.width - margin)) <= 26;
  const nearBottom = Math.abs((current.y + current.height) - (area.y + area.height - margin)) <= 26;
  const candidate = {
    x: nearRight ? area.x + area.width - targetWidth - margin : current.x,
    y: nearBottom ? area.y + area.height - targetHeight - margin : current.y,
    width: targetWidth,
    height: targetHeight
  };
  return normalizeCompactBounds(candidate, current);
}

// v0.2.67: User-controlled screen-sharing privacy. This keeps the existing
// protected default from v0.2.65 but lets the user turn protection off whenever
// they intentionally want PulseStudio itself to appear in a screenshot or
// screen share. Electron maps this to NSWindowSharingNone on macOS and
// WDA_EXCLUDEFROMCAPTURE on supported Windows versions.
function windowCapturePrivacySettingsPath() {
  return path.join(app.getPath('userData'), 'window-capture-privacy.json');
}

function loadWindowCapturePrivacyPreference() {
  if (windowCapturePrivacyPreferenceLoaded) return windowCapturePrivacyEnabled;
  windowCapturePrivacyPreferenceLoaded = true;
  windowCapturePrivacyEnabled = true;
  try {
    const parsed = JSON.parse(fs.readFileSync(windowCapturePrivacySettingsPath(), 'utf8'));
    if (parsed && typeof parsed.enabled === 'boolean') windowCapturePrivacyEnabled = parsed.enabled;
  } catch {}
  return windowCapturePrivacyEnabled;
}

function persistWindowCapturePrivacyPreference() {
  try {
    const target = windowCapturePrivacySettingsPath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temp = `${target}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ enabled: Boolean(windowCapturePrivacyEnabled) }, null, 2), 'utf8');
    try { fs.rmSync(target, { force: true }); } catch {}
    fs.renameSync(temp, target);
    return true;
  } catch {
    return false;
  }
}

function windowCapturePrivacySnapshot(window = mainWindow) {
  loadWindowCapturePrivacyPreference();
  const supported = process.platform === 'darwin' || process.platform === 'win32';
  let effective = false;
  if (supported && window && !window.isDestroyed()) {
    try {
      effective = typeof window.isContentProtected === 'function'
        ? Boolean(window.isContentProtected())
        : Boolean(windowCapturePrivacyEnabled);
    } catch {
      effective = Boolean(windowCapturePrivacyEnabled);
    }
  }
  return { enabled: Boolean(windowCapturePrivacyEnabled), supported, effective };
}

function applyWindowCaptureProtection(window = mainWindow) {
  loadWindowCapturePrivacyPreference();
  if (!window || window.isDestroyed()) return false;
  if (process.platform !== 'darwin' && process.platform !== 'win32') return false;
  try {
    window.setContentProtection(Boolean(windowCapturePrivacyEnabled));
    return typeof window.isContentProtected !== 'function'
      ? Boolean(windowCapturePrivacyEnabled)
      : Boolean(window.isContentProtected()) === Boolean(windowCapturePrivacyEnabled);
  } catch (error) {
    console.warn('Unable to update PulseStudio window capture privacy:', error?.message || error);
    return false;
  }
}

function applyNativeWindowControlsForMode(mode) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const compact = mode === 'compact';

  // v0.2.58: macOS Mini uses compact custom Close/Minimize controls and hides
  // the native traffic lights. This removes the green zoom/full-screen button
  // that can overlap the transparency control in the 262 px Mini title area.
  if (process.platform === 'darwin') {
    try { mainWindow.setWindowButtonVisibility(!compact); } catch {}
  }

  // Mini is a fixed recording HUD; maximizing/full-screening it is not useful.
  try { mainWindow.setFullScreenable(!compact); } catch {}
  try { mainWindow.setMaximizable(!compact); } catch {}
  applyWindowCaptureProtection(mainWindow);
}

function lockCompactWindowSize() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try { mainWindow.setMinimumSize(COMPACT_WINDOW_WIDTH, COMPACT_WINDOW_HEIGHT); } catch {}
  try { mainWindow.setMaximumSize(COMPACT_WINDOW_WIDTH, COMPACT_WINDOW_HEIGHT); } catch {}
  try { mainWindow.setResizable(false); } catch {}
}

function unlockFullWindowSize() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // Remove Mini's hard maximum before restoring Full View's normal minimum.
  try { mainWindow.setMaximumSize(FULL_WINDOW_MAX_SIZE, FULL_WINDOW_MAX_SIZE); } catch {}
  try { mainWindow.setMinimumSize(1020, 720); } catch {}
  try { mainWindow.setResizable(true); } catch {}
}

function compactBoundsMatch(a, b) {
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

// v0.2.81: macOS may move a small floating/transparent BrowserWindow after a
// display sleep/wake, Spaces transition, or temporary work-area change. Mini
// already has an explicit drag path, so compactWindowBounds is the user's last
// intentional position. Do not let an unsolicited native move silently become
// the new saved position. If the original point is temporarily outside the
// current work area, normalize it for visibility without overwriting the saved
// user position; this lets it return to the exact anchor when the display comes
// back.
function repairCompactWindowPosition() {
  if (process.platform !== 'darwin') return false;
  if (!mainWindow || mainWindow.isDestroyed() || activeWindowMode !== 'compact') return false;
  if (switchingWindowMode || activeManualWindowDrag) return false;
  const current = mainWindow.getBounds();
  const target = normalizeCompactBounds(compactWindowBounds || current, current);
  if (compactBoundsMatch(current, target)) return false;
  switchingWindowMode = true;
  try {
    lockCompactWindowSize();
    mainWindow.setBounds(target, false);
    return true;
  } catch {
    return false;
  } finally {
    switchingWindowMode = false;
  }
}

function scheduleCompactWindowPositionRepair(delay = 80) {
  if (process.platform !== 'darwin') return;
  clearTimeout(compactPositionRepairTimer);
  compactPositionRepairTimer = setTimeout(() => {
    compactPositionRepairTimer = null;
    repairCompactWindowPosition();
  }, Math.max(0, Number(delay) || 0));
}

function enforceCompactWindowSize() {
  if (!mainWindow || mainWindow.isDestroyed() || activeWindowMode !== 'compact') return null;
  const current = mainWindow.getBounds();
  // During an explicit drag, follow the pointer. At all other times keep Mini
  // anchored to the last user-selected position instead of adopting native drift.
  const source = activeManualWindowDrag || !compactWindowBounds ? current : compactWindowBounds;
  const target = normalizeCompactBounds(source, current);
  lockCompactWindowSize();
  if (!compactBoundsMatch(current, target)) {
    switchingWindowMode = true;
    try { mainWindow.setBounds(target, false); } catch {}
    finally { switchingWindowMode = false; }
  }
  if (!compactWindowBounds || activeManualWindowDrag) compactWindowBounds = { ...target };
  return target;
}

function windowIntersectsAnyDisplay(bounds) {
  if (!bounds) return true;
  try {
    return screen.getAllDisplays().some((display) => {
      const area = display.workArea || display.bounds;
      const left = Math.max(bounds.x, area.x);
      const top = Math.max(bounds.y, area.y);
      const right = Math.min(bounds.x + bounds.width, area.x + area.width);
      const bottom = Math.min(bounds.y + bounds.height, area.y + area.height);
      return (right - left) >= 48 && (bottom - top) >= 40;
    });
  } catch {
    return true;
  }
}

function ensureMainWindowVisible({ focus = true } = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  try {
    if (mainWindow.isMinimized()) mainWindow.restore();
  } catch {}
  try {
    const bounds = mainWindow.getBounds();
    if (activeWindowMode === 'compact') {
      const target = normalizeCompactBounds(compactWindowBounds || bounds, bounds);
      if (bounds.width !== COMPACT_WINDOW_WIDTH || bounds.height !== COMPACT_WINDOW_HEIGHT || !windowIntersectsAnyDisplay(bounds)) {
        lockCompactWindowSize();
        mainWindow.setBounds(target, false);
        if (!compactWindowBounds) compactWindowBounds = { ...target };
      }
    } else if (!windowIntersectsAnyDisplay(bounds)) {
      mainWindow.center();
    }
  } catch {}
  try { mainWindow.show(); } catch {}
  if (process.platform === 'darwin') {
    try { app.show(); } catch {}
  }
  if (focus) {
    try { mainWindow.moveTop(); } catch {}
    try { mainWindow.focus(); } catch {}
    try { app.focus({ steal: true }); } catch {}
  }
  return true;
}

function startupRecoveryStateSnapshot() {
  return {
    inProgress: Boolean(startupRecoveryInProgress),
    stopping: Boolean(startupRecoveryInProgress && recoveryCancelRequested),
    cancellable: Boolean(startupRecoveryInProgress && !recoveryCancelRequested)
  };
}

function broadcastStartupRecoveryState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try { mainWindow.webContents.send('recording:startup-recovery-state', startupRecoveryStateSnapshot()); } catch {}
}

function publishRecoveryNotice(notice) {
  if (!notice) return;
  pendingRecoveryNotice = notice;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try { mainWindow.webContents.send('recording:recovery-status-changed'); } catch {}
}


function stageInterruptedActiveJournalForRecovery() {
  const active = readRecoveryJournal();
  if (!active?.tempPath) return null;
  const activePath = path.resolve(String(active.tempPath));
  const existing = listPendingRecoveries(recoveryDirectory()).find((item) => {
    try { return path.resolve(String(item.manifest?.tempPath || '')) === activePath; } catch { return false; }
  });
  if (existing) {
    clearRecoveryJournal();
    return existing;
  }
  const preserved = createPendingRecovery(recoveryDirectory(), active, 'Previous session ended before recording completed.');
  if (preserved) clearRecoveryJournal();
  return preserved;
}

function pendingRecoveriesForAutomaticRun() {
  return listPendingRecoveries(recoveryDirectory()).filter((item) => item.manifest?.status !== 'paused_by_user');
}

function setUserPausedRecoveryState(paused) {
  for (const item of listPendingRecoveries(recoveryDirectory())) {
    const manifest = { ...(item.manifest || {}) };
    if (!manifest.tempPath) continue;
    if (paused) {
      if (manifest.status === 'paused_by_user') continue;
      manifest.statusBeforePause = manifest.status || 'finalization_failed';
      manifest.status = 'paused_by_user';
      manifest.pausedAt = Date.now();
    } else if (manifest.status === 'paused_by_user') {
      manifest.status = manifest.statusBeforePause || 'finalization_failed';
      delete manifest.statusBeforePause;
      delete manifest.pausedAt;
    } else continue;
    try { atomicWriteJson(item.manifestPath, manifest); } catch {}
  }
}

function recoveryCancellationError(reason = recoveryCancelReason || 'Recovery was stopped.') {
  const error = new Error(reason);
  error.code = 'RECOVERY_CANCELLED';
  return error;
}

function isRecoveryCancellationError(error) {
  return error?.code === 'RECOVERY_CANCELLED';
}

function throwIfRecoveryCancelled() {
  if (recoveryProcessContext.getStore()?.recoveryTask && recoveryCancelRequested) throw recoveryCancellationError();
}

function requestRecoveryCancellation(reason = 'Recovery was stopped. The unfinished recording remains protected.', options = {}) {
  if (!startupRecoveryInProgress) return { requested: false, message: 'No recovery is currently running.' };
  activityLog('warn', 'recovery.cancel-requested', { reason: String(reason || ''), pauseForUser: Boolean(options.pauseForUser), activeProcesses: activeRecoveryChildren.size });
  if (options.pauseForUser) setUserPausedRecoveryState(true);
  recoveryCancelRequested = true;
  recoveryCancelReason = String(reason || 'Recovery was stopped.');
  for (const child of [...activeRecoveryChildren]) {
    try { child.kill('SIGTERM'); } catch {}
    const timer = setTimeout(() => {
      try { if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL'); } catch {}
    }, 1200);
    timer.unref?.();
  }
  broadcastStartupRecoveryState();
  return {
    requested: true,
    paused: Boolean(options.pauseForUser),
    message: options.pauseForUser
      ? 'Stopping recovery. This unfinished recording is paused for later and will not auto-recover on the next launch.'
      : 'Stopping recovery. The unfinished recording remains protected and can be recovered later.'
  };
}

function hasPendingRecoveryWork() {
  try {
    if (pendingRecoveriesForAutomaticRun().length) return true;
    return Boolean(readRecoveryJournal()?.tempPath);
  } catch {
    return false;
  }
}

async function runStartupMaintenance(pendingRecoveryAtLaunch = hasPendingRecoveryWork()) {
  if (startupRecoveryStarted) return;
  startupRecoveryStarted = true;

  // v0.2.90: interrupted media is protected at launch, but recovery is deliberately
  // user-initiated. A multi-hour FFmpeg recovery must never consume the same CPU/GPU
  // and disk bandwidth as a new live recording.
  startupRecoveryInProgress = false;
  recoveryCancelRequested = false;
  recoveryCancelReason = '';
  if (pendingRecoveryAtLaunch) {
    const pending = listPendingRecoveries(recoveryDirectory());
    const paused = pending.some((item) => item.manifest?.status === 'paused_by_user');
    if (!pendingRecoveryNotice) {
      pendingRecoveryNotice = {
        recovered: false,
        paused,
        available: true,
        title: paused ? 'Unfinished recording saved for later' : 'Unfinished recording available',
        message: 'The interrupted recording is protected. Recover it whenever convenient; new recordings are available normally and recovery is not running in the background.'
      };
    }
    activityLog('warn', 'recovery.available-at-startup', { pending: pending.length, paused, automaticRecovery: false });
    broadcastStartupRecoveryState();
  }
  void videoEncoderManager.probe().catch((error) => {
    activityLog('warn', 'video-encoder.probe-failed', { error });
    return null;
  });
}

function setRecordingPerformanceWindowMode(enabled) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    recordingPerformanceModeActive = false;
    recordingPerformanceWindowState = null;
    return { active: false };
  }
  const wantsActive = Boolean(enabled) && activeWindowMode === 'full';
  if (wantsActive && !recordingPerformanceModeActive) {
    recordingPerformanceWindowState = {
      opacity: (() => { try { return mainWindow.getOpacity(); } catch { return 1; } })()
    };
    recordingPerformanceModeActive = true;
    // A full-screen translucent/vibrant Electron window can materially increase
    // WindowServer/DWM compositing cost while that same display is captured. Keep
    // the UI fully opaque during active Full View recording; renderer CSS also
    // removes glass blur for the duration of capture.
    try { mainWindow.setOpacity(1); } catch {}
    if (process.platform === 'darwin') {
      try { mainWindow.setVibrancy(null); } catch {}
    }
  } else if (!wantsActive && recordingPerformanceModeActive) {
    const restore = recordingPerformanceWindowState || { opacity: 1 };
    recordingPerformanceModeActive = false;
    recordingPerformanceWindowState = null;
    if (process.platform === 'darwin') {
      try { mainWindow.setVibrancy('under-window'); } catch {}
    }
    try { mainWindow.setOpacity(Math.max(0.5, Math.min(1, Number(restore.opacity) || 1))); } catch {}
  }
  return {
    active: recordingPerformanceModeActive,
    opacity: (() => { try { return mainWindow.getOpacity(); } catch { return 1; } })()
  };
}

function createWindow() {
  // v0.2.82: create the BrowserWindow hidden and restore the last native
  // Full/Mini geometry before the first visible frame. This removes the startup
  // flash where a Full window appeared briefly before switching to Mini.
  const savedViewState = readSavedWindowViewState();
  activeWindowMode = savedViewState?.mode || 'full';
  fullWindowBounds = normalizeFullWindowBounds(savedViewState?.fullBounds || fullWindowBounds);
  switchingWindowMode = false;
  rendererUiReady = false;
  nativeWindowReadyToShow = false;
  clearTimeout(startupWindowShowFailsafeTimer);
  startupWindowShowFailsafeTimer = null;
  const platformWindowStyle = process.platform === 'darwin'
    ? {
        titleBarStyle: 'hiddenInset',
        vibrancy: 'under-window',
        visualEffectState: 'followWindow',
        backgroundColor: '#00000000'
      }
    : process.platform === 'win32'
      ? { backgroundMaterial: 'mica', backgroundColor: '#eef3fb' }
      : { backgroundColor: '#10131a' };

  compactWindowBounds = readSavedCompactWindowBounds() || compactWindowBounds;
  try {
    loadWindowCapturePrivacyPreference();
  } catch (error) {
    // Privacy settings are optional and must never prevent the app window from
    // opening. If anything unexpected happens, use the protected default.
    windowCapturePrivacyEnabled = true;
    windowCapturePrivacyPreferenceLoaded = true;
    console.warn('Unable to load screen-sharing privacy preference; using protected default:', error?.message || error);
  }

  const initialCompact = activeWindowMode === 'compact';
  const defaultFullBounds = fullWindowBounds || { width: 1320, height: 900 };
  const initialBounds = initialCompact
    ? normalizeCompactBounds(compactWindowBounds || { x: 40, y: 40, width: COMPACT_WINDOW_WIDTH, height: COMPACT_WINDOW_HEIGHT })
    : defaultFullBounds;

  mainWindow = new BrowserWindow({
    show: false,
    width: initialCompact ? COMPACT_WINDOW_WIDTH : initialBounds.width,
    height: initialCompact ? COMPACT_WINDOW_HEIGHT : initialBounds.height,
    ...(Number.isFinite(initialBounds.x) ? { x: initialBounds.x } : {}),
    ...(Number.isFinite(initialBounds.y) ? { y: initialBounds.y } : {}),
    minWidth: initialCompact ? COMPACT_WINDOW_WIDTH : 1020,
    minHeight: initialCompact ? COMPACT_WINDOW_HEIGHT : 720,
    movable: true,
    resizable: !initialCompact,
    title: APP_DISPLAY_NAME,
    ...(fs.existsSync(APP_ICON_PATH) ? { icon: APP_ICON_PATH } : {}),
    ...platformWindowStyle,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const createdWindow = mainWindow;
  applyWindowCaptureProtection(createdWindow);
  createdWindow.once('ready-to-show', () => {
    if (mainWindow !== createdWindow) return;
    nativeWindowReadyToShow = true;
    applyWindowCaptureProtection(createdWindow);
    maybeShowStartupWindow();
  });
  createdWindow.webContents.once('did-finish-load', () => {
    if (mainWindow !== createdWindow) return;
    activityLog('info', 'renderer.did-finish-load', { url: createdWindow.webContents.getURL() });
    broadcastStartupRecoveryState();
    if (pendingRecoveryNotice) {
      try { createdWindow.webContents.send('recording:recovery-status-changed'); } catch {}
    }
    // Fail-safe only: renderer normally signals UI-ready immediately after it has
    // restored the persisted view. Never leave the app invisible if renderer
    // initialization fails before that handshake.
    clearTimeout(startupWindowShowFailsafeTimer);
    startupWindowShowFailsafeTimer = setTimeout(() => {
      if (mainWindow !== createdWindow || createdWindow.isDestroyed() || createdWindow.isVisible()) return;
      rendererUiReady = true;
      nativeWindowReadyToShow = true;
      ensureMainWindowVisible();
    }, 5000);
  });
  createdWindow.on('close', (event) => {
    const captureStillActive = Boolean(activeWriteStream || activeMicWriteStream || activeNeuralMicWriteStream);
    if (!captureStillActive) {
      try {
        const bounds = createdWindow.getBounds();
        if (activeWindowMode === 'compact') {
          compactWindowBounds = { ...normalizeCompactBounds(bounds) };
          persistCompactWindowBounds(compactWindowBounds);
        } else {
          fullWindowBounds = { ...bounds };
        }
        persistWindowViewState();
      } catch {}
      return;
    }
    if (appIsQuitting) return;
    event.preventDefault();
    ensureMainWindowVisible();
    try { createdWindow.webContents.send('window:close-blocked-recording'); } catch {}
  });
  createdWindow.webContents.on('render-process-gone', (_event, details) => {
    activityLog('error', 'renderer.process-gone', { reason: details?.reason || '', exitCode: details?.exitCode });
  });
  createdWindow.webContents.on('unresponsive', () => activityLog('warn', 'renderer.unresponsive', {}));
  createdWindow.webContents.on('responsive', () => activityLog('info', 'renderer.responsive', {}));
  createdWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    activityLog('error', 'renderer.did-fail-load', { errorCode, errorDescription, validatedURL, isMainFrame });
  });

  createdWindow.on('closed', () => {
    clearTimeout(startupWindowShowFailsafeTimer);
    startupWindowShowFailsafeTimer = null;
    if (mainWindow === createdWindow) mainWindow = null;
    activeManualWindowDrag = null;
  });

  // Keep the renderer locked to the bundled PulseStudio UI. The app does
  // not need arbitrary navigation or popup windows; deny both fail-closed.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  mainWindow.on('enter-full-screen', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('window:fullscreen-changed', true);
  });
  mainWindow.on('leave-full-screen', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('window:fullscreen-changed', false);
  });

  try { mainWindow.setMovable(true); } catch {}
  applyNativeWindowControlsForMode(activeWindowMode);
  if (activeWindowMode === 'compact') {
    lockCompactWindowSize();
    compactWindowBounds = { ...mainWindow.getBounds() };
  } else {
    unlockFullWindowSize();
    fullWindowBounds = { ...mainWindow.getBounds() };
  }

  // Keep independent positions for Full and Compact view while the app is open.
  // Electron's native drag regions move the same BrowserWindow, so track the
  // current mode whenever the user moves/resizes it. This prevents Compact
  // from jumping back to the Full window position on every mode switch.
  const rememberWindowBounds = () => {
    if (switchingWindowMode || !mainWindow || mainWindow.isDestroyed()) return;
    const bounds = mainWindow.getBounds();
    if (activeWindowMode === 'compact') {
      const fixed = normalizeCompactBounds(bounds);
      if (bounds.width !== COMPACT_WINDOW_WIDTH || bounds.height !== COMPACT_WINDOW_HEIGHT) {
        enforceCompactWindowSize();
        return;
      }

      // Only an explicit Mini drag is allowed to redefine the user's anchor.
      // On macOS, native window-manager moves can occur after sleep/wake or
      // display/work-area changes; those are repaired instead of persisted.
      if (activeManualWindowDrag || process.platform !== 'darwin') {
        compactWindowBounds = { ...fixed };
        scheduleCompactWindowBoundsSave(compactWindowBounds);
        return;
      }
      if (!compactWindowBounds) {
        compactWindowBounds = { ...fixed };
        scheduleCompactWindowBoundsSave(compactWindowBounds);
        return;
      }
      const intended = normalizeCompactBounds(compactWindowBounds, bounds);
      if (bounds.x !== intended.x || bounds.y !== intended.y) {
        scheduleCompactWindowPositionRepair(30);
      }
    } else {
      fullWindowBounds = { ...bounds };
      scheduleWindowViewStateSave();
    }
  };
  mainWindow.on('move', rememberWindowBounds);
  mainWindow.on('resize', rememberWindowBounds);

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}


function snapshotsDirectory() {
  // Keep snapshots beside recordings so all captured media is in one place.
  return recordingsDirectory();
}

function nextUniquePath(dir, base, ext) {
  let candidate = path.join(dir, `${base}.${ext}`);
  let counter = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base}_${String(counter).padStart(3, '0')}.${ext}`);
    counter += 1;
  }
  return candidate;
}

function nextSnapshotPath() {
  return nextUniquePath(snapshotsDirectory(), `Screen Snapshot ${localTimestamp()}`, 'png');
}

function audioRecordingExtension(sourcePath) {
  const ext = path.extname(String(sourcePath || '')).toLowerCase();
  return ext === '.mp3' ? 'mp3' : ext === '.m4a' ? 'm4a' : null;
}

function nextTrimmedRecordingPath(sourcePath) {
  const safe = safeRecordingPath(sourcePath);
  const stem = path.basename(safe, path.extname(safe));
  return nextUniquePath(recordingsDirectory(), `${stem}_trimmed_${localTimestamp()}`, audioRecordingExtension(safe) || 'mp4');
}

function nextEditedRecordingPath(sourcePath) {
  const safe = safeRecordingPath(sourcePath);
  const stem = path.basename(safe, path.extname(safe));
  return nextUniquePath(recordingsDirectory(), `${stem}_edited_${localTimestamp()}`, audioRecordingExtension(safe) || 'mp4');
}

function nextAudioExportPath(sourcePath, format = 'm4a') {
  const safe = safeRecordingPath(sourcePath);
  const stem = path.basename(safe, path.extname(safe));
  const ext = String(format).toLowerCase() === 'mp3' ? 'mp3' : 'm4a';
  return nextUniquePath(recordingsDirectory(), `${stem}_audio_${localTimestamp()}`, ext);
}

function normalizeCutSegments(segments, maximumDuration) {
  if (!Array.isArray(segments)) throw new Error('Edit segments were not valid.');
  if (segments.length > 50) throw new Error('A maximum of 50 cut segments is supported in one edit.');
  const max = Number(maximumDuration);
  if (!Number.isFinite(max) || max <= 0) throw new Error('Recording duration could not be determined.');
  const normalized = segments.map((segment) => {
    const start = Math.max(0, Math.min(max, Number(segment?.startSeconds)));
    const end = Math.max(0, Math.min(max, Number(segment?.endSeconds)));
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    return { startSeconds: Math.min(start, end), endSeconds: Math.max(start, end) };
  }).filter((segment) => segment && segment.endSeconds - segment.startSeconds >= 0.1)
    .sort((a, b) => a.startSeconds - b.startSeconds);
  const merged = [];
  for (const segment of normalized) {
    const previous = merged[merged.length - 1];
    if (previous && segment.startSeconds <= previous.endSeconds + 0.02) {
      previous.endSeconds = Math.max(previous.endSeconds, segment.endSeconds);
    } else {
      merged.push({ ...segment });
    }
  }
  return merged;
}

function keptSegmentsFromCuts(cuts, duration) {
  const kept = [];
  let cursor = 0;
  for (const cut of cuts) {
    if (cut.startSeconds - cursor >= 0.08) kept.push({ startSeconds: cursor, endSeconds: cut.startSeconds });
    cursor = Math.max(cursor, cut.endSeconds);
  }
  if (duration - cursor >= 0.08) kept.push({ startSeconds: cursor, endSeconds: duration });
  return kept;
}

function remapMarkersAfterCuts(markers, cuts) {
  const result = [];
  for (const marker of normalizeMarkers(markers)) {
    const removed = cuts.some((cut) => marker.seconds >= cut.startSeconds && marker.seconds < cut.endSeconds);
    if (removed) continue;
    let removedBefore = 0;
    for (const cut of cuts) {
      if (cut.endSeconds <= marker.seconds) removedBefore += cut.endSeconds - cut.startSeconds;
    }
    result.push({ ...marker, seconds: Math.max(0, marker.seconds - removedBefore) });
  }
  return result;
}

async function repairRecordingForPlayback(recordingPath) {
  const source = safeRecordingPath(recordingPath);
  if (!fs.existsSync(source)) throw new Error('Recording was not found.');
  if (!/\.(mp4|webm)$/i.test(source)) throw new Error('Only video recordings can be repaired for playback.');
  const directory = path.dirname(source);
  const stem = path.basename(source, path.extname(source));
  const temp = path.join(directory, `.${stem}.playback-repair-${Date.now()}-${process.pid}.mp4`);
  const backup = path.join(directory, `.${stem}.playback-repair-backup-${Date.now()}-${process.pid}${path.extname(source)}`);
  const codec = await videoCodecForRecording(source).catch(() => 'h264');
  let method = 'remux';
  try {
    if (/\.mp4$/i.test(source)) {
      try {
        await remuxMediaRecorderMp4(source, temp);
      } catch (remuxError) {
        method = 'recovered-transcode';
        try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch {}
        await transcodeRecoveredVideo(source, temp, codec);
        await validatePlayableVideoFile(temp);
      }
    } else {
      method = 'recovered-transcode';
      await transcodeRecoveredVideo(source, temp, codec);
      await validatePlayableVideoFile(temp);
    }
    fs.renameSync(source, backup);
    try {
      fs.renameSync(temp, source);
    } catch (error) {
      try { if (fs.existsSync(source)) fs.unlinkSync(source); } catch {}
      try { fs.renameSync(backup, source); } catch {}
      throw error;
    }
    try { fs.unlinkSync(backup); } catch {}
    durationProbeCache.clear();
    waveformCache.clear();
    return { repaired: true, path: source, method };
  } finally {
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch {}
    // A backup is intentionally left only if replacement/restore itself failed.
  }
}

async function recordingHasAudio(recordingPath) {
  const executable = safeFfmpegPath();
  if (!executable || !fs.existsSync(executable)) throw new Error('FFmpeg is unavailable. Run npm install again.');
  return new Promise((resolve) => {
    const child = spawn(executable, ['-hide_banner', '-i', recordingPath], { windowsHide: true });
    let stderr = '';
    child.stderr?.on('data', (data) => { stderr += data.toString(); });
    child.on('error', () => resolve(false));
    child.on('close', () => resolve(/Stream #.*Audio:/i.test(stderr)));
  });
}

function safeBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value?.type === 'Buffer' && Array.isArray(value.data)) return Buffer.from(value.data);
  throw new Error('Snapshot image data was not valid.');
}

function normalizedKeyName(name) {
  const replacements = {
    Ctrl: 'Ctrl', Control: 'Ctrl', CtrlLeft: 'Ctrl', CtrlRight: 'Ctrl',
    Shift: 'Shift', ShiftLeft: 'Shift', ShiftRight: 'Shift',
    Alt: 'Alt', AltLeft: 'Alt', AltRight: 'Alt',
    Meta: process.platform === 'darwin' ? '⌘' : 'Win',
    MetaLeft: process.platform === 'darwin' ? '⌘' : 'Win',
    MetaRight: process.platform === 'darwin' ? '⌘' : 'Win',
    Command: '⌘', Super: process.platform === 'darwin' ? '⌘' : 'Win',
    Return: 'Enter', Space: 'Space', Backspace: 'Backspace', Escape: 'Esc', Delete: 'Delete',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    PageUp: 'Page Up', PageDown: 'Page Down'
  };
  return replacements[name] || String(name || '').replace(/^Key/, '').replace(/^Digit/, '');
}

function buildKeyHookMap(UiohookKey) {
  const reverse = new Map();
  for (const [name, value] of Object.entries(UiohookKey || {})) {
    if (typeof value === 'number' && !reverse.has(value)) reverse.set(value, normalizedKeyName(name));
  }
  return reverse;
}

function stopKeyHook() {
  if (!keyHook || !keyHookActive) return;
  try { keyHook.stop(); } catch {}
  keyHookActive = false;
}

function startKeyHook() {
  try {
    if (!keyHook) {
      const module = require('uiohook-napi');
      keyHook = module.uIOhook;
      keyHookKeyMap = buildKeyHookMap(module.UiohookKey);
      keyHookListener = (event = {}) => {
        if (!keyHookActive || !mainWindow || mainWindow.isDestroyed()) return;
        const base = normalizedKeyName(keyHookKeyMap.get(event.keycode) || `Key ${event.keycode}`);
        const modifierNames = [];
        if (event.ctrlKey && base !== 'Ctrl') modifierNames.push('Ctrl');
        if (event.shiftKey && base !== 'Shift') modifierNames.push('Shift');
        if (event.altKey && base !== 'Alt') modifierNames.push('Alt');
        if (event.metaKey && base !== '⌘' && base !== 'Win') modifierNames.push(process.platform === 'darwin' ? '⌘' : 'Win');
        const modifierOnly = ['Ctrl', 'Shift', 'Alt', '⌘', 'Win'].includes(base);
        if (modifierOnly) return;
        const label = [...modifierNames, base].join(' + ');
        mainWindow.webContents.send('keystroke:event', { label, keycode: event.keycode, at: Date.now() });
      };
      keyHook.on('keydown', keyHookListener);
    }
    if (!keyHookActive) keyHook.start();
    keyHookActive = true;
    return { enabled: true };
  } catch (error) {
    keyHookActive = false;
    return { enabled: false, error: error.message };
  }
}

function recordingsDirectorySettingsPath() {
  return path.join(app.getPath('userData'), 'recording-location.json');
}

function defaultRecordingsDirectory() {
  return app.getPath('videos');
}

function loadRecordingsDirectoryPreference() {
  if (recordingsDirectoryPreferenceLoaded) return;
  recordingsDirectoryPreferenceLoaded = true;
  try {
    const data = JSON.parse(fs.readFileSync(recordingsDirectorySettingsPath(), 'utf8'));
    if (data?.directory && path.isAbsolute(String(data.directory))) recordingsDirectoryOverride = path.resolve(String(data.directory));
  } catch {}
}

function saveRecordingsDirectoryPreference() {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(recordingsDirectorySettingsPath(), JSON.stringify({ directory: recordingsDirectoryOverride || '' }, null, 2), 'utf8');
  } catch {}
}

function recordingsDirectory() {
  loadRecordingsDirectoryPreference();
  if (recordingsDirectoryOverride) {
    try {
      fs.mkdirSync(recordingsDirectoryOverride, { recursive: true });
      fs.accessSync(recordingsDirectoryOverride, fs.constants.R_OK | fs.constants.W_OK);
      return recordingsDirectoryOverride;
    } catch {
      // If a removable/custom location is temporarily unavailable, keep the preference
      // but fall back to the OS Movies/Videos folder so the app remains usable.
    }
  }
  const dir = defaultRecordingsDirectory();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function setRecordingsDirectory(directory) {
  if (activeWriteStream || activeTempPath) throw new Error('Stop the active recording before changing the recording folder.');
  const requested = path.resolve(String(directory || '').trim());
  if (!requested || !path.isAbsolute(requested)) throw new Error('Choose a valid recording folder.');
  fs.mkdirSync(requested, { recursive: true });
  fs.accessSync(requested, fs.constants.R_OK | fs.constants.W_OK);
  const defaultDir = path.resolve(defaultRecordingsDirectory());
  recordingsDirectoryOverride = requested === defaultDir ? null : requested;
  recordingsDirectoryPreferenceLoaded = true;
  saveRecordingsDirectoryPreference();
  durationProbeCache.clear();
  waveformCache.clear();
  lastRecordingPath = null;
  return recordingsDirectory();
}

function recoveryDirectory() {
  const dir = path.join(app.getPath('userData'), 'recovery');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function recoveryJournalPath() {
  return path.join(recoveryDirectory(), 'active-recording.json');
}

function recordingHealthSnapshot() {
  const now = Date.now();
  let freeBytes = null;
  let totalBytes = null;
  try {
    const stat = fs.statfsSync(recordingsDirectory());
    freeBytes = Number(stat.bavail) * Number(stat.bsize);
    totalBytes = Number(stat.blocks) * Number(stat.bsize);
  } catch {}
  const age = (value) => value ? Math.max(0, now - value) : null;
  return {
    active: Boolean(activeTempPath || activeWriteStream),
    startedAt: activeRecordingHealth.startedAt || 0,
    chunkAgeMs: age(activeRecordingHealth.lastChunkAt),
    micChunkAgeMs: age(activeRecordingHealth.lastMicChunkAt),
    neuralMicChunkAgeMs: age(activeRecordingHealth.lastNeuralMicChunkAt),
    bytesWritten: activeBytesWritten || 0,
    microphoneBytesWritten: activeMicBytesWritten || 0,
    neuralMicrophoneBytesWritten: activeNeuralMicBytesWritten || 0,
    writerOpen: Boolean(activeWriteStream),
    microphoneWriterOpen: Boolean(activeMicWriteStream),
    neuralMicrophoneWriterOpen: Boolean(activeNeuralMicWriteStream),
    applicationAudioActive: Boolean(applicationAudioProcess),
    applicationAudioTempActive: Boolean(applicationAudioTempPath),
    lastWriteError: activeRecordingHealth.lastWriteError || '',
    lastMicWriteError: activeRecordingHealth.lastMicWriteError || '',
    lastNeuralMicWriteError: activeRecordingHealth.lastNeuralMicWriteError || '',
    finalizing: sealedRecordingSessions.size,
    freeBytes,
    totalBytes
  };
}

function recoverySnapshot() {
  if (!activeTempPath) return null;
  return {
    tempPath: activeTempPath,
    mimeType: activeMimeType,
    recordingKind: activeRecordingKind,
    filenameTemplate: activeFilenameTemplate,
    meta: activeRecordingMeta,
    bytesWritten: activeBytesWritten,
    applicationAudioPaths: [...applicationAudioSegments, applicationAudioTempPath].filter(Boolean),
    microphonePath: activeMicTempPath || null,
    microphoneMimeType: activeMicMimeType || null,
    microphoneNoiseMode: activeMicNoiseMode || 'off',
    microphoneBytesWritten: activeMicBytesWritten || 0,
    neuralMicrophonePath: activeNeuralMicTempPath || null,
    neuralMicrophoneMimeType: activeNeuralMicMimeType || null,
    neuralMicrophoneMethod: activeNeuralMicMethod || 'none',
    neuralMicrophoneBytesWritten: activeNeuralMicBytesWritten || 0
  };
}

let recoveryJournalManager = null;
function getRecoveryJournalManager() {
  if (!recoveryJournalManager) recoveryJournalManager = new RecoveryJournalManager({ journalPath: recoveryJournalPath(), snapshot: recoverySnapshot, debounceMs: 4000 });
  return recoveryJournalManager;
}

function readRecoveryJournal() { return getRecoveryJournalManager().read(); }
function writeRecoveryJournal(extra = {}, force = false) { return getRecoveryJournalManager().checkpoint(extra, force); }
function clearRecoveryJournal() { getRecoveryJournalManager().clear(); }


function categoriesMetadataPath() {
  return path.join(app.getPath('userData'), 'recording-categories.json');
}

function loadCategoryMetadata() {
  const fallback = { categories: [], assignments: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(categoriesMetadataPath(), 'utf8'));
    return {
      categories: Array.isArray(parsed.categories) ? parsed.categories.filter((value) => typeof value === 'string' && value.trim()) : [],
      assignments: parsed.assignments && typeof parsed.assignments === 'object' ? parsed.assignments : {}
    };
  } catch {
    return fallback;
  }
}

function saveCategoryMetadata(metadata) {
  const target = categoriesMetadataPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(metadata, null, 2), 'utf8');
}

function sanitizeCategoryName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('Enter a category name.');
  if (name.toLowerCase() === 'uncategorized' || name.toLowerCase() === 'all sections') throw new Error('That category name is reserved.');
  if (name.length > 60) throw new Error('Category names must be 60 characters or fewer.');
  if (/[\\/:*?"<>|\x00-\x1F]/.test(name)) throw new Error('The category name contains unsupported characters.');
  return name;
}

function categoryForRecording(filePath, metadata = loadCategoryMetadata()) {
  return metadata.assignments[path.basename(filePath)] || 'Uncategorized';
}

function createRecordingCategory(requestedName) {
  const name = sanitizeCategoryName(requestedName);
  const metadata = loadCategoryMetadata();
  const existing = metadata.categories.find((item) => item.toLowerCase() === name.toLowerCase());
  if (existing) return { name: existing, categories: metadata.categories };
  metadata.categories.push(name);
  metadata.categories.sort((a, b) => a.localeCompare(b));
  saveCategoryMetadata(metadata);
  return { name, categories: metadata.categories };
}

function setRecordingCategory(recordingPath, requestedCategory) {
  const safe = safeRecordingPath(recordingPath);
  if (!fs.existsSync(safe)) throw new Error('Recording was not found.');
  const metadata = loadCategoryMetadata();
  const category = !requestedCategory || requestedCategory === 'Uncategorized'
    ? 'Uncategorized'
    : sanitizeCategoryName(requestedCategory);
  if (category !== 'Uncategorized' && !metadata.categories.some((item) => item.toLowerCase() === category.toLowerCase())) {
    metadata.categories.push(category);
    metadata.categories.sort((a, b) => a.localeCompare(b));
  }
  const key = path.basename(safe);
  if (category === 'Uncategorized') delete metadata.assignments[key];
  else metadata.assignments[key] = metadata.categories.find((item) => item.toLowerCase() === category.toLowerCase()) || category;
  saveCategoryMetadata(metadata);
  return { category: categoryForRecording(safe, metadata), categories: metadata.categories };
}

function migrateRecordingCategory(oldPath, newPath) {
  const metadata = loadCategoryMetadata();
  const oldKey = path.basename(oldPath);
  const newKey = path.basename(newPath);
  if (metadata.assignments[oldKey]) {
    metadata.assignments[newKey] = metadata.assignments[oldKey];
    delete metadata.assignments[oldKey];
    saveCategoryMetadata(metadata);
  }
}

function removeRecordingCategoryAssignment(recordingPath) {
  const metadata = loadCategoryMetadata();
  const key = path.basename(recordingPath);
  if (metadata.assignments[key]) {
    delete metadata.assignments[key];
    saveCategoryMetadata(metadata);
  }
}


function markersMetadataPath() {
  return path.join(app.getPath('userData'), 'recording-markers.json');
}

function loadMarkerMetadata() {
  try {
    const parsed = JSON.parse(fs.readFileSync(markersMetadataPath(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveMarkerMetadata(metadata) {
  const target = markersMetadataPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(metadata, null, 2), 'utf8');
}

function normalizeMarkers(markers) {
  if (!Array.isArray(markers)) return [];
  return markers.map((item, index) => ({
    id: String(item?.id || `marker-${index + 1}`),
    seconds: Math.max(0, Number(item?.seconds) || 0),
    label: String(item?.label || `Bookmark ${index + 1}`).trim().slice(0, 120) || `Bookmark ${index + 1}`
  })).sort((a, b) => a.seconds - b.seconds);
}

function markersForRecording(recordingPath) {
  const safe = safeRecordingPath(recordingPath);
  const metadata = loadMarkerMetadata();
  return normalizeMarkers(metadata[path.basename(safe)] || []);
}

function saveMarkersForRecording(recordingPath, markers) {
  const safe = safeRecordingPath(recordingPath);
  if (!fs.existsSync(safe)) throw new Error('Recording was not found.');
  const metadata = loadMarkerMetadata();
  const normalized = normalizeMarkers(markers);
  const key = path.basename(safe);
  if (normalized.length) metadata[key] = normalized;
  else delete metadata[key];
  saveMarkerMetadata(metadata);
  return normalized;
}

function migrateRecordingMarkers(oldPath, newPath) {
  const metadata = loadMarkerMetadata();
  const oldKey = path.basename(oldPath);
  const newKey = path.basename(newPath);
  if (metadata[oldKey]) {
    metadata[newKey] = metadata[oldKey];
    delete metadata[oldKey];
    saveMarkerMetadata(metadata);
  }
}

function removeRecordingMarkers(recordingPath) {
  const metadata = loadMarkerMetadata();
  const key = path.basename(recordingPath);
  if (metadata[key]) {
    delete metadata[key];
    saveMarkerMetadata(metadata);
  }
}

function voiceHighlightsMetadataPath() {
  return path.join(app.getPath('userData'), 'recording-voice-highlights.json');
}

function loadVoiceHighlightsMetadata() {
  try {
    const parsed = JSON.parse(fs.readFileSync(voiceHighlightsMetadataPath(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveVoiceHighlightsMetadata(metadata) {
  const target = voiceHighlightsMetadataPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(metadata || {}, null, 2), 'utf8');
}

function normalizeVoiceHighlights(segments, durationSeconds = Infinity) {
  const maximum = Number.isFinite(Number(durationSeconds)) ? Math.max(0, Number(durationSeconds)) : Infinity;
  const ordered = (Array.isArray(segments) ? segments : [])
    .map((segment) => {
      const start = Math.max(0, Number(segment?.start) || 0);
      const rawEnd = Math.max(start, Number(segment?.end) || start);
      const end = Number.isFinite(maximum) ? Math.min(maximum, rawEnd) : rawEnd;
      return {
        start: Number(start.toFixed(3)),
        end: Number(end.toFixed(3)),
        confidence: Number(Math.max(0, Math.min(1, Number(segment?.confidence) || 0.75)).toFixed(3)),
        method: String(segment?.method || 'mic-system-readonly').slice(0, 64)
      };
    })
    .filter((segment) => segment.end - segment.start >= 0.16)
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const segment of ordered) {
    const previous = merged[merged.length - 1];
    if (previous && segment.start - previous.end <= 0.34) {
      previous.end = Number(Math.max(previous.end, segment.end).toFixed(3));
      previous.confidence = Math.max(previous.confidence, segment.confidence);
    } else merged.push({ ...segment });
  }
  return merged;
}

function voiceHighlightsForRecording(recordingPath) {
  const safe = safeRecordingPath(recordingPath);
  const metadata = loadVoiceHighlightsMetadata();
  const entry = metadata[path.basename(safe)];
  return normalizeVoiceHighlights(Array.isArray(entry) ? entry : entry?.segments || []);
}

function saveVoiceHighlightsForRecording(recordingPath, segments, details = {}) {
  const safe = safeRecordingPath(recordingPath);
  if (!fs.existsSync(safe)) throw new Error('Recording was not found.');
  const metadata = loadVoiceHighlightsMetadata();
  const normalized = normalizeVoiceHighlights(segments, details.durationSeconds);
  const key = path.basename(safe);
  if (normalized.length) metadata[key] = {
    version: 1,
    method: String(details.method || 'mic-system-readonly'),
    segments: normalized,
    generatedAt: new Date().toISOString()
  };
  else delete metadata[key];
  saveVoiceHighlightsMetadata(metadata);
  return normalized;
}

async function refineVoiceHighlightsWithEnrollment(recordingPath) {
  const profile = loadVoiceProfile();
  if (!profile?.embedding?.length) return null;
  const safe = safeRecordingPath(recordingPath);
  const segments = voiceHighlightsForRecording(safe);
  if (!segments.length) return null;
  const wavPath = path.join(app.getPath('temp'), `my-voice-refine-${Date.now()}-${process.pid}.wav`);
  try {
    await extractSpeechAudio(safe, wavPath, 'wav');
    const result = await runAiWorkerQueued({
      task: 'speaker-embed-ranges',
      recordingName: path.basename(safe),
      recordingPath: safe,
      wavPath,
      ranges: segments.map(({ start, end }) => ({ start, end })),
      enrollmentEmbedding: profile.embedding,
      cacheDir: path.join(app.getPath('userData'), 'models'),
      embeddingModel: AUTO_SPEAKER_EMBEDDING_MODEL
    }, 10 * 60 * 1000);
    const matches = Array.isArray(result?.matches) ? result.matches : [];
    const refined = segments.filter((segment, index) => {
      const similarity = Number(matches[index]?.similarity);
      if (!Number.isFinite(similarity)) return segment.confidence >= 0.90;
      if (similarity >= 0.45) return true;
      if (similarity >= 0.34 && segment.confidence >= 0.84) return true;
      return false;
    }).map((segment, index) => {
      const similarity = Number(matches[index]?.similarity);
      const confidence = Number.isFinite(similarity) ? Math.max(segment.confidence, Math.max(0, Math.min(1, (similarity + 1) / 2))) : segment.confidence;
      return { ...segment, confidence, method: 'mic-system+voice-profile' };
    });
    const saved = saveVoiceHighlightsForRecording(safe, refined, { method: 'mic-system+voice-profile' });
    activityLog('info', 'recording.voice-highlights-profile-refined', { outputFile: path.basename(safe), inputCount: segments.length, outputCount: saved.length, rejected: segments.length - saved.length });
    try { mainWindow?.webContents?.send('recording:voice-highlights-updated', { path: safe, segments: saved }); } catch {}
    return saved;
  } catch (error) {
    activityLog('warn', 'recording.voice-highlights-profile-refine-failed', { outputFile: path.basename(safe), error });
    return null;
  } finally {
    try { fs.rmSync(wavPath, { force: true }); } catch {}
  }
}

function migrateRecordingVoiceHighlights(oldPath, newPath) {
  const metadata = loadVoiceHighlightsMetadata();
  const oldKey = path.basename(oldPath);
  const newKey = path.basename(newPath);
  if (metadata[oldKey]) {
    metadata[newKey] = metadata[oldKey];
    delete metadata[oldKey];
    saveVoiceHighlightsMetadata(metadata);
  }
}

function removeRecordingVoiceHighlights(recordingPath) {
  const metadata = loadVoiceHighlightsMetadata();
  const key = path.basename(recordingPath);
  if (metadata[key]) {
    delete metadata[key];
    saveVoiceHighlightsMetadata(metadata);
  }
}

function trimVoiceHighlights(segments, startSeconds, endSeconds) {
  return normalizeVoiceHighlights((segments || []).map((segment) => ({
    ...segment,
    start: Math.max(Number(segment.start) || 0, startSeconds) - startSeconds,
    end: Math.min(Number(segment.end) || 0, endSeconds) - startSeconds
  })), Math.max(0, endSeconds - startSeconds));
}

function remapVoiceHighlightsAfterCuts(segments, cuts) {
  const normalizedCuts = Array.isArray(cuts) ? cuts : [];
  const pieces = [];
  for (const segment of normalizeVoiceHighlights(segments)) {
    let cursor = segment.start;
    for (const cut of normalizedCuts) {
      if (cut.endSeconds <= cursor) continue;
      if (cut.startSeconds >= segment.end) break;
      if (cut.startSeconds > cursor) pieces.push({ ...segment, start: cursor, end: Math.min(segment.end, cut.startSeconds) });
      cursor = Math.max(cursor, cut.endSeconds);
      if (cursor >= segment.end) break;
    }
    if (cursor < segment.end) pieces.push({ ...segment, start: cursor, end: segment.end });
  }
  return normalizeVoiceHighlights(pieces.map((segment) => {
    let removedBeforeStart = 0;
    let removedBeforeEnd = 0;
    for (const cut of normalizedCuts) {
      if (cut.endSeconds <= segment.start) removedBeforeStart += cut.endSeconds - cut.startSeconds;
      if (cut.endSeconds <= segment.end) removedBeforeEnd += cut.endSeconds - cut.startSeconds;
    }
    return { ...segment, start: segment.start - removedBeforeStart, end: segment.end - removedBeforeEnd };
  }));
}

async function deleteRecordingAndTranscript(recordingPath) {
  const safe = safeRecordingPath(recordingPath);
  if (!fs.existsSync(safe)) throw new Error('Recording was not found.');
  const cancelledProcessing = await cancelBackgroundProcessingForRecording(safe);
  const transcripts = transcriptPathsForRecording(safe);
  const trashed = await moveRecordingFamilyToTrash({ shell, recordingPath: safe, transcriptPaths: transcripts });
  removeRecordingCategoryAssignment(safe);
  removeRecordingMarkers(safe);
  removeRecordingVoiceHighlights(safe);
  removeRecordingInsights(safe);
  removeRecordingSpeakers(safe);
  removeRecordingTranscriptMetadata(safe);
  if (lastRecordingPath === safe) lastRecordingPath = null;
  durationProbeCache.clear();
  waveformCache.clear();
  setTimeout(() => cancelledRecordingProcessing.delete(safe), 30000).unref?.();
  return { trashed, recordingPath: safe, trash: 'system', cancelledProcessing };
}

async function deleteRecordingsBatch(recordingPaths) {
  const requested = Array.isArray(recordingPaths) ? recordingPaths : [];
  const unique = [...new Set(requested.map((item) => safeRecordingPath(item)))];
  if (!unique.length) throw new Error('No recordings were selected.');
  for (const safe of unique) {
    if (!fs.existsSync(safe)) throw new Error(`Recording was not found: ${path.basename(safe)}`);
  }
  const results = [];
  const failed = [];
  for (const safe of unique) {
    try { results.push(await deleteRecordingAndTranscript(safe)); }
    catch (error) { failed.push({ path: safe, name: path.basename(safe), error: error.message }); }
  }
  return { trashedCount: results.length, deletedCount: results.length, requestedCount: unique.length, trashed: results, deleted: results, failed, trash: 'system' };
}

function isInsideRecordingsDirectory(filePath) {
  if (!filePath) return false;
  const root = path.resolve(recordingsDirectory());
  const candidate = path.resolve(String(filePath));
  if (process.platform === 'win32') {
    const r = root.toLowerCase();
    const c = candidate.toLowerCase();
    return c === r || c.startsWith(`${r}${path.sep}`);
  }
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function safeRecordingPath(filePath) {
  if (!isInsideRecordingsDirectory(filePath)) throw new Error('The requested file is outside the recordings folder.');
  return path.resolve(String(filePath));
}

function localTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

function sanitizeFilenamePart(value, fallback = 'Recording') {
  const text = String(value || '').trim().replace(/[\/:*?"<>|\x00-\x1F]/g, '-').replace(/\s+/g, ' ').replace(/[. ]+$/g, '').slice(0, 120);
  return text || fallback;
}

function renderFilenameTemplate(template, meta = {}, date = new Date()) {
  const stamp = localTimestamp(date);
  const [datePart, timePart] = stamp.split('_');
  const tokens = {
    date: datePart,
    time: timePart,
    datetime: stamp,
    source: sanitizeFilenamePart(meta.sourceName || 'Source'),
    mode: sanitizeFilenamePart(meta.captureMode || 'capture'),
    type: meta.recordingKind === 'audio' ? 'Audio' : 'Video'
  };
  let base = String(template || 'Screen Recording {date} {time}').trim() || 'Screen Recording {date} {time}';
  base = base.replace(/\{(date|time|datetime|source|mode|type)\}/gi, (_match, key) => tokens[String(key).toLowerCase()] || '');
  base = sanitizeFilenamePart(base, `Screen Recording ${stamp}`).replace(/\.(mp4|m4a|mp3|webm)$/i, '');
  return base.slice(0, 180) || `Screen Recording ${stamp}`;
}

function nextRecordingPath(options = {}) {
  const dir = recordingsDirectory();
  const kind = options.recordingKind === 'audio' ? 'audio' : 'video';
  const ext = kind === 'audio' ? 'm4a' : 'mp4';
  const date = options.date ? new Date(options.date) : new Date();
  const base = renderFilenameTemplate(options.filenameTemplate, { ...options.meta, recordingKind: kind }, date);
  return nextUniquePath(dir, options.recovered ? `${base}_Recovered` : base, ext);
}

function reserveNextRecordingPath(options = {}) {
  const dir = recordingsDirectory();
  const kind = options.recordingKind === 'audio' ? 'audio' : 'video';
  const ext = kind === 'audio' ? 'm4a' : 'mp4';
  const date = options.date ? new Date(options.date) : new Date();
  const base = renderFilenameTemplate(options.filenameTemplate, { ...options.meta, recordingKind: kind }, date);
  let candidate = path.join(dir, `${options.recovered ? `${base}_Recovered` : base}.${ext}`);
  let counter = 1;
  while (fs.existsSync(candidate) || reservedRecordingOutputPaths.has(path.resolve(candidate))) {
    candidate = path.join(dir, `${options.recovered ? `${base}_Recovered` : base}_${String(counter).padStart(3, '0')}.${ext}`);
    counter += 1;
  }
  reservedRecordingOutputPaths.add(path.resolve(candidate));
  return candidate;
}

function releaseReservedRecordingPath(filePath) {
  if (filePath) reservedRecordingOutputPaths.delete(path.resolve(String(filePath)));
}

function transcriptPathsForRecording(recordingPath) {
  const safe = safeRecordingPath(recordingPath);
  const ext = path.extname(safe);
  const base = safe.slice(0, -ext.length);
  return { txt: `${base}.txt`, srt: `${base}.srt` };
}

function insightsMetadataPath() {
  return path.join(app.getPath('userData'), 'recording-insights.json');
}

function loadInsightsMetadata() {
  try {
    const parsed = JSON.parse(fs.readFileSync(insightsMetadataPath(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveInsightsMetadata(metadata) {
  const target = insightsMetadataPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(metadata || {}, null, 2), 'utf8');
}

function migrateRecordingInsights(oldPath, newPath) {
  const metadata = loadInsightsMetadata();
  const oldKey = path.basename(oldPath);
  const newKey = path.basename(newPath);
  if (metadata[oldKey]) {
    metadata[newKey] = metadata[oldKey];
    delete metadata[oldKey];
    saveInsightsMetadata(metadata);
  }
}

function removeRecordingInsights(recordingPath) {
  const metadata = loadInsightsMetadata();
  const key = path.basename(recordingPath);
  if (metadata[key]) {
    delete metadata[key];
    saveInsightsMetadata(metadata);
  }
}

function formatInsightsTimestamp(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return [h, m, sec].map((value) => String(value).padStart(2, '0')).join(':');
}

function transcriptForMeetingModel(text, srt) {
  const cues = parseSrtCues(srt);
  if (cues.length) return cues.map((cue) => `[${formatInsightsTimestamp(cue.start)}] ${String(cue.text || '').replace(/\s+/g, ' ').trim()}`).join('\n');
  return String(text || '').replace(/\s+/g, ' ').trim();
}

async function getOrGenerateRecordingInsights(recordingPath, force = false) {
  const safe = safeRecordingPath(recordingPath);
  if (!fs.existsSync(safe)) throw new Error('Recording was not found.');
  const transcriptPaths = transcriptPathsForRecording(safe);
  const text = fs.existsSync(transcriptPaths.txt) ? fs.readFileSync(transcriptPaths.txt, 'utf8') : '';
  const timeline = transcriptTimelineForRecording(safe);
  const srt = timeline.srtText;
  if (!String(text || '').trim() && !timeline.cues.length) throw new Error('Transcript is not ready yet.');
  const fingerprint = transcriptFingerprint(text, srt);
  const metadata = loadInsightsMetadata();
  const key = path.basename(safe);
  const cached = metadata[key];
  if (!force && cached && cached.transcriptFingerprint === fingerprint && cached.version === 3) return cached;
  let durationSeconds = null;
  try { durationSeconds = await probeRecordingDuration(safe, fs.statSync(safe)); } catch {}

  // Meeting notes are deliberately non-blocking. Normal/automatic loads use the
  // fast deterministic notes immediately and NEVER occupy the local AI queue. The
  // slower instruction model is reserved for an explicit user regeneration only.
  const fallback = generateInsights({ text, srt, durationSeconds });
  let insights = { ...fallback, overview: fallback.overview || '', version: 3, method: 'local-extractive-fallback' };
  if (!force) {
    metadata[key] = insights;
    saveInsightsMetadata(metadata);
    return insights;
  }

  // Enhanced notes are optional. Never put them in front of, or behind, another
  // local AI job. If transcription / VAD / speaker detection is using the worker,
  // keep the immediately available local notes and let the user retry enhancement
  // later. This prevents a low-priority meeting-notes card from sitting queued for
  // minutes while the transcript (the primary result) is still being produced.
  const aiSnapshot = aiWorkerManager.snapshot();
  if (aiSnapshot.activeId || aiSnapshot.jobs.some((job) => ['queued', 'running', 'cancelling'].includes(job.state))) {
    insights = { ...insights, method: 'local-extractive-fallback-ai-busy' };
    metadata[key] = insights;
    saveInsightsMetadata(metadata);
    return insights;
  }

  try {
    const enhanced = await runAiWorkerQueued({
      task: 'meeting-insights',
      recordingName: path.basename(safe),
      recordingPath: safe,
      transcript: transcriptForMeetingModel(text, srt),
      cacheDir: path.join(app.getPath('userData'), 'models'),
      model: AUTO_INSIGHTS_MODEL
    }, 30 * 60 * 1000);
    insights = {
      ...fallback,
      version: 3,
      overview: String(enhanced?.overview || fallback.overview || '').trim(),
      chapters: Array.isArray(enhanced?.chapters) && enhanced.chapters.length ? enhanced.chapters : fallback.chapters,
      summaryBullets: Array.isArray(enhanced?.summaryBullets) && enhanced.summaryBullets.length ? enhanced.summaryBullets : fallback.summaryBullets,
      actionItems: Array.isArray(enhanced?.actionItems) && enhanced.actionItems.length ? enhanced.actionItems : fallback.actionItems,
      method: enhanced?.method || 'local-instruct-qwen-structured'
    };
  } catch (error) {
    appendAiWorkerLog(`Meeting insights enhancement fallback for ${path.basename(safe)}: ${error?.message || error}`);
  }
  throwIfRecordingProcessingCancelled(safe);
  metadata[key] = insights;
  saveInsightsMetadata(metadata);
  return insights;
}

function getOrGenerateRecordingInsightsQueued(recordingPath, force = false) {
  const safe = safeRecordingPath(recordingPath);
  if (automaticInsightsJobs.has(safe)) return automaticInsightsJobs.get(safe);
  const job = recordingProcessingContext.run({ recordingPath: safe }, () => getOrGenerateRecordingInsights(safe, force))
    .finally(() => automaticInsightsJobs.delete(safe));
  automaticInsightsJobs.set(safe, job);
  return job;
}

function correctRecordingInsight(recordingPath, payload = {}) {
  const safe = safeRecordingPath(recordingPath);
  const metadata = loadInsightsMetadata();
  const key = path.basename(safe);
  const current = metadata[key];
  if (!current) throw new Error('Generate meeting insights before correcting an item.');
  const text = String(payload.text || '').trim();
  const seconds = Math.max(0, Number(payload.seconds) || 0);
  const classification = String(payload.classification || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (!['decision', 'action', 'risk', 'not_relevant'].includes(classification)) throw new Error('Choose Decision, Action, Risk, or Not relevant.');
  const sameItem = (item) => String(item?.text || '').trim() === text && Math.abs((Number(item?.seconds) || 0) - seconds) < 0.6;
  const summary = (Array.isArray(current.summaryBullets) ? current.summaryBullets : []).filter((item) => !sameItem(item));
  const actions = (Array.isArray(current.actionItems) ? current.actionItems : []).filter((item) => !sameItem(item));
  const originalAction = (current.actionItems || []).find(sameItem);
  const originalSummary = (current.summaryBullets || []).find(sameItem);
  const source = originalAction || originalSummary || { text, seconds };
  if (classification === 'action') {
    actions.push({ seconds, text: text || source.text, owner: String(source.owner || ''), due: String(source.due || ''), corrected: true });
  } else if (classification === 'decision' || classification === 'risk') {
    summary.push({ seconds, text: text || source.text, type: classification, corrected: true });
  }
  current.summaryBullets = summary.sort((a, b) => (Number(a.seconds) || 0) - (Number(b.seconds) || 0));
  current.actionItems = actions.sort((a, b) => (Number(a.seconds) || 0) - (Number(b.seconds) || 0));
  current.manualCorrections = [...(Array.isArray(current.manualCorrections) ? current.manualCorrections : []), {
    text: text || source.text, seconds, classification, correctedAt: new Date().toISOString()
  }].slice(-200);
  metadata[key] = current;
  saveInsightsMetadata(metadata);
  return current;
}


function speakerMetadataPath() {
  return path.join(app.getPath('userData'), 'recording-speakers.json');
}

function loadSpeakerMetadata() {
  try {
    const parsed = JSON.parse(fs.readFileSync(speakerMetadataPath(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveSpeakerMetadata(metadata) {
  const target = speakerMetadataPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(metadata || {}, null, 2), 'utf8');
}

function voiceProfilePath() {
  return path.join(app.getPath('userData'), 'my-voice-profile.json');
}

function loadVoiceProfile() {
  try {
    const parsed = JSON.parse(fs.readFileSync(voiceProfilePath(), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.embedding) || parsed.embedding.length < 16) return null;
    return {
      version: Number(parsed.version) || 1,
      createdAt: String(parsed.createdAt || ''),
      model: String(parsed.model || AUTO_SPEAKER_EMBEDDING_MODEL),
      speechSeconds: Math.max(0, Number(parsed.speechSeconds) || 0),
      embedding: parsed.embedding.map(Number).filter(Number.isFinite),
      spectralFingerprint: Array.isArray(parsed.spectralFingerprint) ? parsed.spectralFingerprint.map(Number).filter(Number.isFinite).slice(0, 16) : []
    };
  } catch {
    return null;
  }
}

function publicVoiceProfileStatus(profile = loadVoiceProfile()) {
  if (!profile) return { enrolled: false, createdAt: '', model: '', speechSeconds: 0, spectralFingerprint: [] };
  return {
    enrolled: true,
    createdAt: profile.createdAt,
    model: profile.model,
    speechSeconds: profile.speechSeconds,
    spectralFingerprint: [...(profile.spectralFingerprint || [])]
  };
}

function saveVoiceProfile(profile) {
  const target = voiceProfilePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  atomicWriteJson(target, profile);
  activityLog('info', 'voice-profile.saved', { model: profile.model, speechSeconds: profile.speechSeconds, spectralBands: profile.spectralFingerprint?.length || 0 });
  return publicVoiceProfileStatus(profile);
}

function clearVoiceProfile() {
  try { fs.rmSync(voiceProfilePath(), { force: true }); } catch {}
  activityLog('info', 'voice-profile.cleared', {});
  return publicVoiceProfileStatus(null);
}

async function enrollVoiceProfileFromPayload(payload = {}) {
  if (recordingCaptureActive || activeTempPath || activeWriteStream) throw new Error('Finish the current recording before enrolling My Voice.');
  const raw = payload.audioData;
  const buffer = Buffer.isBuffer(raw) ? raw : raw instanceof ArrayBuffer ? Buffer.from(raw) : ArrayBuffer.isView(raw) ? Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength) : Buffer.from(raw || []);
  if (buffer.length < 1024) throw new Error('The voice sample was empty. Please speak naturally for about 15 seconds.');
  const mime = String(payload.mimeType || '').toLowerCase();
  const inputExt = mime.includes('mp4') || mime.includes('m4a') ? '.m4a' : mime.includes('ogg') ? '.ogg' : '.webm';
  const stamp = `${Date.now()}-${process.pid}`;
  const inputPath = path.join(app.getPath('temp'), `voice-enrollment-${stamp}${inputExt}`);
  const wavPath = path.join(app.getPath('temp'), `voice-enrollment-${stamp}.wav`);
  fs.writeFileSync(inputPath, buffer);
  try {
    await runProcess(safeFfmpegPath(), ['-y', '-hide_banner', '-loglevel', 'error', '-i', inputPath, '-vn', '-ac', '1', '-ar', '16000', '-acodec', 'pcm_s16le', wavPath]);
    const result = await runAiWorkerQueued({
      task: 'speaker-embed',
      recordingName: 'My Voice profile',
      wavPath,
      cacheDir: path.join(app.getPath('userData'), 'models'),
      embeddingModel: AUTO_SPEAKER_EMBEDDING_MODEL
    }, 10 * 60 * 1000);
    const embedding = Array.isArray(result?.embedding) ? result.embedding.map(Number).filter(Number.isFinite) : [];
    if (embedding.length < 16) throw new Error('Could not build a reliable voice profile from that sample. Please try again in a quiet moment.');
    const spectralFingerprint = Array.isArray(payload.spectralFingerprint) ? payload.spectralFingerprint.map(Number).filter(Number.isFinite).slice(0, 16) : [];
    return saveVoiceProfile({
      version: 1,
      createdAt: new Date().toISOString(),
      model: String(result?.model || AUTO_SPEAKER_EMBEDDING_MODEL),
      speechSeconds: Math.max(0, Number(result?.speechSeconds) || 0),
      embedding,
      spectralFingerprint
    });
  } finally {
    try { fs.rmSync(inputPath, { force: true }); } catch {}
    try { fs.rmSync(wavPath, { force: true }); } catch {}
  }
}

function speakerMetadataKey(recordingPath) {
  return path.resolve(String(recordingPath || ''));
}

function speakerMetadataEntry(metadata, recordingPath, fingerprint = '') {
  const key = speakerMetadataKey(recordingPath);
  if (metadata[key]) return { key, value: metadata[key], migrated: false };
  const legacyKey = path.basename(recordingPath);
  const legacy = metadata[legacyKey];
  if (legacy && (!fingerprint || legacy.audioFingerprint === fingerprint)) {
    metadata[key] = legacy;
    delete metadata[legacyKey];
    return { key, value: legacy, migrated: true };
  }
  return { key, value: null, migrated: false };
}

function migrateRecordingSpeakers(oldPath, newPath) {
  const metadata = loadSpeakerMetadata();
  const oldKey = speakerMetadataKey(oldPath);
  const newKey = speakerMetadataKey(newPath);
  const legacyOldKey = path.basename(oldPath);
  const value = metadata[oldKey] || metadata[legacyOldKey];
  if (value) {
    metadata[newKey] = value;
    delete metadata[oldKey];
    delete metadata[legacyOldKey];
    saveSpeakerMetadata(metadata);
  }
}

function removeRecordingSpeakers(recordingPath) {
  const metadata = loadSpeakerMetadata();
  const keys = [speakerMetadataKey(recordingPath), path.basename(recordingPath)];
  let changed = false;
  for (const key of keys) if (metadata[key]) { delete metadata[key]; changed = true; }
  if (changed) saveSpeakerMetadata(metadata);
}

function recordingAudioFingerprint(recordingPath) {
  const stat = fs.statSync(recordingPath);
  return `${stat.size}:${Math.round(stat.mtimeMs)}`;
}

function aiWorkerLogPath() {
  return path.join(app.getPath('userData'), 'ai-worker.log');
}

function appendAiWorkerLog(message) {
  try {
    fs.mkdirSync(path.dirname(aiWorkerLogPath()), { recursive: true });
    fs.appendFileSync(aiWorkerLogPath(), `[${new Date().toISOString()}] ${String(message || '').trim()}\n`, 'utf8');
  } catch {}
}

const aiWorkerManager = new AiWorkerManager({
  utilityProcess,
  workerPath: path.join(__dirname, 'ai-worker.js'),
  cwd: __dirname,
  env: {
    OMP_NUM_THREADS: '2',
    ORT_NUM_THREADS: '2',
    UV_THREADPOOL_SIZE: '4'
  },
  onStatus: (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('ai:status', status);
  },
  onLog: appendAiWorkerLog
});

const localModelManager = new LocalModelManager({
  cacheDir: () => path.join(app.getPath('userData'), 'models'),
  aiWorkerManager
});

function recordingProcessMetrics() {
  try {
    return app.getAppMetrics().map((metric) => ({
      pid: metric.pid,
      type: metric.type,
      cpu: Number(metric.cpu?.percentCPUUsage || 0).toFixed(2),
      workingSetKb: Number(metric.memory?.workingSetSize || 0),
      peakWorkingSetKb: Number(metric.memory?.peakWorkingSetSize || 0),
      privateBytesKb: Number(metric.memory?.privateBytes || 0)
    }));
  } catch {
    return [];
  }
}

function logRecordingPerformanceSnapshot(reason = 'interval') {
  activityLog('info', 'recording.performance', {
    reason,
    recordingActive: recordingCaptureActive,
    activeBytesWritten,
    activeMicBytesWritten,
    activeNeuralMicBytesWritten,
    sealedSessions: sealedRecordingSessions.size,
    ai: aiWorkerManager.snapshot(),
    processes: recordingProcessMetrics()
  });
}

function setRecordingResourcePriority(active, reason = '') {
  recordingCaptureActive = Boolean(active);
  aiWorkerManager.setPaused(recordingCaptureActive, recordingCaptureActive ? 'Paused while a recording is active' : '');
  clearInterval(recordingPerformanceLogTimer);
  recordingPerformanceLogTimer = null;
  if (recordingCaptureActive) {
    logRecordingPerformanceSnapshot(reason || 'recording-start');
    recordingPerformanceLogTimer = setInterval(() => logRecordingPerformanceSnapshot('recording-heartbeat'), 30000);
    recordingPerformanceLogTimer.unref?.();
  } else {
    logRecordingPerformanceSnapshot(reason || 'recording-stop');
  }
  activityLog('info', 'recording.resource-priority', { active: recordingCaptureActive, reason: String(reason || '') });
}


function runAiWorkerQueued(payload, timeoutMs, options = {}) {
  // Transcription is the primary AI result. Speaker detection is secondary and
  // meeting-note enhancement is intentionally lowest priority/manual-only.
  // Self-heal a stale AI pause only when no recording is active. This cannot change
  // the capture/cursor path; it only prevents a prior recording session from leaving
  // the local AI queue parked indefinitely after capture has already stopped.
  if (!recordingCaptureActive && aiWorkerManager.paused) {
    activityLog('warn', 'ai.stale-pause-cleared', { task: String(payload?.task || '') });
    aiWorkerManager.setPaused(false, '');
  }
  const priority = ({ transcribe: 100, vad: 80, 'speaker-embed': 70, 'speaker-embed-ranges': 60, diarize: 40, 'meeting-insights': 10, 'preload-model': 5 }[payload?.task] || 10);
  return aiWorkerManager.request(payload, timeoutMs, { ...options, priority });
}

function normalizeSpeakerSegments(rawSegments) {
  const ordered = (Array.isArray(rawSegments) ? rawSegments : [])
    .map((segment) => ({
      id: Number(segment?.id),
      start: Math.max(0, Number(segment?.start) || 0),
      end: Math.max(0, Number(segment?.end) || 0),
      confidence: Number.isFinite(Number(segment?.confidence)) ? Number(segment.confidence) : null
    }))
    .filter((segment) => Number.isFinite(segment.id) && segment.end > segment.start + 0.02)
    .sort((a, b) => a.start - b.start);
  const idMap = new Map();
  let next = 1;
  const normalized = ordered.map((segment) => {
    if (!idMap.has(segment.id)) idMap.set(segment.id, next++);
    return { ...segment, speaker: `Speaker ${idMap.get(segment.id)}` };
  });
  const merged = [];
  for (const segment of normalized) {
    const previous = merged[merged.length - 1];
    if (previous && previous.speaker === segment.speaker && segment.start - previous.end <= 0.18) {
      const prevDuration = Math.max(0.001, previous.end - previous.start);
      const curDuration = Math.max(0.001, segment.end - segment.start);
      previous.end = Math.max(previous.end, segment.end);
      if (previous.confidence != null && segment.confidence != null) {
        previous.confidence = ((previous.confidence * prevDuration) + (segment.confidence * curDuration)) / (prevDuration + curDuration);
      }
    } else {
      merged.push({ ...segment });
    }
  }
  return { segments: merged, speakerCount: idMap.size };
}

async function generateSpeakerDiarization(recordingPath, force = false) {
  const safe = safeRecordingPath(recordingPath);
  if (!fs.existsSync(safe)) throw new Error('Recording was not found.');
  const fingerprint = recordingAudioFingerprint(safe);
  const metadata = loadSpeakerMetadata();
  const located = speakerMetadataEntry(metadata, safe, fingerprint);
  const key = located.key;
  const cached = located.value;
  if (located.migrated) saveSpeakerMetadata(metadata);
  if (!force && cached && cached.version === 5 && cached.audioFingerprint === fingerprint && Array.isArray(cached.segments)) return applySpeakerCorrections(cached, cached.corrections || {});

  const wavPath = path.join(app.getPath('temp'), `auto-diarize-${Date.now()}-${process.pid}.wav`);
  try {
    await extractSpeechAudio(safe, wavPath, 'wav');
    const wavInfo = fs.statSync(wavPath);
    if (!wavInfo.size || wavInfo.size <= 44) {
      const empty = { version: 5, model: AUTO_DIARIZATION_MODEL, embeddingModel: AUTO_SPEAKER_EMBEDDING_MODEL, audioFingerprint: fingerprint, segments: [], speakerCount: 0, corrections: cached?.corrections || {}, voiceProfileUsed: Boolean(loadVoiceProfile()), generatedAt: new Date().toISOString() };
      metadata[key] = empty;
      saveSpeakerMetadata(metadata);
      return applySpeakerCorrections(empty, empty.corrections);
    }
    const workerResult = await runAiWorkerQueued({
      task: 'diarize',
      recordingName: path.basename(safe),
      recordingPath: safe,
      wavPath,
      cacheDir: path.join(app.getPath('userData'), 'models'),
      model: AUTO_DIARIZATION_MODEL,
      embeddingModel: AUTO_SPEAKER_EMBEDDING_MODEL,
      chunkSeconds: 10,
      overlapSeconds: 1,
      clusterThreshold: 0.72,
      maxSpeakers: 16,
      enrollmentEmbedding: loadVoiceProfile()?.embedding || null
    });
    throwIfRecordingProcessingCancelled(safe);
    const normalized = normalizeSpeakerSegments(workerResult?.segments || []);
    const corrections = {
      names: { ...((cached?.corrections?.names && typeof cached.corrections.names === 'object') ? cached.corrections.names : {}) },
      merges: { ...((cached?.corrections?.merges && typeof cached.corrections.merges === 'object') ? cached.corrections.merges : {}) }
    };
    const enrollmentRawId = Number(workerResult?.enrollmentSpeakerId);
    const enrollmentSimilarity = Number(workerResult?.enrollmentSimilarity);
    const enrolledSegment = Number.isInteger(enrollmentRawId) ? normalized.segments.find((segment) => Number(segment.id) === enrollmentRawId) : null;
    const enrollmentSpeaker = enrolledSegment?.speaker || '';
    if (enrollmentSpeaker && Number.isFinite(enrollmentSimilarity) && enrollmentSimilarity >= 0.56 && !corrections.names[enrollmentSpeaker]) {
      corrections.names[enrollmentSpeaker] = 'You';
    }
    const result = {
      version: 5,
      model: AUTO_DIARIZATION_MODEL,
      embeddingModel: AUTO_SPEAKER_EMBEDDING_MODEL,
      audioFingerprint: fingerprint,
      segments: normalized.segments,
      speakerCount: normalized.speakerCount,
      corrections,
      voiceProfileUsed: Boolean(loadVoiceProfile()),
      enrollmentSpeaker: enrollmentSpeaker || '',
      enrollmentSimilarity: Number.isFinite(enrollmentSimilarity) ? enrollmentSimilarity : null,
      generatedAt: new Date().toISOString()
    };
    metadata[key] = result;
    saveSpeakerMetadata(metadata);
    return applySpeakerCorrections(result, result.corrections);
  } finally {
    try { fs.unlinkSync(wavPath); } catch {}
  }
}

function getOrGenerateSpeakerDiarization(recordingPath, force = false) {
  const safe = safeRecordingPath(recordingPath);
  if (automaticDiarizationJobs.has(safe)) return automaticDiarizationJobs.get(safe);
  const job = recordingProcessingContext.run({ recordingPath: safe }, () => generateSpeakerDiarization(safe, force))
    .finally(() => automaticDiarizationJobs.delete(safe));
  automaticDiarizationJobs.set(safe, job);
  return job;
}

function updateRecordingSpeakerName(recordingPath, speaker, requestedName) {
  const safe = safeRecordingPath(recordingPath);
  const metadata = loadSpeakerMetadata();
  const located = speakerMetadataEntry(metadata, safe, recordingAudioFingerprint(safe));
  const key = located.key;
  const current = located.value;
  if (located.migrated) saveSpeakerMetadata(metadata);
  if (!current?.segments) throw new Error('Run speaker detection before naming speakers.');
  const speakerKey = normalizeSpeakerKey(speaker);
  const name = String(requestedName || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const corrections = { names: { ...(current.corrections?.names || {}) }, merges: { ...(current.corrections?.merges || {}) } };
  if (name && name.toLowerCase() !== speakerKey.toLowerCase()) corrections.names[speakerKey] = name;
  else delete corrections.names[speakerKey];
  current.corrections = corrections;
  metadata[key] = current;
  saveSpeakerMetadata(metadata);
  return applySpeakerCorrections(current, corrections);
}

function mergeRecordingSpeakerLabels(recordingPath, sourceSpeaker, targetSpeaker) {
  const safe = safeRecordingPath(recordingPath);
  const metadata = loadSpeakerMetadata();
  const located = speakerMetadataEntry(metadata, safe, recordingAudioFingerprint(safe));
  const key = located.key;
  const current = located.value;
  if (located.migrated) saveSpeakerMetadata(metadata);
  if (!current?.segments) throw new Error('Run speaker detection before merging speakers.');
  current.corrections = mergeSpeakerCorrections(current.corrections || {}, sourceSpeaker, targetSpeaker);
  metadata[key] = current;
  saveSpeakerMetadata(metadata);
  return applySpeakerCorrections(current, current.corrections);
}

function safeFfmpegPath() {
  if (!ffmpegPath) return null;
  return ffmpegPath.replace('app.asar', 'app.asar.unpacked');
}

let cachedFfmpegMajorVersion = null;
async function ffmpegMajorVersion(executable = safeFfmpegPath()) {
  if (Number.isInteger(cachedFfmpegMajorVersion) && cachedFfmpegMajorVersion > 0) return cachedFfmpegMajorVersion;
  if (!executable || !fs.existsSync(executable)) return 6;
  try {
    const result = await runProcess(executable, ['-version']);
    const text = `${result?.stdout || ''}
${result?.stderr || ''}`;
    const match = text.match(/ffmpeg version\s+(?:n)?(\d+)/i);
    const major = Number(match?.[1]);
    if (Number.isInteger(major) && major > 0) {
      cachedFfmpegMajorVersion = major;
      return major;
    }
  } catch {}
  // ffmpeg-static 5.2.0 used by this project ships FFmpeg 6.x. Prefer its residual
  // semantics if version probing ever fails rather than dropping the microphone.
  return 6;
}

function adaptiveNlmsResidualMode(majorVersion) {
  // FFmpeg 6: out_mode=n returns desired - estimated echo. FFmpeg 7+ changed the
  // mode semantics so out_mode=o is the residual. Choosing by major version avoids
  // the v0.2.102-v0.2.103 failure where unsupported out_mode=e forced direct mixing.
  return Number(majorVersion) >= 7 ? 'o' : 'n';
}

function processingCancellationError(recordingPath) {
  const error = new Error('Background processing was cancelled because the recording was deleted.');
  error.code = 'RECORDING_PROCESSING_CANCELLED';
  error.recordingPath = String(recordingPath || '');
  return error;
}

function throwIfRecordingProcessingCancelled(recordingPath) {
  const safe = recordingPath ? path.resolve(String(recordingPath)) : '';
  if (safe && cancelledRecordingProcessing.has(safe)) throw processingCancellationError(safe);
}

function registerRecordingProcessingChild(recordingPath, child) {
  const safe = recordingPath ? path.resolve(String(recordingPath)) : '';
  if (!safe || !child) return () => {};
  if (!activeRecordingProcessingChildren.has(safe)) activeRecordingProcessingChildren.set(safe, new Set());
  const children = activeRecordingProcessingChildren.get(safe);
  children.add(child);
  return () => {
    children.delete(child);
    if (!children.size) activeRecordingProcessingChildren.delete(safe);
  };
}

async function cancelBackgroundProcessingForRecording(recordingPath) {
  const safe = safeRecordingPath(recordingPath);
  cancelledRecordingProcessing.add(safe);
  const cancelledAiJobs = aiWorkerManager.cancelWhere((job) => {
    const candidate = String(job?.payload?.recordingPath || '');
    return candidate && path.resolve(candidate) === safe;
  });
  const children = [...(activeRecordingProcessingChildren.get(safe) || [])];
  for (const child of children) { try { child.kill('SIGTERM'); } catch {} }
  activityLog('info', 'recording.processing-cancel-requested', {
    recording: path.basename(safe),
    aiJobs: cancelledAiJobs,
    childProcesses: children.length
  });
  const pending = [
    automaticTranscriptionJobs.get(safe),
    automaticDiarizationJobs.get(safe),
    automaticInsightsJobs.get(safe)
  ].filter(Boolean);
  if (pending.length) {
    await Promise.race([
      Promise.allSettled(pending),
      new Promise((resolve) => setTimeout(resolve, 1800))
    ]);
  }
  return { cancelledAiJobs, childProcesses: children.length };
}

function runProcess(command, args, options = {}) {
  const recoveryTask = Boolean(recoveryProcessContext.getStore()?.recoveryTask);
  const processingRecordingPath = recordingProcessingContext.getStore()?.recordingPath
    ? path.resolve(String(recordingProcessingContext.getStore().recordingPath))
    : '';
  const startedAt = Date.now();
  const commandName = path.basename(String(command || 'process'));
  const loggedArgs = (Array.isArray(args) ? args : []).map((value) => {
    const text = String(value ?? '');
    if (!text) return text;
    // Keep technical switches and basenames while avoiding large absolute user paths
    // in the routine log. Output/input filenames are still enough to correlate stages.
    if (path.isAbsolute(text)) return path.basename(text);
    return text.length > 320 ? `${text.slice(0, 317)}...` : text;
  });
  activityLog('info', 'process.start', { command: commandName, args: loggedArgs, recoveryTask });
  return new Promise((resolve, reject) => {
    if (recoveryTask && recoveryCancelRequested) return reject(recoveryCancellationError());
    if (processingRecordingPath && cancelledRecordingProcessing.has(processingRecordingPath)) return reject(processingCancellationError(processingRecordingPath));
    const child = spawn(command, args, { windowsHide: true, ...options });
    if (recoveryTask) activeRecoveryChildren.add(child);
    const unregisterProcessingChild = registerRecordingProcessingChild(processingRecordingPath, child);
    let stdout = '';
    let stderr = '';
    let settled = false;
    const cleanup = () => { if (recoveryTask) activeRecoveryChildren.delete(child); unregisterProcessingChild(); };
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      activityLog('error', 'process.failed', { command: commandName, durationMs: Date.now() - startedAt, error, stderrTail: stderr.slice(-4000), stdoutTail: stdout.slice(-1500) });
      reject(error);
    };
    const resolveOnce = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      activityLog('info', 'process.complete', { command: commandName, durationMs: Date.now() - startedAt, stderrTail: stderr.slice(-1200) });
      resolve(value);
    };
    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (error) => rejectOnce(recoveryTask && recoveryCancelRequested ? recoveryCancellationError() : error));
    child.on('close', (code) => {
      if (recoveryTask && recoveryCancelRequested) return rejectOnce(recoveryCancellationError());
      if (processingRecordingPath && cancelledRecordingProcessing.has(processingRecordingPath)) return rejectOnce(processingCancellationError(processingRecordingPath));
      if (code === 0) resolveOnce({ stdout, stderr });
      else rejectOnce(new Error(stderr || stdout || `Process exited with code ${code}`));
    });
  });
}


const videoEncoderManager = new VideoEncoderManager({
  ffmpegPath: safeFfmpegPath(),
  runProcess,
  platform: process.platform
});

async function closeActiveStream() {
  if (!activeWriteStream) return;
  const stream = activeWriteStream;
  activeWriteStream = null;
  await new Promise((resolve, reject) => {
    stream.once('error', reject);
    stream.end(resolve);
  });
}

async function closeActiveMicStream() {
  if (!activeMicWriteStream) return;
  const stream = activeMicWriteStream;
  activeMicWriteStream = null;
  await new Promise((resolve, reject) => {
    stream.once('error', reject);
    stream.end(resolve);
  });
}

async function closeActiveNeuralMicStream() {
  if (!activeNeuralMicWriteStream) return;
  const stream = activeNeuralMicWriteStream;
  activeNeuralMicWriteStream = null;
  await new Promise((resolve, reject) => {
    stream.once('error', reject);
    stream.end(resolve);
  });
}

function resetActiveRecordingState({ clearJournal = true } = {}) {
  activeTempPath = null;
  activeMimeType = null;
  activeMicTempPath = null;
  activeMicMimeType = null;
  activeMicNoiseMode = 'off';
  activeMicBytesWritten = 0;
  activeNeuralMicTempPath = null;
  activeNeuralMicMimeType = null;
  activeNeuralMicMethod = 'none';
  activeNeuralMicBytesWritten = 0;
  activeRecordingKind = 'video';
  activeRecordingMeta = {};
  activeBytesWritten = 0;
  activeRecordingHealth = { startedAt: 0, lastChunkAt: 0, lastMicChunkAt: 0, lastNeuralMicChunkAt: 0, lastWriteError: '', lastMicWriteError: '', lastNeuralMicWriteError: '' };
  applicationAudioTempPath = null;
  applicationAudioWindowTitle = '';
  applicationAudioSourceId = '';
  applicationAudioSegments = [];
  if (clearJournal) clearRecoveryJournal();
}

function preserveActiveRecordingForRecovery(reason, extra = {}) {
  const journal = writeRecoveryJournal({
    status: 'finalization_failed',
    failureReason: String(reason || ''),
    ...extra
  }, true) || readRecoveryJournal();
  const preserved = journal?.tempPath ? createPendingRecovery(recoveryDirectory(), journal, reason) : null;
  if (preserved) clearRecoveryJournal();
  return preserved;
}


async function sealActiveRecordingForFinalization(meta = {}) {
  await closeActiveStream();
  await closeActiveMicStream();
  await closeActiveNeuralMicStream();
  if (!activeTempPath || !fs.existsSync(activeTempPath)) throw new Error('Recording data was not found.');

  const activeJournal = writeRecoveryJournal({ status: 'finalizing' }, true) || readRecoveryJournal() || {};
  const kind = meta.recordingKind === 'audio' || activeRecordingKind === 'audio' ? 'audio' : 'video';
  const combinedMeta = { ...activeRecordingMeta, ...(meta || {}), recordingKind: kind };
  lastRecordingDiagnosticMeta = { ...combinedMeta, sealedAt: new Date().toISOString(), recordingHealth: recordingHealthSnapshot() };
  const outputPath = reserveNextRecordingPath({
    recordingKind: kind,
    filenameTemplate: meta.filenameTemplate || activeFilenameTemplate,
    meta: combinedMeta
  });
  const recoverySnapshotValue = {
    version: 2,
    tempPath: activeTempPath,
    mimeType: activeMimeType,
    recordingKind: kind,
    filenameTemplate: meta.filenameTemplate || activeFilenameTemplate,
    meta: combinedMeta,
    bytesWritten: activeBytesWritten,
    applicationAudioPaths: [...new Set([...applicationAudioSegments, applicationAudioTempPath, meta.applicationAudioPath].filter(Boolean))],
    microphonePath: activeMicTempPath || null,
    microphoneMimeType: activeMicMimeType || null,
    microphoneNoiseMode: meta.microphoneNoiseMode || activeMicNoiseMode || activeRecordingMeta.noiseReduction || 'off',
    microphoneBytesWritten: activeMicBytesWritten || 0,
    neuralMicrophonePath: activeNeuralMicTempPath || null,
    neuralMicrophoneMimeType: activeNeuralMicMimeType || null,
    neuralMicrophoneMethod: meta.neuralMicrophoneMethod || activeNeuralMicMethod || activeRecordingMeta.neuralMicrophoneMethod || 'none',
    neuralMicrophoneBytesWritten: activeNeuralMicBytesWritten || 0,
    createdAt: activeJournal.createdAt || Date.now(),
    updatedAt: Date.now(),
    status: 'finalizing'
  };
  const pending = createPendingRecovery(recoveryDirectory(), recoverySnapshotValue, 'Recording finalization was interrupted.');
  const sessionId = pending?.id || `${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2, 8)}`;
  const sealed = {
    id: sessionId,
    outputPath,
    recordingKind: kind,
    tempPath: activeTempPath,
    mimeType: activeMimeType,
    microphonePath: activeMicTempPath || null,
    microphoneMimeType: activeMicMimeType || null,
    microphoneNoiseMode: recoverySnapshotValue.microphoneNoiseMode,
    neuralMicrophonePath: activeNeuralMicTempPath || null,
    neuralMicrophoneMimeType: activeNeuralMicMimeType || null,
    neuralMicrophoneMethod: recoverySnapshotValue.neuralMicrophoneMethod,
    meta: combinedMeta,
    pendingManifestPath: pending?.manifestPath || null,
    recoverySnapshot: pending?.manifest || recoverySnapshotValue
  };
  sealedRecordingSessions.set(sessionId, sealed);

  // The just-stopped capture is now represented by its own recovery manifest and no
  // longer owns the global active-recording slot. A new capture can begin immediately
  // while this sealed recording is transcoded/mixed in the background.
  resetActiveRecordingState();
  return { sessionId, outputPath, recordingKind: kind, durationMs: Number(meta.durationMs) || 0 };
}

function updateSealedRecoveryManifest(sealed, extra = {}) {
  if (!sealed?.pendingManifestPath) return;
  try {
    atomicWriteJson(sealed.pendingManifestPath, {
      ...(sealed.recoverySnapshot || {}),
      status: 'finalization_failed',
      failureReason: String(extra.failureReason || sealed.recoverySnapshot?.failureReason || ''),
      ...extra,
      updatedAt: Date.now()
    });
  } catch {}
}

async function finalizeSealedRecording(sessionId) {
  const key = String(sessionId || '');
  const sealed = sealedRecordingSessions.get(key);
  if (!sealed) throw new Error('The stopped recording is no longer available for finalization.');
  const meta = { ...(sealed.meta || {}) };
  const kind = sealed.recordingKind === 'audio' ? 'audio' : 'video';
  const outputPath = sealed.outputPath;
  const requestedVideoCodec = normalizeVideoCodec(meta.videoCodec || 'h264');
  let videoCodec = requestedVideoCodec;
  const runtimeMarkers = normalizeMarkers(meta.markers || []);

  try {
    if (kind === 'audio') {
      await transcodeToM4a(sealed.tempPath, outputPath);
    } else if (requestedVideoCodec === 'h264' && sealed.mimeType?.includes('mp4')) {
      // Never publish the raw chunk-appended MediaRecorder MP4 directly. Chromium's
      // fragmented MP4 output can be structurally complete enough to have bytes yet
      // still be rejected by the HTML5 player. Remux it into a normal fast-start MP4
      // and fall back to a full transcode only when stream-copy repair is impossible.
      try {
        meta.videoEncoding = await remuxMediaRecorderMp4(sealed.tempPath, outputPath);
      } catch (remuxError) {
        appendAiWorkerLog(`MediaRecorder MP4 remux failed; transcoding instead: ${remuxError.message || remuxError}`);
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
        meta.videoEncoding = await transcodeToMp4(sealed.tempPath, outputPath, videoCodec);
      }
    } else if (requestedVideoCodec === 'h265') {
      // HEVC is an output preference, not the live capture codec. Never make a normal
      // Stop wait on a very slow software x265 pass. Use hardware HEVC when available;
      // otherwise keep/publish H.264. MP4 capture can be remuxed with no video re-encode;
      // WebM capture falls back to the much faster H.264 encode path.
      const capabilities = await videoEncoderManager.probe();
      if (capabilities.h265) {
        meta.videoEncoding = await transcodeToMp4(sealed.tempPath, outputPath, 'h265');
      } else {
        meta.videoEncoding = sealed.mimeType?.includes('mp4')
          ? await remuxMediaRecorderMp4(sealed.tempPath, outputPath)
          : await transcodeToMp4(sealed.tempPath, outputPath, 'h264');
        meta.videoCodecFallback = 'h264';
        videoCodec = 'h264';
        activityLog('warn', 'recording.hevc-fast-save-fallback', { outputFile: path.basename(outputPath), reason: 'hardware-hevc-unavailable', sourceMimeType: sealed.mimeType || '' });
      }
    } else {
      meta.videoEncoding = await transcodeToMp4(sealed.tempPath, outputPath, requestedVideoCodec);
    }
    if (meta.applicationAudioPath) await mergeApplicationAudio(outputPath, meta.applicationAudioPath, kind, false);
    if (sealed.microphonePath && fs.existsSync(sealed.microphonePath) && fs.statSync(sealed.microphonePath).size >= 128 && Array.isArray(meta.voiceHighlights) && meta.voiceHighlights.length) {
      try {
        const refinedVoiceHighlights = await refineVoiceHighlightsAgainstReference({
          ffmpegPath: safeFfmpegPath(),
          micPath: sealed.microphonePath,
          referencePath: outputPath,
          segments: meta.voiceHighlights,
          durationSeconds: Math.max(0, Number(meta.durationMs) || 0) / 1000,
          microphoneStartOffsetMs: Math.max(0, Number(meta.microphoneStartOffsetMs || sealed.meta?.microphoneStartOffsetMs) || 0)
        });
        if (refinedVoiceHighlights.analyzed) {
          meta.voiceHighlights = refinedVoiceHighlights.segments;
          meta.voiceHighlightMethod = 'mic-system-readonly-v4';
          activityLog('info', 'recording.voice-highlights-refined', {
            outputFile: path.basename(outputPath),
            inputCount: Number(meta.voiceHighlights?.length || 0) + Number(refinedVoiceHighlights.rejected || 0),
            outputCount: Number(refinedVoiceHighlights.segments?.length || 0),
            rejectedSpeakerLeakSections: Number(refinedVoiceHighlights.rejected || 0)
          });
        }
      } catch (error) {
        activityLog('warn', 'recording.voice-highlights-refine-failed', { outputFile: path.basename(outputPath), error });
      }
    }
    if (sealed.microphonePath && fs.existsSync(sealed.microphonePath) && fs.statSync(sealed.microphonePath).size >= 128) {
      meta.microphoneCleanup = await postProcessAndMixMicrophone(
        outputPath,
        sealed.microphonePath,
        kind,
        meta.microphoneNoiseMode || sealed.microphoneNoiseMode || 'enhanced',
        Math.max(0, Number(meta.durationMs) || 0) / 1000,
        false,
        sealed.neuralMicrophonePath,
        meta.neuralMicrophoneMethod || sealed.neuralMicrophoneMethod || 'none',
        path.basename(outputPath),
        Math.max(0, Number(meta.microphoneStartOffsetMs || sealed.meta?.microphoneStartOffsetMs) || 0)
      );
    }
    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1024) throw new Error('Final output validation failed: saved file is empty or missing.');
    if (kind === 'video') await validatePlayableVideoFile(outputPath);
    if (runtimeMarkers.length) {
      const savedMarkers = saveMarkersForRecording(outputPath, runtimeMarkers);
      meta.markerCount = savedMarkers.length;
      activityLog('info', 'recording.markers-persisted', { outputFile: path.basename(outputPath), markerCount: savedMarkers.length });
    } else meta.markerCount = 0;
    const runtimeVoiceHighlights = normalizeVoiceHighlights(meta.voiceHighlights || [], Math.max(0, Number(meta.durationMs) || 0) / 1000);
    if (runtimeVoiceHighlights.length) {
      const savedVoiceHighlights = saveVoiceHighlightsForRecording(outputPath, runtimeVoiceHighlights, {
        durationSeconds: Math.max(0, Number(meta.durationMs) || 0) / 1000,
        method: meta.voiceHighlightMethod || 'mic-system-readonly'
      });
      meta.voiceHighlightCount = savedVoiceHighlights.length;
      activityLog('info', 'recording.voice-highlights-persisted', { outputFile: path.basename(outputPath), count: savedVoiceHighlights.length, method: meta.voiceHighlightMethod || 'mic-system-readonly' });
    } else meta.voiceHighlightCount = 0;

    if (meta.applicationAudioPath) { try { if (fs.existsSync(meta.applicationAudioPath)) fs.unlinkSync(meta.applicationAudioPath); } catch {} }
    if (sealed.microphonePath) { try { if (fs.existsSync(sealed.microphonePath)) fs.unlinkSync(sealed.microphonePath); } catch {} }
    if (sealed.neuralMicrophonePath) { try { if (fs.existsSync(sealed.neuralMicrophonePath)) fs.unlinkSync(sealed.neuralMicrophonePath); } catch {} }
  } catch (error) {
    let partialOutputPath = null;
    try {
      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
        partialOutputPath = path.join(recoveryDirectory(), `partial-output-${Date.now()}${path.extname(outputPath) || '.mp4'}`);
        fs.renameSync(outputPath, partialOutputPath);
      }
    } catch {}
    updateSealedRecoveryManifest(sealed, {
      failureReason: error.message,
      attemptedOutputPath: outputPath,
      partialOutputPath,
      applicationAudioPaths: [...new Set([...(sealed.recoverySnapshot?.applicationAudioPaths || []), meta.applicationAudioPath].filter(Boolean))],
      meta: { ...(sealed.meta || {}), ...(meta || {}), recordingKind: kind, videoCodec }
    });
    sealedRecordingSessions.delete(key);
    releaseReservedRecordingPath(outputPath);
    const recoveryNote = sealed.pendingManifestPath
      ? ` Recovery copy protected (${sealed.id}); it will be retried automatically on next launch.`
      : ' The source capture was left in the recovery folder.';
    throw new Error(`Could not create ${kind === 'audio' ? 'M4A' : 'MP4'} in ${path.dirname(outputPath)}: ${error.message}.${recoveryNote}`);
  }

  lastRecordingPath = outputPath;
  try { fs.unlinkSync(sealed.tempPath); } catch {}
  if (sealed.pendingManifestPath) { try { fs.unlinkSync(sealed.pendingManifestPath); } catch {} }
  sealedRecordingSessions.delete(key);
  releaseReservedRecordingPath(outputPath);

  // Transcription belongs to the saved recording, not to Playback UI selection.
  // Queue it from the main process as soon as the recording is finalized. The AI
  // worker is automatically paused whenever another recording is active, so this
  // runs only while the recorder is otherwise free and resumes without requiring the
  // user to switch from Mini to Full View or click the clip.
  setTimeout(() => {
    ensureAutomaticTranscriptionJob(outputPath, false).catch((error) => {
      appendAiWorkerLog(`Automatic background transcription failed for ${path.basename(outputPath)}: ${error?.message || error}`);
    });
  }, 0);

  lastRecordingDiagnosticMeta = {
    ...lastRecordingDiagnosticMeta,
    ...meta,
    outputPath,
    finalizedAt: new Date().toISOString(),
    microphoneCleanup: meta.microphoneCleanup || null,
    markerCount: Number(meta.markerCount) || 0,
    voiceHighlightCount: Number(meta.voiceHighlightCount) || 0,
    videoEncoding: meta.videoEncoding || null
  };

  return {
    canceled: false,
    path: outputPath,
    directory: path.dirname(outputPath),
    durationMs: meta.durationMs || 0,
    recordingKind: kind,
    videoCodec: kind === 'video' ? videoCodec : null,
    requestedVideoCodec: kind === 'video' ? requestedVideoCodec : null,
    videoCodecFallback: meta.videoCodecFallback || null,
    videoEncoding: meta.videoEncoding || null,
    microphoneCleanup: meta.microphoneCleanup || null,
    markerCount: Number(meta.markerCount) || 0,
    voiceHighlightCount: Number(meta.voiceHighlightCount) || 0
  };
}

function normalizeVideoCodec(value) {
  return String(value || '').toLowerCase() === 'h265' ? 'h265' : 'h264';
}

function videoEncodingArgs(codec, preferHardware = true) {
  return videoEncoderManager.args(normalizeVideoCodec(codec), preferHardware).args;
}

function audioEncodingArgs(format = 'm4a') {
  return String(format).toLowerCase() === 'mp3'
    ? ['-c:a', 'libmp3lame', '-b:a', '192k']
    : ['-c:a', 'aac', '-b:a', '192k'];
}

async function transcodeToMp4(inputPath, outputPath, videoCodec = 'h264') {
  const executable = safeFfmpegPath();
  if (!executable || !fs.existsSync(executable)) throw new Error('FFmpeg binary was not found. Run npm install again on this computer.');
  const codec = normalizeVideoCodec(videoCodec);
  await videoEncoderManager.probe();
  const choice = videoEncoderManager.args(codec, true);
  const run = (encodingArgs) => runProcess(executable, [
    '-y', '-i', inputPath,
    ...encodingArgs,
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart', outputPath
  ]);
  if (choice.hardware) {
    try {
      await run(choice.args);
      return { encoder: choice.encoder, hardware: true };
    } catch (error) {
      videoEncoderManager.markFailed(choice.encoder);
      appendAiWorkerLog(`Hardware video encoder ${choice.encoder} failed; falling back to software: ${error.message || error}`);
      try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
    }
  }
  await run(videoEncoderManager.args(codec, false).args);
  return { encoder: codec === 'h265' ? 'libx265' : 'libx264', hardware: false };
}

async function validatePlayableVideoFile(filePath) {
  const executable = safeFfmpegPath();
  if (!executable || !fs.existsSync(executable)) throw new Error('FFmpeg binary was not found. Run npm install again on this computer.');
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size < 1024) throw new Error('Saved video is empty or missing.');
  // Decode one actual frame. A size check alone allowed malformed fragmented MP4
  // files to be treated as successfully saved in v0.2.88.
  await runProcess(executable, ['-v', 'error', '-i', filePath, '-map', '0:v:0', '-frames:v', '1', '-f', 'null', '-']);
  return true;
}

async function remuxMediaRecorderMp4(inputPath, outputPath) {
  const executable = safeFfmpegPath();
  if (!executable || !fs.existsSync(executable)) throw new Error('FFmpeg binary was not found. Run npm install again on this computer.');
  await runProcess(executable, [
    '-y', '-fflags', '+genpts', '-i', inputPath,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-c', 'copy', '-avoid_negative_ts', 'make_zero',
    '-movflags', '+faststart', outputPath
  ]);
  await validatePlayableVideoFile(outputPath);
  return { encoder: 'MediaRecorder H.264 remux', hardware: false, passthrough: true, remuxed: true };
}

async function transcodeToM4a(inputPath, outputPath, recovery = false) {
  const executable = safeFfmpegPath();
  if (!executable || !fs.existsSync(executable)) throw new Error('FFmpeg binary was not found. Run npm install again on this computer.');
  const recoveryArgs = recovery ? ['-fflags', '+genpts+discardcorrupt', '-err_detect', 'ignore_err'] : [];
  await runProcess(executable, ['-y', ...recoveryArgs, '-i', inputPath, '-vn', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outputPath]);
}

async function transcodeRecoveredVideo(inputPath, outputPath, videoCodec = 'h264') {
  const executable = safeFfmpegPath();
  if (!executable || !fs.existsSync(executable)) throw new Error('FFmpeg binary was not found. Run npm install again on this computer.');
  const codec = normalizeVideoCodec(videoCodec);
  await videoEncoderManager.probe();
  const choice = videoEncoderManager.args(codec, true);
  const run = (encodingArgs) => runProcess(executable, [
    '-y', '-fflags', '+genpts+discardcorrupt', '-err_detect', 'ignore_err', '-i', inputPath,
    '-map', '0:v:0?', '-map', '0:a:0?', ...encodingArgs,
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outputPath
  ]);
  if (choice.hardware) {
    try { await run(choice.args); return; }
    catch (error) {
      if (isRecoveryCancellationError(error)) throw error;
      videoEncoderManager.markFailed(choice.encoder);
      try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
    }
  }
  await run(videoEncoderManager.args(codec, false).args);
}

async function fileHasAudioStream(filePath) {
  const executable = safeFfmpegPath();
  if (!executable || !fs.existsSync(executable)) return false;
  try {
    const result = await runProcess(executable, ['-hide_banner', '-i', filePath, '-map', '0:a:0?', '-f', 'null', '-']);
    return /Audio:/i.test(result.stderr || '');
  } catch (error) {
    return /Audio:/i.test(String(error.message || ''));
  }
}

async function videoCodecForRecording(filePath) {
  const executable = safeFfmpegPath();
  if (!executable || !fs.existsSync(executable)) return 'h264';
  return new Promise((resolve) => {
    const child = spawn(executable, ['-hide_banner', '-i', filePath], { windowsHide: true });
    let stderr = '';
    child.stderr?.on('data', (data) => { stderr += data.toString(); });
    const finish = () => resolve(/Video:\s*hevc\b/i.test(stderr) || /Video:\s*h265\b/i.test(stderr) ? 'h265' : 'h264');
    child.on('error', () => resolve('h264'));
    child.on('close', finish);
  });
}

function validApplicationAudioPath(filePath) {
  if (!filePath) return null;
  const root = path.resolve(recoveryDirectory());
  const candidate = path.resolve(String(filePath));
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return null;
  if (!fs.existsSync(candidate) || fs.statSync(candidate).size < 128) return null;
  return candidate;
}

async function mergeApplicationAudio(basePath, appAudioPath, recordingKind = 'video', deleteSourceOnSuccess = true) {
  const appAudio = validApplicationAudioPath(appAudioPath);
  if (!appAudio) return basePath;
  const executable = safeFfmpegPath();
  if (!executable || !fs.existsSync(executable)) throw new Error('FFmpeg is unavailable for application-audio mixing.');
  const hasBaseAudio = await fileHasAudioStream(basePath);
  const ext = recordingKind === 'audio' ? 'm4a' : 'mp4';
  const merged = path.join(path.dirname(basePath), `.${path.basename(basePath, path.extname(basePath))}.app-audio-${Date.now()}.${ext}`);
  let mergedSuccessfully = false;
  try {
    if (recordingKind === 'audio') {
      if (hasBaseAudio) {
        await runProcess(executable, ['-y', '-i', basePath, '-i', appAudio, '-filter_complex', '[0:a:0][1:a:0]amix=inputs=2:duration=longest:dropout_transition=2:normalize=0[a]', '-map', '[a]', '-c:a', 'aac', '-b:a', '192k', merged]);
      } else {
        await runProcess(executable, ['-y', '-i', appAudio, '-vn', '-c:a', 'aac', '-b:a', '192k', merged]);
      }
    } else if (hasBaseAudio) {
      await runProcess(executable, ['-y', '-i', basePath, '-i', appAudio, '-filter_complex', '[0:a:0][1:a:0]amix=inputs=2:duration=longest:dropout_transition=2:normalize=0[a]', '-map', '0:v:0', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', merged]);
    } else {
      await runProcess(executable, ['-y', '-i', basePath, '-i', appAudio, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', merged]);
    }
    if (!fs.existsSync(merged) || fs.statSync(merged).size < 128) throw new Error('Application-audio mix did not create a valid output.');
    fs.unlinkSync(basePath);
    fs.renameSync(merged, basePath);
    mergedSuccessfully = true;
  } finally {
    try { if (fs.existsSync(merged)) fs.unlinkSync(merged); } catch {}
    // Keep the native helper audio if mixing fails so the recovery journal can retry it next launch.
    if (mergedSuccessfully && deleteSourceOnSuccess) { try { fs.unlinkSync(appAudio); } catch {} }
  }
  return basePath;
}


function normalizeMicNoiseMode(value) {
  const mode = String(value || '').toLowerCase();
  return ['off', 'standard', 'enhanced', 'strong'].includes(mode) ? mode : 'enhanced';
}

function validMicrophoneRecoveryPath(filePath) {
  if (!filePath) return null;
  const root = path.resolve(recoveryDirectory());
  const candidate = path.resolve(String(filePath));
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return null;
  if (!fs.existsSync(candidate) || fs.statSync(candidate).size < 128) return null;
  return candidate;
}

async function extractVadWav(inputPath, outputPath) {
  const executable = safeFfmpegPath();
  if (!executable || !fs.existsSync(executable)) throw new Error('FFmpeg is unavailable for microphone speech detection.');
  await runProcess(executable, ['-y', '-i', inputPath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', outputPath]);
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size <= 44) throw new Error('Microphone speech-detection audio was empty.');
  return outputPath;
}

function normalizeVadSpeechSegments(rawSegments, durationSeconds) {
  const duration = Math.max(0, Number(durationSeconds) || 0);
  const padded = (Array.isArray(rawSegments) ? rawSegments : [])
    .map((segment) => ({
      start: Math.max(0, (Number(segment?.start) || 0) - 0.14),
      end: Math.min(duration || Infinity, (Number(segment?.end) || 0) + 0.32),
      confidence: Number.isFinite(Number(segment?.confidence)) ? Number(segment.confidence) : null
    }))
    .filter((segment) => segment.end > segment.start + 0.04)
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const segment of padded) {
    const previous = merged[merged.length - 1];
    if (previous && segment.start <= previous.end + 0.20) {
      previous.end = Math.max(previous.end, segment.end);
      if (previous.confidence != null && segment.confidence != null) previous.confidence = Math.max(previous.confidence, segment.confidence);
    } else merged.push({ ...segment });
  }
  return merged.slice(0, 900);
}

function microphoneNoiseCalibrationWindow(vadSegments, durationSeconds) {
  const duration = Math.max(0, Number(durationSeconds) || 0);
  if (duration <= 0) return { start: 0, duration: 1.0 };
  const speech = normalizeVadSpeechSegments(vadSegments, duration);
  const gaps = [];
  let cursor = 0;
  for (const segment of speech) {
    if (segment.start > cursor + 0.30) gaps.push({ start: cursor, end: segment.start });
    cursor = Math.max(cursor, segment.end);
  }
  if (cursor < duration - 0.30) gaps.push({ start: cursor, end: duration });
  const useful = gaps
    .map((gap) => ({ ...gap, length: gap.end - gap.start }))
    .filter((gap) => gap.length >= 0.35)
    .sort((a, b) => {
      const aEarly = a.start <= Math.min(15, duration * 0.35) ? 0.45 : 0;
      const bEarly = b.start <= Math.min(15, duration * 0.35) ? 0.45 : 0;
      return (b.length + bEarly) - (a.length + aEarly);
    });
  const selected = useful[0];
  if (!selected) return { start: 0, duration: Math.min(1.2, duration) };
  const length = Math.min(2.0, selected.length);
  return { start: Math.max(0, selected.start + Math.max(0, (selected.length - length) / 2)), duration: length };
}

function parseLastRmsDb(stderr) {
  const matches = [...String(stderr || '').matchAll(/RMS level dB:\s*(-?\d+(?:\.\d+)?|-inf)/gi)];
  if (!matches.length) return -80;
  const raw = matches[matches.length - 1][1].toLowerCase();
  if (raw === '-inf') return -80;
  const value = Number(raw);
  return Number.isFinite(value) ? value : -80;
}

async function measureAudioBandRms(filePath, lowHz, highHz, window) {
  const executable = safeFfmpegPath();
  if (!executable || !fs.existsSync(executable)) return -80;
  const args = ['-hide_banner', '-nostats'];
  if (window && Number.isFinite(window.start)) args.push('-ss', Math.max(0, window.start).toFixed(3));
  if (window && Number.isFinite(window.duration)) args.push('-t', Math.max(0.20, window.duration).toFixed(3));
  args.push('-i', filePath);
  const filters = [];
  if (lowHz > 0) filters.push(`highpass=f=${Math.round(lowHz)}`);
  if (highHz > 0) filters.push(`lowpass=f=${Math.round(highHz)}`);
  filters.push('astats=metadata=0:reset=0');
  args.push('-af', filters.join(','), '-f', 'null', '-');
  try {
    const result = await runProcess(executable, args);
    return parseLastRmsDb(result.stderr);
  } catch (error) {
    return parseLastRmsDb(error.message);
  }
}

async function analyzeMicrophoneWindProfile(filePath, vadSegments, durationSeconds) {
  const window = microphoneNoiseCalibrationWindow(vadSegments, durationSeconds);
  const [rumbleDb, fanDb, presenceDb] = await Promise.all([
    measureAudioBandRms(filePath, 65, 250, window),
    measureAudioBandRms(filePath, 250, 1050, window),
    measureAudioBandRms(filePath, 1200, 4800, window)
  ]);
  const lowTilt = rumbleDb - presenceDb;
  const fanTilt = fanDb - presenceDb;
  // Wind and close fan turbulence usually dominate the low and low-mid bands.
  // Ratios matter more than absolute level because microphone gain varies widely.
  const rawStrength = ((lowTilt + 4) / 16) * 0.42 + ((fanTilt + 3) / 14) * 0.58;
  const strength = Math.max(0, Math.min(1, rawStrength));
  return {
    strength,
    severe: strength >= 0.58,
    moderate: strength >= 0.28,
    rumbleDb,
    fanDb,
    presenceDb,
    calibrationStart: window.start,
    calibrationDuration: window.duration
  };
}

function parseAstatsRmsSeries(stderr) {
  const series = [];
  let pendingTime = null;
  for (const line of String(stderr || '').split(/\r?\n/)) {
    const timeMatch = line.match(/pts_time:([0-9.+\-eE]+)/);
    if (timeMatch) pendingTime = Number(timeMatch[1]);
    const rmsMatch = line.match(/lavfi\.astats\.Overall\.RMS_level=(-?\d+(?:\.\d+)?|-inf)/i);
    if (rmsMatch && Number.isFinite(pendingTime)) {
      const raw = rmsMatch[1].toLowerCase();
      const rmsDb = raw === '-inf' ? -120 : Number(raw);
      series.push({ time: pendingTime, rmsDb: Number.isFinite(rmsDb) ? rmsDb : -120 });
      pendingTime = null;
    }
  }
  return series;
}

async function measureAudioBandRmsSeries(filePath, lowHz = 220, highHz = 5200, windowSeconds = 0.5) {
  const executable = safeFfmpegPath();
  if (!executable || !fs.existsSync(executable)) return [];
  const samples = Math.max(8000, Math.round(48000 * Math.max(0.25, windowSeconds)));
  const filters = [
    'aresample=48000',
    `highpass=f=${Math.round(lowHz)}`,
    `lowpass=f=${Math.round(highHz)}`,
    `asetnsamples=n=${samples}:p=1`,
    'astats=metadata=1:reset=1',
    'ametadata=print:key=lavfi.astats.Overall.RMS_level'
  ];
  try {
    const result = await runProcess(executable, ['-hide_banner', '-nostats', '-i', filePath, '-vn', '-af', filters.join(','), '-f', 'null', '-']);
    return parseAstatsRmsSeries(result.stderr);
  } catch (error) {
    return parseAstatsRmsSeries(error.message || '');
  }
}

function timeWindowOverlapsSpeech(startSeconds, durationSeconds, segments) {
  const endSeconds = startSeconds + durationSeconds;
  return (segments || []).some((segment) => segment.end > startSeconds && segment.start < endSeconds);
}

async function assessMicrophoneSpeechPreservation(rawPath, cleanedPath, vadSegments = []) {
  // Compare the speech/intelligibility band in short windows. This is intentionally
  // independent of VAD for the catastrophic-loss check because a loud fan can make
  // VAD miss the very speech we are trying to protect.
  const windowSeconds = 0.5;
  const [rawSeries, cleanedSeries] = await Promise.all([
    // Use the voice-presence band for safety. A successful fan suppressor may remove
    // 15-30 dB of low/mid fan energy; comparing the whole 220-5200 Hz band would
    // incorrectly call that speech loss. 700-5200 Hz is much more sensitive to words,
    // consonants and formants while being far less dominated by direct fan turbulence.
    measureAudioBandRmsSeries(rawPath, 700, 5200, windowSeconds),
    measureAudioBandRmsSeries(cleanedPath, 700, 5200, windowSeconds)
  ]);
  const count = Math.min(rawSeries.length, cleanedSeries.length);
  let activeWindows = 0;
  let speechWindows = 0;
  let dangerousWindows = 0;
  let speechDangerWindows = 0;
  let worstDropDb = 0;
  let worstSpeechDropDb = 0;
  const deltas = [];

  for (let index = 0; index < count; index += 1) {
    const raw = rawSeries[index];
    const cleaned = cleanedSeries[index];
    // Ignore encoder warm-up and truly quiet windows where a dB ratio is unstable.
    if (raw.time < 0.75 || raw.rmsDb < -58) continue;
    const deltaDb = cleaned.rmsDb - raw.rmsDb;
    activeWindows += 1;
    deltas.push(deltaDb);
    worstDropDb = Math.min(worstDropDb, deltaDb);
    const speech = timeWindowOverlapsSpeech(raw.time, windowSeconds, vadSegments);
    if (speech) {
      speechWindows += 1;
      worstSpeechDropDb = Math.min(worstSpeechDropDb, deltaDb);
      if (deltaDb < -11.5) speechDangerWindows += 1;
    }
    if (deltaDb < -15.0) dangerousWindows += 1;
  }

  deltas.sort((a, b) => a - b);
  const medianDeltaDb = deltas.length ? deltas[Math.floor(deltas.length / 2)] : 0;
  // One isolated analysis-window mismatch can happen around an encoder boundary.
  // Consecutive/large drops or any VAD-confirmed speech drop are treated as unsafe.
  const safe = count > 0
    ? speechDangerWindows === 0 && dangerousWindows < 2 && worstDropDb > -22
    : true;
  return {
    safe,
    activeWindows,
    speechWindows,
    dangerousWindows,
    speechDangerWindows,
    worstDropDb: Number(worstDropDb.toFixed(2)),
    worstSpeechDropDb: Number(worstSpeechDropDb.toFixed(2)),
    medianDeltaDb: Number(medianDeltaDb.toFixed(2))
  };
}

async function assessMicrophoneNoiseControl(rawPath, cleanedPath, vadSegments = [], durationSeconds = 0) {
  const [rawProfile, cleanedProfile] = await Promise.all([
    analyzeMicrophoneWindProfile(rawPath, vadSegments, durationSeconds),
    analyzeMicrophoneWindProfile(cleanedPath, vadSegments, durationSeconds)
  ]);
  const rawTilt = ((rawProfile.rumbleDb - rawProfile.presenceDb) + (rawProfile.fanDb - rawProfile.presenceDb)) / 2;
  const cleanedTilt = ((cleanedProfile.rumbleDb - cleanedProfile.presenceDb) + (cleanedProfile.fanDb - cleanedProfile.presenceDb)) / 2;
  const improvementDb = rawTilt - cleanedTilt;
  const requiredDb = rawProfile.severe ? 4.0 : rawProfile.moderate ? 2.0 : 0;
  return {
    effective: requiredDb <= 0 || improvementDb >= requiredDb,
    requiredDb: Number(requiredDb.toFixed(2)),
    improvementDb: Number(improvementDb.toFixed(2)),
    rawTiltDb: Number(rawTilt.toFixed(2)),
    cleanedTiltDb: Number(cleanedTilt.toFixed(2)),
    rawStrength: Number(rawProfile.strength.toFixed(3)),
    cleanedStrength: Number(cleanedProfile.strength.toFixed(3))
  };
}

async function renderNeuralMicrophoneCandidate(neuralPath, rawPath, outputPath, mode, options = {}) {
  const executable = safeFfmpegPath();
  if (!executable || !fs.existsSync(executable)) throw new Error('FFmpeg is unavailable for processed microphone mastering.');
  const processed = validMicrophoneRecoveryPath(neuralPath);
  const raw = validMicrophoneRecoveryPath(rawPath);
  if (!processed) throw new Error('Speech-processed microphone candidate was not found.');
  const safetyBlend = Boolean(options.safetyBlend && raw);
  const profile = options.profile || { strength: 0, severe: false, moderate: false };
  const strength = Math.max(0, Math.min(1, Number(profile.strength) || 0));
  const method = String(options.method || '').toLowerCase();

  // v0.2.30 audio fix: v0.2.29 trusted DeepFilterNet as the whole solution, but the
  // supplied regression sample still contained overwhelming 30-700 Hz wind/fan energy.
  // Apply wind-aware cleanup only to the low/low-mid region after the speech processor.
  // The 700 Hz-5.2 kHz word/intelligibility band remains the speech-safety reference.
  const highPass = mode === 'strong'
    ? Math.round(95 + strength * 70)
    : Math.round(82 + strength * 55);
  const lowCut = mode === 'strong' ? -(3.0 + strength * 7.0) : -(1.8 + strength * 5.0);
  const midCut = mode === 'strong' ? -(1.5 + strength * 4.5) : -(0.8 + strength * 3.2);
  const upperLowCut = mode === 'strong' && profile.severe ? -1.8 : mode === 'enhanced' && profile.severe ? -1.0 : 0;
  const windFilters = [];
  windFilters.push(`highpass=f=${highPass}:p=2`);
  if (profile.severe) windFilters.push(`highpass=f=${highPass}:p=2`);
  windFilters.push(`equalizer=f=260:t=q:w=0.82:g=${lowCut.toFixed(2)}`);
  windFilters.push(`equalizer=f=520:t=q:w=0.96:g=${midCut.toFixed(2)}`);
  if (upperLowCut) windFilters.push(`equalizer=f=850:t=q:w=1.20:g=${upperLowCut.toFixed(2)}`);

  // Compensate the processing path before it is mixed with system/application audio.
  // Chromium Voice Isolation uses a longer speech-processing pipeline than ordinary
  // WebRTC NS/AGC; DeepFilter has its own smaller worklet delay. Padding preserves the
  // original recording duration after the leading processing latency is removed.
  const processingDelay = method.includes('voice-isolation') ? 0.080
    : method.includes('deepfilter') ? 0.032
      : method.includes('webrtc') ? 0.010
        : 0;
  const align = processingDelay > 0
    ? `aresample=async=1:first_pts=0,atrim=start=${processingDelay.toFixed(3)},asetpts=PTS-STARTPTS,apad=pad_dur=${processingDelay.toFixed(3)}`
    : 'aresample=async=1:first_pts=0';
  const voiceMaster = [
    'equalizer=f=2800:t=q:w=0.95:g=2.20',
    'dynaudnorm=f=200:g=12:p=0.92:m=3.2:r=0.090:s=3.5:t=0.010',
    'alimiter=limit=0.95'
  ].join(',');
  const processedChain = `${align},${windFilters.join(',')}`;
  const args = ['-y', '-i', processed];
  if (safetyBlend) {
    args.push('-i', raw);
    // Raw audio is a rescue layer only, and only in the speech band. Keep it small so
    // direct fan turbulence cannot be poured back into a successful processed track.
    const rawMix = mode === 'strong' ? 0.08 : 0.10;
    const processedMix = 1 - rawMix;
    const graph = [
      `[0:a]${processedChain},volume=${processedMix.toFixed(3)}[processed]`,
      `[1:a]aresample=async=1:first_pts=0,highpass=f=700,lowpass=f=6500,volume=${rawMix.toFixed(3)}[rawvoice]`,
      `[processed][rawvoice]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,${voiceMaster}[out]`
    ].join(';');
    args.push('-filter_complex', graph, '-map', '[out]');
  } else {
    args.push('-af', `${processedChain},${voiceMaster}`);
  }
  args.push('-vn', '-ac', '1', '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', outputPath);
  await runProcess(executable, args);
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 128) throw new Error('Processed microphone mastering did not create a valid track.');
  return outputPath;
}

async function renderMicrophoneCleanupCandidate(inputPath, outputPath, mode, profile, options = {}) {
  const executable = safeFfmpegPath();
  if (!executable || !fs.existsSync(executable)) throw new Error('FFmpeg is unavailable for microphone cleanup.');
  const strength = Math.max(0, Math.min(1, Number(profile?.strength) || 0));
  const hybridSafety = Boolean(options.hybridSafety);
  const args = ['-y', '-i', inputPath, '-vn'];

  if (mode === 'enhanced' || mode === 'strong') {
    // v0.2.28: keep the proven fan/noise parameters, but stop continuously mixing a
    // large raw microphone branch into every successful cleanup. That parallel path
    // reintroduced fan/wind and, after latency alignment, could create phase coloration.
    // The fully source-preserving microphone remains on disk and the watchdog can
    // automatically fall back to a hybrid/raw-safe candidate if speech is endangered.
    const highPass = mode === 'strong'
      ? Math.round(120 + strength * 45)
      : Math.round(95 + strength * 35);
    const lowCut = mode === 'strong' ? -(4.0 + strength * 4.0) : -(2.0 + strength * 3.0);
    const fanCut = mode === 'strong' ? -(2.0 + strength * 2.0) : -(1.0 + strength * 1.5);
    const upperLowCut = mode === 'strong' && profile?.severe ? -1.5 : mode === 'enhanced' && profile?.severe ? -0.8 : 0;
    // Keep broadband FFT cleanup deliberately mild. The regression sample showed that
    // the dominant failure is wind/turbulence energy below ~700 Hz; over-driving a
    // full-band denoiser can smear consonants while doing little for that low-frequency blast.
    const nr = mode === 'strong' ? 14 + strength * 2 : 11 + strength * 2;
    const nf = mode === 'strong' ? -40 : -43;
    const wetFilters = [
      `highpass=f=${highPass}:p=2`,
      ...(profile?.severe ? [`highpass=f=${highPass}:p=2`] : []),
      `equalizer=f=260:t=q:w=0.82:g=${lowCut.toFixed(2)}`,
      `equalizer=f=480:t=q:w=0.95:g=${fanCut.toFixed(2)}`,
      ...(upperLowCut ? [`equalizer=f=850:t=q:w=1.20:g=${upperLowCut.toFixed(2)}`] : []),
      `afftdn=nr=${nr.toFixed(1)}:nf=${nf.toFixed(1)}:tn=1:tr=1:ad=0.96:gs=${mode === 'strong' ? 4 : 3}`
    ].join(',');
    // Voice mastering is intentionally downstream of denoising. It does not alter the
    // fan/noise classifier or suppression values: it gently raises quiet speech, adds
    // presence around 2.7 kHz, and compresses unusually loud wind bursts instead of
    // simply turning the entire microphone up.
    const voiceMaster = [
      'equalizer=f=2800:t=q:w=0.95:g=2.30',
      'dynaudnorm=f=200:g=12:p=0.92:m=3.2:r=0.090:s=3.5:t=0.010',
      'alimiter=limit=0.94'
    ].join(',');
    if (!hybridSafety) {
      // afftdn adds about 25 ms at 48 kHz. Remove that processing latency so microphone
      // speech stays synchronized with video/system audio. With no large dry branch in
      // parallel, there is no comb-filter/echo coloration from two copies of the voice.
      args.push('-af', `${wetFilters},atrim=start=0.025,asetpts=PTS-STARTPTS,apad=pad_dur=0.025,${voiceMaster}`);
    } else {
      // Only used when the primary cleaned track fails the speech-preservation check.
      // Keep a small, speech-band-limited raw safety floor rather than the old 34-44%
      // full-band dry mix; this protects words without pouring wind rumble back in.
      const safetyMix = mode === 'strong' ? 0.12 : 0.14;
      const cleanMix = 1 - safetyMix;
      const safetyHighPass = Math.max(80, Math.round(highPass * 0.88));
      const graph = [
        '[0:a]asplit=2[safety][wet]',
        `[wet]${wetFilters},atrim=start=0.025,asetpts=PTS-STARTPTS,apad=pad_dur=0.025[clean]`,
        `[clean]volume=${cleanMix.toFixed(3)}[wetmix]`,
        `[safety]highpass=f=${safetyHighPass},lowpass=f=6200,volume=${safetyMix.toFixed(3)}[safemix]`,
        `[wetmix][safemix]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,${voiceMaster}[out]`
      ].join(';');
      args.push('-filter_complex', graph, '-map', '[out]');
    }
  } else if (mode === 'standard') {
    // Standard remains intentionally mild and deterministic, with a small clarity lift.
    args.push('-af', 'highpass=f=75,equalizer=f=2700:t=q:w=0.90:g=1.2,dynaudnorm=f=260:g=15:p=0.92:m=3:r=0.085:s=4:t=0.008,alimiter=limit=0.95');
  }

  args.push('-ac', '1', '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', outputPath);
  await runProcess(executable, args);
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 128) throw new Error('Microphone cleanup did not create a valid track.');
  return outputPath;
}

async function renderSourcePreservingFallback(inputPath, outputPath) {
  const executable = safeFfmpegPath();
  if (!executable || !fs.existsSync(executable)) throw new Error('FFmpeg is unavailable for microphone fallback.');
  // Only remove sub-voice rumble. Do not use a denoiser/gate in the fallback.
  await runProcess(executable, ['-y', '-i', inputPath, '-vn', '-af', 'highpass=f=65,alimiter=limit=0.97', '-ac', '1', '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', outputPath]);
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 128) throw new Error('Microphone safety fallback did not create a valid track.');
  return outputPath;
}

async function cleanMicrophoneTrack(micPath, noiseMode, durationSeconds, neuralMicPath = null, neuralMethod = 'none', recordingName = '') {
  const safeMic = validMicrophoneRecoveryPath(micPath);
  if (!safeMic) throw new Error('Temporary microphone track was not found.');
  const safeNeuralMic = validMicrophoneRecoveryPath(neuralMicPath);
  const mode = normalizeMicNoiseMode(noiseMode);
  const cleaned = path.join(recoveryDirectory(), `microphone-cleaned-${Date.now()}-${process.pid}.m4a`);
  let vadSegments = [];
  let vadUsed = false;
  let vadError = '';

  if (mode === 'enhanced' || mode === 'strong') {
    const vadWav = path.join(recoveryDirectory(), `microphone-vad-${Date.now()}-${process.pid}.wav`);
    try {
      await extractVadWav(safeMic, vadWav);
      const vadResult = await runAiWorkerQueued({
        task: 'vad',
        recordingName: String(recordingName || ''),
        wavPath: vadWav,
        cacheDir: path.join(app.getPath('userData'), 'models'),
        model: 'onnx-community/silero-vad',
        threshold: mode === 'strong' ? 0.44 : 0.48,
        minSpeechMs: 120,
        minSilenceMs: 220
      }, 120000);
      vadSegments = normalizeVadSpeechSegments(vadResult?.segments || [], durationSeconds);
      const speechSeconds = vadSegments.reduce((sum, segment) => sum + Math.max(0, segment.end - segment.start), 0);
      vadUsed = vadSegments.length > 0 && speechSeconds >= 0.20;
    } catch (error) {
      vadError = error.message || String(error);
      appendAiWorkerLog(`Microphone VAD analysis fallback: ${vadError}`);
    } finally {
      try { fs.unlinkSync(vadWav); } catch {}
    }
  }

  const profile = (mode === 'enhanced' || mode === 'strong')
    ? await analyzeMicrophoneWindProfile(safeMic, vadUsed ? vadSegments : [], durationSeconds).catch(() => ({ strength: 0.35, severe: false, moderate: true }))
    : { strength: 0, severe: false, moderate: false };

  let preservation = { safe: true, activeWindows: 0, speechWindows: 0, dangerousWindows: 0, speechDangerWindows: 0, worstDropDb: 0, worstSpeechDropDb: 0, medianDeltaDb: 0 };
  let noiseControl = { effective: true, requiredDb: 0, improvementDb: 0, rawTiltDb: 0, cleanedTiltDb: 0, rawStrength: Number(profile.strength) || 0, cleanedStrength: 0 };
  let safetyFallback = false;
  let hybridSafety = false;
  let primaryMethod = 'offline-spectral';

  // Enhanced/Strong prefer the dedicated neural sidecar. It was captured in parallel
  // with the untouched raw mic, so this can deliver meeting-app-style separation while
  // the raw track remains available for objective speech-preservation checks and fallback.
  if ((mode === 'enhanced' || mode === 'strong') && safeNeuralMic) {
    try {
      await renderNeuralMicrophoneCandidate(safeNeuralMic, safeMic, cleaned, mode, { safetyBlend: false, profile, method: neuralMethod });
      preservation = await assessMicrophoneSpeechPreservation(safeMic, cleaned, vadUsed ? vadSegments : []).catch(() => preservation);
      primaryMethod = `speech-${String(neuralMethod || 'processed')}`;
      noiseControl = await assessMicrophoneNoiseControl(safeMic, cleaned, vadUsed ? vadSegments : [], durationSeconds).catch(() => noiseControl);
      if (!preservation.safe) {
        appendAiWorkerLog(`Neural microphone candidate needs speech-band safety support (worst presence-band drop ${preservation.worstDropDb} dB).`);
        const hybrid = path.join(recoveryDirectory(), `microphone-neural-safe-${Date.now()}-${process.pid}.m4a`);
        try {
          await renderNeuralMicrophoneCandidate(safeNeuralMic, safeMic, hybrid, mode, { safetyBlend: true, profile, method: neuralMethod });
          const hybridPreservation = await assessMicrophoneSpeechPreservation(safeMic, hybrid, vadUsed ? vadSegments : []).catch(() => ({ ...preservation, safe: false }));
          const hybridNoiseControl = await assessMicrophoneNoiseControl(safeMic, hybrid, vadUsed ? vadSegments : [], durationSeconds).catch(() => ({ ...noiseControl, effective: true }));
          if (hybridPreservation.safe && hybridNoiseControl.effective) {
            try { fs.unlinkSync(cleaned); } catch {}
            fs.renameSync(hybrid, cleaned);
            preservation = hybridPreservation;
            noiseControl = hybridNoiseControl;
            hybridSafety = true;
          }
        } finally {
          try { if (fs.existsSync(hybrid)) fs.unlinkSync(hybrid); } catch {}
        }
      }
      if (preservation.safe && noiseControl.effective) {
        return { path: cleaned, vadUsed, vadSegments: vadUsed ? vadSegments : [], vadError, profile, mode, safetyFallback, hybridSafety, preservation, noiseControl, primaryMethod };
      }
      appendAiWorkerLog(`Speech-processed microphone candidate rejected (speechSafe=${preservation.safe}, noiseImprovement=${noiseControl.improvementDb} dB); using source-preserving fallback processing.`);
      try { if (fs.existsSync(cleaned)) fs.unlinkSync(cleaned); } catch {}
    } catch (error) {
      appendAiWorkerLog(`Neural microphone processing unavailable; using raw-source fallback: ${error.message || error}`);
      try { if (fs.existsSync(cleaned)) fs.unlinkSync(cleaned); } catch {}
    }
  }

  // Compatibility/fallback path for recordings without a neural sidecar. This is the
  // v0.2.28 source-preserving spectral cleanup, retained so recording can never fail just
  // because the neural worker/model was unavailable at capture time.
  await renderMicrophoneCleanupCandidate(safeMic, cleaned, mode, profile, { hybridSafety: false });
  if (mode === 'enhanced' || mode === 'strong') {
    preservation = await assessMicrophoneSpeechPreservation(safeMic, cleaned, vadUsed ? vadSegments : []).catch(() => preservation);
    if (!preservation.safe) {
      const hybrid = path.join(recoveryDirectory(), `microphone-hybrid-${Date.now()}-${process.pid}.m4a`);
      try {
        await renderMicrophoneCleanupCandidate(safeMic, hybrid, mode, profile, { hybridSafety: true });
        const hybridPreservation = await assessMicrophoneSpeechPreservation(safeMic, hybrid, vadUsed ? vadSegments : []).catch(() => ({ ...preservation, safe: false }));
        if (hybridPreservation.safe) {
          try { fs.unlinkSync(cleaned); } catch {}
          fs.renameSync(hybrid, cleaned);
          preservation = hybridPreservation;
          hybridSafety = true;
        }
      } finally {
        try { if (fs.existsSync(hybrid)) fs.unlinkSync(hybrid); } catch {}
      }
    }
    if (!preservation.safe) {
      const fallback = path.join(recoveryDirectory(), `microphone-safe-${Date.now()}-${process.pid}.m4a`);
      try {
        await renderSourcePreservingFallback(safeMic, fallback);
        try { fs.unlinkSync(cleaned); } catch {}
        fs.renameSync(fallback, cleaned);
        safetyFallback = true;
        primaryMethod = 'raw-source-preserving-fallback';
        preservation = await assessMicrophoneSpeechPreservation(safeMic, cleaned, vadUsed ? vadSegments : []).catch(() => ({ ...preservation, safe: true }));
      } finally {
        try { if (fs.existsSync(fallback)) fs.unlinkSync(fallback); } catch {}
      }
    }
  }

  noiseControl = await assessMicrophoneNoiseControl(safeMic, cleaned, vadUsed ? vadSegments : [], durationSeconds).catch(() => noiseControl);
  return { path: cleaned, vadUsed, vadSegments: vadUsed ? vadSegments : [], vadError, profile, mode, safetyFallback, hybridSafety, preservation, noiseControl, primaryMethod };
}

async function mixMicrophoneIntoRecording(basePath, micPath, recordingKind = 'video', options = {}) {
  const executable = safeFfmpegPath();
  if (!executable || !fs.existsSync(executable)) throw new Error('FFmpeg is unavailable for microphone mixing.');
  if (!fs.existsSync(micPath) || fs.statSync(micPath).size < 128) return basePath;
  const hasBaseAudio = await fileHasAudioStream(basePath);
  const ffmpegMajor = hasBaseAudio ? await ffmpegMajorVersion(executable) : 0;
  const nlmsResidualMode = adaptiveNlmsResidualMode(ffmpegMajor || 6);
  const requestedMicFilter = String(options.micFilter || 'highpass=f=70').trim() || 'highpass=f=70';
  // v0.2.96: do not apply a broadband +1 dB lift here. It raised fan/air noise by
  // exactly the same amount as speech. Voice presence is now shaped inside the
  // noise-mode filter, while this final stage only limits peaks.
  const delayMs = Math.max(0, Math.round(Number(options.delayMs) || 0));
  const delayFilter = delayMs > 0 ? `adelay=${delayMs}:all=1,` : '';
  const micFilter = `${delayFilter}${requestedMicFilter},alimiter=limit=0.95`;
  const ext = recordingKind === 'audio' ? 'm4a' : 'mp4';
  const merged = path.join(path.dirname(basePath), `.${path.basename(basePath, path.extname(basePath))}.microphone-${Date.now()}.${ext}`);
  try {
    const adaptiveEchoGraph = [
      // Keep the clean system/application audio untouched for the final mix while a
      // mono copy acts only as the acoustic reference. NLMS learns the delayed room/
      // laptop-speaker copy inside the mic and outputs the residual mic signal. Local
      // speech is uncorrelated with the reference, so it remains even when both people
      // talk at the same time. FFmpeg anlms input #0 is the adaptive input/reference
      // and input #1 is the desired mic signal. FFmpeg 6 and 7+ use different symbolic
      // output-mode semantics, so nlmsResidualMode is selected from the installed major
      // version instead of relying on an unsupported/incorrect fixed mode.
      '[0:a]aresample=48000,asplit=2[base][refraw]',
      '[refraw]aformat=channel_layouts=mono[ref]',
      `[1:a]aresample=48000,${micFilter},aformat=channel_layouts=mono[mic]`,
      `[ref][mic]anlms=order=8192:mu=0.16:eps=0.0001:leakage=0.00001:out_mode=${nlmsResidualMode}[deecho]`,
      '[base][deecho]amix=inputs=2:duration=longest:dropout_transition=2:normalize=0,alimiter=limit=0.95[a]'
    ].join(';');
    const fallbackEchoGraph = [
      // If adaptive cancellation is unavailable, preserve local speech rather than
      // aggressively ducking the microphone whenever system audio is present. Echo
      // rejection is best-effort in this rare fallback; recorded mic speech is not.
      '[0:a]aresample=48000[base]',
      `[1:a]aresample=48000,${micFilter}[mic]`,
      '[base][mic]amix=inputs=2:duration=longest:dropout_transition=2:normalize=0,alimiter=limit=0.95[a]'
    ].join(';');
    const runBaseAudioMix = async (video) => {
      const baseArgs = video
        ? ['-y', '-i', basePath, '-i', micPath, '-filter_complex', adaptiveEchoGraph, '-map', '0:v:0', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', merged]
        : ['-y', '-i', basePath, '-i', micPath, '-filter_complex', adaptiveEchoGraph, '-map', '[a]', '-c:a', 'aac', '-b:a', '192k', merged];
      try {
        await runProcess(executable, baseArgs);
        return `adaptive-nlms-residual-v6-ffmpeg${ffmpegMajor || 6}-${nlmsResidualMode}`;
      } catch (error) {
        activityLog('warn', 'audio.adaptive-echo-guard-fallback', { error, recording: path.basename(basePath) });
        const fallbackArgs = video
          ? ['-y', '-i', basePath, '-i', micPath, '-filter_complex', fallbackEchoGraph, '-map', '0:v:0', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', merged]
          : ['-y', '-i', basePath, '-i', micPath, '-filter_complex', fallbackEchoGraph, '-map', '[a]', '-c:a', 'aac', '-b:a', '192k', merged];
        await runProcess(executable, fallbackArgs);
        return 'speech-safe-direct-mic-fallback';
      }
    };
    let echoGuardProfile = 'none';
    if (recordingKind === 'audio') {
      if (hasBaseAudio) {
        echoGuardProfile = await runBaseAudioMix(false);
      } else {
        await runProcess(executable, ['-y', '-i', micPath, '-vn', '-af', micFilter, '-c:a', 'aac', '-b:a', '192k', merged]);
      }
    } else if (hasBaseAudio) {
      echoGuardProfile = await runBaseAudioMix(true);
    } else {
      await runProcess(executable, ['-y', '-i', basePath, '-i', micPath, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-af', micFilter, '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', merged]);
    }
    if (!fs.existsSync(merged) || fs.statSync(merged).size < 128) throw new Error('Microphone mix did not create a valid output.');
    fs.unlinkSync(basePath);
    fs.renameSync(merged, basePath);
    activityLog('info', 'audio.microphone-mixed', { outputFile: path.basename(basePath), echoGuard: Boolean(hasBaseAudio), echoGuardProfile, recordingKind });
    return basePath;
  } finally {
    try { if (fs.existsSync(merged)) fs.unlinkSync(merged); } catch {}
  }
}

function fastMicrophoneFilter(noiseMode, neuralMethod = 'none') {
  const mode = normalizeMicNoiseMode(noiseMode);
  const localNeural = /rnnoise/i.test(String(neuralMethod || ''));
  // v0.2.104: RNNoise is the primary fan/air suppressor for Enhanced/Strong. Keep
  // the post-filter intentionally light when RNNoise is active so speech is not
  // hollowed out by a second aggressive denoiser. The fallback remains stronger,
  // but dynamic normalization was removed because it could pump residual fan/air
  // noise back up between and underneath words. A small fixed mic-only lift follows
  // suppression so the user's voice is a little louder without raising system audio.
  if (mode === 'strong') {
    return localNeural
      ? 'highpass=f=95:p=2,equalizer=f=190:t=q:w=0.90:g=-1.8,equalizer=f=430:t=q:w=1.0:g=-1.0,afftdn=nr=4:nf=-52:tn=1:tr=1:ad=0.96:gs=3,agate=threshold=0.0048:ratio=2.0:attack=10:release=300:range=0.10,equalizer=f=2800:t=q:w=0.95:g=1.5,volume=1.680,alimiter=limit=0.96'
      : 'highpass=f=130:p=2,equalizer=f=210:t=q:w=0.88:g=-5.0,equalizer=f=480:t=q:w=1.0:g=-3.0,afftdn=nr=17:nf=-47:tn=1:tr=1:ad=0.94:gs=6,agate=threshold=0.0068:ratio=2.8:attack=10:release=300:range=0.055,equalizer=f=2800:t=q:w=0.95:g=1.3,volume=1.580,alimiter=limit=0.96';
  }
  if (mode === 'enhanced') {
    return localNeural
      ? 'highpass=f=85:p=2,equalizer=f=175:t=q:w=0.90:g=-1.2,equalizer=f=410:t=q:w=1.0:g=-0.7,afftdn=nr=3:nf=-54:tn=1:tr=1:ad=0.97:gs=2,agate=threshold=0.0042:ratio=1.8:attack=12:release=320:range=0.14,equalizer=f=2800:t=q:w=0.95:g=1.6,volume=1.680,alimiter=limit=0.96'
      : 'highpass=f=110:p=2,equalizer=f=180:t=q:w=0.88:g=-3.5,equalizer=f=430:t=q:w=1.0:g=-2.0,afftdn=nr=14:nf=-49:tn=1:tr=1:ad=0.95:gs=5,agate=threshold=0.0055:ratio=2.3:attack=12:release=300:range=0.075,equalizer=f=2800:t=q:w=0.95:g=1.5,volume=1.580,alimiter=limit=0.96';
  }
  return mode === 'standard'
    ? 'highpass=f=85,dynaudnorm=f=280:g=15:p=0.92:m=3:r=0.08:s=4:t=0.01,agate=threshold=0.005:ratio=1.7:attack=18:release=260:range=0.26,alimiter=limit=0.96'
    : 'highpass=f=65,alimiter=limit=0.97';
}

async function renderFastMicrophoneMaster(rawMicPath, neuralMicPath, noiseMode, neuralMethod = 'none') {
  const executable = safeFfmpegPath();
  if (!executable || !fs.existsSync(executable)) throw new Error('FFmpeg is unavailable for microphone cleanup.');
  const raw = validMicrophoneRecoveryPath(rawMicPath);
  if (!raw) throw new Error('Temporary microphone track was not found.');
  const neural = validMicrophoneRecoveryPath(neuralMicPath);
  const mode = normalizeMicNoiseMode(noiseMode);
  const source = (mode === 'enhanced' || mode === 'strong') && neural ? neural : raw;
  const output = path.join(recoveryDirectory(), `microphone-fast-${Date.now()}-${process.pid}.m4a`);
  const filters = fastMicrophoneFilter(mode, source === neural ? neuralMethod : 'none');
  await runProcess(executable, ['-y', '-i', source, '-vn', '-af', filters, '-ac', '1', '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', output]);
  if (!fs.existsSync(output) || fs.statSync(output).size < 128) throw new Error('Fast microphone mastering did not create a valid track.');
  return { path: output, source: source === neural ? 'speech-processed-sidecar' : 'microphone-sidecar', mode };
}

async function postProcessAndMixMicrophone(basePath, micPath, recordingKind, noiseMode, durationSeconds, deleteSourceOnSuccess = true, neuralMicPath = null, neuralMethod = 'none', recordingName = '', microphoneStartOffsetMs = 0) {
  const safeMic = validMicrophoneRecoveryPath(micPath);
  if (!safeMic) return { applied: false, method: 'none' };
  const mode = normalizeMicNoiseMode(noiseMode);
  const safeNeuralMic = validMicrophoneRecoveryPath(neuralMicPath);
  const source = (mode === 'enhanced' || mode === 'strong') && safeNeuralMic ? safeNeuralMic : safeMic;
  const sourceLabel = source === safeNeuralMic ? 'speech-processed-sidecar' : 'microphone-sidecar';
  try {
    // v0.2.92 keeps normal Stop to one microphone FFmpeg pass. The same fast
    // mastering filter is applied inline before the call-echo sidechain/mix, instead
    // of first creating a mastered M4A and then decoding it again for a second pass.
    await mixMicrophoneIntoRecording(basePath, source, recordingKind, { micFilter: fastMicrophoneFilter(mode, source === safeNeuralMic ? neuralMethod : 'none'), delayMs: microphoneStartOffsetMs });
    if (deleteSourceOnSuccess) { try { fs.unlinkSync(safeMic); } catch {} }
    activityLog('info', 'audio.microphone-finalized', {
      recording: String(recordingName || path.basename(basePath)),
      mode,
      source: sourceLabel,
      neuralMethod: String(neuralMethod || 'none'),
      durationSeconds: Number(durationSeconds) || 0,
      passes: 1
    });
    return {
      applied: true,
      method: `single-pass-${sourceLabel}+call-echo-guard`,
      vadUsed: false,
      vadRole: 'not-used-during-save',
      windStrength: 0,
      severeWind: false,
      speechPreservation: null,
      noiseControl: null,
      safetyFallback: false,
      hybridSafety: false,
      neuralMethod: sourceLabel === 'speech-processed-sidecar' ? (neuralMethod || 'speech-processed-sidecar') : null,
      fallback: false
    };
  } catch (error) {
    activityLog('warn', 'audio.microphone-fast-finalize-fallback', { error, recording: String(recordingName || path.basename(basePath)) });
    const fallbackFilter = (mode === 'enhanced' || mode === 'strong') ? fastMicrophoneFilter(mode, 'none') : 'highpass=f=65,alimiter=limit=0.97';
    await mixMicrophoneIntoRecording(basePath, safeMic, recordingKind, { micFilter: fallbackFilter, delayMs: microphoneStartOffsetMs });
    if (deleteSourceOnSuccess) { try { fs.unlinkSync(safeMic); } catch {} }
    return { applied: true, method: 'noise-cleaned-mic-fallback+call-echo-guard', vadUsed: false, vadRole: 'not-used', windStrength: 0, severeWind: false, speechPreservation: null, safetyFallback: true, fallback: true, error: error.message || String(error) };
  }
}

async function recoverOneJournalInternal(journal, manifestPath = null) {
  throwIfRecoveryCancelled();
  if (!journal?.tempPath) return null;
  const tempPath = path.resolve(String(journal.tempPath));
  const root = path.resolve(recoveryDirectory());
  const isActiveJournal = !manifestPath;
  const cleanupManifest = () => {
    if (manifestPath) { try { fs.unlinkSync(manifestPath); } catch {} }
    else clearRecoveryJournal();
  };
  if (tempPath !== root && !tempPath.startsWith(`${root}${path.sep}`)) { cleanupManifest(); return null; }
  if (!fs.existsSync(tempPath) || fs.statSync(tempPath).size < 1024) {
    const orphanMic = validMicrophoneRecoveryPath(journal.microphonePath);
    const orphanNeuralMic = validMicrophoneRecoveryPath(journal.neuralMicrophonePath);
    if (orphanMic) { try { fs.unlinkSync(orphanMic); } catch {} }
    if (orphanNeuralMic) { try { fs.unlinkSync(orphanNeuralMic); } catch {} }
    cleanupManifest();
    return null;
  }
  const kind = journal.recordingKind === 'audio' ? 'audio' : 'video';
  const outputPath = nextRecordingPath({ recordingKind: kind, filenameTemplate: journal.filenameTemplate, meta: journal.meta || {}, date: journal.createdAt || journal.updatedAt, recovered: true });
  try {
    if (kind === 'audio') await transcodeToM4a(tempPath, outputPath, true);
    else await transcodeRecoveredVideo(tempPath, outputPath, journal.meta?.videoCodec || 'h264');
    const recoveryAppAudioSources = [...new Set((journal.applicationAudioPaths || []).map((item) => validApplicationAudioPath(item)).filter(Boolean))];
    const recoveredAppAudio = await combineApplicationAudioPathList(recoveryAppAudioSources, false).catch(() => null);
    if (recoveredAppAudio) await mergeApplicationAudio(outputPath, recoveredAppAudio, kind, false);
    const recoveredMic = validMicrophoneRecoveryPath(journal.microphonePath);
    const recoveredNeuralMic = validMicrophoneRecoveryPath(journal.neuralMicrophonePath);
    if (recoveredMic) {
      // Recovery is a salvage path, not a quality-enhancement pass. Mix the untouched
      // microphone track directly so recovery stays deterministic, cancellable, and
      // does not wait on VAD/neural-AI work before the recorder can be used again.
      await mixMicrophoneIntoRecording(outputPath, recoveredMic, kind, { delayMs: Math.max(0, Number(journal.meta?.microphoneStartOffsetMs) || 0) });
    }
    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1024) throw new Error('Recovered output was empty.');
    const recoveredMarkers = normalizeMarkers(journal.meta?.markers || []);
    if (recoveredMarkers.length) saveMarkersForRecording(outputPath, recoveredMarkers);
    const recoveredDurationSeconds = Math.max(0, Number(journal.meta?.elapsedMs || journal.meta?.durationMs || 0) / 1000) || Infinity;
    const recoveredVoiceHighlights = normalizeVoiceHighlights(journal.meta?.voiceHighlights || [], recoveredDurationSeconds);
    if (recoveredVoiceHighlights.length) saveVoiceHighlightsForRecording(outputPath, recoveredVoiceHighlights, { durationSeconds: recoveredDurationSeconds, method: 'recovery-checkpoint' });
    // Cancellation is deliberately checked before the destructive cleanup phase. A
    // stopped recovery therefore leaves every protected source/manifest available
    // for a later retry instead of partially consuming it.
    throwIfRecoveryCancelled();
    // Delete recovery sources only after the complete recovered output exists and validates.
    for (const source of recoveryAppAudioSources) { try { if (fs.existsSync(source)) fs.unlinkSync(source); } catch {} }
    if (recoveredAppAudio && !recoveryAppAudioSources.includes(recoveredAppAudio)) { try { if (fs.existsSync(recoveredAppAudio)) fs.unlinkSync(recoveredAppAudio); } catch {} }
    if (recoveredMic) { try { if (fs.existsSync(recoveredMic)) fs.unlinkSync(recoveredMic); } catch {} }
    if (recoveredNeuralMic) { try { if (fs.existsSync(recoveredNeuralMic)) fs.unlinkSync(recoveredNeuralMic); } catch {} }
    try { fs.unlinkSync(tempPath); } catch {}
    if (journal.partialOutputPath) { try { fs.unlinkSync(journal.partialOutputPath); } catch {} }
    cleanupManifest();
    lastRecordingPath = outputPath;
    return { recovered: true, path: outputPath, message: `An unfinished ${kind === 'audio' ? 'audio ' : ''}recording was recovered successfully: ${path.basename(outputPath)}` };
  } catch (error) {
    try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
    if (isRecoveryCancellationError(error)) {
      return {
        recovered: false,
        cancelled: true,
        path: tempPath,
        message: 'Recovery was stopped. The unfinished recording remains protected and can be recovered later.'
      };
    }
    if (isActiveJournal) writeRecoveryJournal({ status: 'recovery_failed', recoveryError: error.message }, true);
    return { recovered: false, path: tempPath, message: 'We found an unfinished recording. Your recording data is safe, but it needs another recovery attempt.' , technicalError: error.message };
  }
}

async function recoverOneJournal(journal, manifestPath = null) {
  return recoveryProcessContext.run({ recoveryTask: true }, async () => {
    activityLog('info', 'recovery.attempt-start', { sourceFile: path.basename(String(journal?.tempPath || '')), manifest: manifestPath ? path.basename(manifestPath) : 'active-recording.json', kind: journal?.recordingKind || 'video' });
    try {
      const result = await recoverOneJournalInternal(journal, manifestPath);
      activityLog(result?.recovered ? 'info' : result?.cancelled ? 'warn' : 'error', 'recovery.attempt-finished', { recovered: Boolean(result?.recovered), cancelled: Boolean(result?.cancelled), outputFile: result?.path ? path.basename(result.path) : '', message: result?.message || '', technicalError: result?.technicalError || '' });
      return result;
    } catch (error) {
      if (isRecoveryCancellationError(error)) {
        return {
          recovered: false,
          cancelled: true,
          path: journal?.tempPath || null,
          message: recoveryCancelReason || 'Recovery was stopped. The unfinished recording remains protected and can be recovered later.'
        };
      }
      throw error;
    }
  });
}

async function recoverInterruptedRecording(options = {}) {
  const includePaused = Boolean(options.includePaused);
  const candidates = listPendingRecoveries(recoveryDirectory()).filter((item) => includePaused || item.manifest?.status !== 'paused_by_user');
  const active = readRecoveryJournal();
  if (active?.tempPath && !activeTempPath) candidates.push({ manifestPath: null, manifest: active });
  if (!candidates.length) return null;
  const results = [];
  for (const candidate of candidates) {
    if (recoveryCancelRequested) break;
    const result = await recoverOneJournal(candidate.manifest, candidate.manifestPath);
    if (result) results.push(result);
    if (result?.cancelled || recoveryCancelRequested) break;
  }
  if (recoveryCancelRequested || results.some((item) => item.cancelled)) {
    const pausedByUser = listPendingRecoveries(recoveryDirectory()).some((item) => item.manifest?.status === 'paused_by_user');
    return {
      recovered: false,
      cancelled: true,
      paused: pausedByUser,
      title: pausedByUser ? 'Recovery paused' : 'Recovery paused for recording',
      recoveredCount: results.filter((item) => item.recovered).length,
      failedCount: 0,
      message: pausedByUser
        ? 'Recovery was stopped. The unfinished recording remains protected and will wait until you choose Recover recording.'
        : (recoveryCancelReason || 'Recovery was paused. The unfinished recording remains protected and can be recovered later.')
    };
  }
  if (!results.length) return null;
  const recovered = results.filter((item) => item.recovered);
  const failed = results.filter((item) => !item.recovered);
  return {
    recovered: recovered.length > 0 && failed.length === 0,
    path: recovered[recovered.length - 1]?.path || failed[0]?.path || null,
    recoveredCount: recovered.length,
    failedCount: failed.length,
    message: [...recovered.map((item) => item.message), ...failed.map((item) => item.message)].join(' '),
    technicalError: failed.map((item) => item.technicalError).filter(Boolean).join(' | ')
  };
}

function macAppAudioSourcePath() {
  return path.join(__dirname, 'native', 'macos', 'AppAudioCapture.swift');
}

function macAppAudioBinaryPath() {
  return path.join(recoveryDirectory(), 'AppAudioCapture');
}

async function ensureMacApplicationAudioHelper() {
  if (process.platform !== 'darwin') throw new Error('Selected-application audio is currently available on macOS in this build.');
  const binary = macAppAudioBinaryPath();
  if (fs.existsSync(binary)) return binary;
  const source = macAppAudioSourcePath();
  if (!fs.existsSync(source)) throw new Error('The macOS application-audio helper source is missing.');
  const copiedSource = path.join(recoveryDirectory(), 'AppAudioCapture.swift');
  fs.copyFileSync(source, copiedSource);
  await runProcess('/usr/bin/xcrun', ['swiftc', copiedSource, '-framework', 'ScreenCaptureKit', '-framework', 'AVFoundation', '-framework', 'CoreMedia', '-framework', 'Foundation', '-o', binary]);
  fs.chmodSync(binary, 0o755);
  return binary;
}

async function launchApplicationAudioSegment(windowTitle, sourceId = applicationAudioSourceId) {
  const title = String(windowTitle || '').trim();
  if (!title) throw new Error('Choose a window before using selected-application audio.');

  if (process.platform === 'win32') {
    const output = path.join(recoveryDirectory(), `application-audio-${Date.now()}-${applicationAudioSegments.length + 1}.wav`);
    try { fs.unlinkSync(output); } catch {}
    const captureSession = await startWindowsProcessLoopback({ sourceId, windowTitle: title, outputPath: output, runProcess });
    applicationAudioProcess = captureSession;
    applicationAudioTempPath = output;
    writeRecoveryJournal();
    return output;
  }

  const binary = await ensureMacApplicationAudioHelper();
  const output = path.join(recoveryDirectory(), `application-audio-${Date.now()}-${applicationAudioSegments.length + 1}.m4a`);
  try { fs.unlinkSync(output); } catch {}
  const child = spawn(binary, [title, output, String(process.pid)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  applicationAudioProcess = child;
  applicationAudioTempPath = output;
  await new Promise((resolve, reject) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    const finish = (error) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(); };
    const timer = setTimeout(() => finish(new Error(`Application-audio helper did not become ready. ${stderr}`.trim())), 20000);
    child.stdout.on('data', (data) => { stdout += data.toString(); if (/READY/.test(stdout)) finish(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });
    child.once('error', (error) => finish(error));
    child.once('close', (code) => { if (!settled) finish(new Error(stderr || `Application-audio helper exited with code ${code}.`)); });
  });
  return output;
}

async function stopCurrentApplicationAudioSegment() {
  const child = applicationAudioProcess;
  const output = applicationAudioTempPath;
  if (!child) return validApplicationAudioPath(output);
  applicationAudioProcess = null;
  applicationAudioTempPath = null;

  if (child.kind === 'windows-process-loopback' && typeof child.stop === 'function') {
    try { await child.stop(); }
    catch (error) {
      const salvaged = validApplicationAudioPath(output);
      if (!salvaged) throw error;
    }
  } else {
    await new Promise((resolve) => {
      let finished = false;
      const done = () => { if (finished) return; finished = true; resolve(); };
      child.once('close', done);
      try { child.kill('SIGTERM'); } catch { done(); }
      setTimeout(() => { try { if (!child.killed) child.kill('SIGKILL'); } catch {} done(); }, 8000);
    });
  }

  const valid = validApplicationAudioPath(output);
  if (valid && !applicationAudioSegments.includes(valid)) applicationAudioSegments.push(valid);
  else if (output) { try { if (fs.existsSync(output)) fs.unlinkSync(output); } catch {} }
  return valid;
}

async function combineApplicationAudioPathList(paths, deleteSourceSegmentsOnSuccess = true) {
  const segments = [...new Set((paths || []).map((item) => validApplicationAudioPath(item)).filter(Boolean))];
  if (!segments.length) return null;
  if (segments.length === 1) return segments[0];
  const executable = safeFfmpegPath();
  if (!executable || !fs.existsSync(executable)) throw new Error('FFmpeg is unavailable for application-audio joining.');
  const listPath = path.join(recoveryDirectory(), `application-audio-list-${Date.now()}.txt`);
  const combined = path.join(recoveryDirectory(), `application-audio-combined-${Date.now()}.m4a`);
  const escapeConcat = (value) => String(value).replace(/'/g, `'\\''`);
  fs.writeFileSync(listPath, segments.map((item) => `file '${escapeConcat(item)}'`).join('\n') + '\n', 'utf8');
  try {
    const allM4a = segments.every((item) => /\.m4a$/i.test(item));
    await runProcess(executable, allM4a
      ? ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', combined]
      : ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-vn', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', combined]);
    if (!fs.existsSync(combined) || fs.statSync(combined).size < 128) throw new Error('Joined application-audio file was empty.');
    if (deleteSourceSegmentsOnSuccess) {
      for (const segment of segments) { try { fs.unlinkSync(segment); } catch {} }
    }
    return combined;
  } finally {
    try { fs.unlinkSync(listPath); } catch {}
  }
}

async function combineApplicationAudioSegments() {
  const combined = await combineApplicationAudioPathList(applicationAudioSegments);
  applicationAudioSegments = combined ? [combined] : [];
  return combined;
}
async function stopApplicationAudioCapture() {
  await stopCurrentApplicationAudioSegment();
  const pathValue = await combineApplicationAudioSegments();
  return { path: pathValue };
}

async function startApplicationAudioCapture(payload = {}) {
  await stopCurrentApplicationAudioSegment().catch(() => {});
  for (const segment of applicationAudioSegments) { try { fs.unlinkSync(segment); } catch {} }
  applicationAudioSegments = [];
  const normalized = typeof payload === 'string' ? { windowTitle: payload } : (payload || {});
  applicationAudioWindowTitle = String(normalized.windowTitle || '').trim();
  applicationAudioSourceId = String(normalized.sourceId || '').trim();
  if (!applicationAudioWindowTitle) throw new Error('Choose a window before using selected-application audio.');
  if (process.platform === 'win32' && !/^window:/i.test(applicationAudioSourceId)) throw new Error('Windows application-only audio requires a selected window source.');
  const output = await launchApplicationAudioSegment(applicationAudioWindowTitle, applicationAudioSourceId);
  return { path: output, windowTitle: applicationAudioWindowTitle, sourceId: applicationAudioSourceId, platform: process.platform };
}

async function pauseApplicationAudioCapture() {
  if (!applicationAudioWindowTitle) return { paused: false };
  await stopCurrentApplicationAudioSegment();
  writeRecoveryJournal();
  return { paused: true };
}

async function resumeApplicationAudioCapture() {
  if (!applicationAudioWindowTitle) return { resumed: false };
  if (applicationAudioProcess) return { resumed: true };
  const output = await launchApplicationAudioSegment(applicationAudioWindowTitle, applicationAudioSourceId);
  writeRecoveryJournal();
  return { resumed: true, path: output };
}

async function extractSpeechAudio(inputPath, outputPath, format = 'mp3') {
  const executable = safeFfmpegPath();
  if (!executable || !fs.existsSync(executable)) throw new Error('FFmpeg is unavailable.');
  const codecArgs = format === 'wav'
    ? ['-acodec', 'pcm_s16le']
    : ['-c:a', 'libmp3lame', '-b:a', '64k'];
  await runProcess(executable, [
    '-y', '-i', inputPath, '-vn', '-ac', '1', '-ar', '16000', ...codecArgs, outputPath
  ]);
}

function plainTextToSrt(text) {
  const cleaned = String(text || '').trim();
  if (!cleaned) return '';
  return `1\n00:00:00,000 --> 99:59:59,000\n${cleaned}\n`;
}

function saveTranscriptBesideRecording(recordingPath, text) {
  const safe = safeRecordingPath(recordingPath);
  if (!fs.existsSync(safe)) throw new Error('Recording was not found.');
  const paths = transcriptPathsForRecording(safe);
  // TXT is the only transcript sidecar created automatically. Timestamped cues are
  // stored in the app's transcript metadata and are converted to SRT only when the
  // user explicitly exports SRT. This avoids creating a duplicate subtitle file for
  // every recording while keeping CC/timecoded transcript support intact.
  fs.writeFileSync(paths.txt, String(text || ''), 'utf8');
  return { txt: paths.txt, srt: '' };
}

const TRANSCRIPT_METADATA_VERSION = 3;

function transcriptMetadataPath() {
  return path.join(app.getPath('userData'), 'recording-transcripts.json');
}

function loadTranscriptMetadata() {
  try {
    const parsed = JSON.parse(fs.readFileSync(transcriptMetadataPath(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

function saveTranscriptMetadata(metadata) {
  const target = transcriptMetadataPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify(metadata || {}, null, 2), 'utf8');
  fs.renameSync(temp, target);
}

function transcriptMetadataKey(recordingPath) {
  return path.resolve(String(recordingPath || ''));
}

function normalizeTranscriptTimelineCues(cues) {
  return (Array.isArray(cues) ? cues : [])
    .map((cue) => ({
      start: Math.max(0, Number(cue?.start) || 0),
      end: Math.max(0, Number(cue?.end) || 0),
      text: String(cue?.text || '').trim()
    }))
    .filter((cue) => cue.text && cue.end > cue.start + 0.02)
    .sort((a, b) => a.start - b.start);
}

function transcriptCuesToSrt(cues) {
  const usable = normalizeTranscriptTimelineCues(cues);
  if (!usable.length) return '';
  return usable.map((cue, index) => `${index + 1}\n${secondsToSrtTime(cue.start)} --> ${secondsToSrtTime(cue.end)}\n${cue.text}\n`).join('\n');
}

function transcriptTimelineForRecording(recordingPath, metadata = null) {
  const safe = safeRecordingPath(recordingPath);
  const store = metadata || loadTranscriptMetadata();
  const entry = store[transcriptMetadataKey(safe)];
  const storedCues = normalizeTranscriptTimelineCues(entry?.cues);
  if (storedCues.length) {
    return { cues: storedCues, srtText: transcriptCuesToSrt(storedCues), source: 'metadata' };
  }
  // Backward compatibility only: old builds created an automatic .srt sidecar.
  // Continue reading it, but new recordings no longer create one automatically.
  const paths = transcriptPathsForRecording(safe);
  if (fs.existsSync(paths.srt)) {
    try {
      const legacySrt = fs.readFileSync(paths.srt, 'utf8');
      const legacyCues = normalizeTranscriptTimelineCues(parseSrtCues(legacySrt));
      if (legacyCues.length) return { cues: legacyCues, srtText: transcriptCuesToSrt(legacyCues), source: 'legacy-srt' };
    } catch {}
  }
  return { cues: [], srtText: '', source: 'none' };
}

function migrateRecordingTranscriptMetadata(oldPath, newPath) {
  const metadata = loadTranscriptMetadata();
  const oldKey = transcriptMetadataKey(oldPath);
  const newKey = transcriptMetadataKey(newPath);
  if (metadata[oldKey]) {
    metadata[newKey] = metadata[oldKey];
    delete metadata[oldKey];
    saveTranscriptMetadata(metadata);
  }
}

function removeRecordingTranscriptMetadata(recordingPath) {
  const metadata = loadTranscriptMetadata();
  const key = transcriptMetadataKey(recordingPath);
  if (metadata[key]) { delete metadata[key]; saveTranscriptMetadata(metadata); }
}

async function transcriptCacheState(recordingPath, text, srt) {
  const safe = safeRecordingPath(recordingPath);
  const stat = fs.statSync(safe);
  const audioFingerprint = recordingAudioFingerprint(safe);
  const durationSeconds = await probeRecordingDuration(safe, stat);
  const metadata = loadTranscriptMetadata();
  const key = transcriptMetadataKey(safe);
  const entry = metadata[key];
  const textFingerprint = transcriptFingerprint(text, srt);
  const verified = Boolean(entry && entry.version === TRANSCRIPT_METADATA_VERSION && entry.audioFingerprint === audioFingerprint && entry.transcriptFingerprint === textFingerprint);
  const sparse = basicTranscriptLooksSparse(text, durationSeconds);
  return { verified, needsRefresh: Boolean(String(text || '').trim() && sparse && !verified), durationSeconds, wordCount: transcriptWordCount(text), audioFingerprint, textFingerprint, metadata, key };
}

function saveTranscriptVerification(recordingPath, text, srt, quality = {}) {
  const safe = safeRecordingPath(recordingPath);
  const metadata = loadTranscriptMetadata();
  const cues = normalizeTranscriptTimelineCues(parseSrtCues(String(srt || '')));
  metadata[transcriptMetadataKey(safe)] = {
    version: TRANSCRIPT_METADATA_VERSION,
    audioFingerprint: recordingAudioFingerprint(safe),
    transcriptFingerprint: transcriptFingerprint(text, transcriptCuesToSrt(cues)),
    model: AUTO_TRANSCRIPTION_MODEL,
    wordCount: transcriptWordCount(text),
    cues,
    quality: quality && typeof quality === 'object' ? quality : {},
    generatedAt: new Date().toISOString()
  };
  saveTranscriptMetadata(metadata);
}

function copyRecordingTranscriptMetadata(sourcePath, targetPath) {
  const metadata = loadTranscriptMetadata();
  const source = metadata[transcriptMetadataKey(sourcePath)];
  if (!source) return false;
  metadata[transcriptMetadataKey(targetPath)] = {
    ...source,
    version: TRANSCRIPT_METADATA_VERSION,
    audioFingerprint: recordingAudioFingerprint(targetPath),
    generatedAt: new Date().toISOString()
  };
  saveTranscriptMetadata(metadata);
  return true;
}

const AUTO_TRANSCRIPTION_MODEL = 'onnx-community/whisper-small';
const automaticTranscriptionJobs = new Map();
const AUTO_DIARIZATION_MODEL = 'onnx-community/pyannote-segmentation-3.0';
const AUTO_SPEAKER_EMBEDDING_MODEL = 'Xenova/wavlm-base-plus-sv';
const AUTO_INSIGHTS_MODEL = 'onnx-community/Qwen2.5-1.5B-Instruct';
const automaticDiarizationJobs = new Map();
const automaticInsightsJobs = new Map();

function secondsToSrtTime(value) {
  const totalMs = Math.max(0, Math.round((Number(value) || 0) * 1000));
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function chunksToSrt(chunks, fallbackText = '') {
  const usable = Array.isArray(chunks) ? chunks.filter((chunk) => String(chunk?.text || '').trim()) : [];
  if (!usable.length) return plainTextToSrt(fallbackText);
  return usable.map((chunk, index) => {
    const timestamp = Array.isArray(chunk.timestamp) ? chunk.timestamp : [0, 0];
    const start = Number(timestamp[0]) || 0;
    const end = Number.isFinite(Number(timestamp[1])) ? Number(timestamp[1]) : start + 5;
    return `${index + 1}\n${secondsToSrtTime(start)} --> ${secondsToSrtTime(Math.max(end, start + 0.25))}\n${String(chunk.text || '').trim()}\n`;
  }).join('\n');
}


async function transcribeRecordingAutomatically(recordingPath, force = false) {
  const safe = safeRecordingPath(recordingPath);
  if (!fs.existsSync(safe)) throw new Error('Recording was not found.');
  lastRecordingPath = safe;
  const existing = transcriptPathsForRecording(safe);
  if (!force && fs.existsSync(existing.txt)) {
    const text = fs.readFileSync(existing.txt, 'utf8');
    const timeline = transcriptTimelineForRecording(safe);
    const srtText = timeline.srtText;
    const cache = await transcriptCacheState(safe, text, srtText);
    if (!cache.needsRefresh && cache.verified) {
      return { text, srtText, txtPath: existing.txt, srtPath: fs.existsSync(existing.srt) ? existing.srt : '', model: AUTO_TRANSCRIPTION_MODEL, cached: true, needsRefresh: false };
    }
    if (!cache.needsRefresh && srtText) {
      // One-time migration for recordings created by builds that stored SRT beside the media.
      saveTranscriptVerification(safe, text, srtText, { legacyAccepted: timeline.source === 'legacy-srt' });
      return { text, srtText, txtPath: existing.txt, srtPath: fs.existsSync(existing.srt) ? existing.srt : '', model: AUTO_TRANSCRIPTION_MODEL, cached: true, needsRefresh: false };
    }
    if (!cache.needsRefresh && /^\[(?:No audio track was captured|No speech detected)\]/i.test(String(text || '').trim())) {
      saveTranscriptVerification(safe, text, '', { noSpeechOrAudio: true });
      return { text, srtText: '', txtPath: existing.txt, srtPath: '', model: AUTO_TRANSCRIPTION_MODEL, cached: true, needsRefresh: false };
    }
  }

  const wavPath = path.join(app.getPath('temp'), `auto-transcribe-${Date.now()}.wav`);
  try {
    await extractSpeechAudio(safe, wavPath, 'wav');
  } catch (error) {
    if (/FFmpeg is unavailable|binary was not found/i.test(error.message || '')) throw error;
    throwIfRecordingProcessingCancelled(safe);
    const text = '[No audio track was captured in this recording]';
    const saved = saveTranscriptBesideRecording(safe, text);
    const srtText = '';
    saveTranscriptVerification(safe, text, srtText, { noAudio: true });
    return { text, srtText, txtPath: saved.txt, srtPath: '', model: AUTO_TRANSCRIPTION_MODEL, noAudio: true, cached: false };
  }
  try {
    const wavInfo = fs.statSync(wavPath);
    if (!wavInfo.size || wavInfo.size <= 44) {
      throwIfRecordingProcessingCancelled(safe);
      const text = '[No speech detected]';
      const saved = saveTranscriptBesideRecording(safe, text);
      const srtText = '';
      saveTranscriptVerification(safe, text, srtText, { noSpeech: true });
      return { text, srtText, txtPath: saved.txt, srtPath: '', model: AUTO_TRANSCRIPTION_MODEL, cached: false };
    }
    throwIfRecordingProcessingCancelled(safe);
    const output = await runAiWorkerQueued({
      task: 'transcribe',
      recordingName: path.basename(safe),
      recordingPath: safe,
      wavPath,
      cacheDir: path.join(app.getPath('userData'), 'models'),
      model: AUTO_TRANSCRIPTION_MODEL
    }, 30 * 60 * 1000, { preemptLowerPriority: true, staleTimeoutMs: 3 * 60 * 1000, stallRetries: 1 });
    throwIfRecordingProcessingCancelled(safe);
    const text = String(output?.text || '').trim() || '[No speech detected]';
    const srt = chunksToSrt(output?.chunks, text);
    const saved = saveTranscriptBesideRecording(safe, text);
    saveTranscriptVerification(safe, text, srt, output?.quality || {});
    return { text, srtText: srt, txtPath: saved.txt, srtPath: '', model: AUTO_TRANSCRIPTION_MODEL, cached: false, quality: output?.quality || {}, needsRefresh: false };
  } finally {
    try { fs.unlinkSync(wavPath); } catch {}
  }
}

function ensureAutomaticTranscriptionJob(recordingPath, force = false) {
  const safe = safeRecordingPath(recordingPath);
  if (automaticTranscriptionJobs.has(safe)) return automaticTranscriptionJobs.get(safe);
  cancelledRecordingProcessing.delete(safe);
  const job = recordingProcessingContext.run({ recordingPath: safe }, () => transcribeRecordingAutomatically(safe, force))
    .then((result) => {
      // The transcript is primary. Speaker detection follows at lower AI priority
      // and is also paused automatically if a new recording starts.
      void getOrGenerateSpeakerDiarization(safe, false).catch((error) => appendAiWorkerLog(`Automatic speaker detection failed for ${path.basename(safe)}: ${error?.message || error}`));
      return result;
    })
    .finally(() => automaticTranscriptionJobs.delete(safe));
  automaticTranscriptionJobs.set(safe, job);
  return job;
}

function sanitizedRecordingName(value, extension = '.mp4') {
  let name = String(value || '').trim();
  if (/[<>:"/\\|?*\x00-\x1F]/.test(name)) throw new Error('The file name contains characters that are not allowed on macOS/Windows.');
  name = name.replace(/[. ]+$/g, '').trim();
  if (!name) throw new Error('Enter a file name.');
  const requestedExt = extension.toLowerCase();
  const ext = requestedExt === '.m4a' ? '.m4a' : requestedExt === '.mp3' ? '.mp3' : '.mp4';
  if (!name.toLowerCase().endsWith(ext)) name = name.replace(/\.(mp4|m4a|mp3)$/i, '') + ext;
  const stem = name.slice(0, -ext.length);
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) throw new Error('That file name is reserved by Windows.');
  if (name.length > 180) throw new Error('The file name is too long.');
  return name;
}

function renameRecordingAndTranscript(recordingPath, requestedName) {
  const source = safeRecordingPath(recordingPath);
  if (!fs.existsSync(source)) throw new Error('Recording was not found.');
  if (automaticDiarizationJobs.has(source)) throw new Error('Wait for speaker detection to finish before renaming this recording.');
  const newName = sanitizedRecordingName(requestedName, path.extname(source));
  const target = safeRecordingPath(path.join(recordingsDirectory(), newName));
  if (source === target) return { path: source, name: path.basename(source), url: `recording://media?path=${encodeURIComponent(source)}` };
  if (fs.existsSync(target)) throw new Error('A recording with that name already exists.');

  const oldTranscripts = transcriptPathsForRecording(source);
  const newTranscripts = transcriptPathsForRecording(target);
  if (fs.existsSync(newTranscripts.txt) || fs.existsSync(newTranscripts.srt)) {
    throw new Error('Transcript files already exist for that target name. Choose another name.');
  }
  fs.renameSync(source, target);
  try {
    if (fs.existsSync(oldTranscripts.txt)) fs.renameSync(oldTranscripts.txt, newTranscripts.txt);
    if (fs.existsSync(oldTranscripts.srt)) fs.renameSync(oldTranscripts.srt, newTranscripts.srt);
  } catch (error) {
    try { if (fs.existsSync(target) && !fs.existsSync(source)) fs.renameSync(target, source); } catch {}
    try { if (fs.existsSync(newTranscripts.txt) && !fs.existsSync(oldTranscripts.txt)) fs.renameSync(newTranscripts.txt, oldTranscripts.txt); } catch {}
    try { if (fs.existsSync(newTranscripts.srt) && !fs.existsSync(oldTranscripts.srt)) fs.renameSync(newTranscripts.srt, oldTranscripts.srt); } catch {}
    throw new Error(`Could not rename transcript files: ${error.message}`);
  }
  migrateRecordingCategory(source, target);
  migrateRecordingMarkers(source, target);
  migrateRecordingVoiceHighlights(source, target);
  migrateRecordingInsights(source, target);
  migrateRecordingSpeakers(source, target);
  migrateRecordingTranscriptMetadata(source, target);
  if (lastRecordingPath === source) lastRecordingPath = target;
  return { path: target, name: newName, url: `recording://media?path=${encodeURIComponent(target)}`, txtPath: newTranscripts.txt, srtPath: fs.existsSync(newTranscripts.srt) ? newTranscripts.srt : '' };
}

function probeRecordingDuration(filePath, stat) {
  const cacheKey = `${filePath}|${stat.size}|${Math.round(stat.mtimeMs)}`;
  if (durationProbeCache.has(cacheKey)) return durationProbeCache.get(cacheKey);
  const promise = new Promise((resolve) => {
    const ffmpeg = safeFfmpegPath();
    if (!ffmpeg) return resolve(null);
    const child = spawn(ffmpeg, ['-hide_banner', '-i', filePath], { windowsHide: true });
    let stderr = '';
    child.stderr?.on('data', (data) => { stderr += data.toString(); });
    child.on('error', () => resolve(null));
    child.on('close', () => {
      const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
      if (!match) return resolve(null);
      const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
      resolve(Number.isFinite(seconds) ? seconds : null);
    });
  });
  durationProbeCache.set(cacheKey, promise);
  return promise;
}

async function listRecordings() {
  const dir = recordingsDirectory();
  const categoryMetadata = loadCategoryMetadata();
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(mp4|webm|m4a|mp3)$/i.test(entry.name));
  const files = await Promise.all(entries.map(async (entry) => {
    const filePath = path.join(dir, entry.name);
    const stat = fs.statSync(filePath);
    const transcripts = transcriptPathsForRecording(filePath);
    const durationSeconds = await probeRecordingDuration(filePath, stat);
    return {
      name: entry.name,
      path: filePath,
      url: `recording://media?path=${encodeURIComponent(filePath)}&v=${Math.round(stat.mtimeMs)}`,
      size: stat.size,
      modifiedMs: stat.mtimeMs,
      durationSeconds,
      category: categoryForRecording(filePath, categoryMetadata),
      hasTxt: fs.existsSync(transcripts.txt),
      hasSrt: fs.existsSync(transcripts.srt),
      markerCount: markersForRecording(filePath).length,
      mediaType: /\.(m4a|mp3)$/i.test(entry.name) ? 'audio' : 'video'
    };
  }));
  files.sort((a, b) => b.modifiedMs - a.modifiedMs);
  return { directory: dir, files, categories: categoryMetadata.categories };
}


async function waveformForRecording(recordingPath, points = 1200) {
  const safe = safeRecordingPath(recordingPath);
  if (!fs.existsSync(safe)) throw new Error('Recording was not found.');
  const stat = fs.statSync(safe);
  const count = Math.max(120, Math.min(2400, Number(points) || 1200));
  const cacheKey = `${safe}|${stat.size}|${Math.round(stat.mtimeMs)}|${count}`;
  if (waveformCache.has(cacheKey)) return waveformCache.get(cacheKey);
  const executable = safeFfmpegPath();
  if (!executable || !fs.existsSync(executable)) throw new Error('FFmpeg is unavailable. Run npm install again.');
  const promise = new Promise((resolve, reject) => {
    const child = spawn(executable, ['-v', 'error', '-i', safe, '-vn', '-ac', '1', '-ar', '1000', '-f', 's16le', 'pipe:1'], { windowsHide: true });
    const chunks = [];
    let stderr = '';
    child.stdout.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        if (/does not contain any stream|matches no streams|stream map/i.test(stderr)) return resolve({ samples: [], hasAudio: false });
        return reject(new Error(stderr || `Waveform extraction exited with code ${code}`));
      }
      const buffer = Buffer.concat(chunks);
      if (buffer.length < 2) return resolve({ samples: [], hasAudio: false });
      const totalSamples = Math.floor(buffer.length / 2);
      const bucket = Math.max(1, Math.floor(totalSamples / count));
      const samples = [];
      let peakOverall = 1;
      const raw = [];
      for (let start = 0; start < totalSamples; start += bucket) {
        const end = Math.min(totalSamples, start + bucket);
        let peak = 0;
        for (let i = start; i < end; i += 1) peak = Math.max(peak, Math.abs(buffer.readInt16LE(i * 2)));
        raw.push(peak);
        peakOverall = Math.max(peakOverall, peak);
        if (raw.length >= count) break;
      }
      for (const value of raw) samples.push(Number((value / peakOverall).toFixed(4)));
      resolve({ samples, hasAudio: true });
    });
  });
  waveformCache.set(cacheKey, promise);
  return promise;
}

function searchRecordingLibrary(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const dir = recordingsDirectory();
  const categories = loadCategoryMetadata();
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(mp4|webm|m4a|mp3)$/i.test(entry.name)) continue;
    const filePath = path.join(dir, entry.name);
    const category = categoryForRecording(filePath, categories);
    const transcripts = transcriptPathsForRecording(filePath);
    let transcript = '';
    try { if (fs.existsSync(transcripts.txt)) transcript = fs.readFileSync(transcripts.txt, 'utf8'); } catch {}
    const haystack = `${entry.name}\n${category}\n${transcript}`.toLowerCase();
    const at = haystack.indexOf(q);
    if (at < 0) continue;
    let snippet = '';
    const transcriptLower = transcript.toLowerCase();
    const transcriptAt = transcriptLower.indexOf(q);
    if (transcriptAt >= 0) snippet = transcript.slice(Math.max(0, transcriptAt - 55), Math.min(transcript.length, transcriptAt + q.length + 85)).replace(/\s+/g, ' ').trim();
    results.push({ path: filePath, snippet });
  }
  return results;
}

function rawScreenPermissionStatus() {
  if (process.platform !== 'darwin') return 'system-managed';
  try { return systemPreferences.getMediaAccessStatus('screen'); }
  catch { return 'unknown'; }
}

function effectiveScreenPermissionStatus() {
  const reported = rawScreenPermissionStatus();
  // A successful desktopCapturer enumeration is stronger evidence than a stale
  // getMediaAccessStatus('screen') result in the current macOS process.
  if (process.platform === 'darwin' && screenCaptureVerified) return 'granted';
  return reported;
}

function screenPermissionTargetName() {
  if (process.platform !== 'darwin') return APP_DISPLAY_NAME;
  // Source/local ZIP builds run inside Electron's stable signed host so TCC
  // correctly associates screen capture with Electron. Signed packaged builds
  // continue to use the PulseStudio bundle identity.
  return process.defaultApp || !app.isPackaged ? 'Electron' : APP_DISPLAY_NAME;
}

async function getDesktopSourcesResilient() {
  const common = { thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true };
  try {
    return await desktopCapturer.getSources({ types: ['screen', 'window'], ...common });
  } catch (combinedError) {
    // ScreenCaptureKit can occasionally fail a combined screen+window query even
    // when one source class is still available. Retry independently so a window
    // enumeration failure never prevents display recording (and vice versa).
    let screens = [];
    let windows = [];
    let screenError = null;
    let windowError = null;
    try { screens = await desktopCapturer.getSources({ types: ['screen'], ...common }); } catch (error) { screenError = error; }
    try { windows = await desktopCapturer.getSources({ types: ['window'], ...common }); } catch (error) { windowError = error; }
    const sources = [...screens, ...windows];
    if (sources.length) {
      console.warn('Combined desktop source enumeration failed; recovered with per-type retries.', combinedError);
      return sources;
    }
    const error = new Error(combinedError?.message || 'Failed to get desktop capture sources.');
    error.cause = combinedError;
    error.screenError = screenError;
    error.windowError = windowError;
    throw error;
  }
}

function readinessSnapshot() {
  const result = {
    platform: process.platform,
    recordingsDirectory: recordingsDirectory(),
    screen: effectiveScreenPermissionStatus(),
    microphone: process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('microphone') : 'system-managed',
    freeBytes: null,
    totalBytes: null
  };
  try {
    if (typeof fs.statfsSync === 'function') {
      const stat = fs.statfsSync(recordingsDirectory());
      result.freeBytes = Number(stat.bavail || stat.bfree || 0) * Number(stat.bsize || 0);
      result.totalBytes = Number(stat.blocks || 0) * Number(stat.bsize || 0);
    }
  } catch {}
  return result;
}

function registerGlobalRecorderShortcuts() {
  const bindings = {
    'CommandOrControl+Alt+R': 'record-toggle',
    'CommandOrControl+Alt+P': 'pause-toggle',
    'CommandOrControl+Alt+B': 'bookmark',
    'CommandOrControl+Alt+S': 'snapshot',
    'CommandOrControl+Alt+M': 'compact-toggle'
  };
  const registered = {};
  for (const [accelerator, action] of Object.entries(bindings)) {
    try {
      registered[action] = globalShortcut.register(accelerator, () => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('shortcut:action', action);
      });
    } catch { registered[action] = false; }
  }
  return registered;
}

function recordingMimeType(filePath) {
  if (/\.m4a$/i.test(filePath)) return 'audio/mp4';
  if (/\.mp3$/i.test(filePath)) return 'audio/mpeg';
  return /\.webm$/i.test(filePath) ? 'video/webm' : 'video/mp4';
}

function mediaResponseForRequest(request, filePath) {
  const stat = fs.statSync(filePath);
  const total = stat.size;
  const commonHeaders = {
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'Content-Type': recordingMimeType(filePath)
  };
  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers: { ...commonHeaders, 'Content-Length': String(total) } });
  }

  const range = request.headers.get('range');
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
    if (!match) return new Response('Invalid range', { status: 416, headers: { ...commonHeaders, 'Content-Range': `bytes */${total}` } });
    let start = match[1] ? Number(match[1]) : 0;
    let end = match[2] ? Number(match[2]) : total - 1;
    if (!match[1] && match[2]) {
      const suffix = Number(match[2]);
      start = Math.max(0, total - suffix);
      end = total - 1;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= total) {
      return new Response('Range not satisfiable', { status: 416, headers: { ...commonHeaders, 'Content-Range': `bytes */${total}` } });
    }
    end = Math.min(end, total - 1);
    const length = end - start + 1;
    const stream = fs.createReadStream(filePath, { start, end });
    return new Response(Readable.toWeb(stream), {
      status: 206,
      headers: {
        ...commonHeaders,
        'Content-Length': String(length),
        'Content-Range': `bytes ${start}-${end}/${total}`
      }
    });
  }

  const stream = fs.createReadStream(filePath);
  return new Response(Readable.toWeb(stream), { status: 200, headers: { ...commonHeaders, 'Content-Length': String(total) } });
}


function updateSafetyState() {
  if (activeTempPath || activeWriteStream || activeMicWriteStream || activeNeuralMicWriteStream || sealedRecordingSessions.size) return { safe: false, reason: 'recording or saving finishes' };
  if (aiWorkerManager.snapshot().activeId) return { safe: false, reason: 'local AI processing finishes' };
  const pending = listPendingRecoveries(recoveryDirectory());
  if (pending.length) return { safe: false, reason: `${pending.length === 1 ? 'an unfinished recording is recovered' : 'unfinished recordings are recovered'}` };
  return { safe: true, reason: '' };
}

const ZIP_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function zipCrc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = ZIP_CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipDosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const time = ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((Math.floor(date.getSeconds() / 2)) & 31);
  const day = ((year - 1980) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31);
  return { time, day };
}

function makeStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { time, day } = zipDosDateTime();
  for (const entry of entries) {
    const name = Buffer.from(String(entry.name || 'file').replace(/\\/g, '/'), 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data ?? ''), 'utf8');
    const crc = zipCrc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10); local.writeUInt16LE(day, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12); central.writeUInt16LE(day, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32); central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36); central.writeUInt32LE(0, 38); central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

function rnnoiseAssetStatus() {
  const root = path.join(__dirname, 'node_modules', '@sapphi-red', 'web-noise-suppressor', 'dist');
  const candidates = ['rnnoise.wasm', 'rnnoise_simd.wasm', 'rnnoise-simd.wasm'];
  return {
    root,
    installed: fs.existsSync(root),
    assets: Object.fromEntries(candidates.map((name) => [name, fs.existsSync(path.join(root, name))]))
  };
}

function readLogTail(filePath, maxBytes = 2 * 1024 * 1024) {
  try {
    const stat = fs.statSync(filePath);
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(filePath, 'r');
    try {
      const buffer = Buffer.alloc(stat.size - start);
      fs.readSync(fd, buffer, 0, buffer.length, start);
      return buffer;
    } finally { fs.closeSync(fd); }
  } catch { return null; }
}

async function exportDiagnosticsPackage(options = {}) {
  const defaultName = `pulsestudio-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.zip`;
  const pick = await dialog.showSaveDialog(mainWindow, { title: 'Export PulseStudio Diagnostics', defaultPath: path.join(app.getPath('downloads'), defaultName), filters: [{ name: 'ZIP archive', extensions: ['zip'] }] });
  if (pick.canceled || !pick.filePath) return { cancelled: true };
  const snapshot = diagnosticsSnapshot();
  let ffmpegMajor = null;
  try { ffmpegMajor = await ffmpegMajorVersion(); } catch {}
  const diagnostic = {
    exportedAt: new Date().toISOString(),
    diagnostics: snapshot,
    recordingHealth: recordingHealthSnapshot(),
    lastRecording: lastRecordingDiagnosticMeta,
    recoveryJournal: readRecoveryJournal(),
    voiceProfile: publicVoiceProfileStatus(),
    audioRuntime: { ffmpegPath: safeFfmpegPath(), ffmpegMajor, rnnoise: rnnoiseAssetStatus() }
  };
  const entries = [
    { name: 'README.txt', data: 'PulseStudio diagnostics package. It contains logs and technical metadata only. The actual recording is excluded unless you explicitly selected Include current recording when exporting.\n' },
    { name: 'diagnostics.json', data: JSON.stringify(diagnostic, null, 2) }
  ];
  const logDir = activityLogger.directory || path.resolve(__dirname, 'logs');
  for (const name of ['pulsestudio.log', 'pulsestudio.1.log', 'pulsestudio.2.log', 'pulsestudio.3.log', 'pulsestudio.4.log']) {
    const data = readLogTail(path.join(logDir, name));
    if (data?.length) entries.push({ name: `logs/${name}`, data });
  }
  if (options.includeRecording === true && options.recordingPath) {
    try {
      const recordingPath = safeRecordingPath(options.recordingPath);
      const stat = fs.statSync(recordingPath);
      if (stat.size <= 100 * 1024 * 1024) entries.push({ name: `recording/${path.basename(recordingPath)}`, data: fs.readFileSync(recordingPath) });
      else entries.push({ name: 'recording/NOT_INCLUDED.txt', data: `The explicitly selected recording was ${Math.round(stat.size / 1024 / 1024)} MB and was not embedded because the diagnostics exporter limits embedded recordings to 100 MB.\nPath: ${recordingPath}\n` });
    } catch (error) {
      entries.push({ name: 'recording/NOT_INCLUDED.txt', data: `The explicitly selected recording could not be included: ${error.message || error}\n` });
    }
  }
  fs.writeFileSync(pick.filePath, makeStoredZip(entries));
  activityLog('info', 'diagnostics.exported', { path: path.basename(pick.filePath), includeRecording: Boolean(options.includeRecording), entries: entries.length });
  return { cancelled: false, path: pick.filePath };
}

function diagnosticsSnapshot() {
  const readiness = readinessSnapshot();
  const permissions = process.platform === 'darwin' ? {
    screen: effectiveScreenPermissionStatus(),
    screenReported: rawScreenPermissionStatus(),
    screenCaptureVerified: Boolean(screenCaptureVerified),
    screenPermissionTarget: screenPermissionTargetName(),
    microphone: systemPreferences.getMediaAccessStatus('microphone'),
    camera: systemPreferences.getMediaAccessStatus('camera')
  } : { screen: 'system-managed', microphone: 'system-managed', camera: 'system-managed' };
  const ai = aiWorkerManager.snapshot();
  const models = localModelManager.summary();
  return {
    productName: app.getName(), version: app.getVersion(), packaged: app.isPackaged,
    platform: process.platform, arch: process.arch, release: os.release(),
    electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node,
    recordingsDirectory: recordingsDirectory(), freeBytes: readiness.freeBytes, totalBytes: readiness.totalBytes,
    logDirectory: activityLogger.directory || path.resolve(__dirname, 'logs'),
    logFile: activityLogger.filePath || path.resolve(__dirname, 'logs', 'pulsestudio.log'),
    permissions, videoEncoding: videoEncoderManager.capabilities(),
    ai: { workerAlive: ai.workerAlive, activeJobs: ai.jobs.length, activeId: ai.activeId || '', paused: Boolean(ai.paused), pauseReason: ai.pauseReason || '' },
    recovery: { pending: listPendingRecoveries(recoveryDirectory()).length, active: Boolean(activeTempPath || activeWriteStream || sealedRecordingSessions.size), finalizing: sealedRecordingSessions.size },
    recordingHealth: recordingHealthSnapshot(),
    lastRecording: lastRecordingDiagnosticMeta,
    audioProcessing: { ffmpegPath: safeFfmpegPath(), rnnoise: rnnoiseAssetStatus() },
    voiceProfile: publicVoiceProfileStatus(),
    models: { cacheDir: models.cacheDir, bytes: models.cacheBytes, installed: models.models.filter((item) => item.installed).length, total: models.models.length },
    update: updateManager?.snapshot?.() || { state: app.isPackaged ? 'initializing' : 'development', configured: false }
  };
}

app.whenReady().then(async () => {
  applyApplicationIdentity();

  // Serve local microphone-denoiser assets from node_modules through a secure custom
  // protocol. Renderer code stays sandboxed with nodeIntegration disabled.
  protocol.handle('appasset', async (request) => {
    try {
      const requestUrl = new URL(request.url);
      let root;
      let defaultAsset = 'index.js';
      if (requestUrl.hostname === 'noise') {
        root = path.join(__dirname, 'node_modules', '@sapphi-red', 'web-noise-suppressor', 'dist');
      } else if (requestUrl.hostname === 'deepfilter') {
        root = path.join(__dirname, 'node_modules', 'deepfilternet3-noise-filter', 'dist');
        defaultAsset = 'index.esm.js';
      } else {
        return new Response('Not found', { status: 404 });
      }
      const relative = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '');
      const assetPath = path.resolve(root, relative || defaultAsset);
      const rootResolved = path.resolve(root) + path.sep;
      if (!assetPath.startsWith(rootResolved) && assetPath !== path.resolve(root)) {
        return new Response('Invalid asset path', { status: 400 });
      }
      if (!fs.existsSync(assetPath) || !fs.statSync(assetPath).isFile()) return new Response('Not found', { status: 404 });
      const ext = path.extname(assetPath).toLowerCase();
      const contentType = ext === '.wasm' ? 'application/wasm' : ext === '.js' ? 'text/javascript; charset=utf-8' : 'application/octet-stream';
      const body = fs.readFileSync(assetPath);
      return new Response(body, { status: 200, headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=31536000, immutable', 'Access-Control-Allow-Origin': '*' } });
    } catch (error) {
      return new Response(error.message, { status: 400 });
    }
  });

  protocol.handle('recording', async (request) => {
    try {
      const requestUrl = new URL(request.url);
      const filePath = safeRecordingPath(requestUrl.searchParams.get('path'));
      if (!fs.existsSync(filePath)) return new Response('Not found', { status: 404 });
      return mediaResponseForRequest(request, filePath);
    } catch (error) {
      return new Response(error.message, { status: 400 });
    }
  });

  // Renderer-level media permissions are handled silently for the trusted recorder
  // window. OS privacy controls (macOS Screen Recording / Microphone / Camera and
  // Windows equivalents) remain system-managed and can never be auto-accepted.
  const isTrustedRecorderContents = (webContents) => Boolean(
    mainWindow && !mainWindow.isDestroyed() && webContents && webContents.id === mainWindow.webContents.id
  );
  const silentlyAllowedPermissions = new Set(['media', 'display-capture', 'mediaKeySystem']);

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return isTrustedRecorderContents(webContents) && silentlyAllowedPermissions.has(permission);
  });

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(isTrustedRecorderContents(webContents) && silentlyAllowedPermissions.has(permission));
  });

  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await getDesktopSourcesResilient();
      // Never silently capture a different display/window if the selected source
      // disappeared between selection and Start. Fail closed so the renderer can
      // refresh sources and ask the user to choose again.
      const source = sources.find((s) => s.id === selectedSourceId);
      if (!source) return callback({});
      callback({ video: source, audio: _request.audioRequested ? 'loopback' : undefined });
    } catch (error) {
      console.error('Display media handler failed:', error);
      callback({});
    }
  });

  // v0.2.59 launch visibility fix: determine whether recovery is needed using only
  // quick journal reads, create/show the BrowserWindow immediately, then perform any
  // potentially long FFmpeg recovery work in the background.
  // v0.2.86: move a previous-session active journal into its own pending
  // manifest before any new capture can start. This frees active-recording.json for
  // the next recording and makes background recovery independent/cancellable.
  stageInterruptedActiveJournalForRecovery();
  const pendingRecoveryAtLaunch = hasPendingRecoveryWork();
  const startupPendingRecoveries = listPendingRecoveries(recoveryDirectory());
  const pausedRecoveryAtLaunch = startupPendingRecoveries.some((item) => item.manifest?.status === 'paused_by_user');
  startupRecoveryInProgress = false;
  if (pendingRecoveryAtLaunch || pausedRecoveryAtLaunch) {
    pendingRecoveryNotice = {
      recovered: false,
      paused: pausedRecoveryAtLaunch,
      available: true,
      title: pausedRecoveryAtLaunch ? 'Unfinished recording saved for later' : 'Unfinished recording available',
      message: 'The interrupted recording is protected. Recover it whenever convenient; new recordings are available normally and no recovery work runs in the background.'
    };
  }
  createWindow();

  // Keep Mini pinned to the user's last deliberate position across macOS
  // display sleep/wake, unlock, Spaces/display geometry changes, and transient
  // work-area recalculations. The delayed repair runs after macOS finishes its
  // own window placement pass.
  if (process.platform === 'darwin') {
    const repairAfterDisplayChange = () => scheduleCompactWindowPositionRepair(180);
    try { screen.on('display-metrics-changed', repairAfterDisplayChange); } catch {}
    try { screen.on('display-added', repairAfterDisplayChange); } catch {}
    try { screen.on('display-removed', repairAfterDisplayChange); } catch {}
    try { powerMonitor.on('resume', () => scheduleCompactWindowPositionRepair(350)); } catch {}
    try { powerMonitor.on('unlock-screen', () => scheduleCompactWindowPositionRepair(220)); } catch {}
  }

  try {
    app.setAboutPanelOptions({
      applicationName: APP_DISPLAY_NAME,
      applicationVersion: app.getVersion(),
      copyright: 'Created by Girish Gupta · girish.gupta@gmail.com'
    });
  } catch {}
  installApplicationMenu();
  updateManager = new RecoveryAwareUpdateManager({
    app,
    getWindow: () => mainWindow,
    isSafe: updateSafetyState,
    configPath: path.join(__dirname, 'update-feed.json')
  });
  updateManager.init();
  registerGlobalRecorderShortcuts();
  void runStartupMaintenance(pendingRecoveryAtLaunch);

  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed() || BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      return;
    }
    ensureMainWindowVisible();
  });
});

if (hasSingleInstanceLock) {
  app.on('second-instance', () => {
    if (!app.isReady()) return;
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
      return;
    }
    ensureMainWindowVisible();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  appIsQuitting = true;
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      const bounds = mainWindow.getBounds();
      if (activeWindowMode === 'compact') {
        compactWindowBounds = { ...normalizeCompactBounds(bounds) };
        persistCompactWindowBounds(compactWindowBounds);
      } else {
        fullWindowBounds = { ...bounds };
      }
    } catch {}
  }
  persistWindowViewState();
  clearTimeout(windowViewStateSaveTimer);
  clearTimeout(startupWindowShowFailsafeTimer);
  clearTimeout(compactBoundsSaveTimer);
  clearTimeout(compactPositionRepairTimer);
  if (compactWindowBounds) persistCompactWindowBounds(compactWindowBounds);
  updateManager?.shutdown?.();
  aiWorkerManager.shutdown();
  getRecoveryJournalManager().flush();
  globalShortcut.unregisterAll();
  stopKeyHook();
  try {
    if (applicationAudioProcess?.kind === 'windows-process-loopback') applicationAudioProcess.abort?.();
    else applicationAudioProcess?.kill?.('SIGTERM');
  } catch {}
  try { activeWriteStream?.destroy(); } catch {}
  try { activeMicWriteStream?.destroy(); } catch {}
  try { activeNeuralMicWriteStream?.destroy(); } catch {}
});


function eventIsFromMainWindow(event) {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && event?.sender?.id === mainWindow.webContents.id);
}

// Full mode uses an explicit pointer-following drag path rather than relying on
// Chromium drag regions. This keeps movement deterministic on every click-drag,
// including mixed-DPI multi-display setups where native drag regions can feel
// intermittent. Electron's screen cursor coordinates and BrowserWindow position
// are both in DIP, so the window stays locked to the initial pointer offset.
ipcMain.on('window:drag-start', (event) => {
  if (!eventIsFromMainWindow(event) || !mainWindow) return;
  if (mainWindow.isDestroyed() || mainWindow.isFullScreen() || mainWindow.isMaximized()) return;
  const cursor = screen.getCursorScreenPoint();
  const bounds = mainWindow.getBounds();
  activeManualWindowDrag = {
    cursorX: cursor.x, cursorY: cursor.y, windowX: bounds.x, windowY: bounds.y,
    width: bounds.width, height: bounds.height, mode: activeWindowMode
  };
});

ipcMain.on('window:drag-move', (event) => {
  if (!eventIsFromMainWindow(event) || !activeManualWindowDrag || !mainWindow || mainWindow.isDestroyed()) return;
  const cursor = screen.getCursorScreenPoint();
  let x = Math.round(activeManualWindowDrag.windowX + (cursor.x - activeManualWindowDrag.cursorX));
  let y = Math.round(activeManualWindowDrag.windowY + (cursor.y - activeManualWindowDrag.cursorY));
  if (activeManualWindowDrag.mode === 'compact') {
    const snapped = snapCompactPosition(x, y, activeManualWindowDrag.width, activeManualWindowDrag.height, cursor);
    x = snapped.x;
    y = snapped.y;
  }
  try { mainWindow.setPosition(x, y, false); } catch {}
});

ipcMain.on('window:drag-end', (event) => {
  if (!eventIsFromMainWindow(event)) return;
  activeManualWindowDrag = null;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (activeWindowMode === 'full') {
    fullWindowBounds = { ...mainWindow.getBounds() };
    persistWindowViewState();
  }
  else {
    compactWindowBounds = { ...mainWindow.getBounds() };
    persistCompactWindowBounds(compactWindowBounds);
  }
});

ipcMain.handle('window:set-compact', (_event, compact) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { compact: Boolean(compact) };
  const wantsCompact = Boolean(compact);
  const currentBounds = mainWindow.getBounds();

  switchingWindowMode = true;
  try {
    applyNativeWindowControlsForMode(wantsCompact ? 'compact' : 'full');
    if (wantsCompact) {
      // Remember exactly where/what size Full view was before leaving it.
      if (activeWindowMode !== 'compact') fullWindowBounds = { ...currentBounds };

      lockCompactWindowSize();
      const previous = compactWindowBounds;
      const target = normalizeCompactBounds({ ...(previous || currentBounds), x: previous?.x ?? currentBounds.x, y: previous?.y ?? currentBounds.y, width: COMPACT_WINDOW_WIDTH, height: COMPACT_WINDOW_HEIGHT });
      mainWindow.setBounds(target, false);
      activeWindowMode = 'compact';
      compactWindowBounds = { ...mainWindow.getBounds() };
      scheduleCompactWindowBoundsSave(compactWindowBounds);
    } else {
      // Capture and persist the Compact position before restoring Full.
      if (activeWindowMode === 'compact') {
        compactWindowBounds = { ...currentBounds };
        persistCompactWindowBounds(compactWindowBounds);
      }

      unlockFullWindowSize();
      const target = fullWindowBounds || { x: currentBounds.x, y: currentBounds.y, width: 1320, height: 900 };
      mainWindow.setBounds(target, false);
      activeWindowMode = 'full';
      fullWindowBounds = { ...mainWindow.getBounds() };
    }
  } finally {
    switchingWindowMode = false;
  }

  persistWindowViewState();
  return { compact: wantsCompact, bounds: mainWindow.getBounds() };
});

ipcMain.handle('window:get-view-state', (event) => {
  if (!eventIsFromMainWindow(event)) return { mode: 'full', hasSavedState: false };
  const saved = readSavedWindowViewState();
  return {
    mode: activeWindowMode === 'compact' ? 'compact' : 'full',
    hasSavedState: Boolean(saved)
  };
});

ipcMain.handle('window:ui-ready', (event) => {
  if (!eventIsFromMainWindow(event)) return false;
  rendererUiReady = true;
  return maybeShowStartupWindow();
});

ipcMain.handle('window:set-compact-expanded', (_event, expanded) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { expanded: false };
  // v0.2.64: Mini's outer window is fixed. Legacy expansion requests are safely
  // ignored so stale renderer/preferences cannot make the HUD taller.
  if (activeWindowMode === 'compact') enforceCompactWindowSize();
  return { expanded: false, requested: Boolean(expanded), bounds: mainWindow.getBounds() };
});

ipcMain.handle('window:set-compact-recording-state', (event, active) => {
  if (!eventIsFromMainWindow(event) || !mainWindow || mainWindow.isDestroyed()) return { active: Boolean(active) };
  if (activeWindowMode !== 'compact') return { active: Boolean(active), bounds: mainWindow.getBounds() };
  const current = mainWindow.getBounds();
  const positionBasis = process.platform === 'darwin' && compactWindowBounds && !activeManualWindowDrag
    ? compactWindowBounds
    : current;
  const target = compactBoundsForRecordingState(positionBasis, Boolean(active));
  switchingWindowMode = true;
  try {
    lockCompactWindowSize();
    mainWindow.setBounds(target, false);
    compactWindowBounds = { ...mainWindow.getBounds() };
    persistCompactWindowBounds(compactWindowBounds);
  } finally {
    switchingWindowMode = false;
  }
  return { active: Boolean(active), bounds: mainWindow.getBounds() };
});

ipcMain.handle('window:fit-compact-content', (event, requestedHeight) => {
  if (!eventIsFromMainWindow(event) || !mainWindow || mainWindow.isDestroyed()) return { fitted: false };
  if (activeWindowMode !== 'compact') return { fitted: false, bounds: mainWindow.getBounds() };
  // Content fitting may update internal layout, but it must never resize Mini.
  // This also repairs any stale oversized Mini window immediately.
  const bounds = enforceCompactWindowSize() || mainWindow.getBounds();
  scheduleCompactWindowBoundsSave(bounds);
  return { fitted: true, requestedHeight: Number(requestedHeight) || COMPACT_WINDOW_HEIGHT, bounds };
});

ipcMain.handle('window:minimize', (event) => {
  if (!eventIsFromMainWindow(event) || !mainWindow || mainWindow.isDestroyed()) return false;
  try { mainWindow.minimize(); return true; } catch { return false; }
});

ipcMain.handle('window:close', (event) => {
  if (!eventIsFromMainWindow(event) || !mainWindow || mainWindow.isDestroyed()) return false;
  try { mainWindow.close(); return true; } catch { return false; }
});

ipcMain.handle('window:set-always-on-top', (_event, enabled) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { enabled: false };
  const value = Boolean(enabled);
  try { mainWindow.setAlwaysOnTop(value, value ? 'floating' : 'normal'); } catch {
    try { mainWindow.setAlwaysOnTop(value); } catch {}
  }
  return { enabled: mainWindow.isAlwaysOnTop() };
});

ipcMain.handle('window:get-capture-privacy', (event) => {
  if (!eventIsFromMainWindow(event)) return windowCapturePrivacySnapshot(null);
  return windowCapturePrivacySnapshot(mainWindow);
});

ipcMain.handle('window:set-capture-privacy', (event, enabled) => {
  if (!eventIsFromMainWindow(event)) return windowCapturePrivacySnapshot(mainWindow);
  windowCapturePrivacyEnabled = Boolean(enabled);
  windowCapturePrivacyPreferenceLoaded = true;
  persistWindowCapturePrivacyPreference();
  applyWindowCaptureProtection(mainWindow);
  return windowCapturePrivacySnapshot(mainWindow);
});

ipcMain.handle('window:set-transparency', (_event, percent) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { percent: 0, opacity: 1 };
  const allowed = new Set([0, 10, 20, 30, 50]);
  const requested = Number(percent);
  const value = allowed.has(requested) ? requested : 0;
  const opacity = Math.max(0.5, Math.min(1, 1 - (value / 100)));
  if (recordingPerformanceModeActive && activeWindowMode === 'full') {
    // Remember a preference changed during capture, but keep the temporary opaque
    // performance surface until recording ends.
    if (!recordingPerformanceWindowState) recordingPerformanceWindowState = { opacity };
    else recordingPerformanceWindowState.opacity = opacity;
    return { percent: value, opacity: 1, deferredUntilRecordingStops: true };
  }
  try { mainWindow.setOpacity(opacity); } catch {}
  return { percent: value, opacity };
});

ipcMain.handle('window:set-recording-performance', (event, enabled) => {
  if (!eventIsFromMainWindow(event)) return { active: false };
  return setRecordingPerformanceWindowMode(Boolean(enabled));
});

ipcMain.handle('window:toggle-player-fullscreen', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const next = !mainWindow.isFullScreen();
  mainWindow.setFullScreen(next);
  return next;
});

ipcMain.handle('window:exit-player-fullscreen', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
  return false;
});

ipcMain.handle('app:platform-info', () => {
  const windowsCapability = process.platform === 'win32' ? windowsApplicationAudioCapability() : null;
  return {
    platform: process.platform,
    release: os.release(),
    arch: process.arch,
    versions: process.versions,
    recordingsDirectory: recordingsDirectory(),
    version: app.getVersion(),
    applicationAudioSupported: process.platform === 'darwin' || Boolean(windowsCapability?.supported),
    applicationAudioCapability: process.platform === 'darwin'
      ? { supported: true, message: 'Selected application audio is available on this Mac.' }
      : windowsCapability,
    videoEncoding: videoEncoderManager.capabilities(),
    startupRecoveryInProgress: Boolean(startupRecoveryInProgress)
  };
});

ipcMain.handle('app:diagnostics', () => diagnosticsSnapshot());
ipcMain.handle('app:export-diagnostics', (_event, options = {}) => exportDiagnosticsPackage(options));
ipcMain.handle('models:list', () => localModelManager.summary());
ipcMain.handle('models:download', async (_event, modelId) => localModelManager.download(String(modelId || '')));
ipcMain.handle('models:remove', (_event, modelId) => localModelManager.remove(String(modelId || '')));
ipcMain.handle('models:open-folder', () => { const dir = localModelManager.cacheDir(); fs.mkdirSync(dir, { recursive: true }); shell.openPath(dir); return dir; });
ipcMain.handle('update:status', () => updateManager?.snapshot?.() || { state: 'unavailable', configured: false });
ipcMain.handle('update:check', () => updateManager?.check?.(true) || { state: 'unavailable' });
ipcMain.handle('update:install', () => { getRecoveryJournalManager().flush(); return updateManager?.install?.() || { ok: false, reason: 'Updater is unavailable.' }; });

ipcMain.handle('capture:list-sources', async () => {
  let sources;
  try {
    // The real desktop capture call is the source of truth on macOS. Do not gate it
    // behind getMediaAccessStatus('screen'), which can stay stale after the user has
    // already enabled PulseStudio in System Settings. This restores the earlier
    // capability-first behavior: if capture works, the app works.
    sources = await getDesktopSourcesResilient();
    if (process.platform === 'darwin') {
      screenCaptureVerified = sources.some((source) => String(source.id || '').startsWith('screen:'));
    }
  } catch (error) {
    if (process.platform === 'darwin') screenCaptureVerified = false;
    throw error;
  }
  const displays = screen.getAllDisplays();
  let screenIndex = 0;
  return sources.map((s) => {
    const kind = s.id.startsWith('screen:') ? 'screen' : 'window';
    let display = displays.find((item) => String(item.id) === String(s.display_id || ''));
    if (kind === 'screen' && !display) display = displays[screenIndex] || null;
    if (kind === 'screen') screenIndex += 1;
    return {
      id: s.id,
      name: s.name,
      kind,
      displayId: s.display_id || (display ? String(display.id) : ''),
      displayBounds: display ? display.bounds : null,
      displayScaleFactor: display ? display.scaleFactor : 1,
      thumbnail: s.thumbnail?.toDataURL() || '',
      icon: s.appIcon?.toDataURL() || ''
    };
  });
});

ipcMain.handle('capture:select-source', (_event, sourceId) => {
  selectedSourceId = sourceId;
  return true;
});


ipcMain.handle('capture:cursor-position', () => {
  const point = screen.getCursorScreenPoint();
  return { x: point.x, y: point.y };
});

ipcMain.handle('capture:keystrokes-enabled', (_event, enabled) => {
  if (enabled) return startKeyHook();
  stopKeyHook();
  return { enabled: false };
});

ipcMain.handle('permissions:get', () => {
  if (process.platform !== 'darwin') return { screen: 'system-managed', microphone: 'system-managed', camera: 'system-managed' };
  return {
    screen: effectiveScreenPermissionStatus(),
    screenReported: rawScreenPermissionStatus(),
    screenCaptureVerified: Boolean(screenCaptureVerified),
    screenPermissionTarget: screenPermissionTargetName(),
    microphone: systemPreferences.getMediaAccessStatus('microphone'),
    camera: systemPreferences.getMediaAccessStatus('camera')
  };
});


ipcMain.handle('permissions:open-screen-settings', async () => {
  if (process.platform !== 'darwin') return { opened: false, supported: false };
  const urls = [
    'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture'
  ];
  for (const url of urls) {
    try {
      await shell.openExternal(url);
      return { opened: true, supported: true };
    } catch {}
  }
  try {
    const openError = await shell.openPath('/System/Applications/System Settings.app');
    return { opened: !openError, supported: true, error: openError || '' };
  } catch (error) {
    return { opened: false, supported: true, error: error?.message || String(error) };
  }
});

ipcMain.on('app:log-event', (_event, payload = {}) => {
  const level = ['debug', 'info', 'warn', 'error'].includes(String(payload.level || '').toLowerCase()) ? String(payload.level).toLowerCase() : 'info';
  const event = String(payload.event || 'renderer.event').slice(0, 160);
  const details = payload.details && typeof payload.details === 'object' ? payload.details : { message: String(payload.details || '') };
  activityLog(level, event, { source: 'renderer', ...details });
});

ipcMain.handle('app:open-log-folder', () => {
  const dir = activityLogger.directory || path.resolve(__dirname, 'logs');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  shell.openPath(dir);
  return dir;
});

ipcMain.handle('permissions:request-microphone', async () => {
  if (process.platform !== 'darwin') return true;
  return systemPreferences.askForMediaAccess('microphone');
});

ipcMain.handle('permissions:request-camera', async () => {
  if (process.platform !== 'darwin') return true;
  return systemPreferences.askForMediaAccess('camera');
});

ipcMain.handle('recording:health', () => recordingHealthSnapshot());

ipcMain.handle('recording:checkpoint', (_event, payload = {}) => {
  if (!activeTempPath) return { ok: false, reason: 'No active recording.' };
  const elapsedMs = Math.max(0, Number(payload.elapsedMs) || 0);
  const durationSeconds = elapsedMs > 0 ? elapsedMs / 1000 : Infinity;
  const dynamicMeta = {
    elapsedMs,
    markers: normalizeMarkers(payload.markers || activeRecordingMeta.markers || []),
    voiceHighlights: normalizeVoiceHighlights(payload.voiceHighlights || activeRecordingMeta.voiceHighlights || [], durationSeconds),
    sourceName: String(payload.sourceName || activeRecordingMeta.sourceName || '').slice(0, 300),
    sourceId: String(payload.sourceId || activeRecordingMeta.sourceId || '').slice(0, 300),
    sourceDisplayId: String(payload.sourceDisplayId || activeRecordingMeta.sourceDisplayId || '').slice(0, 120),
    captureMode: String(payload.captureMode || activeRecordingMeta.captureMode || '').slice(0, 80),
    captureDeviceMetadata: payload.captureDeviceMetadata && typeof payload.captureDeviceMetadata === 'object' ? payload.captureDeviceMetadata : activeRecordingMeta.captureDeviceMetadata,
    processingStatus: payload.processingStatus && typeof payload.processingStatus === 'object' ? payload.processingStatus : activeRecordingMeta.processingStatus,
    checkpointAt: Date.now()
  };
  activeRecordingMeta = { ...activeRecordingMeta, ...dynamicMeta };
  lastRecordingDiagnosticMeta = { ...lastRecordingDiagnosticMeta, ...activeRecordingMeta };
  writeRecoveryJournal({ status: 'recording', checkpointReason: String(payload.reason || 'interval').slice(0, 80), checkpointAt: Date.now() }, true);
  return { ok: true, checkpointAt: Date.now() };
});

ipcMain.handle('voice:profile-status', () => publicVoiceProfileStatus());
ipcMain.handle('voice:enroll', (_event, payload = {}) => enrollVoiceProfileFromPayload(payload));
ipcMain.handle('voice:clear', () => clearVoiceProfile());

ipcMain.handle('recording:begin-file', async (_event, payload = {}) => {
  // A new capture always has priority over recovery. Previous-session recovery has
  // already been detached into a pending manifest, so stopping its FFmpeg work here
  // cannot overwrite or lose the protected source.
  if (startupRecoveryInProgress) requestRecoveryCancellation('Recovery was paused because a new recording started. The unfinished recording remains protected.');
  await closeActiveStream();
  await closeActiveMicStream();
  await closeActiveNeuralMicStream();
  if (activeTempPath && fs.existsSync(activeTempPath)) {
    preserveActiveRecordingForRecovery('A new recording was started before the previous capture was finalized.');
    resetActiveRecordingState({ clearJournal: false });
  }
  const config = typeof payload === 'string' ? { mimeType: payload } : (payload || {});
  activeMimeType = config.mimeType || 'video/webm';
  activeRecordingKind = config.recordingKind === 'audio' ? 'audio' : 'video';
  activeFilenameTemplate = String(config.filenameTemplate || 'Screen Recording {date} {time}');
  activeRecordingMeta = { ...(config.meta || {}), recordingKind: activeRecordingKind };
  activeBytesWritten = 0;
  activeMicBytesWritten = 0;
  activeNeuralMicBytesWritten = 0;
  activeRecordingHealth = {
    startedAt: Date.now(), lastChunkAt: Date.now(), lastMicChunkAt: 0, lastNeuralMicChunkAt: 0,
    lastWriteError: '', lastMicWriteError: '', lastNeuralMicWriteError: ''
  };
  activeNeuralMicMethod = String(config.neuralMicrophoneMethod || activeRecordingMeta.neuralMicrophoneMethod || 'none');
  activeMicNoiseMode = normalizeMicNoiseMode(config.microphoneNoiseMode || activeRecordingMeta.noiseReduction || 'off');
  const ext = activeMimeType.includes('mp4') ? '.mp4' : activeMimeType.includes('audio') ? '.webm' : '.webm';
  activeTempPath = path.join(recoveryDirectory(), `pulsestudio-${Date.now()}${ext}`);
  activeWriteStream = fs.createWriteStream(activeTempPath);
  activeWriteStream.on('error', (error) => {
    activeRecordingHealth.lastWriteError = String(error?.message || error || 'Disk write interrupted');
    activityLog('error', 'recording.writer-error', { error, tempFile: path.basename(activeTempPath || '') });
  });
  if (config.hasMicrophone) {
    activeMicMimeType = String(config.microphoneMimeType || 'audio/webm');
    const micExt = activeMicMimeType.includes('mp4') ? '.m4a' : '.webm';
    activeMicTempPath = path.join(recoveryDirectory(), `microphone-${Date.now()}-${process.pid}${micExt}`);
    activeMicWriteStream = fs.createWriteStream(activeMicTempPath);
    activeMicWriteStream.on('error', (error) => {
      activeRecordingHealth.lastMicWriteError = String(error?.message || error || 'Microphone write interrupted');
      activityLog('error', 'recording.microphone-writer-error', { error });
    });
  } else {
    activeMicMimeType = null;
    activeMicTempPath = null;
  }
  if (config.hasNeuralMicrophone) {
    activeNeuralMicMimeType = String(config.neuralMicrophoneMimeType || 'audio/webm');
    const neuralExt = activeNeuralMicMimeType.includes('mp4') ? '.m4a' : '.webm';
    activeNeuralMicTempPath = path.join(recoveryDirectory(), `microphone-neural-${Date.now()}-${process.pid}${neuralExt}`);
    activeNeuralMicWriteStream = fs.createWriteStream(activeNeuralMicTempPath);
    activeNeuralMicWriteStream.on('error', (error) => {
      activeRecordingHealth.lastNeuralMicWriteError = String(error?.message || error || 'Processed microphone write interrupted');
      activityLog('error', 'recording.neural-microphone-writer-error', { error });
    });
  } else {
    activeNeuralMicMimeType = null;
    activeNeuralMicTempPath = null;
    activeNeuralMicMethod = 'none';
  }
  getRecoveryJournalManager().begin({ createdAt: Date.now(), status: 'recording' });
  lastRecordingChunkLogAt = Date.now();
  setRecordingResourcePriority(true, 'recording-file-opened');
  activityLog('info', 'recording.begin', {
    tempFile: path.basename(activeTempPath || ''),
    mimeType: activeMimeType,
    kind: activeRecordingKind,
    meta: activeRecordingMeta,
    microphone: Boolean(activeMicTempPath),
    processedMicrophone: Boolean(activeNeuralMicTempPath)
  });
  return { ok: true, tempPath: activeTempPath, microphoneTempPath: activeMicTempPath, neuralMicrophoneTempPath: activeNeuralMicTempPath };
});

ipcMain.handle('recording:chunk', async (_event, data) => {
  if (!activeWriteStream) throw new Error('No active recording file.');
  const buffer = Buffer.from(data);
  await new Promise((resolve, reject) => {
    activeWriteStream.write(buffer, (err) => err ? reject(err) : resolve());
  });
  activeBytesWritten += buffer.length;
  activeRecordingHealth.lastChunkAt = Date.now();
  writeRecoveryJournal();
  const now = Date.now();
  if (now - lastRecordingChunkLogAt >= 30000) {
    lastRecordingChunkLogAt = now;
    activityLog('info', 'recording.chunk-heartbeat', { chunkBytes: buffer.length, totalBytes: activeBytesWritten });
  }
  return true;
});

ipcMain.handle('recording:mic-chunk', async (_event, data) => {
  if (!activeMicWriteStream) return false;
  const buffer = Buffer.from(data);
  await new Promise((resolve, reject) => {
    activeMicWriteStream.write(buffer, (err) => err ? reject(err) : resolve());
  });
  activeMicBytesWritten += buffer.length;
  activeRecordingHealth.lastMicChunkAt = Date.now();
  writeRecoveryJournal();
  return true;
});

ipcMain.handle('recording:neural-mic-chunk', async (_event, data) => {
  if (!activeNeuralMicWriteStream) return false;
  const buffer = Buffer.from(data);
  await new Promise((resolve, reject) => {
    activeNeuralMicWriteStream.write(buffer, (err) => err ? reject(err) : resolve());
  });
  activeNeuralMicBytesWritten += buffer.length;
  activeRecordingHealth.lastNeuralMicChunkAt = Date.now();
  writeRecoveryJournal();
  return true;
});

ipcMain.handle('recording:cancel', async () => {
  await closeActiveStream();
  await closeActiveMicStream();
  await closeActiveNeuralMicStream();
  const stoppedApplicationAudio = await stopApplicationAudioCapture().catch(() => ({ path: null }));
  if (stoppedApplicationAudio?.path) { try { fs.unlinkSync(stoppedApplicationAudio.path); } catch {} }
  if (activeTempPath && fs.existsSync(activeTempPath)) {
    try { fs.unlinkSync(activeTempPath); } catch {}
  }
  if (applicationAudioTempPath && fs.existsSync(applicationAudioTempPath)) { try { fs.unlinkSync(applicationAudioTempPath); } catch {} }
  if (activeMicTempPath && fs.existsSync(activeMicTempPath)) { try { fs.unlinkSync(activeMicTempPath); } catch {} }
  if (activeNeuralMicTempPath && fs.existsSync(activeNeuralMicTempPath)) { try { fs.unlinkSync(activeNeuralMicTempPath); } catch {} }
  resetActiveRecordingState();
  setRecordingResourcePriority(false, 'recording-cancelled');
  activityLog('warn', 'recording.cancelled', {});
  return true;
});

ipcMain.handle('recording:seal', async (_event, meta = {}) => {
  activityLog('info', 'recording.seal-requested', { meta });
  try {
    const result = await sealActiveRecordingForFinalization(meta);
    // Capture is stopped, but keep AI/resource priority held until normalization,
    // audio mixing and validation finish. This prevents post-stop work from racing
    // the short Stop -> save barrier or the next capture.
    activityLog('info', 'recording.sealed', { sessionId: result.sessionId, outputFile: path.basename(result.outputPath || ''), durationMs: result.durationMs });
    return result;
  } catch (error) {
    setRecordingResourcePriority(false, 'recording-seal-failed');
    activityLog('error', 'recording.seal-failed', { error, meta });
    throw error;
  }
});

ipcMain.handle('recording:finalize-sealed', async (_event, sessionId) => {
  activityLog('info', 'recording.finalize-start', { sessionId: String(sessionId || '') });
  let completedResult = null;
  try {
    completedResult = await finalizeSealedRecording(sessionId);
    activityLog('info', 'recording.finalize-complete', { sessionId: String(sessionId || ''), outputFile: path.basename(completedResult.path || ''), videoCodec: completedResult.videoCodec, videoEncoding: completedResult.videoEncoding, microphoneCleanup: completedResult.microphoneCleanup });
    return completedResult;
  } catch (error) {
    activityLog('error', 'recording.finalize-failed', { sessionId: String(sessionId || ''), error });
    throw error;
  } finally {
    if (!activeTempPath && !activeWriteStream && sealedRecordingSessions.size === 0) setRecordingResourcePriority(false, 'recording-save-finished');
    if (completedResult?.path && loadVoiceProfile()?.embedding?.length) setTimeout(() => refineVoiceHighlightsWithEnrollment(completedResult.path), 0);
  }
});

ipcMain.handle('recording:finalize', async (_event, meta = {}) => {
  // Compatibility path for callers that still expect a single finalize call. The
  // renderer now seals first, then waits for full finalization before Start is enabled.
  const sealed = await sealActiveRecordingForFinalization(meta);
  return finalizeSealedRecording(sealed.sessionId);
});

ipcMain.handle('recording:recovery-status', () => {
  const value = pendingRecoveryNotice;
  pendingRecoveryNotice = null;
  return value;
});

ipcMain.handle('recording:startup-recovery-state', () => startupRecoveryStateSnapshot());

ipcMain.handle('recording:retry-recovery', async () => {
  activityLog('info', 'recovery.manual-retry-requested', { pending: listPendingRecoveries(recoveryDirectory()).length });
  if (startupRecoveryInProgress) {
    return { recovered: false, busy: true, message: 'Recovery is already running. You can stop it or let it continue in the background.' };
  }
  if (activeTempPath || activeWriteStream || activeMicWriteStream || activeNeuralMicWriteStream || sealedRecordingSessions.size) {
    return { recovered: false, busy: true, message: 'Finish the current recording or background save before manually recovering an earlier one.' };
  }
  setUserPausedRecoveryState(false);
  recoveryCancelRequested = false;
  recoveryCancelReason = '';
  startupRecoveryInProgress = true;
  broadcastStartupRecoveryState();
  try {
    const result = await recoverInterruptedRecording({ includePaused: true });
    return result || { recovered: true, none: true, message: 'No unfinished recordings need recovery.' };
  } finally {
    startupRecoveryInProgress = false;
    recoveryCancelRequested = false;
    recoveryCancelReason = '';
    broadcastStartupRecoveryState();
  }
});

ipcMain.handle('recording:cancel-recovery', () => {
  return requestRecoveryCancellation(
    'Recovery was stopped. The unfinished recording remains protected and can be recovered later.',
    { pauseForUser: true }
  );
});

ipcMain.handle('recording:open-recovery-folder', () => {
  const dir = recoveryDirectory();
  fs.mkdirSync(dir, { recursive: true });
  shell.openPath(dir);
  return dir;
});

ipcMain.handle('audio:application-capability', () => {
  if (process.platform === 'darwin') return { supported: true, platform: process.platform, message: 'Selected application audio is available on this Mac.' };
  if (process.platform === 'win32') return { platform: process.platform, ...windowsApplicationAudioCapability() };
  return { supported: false, platform: process.platform, message: 'Selected application audio is unavailable on this system. System audio remains available.' };
});

ipcMain.handle('audio:application-start', async (_event, payload = {}) => startApplicationAudioCapture(payload));
ipcMain.handle('audio:application-stop', async () => stopApplicationAudioCapture());
ipcMain.handle('audio:application-pause', async () => pauseApplicationAudioCapture());
ipcMain.handle('audio:application-resume', async () => resumeApplicationAudioCapture());

ipcMain.handle('recordings:list', () => listRecordings());
ipcMain.handle('recordings:search', (_event, query) => searchRecordingLibrary(query));
ipcMain.handle('recording:waveform', (_event, payload = {}) => waveformForRecording(payload.recordingPath, payload.points));
ipcMain.handle('recording:repair-media', (_event, recordingPath) => repairRecordingForPlayback(recordingPath));
ipcMain.handle('recording:markers-get', (_event, recordingPath) => markersForRecording(recordingPath));
ipcMain.handle('recording:markers-save', (_event, payload = {}) => saveMarkersForRecording(payload.recordingPath, payload.markers));
ipcMain.handle('recording:voice-highlights-get', (_event, recordingPath) => voiceHighlightsForRecording(recordingPath));
ipcMain.handle('app:readiness', () => readinessSnapshot());

ipcMain.handle('recordings:category-create', (_event, name) => createRecordingCategory(name));
ipcMain.handle('recordings:category-set', (_event, payload = {}) => setRecordingCategory(payload.recordingPath, payload.category));

ipcMain.handle('recordings:transcript', async (_event, recordingPath) => {
  const safe = safeRecordingPath(recordingPath);
  const paths = transcriptPathsForRecording(safe);
  const text = fs.existsSync(paths.txt) ? fs.readFileSync(paths.txt, 'utf8') : '';
  const timeline = transcriptTimelineForRecording(safe);
  const srt = timeline.srtText; // Generated in memory for CC/timecoded views; not auto-written beside the recording.
  const cache = text || srt ? await transcriptCacheState(safe, text, srt) : { needsRefresh: false, verified: false };
  if (text && srt && !cache.needsRefresh && !cache.verified && timeline.source === 'legacy-srt') {
    saveTranscriptVerification(safe, text, srt, { legacyAccepted: true });
  }
  return {
    text,
    srt,
    cues: timeline.cues,
    txtPath: paths.txt,
    srtPath: fs.existsSync(paths.srt) ? paths.srt : '',
    hasTxt: fs.existsSync(paths.txt),
    hasSrt: fs.existsSync(paths.srt),
    hasTimedCues: timeline.cues.length > 0,
    needsRefresh: Boolean(cache.needsRefresh),
    verified: Boolean(cache.verified || (text && srt && !cache.needsRefresh && timeline.source === 'legacy-srt'))
  };
});

ipcMain.handle('recordings:speakers', async (_event, recordingPath) => getOrGenerateSpeakerDiarization(recordingPath, false));
ipcMain.handle('recordings:speakers-generate', async (_event, recordingPath) => getOrGenerateSpeakerDiarization(recordingPath, true));
ipcMain.handle('recordings:speaker-name', (_event, payload = {}) => updateRecordingSpeakerName(payload.recordingPath, payload.speaker, payload.name));
ipcMain.handle('recordings:speaker-merge', (_event, payload = {}) => mergeRecordingSpeakerLabels(payload.recordingPath, payload.sourceSpeaker, payload.targetSpeaker));

ipcMain.handle('recordings:insights', async (_event, recordingPath) => getOrGenerateRecordingInsightsQueued(recordingPath, false));
ipcMain.handle('recordings:insights-generate', async (_event, recordingPath) => getOrGenerateRecordingInsightsQueued(recordingPath, true));
ipcMain.handle('recordings:insights-correct', (_event, payload = {}) => correctRecordingInsight(payload.recordingPath, payload));

ipcMain.handle('ai:status', () => aiWorkerManager.snapshot());
ipcMain.handle('ai:cancel', (_event, jobId) => aiWorkerManager.cancel(jobId));

ipcMain.handle('recording:set-active', (_event, recordingPath) => {
  const safe = safeRecordingPath(recordingPath);
  if (!fs.existsSync(safe)) throw new Error('Recording was not found.');
  lastRecordingPath = safe;
  return true;
});

ipcMain.handle('recording:rename', (_event, payload = {}) => {
  return renameRecordingAndTranscript(payload.recordingPath, payload.newName);
});

ipcMain.handle('recording:delete', (_event, payload = {}) => {
  return deleteRecordingAndTranscript(payload.recordingPath);
});

ipcMain.handle('recordings:delete-batch', (_event, payload = {}) => {
  return deleteRecordingsBatch(payload.recordingPaths);
});

ipcMain.handle('transcription:automatic', async (_event, payload = {}) => {
  const requestedPath = payload.recordingPath || lastRecordingPath;
  if (!requestedPath) throw new Error('No recording is available for automatic transcription.');
  return ensureAutomaticTranscriptionJob(requestedPath, Boolean(payload.force));
});


ipcMain.handle('snapshot:save', (_event, payload = {}) => {
  const buffer = safeBuffer(payload.data);
  if (!buffer.length) throw new Error('Snapshot image was empty.');
  const outputPath = nextSnapshotPath();
  fs.writeFileSync(outputPath, buffer);
  return { path: outputPath, directory: snapshotsDirectory() };
});

ipcMain.handle('snapshot:recording-frame', async (_event, payload = {}) => {
  const source = safeRecordingPath(payload.recordingPath);
  if (!fs.existsSync(source)) throw new Error('Recording was not found.');
  const seconds = Math.max(0, Number(payload.seconds) || 0);
  const executable = safeFfmpegPath();
  if (!executable || !fs.existsSync(executable)) throw new Error('FFmpeg is unavailable. Run npm install again.');
  const outputPath = nextSnapshotPath();
  await runProcess(executable, ['-y', '-ss', seconds.toFixed(3), '-i', source, '-frames:v', '1', '-an', outputPath]);
  return { path: outputPath, directory: snapshotsDirectory(), seconds };
});

ipcMain.handle('recording:trim', async (_event, payload = {}) => {
  const source = safeRecordingPath(payload.recordingPath);
  if (!fs.existsSync(source)) throw new Error('Recording was not found.');
  const stat = fs.statSync(source);
  const actualDuration = await probeRecordingDuration(source, stat);
  const requestedStart = Math.max(0, Number(payload.startSeconds) || 0);
  const requestedEnd = Number(payload.endSeconds);
  if (!Number.isFinite(requestedEnd)) throw new Error('Trim end was not valid.');
  const maximum = Number.isFinite(actualDuration) && actualDuration > 0 ? actualDuration : requestedEnd;
  const startSeconds = Math.min(requestedStart, Math.max(0, maximum - 0.1));
  const endSeconds = Math.min(Math.max(requestedEnd, 0), maximum);
  if (endSeconds <= startSeconds) throw new Error('Trim end must be after trim start.');
  const duration = endSeconds - startSeconds;
  if (duration < 0.1) throw new Error('Trim range is too short.');
  const executable = safeFfmpegPath();
  if (!executable || !fs.existsSync(executable)) throw new Error('FFmpeg is unavailable. Run npm install again.');
  const outputPath = nextTrimmedRecordingPath(source);
  const audioOnly = /\.(m4a|mp3)$/i.test(source);
  const sourceVideoCodec = audioOnly ? null : await videoCodecForRecording(source);
  const tempPath = `${outputPath}.partial.${audioOnly ? (audioRecordingExtension(source) || 'm4a') : 'mp4'}`;
  try {
    const args = audioOnly
      ? ['-y', '-hide_banner', '-i', source, '-ss', startSeconds.toFixed(3), '-t', duration.toFixed(3), '-vn', ...audioEncodingArgs(audioRecordingExtension(source) || 'm4a'), tempPath]
      : [
          '-y', '-hide_banner', '-i', source,
          '-ss', startSeconds.toFixed(3), '-t', duration.toFixed(3),
          '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn',
          ...videoEncodingArgs(sourceVideoCodec),
          '-c:a', 'aac', '-b:a', '192k', '-avoid_negative_ts', 'make_zero',
          '-movflags', '+faststart', tempPath
        ];
    await runProcess(executable, args);
    if (!fs.existsSync(tempPath) || fs.statSync(tempPath).size === 0) throw new Error('FFmpeg did not create a valid trimmed recording.');
    const verifiedDuration = await probeRecordingDuration(tempPath, fs.statSync(tempPath));
    if (Number.isFinite(verifiedDuration) && Math.abs(verifiedDuration - duration) > Math.max(0.8, duration * 0.06)) {
      throw new Error(`Trim duration validation failed. Expected about ${duration.toFixed(2)}s but received ${verifiedDuration.toFixed(2)}s.`);
    }
    fs.renameSync(tempPath, outputPath);
  } catch (error) {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
    try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
    throw new Error(`Could not create trimmed copy: ${error.message}`);
  }
  const sourceCategory = categoryForRecording(source);
  if (sourceCategory !== 'Uncategorized') setRecordingCategory(outputPath, sourceCategory);
  const inheritedMarkers = markersForRecording(source)
    .filter((marker) => marker.seconds >= startSeconds && marker.seconds <= endSeconds)
    .map((marker, index) => ({ ...marker, id: `marker-${Date.now()}-${index}`, seconds: Math.max(0, marker.seconds - startSeconds) }));
  if (inheritedMarkers.length) saveMarkersForRecording(outputPath, inheritedMarkers);
  const inheritedVoiceHighlights = trimVoiceHighlights(voiceHighlightsForRecording(source), startSeconds, endSeconds);
  if (inheritedVoiceHighlights.length) saveVoiceHighlightsForRecording(outputPath, inheritedVoiceHighlights, { durationSeconds: duration, method: 'trimmed-inheritance' });
  durationProbeCache.clear();
  waveformCache.clear();
  lastRecordingPath = outputPath;
  return { path: outputPath, name: path.basename(outputPath), url: `recording://media?path=${encodeURIComponent(outputPath)}`, startSeconds, endSeconds, durationSeconds: duration };
});


ipcMain.handle('recording:multi-trim', async (_event, payload = {}) => {
  const source = safeRecordingPath(payload.recordingPath);
  if (!fs.existsSync(source)) throw new Error('Recording was not found.');
  const stat = fs.statSync(source);
  const actualDuration = await probeRecordingDuration(source, stat);
  if (!Number.isFinite(actualDuration) || actualDuration <= 0) throw new Error('Could not determine the recording duration for multi-segment editing.');
  const cuts = normalizeCutSegments(payload.cutSegments, actualDuration);
  if (!cuts.length) throw new Error('Add at least one section to remove before saving an edited copy.');
  const cutDuration = cuts.reduce((total, cut) => total + (cut.endSeconds - cut.startSeconds), 0);
  if (cutDuration >= actualDuration - 0.1) throw new Error('The selected cuts would remove the entire recording. Leave at least 0.1 seconds.');
  const kept = keptSegmentsFromCuts(cuts, actualDuration);
  if (!kept.length) throw new Error('No playable content would remain after the selected cuts.');

  const executable = safeFfmpegPath();
  if (!executable || !fs.existsSync(executable)) throw new Error('FFmpeg is unavailable. Run npm install again.');
  const outputPath = nextEditedRecordingPath(source);
  const audioOnly = /\.(m4a|mp3)$/i.test(source);
  const sourceVideoCodec = audioOnly ? null : await videoCodecForRecording(source);
  const hasAudio = audioOnly || await recordingHasAudio(source);
  const extension = audioOnly ? (audioRecordingExtension(source) || 'm4a') : 'mp4';
  const tempPath = `${outputPath}.partial.${extension}`;
  const filters = [];
  let concatInputs = '';
  kept.forEach((segment, index) => {
    const start = segment.startSeconds.toFixed(6);
    const end = segment.endSeconds.toFixed(6);
    if (!audioOnly) {
      filters.push(`[0:v:0]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${index}]`);
      concatInputs += `[v${index}]`;
    }
    if (hasAudio) {
      filters.push(`[0:a:0]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${index}]`);
      concatInputs += `[a${index}]`;
    }
  });
  if (audioOnly) filters.push(`${concatInputs}concat=n=${kept.length}:v=0:a=1[aout]`);
  else if (hasAudio) filters.push(`${concatInputs}concat=n=${kept.length}:v=1:a=1[vout][aout]`);
  else filters.push(`${concatInputs}concat=n=${kept.length}:v=1:a=0[vout]`);

  const args = ['-y', '-hide_banner', '-i', source, '-filter_complex', filters.join(';')];
  if (audioOnly) {
    args.push('-map', '[aout]', '-vn', ...audioEncodingArgs(extension), tempPath);
  } else {
    args.push('-map', '[vout]');
    if (hasAudio) args.push('-map', '[aout]');
    args.push('-sn', '-dn', ...videoEncodingArgs(sourceVideoCodec));
    if (hasAudio) args.push('-c:a', 'aac', '-b:a', '192k');
    args.push('-movflags', '+faststart', tempPath);
  }

  try {
    await runProcess(executable, args);
    if (!fs.existsSync(tempPath) || fs.statSync(tempPath).size === 0) throw new Error('FFmpeg did not create a valid edited file.');
    const expectedDuration = actualDuration - cutDuration;
    const editedDuration = await probeRecordingDuration(tempPath, fs.statSync(tempPath));
    if (Number.isFinite(editedDuration) && Math.abs(editedDuration - expectedDuration) > Math.max(1.0, expectedDuration * 0.06)) {
      throw new Error(`Edited duration validation failed. Expected about ${expectedDuration.toFixed(2)}s but received ${editedDuration.toFixed(2)}s.`);
    }
    fs.renameSync(tempPath, outputPath);
  } catch (error) {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
    try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
    throw new Error(`Could not create multi-segment edited copy: ${error.message}`);
  }

  const sourceCategory = categoryForRecording(source);
  if (sourceCategory !== 'Uncategorized') setRecordingCategory(outputPath, sourceCategory);
  const remappedMarkers = remapMarkersAfterCuts(markersForRecording(source), cuts);
  if (remappedMarkers.length) saveMarkersForRecording(outputPath, remappedMarkers);
  const remappedVoiceHighlights = remapVoiceHighlightsAfterCuts(voiceHighlightsForRecording(source), cuts);
  if (remappedVoiceHighlights.length) saveVoiceHighlightsForRecording(outputPath, remappedVoiceHighlights, { durationSeconds: actualDuration - cutDuration, method: 'edited-inheritance' });
  durationProbeCache.clear();
  waveformCache.clear();
  lastRecordingPath = outputPath;
  return {
    path: outputPath,
    name: path.basename(outputPath),
    url: `recording://media?path=${encodeURIComponent(outputPath)}`,
    cutSegments: cuts,
    keptSegments: kept,
    removedSeconds: cutDuration,
    durationSeconds: actualDuration - cutDuration
  };
});

ipcMain.handle('recording:export-audio', async (_event, payload = {}) => {
  const source = safeRecordingPath(payload.recordingPath);
  if (!fs.existsSync(source)) throw new Error('Recording was not found.');
  if (!(await recordingHasAudio(source))) throw new Error('This recording does not contain an audio track to export.');
  const executable = safeFfmpegPath();
  if (!executable || !fs.existsSync(executable)) throw new Error('FFmpeg is unavailable. Run npm install again.');
  const format = String(payload.format || '').toLowerCase() === 'mp3' ? 'mp3' : 'm4a';
  const outputPath = nextAudioExportPath(source, format);
  const tempPath = `${outputPath}.partial.${format}`;
  const args = ['-y', '-hide_banner', '-i', source, '-map', '0:a:0', '-vn', ...audioEncodingArgs(format)];
  if (format === 'm4a') args.push('-movflags', '+faststart');
  args.push(tempPath);
  try {
    await runProcess(executable, args);
    if (!fs.existsSync(tempPath) || fs.statSync(tempPath).size === 0) throw new Error(`FFmpeg did not create a valid ${format.toUpperCase()} audio export.`);
    fs.renameSync(tempPath, outputPath);
  } catch (error) {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
    try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
    throw new Error(`Could not export ${format.toUpperCase()} audio: ${error.message}`);
  }
  const sourceCategory = categoryForRecording(source);
  if (sourceCategory !== 'Uncategorized') setRecordingCategory(outputPath, sourceCategory);
  const sourceMarkers = markersForRecording(source);
  if (sourceMarkers.length) saveMarkersForRecording(outputPath, sourceMarkers);
  const sourceVoiceHighlights = voiceHighlightsForRecording(source);
  if (sourceVoiceHighlights.length) saveVoiceHighlightsForRecording(outputPath, sourceVoiceHighlights, { method: 'audio-export-inheritance' });
  const sourceTranscript = transcriptPathsForRecording(source);
  const outputTranscript = transcriptPathsForRecording(outputPath);
  try { if (fs.existsSync(sourceTranscript.txt)) fs.copyFileSync(sourceTranscript.txt, outputTranscript.txt); } catch {}
  try { if (fs.existsSync(sourceTranscript.srt)) fs.copyFileSync(sourceTranscript.srt, outputTranscript.srt); } catch {}
  try { copyRecordingTranscriptMetadata(source, outputPath); } catch {}
  durationProbeCache.clear();
  waveformCache.clear();
  lastRecordingPath = outputPath;
  return { path: outputPath, name: path.basename(outputPath), format, url: `recording://media?path=${encodeURIComponent(outputPath)}` };
});

ipcMain.handle('file:show-in-folder', (_event, filePath) => {
  if (filePath) shell.showItemInFolder(String(filePath));
  return true;
});

ipcMain.handle('folder:get-recordings', () => ({
  directory: recordingsDirectory(),
  defaultDirectory: defaultRecordingsDirectory(),
  custom: path.resolve(recordingsDirectory()) !== path.resolve(defaultRecordingsDirectory())
}));

ipcMain.handle('folder:choose-recordings', async () => {
  if (activeWriteStream || activeTempPath) throw new Error('Stop the active recording before changing the recording folder.');
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose recording folder',
    defaultPath: recordingsDirectory(),
    properties: process.platform === 'darwin' ? ['openDirectory', 'createDirectory'] : ['openDirectory']
  });
  if (result.canceled || !result.filePaths?.[0]) return { canceled: true, directory: recordingsDirectory() };
  const directory = setRecordingsDirectory(result.filePaths[0]);
  return { canceled: false, directory, defaultDirectory: defaultRecordingsDirectory(), custom: path.resolve(directory) !== path.resolve(defaultRecordingsDirectory()) };
});

ipcMain.handle('folder:reset-recordings', () => {
  const directory = setRecordingsDirectory(defaultRecordingsDirectory());
  return { directory, defaultDirectory: defaultRecordingsDirectory(), custom: false };
});

ipcMain.handle('folder:open-recordings', () => {
  shell.openPath(recordingsDirectory());
  return recordingsDirectory();
});

ipcMain.handle('transcript:export', async (_event, payload = {}) => {
  const format = payload.format === 'srt' ? 'srt' : 'txt';
  const recordingPath = payload.recordingPath ? safeRecordingPath(payload.recordingPath) : lastRecordingPath;
  const defaultBase = recordingPath ? path.basename(recordingPath, path.extname(recordingPath)) : 'PulseStudio Transcript';
  const result = await dialog.showSaveDialog(mainWindow, {
    title: `Export ${format.toUpperCase()} transcript`,
    defaultPath: path.join(recordingsDirectory(), `${defaultBase}.${format}`),
    filters: [{ name: format.toUpperCase(), extensions: [format] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  fs.writeFileSync(result.filePath, payload.content || '', 'utf8');
  return { canceled: false, path: result.filePath };
});

ipcMain.handle('clipboard:copy-text', (_event, text) => {
  clipboard.writeText(String(text || ''));
  return true;
});
