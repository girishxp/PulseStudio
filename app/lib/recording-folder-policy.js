'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
function samePath(left, right, platform = process.platform) {
  const paths = platform === 'win32' ? path.win32 : path;
  const a = paths.resolve(String(left)), b = paths.resolve(String(right));
  return platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}
function defaultDirectory(videos, platform = process.platform) { return (platform === 'win32' ? path.win32 : path).join(videos, 'PulseStudio'); }
function destination(directory, videos, platform = process.platform) {
  const paths = platform === 'win32' ? path.win32 : path;
  if (!directory || !paths.isAbsolute(String(directory))) throw new Error('Choose an absolute recordings folder.');
  const requested = paths.resolve(String(directory));
  return samePath(requested, videos, platform) ? defaultDirectory(videos, platform) : requested;
}
function libraryDirectories(current, videos, platform = process.platform) {
  const paths = platform === 'win32' ? path.win32 : path;
  const roots = [paths.resolve(current)];
  // Keep the previous library visible, but never write new files into its root.
  if (samePath(current, defaultDirectory(videos, platform), platform)) roots.push(paths.resolve(videos));
  return roots;
}
function readableRecording(candidate, current, videos, platform = process.platform) {
  const paths = platform === 'win32' ? path.win32 : path;
  const file = paths.resolve(String(candidate));
  const root = paths.resolve(current);
  const a = platform === 'win32' ? file.toLowerCase() : file;
  const b = platform === 'win32' ? root.toLowerCase() : root;
  if (a === b || a.startsWith(b + paths.sep)) return true;
  return samePath(current, defaultDirectory(videos, platform), platform)
    && samePath(paths.dirname(file), videos, platform)
    && /\.(mp4|webm|m4a|mp3)$/i.test(paths.basename(file));
}
function transcriptBase(recording, current, videos, platform = process.platform) {
  const paths = platform === 'win32' ? path.win32 : path;
  const file = paths.resolve(String(recording)), stem = paths.basename(file, paths.extname(file));
  if (!samePath(paths.dirname(file), videos, platform)) return file.slice(0, -paths.extname(file).length);
  const key = crypto.createHash('sha256').update(platform === 'win32' ? file.toLowerCase() : file).digest('hex').slice(0, 8);
  return paths.join(current, stem + '_legacy-' + key);
}
module.exports = { samePath, defaultDirectory, destination, libraryDirectories, readableRecording, transcriptBase };
