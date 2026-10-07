#!/bin/bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_ROOT="$(cd "$APP_DIR/.." && pwd)"
BUNDLE_PATH="$PACKAGE_ROOT/PulseStudio.app"
LAUNCHER_ID="com.girishxp.pulsestudio.launcher"
VERSION="$(/usr/bin/plutil -extract version raw -o - "$APP_DIR/package.json")"
BUILD_DIR="$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/pulsestudio-launcher.XXXXXX")"
trap '/bin/rm -rf "$BUILD_DIR"' EXIT

STAGED_BUNDLE="$BUILD_DIR/PulseStudio.app"
/bin/mkdir -p "$STAGED_BUNDLE/Contents/MacOS" "$STAGED_BUNDLE/Contents/Resources"

for LAUNCHER_ARCH in arm64 x86_64; do
  /usr/bin/xcrun clang -arch "$LAUNCHER_ARCH" -mmacosx-version-min=11.0 \
    -fobjc-arc -Wall -Wextra -Werror -framework Cocoa \
    "$APP_DIR/launcher-macos.m" -o "$BUILD_DIR/PulseStudioLauncher-$LAUNCHER_ARCH"
done
/usr/bin/lipo -create "$BUILD_DIR/PulseStudioLauncher-arm64" "$BUILD_DIR/PulseStudioLauncher-x86_64" \
  -output "$STAGED_BUNDLE/Contents/MacOS/PulseStudioLauncher"
/bin/cp "$APP_DIR/assets/pulsestudio-icon.icns" "$STAGED_BUNDLE/Contents/Resources/pulsestudio-icon.icns"

/bin/cat > "$STAGED_BUNDLE/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleDisplayName</key><string>Pulse Studio</string>
  <key>CFBundleName</key><string>Pulse Studio</string>
  <key>CFBundleExecutable</key><string>PulseStudioLauncher</string>
  <key>CFBundleIdentifier</key><string>$LAUNCHER_ID</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>CFBundleIconFile</key><string>pulsestudio-icon.icns</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
</dict>
</plist>
PLIST
/usr/bin/plutil -lint "$STAGED_BUNDLE/Contents/Info.plist"
# This signs only the small launcher; Electron's original signed host is untouched.
/usr/bin/codesign --force --sign - --identifier "$LAUNCHER_ID" "$STAGED_BUNDLE"
/usr/bin/codesign --verify --strict "$STAGED_BUNDLE"
/bin/rm -rf "$BUNDLE_PATH"
/bin/mv "$STAGED_BUNDLE" "$BUNDLE_PATH"
/usr/bin/lipo -archs "$BUNDLE_PATH/Contents/MacOS/PulseStudioLauncher"
printf 'Built PulseStudio %s launcher: %s\n' "$VERSION" "$BUNDLE_PATH"
