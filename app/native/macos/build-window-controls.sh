#!/bin/bash
set -euo pipefail
TASK_NATIVE_DIR="$(cd "$(dirname "$0")" && pwd)"
TASK_HEADER_DIR="${1:-${NAPI_HEADER_DIR:-}}"
if [[ ! -f "$TASK_HEADER_DIR/node_api.h" ]]; then
  echo 'Pass a folder containing Node-API headers as the first argument.' >&2
  exit 1
fi
TASK_BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "$TASK_BUILD_DIR"' EXIT
for TASK_ARCH in arm64 x86_64; do
  clang -arch "$TASK_ARCH" -mmacosx-version-min=11.0 -fobjc-arc -fblocks \
    -shared -undefined dynamic_lookup -framework Cocoa -I "$TASK_HEADER_DIR" \
    "$TASK_NATIVE_DIR/window-controls.m" -o "$TASK_BUILD_DIR/window-controls-$TASK_ARCH.node"
done
lipo -create "$TASK_BUILD_DIR/window-controls-arm64.node" "$TASK_BUILD_DIR/window-controls-x86_64.node" \
  -output "$TASK_NATIVE_DIR/window-controls.node"
codesign --force --sign - "$TASK_NATIVE_DIR/window-controls.node"
codesign --verify --strict "$TASK_NATIVE_DIR/window-controls.node"
