const { spawn } = require('child_process');

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeSegments(segments, durationSeconds = Infinity) {
  const maxDuration = Number.isFinite(Number(durationSeconds)) ? Math.max(0, Number(durationSeconds)) : Infinity;
  const ordered = (Array.isArray(segments) ? segments : [])
    .map((segment) => {
      const start = clamp(Number(segment?.start) || 0, 0, maxDuration);
      const end = clamp(Number(segment?.end) || start, start, maxDuration);
      return {
        start,
        end,
        confidence: clamp(Number(segment?.confidence) || 0.75, 0, 1),
        method: String(segment?.method || 'mic-system-readonly').slice(0, 64)
      };
    })
    .filter((segment) => segment.end - segment.start >= 0.16)
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const segment of ordered) {
    const previous = merged[merged.length - 1];
    if (previous && segment.start - previous.end <= 0.34) {
      previous.end = Math.max(previous.end, segment.end);
      previous.confidence = Math.max(previous.confidence, segment.confidence);
    } else merged.push({ ...segment });
  }
  return merged;
}

function decodeMonoPcm(ffmpegPath, filePath, sampleRate = 4000) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, [
      '-v', 'error', '-i', filePath,
      '-map', '0:a:0?', '-vn', '-ac', '1', '-ar', String(sampleRate),
      '-f', 's16le', '-acodec', 'pcm_s16le', 'pipe:1'
    ], { windowsHide: true });
    const chunks = [];
    let size = 0;
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      chunks.push(chunk);
      size += chunk.length;
      // 3 hours at 4 kHz mono s16 is ~86 MB per stream. Guard against malformed
      // files without making normal long meetings fail to save.
      if (size > 100 * 1024 * 1024) {
        try { child.kill(); } catch {}
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (signal || code !== 0 || size < 2) return reject(new Error(stderr.trim() || 'Audio reference decode was unavailable.'));
      const buffer = Buffer.concat(chunks, size);
      const count = Math.floor(buffer.length / 2);
      const pcm = new Float32Array(count);
      for (let i = 0; i < count; i += 1) pcm[i] = buffer.readInt16LE(i * 2) / 32768;
      resolve(pcm);
    });
  });
}

function rms(samples, start, end) {
  const a = Math.max(0, Math.floor(start));
  const b = Math.min(samples.length, Math.ceil(end));
  if (b <= a) return 0;
  let sum = 0;
  for (let i = a; i < b; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / (b - a));
}

function dbfs(value) {
  return 20 * Math.log10(Math.max(1e-8, value));
}

function pearson(a, b) {
  if (!a.length || a.length !== b.length || a.length < 5) return 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < a.length; i += 1) { ma += a[i]; mb += b[i]; }
  ma /= a.length;
  mb /= b.length;
  let num = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i] - ma;
    const bv = b[i] - mb;
    num += av * bv;
    aa += av * av;
    bb += bv * bv;
  }
  if (aa < 1e-8 || bb < 1e-8) return 0;
  return clamp(num / Math.sqrt(aa * bb), -1, 1);
}

function envelopeForWindow(samples, sampleRate, startSeconds, endSeconds, frameSeconds = 0.04) {
  const result = [];
  const step = Math.max(1, Math.round(sampleRate * frameSeconds));
  const start = Math.max(0, Math.floor(startSeconds * sampleRate));
  const end = Math.min(samples.length, Math.ceil(endSeconds * sampleRate));
  for (let i = start; i + step <= end; i += step) result.push(dbfs(rms(samples, i, i + step)));
  return result;
}

function alignedRawCorrelation(mic, reference, sampleRate, recordingStart, recordingEnd, micOffsetSeconds, delaySeconds) {
  const stride = 4; // 1 kHz effective comparison is enough for acoustic-copy matching.
  let dot = 0;
  let mm = 0;
  let rr = 0;
  let count = 0;
  const startSample = Math.floor(recordingStart * sampleRate);
  const endSample = Math.ceil(recordingEnd * sampleRate);
  const micOffsetSamples = Math.round(micOffsetSeconds * sampleRate);
  const delaySamples = Math.round(delaySeconds * sampleRate);
  for (let recordingIndex = startSample; recordingIndex < endSample; recordingIndex += stride) {
    const mi = recordingIndex - micOffsetSamples;
    const ri = recordingIndex - delaySamples;
    if (mi < 0 || ri < 0 || mi >= mic.length || ri >= reference.length) continue;
    const m = mic[mi];
    const r = reference[ri];
    dot += m * r;
    mm += m * m;
    rr += r * r;
    count += 1;
  }
  if (count < 100 || mm < 1e-7 || rr < 1e-7) return { correlation: 0, residualRatio: 1, gain: 0 };
  const correlation = dot / Math.sqrt(mm * rr);
  const gain = dot / rr;
  let residual = 0;
  for (let recordingIndex = startSample; recordingIndex < endSample; recordingIndex += stride) {
    const mi = recordingIndex - micOffsetSamples;
    const ri = recordingIndex - delaySamples;
    if (mi < 0 || ri < 0 || mi >= mic.length || ri >= reference.length) continue;
    const value = mic[mi] - gain * reference[ri];
    residual += value * value;
  }
  return { correlation, residualRatio: clamp(residual / mm, 0, 4), gain };
}

