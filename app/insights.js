const crypto = require('crypto');

const STOPWORDS = new Set([
  'a','an','and','are','as','at','be','because','been','being','but','by','can','could','did','do','does','doing','for','from','had','has','have','having','he','her','here','hers','him','his','how','i','if','in','into','is','it','its','just','me','more','most','my','no','not','of','on','or','our','ours','she','so','some','that','the','their','them','then','there','these','they','this','those','to','too','up','us','very','was','we','were','what','when','where','which','who','why','will','with','would','you','your','yours',
  'yeah','yes','okay','ok','right','like','actually','basically','really','also','well','um','uh'
]);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function timestampToSeconds(value) {
  const match = String(value || '').trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(`0.${String(match[4]).padEnd(3, '0').slice(0, 3)}`);
}

function parseSrtCues(srt) {
  const text = String(srt || '').replace(/\r/g, '').trim();
  if (!text) return [];
  const blocks = text.split(/\n{2,}/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0) continue;
    const timing = lines[timingIndex].split('-->');
    if (timing.length !== 2) continue;
    const start = timestampToSeconds(timing[0]);
    const end = timestampToSeconds(timing[1]);
    const cueText = lines.slice(timingIndex + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!Number.isFinite(start) || !Number.isFinite(end) || !cueText) continue;
    cues.push({ start: Math.max(0, start), end: Math.max(start, end), text: cueText });
  }
  return cues.sort((a, b) => a.start - b.start);
}

function tokenize(text) {
  return (String(text || '').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [])
    .map((token) => token.replace(/^['’-]+|['’-]+$/g, ''))
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function cueTokenSet(cues) {
  return new Set(cues.flatMap((cue) => tokenize(cue.text)));
}

function jaccardSimilarity(a, b) {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection || 1);
}

function conciseTitle(text, fallback = 'Discussion') {
  const cleaned = String(text || '').replace(/^[\s\-–—:;,.]+|[\s\-–—:;,.]+$/g, '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return fallback;
  const words = cleaned.split(' ');
  const shortened = words.slice(0, 10).join(' ');
  return shortened.length < cleaned.length ? `${shortened}…` : shortened;
}

function representativeCue(cues) {
  if (!cues.length) return null;
  const frequencies = new Map();
  cues.forEach((cue) => tokenize(cue.text).forEach((token) => frequencies.set(token, (frequencies.get(token) || 0) + 1)));
  let best = cues[0];
  let bestScore = -Infinity;
  cues.forEach((cue, index) => {
    const words = tokenize(cue.text);
    if (!words.length) return;
    const lexical = words.reduce((sum, word) => sum + Math.log1p(frequencies.get(word) || 0), 0) / Math.sqrt(words.length);
    const lengthScore = clamp(String(cue.text).length / 90, 0.2, 1.1);
    const positionBonus = index === 0 ? 0.12 : 0;
    const score = lexical * lengthScore + positionBonus;
    if (score > bestScore) { bestScore = score; best = cue; }
  });
  return best;
}

function buildFallbackCues(text, durationSeconds) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  const sentences = cleaned.split(/(?<=[.!?。！？])\s+/u).filter(Boolean);
  const parts = sentences.length ? sentences : [cleaned];
  const duration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : Math.max(30, parts.length * 8);
  return parts.map((part, index) => {
    const start = duration * index / parts.length;
    const end = duration * (index + 1) / parts.length;
    return { start, end, text: part.trim() };
  }).filter((cue) => cue.text);
}

