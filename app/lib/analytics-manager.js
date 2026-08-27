const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  try { fs.rmSync(file, { force: true }); } catch {}
  fs.renameSync(tmp, file);
}
function safeText(value, max = 120) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[\r\n\t]+/g, ' ').slice(0, max);
}
function durationBucket(ms) {
  const seconds = Math.max(0, Number(ms || 0) / 1000);
  if (seconds < 30) return '<30s';
  if (seconds < 120) return '30s-2m';
  if (seconds < 600) return '2-10m';
  if (seconds < 1800) return '10-30m';
  if (seconds < 3600) return '30-60m';
  return '60m+';
}

class AnalyticsManager {
  constructor({ app, configPath, onStatus = () => {} }) {
    this.app = app;
    this.configPath = configPath;
    this.onStatus = onStatus;
    this.config = {};
    this.settingsPath = path.join(app.getPath('userData'), 'analytics-settings.json');
    this.settings = {};
    this.queue = [];
    this.flushTimer = null;
    this.heartbeatTimer = null;
    this.sending = false;
    this.startedAt = Date.now();
    this.sessionId = crypto.randomUUID();
    this.state = { configured: false, enabled: false, consentKnown: false, provider: 'none', lastSentAt: 0, lastError: '', queued: 0 };
  }
  init() {
    this.config = readJson(this.configPath, {});
    this.settings = readJson(this.settingsPath, {});
    if (!this.settings.installId) this.settings.installId = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    if (!this.settings.firstSeenAt) this.settings.firstSeenAt = nowIso;
    this.settings.launchCount = Math.max(0, Number(this.settings.launchCount || 0)) + 1;
    this.settings.lastSeenAt = nowIso;
    writeJson(this.settingsPath, this.settings);
    const envKey = safeText(process.env.PULSESTUDIO_ANALYTICS_KEY || '', 300);
    if (envKey) this.config.apiKey = envKey;
    const envHost = safeText(process.env.PULSESTUDIO_ANALYTICS_HOST || '', 300);
    if (envHost) this.config.host = envHost;
    const configured = Boolean(this.config.apiKey && this.config.host && String(this.config.provider || '').toLowerCase() === 'posthog');
    // Desktop opt-out analytics model: anonymous product analytics are enabled by
    // default on first launch when a backend is configured. A user's explicit
    // Settings > Privacy choice is persisted and always wins on later launches.
    if (typeof this.settings.enabled !== 'boolean') {
      this.settings.enabled = true;
      this.settings.analyticsDefault = 'opt-out';
      this.settings.defaultEnabledAt = new Date().toISOString();
      writeJson(this.settingsPath, this.settings);
    }
    const consentKnown = true;
    const enabled = configured && this.settings.enabled !== false;
    this.state = { ...this.state, configured, enabled, consentKnown, provider: configured ? 'posthog' : 'none', installId: this.settings.installId, host: configured ? safeText(this.config.host, 200) : '', queued: 0 };
    this.onStatus(this.snapshot());
    if (enabled) {
      this.track('app_started', {
        launch_mode: this.app.isPackaged ? 'installed' : 'portable',
        app_version: this.app.getVersion(),
        launch_count: Number(this.settings.launchCount || 1),
        install_age_days: Math.max(0, Math.floor((Date.now() - Date.parse(this.settings.firstSeenAt || new Date().toISOString())) / 86400000))
      });
      const minutes = Math.max(5, Number(this.config.heartbeatMinutes || 10));
      this.heartbeatTimer = setInterval(() => this.track('app_heartbeat', { session_minutes: Math.round((Date.now() - this.startedAt) / 60000) }), minutes * 60 * 1000);
      this.heartbeatTimer.unref?.();
    }
    return this.snapshot();
  }
  snapshot() { return { ...this.state, queued: this.queue.length, dashboardUrl: safeText(this.config.dashboardUrl || '', 300) }; }
  setEnabled(enabled) {
    this.settings.enabled = Boolean(enabled);
    this.settings.preferenceChangedAt = new Date().toISOString();
    writeJson(this.settingsPath, this.settings);
    this.state.enabled = Boolean(enabled) && this.state.configured;
    this.state.consentKnown = true;
    this.onStatus(this.snapshot());
    if (this.state.enabled) this.track('analytics_enabled');
    return this.snapshot();
  }
  commonProperties() {
    const release = os.release();
    const firstSeen = Date.parse(this.settings.firstSeenAt || '') || Date.now();
    return {
      distinct_id: this.settings.installId,
      $session_id: this.sessionId,
      session_id: this.sessionId,
      app_name: 'PulseStudio',
      app_version: this.app.getVersion(),
      platform: process.platform,
      architecture: process.arch,
      os_release: safeText(release, 40),
      electron_version: safeText(process.versions.electron, 30),
      chromium_version: safeText(process.versions.chrome, 30),
      node_version: safeText(process.versions.node, 30),
      runtime_mode: this.app.isPackaged ? 'installed' : 'portable',
      launch_count: Number(this.settings.launchCount || 1),
      install_age_days: Math.max(0, Math.floor((Date.now() - firstSeen) / 86400000)),
      $process_person_profile: false
    };
  }
  track(event, properties = {}) {
    if (!this.state.enabled || !this.state.configured) return false;
    const clean = {};
    for (const [key, value] of Object.entries(properties || {})) {
      if (value === undefined || value === null) continue;
      if (typeof value === 'boolean' || typeof value === 'number') clean[key] = value;
      else clean[key] = safeText(value, 120);
    }
    this.queue.push({ event: safeText(event, 80), properties: { ...this.commonProperties(), ...clean }, timestamp: new Date().toISOString() });
    if (this.queue.length > 100) this.queue.splice(0, this.queue.length - 100);
    this.state.queued = this.queue.length;
    this.onStatus(this.snapshot());
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => { this.flushTimer = null; void this.flush(); }, 1200);
      this.flushTimer.unref?.();
    }
    return true;
  }
  trackActivity(level, event, details = {}) {
    const map = {
      'recording.begin': 'recording_started',
      'recording.sealed': 'recording_stopped',
      'recording.finalize-complete': 'recording_completed',
      'recording.seal-failed': 'recording_failed',
      'recording.finalize-failed': 'recording_failed',
      'recording.cancelled': 'recording_cancelled',
      'renderer.recording-started': 'recording_capture_started',
      'renderer.recording-stop-requested': 'recording_stop_requested',
      'renderer.recording-save-complete': 'recording_save_completed',
      'renderer.recording-microphone-toggle': 'microphone_toggled',
      'renderer.recording-microphone-started-late': 'microphone_started_late',
      'renderer.recording-microphone-late-start-failed': 'microphone_start_failed',
      'renderer.microphone-track-ended': 'microphone_track_ended',
      'renderer.microphone-track-muted': 'microphone_track_muted',
      'renderer.microphone-track-unmuted': 'microphone_track_unmuted',
      'renderer.microphone-recorder-error': 'microphone_recorder_error',
      'renderer.system-audio-track-muted': 'system_audio_track_muted',
      'renderer.system-audio-track-unmuted': 'system_audio_track_unmuted',
      'audio.microphone-finalized': 'microphone_cleanup_completed',
      'audio.adaptive-echo-guard-fallback': 'echo_guard_fallback',
      'audio.microphone-fast-finalize-fallback': 'microphone_finalize_fallback',
      'recording.voice-highlights-persisted': 'voice_highlights_completed',
      'recording.voice-highlights-profile-refined': 'voice_highlights_profile_refined',
      'recording.voice-highlights-profile-refine-failed': 'voice_highlights_profile_refine_failed',
      'recording.markers-persisted': 'bookmarks_saved',
      'recording.writer-error': 'disk_write_failed',
      'recording.microphone-writer-error': 'microphone_writer_failed',
      'recording.neural-microphone-writer-error': 'neural_microphone_writer_failed',
      'recording.save-failed': 'recording_failed',
      'app.uncaught-exception': 'app_error',
      'app.unhandled-rejection': 'app_error',
      'renderer.javascript-error': 'renderer_error',
      'renderer.unhandled-rejection': 'renderer_error',
      'renderer.process-gone': 'renderer_process_gone',
      'renderer.unresponsive': 'renderer_unresponsive',
      'renderer.responsive': 'renderer_responsive',
      'renderer.did-fail-load': 'renderer_load_failed',
      'renderer.recording-health-transition': 'recording_health_changed',
      'renderer.recording-checkpoint-failed': 'recording_checkpoint_failed',
      'renderer.rnnoise-unavailable': 'noise_suppression_fallback',
      'renderer.capture-track-muted': 'capture_track_muted',
      'renderer.capture-track-unmuted': 'capture_track_unmuted',
      'renderer.capture-track-interrupted': 'capture_interrupted',
      'renderer.capture-track-ended': 'capture_ended',
      'renderer.media-recorder-error': 'encoder_error',
      'renderer.media-recorder-unexpected-stop': 'recording_unexpected_stop',
      'renderer.recording-chunk-write-failed': 'disk_write_failed',
      'renderer.recording-save-failed': 'recording_failed',
      'renderer.recording-seal-failed': 'recording_failed',
      'renderer.voice-profile-enrolled': 'voice_profile_enrolled',
      'voice-profile.saved': 'voice_profile_saved',
      'voice-profile.cleared': 'voice_profile_cleared',
      'recovery.available-at-startup': 'recovery_available',
      'recovery.attempt-start': 'recovery_started',
      'recovery.attempt-finished': 'recovery_finished',
      'recovery.cancel-requested': 'recovery_cancel_requested',
      'recovery.manual-retry-requested': 'recovery_manual_retry',
      'process.failed': 'background_process_failed',
      'video-encoder.probe-failed': 'video_encoder_probe_failed',
      'diagnostics.exported': 'diagnostics_exported',
      'feedback.open-failed': 'feedback_open_failed',
      'ui.theme_changed': 'theme_changed',
      'ui.studio_theme_changed': 'studio_theme_changed',
      'ui.control-used': 'ui_control_used',
      'ui.shortcut-used': 'ui_shortcut_used',
      'playback.recording-selected': 'playback_recording_selected',
      'playback.timeline_toggled': 'timeline_toggled',
      'playback.voice_highlights_toggled': 'voice_highlights_toggled',
      'playback.speed_changed': 'playback_speed_changed',
      'playback.captions_toggled': 'captions_toggled',
      'playback.snapshot': 'playback_snapshot',
      'playback.fullscreen_toggled': 'playback_fullscreen_toggled',
      'playback.transcript_opened': 'transcript_opened',
      'ai.transcription-started': 'transcription_started',
      'ai.transcription-completed': 'transcription_completed',
      'ai.transcription-cancelled': 'transcription_cancelled',
      'ai.transcription-failed': 'transcription_failed',
      'ai.speaker-detection-started': 'speaker_detection_started',
      'ai.speaker-detection-completed': 'speaker_detection_completed',
      'ai.speaker-detection-failed': 'speaker_detection_failed',
      'ai.insights-started': 'insights_started',
      'ai.insights-completed': 'insights_completed',
      'ai.insights-failed': 'insights_failed'
    };
    let analyticsEvent = map[event];
    const normalizedLevel = safeText(level || 'info', 20).toLowerCase();
    if (!analyticsEvent && normalizedLevel === 'error') analyticsEvent = 'operational_error';
    else if (!analyticsEvent && normalizedLevel === 'warn') analyticsEvent = 'operational_warning';
    if (!analyticsEvent) return false;

    const meta = details?.meta || {};
    const props = {};
    if (event === 'recording.begin') {
      Object.assign(props, {
        recording_kind: safeText(meta.recordingKind || details.recordingKind || '', 20),
        source_kind: safeText(meta.sourceKind || '', 20),
        capture_mode: safeText(meta.captureMode || '', 30),
        application_audio: Boolean(meta.applicationAudio),
        microphone: Boolean(details.microphone),
        processed_microphone: Boolean(details.processedMicrophone),
        video_codec: safeText(meta.videoCodec || '', 20),
        frame_rate: Number(meta.frameRate || 0),
        noise_reduction: safeText(meta.noiseReduction || '', 30)
      });
    } else if (event === 'recording.sealed') {
      props.duration_bucket = durationBucket(details.durationMs);
      props.duration_seconds = Math.round(Number(details.durationMs || 0) / 1000);
    } else if (event === 'recording.finalize-complete') {
      props.video_codec = safeText(details.videoCodec || '', 20);
      props.audio_cleanup = safeText(details.microphoneCleanup?.method || '', 80);
      props.neural_method = safeText(details.microphoneCleanup?.neuralMethod || '', 50);
      props.safety_fallback = Boolean(details.microphoneCleanup?.safetyFallback);
    } else if (event === 'renderer.recording-microphone-toggle') {
      props.muted = Boolean(details.muted);
    } else if (event === 'audio.microphone-finalized') {
      props.mode = safeText(details.mode || '', 30);
      props.source = safeText(details.source || '', 50);
      props.neural_method = safeText(details.neuralMethod || '', 50);
      props.passes = Number(details.passes || 0);
    } else if (event === 'recording.voice-highlights-persisted') {
      props.count = Number(details.count || 0);
      props.method = safeText(details.method || '', 50);
    } else if (event === 'recording.markers-persisted') {
      props.count = Number(details.markerCount || 0);
    } else if (event === 'ui.control-used') {
      props.control_id = safeText(details.control || '', 80);
      props.control_type = safeText(details.controlType || '', 30);
      props.control_group = safeText(details.group || '', 40);
      props.action = safeText(details.action || 'click', 30);
      if (details.value !== undefined) props.value = safeText(details.value, 60);
    } else if (event === 'ui.shortcut-used') {
      props.shortcut = safeText(details.shortcut || '', 40);
      props.context = safeText(details.context || '', 30);
    } else if (event === 'playback.recording-selected') {
      props.duration_seconds = Math.max(0, Math.round(Number(details.durationSeconds || 0)));
      props.duration_bucket = durationBucket(Number(details.durationSeconds || 0) * 1000);
      props.recording_kind = safeText(details.recordingKind || '', 20);
    } else if (event === 'ai.transcription-completed') {
      props.word_count_bucket = safeText(details.wordCountBucket || '', 30);
      props.forced = Boolean(details.force);
    } else if (event === 'ai.speaker-detection-completed') {
      props.speaker_count = Math.max(0, Number(details.speakerCount || 0));
      props.forced = Boolean(details.force);
    } else if (event === 'ai.insights-completed') {
      props.method = safeText(details.method || '', 50);
      props.chapter_count = Math.max(0, Number(details.chapterCount || 0));
      props.action_item_count = Math.max(0, Number(details.actionItemCount || 0));
      props.forced = Boolean(details.force);
    }

    if (analyticsEvent === 'app_error' || analyticsEvent === 'renderer_error' || analyticsEvent === 'operational_error' || analyticsEvent.endsWith('_failed') || analyticsEvent.endsWith('_error')) {
      props.level = normalizedLevel || 'error';
      props.source_event = safeText(event || '', 100);
      const err = details?.error;
      props.error_name = safeText(err?.name || details?.errorName || (typeof err === 'object' ? 'Error' : '') || 'Error', 60);
      if (err?.code || details?.errorCode) props.error_code = safeText(err?.code || details?.errorCode, 50);
    } else if (analyticsEvent === 'operational_warning') {
      props.level = 'warn';
      props.source_event = safeText(event || '', 100);
    }

    const safeKeys = [
      'kind','source','mode','theme','ui_theme','visible','enabled','speed','manual','includeRecording',
      'task','stage','command','recovered','cancelled','busy','automatic','directCapturePassThrough',
      'recordingKind','captureMode','frameRate','noiseReduction','speechSeconds','spectralBands','pending',
      'verified_digest','available_version','latest_version','destination','reasonCode'
    ];
    for (const key of safeKeys) {
      if (props[key] !== undefined) continue;
      const value = details?.[key];
      if (typeof value === 'boolean' || typeof value === 'number') props[key] = value;
      else if (value !== undefined && value !== null) props[key] = safeText(value, 80);
    }
    if (details?.elapsedMs !== undefined) props.elapsed_seconds = Math.round(Number(details.elapsedMs || 0) / 1000);
    if (details?.durationMs !== undefined && props.duration_seconds === undefined) {
      props.duration_seconds = Math.round(Number(details.durationMs || 0) / 1000);
      props.duration_bucket = durationBucket(details.durationMs);
    }
    return this.track(analyticsEvent, props);
  }
  async flush() {
    if (this.sending || !this.state.enabled || !this.queue.length) return;
    this.sending = true;
    const batch = this.queue.splice(0, Math.min(20, this.queue.length));
    try {
      for (const item of batch) await this.sendOne(item);
      this.state.lastSentAt = Date.now();
      this.state.lastError = '';
    } catch (error) {
      this.queue.unshift(...batch);
      if (this.queue.length > 100) this.queue.length = 100;
      this.state.lastError = safeText(error?.message || error, 180);
    } finally {
      this.sending = false;
      this.state.queued = this.queue.length;
      this.onStatus(this.snapshot());
      if (this.queue.length && !this.flushTimer) {
        this.flushTimer = setTimeout(() => { this.flushTimer = null; void this.flush(); }, 30000);
        this.flushTimer.unref?.();
      }
    }
  }
  sendOne(item) {
    const host = new URL(this.config.host);
    const endpoint = new URL('/capture/', host);
    const payload = Buffer.from(JSON.stringify({ api_key: this.config.apiKey, event: item.event, properties: item.properties, timestamp: item.timestamp }));
    const client = endpoint.protocol === 'http:' ? http : https;
    return new Promise((resolve, reject) => {
      const req = client.request(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length, 'User-Agent': `PulseStudio/${this.app.getVersion()}` }, timeout: 10000 }, (res) => {
        res.resume();
        if (res.statusCode >= 200 && res.statusCode < 300) resolve();
        else reject(new Error(`Analytics service returned HTTP ${res.statusCode}.`));
      });
      req.on('timeout', () => req.destroy(new Error('Analytics request timed out.')));
      req.on('error', reject);
      req.end(payload);
    });
  }
  async shutdown() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.heartbeatTimer = null;
    this.flushTimer = null;
    if (this.state.enabled) {
      this.track('app_closed', { session_minutes: Math.max(0, Math.round((Date.now() - this.startedAt) / 60000)) });
      try { await this.flush(); } catch {}
    }
  }
}

module.exports = { AnalyticsManager };