function analyzeSegmentLeak(mic, reference, sampleRate, segment, micOffsetSeconds) {
  // Keep the comparison local enough to separate alternating speakers. The older
  // ~0.9 s window could smear a short local reply together with surrounding remote
  // speaker leakage and mark the whole section as one person.
  const analysisStart = Math.max(0, segment.start - 0.14);
  const analysisEnd = Math.max(analysisStart + 0.46, segment.end + 0.14);
  const refRms = rms(reference, analysisStart * sampleRate, analysisEnd * sampleRate);
  if (dbfs(refRms) < -58) return { remoteLeak: false, score: 0, residualRatio: 1, delayMs: 0 };

  let best = { score: -1, delaySeconds: 0, envelopeCorrelation: 0, rawCorrelation: 0, residualRatio: 1 };
  for (const delaySeconds of [0.02, 0.04, 0.06, 0.08, 0.10, 0.12, 0.15, 0.18, 0.22, 0.26, 0.30, 0.36]) {
    const micStart = analysisStart - micOffsetSeconds;
    const micEnd = analysisEnd - micOffsetSeconds;
    if (micEnd <= 0) continue;
    const micEnv = envelopeForWindow(mic, sampleRate, Math.max(0, micStart), Math.max(0, micEnd));
    const refEnv = envelopeForWindow(reference, sampleRate, Math.max(0, analysisStart - delaySeconds), Math.max(0, analysisEnd - delaySeconds));
    const count = Math.min(micEnv.length, refEnv.length);
    if (count < 5) continue;
    const envCorr = pearson(micEnv.slice(0, count), refEnv.slice(0, count));
    const raw = alignedRawCorrelation(mic, reference, sampleRate, analysisStart, analysisEnd, micOffsetSeconds, delaySeconds);
    const rawAbs = Math.abs(raw.correlation);
    const score = Math.max(0, envCorr) * 0.68 + Math.min(1, rawAbs * 2.4) * 0.32;
    if (score > best.score) best = { score, delaySeconds, envelopeCorrelation: envCorr, rawCorrelation: raw.correlation, residualRatio: raw.residualRatio };
  }

  // A delayed copy of remote speech has a strong shared envelope and much of its
  // microphone energy can be explained by the system reference. If the user talks
  // at the same time, the unexplained residual rises and the section is preserved.
  // Raw waveform correlation is intentionally only a secondary signal: laptop
  // speakers + room acoustics heavily filter the copy before it reaches the built-in
  // microphone, so a true remote-speaker leak can have weak sample-for-sample
  // correlation while its delayed speech envelope still matches extremely well.
  // Treat that strong delayed envelope match as sufficient evidence of remote leak.
  // Short windows below preserve a simultaneous local interjection because its
  // independent envelope decorrelates the microphone from the system reference.
  const strongAcousticEnvelopeMatch = best.envelopeCorrelation >= 0.72 && best.score >= 0.55;
  const strongRawCopyMatch = best.score >= 0.68
    && best.envelopeCorrelation >= 0.60
    && best.residualRatio <= 0.64;
  const remoteLeak = strongAcousticEnvelopeMatch || strongRawCopyMatch;
  return {
    remoteLeak,
    score: Math.max(0, best.score),
    residualRatio: best.residualRatio,
    delayMs: Math.round(best.delaySeconds * 1000),
    envelopeCorrelation: best.envelopeCorrelation,
    rawCorrelation: best.rawCorrelation
  };
}

async function refineVoiceHighlightsAgainstReference(options = {}) {
  const segments = normalizeSegments(options.segments, options.durationSeconds);
  if (!segments.length || !options.ffmpegPath || !options.micPath || !options.referencePath) {
    return { segments, analyzed: false, rejected: 0, reason: 'missing-input' };
  }
  const sampleRate = 4000;
  let mic;
  let reference;
  try {
    [mic, reference] = await Promise.all([
      decodeMonoPcm(options.ffmpegPath, options.micPath, sampleRate),
      decodeMonoPcm(options.ffmpegPath, options.referencePath, sampleRate)
    ]);
  } catch (error) {
    return { segments, analyzed: false, rejected: 0, reason: error.message || String(error) };
  }
  const micOffsetSeconds = Math.max(0, Number(options.microphoneStartOffsetMs) || 0) / 1000;
  const kept = [];
  const diagnostics = [];
  let rejected = 0;
  for (const segment of segments) {
    // Refine in short windows instead of making one decision for an entire live VAD
    // section. This preserves a local interjection when both the user and a remote
    // attendee talk inside the same original segment, while removing neighboring
    // windows that are explained almost entirely by laptop-speaker leakage.
    const windowSeconds = 0.25;
    for (let start = segment.start; start < segment.end - 0.02; start += windowSeconds) {
      const end = Math.min(segment.end, start + windowSeconds);
      const windowSegment = { ...segment, start, end };
      const result = analyzeSegmentLeak(mic, reference, sampleRate, windowSegment, micOffsetSeconds);
      diagnostics.push({ start, end, ...result });
      if (result.remoteLeak) {
        rejected += 1;
        continue;
      }
      kept.push({
        ...windowSegment,
        confidence: clamp(segment.confidence + (result.score < 0.35 ? 0.05 : 0), 0, 1),
        method: 'mic-system-readonly-v4'
      });
    }
  }
  return {
    segments: normalizeSegments(kept, options.durationSeconds),
    analyzed: true,
    rejected,
    diagnostics
  };
}

module.exports = { refineVoiceHighlightsAgainstReference, normalizeSegments };
