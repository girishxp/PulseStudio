'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
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
function macHostPath(directory = appDir) {
  return require('./lib/macos-host-display-name.cjs').getMacHostBundlePath(directory);
}
function signature(pkg, platform = process.platform, arch = process.arch) {
  return crypto.createHash('sha256').update(JSON.stringify({ dependencies: pkg.dependencies || {}, devDependencies: pkg.devDependencies || {}, platform, arch })).digest('hex');
}
// Read the Mach-O headers directly. /usr/bin/lipo is an Xcode developer-tool
// shim on a clean Mac; its failure says nothing about an otherwise valid app.
// This bounded check handles both ordinary and universal binaries without
// installing developer tools or reading an entire large executable into RAM.
function machOArchitectures(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const read = (offset, length) => {
      if (!Number.isSafeInteger(offset) || offset < 0 || offset + length > size) throw new Error('truncated Mach-O header');
      const bytes = Buffer.alloc(length);
      if (fs.readSync(fd, bytes, 0, length, offset) !== length) throw new Error('truncated Mach-O header');
      return bytes;
    };
    const cpuName = cpu => ({ 0x0100000c: 'arm64', 0x01000007: 'x64', 12: 'arm', 7: 'ia32' }[cpu] || `cpu-${cpu}`);
    const thinCpu = (offset, sliceLength = size - offset) => {
      const bytes = read(offset, 8), magic = bytes.readUInt32BE(0);
      if (magic === 0xfeedface || magic === 0xfeedfacf) {
        const headerLength = magic === 0xfeedfacf ? 32 : 28;
        if (sliceLength < headerLength) throw new Error('truncated Mach-O slice');
        read(offset, headerLength);
        return bytes.readUInt32BE(4);
      }
      if (magic === 0xcefaedfe || magic === 0xcffaedfe) {
        const headerLength = magic === 0xcffaedfe ? 32 : 28;
        if (sliceLength < headerLength) throw new Error('truncated Mach-O slice');
        read(offset, headerLength);
        return bytes.readUInt32LE(4);
      }
      throw new Error('not a Mach-O executable');
    };
    const header = read(0, 8), magic = header.readUInt32BE(0);
    const fat = new Map([[0xcafebabe, [false, false]], [0xbebafeca, [true, false]], [0xcafebabf, [false, true]], [0xbfbafeca, [true, true]]]).get(magic);
    if (!fat) return [cpuName(thinCpu(0))];
    const [littleEndian, fat64] = fat;
    const uint32 = (bytes, offset) => littleEndian ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
    const uint64 = (bytes, offset) => littleEndian ? bytes.readBigUInt64LE(offset) : bytes.readBigUInt64BE(offset);
    const count = uint32(header, 4), entrySize = fat64 ? 32 : 20;
    if (count < 1 || count > 64) throw new Error('invalid universal Mach-O header');
    const table = read(8, count * entrySize), architectures = [];
    for (let index = 0; index < count; index++) {
      const start = index * entrySize, cpu = uint32(table, start);
      const offset = fat64 ? uint64(table, start + 8) : BigInt(uint32(table, start + 8));
      const length = fat64 ? uint64(table, start + 16) : BigInt(uint32(table, start + 12));
      if (offset < BigInt(8 + table.length) || length < 28n || offset + length > BigInt(size) || offset > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('invalid universal Mach-O slice');
      if (thinCpu(Number(offset), Number(length)) !== cpu) throw new Error('universal Mach-O architecture does not match its slice');
      architectures.push(cpuName(cpu));
    }
    return [...new Set(architectures)];
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function inspect(pkg, options = {}) {
  const directory = options.appDir || appDir;
  const platform = options.platform || process.platform, arch = options.arch || process.arch;
  const problems = [];
  const problem = (component, code, message) => problems.push({ component, code, message });
  const modules = path.join(directory, 'node_modules');
  let semver;
  try {
    semver = require(path.join(modules, 'semver'));
  } catch { problem('Dependency checker', 'missing-checker', 'The bundled dependency checker is missing or unreadable.'); }
  for (const [name, wanted] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
    try {
      const installed = JSON.parse(fs.readFileSync(path.join(modules, name, 'package.json'), 'utf8'));
      if (semver && !semver.satisfies(installed.version, wanted)) problem(name, 'version-mismatch', `${name} is ${installed.version || 'unversioned'}; this release requires ${wanted}.`);
    } catch { problem(name, 'missing-package', `${name} is missing or its package information is unreadable.`); }
  }
  const markerPath = path.join(modules, '.pulsestudio-host.json');
  if (fs.existsSync(markerPath)) {
    try {
      const host = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
      if (host.platform !== platform || host.arch !== arch) problem('Prepared runtime', 'host-mismatch', `These components were prepared for ${host.platform || 'unknown'}/${host.arch || 'unknown'}; this launch uses ${platform}/${arch}.`);
    } catch { problem('Prepared runtime', 'invalid-host-marker', 'The prepared-runtime information is unreadable.'); }
  }
  if (platform === 'darwin') {
    for (const [component, file] of [['Desktop runtime', path.join(macHostPath(directory), 'Contents/MacOS/Electron')], ['Recording encoder', path.join(modules, 'ffmpeg-static/ffmpeg')]]) {
      try {
        fs.accessSync(file, fs.constants.X_OK);
        const available = machOArchitectures(file);
        if (!available.includes(arch)) problem(component, 'architecture-mismatch', `${component} supports ${available.join(', ')}; this Mac needs ${arch}.`);
      } catch (error) {
        problem(component, 'invalid-executable', `${component} is missing, not executable, or has an invalid Mac binary (${error.code || error.message}).`);
      }
    }
  }
  return { ok: problems.length === 0, platform, arch, problems };
}
function check(pkg) {
  if (!inspect(pkg).ok) return false;
  updateMacDisplayName();
  return true;
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
  else if (process.argv[2] === 'check') {
    const result = inspect(pkg);
    if (result.ok) updateMacDisplayName();
    else for (const problem of result.problems) console.error(`PulseStudio component check: ${problem.message}`);
    process.exitCode = result.ok ? 0 : 1;
  }
  else if (process.argv[2] === 'diagnose') {
    const result = inspect(pkg);
    process.stdout.write(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  }
  else if (process.argv[2] === 'stamp') stamp(pkg);
  else if (process.argv[2] === 'host-path') process.stdout.write(macHostPath());
  else process.exitCode = 2;
}
module.exports = { signature, check, stamp, inspect, machOArchitectures };
