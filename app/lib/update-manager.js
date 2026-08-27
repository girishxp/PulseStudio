const fs = require('fs');
const path = require('path');

class RecoveryAwareUpdateManager {
  constructor({ app, getWindow, isSafe, configPath, onStatus = () => {} }) {
    this.app = app;
    this.getWindow = getWindow;
    this.isSafe = isSafe;
    this.configPath = configPath;
    this.onStatus = onStatus;
    this.updater = null;
    this.timer = null;
    this.lastAutoCheck = 0;
    this.state = { state: 'idle', configured: false, availableVersion: '', progress: null, message: '' };
  }
  emit(patch = {}) {
    this.state = { ...this.state, ...patch, checkedAt: Date.now() };
    this.onStatus(this.snapshot());
    const win = this.getWindow?.();
    if (win && !win.isDestroyed()) win.webContents.send('update:status', this.snapshot());
    return this.snapshot();
  }
  snapshot() { return { ...this.state }; }
  readConfig() {
    let config = {};
    try { config = JSON.parse(fs.readFileSync(this.configPath, 'utf8')); } catch {}
    const url = String(process.env.SCREEN_RECORDER_UPDATE_URL || config.url || '').trim();
    return { ...config, url };
  }
  init() {
    if (!this.app.isPackaged) return this.emit({ state: 'development', configured: false, message: 'Updates are available in the installed PulseStudio app.' });
    const config = this.readConfig();
    if (!config.url) return this.emit({ state: 'unconfigured', configured: false, message: 'Automatic updates are not configured for this build.' });
    let autoUpdater;
    try { ({ autoUpdater } = require('electron-updater')); } catch {
      return this.emit({ state: 'unavailable', configured: false, message: 'Automatic updates are unavailable in this build.' });
    }
    this.updater = autoUpdater;
    this.updater.autoDownload = false;
    this.updater.autoInstallOnAppQuit = false;
    this.updater.allowDowngrade = false;
    this.updater.setFeedURL({ provider: 'generic', url: config.url, channel: config.channel || 'latest' });
    this.updater.on('checking-for-update', () => this.emit({ state: 'checking', configured: true, message: 'Checking for updates…', progress: null }));
    this.updater.on('update-not-available', () => this.emit({ state: 'current', configured: true, message: 'PulseStudio is up to date.', progress: null, availableVersion: '' }));
    this.updater.on('update-available', (info) => {
      const safe = this.isSafe();
      this.emit({ state: safe.safe ? 'downloading' : 'deferred', configured: true, availableVersion: info?.version || '', message: safe.safe ? 'An update is available and is downloading in the background.' : `An update is available and will wait until ${safe.reason}.`, progress: 0 });
      if (safe.safe) this.updater.downloadUpdate().catch((error) => this.emit({ state: 'error', message: 'The update could not be downloaded. Check your connection and try again later.', technicalError: error?.message || String(error), progress: null }));
    });
    this.updater.on('download-progress', (progress) => this.emit({ state: 'downloading', configured: true, progress: Math.max(0, Math.min(1, Number(progress?.percent || 0) / 100)), message: 'Downloading update in the background…' }));
    this.updater.on('update-downloaded', (info) => this.emit({ state: 'ready', configured: true, availableVersion: info?.version || this.state.availableVersion, progress: 1, message: 'Update ready. Restart PulseStudio when convenient to install it.' }));
    this.updater.on('error', (error) => this.emit({ state: 'error', configured: true, progress: null, message: 'The update check could not finish. Check your connection and try again later.', technicalError: error?.message || String(error) }));
    this.emit({ state: 'idle', configured: true, message: 'Automatic update checks are enabled.' });
    setTimeout(() => this.check(false), 30_000).unref?.();
    this.timer = setInterval(() => {
      if (this.state.state === 'deferred') this.resumeDeferred();
      else if (Date.now() - this.lastAutoCheck >= 6 * 60 * 60 * 1000) this.check(false);
    }, 60 * 1000);
    this.timer.unref?.();
    return this.snapshot();
  }
  async check(manual = false) {
    if (!this.updater) return this.snapshot();
    this.lastAutoCheck = Date.now();
    const safe = this.isSafe();
    if (!safe.safe) return this.emit({ state: 'deferred', message: `Update check will wait until ${safe.reason}.` });
    try { await this.updater.checkForUpdates(); } catch (error) { if (manual) this.emit({ state: 'error', message: 'The update check could not finish. Check your connection and try again later.', technicalError: error?.message || String(error) }); }
    return this.snapshot();
  }
  async resumeDeferred() {
    if (!this.updater) return this.snapshot();
    const safe = this.isSafe();
    if (!safe.safe) return this.snapshot();
    if (this.state.availableVersion) {
      this.emit({ state: 'downloading', message: 'PulseStudio is idle. Downloading the update in the background…', progress: 0 });
      try { await this.updater.downloadUpdate(); } catch (error) { this.emit({ state: 'error', message: 'The update could not be downloaded. Check your connection and try again later.', technicalError: error?.message || String(error), progress: null }); }
    } else await this.check(false);
    return this.snapshot();
  }
  install() {
    if (!this.updater || this.state.state !== 'ready') return { ok: false, reason: 'No downloaded update is ready.' };
    const safe = this.isSafe();
    if (!safe.safe) { this.emit({ state: 'deferred', message: `Restart will wait until ${safe.reason}.` }); return { ok: false, reason: safe.reason }; }
    this.updater.quitAndInstall(false, true);
    return { ok: true };
  }
  shutdown() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}
module.exports = { RecoveryAwareUpdateManager };
