'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { ensureMacHostDisplayName, getMacHostBundlePath } = require('./macos-host-display-name.cjs');
const GUARD = 'PULSESTUDIO_MAC_HOST_HANDOFF';

function privateNode(appDir, arch) {
  if (!['arm64', 'x64'].includes(arch)) return null;
  const directory = path.join(appDir, '.pulsestudio-node-runtime', `darwin-${arch}`);
  try {
    const names = fs.readdirSync(directory).filter(name =>
      new RegExp(`^node-v[0-9]+\\.[0-9]+\\.[0-9]+-darwin-${arch}$`).test(name));
    names.sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
    for (const name of names) {
      const executable = path.join(directory, name, 'bin/node');
      try {
        fs.accessSync(executable, fs.constants.X_OK);
        if (fs.statSync(executable).isFile() &&
            fs.realpathSync(executable).startsWith(`${fs.realpathSync(directory)}${path.sep}`)) return executable;
      } catch {}
    }
  } catch {}
  return null;
}

function existingLaunchNode(appDir, arch, env, hostExecutable) {
  const bundled = privateNode(appDir, arch);
  if (bundled) return bundled;
  // The Mac launcher may already use a valid system Node instead of installing
  // a private copy. Resolve that same PATH runtime without installing anything.
  try {
    const query = 'process.stdout.write(JSON.stringify({release:process.release.name,electron:!!process.versions.electron,version:process.versions.node,executable:process.execPath}))';
    const result = spawnSync('/usr/bin/env', ['node', '-e', query], {
      encoding: 'utf8', timeout: 3000, maxBuffer: 64 * 1024,
      // If PATH points at Electron, probe its Node mode without opening a UI.
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' }
    });
    if (result.status !== 0) return null;
    const runtime = JSON.parse(result.stdout);
    if (runtime.release !== 'node' || runtime.electron || !/^\d+\.\d+\.\d+(?:[.-].+)?$/.test(String(runtime.version)) ||
        Number(String(runtime.version).split('.')[0]) < 18 ||
        typeof runtime.executable !== 'string') return null;
    const executable = fs.realpathSync(runtime.executable);
    if (executable === hostExecutable || executable.startsWith(`${path.join(appDir, 'node_modules/electron')}${path.sep}`)) return null;
    fs.accessSync(executable, fs.constants.X_OK);
    return fs.statSync(executable).isFile() ? executable : null;
  } catch { return null; }
}

function createPortableMacHostHandoffPlan(appDir, context = {}) {
  const platform = context.platform || process.platform;
  const arch = context.arch || process.arch;
  const env = context.env || process.env;
  const execPath = context.execPath || process.execPath;
  const argv = context.argv || process.argv;
  if (platform !== 'darwin' || context.packaged || !env.PULSESTUDIO_PORTABLE_ROOT || env[GUARD]) return null;
  try {
    appDir = fs.realpathSync(appDir);
    if (fs.realpathSync(path.join(env.PULSESTUDIO_PORTABLE_ROOT, 'app')) !== appDir) return null;
    const stock = path.join(appDir, 'node_modules/electron/dist/Electron.app');
    // An alias of an already-branded host must not trigger a second handoff.
    if (fs.realpathSync(execPath) !== path.join(stock, 'Contents/MacOS/Electron') ||
        fs.lstatSync(stock).isSymbolicLink()) return null;
    const node = existingLaunchNode(appDir, arch, env, fs.realpathSync(execPath));
    if (!node) return null;
    const args = argv.slice(1);
    if (!args.length) args.push(appDir);
    return { appDir, node, parentPid: context.pid || process.pid, args, environment: { ...env, [GUARD]: '1' } };
  } catch { return null; }
}

