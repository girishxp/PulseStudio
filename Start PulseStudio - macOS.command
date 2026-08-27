#!/bin/zsh
set -u
set -o pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$ROOT_DIR/app"
LOG_DIR="$HOME/Library/Logs/PulseStudio"
LOG_FILE="$LOG_DIR/launcher.log"
mkdir -p "$LOG_DIR"

pause_and_exit() {
  echo ""
  echo "$1"
  echo "Launcher log: $LOG_FILE"
  echo "See README.md in the PulseStudio folder for help."
  read -r "?Press Enter to close..."
  exit 1
}

if [ ! -d "$APP_DIR" ]; then
  pause_and_exit "The application folder is missing. Extract the complete ZIP again before launching."
fi

cd "$APP_DIR" || pause_and_exit "Unable to open the application folder."

if ! command -v node >/dev/null 2>&1; then
  pause_and_exit "Node.js is not installed. Install the current Node.js LTS release, then run this launcher again."
fi

if ! command -v npm >/dev/null 2>&1; then
  pause_and_exit "npm is not available. Reinstall Node.js LTS, then run this launcher again."
fi

APP_VERSION="$(node -p "require('./package.json').version" 2>/dev/null || true)"
[ -n "$APP_VERSION" ] || pause_and_exit "Unable to read the PulseStudio version."

{
  echo "============================================================"
  echo "PulseStudio launcher - $(date)"
  echo "Application directory: $APP_DIR"
  echo "Version: $APP_VERSION"
  echo "Node: $(node --version 2>&1)"
  echo "npm: $(npm --version 2>&1)"
  echo "Architecture: $(uname -m)"
} > "$LOG_FILE"

PACKAGE_HASH_FILE="node_modules/.pulsestudio-package-hash"
PACKAGE_HASH="$(node -e "const fs=require('fs'),c=require('crypto');process.stdout.write(c.createHash('sha256').update(fs.readFileSync('package.json')).digest('hex'))" 2>/dev/null || true)"
needs_install=0
if [ -n "$PACKAGE_HASH" ] && { [ ! -f "$PACKAGE_HASH_FILE" ] || [ "$(cat "$PACKAGE_HASH_FILE" 2>/dev/null || true)" != "$PACKAGE_HASH" ]; }; then
  needs_install=1
fi
for dep in electron ffmpeg-static @huggingface/transformers uiohook-napi @sapphi-red/web-noise-suppressor; do
  if [ ! -d "node_modules/$dep" ]; then
    needs_install=1
    break
  fi
done

if [ "$needs_install" -eq 1 ]; then
  echo "First launch: preparing PulseStudio. This may take a few minutes..."
  echo "Running npm install --include=dev" >> "$LOG_FILE"
  if ! npm install --include=dev 2>&1 | tee -a "$LOG_FILE"; then
    pause_and_exit "Dependency installation failed."
  fi
  if [ -n "$PACKAGE_HASH" ]; then printf '%s' "$PACKAGE_HASH" > "$PACKAGE_HASH_FILE"; fi
fi

# v0.2.75: npm can successfully install the Electron JavaScript package while
# skipping Electron's binary-download postinstall step (for example because of
# a user/corporate npm setting or ELECTRON_SKIP_BINARY_DOWNLOAD). v0.2.74 then
# stopped with "The stable Electron runtime is missing" even though npm itself
# reported success. The stable host is essential for macOS TCC, so repair that
# exact runtime explicitly instead of falling back to another ad-hoc app build.
ELECTRON_MODULE="$APP_DIR/node_modules/electron"
ELECTRON_INSTALL_SCRIPT="$ELECTRON_MODULE/install.js"
ELECTRON_APP="$ELECTRON_MODULE/dist/Electron.app"

