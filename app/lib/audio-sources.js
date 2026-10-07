'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Keep the v0.2.131 source format compatible without exposing playback presets.
// The reference is copied before the microphone is added to the saved master.
class AudioSourceManager {
  constructor({ validateRecording, validateMicrophone, hasAudio, ffmpegPath, run, trash, log = () => {} }) {
    Object.assign(this, { validateRecording, validateMicrophone, hasAudio, ffmpegPath, run, trash, log });
  }

  directory(recording) {
    const safe = this.validateRecording(recording);
    const key = crypto.createHash('sha1').update(path.basename(safe)).digest('hex').slice(0, 20);
    return path.join(path.dirname(safe), '.pulsestudio-audio-sources', key);
  }

  read(recording) {
    const safe = this.validateRecording(recording);
    const directory = this.directory(safe);
    try {
      const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'metadata.json'), 'utf8'));
      if (metadata.version !== 1 || metadata.recordingName !== path.basename(safe)) return null;
      return { ...metadata, directory };
    } catch { return null; }
  }

  source(metadata, key) {
    const name = metadata?.[key];
    if (typeof name !== 'string' || !name || path.basename(name) !== name || !metadata?.directory) return null;
    const candidate = path.join(metadata.directory, name);
    try { return fs.statSync(candidate).isFile() && fs.statSync(candidate).size >= 128 ? candidate : null; }
    catch { return null; }
  }

  async preserve(recording, rawMic, neuralMic, meta = {}) {
    const safe = this.validateRecording(recording);
    const raw = this.validateMicrophone(rawMic);
    if (!raw) return { preserved: false };
    const neural = this.validateMicrophone(neuralMic);
    const target = this.directory(safe);
    if (fs.existsSync(target)) {
      const existing = this.read(safe);
      if (!this.source(existing, 'rawMicrophoneFile')) throw new Error('The existing audio source folder is incomplete; it was left intact.');
      return {
        preserved: true, microphoneAvailable: true,
        neuralAvailable: Boolean(this.source(existing, 'neuralMicrophoneFile')),
        referenceAvailable: Boolean(this.source(existing, 'referenceFile'))
      };
    }
    const stage = `${target}.pending-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    fs.mkdirSync(stage, { recursive: true });
    try {
      const microphoneName = `microphone-raw${/\.m4a$/i.test(raw) ? '.m4a' : '.webm'}`;
      fs.copyFileSync(raw, path.join(stage, microphoneName));
      let neuralName = '';
      if (neural) {
        neuralName = `microphone-neural${/\.m4a$/i.test(neural) ? '.m4a' : '.webm'}`;
        fs.copyFileSync(neural, path.join(stage, neuralName));
      }
      let referenceName = '';
      const systemAudioMode = ['system', 'application'].includes(meta.systemAudioMode) ? meta.systemAudioMode : 'off';
      if (systemAudioMode !== 'off' && await this.hasAudio(safe)) {
        const executable = this.ffmpegPath();
        if (executable && fs.existsSync(executable)) {
          const reference = path.join(stage, 'system-reference.m4a');
          try {
            await this.run(executable, ['-y', '-hide_banner', '-loglevel', 'error', '-i', safe, '-map', '0:a:0', '-vn', '-c:a', 'copy', reference]);
          } catch (error) {
            if (error?.code === 'FINALIZATION_CANCELLED' || error?.code === 'RECOVERY_CANCELLED') throw error;
            try { fs.unlinkSync(reference); } catch {}
            try {
              await this.run(executable, ['-y', '-hide_banner', '-loglevel', 'error', '-i', safe, '-map', '0:a:0', '-vn', '-ac', '2', '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', reference]);
            } catch (fallbackError) {
              if (fallbackError?.code === 'FINALIZATION_CANCELLED' || fallbackError?.code === 'RECOVERY_CANCELLED') throw fallbackError;
              this.log('warn', 'audio.reference-preserve-failed', { error: fallbackError });
            }
          }
          if (fs.existsSync(reference) && fs.statSync(reference).size >= 128) referenceName = path.basename(reference);
          else { try { fs.unlinkSync(reference); } catch {} }
        }
      }
      const metadata = {
        version: 1, recordingName: path.basename(safe), createdAt: new Date().toISOString(),
        systemAudioMode, microphoneStartOffsetMs: Math.max(0, Number(meta.microphoneStartOffsetMs) || 0),
        neuralMicrophoneMethod: String(meta.neuralMicrophoneMethod || 'none'),
        rawMicrophoneFile: microphoneName, neuralMicrophoneFile: neuralName, referenceFile: referenceName,
        echoDelayMs: null, echoDelayConfidence: 0, echoDelayAnalyzed: false,
        microphoneCapture: meta.microphoneCapture || null
      };
      fs.writeFileSync(path.join(stage, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
      // A retry never replaces an already complete source family.
      fs.renameSync(stage, target);
      const result = { preserved: true, microphoneAvailable: true, neuralAvailable: Boolean(neuralName), referenceAvailable: Boolean(referenceName) };
      this.log('info', 'audio.sources-preserved', result);
      return result;
    } finally {
      try { fs.rmSync(stage, { recursive: true, force: true }); } catch {}
    }
  }

  rename(sourceRecording, targetRecording) {
    const source = this.directory(sourceRecording);
    if (!fs.existsSync(source)) return false;
    const target = this.directory(targetRecording);
    if (source === target) return true;
    if (fs.existsSync(target)) throw new Error('Audio sources already exist for the target recording.');
    const metadata = this.read(sourceRecording);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(source, target);
    try {
      if (metadata) {
        metadata.recordingName = path.basename(targetRecording);
        delete metadata.directory;
        const file = path.join(target, 'metadata.json');
        const temporary = file + '.tmp';
        fs.writeFileSync(temporary, JSON.stringify(metadata, null, 2) + '\n');
        fs.renameSync(temporary, file);
      }
    } catch (error) { try { fs.renameSync(target, source); } catch {} throw error; }
    return true;
  }

  async moveToTrash(recording) {
    const directory = this.directory(recording);
    if (!fs.existsSync(directory)) return false;
    await this.trash(directory);
    return true;
  }

  discard(recording) {
    fs.rmSync(this.directory(recording), { recursive: true, force: true });
  }
}

module.exports = { AudioSourceManager };
