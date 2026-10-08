#!/bin/zsh
set -u
set -o pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
GUI_MODE=0
[ "${1:-}" != "--gui" ] || GUI_MODE=1
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$ROOT_DIR/app"
LOG_DIR="$HOME/Library/Logs/PulseStudio"
LOG_FILE="$LOG_DIR/launcher.log"
mkdir -p "$LOG_DIR"
printf 'PulseStudio setup — %s\nFolder: %s\n' "$(date)" "$APP_DIR" > "$LOG_FILE"
STAGING=""
cleanup_staging() {
  if [ -n "$STAGING" ] && [ -d "$STAGING" ]; then
    if [ ! -d "$APP_DIR/node_modules" ] && [ -d "$STAGING/previous-node_modules" ]; then /bin/mv "$STAGING/previous-node_modules" "$APP_DIR/node_modules" 2>/dev/null || true; fi
    /bin/rm -rf "$STAGING"
  fi
}
trap cleanup_staging EXIT
trap 'exit 130' TERM INT
status() { printf 'PULSE_STATUS: %s\n' "$1"; printf '%s\n' "$1" >> "$LOG_FILE"; }
fail() {
  printf '\n%s\nLauncher log: %s\n' "$1" "$LOG_FILE" | tee -a "$LOG_FILE"
  if [ "$GUI_MODE" -ne 1 ] && [ -t 0 ]; then read -r "?Press Enter to close..."; fi
  exit 1
}
[ -f "$APP_DIR/package.json" ] || fail "The application folder is missing. Extract the complete ZIP and keep the folder together."
cd "$APP_DIR" || fail "The application folder could not be opened."
case "$(uname -m)" in arm64) NODE_ARCH=arm64 ;; x86_64) NODE_ARCH=x64 ;; *) fail "This Mac architecture is not supported." ;; esac
NODE_VERSION=24.21.0
NODE_ROOT="$APP_DIR/.pulsestudio-node-runtime/darwin-$NODE_ARCH"
NODE_DIR="$NODE_ROOT/node-v$NODE_VERSION-darwin-$NODE_ARCH"
ELECTRON_APP="$APP_DIR/node_modules/electron/dist/Electron.app"
[ ! -x "$APP_DIR/node_modules/electron/dist/Pulse Studio.app/Contents/MacOS/Electron" ] || ELECTRON_APP="$APP_DIR/node_modules/electron/dist/Pulse Studio.app"
ELECTRON_BIN="$ELECTRON_APP/Contents/MacOS/Electron"
CACHE_MANIFEST="$APP_DIR/launcher-cache/manifest.json"

# The release carries a prepared arm64 payload. Its Node/npm, Electron, encoder,
# and libraries are unpacked before asking any server for first-time setup.
need_bundle=0
[ -x "$ELECTRON_BIN" ] || need_bundle=1
[ -x "$APP_DIR/node_modules/ffmpeg-static/ffmpeg" ] || need_bundle=1
if ! command -v node >/dev/null 2>&1 && [ ! -x "$NODE_DIR/bin/node" ]; then need_bundle=1; fi
for dep in electron electron-builder ffmpeg-static @huggingface/transformers uiohook-napi @sapphi-red/web-noise-suppressor deepfilternet3-noise-filter electron-updater loopback-capture; do
  [ -f "$APP_DIR/node_modules/$dep/package.json" ] || need_bundle=1
