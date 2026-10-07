#!/bin/bash
set -euo pipefail

# PulseStudio one-click GitHub publisher for macOS.
# Override these defaults if needed:
#   PULSESTUDIO_REPO="$HOME/Developer/PulseStudio"
#   PULSESTUDIO_GITHUB_REPO="girishxp/PulseStudio"

REPO_DIR="${PULSESTUDIO_REPO:-$HOME/Developer/PulseStudio}"
GITHUB_REPO="${PULSESTUDIO_GITHUB_REPO:-girishxp/PulseStudio}"
EXPECTED_BRANCH="main"
TMP_DIR=""
CHANGES_APPLIED=0
COMMIT_CREATED=0

say() {
  printf '%s\n' "$*"
}

fail() {
  printf '\nERROR: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [ -n "${TMP_DIR:-}" ] && [ -d "$TMP_DIR" ]; then
    rm -rf "$TMP_DIR"
  fi
}
trap cleanup EXIT

rollback_uncommitted_changes() {
  if [ "$CHANGES_APPLIED" -eq 1 ] && [ "$COMMIT_CREATED" -eq 0 ]; then
    say ""
    say "Restoring the repository to its clean pre-publish state..."
    git -C "$REPO_DIR" reset --hard HEAD >/dev/null 2>&1 || true
    git -C "$REPO_DIR" clean -fd >/dev/null 2>&1 || true
  fi
}

abort_publish() {
  rollback_uncommitted_changes
  fail "$*"
}

need_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command '$1' was not found. $2"
}

latest_download_zip() {
  # The ls call is intentional here: the build filenames contain no spaces and
  # this gives us the most recently modified matching PulseStudio ZIP.
  ls -t "$HOME"/Downloads/PulseStudio-cross-platform-v*.zip 2>/dev/null | head -n 1 || true
}

say ""
say "============================================================"
say "                 PulseStudio Publisher"
say "============================================================"
say ""

need_command git "Install Apple's command-line tools with: xcode-select --install"
need_command unzip "macOS normally includes unzip."
need_command rsync "macOS normally includes rsync."
need_command gh "Install GitHub CLI once with: brew install gh  then run: gh auth login"
need_command shasum "macOS normally includes shasum."

if ! gh auth status >/dev/null 2>&1; then
  fail "GitHub CLI is not authenticated. Run 'gh auth login' once, then double-click this publisher again."
fi

ZIP_PATH="${1:-}"
if [ -z "$ZIP_PATH" ]; then
  PUBLISHER_DIR="$(cd "$(dirname "$0")" && pwd)"
  ZIP_PATH="$(ls -t "$PUBLISHER_DIR"/PulseStudio-cross-platform-v*.zip 2>/dev/null | head -n 1 || true)"
  if [ -z "$ZIP_PATH" ]; then ZIP_PATH="$(latest_download_zip)"; fi
fi

[ -n "$ZIP_PATH" ] || fail "No PulseStudio build ZIP was found in $HOME/Downloads. Put the newest PulseStudio-cross-platform-vX.Y.Z.zip there and run this again."

# Expand ~ if a path was supplied from a shell.
case "$ZIP_PATH" in
  ~/*) ZIP_PATH="$HOME/${ZIP_PATH#~/}" ;;
esac

[ -f "$ZIP_PATH" ] || fail "Build ZIP not found: $ZIP_PATH"
ZIP_PATH="$(cd "$(dirname "$ZIP_PATH")" && pwd)/$(basename "$ZIP_PATH")"
ZIP_NAME="$(basename "$ZIP_PATH")"

VERSION="$(printf '%s\n' "$ZIP_NAME" | sed -n 's/^PulseStudio-cross-platform-v\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)\.zip$/\1/p')"
[ -n "$VERSION" ] || fail "ZIP name must be exactly PulseStudio-cross-platform-vX.Y.Z.zip. Found: $ZIP_NAME"
TAG="v$VERSION"

[ -d "$REPO_DIR/.git" ] || fail "PulseStudio Git repository was not found at: $REPO_DIR\nSet PULSESTUDIO_REPO if your repository is elsewhere."

BRANCH="$(git -C "$REPO_DIR" rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" = "$EXPECTED_BRANCH" ] || fail "Repository must be on '$EXPECTED_BRANCH'. Current branch: $BRANCH"

if [ -n "$(git -C "$REPO_DIR" status --porcelain)" ]; then
  fail "The repository has uncommitted changes. Commit/discard them first so the publisher cannot overwrite your work."
fi

ORIGIN_URL="$(git -C "$REPO_DIR" remote get-url origin 2>/dev/null || true)"
[ -n "$ORIGIN_URL" ] || fail "The repository does not have an 'origin' remote."
case "$ORIGIN_URL" in
  *girishxp/PulseStudio* ) ;;
  * ) fail "For safety, origin does not look like girishxp/PulseStudio. Found: $ORIGIN_URL" ;;
esac

say "Checking GitHub and syncing main..."
git -C "$REPO_DIR" fetch origin "$EXPECTED_BRANCH" --tags --quiet
git -C "$REPO_DIR" pull --ff-only origin "$EXPECTED_BRANCH" --quiet

if git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null 2>&1; then
  fail "Tag $TAG already exists on GitHub. Refusing to overwrite an existing release version."
fi

if gh release view "$TAG" -R "$GITHUB_REPO" >/dev/null 2>&1; then
  fail "GitHub Release $TAG already exists. Refusing to overwrite it."
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pulsestudio-publish.XXXXXX")"
unzip -q "$ZIP_PATH" -d "$TMP_DIR"

BUILD_ROOT="$TMP_DIR/PulseStudio"
if [ ! -f "$BUILD_ROOT/app/package.json" ]; then
  PACKAGE_JSON="$(find "$TMP_DIR" -maxdepth 3 -type f -path '*/app/package.json' -print | head -n 1 || true)"
  [ -n "$PACKAGE_JSON" ] || fail "The ZIP does not look like a PulseStudio build: app/package.json is missing."
  BUILD_ROOT="$(dirname "$(dirname "$PACKAGE_JSON")")"
