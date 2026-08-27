const fs = require('fs');
const { normalizeAsrAudio, detectSpeechRegions, transcriptSeemsSparse, transcriptWordCount, offsetWhisperChunks } = require('./lib/transcription-quality');

const cancelledRequests = new Set();
let activeRequestId = null;

function normalizeProgress(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n > 1 ? n / 100 : n));
}

function postProgress(payload, label, progress = null, detail = '', phase = 'working') {
  const id = payload?.requestId || activeRequestId;
  if (!id || !process.parentPort) return;
  process.parentPort.postMessage({ type: 'progress', id, label, progress: normalizeProgress(progress), detail: String(detail || ''), phase });
}

function throwIfCancelled(payload) {
  const id = payload?.requestId || activeRequestId;
  if (id && cancelledRequests.has(id)) {
    const error = new Error('AI processing was cancelled.');
    error.code = 'AI_CANCELLED';
    throw error;
  }
}

function modelProgressCallback(payload, label, rangeStart = 0.02, rangeEnd = 0.16) {
  return (event = {}) => {
    throwIfCancelled(payload);
    const rawProgress = normalizeProgress(event.progress ?? (event.total ? Number(event.loaded || 0) / Number(event.total) : null));
    const progress = rawProgress == null ? null : rangeStart + (rangeEnd - rangeStart) * rawProgress;
    const file = event.file || event.name || '';
    const status = String(event.status || '').toLowerCase();
    const phase = /download|progress/.test(status) ? 'download' : 'model';
    const detail = file ? `${status || 'loading'} · ${file}` : (status || 'Preparing model…');
    postProgress(payload, label, progress, detail, phase);
  };
}