done
if [ "$need_bundle" -eq 1 ] && [ -f "$CACHE_MANIFEST" ]; then
  CACHE_ARCH="$(/usr/bin/plutil -extract arch raw -o - "$CACHE_MANIFEST" 2>/dev/null || true)"
  if [ "$CACHE_ARCH" = "$NODE_ARCH" ]; then
    ARCHIVE_NAME="$(/usr/bin/plutil -extract archive raw -o - "$CACHE_MANIFEST" 2>/dev/null || true)"
    CACHE_EXPECTED="$(/usr/bin/plutil -extract sha256 raw -o - "$CACHE_MANIFEST" 2>/dev/null || true)"
    [ "$ARCHIVE_NAME" = "macos-arm64-dependencies.zip" ] || fail "The bundled runtime manifest is invalid. Extract the complete ZIP again."
    CACHE_ARCHIVE="$APP_DIR/launcher-cache/$ARCHIVE_NAME"
    [ -f "$CACHE_ARCHIVE" ] || fail "The bundled runtime is missing. Extract the complete ZIP again."
    status "Checking the bundled Mac runtime…"
    CACHE_ACTUAL="$(/usr/bin/shasum -a 256 "$CACHE_ARCHIVE" | /usr/bin/awk '{print $1}')"
    [ -n "$CACHE_EXPECTED" ] && [ "$CACHE_EXPECTED" = "$CACHE_ACTUAL" ] || fail "The bundled runtime failed its integrity check. Extract the ZIP again."
    status "Unpacking the bundled Mac runtime. No download is needed…"
    STAGING="$(/usr/bin/mktemp -d "$APP_DIR/.pulsestudio-unpack.XXXXXX")" || fail "The folder is not writable. Move the complete folder to Documents and try again."
    if [ -x "$NODE_DIR/bin/node" ]; then
      UNPACK_NODE="$NODE_DIR/bin/node"
    elif command -v node >/dev/null 2>&1 && node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' >/dev/null 2>&1; then
      UNPACK_NODE="$(command -v node)"
    else
      # Extract just the standalone Node executable to bound the full unpack even
      # on a Mac that has never installed Node. Keep the running file separate.
      NODE_MEMBER=".pulsestudio-node-runtime/darwin-$NODE_ARCH/node-v$NODE_VERSION-darwin-$NODE_ARCH/bin/node"
      /usr/bin/unzip -q "$CACHE_ARCHIVE" "$NODE_MEMBER" -d "$STAGING" >> "$LOG_FILE" 2>&1 || fail "The bundled setup tool could not be unpacked."
      /bin/mv "$STAGING/$NODE_MEMBER" "$STAGING/.setup-node" || fail "The bundled setup tool could not be prepared."
      UNPACK_NODE="$STAGING/.setup-node"
    fi
    "$UNPACK_NODE" "$APP_DIR/setup-runner.cjs" --timeout-ms 180000 --progress-ms 15000 --status "Unpacking bundled Mac runtime" -- /usr/bin/ditto -x -k "$CACHE_ARCHIVE" "$STAGING" 2>&1 | tee -a "$LOG_FILE" || fail "The bundled runtime could not be unpacked within three minutes. Check free disk space and try again."
    [ -x "$STAGING/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" ] && [ -x "$STAGING/node_modules/ffmpeg-static/ffmpeg" ] && [ -x "$STAGING/.pulsestudio-node-runtime/darwin-$NODE_ARCH/node-v$NODE_VERSION-darwin-$NODE_ARCH/bin/node" ] || fail "The bundled runtime is incomplete. Extract the ZIP again."
    if [ -d "$APP_DIR/node_modules" ]; then /bin/mv "$APP_DIR/node_modules" "$STAGING/previous-node_modules" || fail "The old dependency folder could not be moved. Quit setup and try again."; fi
    /bin/mv "$STAGING/node_modules" "$APP_DIR/node_modules" || fail "The prepared dependencies could not be installed."
    mkdir -p "$NODE_ROOT"
    if [ ! -d "$NODE_DIR" ]; then /bin/mv "$STAGING/.pulsestudio-node-runtime/darwin-$NODE_ARCH/node-v$NODE_VERSION-darwin-$NODE_ARCH" "$NODE_ROOT/" || fail "The prepared Node runtime could not be installed."; fi
    /bin/rm -rf "$STAGING"
  fi
fi

# Prefer the bundled private toolchain. No global npm configuration is changed.
if [ -x "$NODE_DIR/bin/node" ] && [ -f "$NODE_DIR/lib/node_modules/npm/bin/npm-cli.js" ]; then
  export PATH="$NODE_DIR/bin:$PATH"
fi
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' >/dev/null 2>&1; then
  status "Preparing Node.js for this Mac. Checking download access…"
  mkdir -p "$NODE_ROOT" || fail "The folder is not writable. Move the complete folder to Documents and try again."
  NODE_ARCHIVE="node-v$NODE_VERSION-darwin-$NODE_ARCH.tar.gz"
  /usr/bin/curl --fail --location --retry 1 --retry-max-time 120 --connect-timeout 15 --max-time 90 "https://nodejs.org/dist/v$NODE_VERSION/$NODE_ARCHIVE" --output "$NODE_ROOT/$NODE_ARCHIVE" >> "$LOG_FILE" 2>&1 || fail "Node.js could not be downloaded within the setup time limit. Check internet or proxy access and try again."
  /usr/bin/curl --fail --location --retry 1 --retry-max-time 40 --connect-timeout 15 --max-time 20 "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" --output "$NODE_ROOT/SHASUMS256.txt" >> "$LOG_FILE" 2>&1 || fail "Node.js integrity checks could not be downloaded."
  NODE_EXPECTED="$(/usr/bin/awk -v name="$NODE_ARCHIVE" '$2 == name {print $1}' "$NODE_ROOT/SHASUMS256.txt")"
  NODE_ACTUAL="$(/usr/bin/shasum -a 256 "$NODE_ROOT/$NODE_ARCHIVE" | /usr/bin/awk '{print $1}')"
  [ -n "$NODE_EXPECTED" ] && [ "$NODE_EXPECTED" = "$NODE_ACTUAL" ] || fail "The Node.js download failed its integrity check."
  /usr/bin/tar -xzf "$NODE_ROOT/$NODE_ARCHIVE" -C "$NODE_ROOT" >> "$LOG_FILE" 2>&1 || fail "Node.js could not be unpacked."
  /bin/rm -f "$NODE_ROOT/$NODE_ARCHIVE" "$NODE_ROOT/SHASUMS256.txt"
  export PATH="$NODE_DIR/bin:$PATH"
