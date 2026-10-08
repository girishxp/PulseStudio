'use strict';

// The Dock can use the physical .app folder name even when its metadata and
// app.setName report the new name. Prepare that name before launch while keeping
// the original executable, signature, bundle ID and Electron dependency path.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const DISPLAY_NAME = 'Pulse Studio';
const STOCK_ID = 'com.github.Electron';
const STOCK_EXECUTABLE = 'Electron';
const BRANDED_BUNDLE = `${DISPLAY_NAME}.app`;
const ALLOWED_NAMES = new Set(['Electron', DISPLAY_NAME]);
const REGISTER_TOOL = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

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
    signingStatus: signing.status, signing: signing.output.replace(/^Executable=.+$/m, 'Executable=<unchanged-host>'),
    requirementsStatus: requirements.status, requirements: requirements.output.replace(/^Executable=.+$/m, 'Executable=<unchanged-host>')
  };
}

function sameInfo(before, after) {
  const withoutNames = info => Object.fromEntries(Object.entries(info).filter(([key]) => key !== 'CFBundleName' && key !== 'CFBundleDisplayName'));
  return JSON.stringify(withoutNames(before)) === JSON.stringify(withoutNames(after));
}

function refreshMacHostRegistration(bundle) {
  // A ZIP extraction can retain an older bundle directory modification date.
  // Replacing Info.plist alone does not force Launch Services (and the Dock)
  // to refresh that already-registered path. Update this host only; never reset
  // the user's database, restart the Dock, or alter any bundle/code identity.
  const refreshed = run(REGISTER_TOOL, ['-f', bundle]);
  return refreshed.status === 0
    ? { state: 'refreshed' }
    : { state: 'unavailable', reason: refreshed.error ? 'registration-tool-unavailable' : 'registration-refresh-failed' };
}

function bundlePaths(appDir) {
  const directory = path.resolve(appDir, 'node_modules/electron/dist');
  return { stock: path.join(directory, 'Electron.app'), branded: path.join(directory, BRANDED_BUNDLE) };
}

function existingBundle(appDir) {
  const paths = bundlePaths(appDir);
  if (fs.existsSync(paths.stock)) {
    const entry = fs.lstatSync(paths.stock);
    if (!entry.isSymbolicLink()) return { ...paths, bundle: paths.stock };
    // A compatibility link must point only at the physical sibling we manage.
    if (fs.realpathSync(paths.stock) !== paths.branded || !fs.lstatSync(paths.branded).isDirectory()) return { ...paths, reason: 'non-stock-path' };
    return { ...paths, bundle: paths.branded };
  }
  if (fs.existsSync(paths.branded) && fs.lstatSync(paths.branded).isDirectory()) return { ...paths, bundle: paths.branded };
  return { ...paths, reason: 'host-unavailable' };
}

function getMacHostBundlePath(appDir) {
  try { return existingBundle(appDir).bundle || bundlePaths(appDir).stock; }
  catch { return bundlePaths(appDir).stock; }
}

function stockHostIsRunning(bundle) {
  // This reads running-application metadata, not UI or the permission database.
  // Defer on an unavailable check rather than move a live Electron host.
  const script = 'ObjC.import("AppKit"); function run(argv) { const apps = $.NSRunningApplication.runningApplicationsWithBundleIdentifier("com.github.Electron"); const paths=[]; for(let i=0;i<apps.count;i++){const a=apps.objectAtIndex(i);if(a.bundleURL)paths.push(ObjC.unwrap(a.bundleURL.path));} return JSON.stringify(paths); }';
  const result = spawnSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], { encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024 });
  if (result.status !== 0) return { available: false };
  try {
    const paths = JSON.parse(result.stdout);
    if (!Array.isArray(paths) || !paths.every(value => typeof value === 'string')) return { available: false };
    const target = path.resolve(bundle);
    return { available: true, running: paths.some(value => path.resolve(value) === target) || path.resolve(process.execPath).startsWith(`${target}${path.sep}`) };
  } catch { return { available: false }; }
}

function preparePhysicalBundle(location) {
  const { bundle, stock, branded } = location;
  if (bundle === branded) {
    // Repair an interrupted migration's missing compatibility link only.
    if (!fs.existsSync(stock)) fs.symlinkSync(BRANDED_BUNDLE, stock, 'dir');
    return { bundlePath: branded, compatibilityPath: stock, bundleState: 'branded' };
  }
  if (fs.existsSync(branded)) return { bundlePath: stock, bundleState: 'deferred', bundleReason: 'branded-path-conflict' };
  const active = stockHostIsRunning(stock);
  if (!active.available || active.running) return { bundlePath: stock, bundleState: 'deferred', bundleReason: active.available ? 'host-running' : 'active-host-check-unavailable' };
  const before = fingerprint(stock, path.join(stock, 'Contents/MacOS', STOCK_EXECUTABLE));
  const beforeInfo = readInfo(path.join(stock, 'Contents/Info.plist'));
  let renamed = false;
  try {
    fs.renameSync(stock, branded);
    renamed = true;
    fs.symlinkSync(BRANDED_BUNDLE, stock, 'dir');
    const after = fingerprint(branded, path.join(branded, 'Contents/MacOS', STOCK_EXECUTABLE));
    const afterInfo = readInfo(path.join(branded, 'Contents/Info.plist'));
    if (JSON.stringify(before) !== JSON.stringify(after) || JSON.stringify(beforeInfo) !== JSON.stringify(afterInfo) || fs.realpathSync(stock) !== branded) throw new Error('Host identity changed during folder preparation.');
    return { bundlePath: branded, compatibilityPath: stock, bundleState: 'renamed', executableSha256: before.executableSha256 };
  } catch (error) {
    if (renamed) {
      try { if (fs.lstatSync(stock).isSymbolicLink() && fs.readlinkSync(stock) === BRANDED_BUNDLE) fs.unlinkSync(stock); } catch {}
      try { if (!fs.existsSync(stock)) fs.renameSync(branded, stock); } catch {}
    }
    return { bundlePath: fs.existsSync(stock) ? stock : branded, bundleState: 'deferred', bundleReason: 'bundle-preparation-unavailable', error: String(error?.message || error) };
  }
}

function ensureBundleDisplayNames(bundle) {
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

function ensureMacHostDisplayName(appDir, options = {}) {
  if ((options.platform || process.platform) !== 'darwin') return { state: 'skipped', reason: 'not-macos' };
  try {
    const location = existingBundle(appDir);
    if (!location.bundle) return { state: 'skipped', reason: location.reason };
    const result = ensureBundleDisplayNames(location.bundle);
    if (result.state === 'skipped') return { ...result, bundlePath: location.bundle };
    // Main-process startup deliberately does not move its running .app folder.
    // Only the prelaunch dependency helper opts into the filesystem migration.
    const prepared = options.prepareBundle === true
      ? preparePhysicalBundle(location)
      : { bundlePath: location.bundle, bundleState: location.bundle === location.branded ? 'branded' : 'stock' };
    return { ...result, ...prepared, registration: refreshMacHostRegistration(prepared.bundlePath) };
  } catch (error) {
    return { state: 'skipped', reason: 'branding-unavailable', error: String(error?.message || error) };
  }
}

module.exports = { DISPLAY_NAME, ensureMacHostDisplayName, getMacHostBundlePath };