function startPortableMacHostHandoff(appDir, context = {}) {
  const plan = createPortableMacHostHandoffPlan(appDir, context);
  if (!plan) return { started: false };
  try {
    const child = (context.spawn || spawn)(plan.node,
      [__filename, '--wait-and-open', plan.appDir, String(plan.parentPid), JSON.stringify(plan.args)],
      { detached: true, stdio: 'ignore', env: plan.environment, cwd: plan.appDir, windowsHide: true });
    if (!child.pid) return { started: false, reason: 'worker-unavailable' };
    child.on('error', () => {});
    child.unref();
    return { started: true, workerPid: child.pid };
  } catch { return { started: false, reason: 'worker-unavailable' }; }
}

async function waitForParentExit(pid, { deadlineMs = 15000, pollMs = 100 } = {}) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); }
    catch (error) { if (error.code === 'ESRCH') return true; }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
  return false;
}

function openEnvironment(bundle) {
  const args = ['-n', bundle];
  for (const [key, value] of Object.entries(process.env)) {
    if ((key === 'PATH' || key === 'LANG' || key === 'LC_ALL' || key.startsWith('PULSESTUDIO_')) &&
        typeof value === 'string' && key !== GUARD) args.push('--env', `${key}=${value}`);
  }
  args.push('--env', `${GUARD}=1`);
  return args;
}

function recordFailure(appDir, reason) {
  try {
    const directory = path.join(appDir, 'logs');
    fs.mkdirSync(directory, { recursive: true });
    fs.appendFileSync(path.join(directory, 'mac-host-handoff.log'), `${new Date().toISOString()} ${reason}\n`);
  } catch {}
}

function nativeLauncherFallback(appDir, reason, open) {
  recordFailure(appDir, reason);
  const launcher = path.join(path.dirname(appDir), 'PulseStudio.app');
  if (!fs.existsSync(path.join(launcher, 'Contents/MacOS/PulseStudioLauncher'))) return { opened: false, reason };
  const result = open('/usr/bin/open', openEnvironment(launcher),
    { encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024 });
  return { opened: result.status === 0, launcherFallback: true, reason };
}

async function completePortableMacHostHandoff(appDir, parentPid, args, options = {}) {
  if (process.platform !== 'darwin' || !Number.isInteger(parentPid) || parentPid <= 0 ||
      !Array.isArray(args) || !args.every(arg => typeof arg === 'string')) return { opened: false, reason: 'invalid-handoff' };
  if (!await waitForParentExit(parentPid, options)) {
    // Never move or open another host if the older startup process stays alive.
    recordFailure(appDir, 'parent-still-running');
    return { opened: false, reason: 'parent-still-running' };
  }
  const open = options.open || spawnSync;
  const expectedBundle = path.join(appDir, 'node_modules/electron/dist/Pulse Studio.app');
  const deadline = Date.now() + (options.brandingDeadlineMs ?? 5000);
  let branding;
  do {
    branding = ensureMacHostDisplayName(appDir, { prepareBundle: true });
    if (branding.bundleReason !== 'host-running' || Date.now() >= deadline) break;
    // Launch Services can briefly retain the old process after its PID exits.
    await new Promise(resolve => setTimeout(resolve, 200));
  } while (Date.now() < deadline);
  const bundle = getMacHostBundlePath(appDir);
  if (bundle !== expectedBundle || !['renamed', 'branded'].includes(branding.bundleState)) {
    return { ...nativeLauncherFallback(appDir, 'branding-unavailable', open), branding };
  }
  const openArgs = [...openEnvironment(bundle), '--args', ...args];
  const result = open('/usr/bin/open', openArgs,
    { encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024 });
  if (result.status !== 0) return { ...nativeLauncherFallback(appDir, 'reopen-unavailable', open), branding };
  return { opened: true, bundle, branding };
}

if (require.main === module && process.argv[2] === '--wait-and-open') {
  let args;
  try { args = JSON.parse(process.argv[5]); } catch { process.exitCode = 1; }
  if (args) {
    completePortableMacHostHandoff(process.argv[3], Number(process.argv[4]), args)
      .then(result => { process.exitCode = result.opened ? 0 : 1; })
      .catch(() => { process.exitCode = 1; });
  }
}

module.exports = { createPortableMacHostHandoffPlan, startPortableMacHostHandoff, completePortableMacHostHandoff, waitForParentExit };
