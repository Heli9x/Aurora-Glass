#!/bin/bash
# Archives a tagged Filey release into dev/filey_release_v<version>.zip.
#
# Usage:  dev/archive_release.sh <version>
# Example: dev/archive_release.sh 3.0.11
#
# Mirrors build_release.sh's staging so the resulting zip has the same
# top-level layout (install.sh, update.sh, app/) and update.sh works unpacked.
# Documentation markdown lives BESIDE the zip in dev/, not inside it.

set -euo pipefail

if [ "$#" -ne 1 ]; then
    echo "usage: $0 <version>" >&2
    exit 1
fi

VERSION="$1"

if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "error: version must be X.Y.Z (got '$VERSION')" >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DEV_DIR="$SCRIPT_DIR"
RELEASE_DIR="$PROJECT_DIR/release"
STAGE_DIR="$(mktemp -d)"
ZIP_NAME="filey_release_v${VERSION}.zip"
ZIP_PATH="$DEV_DIR/$ZIP_NAME"

trap 'rm -rf "$STAGE_DIR"' EXIT

if [ ! -f "$PROJECT_DIR/install.sh" ]; then
    echo "error: install.sh not found at project root" >&2
    exit 1
fi

echo ">> Staging app ('$VERSION')"
mkdir -p "$STAGE_DIR/app"
cp -a "$PROJECT_DIR/server.py" "$STAGE_DIR/app/"
cp -a "$PROJECT_DIR/backend" "$STAGE_DIR/app/"
cp -a "$PROJECT_DIR/static" "$STAGE_DIR/app/"
cp -a "$PROJECT_DIR/index.html" "$STAGE_DIR/app/"
cp -a "$PROJECT_DIR/requirements.txt" "$STAGE_DIR/app/"
cp -a "$PROJECT_DIR/start.sh" "$STAGE_DIR/app/"
cp -a "$PROJECT_DIR/stop.sh" "$STAGE_DIR/app/"

echo ">> Staging installer"
cp -a "$PROJECT_DIR/install.sh" "$STAGE_DIR/"
cp -a "$PROJECT_DIR/update.sh" "$STAGE_DIR/"

echo ">> Creating $ZIP_PATH"
rm -f "$ZIP_PATH"
(cd "$STAGE_DIR" && zip -r -q "$ZIP_PATH" install.sh update.sh app)

echo ">> Copying documentation beside the archive"
if [ -f "$RELEASE_DIR/INSTALL.md" ]; then
    cp -a "$RELEASE_DIR/INSTALL.md" "$DEV_DIR/INSTALL.md"
else
    echo "warning: release/INSTALL.md not found, skipped" >&2
fi
if [ -f "$RELEASE_DIR/UPDATE_v${VERSION}.md" ]; then
    cp -a "$RELEASE_DIR/UPDATE_v${VERSION}.md" "$DEV_DIR/UPDATE_v${VERSION}.md"
else
    echo "warning: release/UPDATE_v${VERSION}.md not found, skipped" >&2
fi

echo ">> Verifying archive"
unzip -l "$ZIP_PATH" >/dev/null

echo ">> Done: $ZIP_PATH"