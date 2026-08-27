const fs = require('fs');
const path = require('path');

const MODEL_DEFINITIONS = [
  { id: 'transcription', name: 'Whisper Small', purpose: 'Transcription', modelId: 'onnx-community/whisper-small', kind: 'transcribe', recommended: true },
  { id: 'speaker-segmentation', name: 'Speaker Segmentation', purpose: 'Detect speaker turns', modelId: 'onnx-community/pyannote-segmentation-3.0', kind: 'diarize', recommended: true },
  { id: 'speaker-voice', name: 'Speaker Voice Matching', purpose: 'Keep the same speaker label across turns', modelId: 'Xenova/wavlm-base-plus-sv', kind: 'speaker-embedding', recommended: true },
  { id: 'speech-detection', name: 'Speech Detection', purpose: 'Voice activity and silence detection', modelId: 'onnx-community/silero-vad', kind: 'vad', recommended: true },
  { id: 'meeting-ai', name: 'Meeting Insights', purpose: 'Summary, chapters, actions and risks', modelId: 'onnx-community/Qwen2.5-1.5B-Instruct', kind: 'meeting-insights', recommended: false }
];

function directorySize(target) {
  let total = 0;
  try {
    const stat = fs.statSync(target);
    if (stat.isFile()) return stat.size;
    if (!stat.isDirectory()) return 0;
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
      const child = path.join(target, entry.name);
      if (entry.isDirectory()) total += directorySize(child);
      else if (entry.isFile()) { try { total += fs.statSync(child).size; } catch {} }
    }
  } catch {}
  return total;
}

class LocalModelManager {
  constructor({ cacheDir, aiWorkerManager }) {
    this.cacheDirProvider = cacheDir;
    this.aiWorkerManager = aiWorkerManager;
  }
  cacheDir() {
    const value = typeof this.cacheDirProvider === 'function' ? this.cacheDirProvider() : this.cacheDirProvider;
    return path.resolve(String(value || ''));
  }
  modelPath(definition) {
    return path.join(this.cacheDir(), ...definition.modelId.split('/'));
  }
  summary() {
    const cacheDir = this.cacheDir();
    fs.mkdirSync(cacheDir, { recursive: true });
    const models = MODEL_DEFINITIONS.map((definition) => {
      const modelPath = this.modelPath(definition);
      const bytes = directorySize(modelPath);
      return { ...definition, installed: bytes > 0, bytes };
    });
    const knownBytes = models.reduce((sum, item) => sum + item.bytes, 0);
    const cacheBytes = directorySize(cacheDir);
    return { cacheDir, cacheBytes, knownBytes, models };
  }
  async download(id) {
    const definition = MODEL_DEFINITIONS.find((item) => item.id === id);
    if (!definition) throw new Error('Unknown local AI model.');
    if (this.aiWorkerManager.snapshot().activeId) throw new Error('Wait for the current local AI task to finish or cancel it first.');
    await this.aiWorkerManager.request({
      task: 'preload-model',
      kind: definition.kind,
      model: definition.modelId,
      cacheDir: this.cacheDir()
    }, 45 * 60 * 1000, { priority: 5, label: `Downloading ${definition.name}` });
    return this.summary();
  }
  remove(id) {
    const definition = MODEL_DEFINITIONS.find((item) => item.id === id);
    if (!definition) throw new Error('Unknown local AI model.');
    if (this.aiWorkerManager.snapshot().activeId) throw new Error('A local AI task is using models. Wait for it to finish or cancel it first.');
    const cacheRoot = this.cacheDir();
    const target = path.resolve(this.modelPath(definition));
    if (!target.startsWith(cacheRoot + path.sep)) throw new Error('Unsafe model path.');
    try { fs.rmSync(target, { recursive: true, force: true }); } catch (error) { throw new Error(`Could not remove model: ${error.message}`); }
    return this.summary();
  }
}

module.exports = { LocalModelManager, MODEL_DEFINITIONS, directorySize };
