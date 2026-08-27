const fs = require('fs');
const os = require('os');

const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const BITS_PER_SAMPLE = 16;
const HEADER_SIZE = 44;

function windowsBuildNumber(release = os.release()) {
  const parts = String(release || '').split('.');
  const build = Number(parts[2] || 0);
  return Number.isFinite(build) ? build : 0;
}

function parseWindowHandle(sourceId) {
  const match = /^window:([^:]+):/i.exec(String(sourceId || ''));
  if (!match) return null;
  const raw = match[1].trim();
  if (!/^\d+$/.test(raw)) return null;
  try {
    const value = BigInt(raw);
    if (value <= 0n) return null;
    return value.toString();
  } catch {
    return null;
  }
}

function loadLoopbackModule() {
  const loaded = require('loopback-capture');
  const candidate = loaded?.default || loaded;
  const LoopbackCapture = candidate?.LoopbackCapture || loaded?.LoopbackCapture;
  if (typeof LoopbackCapture !== 'function') {
    throw new Error('The Windows process-loopback module did not expose LoopbackCapture. Run npm install again.');
  }
  return { LoopbackCapture };
}

function windowsApplicationAudioCapability({ platform = process.platform, arch = process.arch, release = os.release(), verifyModule = true } = {}) {
  if (platform !== 'win32') return { supported: false, reason: 'not-windows' };
  if (arch !== 'x64') {
    return {
      supported: false,
      reason: 'unsupported-architecture',
      message: `Selected-application audio currently requires 64-bit Windows (x64); detected ${arch}.`
    };
  }
  const build = windowsBuildNumber(release);
  if (build < 20348) {
    return {
      supported: false,
      reason: 'windows-build',
      build,
      message: `Selected-application audio requires Windows build 20348 or newer; detected build ${build || 'unknown'}.`
    };
  }
  if (verifyModule) {
    try { loadLoopbackModule(); }
    catch (error) {
      return {
        supported: false,
        reason: 'module-unavailable',
        build,
        message: `Windows process-loopback component is unavailable: ${error.message}`
      };
    }
  }
  return {
    supported: true,
    reason: 'ok',
    build,
    message: 'Selected-application audio uses Windows WASAPI process loopback and includes the selected process tree.'
  };
}

function createWavHeader(dataBytes, sampleRate = SAMPLE_RATE, channels = CHANNELS, bitsPerSample = BITS_PER_SAMPLE) {
  const size = Math.max(0, Number(dataBytes) || 0);
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(HEADER_SIZE);
  header.write('RIFF', 0, 4, 'ascii');
  header.writeUInt32LE(Math.min(0xffffffff, 36 + size), 4);
  header.write('WAVE', 8, 4, 'ascii');
  header.write('fmt ', 12, 4, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 4, 'ascii');
  header.writeUInt32LE(Math.min(0xffffffff, size), 40);
  return header;
}

