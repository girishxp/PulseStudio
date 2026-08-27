const fs = require('fs');
const path = require('path');

function atomicWriteJson(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temp, target);
}

class RecoveryJournalManager {
  constructor({ journalPath, snapshot, debounceMs = 4000 }) {
    this.journalPath = journalPath;
    this.snapshot = snapshot;
    this.debounceMs = Math.max(1000, Number(debounceMs) || 4000);
    this.timer = null;
    this.createdAt = 0;
    this.pendingExtra = {};
  }

  read() {
    try { return JSON.parse(fs.readFileSync(this.journalPath, 'utf8')); } catch { return null; }
  }

  checkpoint(extra = {}, force = false) {
    this.pendingExtra = { ...this.pendingExtra, ...(extra || {}) };
    if (force) return this.flush();
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.debounceMs);
    this.timer.unref?.();
  }

  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const snapshot = this.snapshot?.();
    if (!snapshot?.tempPath) return null;
    const previous = this.read() || {};
    const payload = {
      version: 2,
      ...snapshot,
      createdAt: previous.createdAt || this.createdAt || Date.now(),
      updatedAt: Date.now(),
      ...this.pendingExtra
    };
    this.createdAt = payload.createdAt;
    this.pendingExtra = {};
    try { atomicWriteJson(this.journalPath, payload); } catch {}
    return payload;
  }

  begin(extra = {}) {
    this.createdAt = Date.now();
    this.pendingExtra = {};
    return this.checkpoint({ createdAt: this.createdAt, status: 'recording', ...(extra || {}) }, true);
  }

  clear() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.pendingExtra = {};
    this.createdAt = 0;
    try { fs.unlinkSync(this.journalPath); } catch {}
  }
}

function pendingManifestPath(recoveryDir, id) {
  return path.join(recoveryDir, `pending-${id}.json`);
}

function createPendingRecovery(recoveryDir, journal, reason = '') {
  if (!journal?.tempPath) return null;
  const id = `${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2, 8)}`;
  const manifest = {
    ...journal,
    version: 2,
    recoveryId: id,
    status: 'finalization_failed',
    failureReason: String(reason || ''),
    preservedAt: Date.now()
  };
  const target = pendingManifestPath(recoveryDir, id);
  atomicWriteJson(target, manifest);
  return { id, manifestPath: target, manifest };
}

function listPendingRecoveries(recoveryDir) {
  try {
    return fs.readdirSync(recoveryDir)
      .filter((name) => /^pending-.*\.json$/i.test(name))
      .map((name) => {
        const manifestPath = path.join(recoveryDir, name);
        try { return { manifestPath, manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')) }; } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => Number(a.manifest?.createdAt || a.manifest?.preservedAt || 0) - Number(b.manifest?.createdAt || b.manifest?.preservedAt || 0));
  } catch { return []; }
}

module.exports = {
  atomicWriteJson,
  RecoveryJournalManager,
  createPendingRecovery,
  listPendingRecoveries
};