function chooseChapterBoundaries(cues, duration) {
  if (!cues.length || duration <= 90) return [0, duration];
  const desired = clamp(Math.round(duration / 240) + 1, 2, 10);
  const targetSpan = duration / desired;
  const boundaries = [0];
  for (let chapter = 1; chapter < desired; chapter += 1) {
    const target = chapter * targetSpan;
    const windowSize = Math.max(18, targetSpan * 0.30);
    const candidates = [];
    for (let i = 1; i < cues.length; i += 1) {
      const cue = cues[i];
      if (Math.abs(cue.start - target) > windowSize) continue;
      const previous = cues.slice(Math.max(0, i - 4), i);
      const next = cues.slice(i, Math.min(cues.length, i + 4));
      const novelty = 1 - jaccardSimilarity(cueTokenSet(previous), cueTokenSet(next));
      const gap = Math.max(0, cue.start - (cues[i - 1]?.end || cue.start));
      const distancePenalty = Math.abs(cue.start - target) / windowSize;
      const score = novelty * 1.4 + Math.min(gap, 8) / 8 - distancePenalty * 0.55;
      candidates.push({ seconds: cue.start, score });
    }
    const selected = candidates.sort((a, b) => b.score - a.score)[0];
    const seconds = selected?.seconds ?? target;
    if (seconds - boundaries[boundaries.length - 1] >= Math.max(25, targetSpan * 0.35)) boundaries.push(seconds);
  }
  if (duration - boundaries[boundaries.length - 1] < 25 && boundaries.length > 1) boundaries.pop();
  boundaries.push(duration);
  return boundaries;
}

function generateChapters(cues, durationSeconds) {
  const duration = Number.isFinite(durationSeconds) && durationSeconds > 0
    ? durationSeconds
    : Math.max(...cues.map((cue) => cue.end), 0);
  if (!cues.length || !duration) return [];
  const boundaries = chooseChapterBoundaries(cues, duration);
  const chapters = [];
  for (let i = 0; i < boundaries.length - 1; i += 1) {
    const start = boundaries[i];
    const end = boundaries[i + 1];
    const inRange = cues.filter((cue) => cue.start < end && cue.end >= start);
    const representative = representativeCue(inRange) || inRange[0] || cues.find((cue) => cue.start >= start) || cues[0];
    chapters.push({
      startSeconds: Math.max(0, start),
      endSeconds: Math.max(start, end),
      title: conciseTitle(representative?.text, `Chapter ${i + 1}`),
      preview: String(representative?.text || '').replace(/\s+/g, ' ').trim().slice(0, 180)
    });
  }
  return chapters;
}

function normalizeCandidateText(text) {
  return String(text || '').replace(/\s+/g, ' ').replace(/^[-–—\s]+/, '').trim();
}

function generateSummary(cues, durationSeconds) {
  const usable = cues
    .map((cue) => ({ ...cue, text: normalizeCandidateText(cue.text) }))
    .filter((cue) => cue.text && !/^\[(no audio|no speech)/i.test(cue.text));
  if (!usable.length) return [];
  const frequencies = new Map();
  usable.forEach((cue) => tokenize(cue.text).forEach((token) => frequencies.set(token, (frequencies.get(token) || 0) + 1)));
  const targetCount = clamp(Math.round((Number(durationSeconds) || usable[usable.length - 1].end || 0) / 600) + 3, 3, 7);
  const scored = usable.map((cue, index) => {
    const words = tokenize(cue.text);
    const lexical = words.length ? words.reduce((sum, word) => sum + Math.log1p(frequencies.get(word) || 0), 0) / Math.sqrt(words.length) : 0;
    const punctuationBonus = /[.!?。！？]$/.test(cue.text) ? 0.18 : 0;
    const positionBonus = index === 0 ? 0.15 : 0;
    const informativeLength = clamp(cue.text.length / 100, 0.35, 1.2);
    return { ...cue, score: lexical * informativeLength + punctuationBonus + positionBonus };
  }).sort((a, b) => b.score - a.score);
  const selected = [];
  const seen = new Set();
  for (const cue of scored) {
    const fingerprint = cue.text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 70);
    if (!fingerprint || [...seen].some((existing) => existing.includes(fingerprint) || fingerprint.includes(existing))) continue;
    seen.add(fingerprint);
    selected.push(cue);
    if (selected.length >= targetCount) break;
  }
  return selected.sort((a, b) => a.start - b.start).map((cue) => {
    const t = cue.text.toLowerCase();
    let type = 'key_point';
    if (/\b(decid(?:e|ed)|agreed|approved|final decision|we will go with|we chose)\b/i.test(t)) type = 'decision';
    else if (/\b(completed|finished|resolved|confirmed|result|outcome|ready|launched|delivered)\b/i.test(t)) type = 'outcome';
    else if (/\b(risk|issue|problem|blocked|concern|delay|error|failure|dependency)\b/i.test(t)) type = 'risk';
    else if (/\b(open question|need to clarify|not sure|unknown|tbd|to be decided|pending decision)\b/i.test(t)) type = 'open_question';
    return { seconds: cue.start, text: cue.text, type };
  });
}