function shortElapsed(ms) {
  const seconds = Math.max(0, Math.round(Number(ms) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

async function withEstimatedProgress(payload, { label, start, end, detail, phase = 'inference', estimatedMs = 60000 }, work) {
  const startedAt = Date.now();
  const safeStart = Math.max(0, Math.min(0.99, Number(start) || 0));
  const safeEnd = Math.max(safeStart, Math.min(0.99, Number(end) || safeStart));
  const duration = Math.max(4000, Number(estimatedMs) || 60000);
  const emit = () => {
    throwIfCancelled(payload);
    const elapsed = Date.now() - startedAt;
    const fraction = Math.min(0.96, elapsed / duration);
    const progress = safeStart + (safeEnd - safeStart) * fraction;
    postProgress(payload, label, progress, `${detail} · ${shortElapsed(elapsed)} elapsed`, `${phase}-estimate`);
  };
  emit();
  const timer = setInterval(() => { try { emit(); } catch {} }, 2200);
  timer.unref?.();
  try {
    return await work();
  } finally {
    clearInterval(timer);
  }
}

function parsePcm16MonoWav(wavPath) {
  const fd = fs.openSync(wavPath, 'r');
  const header = Buffer.alloc(12);
  fs.readSync(fd, header, 0, 12, 0);
  if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE') {
    fs.closeSync(fd);
    throw new Error('Local AI worker could not read the extracted WAV audio.');
  }
  let position = 12;
  let format = null;
  let dataOffset = -1;
  let dataSize = 0;
  const chunkHeader = Buffer.alloc(8);
  while (true) {
    const got = fs.readSync(fd, chunkHeader, 0, 8, position);
    if (got < 8) break;
    const id = chunkHeader.toString('ascii', 0, 4);
    const size = chunkHeader.readUInt32LE(4);
    const body = position + 8;
    if (id === 'fmt ' && size >= 16) {
      const fmt = Buffer.alloc(Math.min(size, 64));
      fs.readSync(fd, fmt, 0, fmt.length, body);
      format = {
        audioFormat: fmt.readUInt16LE(0),
        channels: fmt.readUInt16LE(2),
        sampleRate: fmt.readUInt32LE(4),
        bitsPerSample: fmt.readUInt16LE(14)
      };
    } else if (id === 'data') {
      dataOffset = body;
      dataSize = size;
      break;
    }
    position = body + size + (size % 2);
  }
  if (!format || dataOffset < 0 || format.audioFormat !== 1 || format.channels !== 1 || format.sampleRate !== 16000 || format.bitsPerSample !== 16) {
    fs.closeSync(fd);
    throw new Error('Local AI worker expected 16 kHz mono PCM audio.');
  }
  const stat = fs.fstatSync(fd);
  dataSize = Math.min(dataSize, Math.max(0, stat.size - dataOffset));
  return { fd, dataOffset, dataSize, sampleRate: 16000, sampleCount: Math.floor(dataSize / 2) };
}

function readFloatChunk(wav, startSample, sampleCount, padTo = sampleCount) {
  const available = Math.max(0, Math.min(sampleCount, wav.sampleCount - startSample));
  const bytes = Buffer.alloc(available * 2);
  if (available) fs.readSync(wav.fd, bytes, 0, bytes.length, wav.dataOffset + startSample * 2);
  const audio = new Float32Array(Math.max(padTo, available));
  for (let i = 0; i < available; i += 1) audio[i] = bytes.readInt16LE(i * 2) / 32768;
  return { audio, validSamples: available };
}

function readAllFloat(wav) {
  return readFloatChunk(wav, 0, wav.sampleCount, wav.sampleCount).audio;
}

async function loadTransformers(cacheDir) {
  const transformers = await import('@huggingface/transformers');
  transformers.env.cacheDir = cacheDir;
  transformers.env.allowRemoteModels = true;
  return transformers;
}

async function transcribe(payload) {
  const wav = parsePcm16MonoWav(payload.wavPath);
  try {
    const audio = readAllFloat(wav);
    if (!audio.length) return { text: '[No speech detected]', chunks: [], quality: { speechSeconds: 0, regionCount: 0, fallbackUsed: false } };
    const durationSeconds = audio.length / wav.sampleRate;
    const speechRegions = detectSpeechRegions(audio, wav.sampleRate);
    const speechSeconds = speechRegions.reduce((sum, region) => sum + Math.max(0, region.end - region.start), 0);
    const inferenceAudio = normalizeAsrAudio(audio);

    postProgress(payload, 'Transcribing', 0.02, 'Loading Whisper model…', 'model');
    const transformers = await loadTransformers(payload.cacheDir);
    const transcriber = await transformers.pipeline('automatic-speech-recognition', payload.model, { dtype: 'q8', progress_callback: modelProgressCallback(payload, 'Downloading Whisper model', 0.02, 0.17) });
    throwIfCancelled(payload);
    const output = await withEstimatedProgress(payload, {
      label: 'Transcribing',
      start: 0.18,
      end: 0.34,
      detail: 'Analyzing complete recording…',
      phase: 'inference',
      estimatedMs: Math.min(12 * 60 * 1000, Math.max(45000, durationSeconds * 850))
    }, () => transcriber(inferenceAudio, {
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
      task: 'transcribe'
    }));
    throwIfCancelled(payload);

    let text = String(output?.text || '').trim();
    let chunks = Array.isArray(output?.chunks) ? output.chunks : [];
    let fallbackUsed = false;
    let fallbackRegionCount = 0;

    // Whisper can occasionally terminate after one short phrase on quiet/noisy
    // recordings. If the audio contains several clear activity regions but the
    // transcript is implausibly tiny, retry each phrase independently and keep
    // the more complete result. This changes only the AI input, never the media.
    const sparse = transcriptSeemsSparse({ text, durationSeconds, speechSeconds, regionCount: speechRegions.length });
    if (sparse && speechRegions.length) {
      const regionTexts = [];
      const regionChunks = [];
      const regions = speechRegions.slice(0, 80);
      for (let index = 0; index < regions.length; index += 1) {
        throwIfCancelled(payload);
        const region = regions[index];
        const slice = audio.subarray(region.startSample, region.endSample);
        if (slice.length < Math.round(wav.sampleRate * 0.25)) continue;
        postProgress(payload, 'Transcribing', 0.36 + 0.56 * (index / Math.max(1, regions.length)), `Recovering phrase ${index + 1} of ${regions.length}…`, 'inference');
        const regional = await transcriber(normalizeAsrAudio(slice), { return_timestamps: true, task: 'transcribe' });
        throwIfCancelled(payload);
        const regionalText = String(regional?.text || '').replace(/\s+/g, ' ').trim();
        if (!regionalText) continue;
        const previous = regionTexts[regionTexts.length - 1] || '';
        if (regionalText.toLowerCase() !== previous.toLowerCase()) regionTexts.push(regionalText);
        regionChunks.push(...offsetWhisperChunks(regional?.chunks, region.start));
      }
      const recoveredText = regionTexts.join(' ').replace(/\s+/g, ' ').trim();
      if (transcriptWordCount(recoveredText) > transcriptWordCount(text)) {
        text = recoveredText;
        chunks = regionChunks;
        fallbackUsed = true;
        fallbackRegionCount = regionTexts.length;
      }
    }

    postProgress(payload, 'Transcribing', 0.98, 'Formatting transcript…', 'finalizing');
    return {
      text,
      chunks,
      quality: {
        durationSeconds,
        speechSeconds,
        regionCount: speechRegions.length,
        wordCount: transcriptWordCount(text),
        fallbackUsed,
        fallbackRegionCount
      }
    };
  } finally {
    fs.closeSync(wav.fd);
  }
}

function overlapDuration(a, b) {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

function mapChunkSpeakers(raw, chunkStart, previousSegments, nextGlobalIdRef, overlapSeconds) {
  const shifted = (Array.isArray(raw) ? raw : []).map((segment) => ({
    localId: Number(segment?.id),
    start: chunkStart + Math.max(0, Number(segment?.start) || 0),
    end: chunkStart + Math.max(0, Number(segment?.end) || 0),
    confidence: Number.isFinite(Number(segment?.confidence)) ? Number(segment.confidence) : null
  })).filter((segment) => Number.isFinite(segment.localId) && segment.end > segment.start + 0.02);

  const localIds = [...new Set(shifted.map((s) => s.localId))];
  const mapping = new Map();
  const usedGlobal = new Set();
  const overlapStart = chunkStart;
  const overlapEnd = chunkStart + overlapSeconds;
  for (const localId of localIds) {
    let best = null;
    let bestScore = 0;
    const localOverlap = shifted.filter((s) => s.localId === localId && s.end > overlapStart && s.start < overlapEnd);
    for (const prior of previousSegments) {
      if (usedGlobal.has(prior.id) || prior.end <= overlapStart || prior.start >= overlapEnd) continue;
      let score = 0;
      for (const cur of localOverlap) score += overlapDuration(cur, prior);
      if (score > bestScore) { bestScore = score; best = prior.id; }
    }
    if (best != null && bestScore >= 0.08) {
      mapping.set(localId, best);
      usedGlobal.add(best);
    }
  }
  for (const localId of localIds) {
    if (!mapping.has(localId)) mapping.set(localId, nextGlobalIdRef.value++);
  }
  return shifted.map((segment) => ({ ...segment, id: mapping.get(segment.localId) }));
}

function mergeSegments(segments) {
  const sorted = segments.slice().sort((a, b) => a.start - b.start || a.id - b.id);
  const out = [];
  for (const segment of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev.id === segment.id && segment.start <= prev.end + 0.12) {
      prev.end = Math.max(prev.end, segment.end);
      if (prev.confidence != null && segment.confidence != null) prev.confidence = Math.max(prev.confidence, segment.confidence);
    } else out.push({ id: segment.id, start: segment.start, end: segment.end, confidence: segment.confidence });
  }
  return out;
}

function cosineSimilarity(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return -1;
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return dot / (Math.sqrt(aa) * Math.sqrt(bb) || 1);
}

function normalizeVector(vector) {
  const out = Float32Array.from(vector || []);
  let sum = 0;
  for (const value of out) sum += value * value;
  const norm = Math.sqrt(sum) || 1;
  for (let i = 0; i < out.length; i += 1) out[i] /= norm;
  return out;
}

function blendCentroid(current, incoming, count) {
  if (!current) return normalizeVector(incoming);
  const output = new Float32Array(current.length);
  for (let i = 0; i < current.length; i += 1) output[i] = (current[i] * count + incoming[i]) / (count + 1);
  return normalizeVector(output);
}

function concatenateAudioSlices(wav, ranges, maxSeconds = 5) {
  const maxSamples = Math.round(maxSeconds * wav.sampleRate);
  const slices = [];
  let total = 0;
  for (const range of ranges) {
    if (total >= maxSamples) break;
    const start = Math.max(0, Math.floor(range.start * wav.sampleRate));
    const desired = Math.min(maxSamples - total, Math.max(0, Math.floor((range.end - range.start) * wav.sampleRate)));
    if (desired < Math.round(0.20 * wav.sampleRate)) continue;
    const { audio, validSamples } = readFloatChunk(wav, start, desired, desired);
    if (!validSamples) continue;
    slices.push(audio.subarray(0, validSamples));
    total += validSamples;
  }
  const combined = new Float32Array(total);
  let offset = 0;
  for (const slice of slices) { combined.set(slice, offset); offset += slice.length; }
  return combined;
}

function speakerGroups(segments) {
  const groups = new Map();
  for (const segment of segments) {
    if (!groups.has(segment.id)) groups.set(segment.id, { id: segment.id, ranges: [], duration: 0, firstStart: segment.start });
    const group = groups.get(segment.id);
    group.ranges.push(segment);
    group.duration += Math.max(0, segment.end - segment.start);
    group.firstStart = Math.min(group.firstStart, segment.start);
  }
  for (const group of groups.values()) group.ranges.sort((a, b) => (b.end - b.start) - (a.end - a.start));
  return [...groups.values()].sort((a, b) => a.firstStart - b.firstStart);
}

async function clusterSpeakersByVoice(wav, segments, transformers, payload) {
  const groups = speakerGroups(segments);
  const enrollmentEmbedding = Array.isArray(payload?.enrollmentEmbedding) && payload.enrollmentEmbedding.length ? normalizeVector(payload.enrollmentEmbedding) : null;
  const groupEnrollmentSimilarity = new Map();
  if (!groups.length) return { segments, enrollmentSpeakerId: null, enrollmentSimilarity: null };
  const substantive = groups.filter((group) => group.duration >= 0.55);
  if (!substantive.length) return { segments: segments.map((segment) => ({ ...segment, id: 0 })), enrollmentSpeakerId: null, enrollmentSimilarity: null };

  const embeddingModelId = payload.embeddingModel || 'Xenova/wavlm-base-plus-sv';
  postProgress(payload, 'Detecting speakers', 0.58, 'Loading recurring-speaker voice model…', 'model');
  const processor = await transformers.AutoProcessor.from_pretrained(embeddingModelId, { progress_callback: modelProgressCallback(payload, 'Downloading speaker voice model', 0.58, 0.60) });
  const model = await transformers.AutoModel.from_pretrained(embeddingModelId, { dtype: 'q8', progress_callback: modelProgressCallback(payload, 'Downloading speaker voice model', 0.58, 0.60) });
  const audioSeconds = wav.sampleCount / wav.sampleRate;
  const requestedThreshold = Math.max(0.60, Math.min(0.90, Number(payload.clusterThreshold) || 0.72));
  const clusterThreshold = audioSeconds <= 20 ? Math.min(requestedThreshold, 0.60) : audioSeconds <= 60 ? Math.min(requestedThreshold, 0.66) : requestedThreshold;
  const requestedMaxSpeakers = Math.max(2, Math.min(24, Number(payload.maxSpeakers) || 16));
  const durationSpeakerCap = audioSeconds <= 20 ? 3 : audioSeconds <= 60 ? 5 : Math.max(6, Math.ceil(audioSeconds / 30) + 3);
  const maxSpeakers = Math.max(2, Math.min(requestedMaxSpeakers, durationSpeakerCap));
  const mapping = new Map();
  const clusters = [];

  try {
    for (let groupIndex = 0; groupIndex < substantive.length; groupIndex += 1) {
      throwIfCancelled(payload);
      const group = substantive[groupIndex];
      postProgress(payload, 'Detecting speakers', 0.60 + 0.34 * (groupIndex / Math.max(1, substantive.length)), `Matching recurring voice ${groupIndex + 1} of ${substantive.length}…`, 'inference');
      const audio = concatenateAudioSlices(wav, group.ranges, 4.5);
      if (audio.length < Math.round(0.35 * wav.sampleRate)) continue;
      const inputs = await processor(audio);
      const output = await model(inputs);
      const rawEmbedding = output?.embeddings?.data || output?.xvector?.data || output?.last_hidden_state?.data;
      if (!rawEmbedding?.length) continue;
      const embedding = normalizeVector(rawEmbedding);
      if (enrollmentEmbedding) groupEnrollmentSimilarity.set(group.id, cosineSimilarity(embedding, enrollmentEmbedding));
      let bestIndex = -1;
      let bestSimilarity = -1;
      clusters.forEach((cluster, index) => {
        const similarity = cosineSimilarity(embedding, cluster.centroid);
        if (similarity > bestSimilarity) { bestSimilarity = similarity; bestIndex = index; }
      });
      if (bestIndex >= 0 && (bestSimilarity >= clusterThreshold || clusters.length >= maxSpeakers)) {
        const cluster = clusters[bestIndex];
        mapping.set(group.id, cluster.id);
        cluster.centroid = blendCentroid(cluster.centroid, embedding, cluster.count);
        cluster.count += 1;
      } else {
        const id = clusters.length;
        clusters.push({ id, centroid: embedding, count: 1 });
        mapping.set(group.id, id);
      }
    }
  } finally {
    try { await model.dispose?.(); } catch {}
  }

  // A second conservative merge pass catches the same voice returning after a
  // long gap with slightly different acoustics. Short recordings are especially
  // prone to one-person false splits when fan/noise changes the voice embedding.
  // We allow a slightly lower same-voice threshold there, but never merge clusters
  // that overlap in time: genuine simultaneous speakers remain separate.
  if (clusters.length > 1) {
    const parent = clusters.map((_, index) => index);
    const find = (index) => { let current = index; while (parent[current] !== current) current = parent[current]; return current; };
    const mergeThreshold = audioSeconds <= 20 ? 0.50 : audioSeconds <= 60 ? 0.57 : Math.max(0.65, clusterThreshold - 0.05);
    const clusterRanges = (clusterId) => {
      const ranges = [];
      for (const group of substantive) if (mapping.get(group.id) === clusterId) ranges.push(...group.ranges);
      return ranges;
    };
    const overlapsMaterially = (aRanges, bRanges) => aRanges.some((a) => bRanges.some((b) => Math.min(a.end, b.end) - Math.max(a.start, b.start) >= 0.16));
    for (let i = 0; i < clusters.length; i += 1) {
      for (let j = i + 1; j < clusters.length; j += 1) {
        const ri = find(i);
        const rj = find(j);
        if (ri === rj) continue;
        const leftIds = clusters.map((_, index) => index).filter((index) => find(index) === ri);
        const rightIds = clusters.map((_, index) => index).filter((index) => find(index) === rj);
        const leftRanges = leftIds.flatMap(clusterRanges);
        const rightRanges = rightIds.flatMap(clusterRanges);
        if (overlapsMaterially(leftRanges, rightRanges)) continue;
        const sameVoiceSimilarity = cosineSimilarity(clusters[ri].centroid, clusters[rj].centroid);
        const bothMatchEnrollment = Boolean(enrollmentEmbedding)
          && cosineSimilarity(clusters[ri].centroid, enrollmentEmbedding) >= 0.56
          && cosineSimilarity(clusters[rj].centroid, enrollmentEmbedding) >= 0.56;
        if (bothMatchEnrollment || sameVoiceSimilarity >= mergeThreshold) parent[rj] = ri;
      }
    }
    const compact = new Map();
    let next = 0;
    const resolved = (id) => { const root = find(id); if (!compact.has(root)) compact.set(root, next++); return compact.get(root); };
    for (const [groupId, clusterId] of mapping.entries()) mapping.set(groupId, resolved(clusterId));
  }

  // Short/noisy fragments should not create speakers. Attach them to the closest
  // already-clustered temporal neighbour, preferring the preceding speaker.
  const ordered = segments.slice().sort((a, b) => a.start - b.start);
  for (const group of groups) {
    if (mapping.has(group.id)) continue;
    const representative = group.ranges[0];
    let nearest = null;
    let nearestDistance = Infinity;
    for (const segment of ordered) {
      if (!mapping.has(segment.id)) continue;
      const distance = representative.start >= segment.end
        ? representative.start - segment.end
        : segment.start >= representative.end
          ? segment.start - representative.end
          : 0;
      const precedingBonus = segment.end <= representative.start ? -0.08 : 0;
      if (distance + precedingBonus < nearestDistance) {
        nearestDistance = distance + precedingBonus;
        nearest = mapping.get(segment.id);
      }
    }
    mapping.set(group.id, nearest ?? 0);
  }

  const mergedSegments = mergeSegments(segments.map((segment) => ({ ...segment, id: mapping.get(segment.id) ?? 0 })));
  let enrollmentSpeakerId = null;
  let enrollmentSimilarity = null;
  if (enrollmentEmbedding && groupEnrollmentSimilarity.size) {
    const grouped = new Map();
    for (const group of substantive) {
      const speakerId = mapping.get(group.id);
      const similarity = groupEnrollmentSimilarity.get(group.id);
      if (!Number.isInteger(speakerId) || !Number.isFinite(similarity)) continue;
      const weight = Math.max(0.25, Number(group.duration) || 0.25);
      const current = grouped.get(speakerId) || { weighted: 0, weight: 0 };
      current.weighted += similarity * weight;
      current.weight += weight;
      grouped.set(speakerId, current);
    }
    for (const [speakerId, value] of grouped.entries()) {
      const similarity = value.weighted / Math.max(1e-6, value.weight);
      if (enrollmentSimilarity == null || similarity > enrollmentSimilarity) {
        enrollmentSimilarity = similarity;
        enrollmentSpeakerId = speakerId;
      }
    }
  }
  return { segments: mergedSegments, enrollmentSpeakerId, enrollmentSimilarity };
}

async function speakerEmbedding(payload) {
  const wav = parsePcm16MonoWav(payload.wavPath);
  try {
    if (!wav.sampleCount) throw new Error('No voice audio was captured for enrollment.');
    postProgress(payload, 'Building My Voice profile', 0.04, 'Finding clear speech in your sample…', 'inference');
    const fullAudio = readAllFloat(wav);
    const regions = detectSpeechRegions(fullAudio, wav.sampleRate);
    const speechSeconds = regions.reduce((sum, region) => sum + Math.max(0, Number(region.end) - Number(region.start)), 0);
    let audio = regions.length ? concatenateAudioSlices(wav, regions, 18) : fullAudio.subarray(0, Math.min(fullAudio.length, wav.sampleRate * 18));
    if (audio.length < Math.round(wav.sampleRate * 2.0)) throw new Error('Please speak for a little longer so a reliable voice profile can be created.');
    const transformers = await loadTransformers(payload.cacheDir);
    const modelId = payload.embeddingModel || 'Xenova/wavlm-base-plus-sv';
    postProgress(payload, 'Building My Voice profile', 0.18, 'Loading local voice-matching model…', 'model');
    const processor = await transformers.AutoProcessor.from_pretrained(modelId, { progress_callback: modelProgressCallback(payload, 'Downloading speaker voice model', 0.18, 0.35) });
    const model = await transformers.AutoModel.from_pretrained(modelId, { dtype: 'q8', progress_callback: modelProgressCallback(payload, 'Downloading speaker voice model', 0.18, 0.35) });
    try {
      postProgress(payload, 'Building My Voice profile', 0.48, 'Creating your local voice signature…', 'inference');
      const inputs = await processor(audio);
      const output = await model(inputs);
      const rawEmbedding = output?.embeddings?.data || output?.xvector?.data || output?.last_hidden_state?.data;
      if (!rawEmbedding?.length) throw new Error('The local voice model did not produce a usable voice signature.');
      const embedding = normalizeVector(rawEmbedding);
      postProgress(payload, 'Building My Voice profile', 0.98, 'Voice profile ready.', 'finalizing');
      return { embedding: Array.from(embedding), speechSeconds, model: modelId };
    } finally {
      try { await model.dispose?.(); } catch {}
    }
  } finally {
    fs.closeSync(wav.fd);
  }
}

async function speakerEmbeddingRanges(payload) {
  const wav = parsePcm16MonoWav(payload.wavPath);
  try {
    const ranges = (Array.isArray(payload.ranges) ? payload.ranges : []).slice(0, 80);
    const enrollment = Array.isArray(payload.enrollmentEmbedding) && payload.enrollmentEmbedding.length ? normalizeVector(payload.enrollmentEmbedding) : null;
    if (!ranges.length || !enrollment) return { matches: [] };
    const transformers = await loadTransformers(payload.cacheDir);
    const modelId = payload.embeddingModel || 'Xenova/wavlm-base-plus-sv';
    postProgress(payload, 'Matching My Voice', 0.05, 'Loading local voice-matching model…', 'model');
    const processor = await transformers.AutoProcessor.from_pretrained(modelId, { progress_callback: modelProgressCallback(payload, 'Downloading speaker voice model', 0.05, 0.15) });
    const model = await transformers.AutoModel.from_pretrained(modelId, { dtype: 'q8', progress_callback: modelProgressCallback(payload, 'Downloading speaker voice model', 0.05, 0.15) });
    const matches = [];
    try {
      for (let index = 0; index < ranges.length; index += 1) {
        throwIfCancelled(payload);
        const range = ranges[index] || {};
        const start = Math.max(0, Number(range.start) || 0);
        const end = Math.max(start, Number(range.end) || start);
        const samples = Math.min(Math.round(5 * wav.sampleRate), Math.max(0, Math.round((end - start) * wav.sampleRate)));
        if (samples < Math.round(0.45 * wav.sampleRate)) { matches.push({ start, end, similarity: null, reason: 'too-short' }); continue; }
        postProgress(payload, 'Matching My Voice', 0.18 + 0.76 * (index / Math.max(1, ranges.length)), `Checking voice section ${index + 1} of ${ranges.length}…`, 'inference');
        const { audio, validSamples } = readFloatChunk(wav, Math.round(start * wav.sampleRate), samples, samples);
        if (validSamples < Math.round(0.45 * wav.sampleRate)) { matches.push({ start, end, similarity: null, reason: 'too-short' }); continue; }
        const inputs = await processor(audio.subarray(0, validSamples));
        const output = await model(inputs);
        const rawEmbedding = output?.embeddings?.data || output?.xvector?.data || output?.last_hidden_state?.data;
        const similarity = rawEmbedding?.length ? cosineSimilarity(normalizeVector(rawEmbedding), enrollment) : null;
        matches.push({ start, end, similarity });
      }
    } finally {
      try { await model.dispose?.(); } catch {}
    }
    return { matches, model: modelId };
  } finally {
    fs.closeSync(wav.fd);
  }
}

async function diarize(payload) {
  const wav = parsePcm16MonoWav(payload.wavPath);
  try {
    if (!wav.sampleCount) return { segments: [] };
    postProgress(payload, 'Detecting speakers', 0.02, 'Loading diarization model…', 'model');
    const transformers = await loadTransformers(payload.cacheDir);
    const processor = await transformers.AutoProcessor.from_pretrained(payload.model, { progress_callback: modelProgressCallback(payload, 'Downloading diarization model', 0.02, 0.14) });
    let model = await transformers.AutoModelForAudioFrameClassification.from_pretrained(payload.model, { dtype: 'q8', progress_callback: modelProgressCallback(payload, 'Downloading diarization model', 0.02, 0.14) });
    if (typeof processor.post_process_speaker_diarization !== 'function') throw new Error('Speaker segmentation is unavailable in this Transformers.js build.');

    const chunkSeconds = Math.max(5, Math.min(10, Number(payload.chunkSeconds) || 10));
    const overlapSeconds = Math.max(0.5, Math.min(2, Number(payload.overlapSeconds) || 1));
    const chunkSamples = Math.round(chunkSeconds * wav.sampleRate);
    const stepSamples = Math.max(1, Math.round((chunkSeconds - overlapSeconds) * wav.sampleRate));
    const nextGlobalIdRef = { value: 0 };
    let all = [];
    for (let startSample = 0; startSample < wav.sampleCount; startSample += stepSamples) {
      throwIfCancelled(payload);
      postProgress(payload, 'Detecting speakers', 0.15 + 0.40 * (startSample / Math.max(1, wav.sampleCount)), `Analyzing ${Math.min(100, Math.round((startSample / Math.max(1, wav.sampleCount)) * 100))}% of meeting audio…`, 'inference');
      const { audio, validSamples } = readFloatChunk(wav, startSample, Math.min(chunkSamples, wav.sampleCount - startSample), chunkSamples);
      if (!validSamples) break;
      const inputs = await processor(audio);
      const { logits } = await model(inputs);
      const processed = processor.post_process_speaker_diarization(logits, validSamples);
      const raw = Array.isArray(processed?.[0]) ? processed[0] : (Array.isArray(processed) ? processed : []);
      const chunkStart = startSample / wav.sampleRate;
      const mapped = mapChunkSpeakers(raw, chunkStart, all, nextGlobalIdRef, overlapSeconds);
      all.push(...mapped);
      all = mergeSegments(all);
      if (startSample + validSamples >= wav.sampleCount) break;
    }
    try { await model.dispose?.(); } catch {}
    model = null;

    // Segmentation labels are local to short windows. A second, purpose-built
    // speaker-verification model creates voice embeddings and clusters recurring
    // voices across the complete meeting so speaker numbers stay stable.
    const globallyClustered = await clusterSpeakersByVoice(wav, mergeSegments(all), transformers, payload);
    return { segments: mergeSegments(globallyClustered.segments || []), enrollmentSpeakerId: globallyClustered.enrollmentSpeakerId, enrollmentSimilarity: globallyClustered.enrollmentSimilarity };
  } finally {
    fs.closeSync(wav.fd);
  }
}


async function voiceActivityDetect(payload) {
  const wav = parsePcm16MonoWav(payload.wavPath);
  try {
    if (!wav.sampleCount) return { segments: [], model: payload.model || 'onnx-community/silero-vad' };
    postProgress(payload, 'Analyzing speech', 0.02, 'Loading speech detector…', 'model');
    const transformers = await loadTransformers(payload.cacheDir);
    const modelId = payload.model || 'onnx-community/silero-vad';
    const model = await transformers.AutoModel.from_pretrained(modelId, {
      dtype: 'q8',
      config: { model_type: 'custom' },
      progress_callback: modelProgressCallback(payload, 'Downloading speech detector', 0.02, 0.14)
    });
    postProgress(payload, 'Analyzing speech', 0.14, 'Speech detector ready. Scanning recording…', 'inference');
    const frameSamples = 512;
    const frameSeconds = frameSamples / 16000;
    const threshold = Math.max(0.35, Math.min(0.90, Number(payload.threshold) || 0.60));
    const endThreshold = Math.max(0.25, threshold - 0.15);
    const minSpeechFrames = Math.max(1, Math.round((Number(payload.minSpeechMs) || 160) / (frameSeconds * 1000)));
    const minSilenceFrames = Math.max(1, Math.round((Number(payload.minSilenceMs) || 260) / (frameSeconds * 1000)));
    let recurrentState = new transformers.Tensor('float32', new Float32Array(2 * 1 * 128), [2, 1, 128]);
    let context = new Float32Array(64);
    let modelInterface = '';
    let sampleRateTensor;
    try {
      sampleRateTensor = new transformers.Tensor('int64', BigInt64Array.from([16000n]), [1]);
    } catch {
      sampleRateTensor = new transformers.Tensor('int64', [16000], [1]);
    }
    const segments = [];
    let activeStartFrame = -1;
    let silenceStartFrame = -1;
    let activeProbSum = 0;
    let activeProbCount = 0;
    let maxProbability = 0;

    const finishSegment = (endFrame) => {
      if (activeStartFrame < 0) return;
      const speechFrames = Math.max(0, endFrame - activeStartFrame);
      if (speechFrames >= minSpeechFrames) {
        segments.push({
          start: activeStartFrame * frameSeconds,
          end: Math.min(wav.sampleCount / wav.sampleRate, endFrame * frameSeconds),
          confidence: activeProbCount ? activeProbSum / activeProbCount : null
        });
      }
      activeStartFrame = -1;
      silenceStartFrame = -1;
      activeProbSum = 0;
      activeProbCount = 0;
    };

    const probabilityFrom = (output) => {
      const tensor = output?.output || output?.probability || output?.prob || output?.speech_prob;
      const value = Number(tensor?.data?.[0]);
      return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    };

    const runFrame = async (audio) => {
      // The ONNX-community Silero model has existed in two useful export forms:
      // a merged/stateless wrapper (input + sr) and the upstream recurrent form
      // (input + state + sr). Detect the interface once and keep using it.
      if (!modelInterface || modelInterface === 'merged') {
        try {
          const input = new transformers.Tensor('float32', audio, [1, frameSamples]);
          const output = await model({ input, sr: sampleRateTensor });
          modelInterface = 'merged';
          return output;
        } catch (error) {
          if (modelInterface === 'merged') throw error;
        }
      }

      const withContext = new Float32Array(context.length + frameSamples);
      withContext.set(context, 0);
      withContext.set(audio, context.length);
      const statefulAttempts = modelInterface
        ? [modelInterface]
        : ['stateful-context', 'stateful-512'];
      let lastError = null;
      for (const attempt of statefulAttempts) {
        try {
          const values = attempt === 'stateful-context' ? withContext : audio;
          const input = new transformers.Tensor('float32', values, [1, values.length]);
          const output = await model({ input, state: recurrentState, sr: sampleRateTensor });
          recurrentState = output?.stateN || output?.state_n || output?.state || recurrentState;
          context = audio.slice(frameSamples - 64);
          modelInterface = attempt;
          return output;
        } catch (error) {
          lastError = error;
          if (modelInterface) throw error;
        }
      }
      throw lastError || new Error('Silero VAD model interface was not recognized.');
    };

    try {
      let frameIndex = 0;
      for (let startSample = 0; startSample < wav.sampleCount; startSample += frameSamples, frameIndex += 1) {
        throwIfCancelled(payload);
        if (frameIndex % 60 === 0) postProgress(payload, 'Analyzing speech', 0.15 + 0.80 * (startSample / Math.max(1, wav.sampleCount)), 'Finding speech-safe cleanup regions…', 'inference');
        const { audio } = readFloatChunk(wav, startSample, Math.min(frameSamples, wav.sampleCount - startSample), frameSamples);
        const output = await runFrame(audio);
        const probability = probabilityFrom(output);
        maxProbability = Math.max(maxProbability, probability);

        if (activeStartFrame < 0) {
          if (probability >= threshold) {
            activeStartFrame = frameIndex;
            activeProbSum = probability;
            activeProbCount = 1;
          }
          continue;
        }

        activeProbSum += probability;
        activeProbCount += 1;
        if (probability < endThreshold) {
          if (silenceStartFrame < 0) silenceStartFrame = frameIndex;
          if (frameIndex - silenceStartFrame + 1 >= minSilenceFrames) finishSegment(silenceStartFrame);
        } else {
          silenceStartFrame = -1;
        }
      }
      if (activeStartFrame >= 0) finishSegment(Math.ceil(wav.sampleCount / frameSamples));
    } finally {
      try { await model.dispose?.(); } catch {}
    }

    return {
      segments,
      maxProbability,
      threshold,
      frameSeconds,
      model: modelId,
      modelInterface: modelInterface || 'unknown'
    };
  } finally {
    fs.closeSync(wav.fd);
  }
}


function timestampToSeconds(value) {
  const parts = String(value || '').trim().split(':').map(Number);
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

function parseInsightsJson(text) {
  const source = String(text || '').trim();
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const firstBrace = source.indexOf('{');
  const lastBrace = source.lastIndexOf('}');
  const candidate = fenced || (firstBrace >= 0 && lastBrace > firstBrace ? source.slice(firstBrace, lastBrace + 1) : '');
  if (!candidate || !candidate.includes('{')) throw new Error('Local meeting model returned an unreadable response.');
  const parsed = JSON.parse(candidate);
  const normalizeSummaryItem = (item) => {
    if (!item) return null;
    const textValue = String(item.text || item.summary || '').replace(/\s+/g, ' ').trim();
    if (!textValue) return null;
    const timestamp = String(item.timestamp || item.time || '00:00').trim();
    const allowedTypes = new Set(['decision', 'outcome', 'risk', 'open_question', 'key_point']);
    const rawType = String(item.type || 'key_point').toLowerCase().replace(/[\s-]+/g, '_');
    return { seconds: timestampToSeconds(timestamp), text: textValue, type: allowedTypes.has(rawType) ? rawType : 'key_point' };
  };
  const normalizeActionItem = (item) => {
    if (!item) return null;
    const textValue = String(item.text || item.action || '').replace(/\s+/g, ' ').trim();
    if (!textValue) return null;
    const timestamp = String(item.timestamp || item.time || '00:00').trim();
    return {
      seconds: timestampToSeconds(timestamp),
      text: textValue,
      owner: String(item.owner || '').trim(),
      due: String(item.due || item.deadline || '').trim()
    };
  };
  const normalizeChapter = (item) => {
    if (!item) return null;
    const title = String(item.title || '').replace(/\s+/g, ' ').trim();
    const preview = String(item.summary || item.preview || '').replace(/\s+/g, ' ').trim();
    if (!title) return null;
    const timestamp = String(item.timestamp || item.time || '00:00').trim();
    return { startSeconds: timestampToSeconds(timestamp), title, preview };
  };
  return {
    overview: String(parsed.overview || parsed.executive_summary || '').replace(/\s+/g, ' ').trim(),
    chapters: (Array.isArray(parsed.chapters) ? parsed.chapters : []).map(normalizeChapter).filter(Boolean),
    summaryBullets: (Array.isArray(parsed.summary) ? parsed.summary : []).map(normalizeSummaryItem).filter(Boolean),
    actionItems: (Array.isArray(parsed.actions) ? parsed.actions : Array.isArray(parsed.action_items) ? parsed.action_items : []).map(normalizeActionItem).filter(Boolean)
  };
}

function splitTranscriptForInsights(transcript, maxChars = 9000) {
  const lines = String(transcript || '').split('\n').map((line) => line.trim()).filter(Boolean);
  const chunks = [];
  let current = '';
  for (const line of lines) {
    if (current && current.length + line.length + 1 > maxChars) {
      chunks.push(current);
      current = line;
    } else current += `${current ? '\n' : ''}${line}`;
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [String(transcript || '').slice(0, maxChars)];
}

function generatedAssistantText(output) {
  const generated = output?.[0]?.generated_text;
  if (typeof generated === 'string') return generated;
  if (Array.isArray(generated)) {
    const lastAssistant = [...generated].reverse().find((entry) => entry?.role === 'assistant');
    return String(lastAssistant?.content || '');
  }
  return String(output?.[0]?.text || '');
}

function insightSystemPrompt() {
  return `You are a precise meeting analyst. Use only facts explicitly stated in the transcript. Ignore greetings, filler, repetition, transcription noise, jokes, and unrelated side conversation. Never invent a decision, owner, deadline, or action.

Produce useful meeting notes, not a transcript recap:
- overview: 2-4 concise sentences describing the purpose, main outcome, and unresolved items.
- chapters: topic shifts only, each with timestamp, short title, and one-sentence summary.
- summary: 4-10 high-value items. Classify each as decision, outcome, risk, open_question, or key_point. Prefer decisions/outcomes over generic discussion.
- actions: ONLY explicit future tasks, commitments, assignments, requests, or agreed next steps. If none are explicit, return an empty array. Include owner and due only if literally stated.

Return JSON only using this exact schema:
{"overview":"...","chapters":[{"timestamp":"HH:MM:SS","title":"...","summary":"..."}],"summary":[{"timestamp":"HH:MM:SS","type":"decision|outcome|risk|open_question|key_point","text":"..."}],"actions":[{"timestamp":"HH:MM:SS","text":"specific task","owner":"only if explicit","due":"only if explicit"}]}.`;
}

async function askMeetingModel(generator, transcriptChunk, maxNewTokens = 900) {
  const messages = [
    { role: 'system', content: insightSystemPrompt() },
    { role: 'user', content: `Analyze this transcript section. Focus on concrete outcomes, decisions, risks, unresolved questions, and explicit follow-ups. Do not summarize every utterance. Do not create an action item from a question or general discussion.\n\nTRANSCRIPT:\n${transcriptChunk}` }
  ];
  const output = await generator(messages, { max_new_tokens: maxNewTokens, do_sample: false, repetition_penalty: 1.12 });
  return parseInsightsJson(generatedAssistantText(output));
}

function dedupeInsightItems(items, limit) {
  const output = [];
  for (const item of (items || []).sort((a, b) => a.seconds - b.seconds)) {
    const normalized = item.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!normalized) continue;
    const duplicate = output.some((existing) => {
      const other = existing.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      return normalized === other || normalized.includes(other) || other.includes(normalized);
    });
    if (!duplicate) output.push(item);
    if (output.length >= limit) break;
  }
  return output;
}

async function meetingInsights(payload) {
  const transcript = String(payload.transcript || '').trim();
  if (!transcript) return { overview: '', chapters: [], summaryBullets: [], actionItems: [], method: 'local-instruct' };
  postProgress(payload, 'Generating meeting notes', 0.02, 'Loading local meeting model…', 'model');
  const transformers = await loadTransformers(payload.cacheDir);
  const generator = await transformers.pipeline('text-generation', payload.model, { dtype: 'q4', progress_callback: modelProgressCallback(payload, 'Downloading meeting model', 0.02, 0.17) });
  const chunks = splitTranscriptForInsights(transcript, 7600);
  const collectedSummary = [];
  const collectedActions = [];
  const collectedChapters = [];
  const overviews = [];

  const insightChunks = chunks.slice(0, 16);
  for (let chunkIndex = 0; chunkIndex < insightChunks.length; chunkIndex += 1) {
    throwIfCancelled(payload);
    const chunkStart = 0.18 + 0.58 * (chunkIndex / Math.max(1, insightChunks.length));
    const chunkEnd = 0.18 + 0.58 * ((chunkIndex + 1) / Math.max(1, insightChunks.length)) - 0.005;
    const chunk = insightChunks[chunkIndex];
    const result = await withEstimatedProgress(payload, {
      label: 'Generating meeting notes',
      start: chunkStart,
      end: Math.max(chunkStart, chunkEnd),
      detail: `Analyzing transcript section ${chunkIndex + 1} of ${insightChunks.length}…`,
      phase: 'inference',
      estimatedMs: 60000
    }, () => askMeetingModel(generator, chunk, 850));
    if (result.overview) overviews.push(result.overview);
    collectedSummary.push(...result.summaryBullets);
    collectedActions.push(...result.actionItems);
    collectedChapters.push(...result.chapters);
  }

  let summaryBullets = dedupeInsightItems(collectedSummary, 16);
  let actionItems = dedupeInsightItems(collectedActions, 24);
  let chapters = dedupeInsightItems(collectedChapters.map((c) => ({ seconds: c.startSeconds, text: c.title, preview: c.preview })), 16)
    .map((c) => ({ startSeconds: c.seconds, title: c.text, preview: c.preview || '' }));
  let overview = overviews.filter(Boolean).join(' ');

  // Consolidate candidates into a final concise meeting brief. This second pass is
  // intentionally based on already-extracted evidence instead of the whole raw transcript.
  const candidateText = JSON.stringify({
    overview_candidates: overviews.slice(0, 16),
    chapters: chapters.map((item) => ({ timestamp: new Date(item.startSeconds * 1000).toISOString().slice(11, 19), title: item.title, summary: item.preview })),
    summary: summaryBullets.map((item) => ({ timestamp: new Date(item.seconds * 1000).toISOString().slice(11, 19), type: item.type, text: item.text })),
    actions: actionItems.map((item) => ({ timestamp: new Date(item.seconds * 1000).toISOString().slice(11, 19), text: item.text, owner: item.owner, due: item.due }))
  });

  try {
    throwIfCancelled(payload);
    const messages = [
      { role: 'system', content: insightSystemPrompt() },
      { role: 'user', content: `Create the final meeting brief from these evidence candidates. Keep 3-8 meaningful chapters, a 2-4 sentence overview, 4-10 high-value summary items, and every genuine action item. Remove duplicates and low-value chatter. Never add facts.\n\nEVIDENCE:\n${candidateText.slice(0, 18000)}` }
    ];
    const output = await withEstimatedProgress(payload, {
      label: 'Generating meeting notes',
      start: 0.80,
      end: 0.97,
      detail: 'Consolidating decisions and action items…',
      phase: 'inference',
      estimatedMs: 90000
    }, () => generator(messages, { max_new_tokens: 1200, do_sample: false, repetition_penalty: 1.12 }));
    const consolidated = parseInsightsJson(generatedAssistantText(output));
    if (consolidated.overview) overview = consolidated.overview;
    if (consolidated.chapters.length) chapters = consolidated.chapters.slice(0, 8);
    if (consolidated.summaryBullets.length) summaryBullets = dedupeInsightItems(consolidated.summaryBullets, 10);
    if (Array.isArray(consolidated.actionItems)) actionItems = dedupeInsightItems(consolidated.actionItems, 18);
  } catch {}

  return { overview, chapters, summaryBullets, actionItems, method: 'local-instruct-qwen-structured' };
}


async function preloadModel(payload) {
  const transformers = await loadTransformers(payload.cacheDir);
  const kind = String(payload.kind || '');
  const modelId = String(payload.model || '');
  if (!modelId) throw new Error('No model was selected.');
  postProgress(payload, `Downloading ${modelId.split('/').pop()}`, 0.02, 'Preparing model download…', 'model');
  const progress_callback = modelProgressCallback(payload, `Downloading ${modelId.split('/').pop()}`, 0.02, 0.95);
  throwIfCancelled(payload);
  if (kind === 'transcribe') await transformers.pipeline('automatic-speech-recognition', modelId, { dtype: 'q8', progress_callback });
  else if (kind === 'diarize') {
    await transformers.AutoProcessor.from_pretrained(modelId, { progress_callback });
    await transformers.AutoModelForAudioFrameClassification.from_pretrained(modelId, { dtype: 'q8', progress_callback });
  } else if (kind === 'speaker-embedding') {
    await transformers.AutoProcessor.from_pretrained(modelId, { progress_callback });
    await transformers.AutoModel.from_pretrained(modelId, { dtype: 'q8', progress_callback });
  } else if (kind === 'vad') await transformers.AutoModel.from_pretrained(modelId, { dtype: 'q8', progress_callback });
  else if (kind === 'meeting-insights') await transformers.pipeline('text-generation', modelId, { dtype: 'q4', progress_callback });
  else throw new Error(`Unsupported model type: ${kind}`);
  throwIfCancelled(payload);
  postProgress(payload, `Downloading ${modelId.split('/').pop()}`, 1, 'Model ready.', 'complete');
  return { model: modelId, ready: true };
}

async function handle(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid AI worker request.');
  if (payload.task === 'transcribe') return transcribe(payload);
  if (payload.task === 'speaker-embed') return speakerEmbedding(payload);
  if (payload.task === 'speaker-embed-ranges') return speakerEmbeddingRanges(payload);
  if (payload.task === 'diarize') return diarize(payload);
  if (payload.task === 'vad') return voiceActivityDetect(payload);
  if (payload.task === 'meeting-insights') return meetingInsights(payload);
  if (payload.task === 'preload-model') return preloadModel(payload);
  throw new Error(`Unsupported AI worker task: ${payload.task || 'unknown'}`);
}

module.exports = {
  parsePcm16MonoWav,
  readFloatChunk,
  overlapDuration,
  mapChunkSpeakers,
  mergeSegments,
  cosineSimilarity,
  normalizeVector,
  blendCentroid,
  speakerEmbedding,
  speakerEmbeddingRanges,
  voiceActivityDetect,
  parseInsightsJson,
  splitTranscriptForInsights,
  dedupeInsightItems
};

if (process.parentPort) {
  process.parentPort.on('message', async (event) => {
    const message = event.data || {};
    if (message.type === 'cancel' && message.id) {
      cancelledRequests.add(message.id);
      return;
    }
    if (message.type !== 'request' || !message.id) return;
    const id = message.id;
    activeRequestId = id;
    cancelledRequests.delete(id);
    try {
      const payload = { ...(message.payload || {}), requestId: id };
      postProgress(payload, null, 0, 'Starting…', 'starting');
      const result = await handle(payload);
      throwIfCancelled(payload);
      process.parentPort.postMessage({ type: 'result', id, result });
    } catch (error) {
      if (error?.code === 'AI_CANCELLED' || cancelledRequests.has(id)) process.parentPort.postMessage({ type: 'cancelled', id });
      else process.parentPort.postMessage({ type: 'error', id, error: error?.stack || error?.message || String(error) });
    } finally {
      cancelledRequests.delete(id);
      if (activeRequestId === id) activeRequestId = null;
    }
  });
  process.parentPort.postMessage({ type: 'ready' });
}
