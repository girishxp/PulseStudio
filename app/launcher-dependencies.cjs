'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const appDir = __dirname;
function updateMacDisplayName() {
  if (process.platform !== 'darwin') return;
  try {
    const result = require('./lib/macos-host-display-name.cjs').ensureMacHostDisplayName(appDir, { prepareBundle: true });
    if (result.state === 'updated' || result.bundleState === 'renamed') console.error('PulseStudio: prepared the Pulse Studio Dock name; host code identity is unchanged.');
    else if (result.bundleReason === 'host-running') console.error('PulseStudio: the Dock name will finish updating after the current app is closed and reopened.');
    else if (result.error) console.error('PulseStudio: Dock name was left unchanged; the existing desktop runtime will still launch.');
  } catch {
    // Display branding is optional. It must not invalidate prepared dependencies.
  }
}
function macHostPath() {
  return require('./lib/macos-host-display-name.cjs').getMacHostBundlePath(appDir);
}
function signature(pkg, platform = process.platform, arch = process.arch) {
  return crypto.createHash('sha256').update(JSON.stringify({ dependencies: pkg.dependencies || {}, devDependencies: pkg.devDependencies || {}, platform, arch })).digest('hex');
}
function check(pkg) {
  try {
    const modules = path.join(appDir, 'node_modules');
    const semver = require(path.join(modules, 'semver'));
    for (const [name, wanted] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
      const installed = JSON.parse(fs.readFileSync(path.join(modules, name, 'package.json'), 'utf8'));
      if (!semver.satisfies(installed.version, wanted)) return false;
    }
    const markerPath = path.join(modules, '.pulsestudio-host.json');
    if (fs.existsSync(markerPath)) {
      const host = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
      if (host.platform !== process.platform || host.arch !== process.arch) return false;
    }
    if (process.platform === 'darwin') {
      for (const file of [path.join(macHostPath(), 'Contents/MacOS/Electron'), path.join(modules, 'ffmpeg-static/ffmpeg')]) {
        if (!fs.existsSync(file)) return false;
        const arch = process.arch === 'x64' ? 'x86_64' : process.arch;
        if (spawnSync('/usr/bin/lipo', ['-verify_arch', arch, file], { stdio: 'ignore', timeout: 5000 }).status !== 0) return false;
      }
    }
    updateMacDisplayName();
    return true;
  } catch { return false; }
}
function stamp(pkg) {
  updateMacDisplayName();
  const modules = path.join(appDir, 'node_modules');
  fs.writeFileSync(path.join(modules, '.pulsestudio-package-hash'), signature(pkg));
  fs.writeFileSync(path.join(modules, '.pulsestudio-host.json'), JSON.stringify({ platform: process.platform, arch: process.arch }));
}
if (require.main === module) {
  const pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
  if (process.argv[2] === 'signature') process.stdout.write(signature(pkg));
  else if (process.argv[2] === 'check') process.exitCode = check(pkg) ? 0 : 1;
  else if (process.argv[2] === 'stamp') stamp(pkg);
  else if (process.argv[2] === 'host-path') process.stdout.write(macHostPath());
  else process.exitCode = 2;
}
module.exports = { signature, check, stamp };