ensure_stable_electron_runtime() {
  if [ -d "$ELECTRON_APP" ] && [ -x "$ELECTRON_APP/Contents/MacOS/Electron" ]; then
    return 0
  fi

  echo "Preparing the stable Electron runtime..."
  {
    echo "Electron npm package is present but its macOS runtime is missing."
    echo "Attempting Electron binary repair with the package install script."
  } >> "$LOG_FILE"

  if [ ! -f "$ELECTRON_INSTALL_SCRIPT" ]; then
    echo "Electron install script is missing; reinstalling the Electron package." >> "$LOG_FILE"
    if ! env ELECTRON_SKIP_BINARY_DOWNLOAD= npm install --include=dev --ignore-scripts=false 2>&1 | tee -a "$LOG_FILE"; then
      return 1
    fi
  fi

  if [ -f "$ELECTRON_INSTALL_SCRIPT" ]; then
    # Remove only a broken/partial Electron payload before asking Electron's own
    # installer to restore it. Never rebuild or re-sign the app ourselves.
    if [ -d "$ELECTRON_MODULE/dist" ] && [ ! -x "$ELECTRON_APP/Contents/MacOS/Electron" ]; then
      rm -rf "$ELECTRON_MODULE/dist"
      rm -f "$ELECTRON_MODULE/path.txt"
    fi

    # Run Electron's downloader directly. This deliberately bypasses a global
    # npm ignore-scripts setting and clears only the variable that tells Electron
    # to skip its binary download. Proxy/mirror settings remain untouched.
    if ! (
      unset ELECTRON_SKIP_BINARY_DOWNLOAD
      export npm_config_ignore_scripts=false
      node "$ELECTRON_INSTALL_SCRIPT"
    ) 2>&1 | tee -a "$LOG_FILE"; then
      echo "Direct Electron runtime download failed." >> "$LOG_FILE"
    fi
  fi

  if [ -d "$ELECTRON_APP" ] && [ -x "$ELECTRON_APP/Contents/MacOS/Electron" ]; then
    return 0
  fi

  # One final npm-native retry covers partially installed/corrupted Electron
  # packages while still preserving the same official signed Electron identity.
  echo "Retrying Electron runtime preparation with npm rebuild." >> "$LOG_FILE"
  if ! (
    unset ELECTRON_SKIP_BINARY_DOWNLOAD
    export npm_config_ignore_scripts=false
    npm rebuild electron --foreground-scripts
  ) 2>&1 | tee -a "$LOG_FILE"; then
    echo "npm rebuild electron failed." >> "$LOG_FILE"
  fi

  [ -d "$ELECTRON_APP" ] && [ -x "$ELECTRON_APP/Contents/MacOS/Electron" ]
}

if ! ensure_stable_electron_runtime; then
  pause_and_exit "Unable to prepare Electron's signed macOS runtime. Check your internet/proxy connection and run the launcher again."
fi

{
  echo "macOS runtime mode: stable Electron host"
  echo "Electron app: $ELECTRON_APP"
  echo "Electron executable: $ELECTRON_APP/Contents/MacOS/Electron"
  if command -v /usr/bin/codesign >/dev/null 2>&1; then
    /usr/bin/codesign -dv --verbose=2 "$ELECTRON_APP" 2>&1 | grep -E 'Identifier=|Authority=|TeamIdentifier=|Signature=' || true
  fi
} >> "$LOG_FILE"

# Do not let a still-running ad-hoc runtime from v0.2.70-v0.2.73 win the
# single-instance lock and make the user think this new launcher is still broken.
if pgrep -f '/PulseStudio.app/Contents/MacOS/PulseStudio' >/dev/null 2>&1; then
  pause_and_exit "An older PulseStudio app is still running. Quit PulseStudio completely, then run this launcher again."
fi

echo "Starting PulseStudio..."
echo "macOS privacy permission target for this local build: Electron" >> "$LOG_FILE"

# LaunchServices starts Electron's original signed app and passes the Screen
# Recorder application directory to Electron's default app loader. This avoids
# rebuilding/re-signing a new PulseStudio.app identity for every patch.
if ! open -n "$ELECTRON_APP" --args "$APP_DIR"; then
  pause_and_exit "Unable to start PulseStudio through the stable Electron runtime."
fi

echo ""
echo "PulseStudio started. You may close this Terminal window."
echo "Launcher log: $LOG_FILE"
sleep 2
exit 0
