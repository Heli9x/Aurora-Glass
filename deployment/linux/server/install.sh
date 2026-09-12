#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/../../.." && pwd)"
SOURCE_DIR="$PROJECT_ROOT/Filey-01"
INSTALL_DIR="${FILEY_INSTALL_DIR:-/opt/filey}"
STORAGE_DIR="${FILEY_STORAGE_DIR:-/run/media/heli9x/FS-STORAGE}"

if [[ ! -d "$SOURCE_DIR" ]]; then
    echo "Missing source project: $SOURCE_DIR" >&2
    exit 1
fi

sudo apt-get update
sudo apt-get install -y python3 python3-venv ffmpeg
sudo mkdir -p "$INSTALL_DIR"
sudo cp -a "$SOURCE_DIR/." "$INSTALL_DIR/"
sudo python3 -m venv "$INSTALL_DIR/.venv"
sudo "$INSTALL_DIR/.venv/bin/pip" install --upgrade pip
sudo "$INSTALL_DIR/.venv/bin/pip" install -r "$INSTALL_DIR/requirements.txt"
sudo install -m 0644 "$SCRIPT_DIR/filey-server.service" /etc/systemd/system/filey-server.service
sudo sed -i "s|__FILEY_INSTALL_DIR__|$INSTALL_DIR|g; s|__FILEY_STORAGE_DIR__|$STORAGE_DIR|g" /etc/systemd/system/filey-server.service
sudo systemctl daemon-reload
sudo systemctl enable --now filey-server
printf 'Filey server installed at http://%s:9100\n' "$(hostname -I | awk '{print $1}')"