fi

PACKAGE_VERSION="$(sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$BUILD_ROOT/app/package.json" | head -n 1)"
[ -n "$PACKAGE_VERSION" ] || fail "Could not read the version from app/package.json."
[ "$PACKAGE_VERSION" = "$VERSION" ] || fail "Version mismatch. ZIP says $VERSION but app/package.json says $PACKAGE_VERSION."

[ -f "$BUILD_ROOT/app/main.js" ] || fail "PulseStudio app/main.js is missing from the ZIP."
[ -f "$BUILD_ROOT/README.md" ] || fail "PulseStudio README.md is missing from the ZIP."

SHA256="$(shasum -a 256 "$ZIP_PATH" | awk '{print $1}')"

say ""
say "Build verified:"
say "  Version:     $VERSION"
say "  Repository:  $GITHUB_REPO"
say "  Branch:      $EXPECTED_BRANCH"
say "  Local repo:  $REPO_DIR"
say "  ZIP:         $ZIP_NAME"
say "  SHA-256:     $SHA256"
say ""
say "Preparing repository changes..."

# Mirror the build into the repository while protecting Git metadata and
# local/repository administration files. Ignored local dependencies are also
# left alone so publishing never forces a reinstall.
rsync -a --delete \
  --exclude='.git/' \
  --exclude='/.gitignore' \
  --exclude='.github/' \
  --exclude='.DS_Store' \
  --exclude='node_modules/' \
  --exclude='app/.pulsestudio-node-runtime/' \
  --exclude='app/launcher-cache/' \
  --exclude='app/runtime/' \
  --exclude='app/.pulsestudio-unpack.*/' \
  --exclude='app/.pulsestudio-runtime-windows/' \
  --exclude='*.log' \
  --exclude='recordings/' \
  --exclude='recovery/' \
  "$BUILD_ROOT/" "$REPO_DIR/"
CHANGES_APPLIED=1

if [ -z "$(git -C "$REPO_DIR" status --porcelain)" ]; then
  rollback_uncommitted_changes
  fail "The build produced no source changes. Nothing will be published."
fi

say ""
say "Files that will be published:"
git -C "$REPO_DIR" status --short
say ""
git -C "$REPO_DIR" diff --stat || true
say ""
say "This will now:"
say "  1. Commit these source changes as 'PulseStudio v$VERSION'"
say "  2. Push main to GitHub"
say "  3. Create GitHub Release $TAG"
say "  4. Upload $ZIP_NAME"
say "  5. Mark the release as Latest"
say ""
printf "Continue and publish PulseStudio v%s? [y/N] " "$VERSION"
read -r ANSWER
case "$ANSWER" in
  y|Y|yes|YES|Yes) ;;
  *)
    rollback_uncommitted_changes
    say ""
    say "Cancelled. Nothing was committed or published."
    exit 0
    ;;
esac

say ""
say "Committing source..."
git -C "$REPO_DIR" add -A
git -C "$REPO_DIR" commit -m "PulseStudio v$VERSION" -m "Automated PulseStudio production release $TAG."
COMMIT_CREATED=1

say "Pushing main..."
git -C "$REPO_DIR" push origin "$EXPECTED_BRANCH"

RELEASE_NOTES_FILE="$TMP_DIR/release-notes.md"
cat > "$RELEASE_NOTES_FILE" <<NOTES
PulseStudio v$VERSION production release.

Automated release package: \`$ZIP_NAME\`

SHA-256: \`$SHA256\`
NOTES

say "Creating GitHub release and uploading the build..."
if ! gh release create "$TAG" "$ZIP_PATH" \
  -R "$GITHUB_REPO" \
  --target "$EXPECTED_BRANCH" \
  --title "PulseStudio v$VERSION" \
  --notes-file "$RELEASE_NOTES_FILE" \
  --generate-notes \
  --latest \
  --fail-on-no-commits; then
  say ""
  say "The source commit was pushed successfully, but GitHub Release creation failed."
  say "Your code is safe on GitHub. Re-run the release step manually or run this publisher after resolving the GitHub CLI issue."
  exit 1
fi

RELEASE_URL="$(gh release view "$TAG" -R "$GITHUB_REPO" --json url --jq '.url' 2>/dev/null || true)"
IS_LATEST="$(gh release view "$TAG" -R "$GITHUB_REPO" --json isLatest --jq '.isLatest' 2>/dev/null || true)"

say ""
say "============================================================"
say "                 PUBLISH COMPLETE"
say "============================================================"
say "Version:   $VERSION"
say "Tag:       $TAG"
say "Latest:    ${IS_LATEST:-true}"
say "Asset:     $ZIP_NAME"
say "SHA-256:   $SHA256"
if [ -n "$RELEASE_URL" ]; then
  say "Release:   $RELEASE_URL"
fi
say ""
say "PulseStudio v$VERSION is now published."

if [ -n "$RELEASE_URL" ] && command -v open >/dev/null 2>&1; then
  open "$RELEASE_URL" >/dev/null 2>&1 || true
fi
