function normalizeSpeakerKey(value) {
  const match = String(value || '').match(/Speaker\s+(\d+)/i);
  return match ? `Speaker ${Math.max(1, Number(match[1]) || 1)}` : String(value || '').trim();
}

function resolveMerge(key, merges = {}) {
  let current = normalizeSpeakerKey(key);
  const seen = new Set();
  while (merges[current] && !seen.has(current)) {
    seen.add(current);
    current = normalizeSpeakerKey(merges[current]);
  }
  return current;
}

function applySpeakerCorrections(result, corrections = {}) {
  const names = corrections?.names && typeof corrections.names === 'object' ? corrections.names : {};
  const merges = corrections?.merges && typeof corrections.merges === 'object' ? corrections.merges : {};
  const segments = (Array.isArray(result?.segments) ? result.segments : []).map((segment) => {
    const original = normalizeSpeakerKey(segment.speaker || `Speaker ${Number(segment.id) + 1}`);
    const canonical = resolveMerge(original, merges);
    const displayName = String(names[canonical] || names[original] || canonical).trim() || canonical;
    return { ...segment, originalSpeaker: original, speaker: canonical, displayName };
  });
  const speakers = [...new Set(segments.map((segment) => segment.speaker))];
  return { ...result, segments, speakerCount: speakers.length, corrections: { names, merges }, speakers: speakers.map((speaker) => ({ speaker, name: String(names[speaker] || speaker) })) };
}

function mergeSpeakerCorrections(existing = {}, source, target) {
  const names = { ...(existing.names || {}) };
  const merges = { ...(existing.merges || {}) };
  const from = normalizeSpeakerKey(source);
  const to = normalizeSpeakerKey(target);
  if (!from || !to || from === to) return { names, merges };
  merges[from] = to;
  if (names[from] && !names[to]) names[to] = names[from];
  delete names[from];
  for (const [key, value] of Object.entries(merges)) if (normalizeSpeakerKey(value) === from) merges[key] = to;
  return { names, merges };
}

module.exports = { normalizeSpeakerKey, applySpeakerCorrections, mergeSpeakerCorrections };
