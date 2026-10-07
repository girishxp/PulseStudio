'use strict';

// Dock naming is bundle metadata; app.setName only changes Electron's internal
// name. Preserve the host's permission identity by editing display strings only,
// and only when neither the Info.plist nor resources are sealed by its signature.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const DISPLAY_NAME = 'Pulse Studio';
const STOCK_ID = 'com.github.Electron';
const STOCK_EXECUTABLE = 'Electron';
const ALLOWED_NAMES = new Set(['Electron', DISPLAY_NAME]);

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024,
    env: { ...process.env, LANG: 'C', LC_ALL: 'C' }
  });
  return { status: result.status, output: String(result.stdout || '') + String(result.stderr || ''), error: result.error };
}

function readInfo(file) {
  const result = run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file]);
  if (result.status !== 0) throw new Error('Host bundle information could not be read.');
  return JSON.parse(result.output);
}

function fingerprint(bundle, executable) {
  const signing = run('/usr/bin/codesign', ['--display', '--verbose=4', bundle]);
  const requirements = run('/usr/bin/codesign', ['--display', '--requirements', '-', bundle]);
  return {
    executableSha256: crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex'),
    signingStatus: signing.status, signing: signing.output,
    requirementsStatus: requirements.status, requirements: requirements.output
  };
}

function sameInfo(before, after) {
  const withoutNames = info => Object.fromEntries(Object.entries(info).filter(([key]) => key !== 'CFBundleName' && key !== 'CFBundleDisplayName'));
  return JSON.stringify(withoutNames(before)) === JSON.stringify(withoutNames(after));
}

function ensureMacHostDisplayName(appDir, options = {}) {
  if ((options.platform || process.platform) !== 'darwin') return { state: 'skipped', reason: 'not-macos' };
  const bundle = path.join(appDir, 'node_modules/electron/dist/Electron.app');
  const infoFile = path.join(bundle, 'Contents/Info.plist');
  const executable = path.join(bundle, 'Contents/MacOS', STOCK_EXECUTABLE);
  let temporaryFile;
  let originalBytes;
  let replaced = false;
  try {
    if (!fs.existsSync(infoFile) || !fs.existsSync(executable)) return { state: 'skipped', reason: 'host-unavailable' };
    const info = readInfo(infoFile);
    if (info.CFBundleIdentifier !== STOCK_ID || info.CFBundleExecutable !== STOCK_EXECUTABLE) return { state: 'skipped', reason: 'non-stock-identity' };
    if (!ALLOWED_NAMES.has(info.CFBundleName) || !ALLOWED_NAMES.has(info.CFBundleDisplayName)) return { state: 'skipped', reason: 'non-stock-name' };
    if (info.CFBundleName === DISPLAY_NAME && info.CFBundleDisplayName === DISPLAY_NAME) return { state: 'unchanged', displayName: DISPLAY_NAME };
    if (fs.existsSync(path.join(bundle, 'Contents/_CodeSignature/CodeResources'))) return { state: 'skipped', reason: 'sealed-resources' };
    const before = fingerprint(bundle, executable);
    const unbound = before.signingStatus === 0 && /^Info\.plist=not bound$/m.test(before.signing) && /^Sealed Resources=none$/m.test(before.signing);
    const unsigned = before.signingStatus !== 0 && /code object is not signed at all/i.test(before.signing) && !before.signing.includes('Info.plist=');
    if (!unbound && !unsigned) return { state: 'skipped', reason: 'bound-or-unknown-signature' };
    originalBytes = fs.readFileSync(infoFile);
    const mode = fs.statSync(infoFile).mode;
    temporaryFile = path.join(path.dirname(infoFile), `.pulsestudio-display-name-${process.pid}-${crypto.randomBytes(6).toString('hex')}.plist`);
    fs.writeFileSync(temporaryFile, originalBytes, { flag: 'wx', mode });
    for (const key of ['CFBundleDisplayName', 'CFBundleName']) {
      const changed = run('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${DISPLAY_NAME}`, temporaryFile]);
      if (changed.status !== 0) throw new Error('Host display name could not be prepared.');
    }
    const prepared = readInfo(temporaryFile);
    if (!sameInfo(info, prepared) || prepared.CFBundleName !== DISPLAY_NAME || prepared.CFBundleDisplayName !== DISPLAY_NAME) throw new Error('Host display-name change exceeded its scope.');
    fs.renameSync(temporaryFile, infoFile);
    temporaryFile = undefined;
    replaced = true;
    const afterInfo = readInfo(infoFile);
    const after = fingerprint(bundle, executable);
    if (!sameInfo(info, afterInfo) || JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Host code identity changed unexpectedly.');
    return { state: 'updated', displayName: DISPLAY_NAME, executableSha256: before.executableSha256 };
  } catch (error) {
    // Branding must never trigger dependency installation, signing, a permission
    // reset, or a launch failure. A failed check simply leaves the original host.
    if (replaced && originalBytes) {
      try { fs.writeFileSync(infoFile, originalBytes); } catch {}
    }
    return { state: 'skipped', reason: 'branding-unavailable', error: String(error?.message || error) };
  } finally {
    if (temporaryFile) { try { fs.unlinkSync(temporaryFile); } catch {} }
  }
}

module.exports = { DISPLAY_NAME, ensureMacHostDisplayName };