const ACTION_PATTERN = /\b(action item|to[- ]?do|follow[- ]?up|next step|we need to|we have to|we should|we will|we'll|i will|i'll|i can take|i can do|need to|needs to|please|can you|could you|make sure|must|owner|deadline|due by|take care of|send|share|prepare|schedule|review|confirm|update|create|finish|complete|deliver|circulate|publish|assign|check with|follow up with)\b/i;
const ACTION_VERB_PATTERN = /\b(send|share|prepare|schedule|review|confirm|update|create|finish|complete|deliver|circulate|publish|assign|check|follow|contact|email|call|test|fix|investigate|document|provide|return|submit|approve)\b/i;

function generateActionItems(cues) {
  const actions = [];
  const seen = new Set();
  for (const cue of cues) {
    const text = normalizeCandidateText(cue.text);
    if (!text || /^\s*(why|what|when|where|who|how)\b/i.test(text)) continue;
    const explicit = ACTION_PATTERN.test(text);
    const commitment = /\b(i|we)\s+(will|'ll|can take|can do|need to|have to|should)\b/i.test(text);
    const request = /\b(please|can you|could you|would you|make sure)\b/i.test(text);
    if (!(explicit || commitment || request) || !ACTION_VERB_PATTERN.test(text)) continue;
    const normalized = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    actions.push({ seconds: cue.start, text });
    if (actions.length >= 12) break;
  }
  return actions;
}

function fallbackOverview(summaryBullets) {
  const points = (summaryBullets || []).filter((item) => ['decision','outcome','risk','open_question'].includes(item.type)).slice(0, 3);
  const source = points.length ? points : (summaryBullets || []).slice(0, 2);
  return source.map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim();
}

function transcriptFingerprint(text, srt) {
  return crypto.createHash('sha256').update(`${String(text || '')}\n---SRT---\n${String(srt || '')}`).digest('hex');
}

function generateInsights({ text = '', srt = '', durationSeconds = null } = {}) {
  let cues = parseSrtCues(srt);
  if (!cues.length) cues = buildFallbackCues(text, durationSeconds);
  const meaningfulCues = cues.filter((cue) => !/^\[(no audio|no speech)/i.test(String(cue.text || '').trim()));
  if (!meaningfulCues.length) {
    return {
      version: 3,
      generatedAt: new Date().toISOString(),
      transcriptFingerprint: transcriptFingerprint(text, srt),
      durationSeconds: Number(durationSeconds) || 0,
      overview: '',
      chapters: [],
      summaryBullets: [],
      actionItems: [],
      method: 'local-extractive'
    };
  }
  cues = meaningfulCues;
  const duration = Number.isFinite(Number(durationSeconds)) && Number(durationSeconds) > 0
    ? Number(durationSeconds)
    : Math.max(...cues.map((cue) => cue.end), 0);
  const summaryBullets = generateSummary(cues, duration);
  return {
    version: 3,
    generatedAt: new Date().toISOString(),
    transcriptFingerprint: transcriptFingerprint(text, srt),
    durationSeconds: duration,
    overview: fallbackOverview(summaryBullets),
    chapters: generateChapters(cues, duration),
    summaryBullets,
    actionItems: generateActionItems(cues),
    method: 'local-extractive'
  };
}

module.exports = {
  generateInsights,
  parseSrtCues,
  transcriptFingerprint
};