function patchWavHeader(filePath) {
  let stat;
  try { stat = fs.statSync(filePath); } catch { return 0; }
  const dataBytes = Math.max(0, stat.size - HEADER_SIZE);
  if (stat.size < HEADER_SIZE) return 0;
  let fd;
  try {
    fd = fs.openSync(filePath, 'r+');
    const header = createWavHeader(dataBytes);
    fs.writeSync(fd, header, 0, header.length, 0);
    fs.fsyncSync(fd);
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
  return dataBytes;
}

async function resolveProcessForWindow({ sourceId, windowTitle, runProcess }) {
  if (typeof runProcess !== 'function') throw new Error('Windows process resolver is unavailable.');
  const hwnd = parseWindowHandle(sourceId);
  const encodedTitle = Buffer.from(String(windowTitle || ''), 'utf8').toString('base64');
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$hwndText = $env:PULSESTUDIO_HWND",
    "$titleB64 = $env:PULSESTUDIO_WINDOW_TITLE_B64",
    "$title = ''",
    "if ($titleB64) { try { $title = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($titleB64)) } catch {} }",
    "$candidate = $null",
    "if ($hwndText) {",
    "  $hwndValue = [Int64]$hwndText",
    "  $candidate = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowHandle.ToInt64() -eq $hwndValue } | Select-Object -First 1",
    "}",
    "if (-not $candidate -and $title) {",
    "  $candidate = Get-Process | Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle -eq $title } | Select-Object -First 1",
    "}",
    "if (-not $candidate -and $title) {",
    "  $candidate = Get-Process | Where-Object { $_.MainWindowTitle -and ($_.MainWindowTitle -like ('*' + $title + '*') -or $title -like ('*' + $_.MainWindowTitle + '*')) } | Select-Object -First 1",
    "}",
    "if (-not $candidate) { Write-Error 'Could not map the selected window to a Windows process.'; exit 3 }",
    "$obj = [PSCustomObject]@{ id = [int]$candidate.Id; name = [string]$candidate.ProcessName; title = [string]$candidate.MainWindowTitle; hwnd = [Int64]$candidate.MainWindowHandle.ToInt64() }",
    "$obj | ConvertTo-Json -Compress"
  ].join('; ');

  const result = await runProcess('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script
  ], {
    env: {
      ...process.env,
      PULSESTUDIO_HWND: hwnd || '',
      PULSESTUDIO_WINDOW_TITLE_B64: encodedTitle
    }
  });

  let parsed;
  try { parsed = JSON.parse(String(result.stdout || '').trim()); }
  catch { throw new Error(`Windows returned an invalid process mapping for “${windowTitle || 'selected window'}”.`); }
  const pid = Number(parsed?.id);
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('The selected Windows application did not resolve to a valid process ID.');
  return { pid, processName: String(parsed?.name || ''), windowTitle: String(parsed?.title || windowTitle || ''), hwnd: String(parsed?.hwnd || hwnd || '') };
}

class WindowsProcessLoopbackSession {
  constructor({ capture, stream, outputPath, target }) {
    this.kind = 'windows-process-loopback';
    this.capture = capture;
    this.stream = stream;
    this.outputPath = outputPath;
    this.target = target;
    this.stopped = false;
    this.writeError = null;
    this.bytesReceived = 0;
    this.headerTimer = setInterval(() => {
      try { patchWavHeader(this.outputPath); } catch {}
    }, 1000);
    this.headerTimer.unref?.();
  }

  async stop() {
    if (this.stopped) return this.outputPath;
    this.stopped = true;
    if (this.headerTimer) clearInterval(this.headerTimer);
    try { this.capture?.stop(); } catch {}
    await new Promise((resolve) => {
      if (!this.stream || this.stream.destroyed || this.stream.closed) return resolve();
      this.stream.end(resolve);
    });
    try { patchWavHeader(this.outputPath); } catch {}
    if (this.writeError) throw this.writeError;
    return this.outputPath;
  }

  async abort() {
    if (this.headerTimer) clearInterval(this.headerTimer);
    try { this.capture?.stop(); } catch {}
    try { this.stream?.destroy(); } catch {}
    try { patchWavHeader(this.outputPath); } catch {}
    this.stopped = true;
  }
}

async function startWindowsProcessLoopback({ sourceId, windowTitle, outputPath, runProcess }) {
  const capability = windowsApplicationAudioCapability();
  if (!capability.supported) throw new Error(capability.message || 'Windows selected-application audio is unavailable.');
  const target = await resolveProcessForWindow({ sourceId, windowTitle, runProcess });
  const { LoopbackCapture } = loadLoopbackModule();

  fs.writeFileSync(outputPath, createWavHeader(0));
  const stream = fs.createWriteStream(outputPath, { flags: 'a' });
  const capture = new LoopbackCapture();
  const session = new WindowsProcessLoopbackSession({ capture, stream, outputPath, target });
  stream.on('error', (error) => { session.writeError = error; });

  try {
    capture.start(target.pid, true, (chunk) => {
      if (session.stopped || !chunk) return;
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (!data.length) return;
      session.bytesReceived += data.length;
      if (!stream.destroyed) stream.write(data);
    });
  } catch (error) {
    try { stream.destroy(); } catch {}
    try { fs.unlinkSync(outputPath); } catch {}
    throw new Error(`Could not start WASAPI process-loopback for ${target.processName || 'the selected application'}: ${error.message}`);
  }

  return session;
}

module.exports = {
  SAMPLE_RATE,
  CHANNELS,
  BITS_PER_SAMPLE,
  windowsBuildNumber,
  parseWindowHandle,
  createWavHeader,
  patchWavHeader,
  windowsApplicationAudioCapability,
  resolveProcessForWindow,
  startWindowsProcessLoopback
};
