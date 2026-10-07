'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function resolveMarkerRange(markers, startId, endId, duration) {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Could not determine the recording duration.');
  if (typeof startId !== 'string' || typeof endId !== 'string' || !startId || !endId || startId === endId) {
    throw new Error('Choose two different saved bookmarks.');
  }
  const starts = markers.filter(marker => marker.id === startId), ends = markers.filter(marker => marker.id === endId);
  if (starts.length !== 1 || ends.length !== 1) throw new Error('A selected bookmark no longer exists or has a duplicate ID. Choose it again.');
  const start = Number(starts[0].seconds), end = Number(ends[0].seconds);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > duration || end - start < 0.1) {
    throw new Error('The end bookmark must follow the start by at least 0.1 seconds, within this recording.');
  }
  return { start, end, duration: end - start };
}

function transcriptInRange(cues, range) {
  const usable = (Array.isArray(cues) ? cues : []).filter(cue => Number.isFinite(cue.start) && Number.isFinite(cue.end)
    && cue.end > cue.start && String(cue.text || '').trim());
  if (!usable.length) return { needsTranscription: true, cues: [] };
  const intersecting = usable.filter(cue => cue.end > range.start && cue.start < range.end);
  // A sentence crossing a marker may contain words outside the interval. Only
  // newly transcribing the selected audio can resolve that boundary accurately.
  if (intersecting.some(cue => cue.start < range.start || cue.end > range.end)) return { needsTranscription: true, cues: [] };
  return { needsTranscription: false, cues: intersecting.map(cue => ({
    start: cue.start - range.start, end: cue.end - range.start, text: String(cue.text).trim()
  })).sort((a, b) => a.start - b.start) };
}

function excerptCues(output, duration) {
  const cues = (Array.isArray(output?.chunks) ? output.chunks : []).map(chunk => {
    const start = Number(chunk?.timestamp?.[0]);
    const rawEnd = chunk?.timestamp?.[1] == null ? duration : Number(chunk.timestamp[1]);
    return { start: Math.max(0, start), end: Math.min(duration, rawEnd), text: String(chunk?.text || '').trim() };
  }).filter(cue => Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > cue.start && cue.text);
  if (cues.length) return cues;
  const text = String(output?.text || '').trim();
  return text ? [{ start: 0, end: duration, text }] : [];
}

function srtTime(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}
function cuesToSrt(cues) {
  return cues.map((cue, index) => `${index + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.text}\n`).join('\n');
}

async function exportMarkerRange(options) {
  const { source, markers, startMarkerId, endMarkerId, kind, durationSeconds, outputDirectory,
    runFfmpeg, transcribeExcerpt, timelineCues, videoArgs = [], probeDuration, checkCancelled = () => {} } = options;
  if (!['clip', 'audio', 'txt', 'srt'].includes(kind)) throw new Error('Choose Clip, Audio, TXT or SRT.');
  const range = resolveMarkerRange(markers, startMarkerId, endMarkerId, durationSeconds);
  if (kind === 'clip' && /\.(m4a|mp3)$/i.test(source)) throw new Error('Choose Audio for an audio-only recording.');
  const sourceStat = fs.statSync(source);
  const check = () => {
    checkCancelled();
    const now = fs.statSync(source);
    if (now.size !== sourceStat.size || now.mtimeMs !== sourceStat.mtimeMs) throw new Error('The source recording changed during export. Try again.');
  };
  check();
  fs.mkdirSync(outputDirectory, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(outputDirectory, '.pulsestudio-marker-export-'));
  const extension = kind === 'clip' ? 'mp4' : kind === 'audio' ? 'm4a' : kind;
  const stem = path.basename(source, path.extname(source)).slice(0, 110);
  const outputPath = path.join(outputDirectory, `${stem}_markers_${kind}_${crypto.randomUUID()}.${extension}`);
  const temporary = path.join(workspace, `export.${extension}`);
  let published = false, regenerated = false;
  try {
    const seek = ['-y', '-hide_banner', '-i', source, '-ss', range.start.toFixed(6), '-t', range.duration.toFixed(6)];
    if (kind === 'clip' || kind === 'audio') {
      const args = kind === 'clip'
        ? [...seek, '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn', ...videoArgs, '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', temporary]
        : [...seek, '-map', '0:a:0', '-vn', '-sn', '-dn', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', temporary];
      await runFfmpeg(args);
      const verified = await probeDuration(temporary);
      if (!Number.isFinite(verified) || Math.abs(verified - range.duration) > 0.12) throw new Error('The exported media did not match the selected bookmark duration.');
    } else {
      let selected = transcriptInRange(timelineCues, range);
      if (selected.needsTranscription) {
        const wavPath = path.join(workspace, 'selected-audio.wav');
        await runFfmpeg([...seek, '-map', '0:a:0', '-vn', '-sn', '-dn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wavPath]);
        check();
        const output = await transcribeExcerpt(wavPath, range);
        selected = { cues: excerptCues(output, range.duration) };
        regenerated = true;
      }
      check();
      if (!selected.cues.length) throw new Error('No speech was found between the selected bookmarks.');
      fs.writeFileSync(temporary, kind === 'txt' ? selected.cues.map(cue => cue.text).join('\n') + '\n' : cuesToSrt(selected.cues), 'utf8');
    }
    check();
    if (!fs.statSync(temporary).size) throw new Error('The selected interval produced an empty export.');
    // Publish without replacing any existing file; the hidden workspace also
    // keeps incomplete media out of the Playback library.
    try { fs.linkSync(temporary, outputPath); }
    catch (error) {
      if (!['ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'EXDEV'].includes(error.code)) throw error;
      fs.copyFileSync(temporary, outputPath, fs.constants.COPYFILE_EXCL);
    }
    published = true;
    return { path: outputPath, name: path.basename(outputPath), kind, startSeconds: range.start,
      endSeconds: range.end, durationSeconds: range.duration, regeneratedTranscript: regenerated };
  } catch (error) {
    if (published) { try { fs.unlinkSync(outputPath); } catch {} }
    throw error;
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

module.exports = { resolveMarkerRange, transcriptInRange, excerptCues, cuesToSrt, exportMarkerRange };
