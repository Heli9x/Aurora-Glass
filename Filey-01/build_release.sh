#!/bin/bash
# Builds the distributable release package for Filey.
# Produces release/filey-release.zip (core app + install.sh) and release/INSTALL.md.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_DIR="$PROJECT_DIR/release"
STAGE_DIR="$(mktemp -d)"
ZIP_NAME="filey-release.zip"

trap 'rm -rf "$STAGE_DIR"' EXIT

echo ">> Staging core application files"
mkdir -p "$STAGE_DIR/app"
cp -a "$PROJECT_DIR/server.py" "$STAGE_DIR/app/"
cp -a "$PROJECT_DIR/backend" "$STAGE_DIR/app/"
cp -a "$PROJECT_DIR/static" "$STAGE_DIR/app/"
cp -a "$PROJECT_DIR/index.html" "$STAGE_DIR/app/"
cp -a "$PROJECT_DIR/requirements.txt" "$STAGE_DIR/app/"
cp -a "$PROJECT_DIR/start.sh" "$STAGE_DIR/app/"
cp -a "$PROJECT_DIR/stop.sh" "$STAGE_DIR/app/"
rm -rf "$STAGE_DIR/app/backend/__pycache__"

echo ">> Staging installer"
cp -a "$PROJECT_DIR/install.sh" "$STAGE_DIR/"
cp -a "$PROJECT_DIR/update.sh" "$STAGE_DIR/"

echo ">> Creating $RELEASE_DIR/$ZIP_NAME"
mkdir -p "$RELEASE_DIR"
rm -f "$RELEASE_DIR/$ZIP_NAME"
(cd "$STAGE_DIR" && zip -r -q "$RELEASE_DIR/$ZIP_NAME" install.sh update.sh app)

echo ">> Done: $RELEASE_DIR/$ZIP_NAME"
