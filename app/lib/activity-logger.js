const fs = require('fs');
const path = require('path');

function safeJson(value) {
  try {
    return JSON.stringify(value, (_key, item) => {
      if (item instanceof Error) return { name: item.name, message: item.message, stack: item.stack, code: item.code };
      if (typeof item === 'bigint') return Number(item);
      return item;
    });
  } catch {
    return JSON.stringify({ value: String(value) });
  }
}

class ActivityLogger {
  constructor({ directory, fallbackDirectory = null, maxBytes = 5 * 1024 * 1024, backups = 4 } = {}) {
    this.requestedDirectory = directory;
    this.fallbackDirectory = fallbackDirectory;
    this.maxBytes = Math.max(256 * 1024, Number(maxBytes) || 5 * 1024 * 1024);
    this.backups = Math.max(1, Number(backups) || 4);
    this.directory = null;
    this.filePath = null;
    this.sessionId = `${Date.now().toString(36)}-${process.pid}`;
    this.initialized = false;
  }

  ensure() {
    if (this.initialized && this.filePath) return this.filePath;
    const candidates = [this.requestedDirectory, this.fallbackDirectory].filter(Boolean);
    for (const candidate of candidates) {
      try {
        fs.mkdirSync(candidate, { recursive: true });
        const probe = path.join(candidate, `.write-test-${process.pid}`);
        fs.writeFileSync(probe, 'ok');
        fs.unlinkSync(probe);
        this.directory = candidate;
        this.filePath = path.join(candidate, 'pulsestudio.log');
        this.initialized = true;
        return this.filePath;
      } catch {}
    }
    return null;
  }

  rotateIfNeeded(extraBytes = 0) {
    const file = this.ensure();
    if (!file) return;
    try {
      const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
      if (size + extraBytes < this.maxBytes) return;
      for (let index = this.backups - 1; index >= 1; index -= 1) {
        const src = path.join(this.directory, `pulsestudio.${index}.log`);
        const dst = path.join(this.directory, `pulsestudio.${index + 1}.log`);
        if (fs.existsSync(src)) {
          try { fs.rmSync(dst, { force: true }); } catch {}
          try { fs.renameSync(src, dst); } catch {}
        }
      }
      const first = path.join(this.directory, 'pulsestudio.1.log');
      try { fs.rmSync(first, { force: true }); } catch {}
      if (fs.existsSync(file)) fs.renameSync(file, first);
    } catch {}
  }

  write(level, event, details = {}) {
    const record = {
      ts: new Date().toISOString(),
      session: this.sessionId,
      pid: process.pid,
      level: String(level || 'info'),
      event: String(event || 'event'),
      details: details && typeof details === 'object' ? details : { message: String(details || '') }
    };
    const line = `${safeJson(record)}\n`;
    try {
      this.rotateIfNeeded(Buffer.byteLength(line));
      if (this.filePath) fs.appendFileSync(this.filePath, line, 'utf8');
    } catch {}
    return record;
  }

  info(event, details) { return this.write('info', event, details); }
  warn(event, details) { return this.write('warn', event, details); }
  error(event, details) { return this.write('error', event, details); }
}

module.exports = { ActivityLogger };
