#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$ROOT_DIR/app"
LOG_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/PulseStudio"
LOG_FILE="$LOG_DIR/launcher.log"
mkdir -p "$LOG_DIR"

fail() {
  echo "$1"
  echo "Launcher log: $LOG_FILE"
  exit 1
}

[ -d "$APP_DIR" ] || fail "The application folder is missing. Extract the complete ZIP again before launching PulseStudio."
cd "$APP_DIR"
command -v node >/dev/null 2>&1 || fail "Node.js is not installed. Install the current Node.js LTS release and try again."
command -v npm >/dev/null 2>&1 || fail "npm is not available. Reinstall Node.js LTS and try again."

APP_VERSION="$(node -p "require('./package.json').version" 2>/dev/null || true)"
[ -n "$APP_VERSION" ] || fail "Unable to read the PulseStudio version."
PACKAGE_HASH_FILE="node_modules/.pulsestudio-package-hash"
PACKAGE_HASH="$(node -e "const fs=require('fs'),c=require('crypto');process.stdout.write(c.createHash('sha256').update(fs.readFileSync('package.json')).digest('hex'))" 2>/dev/null || true)"
needs_install=0
if [ -n "$PACKAGE_HASH" ] && { [ ! -f "$PACKAGE_HASH_FILE" ] || [ "$(cat "$PACKAGE_HASH_FILE" 2>/dev/null || true)" != "$PACKAGE_HASH" ]; }; then needs_install=1; fi
for dep in electron ffmpeg-static @huggingface/transformers uiohook-napi @sapphi-red/web-noise-suppressor; do
  [ -d "node_modules/$dep" ] || { needs_install=1; break; }
done

{
  echo "PulseStudio Linux launcher - $(date)"
  echo "Version: $APP_VERSION"
  echo "Node: $(node --version)"
  echo "npm: $(npm --version)"
  echo "Architecture: $(uname -m)"
} > "$LOG_FILE"

if [ "$needs_install" -eq 1 ]; then
  echo "Preparing PulseStudio dependencies..."
  npm install --include=dev 2>&1 | tee -a "$LOG_FILE" || fail "Dependency installation failed."
  [ -z "$PACKAGE_HASH" ] || printf '%s' "$PACKAGE_HASH" > "$PACKAGE_HASH_FILE"
fi

ELECTRON_BIN="$APP_DIR/node_modules/.bin/electron"
[ -x "$ELECTRON_BIN" ] || fail "The Electron runtime is missing. Run the launcher while connected to the internet."

echo "Starting PulseStudio..."
nohup "$ELECTRON_BIN" "$APP_DIR" >> "$LOG_FILE" 2>&1 &
disown || true
