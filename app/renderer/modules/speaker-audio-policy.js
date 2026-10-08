(function (root, factory) {
  const policy = factory();
  if (typeof module === 'object' && module.exports) module.exports = policy;
  if (root) root.PulseSpeakerAudioPolicy = policy;
})(typeof window === 'object' ? window : null, function () {
  'use strict';

  const diagnosticsByStream = new WeakMap();
  const errorNames = new Set(['OverconstrainedError', 'NotAllowedError', 'NotFoundError', 'NotReadableError', 'AbortError', 'InvalidStateError', 'SecurityError', 'TypeError']);
  const constraintNames = new Set(['echoCancellation', 'noiseSuppression', 'autoGainControl', 'voiceIsolation', 'sampleRate', 'channelCount', 'deviceId']);

  function stopStream(stream) {
    for (const track of stream?.getTracks?.() || []) { try { track.stop(); } catch {} }
  }

  function readSettings(track) {
    try { return track?.getSettings?.() || {}; } catch { return {}; }
  }

  function readEchoModes(track) {
    try {
      const modes = track?.getCapabilities?.()?.echoCancellation;
      return Array.isArray(modes) ? modes.filter(value => value === true || value === false || value === 'all' || value === 'remote-only') : null;
    } catch { return null; }
  }

  function safeSettings(track) {
    const settings = readSettings(track);
    const boolean = value => typeof value === 'boolean' ? value : null;
    const number = value => Number.isFinite(value) && value > 0 ? value : null;
    return {
      echoCancellation: [true, false, 'all', 'remote-only'].includes(settings.echoCancellation) ? settings.echoCancellation : null,
      noiseSuppression: boolean(settings.noiseSuppression),
      autoGainControl: boolean(settings.autoGainControl),
      voiceIsolation: boolean(settings.voiceIsolation),
      sampleRate: number(settings.sampleRate),
      channelCount: number(settings.channelCount)
    };
  }

  function usesPlatformNoiseSuppression(track) {
    const settings = readSettings(track);
    return settings.noiseSuppression === true || settings.voiceIsolation === true;
  }

  function getDiagnostics(stream) {
    const diagnostics = stream && diagnosticsByStream.get(stream);
    return diagnostics ? { ...diagnostics, echoModes: diagnostics.echoModes?.slice() || null, settings: { ...diagnostics.settings } } : null;
  }

  function describeCapture({ sourceStream, speechFallbackStream, processedStream, noiseMethod } = {}) {
    const processedTrack = processedStream?.getAudioTracks?.()[0];
    return {
      source: getDiagnostics(sourceStream),
      speechFallback: getDiagnostics(speechFallbackStream),
      processedSettings: processedTrack ? safeSettings(processedTrack) : null,
      noiseMethod: ['rnnoise-local-neural', 'chromium-voice-isolation', 'webrtc-noise-suppression', 'webrtc-speech-processing', 'webrtc-aec3-system-reference', 'webrtc-aec3+rnnoise-local-neural', 'webrtc-aec3+chromium-voice-isolation', 'webrtc-aec3+webrtc-noise-suppression'].includes(noiseMethod) ? noiseMethod : 'none'
    };
  }

  async function createMicrophoneStream({ mediaDevices, audio = {}, enabled = true, role = 'source', onDiagnostics } = {}) {
    if (!enabled) return null;
    if (typeof mediaDevices?.getUserMedia !== 'function') throw new Error('Microphone capture is unavailable.');

    // Saving computer audio and cancelling sound from speakers are independent.
    // Boolean AEC is also the compatible starting point on older Chromium builds.
    const captureConstraints = { ...audio, echoCancellation: true };
    let stream = await mediaDevices.getUserMedia({ audio: captureConstraints, video: false });
    let track = stream?.getAudioTracks?.()[0];
    if (!track) {
      stopStream(stream);
      throw new Error('Microphone capture did not provide an audio track.');
    }

    const echoModes = readEchoModes(track);
    const diagnostics = {
      policy: 'automatic-speaker-aec',
      role: role === 'speech-fallback' ? 'speech-fallback' : 'source',
      echoModes,
      allAttempted: false,
      allVerified: false,
      fallback: 'boolean-requested',
      replacement: 'not-attempted',
      reason: echoModes ? 'all-not-advertised' : 'capabilities-unavailable',
      errorName: null,
      errorConstraint: null
    };

    if (echoModes?.includes('all') && typeof track.applyConstraints === 'function') {
      diagnostics.allAttempted = true;
      let canReplace = false;
      try {
        // applyConstraints replaces previous constraints. Retain the source's
        // noise/AGC/device settings while changing only the cancellation mode.
        await track.applyConstraints({ ...captureConstraints, echoCancellation: { exact: 'all' } });
        diagnostics.allVerified = readSettings(track).echoCancellation === 'all';
        diagnostics.reason = diagnostics.allVerified ? 'all-confirmed' : 'all-not-confirmed';
        canReplace = !diagnostics.allVerified;
      } catch (error) {
        diagnostics.reason = 'all-rejected';
        diagnostics.errorName = errorNames.has(error?.name) ? error.name : 'Error';
        diagnostics.errorConstraint = constraintNames.has(error?.constraint) ? error.constraint : null;
        // Chromium can advertise this mode but cannot change the capture source
        // in place. Permission/device/state failures are not capture retries.
        canReplace = error?.name === 'OverconstrainedError' && (!error.constraint || error.constraint === 'echoCancellation');
      }

      if (canReplace) {
        let candidate = null;
        try {
          candidate = await mediaDevices.getUserMedia({ audio: { ...captureConstraints, echoCancellation: { exact: 'all' } }, video: false });
          const candidateTrack = candidate?.getAudioTracks?.()[0];
          if (candidateTrack && readSettings(candidateTrack).echoCancellation === 'all') {
            // The caller has not received either stream yet. Retain the original
            // until the replacement is usable and its actual mode is confirmed.
            if (candidate !== stream) stopStream(stream);
            stream = candidate;
            track = candidateTrack;
            candidate = null;
            diagnostics.allVerified = true;
            diagnostics.reason = 'all-confirmed-on-new-capture';
            diagnostics.replacement = 'confirmed';
          } else diagnostics.replacement = candidateTrack ? 'not-confirmed' : 'missing-audio-track';
        } catch (error) {
          diagnostics.replacement = 'rejected';
          diagnostics.errorName = errorNames.has(error?.name) ? error.name : 'Error';
          diagnostics.errorConstraint = constraintNames.has(error?.constraint) ? error.constraint : null;
        } finally {
          // Never stop the fallback if a faulty provider returns the same stream.
          if (candidate && candidate !== stream) stopStream(candidate);
        }
      }

      if (diagnostics.allVerified) diagnostics.fallback = 'not-needed';
      else {
        try {
          await track.applyConstraints({ ...captureConstraints, echoCancellation: true });
          diagnostics.fallback = 'boolean-applied';
        } catch (error) {
          // The original getUserMedia request already asked for Boolean AEC.
          // Keep this usable stream rather than opening another microphone or
          // hiding a platform/permission failure behind repeated retries.
          diagnostics.fallback = 'boolean-apply-failed';
          diagnostics.errorName = errorNames.has(error?.name) ? error.name : 'Error';
          diagnostics.errorConstraint = constraintNames.has(error?.constraint) ? error.constraint : null;
        }
      }
    } else if (echoModes?.includes('all')) diagnostics.reason = 'apply-constraints-unavailable';

    diagnostics.settings = safeSettings(track);
    diagnostics.outcome = diagnostics.allVerified ? 'whole-system-confirmed'
      : diagnostics.settings.echoCancellation === false ? 'aec-unavailable'
        : diagnostics.settings.echoCancellation === true || diagnostics.settings.echoCancellation === 'remote-only' || diagnostics.settings.echoCancellation === 'all' ? 'browser-aec'
          : 'aec-unverified';
    diagnosticsByStream.set(stream, diagnostics);
    // Diagnostics deliberately exclude labels, device IDs, constraints and audio.
    try {
      const result = onDiagnostics?.(getDiagnostics(stream));
      result?.catch?.(() => {});
    } catch {}
    return stream;
  }

  return { createMicrophoneStream, getDiagnostics, getTrackSettings: safeSettings, describeCapture, usesPlatformNoiseSuppression };
});
