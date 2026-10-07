#!/usr/bin/env node
'use strict';
const { spawn, spawnSync } = require('node:child_process');

function run(options) {
  const { command, args = [], timeoutMs = 300000, progressMs = 15000, label = 'Preparing PulseStudio', env = process.env, output = process.stdout } = options;
  return new Promise((resolve) => {
    const started = Date.now();
    let finished = false, stopping = false, stopCode = 0, child;
    let deadline, progress, force;
    const status = (message) => output.write('PULSE_STATUS: ' + message + '\n');
    const clean = () => { clearTimeout(deadline); clearInterval(progress); clearTimeout(force); process.removeListener('SIGTERM', onTerm); process.removeListener('SIGINT', onTerm); };
    const done = (code) => { if (finished) return; finished = true; clean(); resolve(code); };
    const signalChild = (signal) => {
      if (!child?.pid) return;
      try {
        if (process.platform === 'win32') {
          spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 });
        } else process.kill(-child.pid, signal);
      } catch (error) { if (error.code !== 'ESRCH') output.write('Could not stop setup child: ' + error.message + '\n'); }
    };
    const stop = (code, message) => {
      if (stopping || finished) return;
      stopping = true; stopCode = code;
      status(message); signalChild('SIGTERM');
      force = setTimeout(() => {
        signalChild('SIGKILL');
        child?.stdout?.destroy(); child?.stderr?.destroy();
        done(stopCode);
      }, 2000);
    };
    const onTerm = () => stop(130, 'Setup cancelled.');
    try {
      child = spawn(command, args, { env, cwd: options.cwd || process.cwd(), detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) { output.write(error.message + '\n'); done(1); return; }
    child.stdout.on('data', (data) => output.write(data));
    child.stderr.on('data', (data) => output.write(data));
    child.on('error', (error) => { output.write('Setup could not start: ' + error.message + '\n'); done(1); });
    child.on('close', (code) => done(stopping ? stopCode : (code === null ? 1 : code)));
    process.on('SIGTERM', onTerm); process.on('SIGINT', onTerm);
    deadline = setTimeout(() => stop(124, 'Setup reached its time limit. Check the setup log and try again.'), timeoutMs);
    progress = setInterval(() => status(label + ' — ' + Math.floor((Date.now() - started) / 1000) + ' seconds elapsed.'), progressMs);
  });
}

if (require.main === module) {
  const argv = process.argv.slice(2); const options = {};
  let split = argv.indexOf('--');
  if (split < 0 || !argv[split + 1]) { process.stderr.write('Missing setup command.\n'); process.exit(2); }
  for (let i = 0; i < split; i += 2) {
    if (argv[i] === '--timeout-ms') options.timeoutMs = Number(argv[i + 1]);
    else if (argv[i] === '--progress-ms') options.progressMs = Number(argv[i + 1]);
    else if (argv[i] === '--status') options.label = argv[i + 1];
    else { process.stderr.write('Unknown runner option.\n'); process.exit(2); }
  }
  if ((options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) || (options.progressMs !== undefined && (!Number.isFinite(options.progressMs) || options.progressMs <= 0))) process.exit(2);
  options.command = argv[split + 1]; options.args = argv.slice(split + 2);
  run(options).then((code) => { process.exitCode = code; });
}
module.exports = { run };