fi
NODE_BIN="$(node -p 'process.execPath')"
NPM_CLI="$(node -e 'const fs=require("fs");process.stdout.write(fs.realpathSync(process.argv[1]));' "$(command -v npm)" 2>/dev/null || true)"
[ -f "$NPM_CLI" ] || fail "npm is incomplete. Extract the complete ZIP and try again."
export PULSESTUDIO_PORTABLE_ROOT="$ROOT_DIR"
export npm_config_audit=false npm_config_fund=false npm_config_update_notifier=false
export npm_config_fetch_retries=1 npm_config_fetch_timeout=20000
export npm_config_fetch_retry_mintimeout=2000 npm_config_fetch_retry_maxtimeout=5000
export npm_config_prefer_offline=true
APP_VERSION="$(node -p "require('./package.json').version" 2>/dev/null || true)"
[ -n "$APP_VERSION" ] || fail "The PulseStudio version could not be read."
printf 'Version: %s\nNode: %s\nArchitecture: %s\n' "$APP_VERSION" "$(node --version)" "$NODE_ARCH" >> "$LOG_FILE"
run_setup() {
  local time_limit="$1" setup_label="$2"
  shift 2
  node "$APP_DIR/setup-runner.cjs" --timeout-ms "$time_limit" --progress-ms 15000 --status "$setup_label" -- "$@" 2>&1 | tee -a "$LOG_FILE"
}
if ! node "$APP_DIR/launcher-dependencies.cjs" check; then
  status "Checking cached dependencies before downloading…"
  if run_setup 60000 "Checking cached dependencies" "$NODE_BIN" "$NPM_CLI" install --include=dev --offline --ignore-scripts --no-audit --no-fund; then
    status "Preparing cached desktop components…"
    run_setup 300000 "Preparing desktop components" "$NODE_BIN" "$NPM_CLI" rebuild --foreground-scripts || fail "Desktop components could not be prepared within the time limit. Open the setup log, check internet access and try again."
  else
    status "Downloading missing dependencies. Requests have a time limit…"
    run_setup 300000 "Downloading desktop dependencies" "$NODE_BIN" "$NPM_CLI" install --include=dev --foreground-scripts --no-audit --no-fund || fail "Setup could not reach a dependency server or exceeded its time limit. The log identifies the failing download. Check internet or proxy access and try again."
  fi
fi
if [ ! -x "$ELECTRON_BIN" ]; then
  status "Preparing the desktop runtime…"
  unset ELECTRON_SKIP_BINARY_DOWNLOAD
  run_setup 180000 "Preparing desktop runtime" "$NODE_BIN" "$APP_DIR/node_modules/electron/install.js" || fail "The desktop runtime download failed or exceeded its time limit."
fi
if [ ! -x "$APP_DIR/node_modules/ffmpeg-static/ffmpeg" ]; then
  status "Preparing the recording encoder…"
  run_setup 180000 "Preparing recording encoder" "$NODE_BIN" "$APP_DIR/node_modules/ffmpeg-static/install.js" || fail "The recording encoder download failed or exceeded its time limit."
fi
node "$APP_DIR/launcher-dependencies.cjs" check || fail "The installed components do not match this Mac or the application requirements. Extract the complete ZIP and try again."
node "$APP_DIR/launcher-dependencies.cjs" stamp || fail "The prepared runtime could not be saved. Check that this folder is writable."
ELECTRON_APP="$(node "$APP_DIR/launcher-dependencies.cjs" host-path)" || fail "The Mac app name could not be prepared. Quit PulseStudio completely and open it again."
ELECTRON_BIN="$ELECTRON_APP/Contents/MacOS/Electron"
[ "${ELECTRON_APP:t}" = "Pulse Studio.app" ] || fail "The current PulseStudio app is still open, or its Mac name could not be prepared. Quit PulseStudio completely, then double-click PulseStudio.app again."
[ -x "$ELECTRON_BIN" ] || fail "The prepared Mac app is missing. Extract the complete ZIP and try again."
if pgrep -f '/PulseStudio.app/Contents/MacOS/PulseStudio([[:space:]]|$)' >/dev/null 2>&1; then
  fail "An older PulseStudio runtime is still open. Quit PulseStudio completely and try again."
fi
status "Opening PulseStudio…"
printf 'Opening Pulse Studio app: %s\n' "$ELECTRON_APP" >> "$LOG_FILE"
/usr/bin/open -n "$ELECTRON_APP" --env "PATH=$PATH" --env "PULSESTUDIO_PORTABLE_ROOT=$ROOT_DIR" --args "$APP_DIR" || fail "macOS could not open PulseStudio. Review the setup log."
exit 0
