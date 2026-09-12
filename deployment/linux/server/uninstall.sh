#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${FILEY_INSTALL_DIR:-/opt/filey}"
SERVICE_NAME="filey-server.service"
ENV_DIR="/etc/filey"
YES=false

for argument in "$@"; do
    case "$argument" in
        --yes) YES=true ;;
        *) echo "Unknown option: $argument" >&2; exit 2 ;;
    esac
done

if [[ "$YES" != true ]]; then
    printf 'This removes the Filey installation at %s, its systemd service, and service user.\n' "$INSTALL_DIR"
    printf 'Shared media storage is preserved. Continue? [y/N] '
    read -r answer
    [[ "$answer" == "y" || "$answer" == "Y" ]] || { echo 'Uninstall cancelled.'; exit 0; }
fi

sudo systemctl disable --now "$SERVICE_NAME" 2>/dev/null || true
sudo rm -f "/etc/systemd/system/$SERVICE_NAME"
sudo systemctl daemon-reload
sudo rm -rf "$INSTALL_DIR"
sudo rm -rf "$ENV_DIR"
if id filey >/dev/null 2>&1; then
    sudo userdel filey 2>/dev/null || true
fi

echo "Filey production server removed. Shared media storage was not modified."
