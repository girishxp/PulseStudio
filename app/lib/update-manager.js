const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');

function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    try { fs.rmSync(file, { force: true }); } catch {}
    fs.renameSync(temporary, file);
    return true;
  } catch {
    return false;
  }
}
function normalizeVersion(value) {
  return String(value || '').trim().replace(/^v/i, '').split('-')[0];
}
function compareVersions(a, b) {
  const pa = normalizeVersion(a).split('.').map((n) => Number(n) || 0);
  const pb = normalizeVersion(b).split('.').map((n) => Number(n) || 0);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff) return diff > 0 ? 1 : -1;
  }
  return 0;
}
function requestJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const endpoint = new URL(url);
    const client = endpoint.protocol === 'http:' ? http : https;
    const req = client.request(endpoint, { method: 'GET', headers, timeout: 15000 }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        requestJson(new URL(res.headers.location, endpoint).toString(), headers).then(resolve, reject);
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; if (body.length > 5 * 1024 * 1024) req.destroy(new Error('Update response is too large.')); });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`GitHub returned HTTP ${res.statusCode}.`));
        try { resolve(JSON.parse(body)); } catch { reject(new Error('GitHub returned an invalid update response.')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Update check timed out.')));
    req.on('error', reject);
    req.end();
  });
}
function downloadFile(url, destination, headers = {}, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const endpoint = new URL(url);
    const client = endpoint.protocol === 'http:' ? http : https;
    const req = client.request(endpoint, { method: 'GET', headers, timeout: 30000 }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        downloadFile(new URL(res.headers.location, endpoint).toString(), destination, headers, onProgress).then(resolve, reject);
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error(`Update download returned HTTP ${res.statusCode}.`));
      }
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      const partial = `${destination}.partial`;
      try { fs.rmSync(partial, { force: true }); } catch {}
      const output = fs.createWriteStream(partial);
      const total = Number(res.headers['content-length'] || 0);
      let received = 0;
      res.on('data', (chunk) => {
        received += chunk.length;
        if (total > 0) onProgress(Math.max(0, Math.min(1, received / total)));
      });
      res.pipe(output);
      output.on('finish', () => {
        output.close(() => {
          try { fs.rmSync(destination, { force: true }); } catch {}
          fs.renameSync(partial, destination);
          resolve({ received, total });
        });
      });
      output.on('error', (error) => { try { fs.rmSync(partial, { force: true }); } catch {} reject(error); });
    });
    req.on('timeout', () => req.destroy(new Error('Update download timed out.')));
    req.on('error', reject);
    req.end();
  });
}
function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(file);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
    input.on('error', reject);
  });
}
function shellQuote(value) { return `'${String(value).replace(/'/g, `'"'"'`)}'`; }
function psQuote(value) { return `'${String(value).replace(/'/g, "''")}'`; }

class RecoveryAwareUpdateManager {
  constructor({ app, getWindow, isSafe, configPath, onStatus = () => {}, onEvent = () => {} }) {
    this.app = app;
    this.getWindow = getWindow;
    this.isSafe = isSafe;
    this.configPath = configPath;
    this.onStatus = onStatus;
    this.onEvent = onEvent;
    this.timer = null;
    this.lastAutoCheck = 0;
    this.pendingRelease = null;
    this.downloadPath = '';
    this.preferencesPath = '';
    this.preferences = { skippedVersion: '', remindVersion: '', remindAfter: 0 };
    this.state = { state: 'idle', configured: false, availableVersion: '', progress: null, message: '', canDownload: false };
  }
  emit(patch = {}) {
    this.state = { ...this.state, ...patch, checkedAt: Date.now() };
    this.onStatus(this.snapshot());
    const win = this.getWindow?.();
    if (win && !win.isDestroyed()) win.webContents.send('update:status', this.snapshot());
    return this.snapshot();
  }
  event(name, props = {}) { try { this.onEvent(name, props); } catch {} }
  snapshot() { return { ...this.state }; }
  readConfig() {
    const config = readJson(this.configPath, {});
    return {
      ...config,
      owner: String(process.env.PULSESTUDIO_UPDATE_OWNER || config.owner || '').trim(),
      repo: String(process.env.PULSESTUDIO_UPDATE_REPO || config.repo || '').trim()
    };
  }
  savePreferences() {
    if (this.preferencesPath) writeJson(this.preferencesPath, this.preferences);
  }
  clearSuppressionForVersion(version) {
    let changed = false;
    if (this.preferences.skippedVersion === version) { this.preferences.skippedVersion = ''; changed = true; }
    if (this.preferences.remindVersion === version || Number(this.preferences.remindAfter || 0) > 0) {
      this.preferences.remindVersion = '';
      this.preferences.remindAfter = 0;
      changed = true;
    }
    if (changed) this.savePreferences();
  }
  releasePatch(version, release) {
    return {
      configured: true,
      availableVersion: version,
      releaseNotes: String(release?.body || '').trim().slice(0, 6000),
      releasePublishedAt: String(release?.published_at || ''),
      releaseUrl: String(release?.html_url || ''),
      progress: null
    };
  }
  init() {
    this.config = this.readConfig();
    this.preferencesPath = path.join(this.app.getPath('userData'), 'update-preferences.json');
    this.preferences = {
      skippedVersion: '',
      remindVersion: '',
      remindAfter: 0,
      ...readJson(this.preferencesPath, {})
    };
    if (String(this.config.provider || '') !== 'github-portable' || !this.config.owner || !this.config.repo) {
      return this.emit({ state: 'unconfigured', configured: false, message: 'Automatic updates are not configured for this build.' });
    }
    this.emit({ state: 'idle', configured: true, message: 'Automatic GitHub Release checks are enabled.', canDownload: false });
    setTimeout(() => this.check(false), 15000).unref?.();
    const intervalHours = Math.max(1, Number(this.config.checkIntervalHours || 6));
    this.timer = setInterval(() => {
      if (this.state.state === 'deferred') void this.resumeDeferred();
      else if (Date.now() - this.lastAutoCheck >= intervalHours * 60 * 60 * 1000) void this.check(false);
    }, 60 * 1000);
    this.timer.unref?.();
    return this.snapshot();
  }
  async check(manual = false) {
    if (!this.state.configured) return this.snapshot();
    this.lastAutoCheck = Date.now();
    const safe = this.isSafe();
    if (!safe.safe) return this.emit({ state: 'deferred', configured: true, canDownload: false, message: `Update check will wait until ${safe.reason}.` });
    this.emit({ state: 'checking', configured: true, message: 'Checking GitHub for updates…', progress: null, canDownload: false });
    this.event('update_check_started', { manual: Boolean(manual) });
    try {
      const apiBase = String(this.config.apiBaseUrl || 'https://api.github.com').replace(/\/$/, '');
      const url = `${apiBase}/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repo)}/releases/latest`;
      const release = await requestJson(url, {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': `PulseStudio/${this.app.getVersion()}`
      });
      const version = normalizeVersion(release?.tag_name || release?.name || '');
      if (!version) throw new Error('The latest GitHub release does not contain a version tag.');
      if (compareVersions(version, this.app.getVersion()) <= 0) {
        this.pendingRelease = null;
        this.downloadPath = '';
        if (this.preferences.skippedVersion || this.preferences.remindVersion || Number(this.preferences.remindAfter || 0) > 0) {
          this.preferences = { skippedVersion: '', remindVersion: '', remindAfter: 0 };
          this.savePreferences();
        }
        this.event('update_current', { latest_version: version });
        return this.emit({ state: 'current', configured: true, message: `PulseStudio ${this.app.getVersion()} is up to date.`, progress: null, availableVersion: '', releaseNotes: '', canDownload: false });
      }
      const pattern = new RegExp(this.config.assetPattern || '^PulseStudio-cross-platform-v([0-9]+\\.[0-9]+\\.[0-9]+)\\.zip$', 'i');
      const assets = Array.isArray(release?.assets) ? release.assets : [];
      const expectedName = `PulseStudio-cross-platform-v${version}.zip`;
      const asset = assets.find((item) => String(item?.name || '') === expectedName) || assets.find((item) => pattern.test(String(item?.name || '')));
      if (!asset?.browser_download_url) throw new Error(`Release v${version} does not contain ${expectedName}.`);
      this.pendingRelease = { version, release, asset };
      this.downloadPath = '';
      const releasePatch = this.releasePatch(version, release);

      if (this.preferences.skippedVersion && compareVersions(version, this.preferences.skippedVersion) > 0) {
        this.preferences.skippedVersion = '';
        this.savePreferences();
      }
      if (this.preferences.remindVersion && this.preferences.remindVersion !== version) {
        this.preferences.remindVersion = '';
        this.preferences.remindAfter = 0;
        this.savePreferences();
      }

      if (!manual && this.preferences.skippedVersion === version) {
        this.event('update_suppressed', { reason: 'skipped', available_version: version });
        return this.emit({ ...releasePatch, state: 'skipped', canDownload: false, message: `PulseStudio v${version} is available, but this version was skipped.` });
      }
      if (!manual && this.preferences.remindVersion === version && Number(this.preferences.remindAfter || 0) > Date.now()) {
        this.event('update_suppressed', { reason: 'remind_later', available_version: version });
        return this.emit({ ...releasePatch, state: 'reminded', canDownload: false, remindAfter: Number(this.preferences.remindAfter || 0), message: `PulseStudio v${version} is available. The reminder is postponed.` });
      }

      this.event('update_available', { available_version: version, manual: Boolean(manual) });
      return this.emit({
        ...releasePatch,
        state: 'available',
        canDownload: true,
        message: `PulseStudio v${version} is available. Update now or choose another reminder option.`
      });
    } catch (error) {
      this.event('update_error', { stage: 'check', error_name: error?.name || 'Error' });
      return this.emit({ state: 'error', configured: true, progress: null, canDownload: false, availableVersion: '', message: 'The update check could not finish. Check your connection and try again later.', technicalError: error?.message || String(error) });
    }
  }
  async download() {
    if (!this.state.configured) return this.snapshot();
    if (!this.pendingRelease) {
      const checked = await this.check(true);
      if (checked.state !== 'available') return checked;
    }
    const safe = this.isSafe();
    if (!safe.safe) {
      const version = this.pendingRelease?.version || this.state.availableVersion || '';
      return this.emit({ state: 'available', configured: true, availableVersion: version, canDownload: true, message: `PulseStudio v${version} is available. Finish ${safe.reason}, then choose Update Now.` });
    }
    const { version, release } = this.pendingRelease;
    this.clearSuppressionForVersion(version);
    this.event('update_download_requested', { available_version: version });
    this.emit({ ...this.releasePatch(version, release), state: 'downloading', configured: true, availableVersion: version, canDownload: false, message: `Downloading PulseStudio v${version}…`, progress: 0 });
    try {
      await this.downloadPending();
      return this.snapshot();
    } catch (error) {
      this.event('update_error', { stage: 'download', error_name: error?.name || 'Error' });
      return this.emit({ ...this.releasePatch(version, release), state: 'error', configured: true, availableVersion: version, canDownload: true, progress: null, message: 'The update could not be downloaded. Check your connection and try again.', technicalError: error?.message || String(error) });
    }
  }
  async downloadPending() {
    if (!this.pendingRelease) return this.snapshot();
    const { version, asset, release } = this.pendingRelease;
    const updatesDir = path.join(this.app.getPath('userData'), 'updates');
    const destination = path.join(updatesDir, `PulseStudio-cross-platform-v${version}.zip`);
    const headers = { Accept: 'application/octet-stream', 'User-Agent': `PulseStudio/${this.app.getVersion()}` };
    await downloadFile(asset.browser_download_url, destination, headers, (progress) => this.emit({ ...this.releasePatch(version, release), state: 'downloading', configured: true, availableVersion: version, canDownload: false, progress, message: `Downloading PulseStudio v${version}… ${Math.round(progress * 100)}%` }));
    if (Number(asset.size || 0) > 0 && fs.statSync(destination).size !== Number(asset.size)) throw new Error('The downloaded update size does not match the GitHub release asset.');
    const digest = String(asset.digest || '').trim();
    if (/^sha256:/i.test(digest)) {
      const expected = digest.slice(7).toLowerCase();
      const actual = await sha256(destination);
      if (actual !== expected) throw new Error('The downloaded update failed SHA-256 verification.');
    }
    this.downloadPath = destination;
    this.event('update_downloaded', { available_version: version, verified_digest: /^sha256:/i.test(digest) });
    return this.emit({ ...this.releasePatch(version, release), state: 'ready', configured: true, availableVersion: version, canDownload: false, progress: 1, message: `PulseStudio v${version} is ready. Restart now to install it.` });
  }
  remindLater() {
    if (!this.pendingRelease) return { ok: false, reason: 'No update is waiting for a reminder choice.', status: this.snapshot() };
    const version = this.pendingRelease.version;
    const hours = Math.max(1, Number(this.config.remindLaterHours || 24));
    const remindAfter = Date.now() + hours * 60 * 60 * 1000;
    this.preferences.remindVersion = version;
    this.preferences.remindAfter = remindAfter;
    if (this.preferences.skippedVersion === version) this.preferences.skippedVersion = '';
    this.savePreferences();
    this.event('update_remind_later', { available_version: version, hours });
    const status = this.emit({ ...this.releasePatch(version, this.pendingRelease.release), state: 'reminded', canDownload: false, remindAfter, message: `PulseStudio will remind you about v${version} later.` });
    return { ok: true, remindAfter, status };
  }
  skipVersion() {
    if (!this.pendingRelease) return { ok: false, reason: 'No update is available to skip.', status: this.snapshot() };
    const version = this.pendingRelease.version;
    this.preferences.skippedVersion = version;
    this.preferences.remindVersion = '';
    this.preferences.remindAfter = 0;
    this.savePreferences();
    this.event('update_skipped', { available_version: version });
    const status = this.emit({ ...this.releasePatch(version, this.pendingRelease.release), state: 'skipped', canDownload: false, message: `PulseStudio v${version} will be skipped. You will still be notified about newer releases.` });
    this.pendingRelease = null;
    this.downloadPath = '';
    return { ok: true, status };
  }
  async resumeDeferred() {
    if (!this.state.configured) return this.snapshot();
    const safe = this.isSafe();
    if (!safe.safe) return this.snapshot();
    return this.check(false);
  }
  createInstallHelper() {
    if (!this.downloadPath || !this.pendingRelease) throw new Error('No downloaded update is ready.');
    const version = this.pendingRelease.version;
    const appRoot = path.dirname(path.dirname(__dirname));
    const updatesDir = path.join(this.app.getPath('userData'), 'updates');
    fs.mkdirSync(updatesDir, { recursive: true });
    if (process.platform === 'win32') {
      const helper = path.join(updatesDir, `apply-pulsestudio-v${version}.ps1`);
      const launcher = path.join(appRoot, 'Start PulseStudio - Windows.bat');
      const script = `$ErrorActionPreference = 'Stop'\n` +
        `$root = ${psQuote(appRoot)}\n$zip = ${psQuote(this.downloadPath)}\n$expected = ${psQuote(version)}\n$pidToWait = ${process.pid}\n` +
        `while (Get-Process -Id $pidToWait -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 250 }\n` +
        `$tmp = Join-Path $env:TEMP ('PulseStudio-update-' + [guid]::NewGuid().ToString())\nNew-Item -ItemType Directory -Path $tmp | Out-Null\n` +
        `Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force\n$src = Join-Path $tmp 'PulseStudio'\n` +
        `if (!(Test-Path (Join-Path $src 'app\\package.json'))) { throw 'Update package is invalid.' }\n` +
        `$pkg = Get-Content (Join-Path $src 'app\\package.json') -Raw | ConvertFrom-Json\nif ($pkg.version -ne $expected) { throw 'Update version validation failed.' }\n` +
        `Get-ChildItem -LiteralPath $src -File | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $root $_.Name) -Force }\n` +
        `$srcApp = Join-Path $src 'app'\n$dstApp = Join-Path $root 'app'\n` +
        `$rc = Start-Process -FilePath 'robocopy.exe' -ArgumentList @($srcApp,$dstApp,'/MIR','/IS','/IT','/R:2','/W:1','/XD','node_modules','logs','.pulsestudio-runtime-windows') -Wait -PassThru -WindowStyle Hidden\n` +
        `if ($rc.ExitCode -gt 7) { throw ('robocopy failed with exit code ' + $rc.ExitCode) }\n` +
        `Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue\nStart-Process -FilePath ${psQuote(launcher)}\n`;
      fs.writeFileSync(helper, script, 'utf8');
      return { command: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helper], helper };
    }
    const helper = path.join(updatesDir, `apply-pulsestudio-v${version}.command`);
    const launcher = path.join(appRoot, 'Start PulseStudio - macOS.command');
    const log = path.join(updatesDir, `update-v${version}.log`);
    const shell = process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash';
    const script = `#!${shell}\nset -eu\nexec >> ${shellQuote(log)} 2>&1\necho "PulseStudio update started: $(date)"\n` +
      `ROOT=${shellQuote(appRoot)}\nZIP=${shellQuote(this.downloadPath)}\nEXPECTED=${shellQuote(version)}\nPID_TO_WAIT=${process.pid}\n` +
      `while kill -0 "$PID_TO_WAIT" >/dev/null 2>&1; do sleep 0.25; done\nTMP_DIR="$(mktemp -d "\${TMPDIR:-/tmp}/pulsestudio-update.XXXXXX")"\n` +
      `/usr/bin/unzip -q "$ZIP" -d "$TMP_DIR"\nSRC="$TMP_DIR/PulseStudio"\n` +
      `[ -f "$SRC/app/package.json" ] || { echo "Invalid update package"; exit 1; }\n` +
      `ACTUAL="$(/usr/bin/env node -p "require('$SRC/app/package.json').version")"\n[ "$ACTUAL" = "$EXPECTED" ] || { echo "Version mismatch: $ACTUAL"; exit 1; }\n` +
      `/usr/bin/rsync -a --checksum --delete --exclude '.git/' --exclude 'app/node_modules/' --exclude 'app/logs/' --exclude 'app/.pulsestudio-runtime-windows/' "$SRC/" "$ROOT/"\n` +
      `/bin/chmod +x "$ROOT/Start PulseStudio - macOS.command" "$ROOT/Start PulseStudio - Linux.sh" 2>/dev/null || true\n/bin/rm -rf "$TMP_DIR"\necho "PulseStudio v$EXPECTED installed: $(date)"\n` +
      (process.platform === 'darwin' ? `/usr/bin/open "$ROOT/Start PulseStudio - macOS.command"\n` : `"$ROOT/Start PulseStudio - Linux.sh" >/dev/null 2>&1 &\n`);
    fs.writeFileSync(helper, script, { encoding: 'utf8', mode: 0o755 });
    try { fs.chmodSync(helper, 0o755); } catch {}
    return { command: shell, args: [helper], helper };
  }
  install() {
    if (this.state.state !== 'ready' || !this.downloadPath) return { ok: false, reason: 'No downloaded update is ready.' };
    const safe = this.isSafe();
    if (!safe.safe) {
      this.emit({ state: 'ready', message: `The update is ready. Finish ${safe.reason}, then choose Restart & Install.` });
      return { ok: false, reason: safe.reason };
    }
    try {
      const helper = this.createInstallHelper();
      const child = spawn(helper.command, helper.args, { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
      this.event('update_install_started', { available_version: this.pendingRelease?.version || '' });
      this.emit({ state: 'installing', canDownload: false, message: `Installing PulseStudio v${this.pendingRelease?.version || ''}…` });
      setTimeout(() => this.app.quit(), 250);
      return { ok: true };
    } catch (error) {
      this.event('update_error', { stage: 'install', error_name: error?.name || 'Error' });
      this.emit({ state: 'error', canDownload: false, message: 'PulseStudio could not start the update installer.', technicalError: error?.message || String(error), progress: null });
      return { ok: false, reason: error?.message || String(error) };
    }
  }
  shutdown() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}

module.exports = { RecoveryAwareUpdateManager, compareVersions };
