#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/../../.." && pwd)"
SOURCE_DIR="$PROJECT_ROOT/Filey-01"
INSTALL_DIR="${FILEY_INSTALL_DIR:-/opt/filey}"
STORAGE_DIR="${FILEY_STORAGE_DIR:-/run/media/heli9x/FS-STORAGE}"
BIND_ADDR="${FILEY_BIND:-0.0.0.0:9100}"

if [[ ! -d "$SOURCE_DIR" ]]; then
    echo "Missing source project: $SOURCE_DIR" >&2
    exit 1
fi

sudo apt-get update
sudo apt-get install -y python3 python3-venv ffmpeg
if ! id filey >/dev/null 2>&1; then
    sudo useradd --system --home-dir "$INSTALL_DIR" --shell /usr/sbin/nologin filey
fi
sudo install -d -o filey -g filey /etc/filey
sudo mkdir -p "$INSTALL_DIR"
sudo cp -a "$SOURCE_DIR/." "$INSTALL_DIR/"
sudo python3 -m venv "$INSTALL_DIR/.venv"
sudo "$INSTALL_DIR/.venv/bin/pip" install --upgrade pip
sudo "$INSTALL_DIR/.venv/bin/pip" install -r "$INSTALL_DIR/requirements.txt"
sudo "$INSTALL_DIR/.venv/bin/pip" install gunicorn
sudo chown -R filey:filey "$INSTALL_DIR"
sudo install -m 0644 "$SCRIPT_DIR/filey-production.env.example" /etc/filey/filey.env
sudo sed -i "s|^FILEY_STORAGE_DIR=.*|FILEY_STORAGE_DIR=$STORAGE_DIR|; s|^FILEY_BIND=.*|FILEY_BIND=$BIND_ADDR|" /etc/filey/filey.env
sudo install -m 0644 "$SCRIPT_DIR/filey-server-production.service" /etc/systemd/system/filey-server.service
sudo sed -i "s|__FILEY_INSTALL_DIR__|$INSTALL_DIR|g; s|__FILEY_STORAGE_DIR__|$STORAGE_DIR|g; s|__FILEY_BIND__|$BIND_ADDR|g" /etc/systemd/system/filey-server.service
sudo systemctl daemon-reload
sudo systemctl enable --now filey-server
printf 'Filey production server installed at http://%s:%s\n' "$(hostname -I | awk '{print $1}')" "${BIND_ADDR##*:}"
