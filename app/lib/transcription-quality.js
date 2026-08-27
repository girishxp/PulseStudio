function transcriptWordCount(text) {
  const value = String(text || '').trim();
  if (!value || /^\[(?:No speech detected|No audio track was captured)/i.test(value)) return 0;
  const matches = value.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu);
  return matches ? matches.length : 0;
}

function basicTranscriptLooksSparse(text, durationSeconds) {
  const duration = Math.max(0, Number(durationSeconds) || 0);
  const words = transcriptWordCount(text);
  if (!duration || !String(text || '').trim()) return false;
  if (/^\[(?:No speech detected|No audio track was captured)/i.test(String(text || '').trim())) return false;
  if (duration >= 8 && words <= 2) return true;
  if (duration >= 20 && words < Math.max(4, Math.floor(duration / 10))) return true;
  return false;
}

function normalizeAsrAudio(input, targetRms = 0.055, maxGain = 6) {
  const source = input instanceof Float32Array ? input : Float32Array.from(input || []);
  if (!source.length) return source;
  let sum = 0;
  let peak = 0;
  for (const value of source) {
    sum += value * value;
    peak = Math.max(peak, Math.abs(value));
  }
  const rms = Math.sqrt(sum / source.length);
  if (!Number.isFinite(rms) || rms < 1e-6 || peak < 1e-6) return source.slice();
  let gain = Math.max(1, Math.min(maxGain, targetRms / rms));
  gain = Math.min(gain, 0.96 / peak);
  if (gain <= 1.01) return source.slice();
  const output = new Float32Array(source.length);
  for (let i = 0; i < source.length; i += 1) output[i] = Math.max(-1, Math.min(1, source[i] * gain));
  return output;
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = Array.from(values).sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * fraction)));
  return sorted[index];
}

function detectSpeechRegions(audio, sampleRate = 16000) {
  const source = audio instanceof Float32Array ? audio : Float32Array.from(audio || []);
  if (!source.length || !sampleRate) return [];
  const frameSamples = Math.max(80, Math.round(sampleRate * 0.02));
  const hopSamples = Math.max(40, Math.round(sampleRate * 0.01));
  const energies = [];
  const starts = [];
  for (let start = 0; start < source.length; start += hopSamples) {
    const end = Math.min(source.length, start + frameSamples);
    if (end <= start) break;
    let sum = 0;
    for (let i = start; i < end; i += 1) sum += source[i] * source[i];
    energies.push(Math.sqrt(sum / (end - start)));
    starts.push(start);
  }
  if (!energies.length) return [];
  const noise = percentile(energies, 0.25);
  const upper = percentile(energies, 0.90);
  const threshold = Math.max(0.0015, noise * 2.2, upper * 0.12);
  const active = energies.map((value) => value >= threshold);

  // Bridge short gaps so consonants and tiny pauses stay in the same phrase.
  const maxGapFrames = Math.max(1, Math.round(0.22 / (hopSamples / sampleRate)));
  let lastActive = -1;
  for (let i = 0; i < active.length; i += 1) {
    if (!active[i]) continue;
    if (lastActive >= 0 && i - lastActive - 1 <= maxGapFrames) {
      for (let j = lastActive + 1; j < i; j += 1) active[j] = true;
    }
    lastActive = i;
  }

  const minFrames = Math.max(1, Math.round(0.20 / (hopSamples / sampleRate)));
  const padSamples = Math.round(sampleRate * 0.22);
  const regions = [];
  let startFrame = -1;
  const push = (endFrame) => {
    if (startFrame < 0 || endFrame - startFrame < minFrames) { startFrame = -1; return; }
    const startSample = Math.max(0, starts[startFrame] - padSamples);
    const endBase = starts[Math.min(endFrame - 1, starts.length - 1)] + frameSamples;
    const endSample = Math.min(source.length, endBase + padSamples);
    if (endSample - startSample >= Math.round(sampleRate * 0.25)) {
      const previous = regions[regions.length - 1];
      if (previous && startSample <= previous.endSample) previous.endSample = Math.max(previous.endSample, endSample);
      else regions.push({ startSample, endSample, start: startSample / sampleRate, end: endSample / sampleRate });
    }
    startFrame = -1;
  };
  for (let i = 0; i < active.length; i += 1) {
    if (active[i] && startFrame < 0) startFrame = i;
    if (!active[i] && startFrame >= 0) push(i);
  }
  if (startFrame >= 0) push(active.length);
  return regions;
}

function transcriptSeemsSparse({ text, durationSeconds = 0, speechSeconds = 0, regionCount = 0 } = {}) {
  const words = transcriptWordCount(text);
  if (basicTranscriptLooksSparse(text, durationSeconds) && speechSeconds >= 2.5) return true;
  if (regionCount >= 2 && speechSeconds >= 3) {
    const minimumWords = Math.max(3, Math.floor(speechSeconds * 0.35));
    if (words < minimumWords) return true;
  }
  return false;
}

function offsetWhisperChunks(chunks, offsetSeconds) {
  return (Array.isArray(chunks) ? chunks : []).map((chunk) => {
    const timestamp = Array.isArray(chunk?.timestamp) ? chunk.timestamp : [0, null];
    const start = Math.max(0, Number(timestamp[0]) || 0) + offsetSeconds;
    const endValue = Number(timestamp[1]);
    const end = Number.isFinite(endValue) ? Math.max(start, endValue + offsetSeconds) : null;
    return { ...chunk, timestamp: [start, end] };
  });
}

module.exports = {
  transcriptWordCount,
  basicTranscriptLooksSparse,
  normalizeAsrAudio,
  detectSpeechRegions,
  transcriptSeemsSparse,
  offsetWhisperChunks
};
