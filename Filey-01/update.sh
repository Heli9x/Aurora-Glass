#!/bin/bash
# Filey updater for existing Debian/Ubuntu installations.
# Run as root (or via sudo) from an extracted release package. Copies the new
# application code over an existing install, upgrades Python dependencies,
# re-applies GPU (VAAPI) group access, and restarts the service.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_SRC="$SCRIPT_DIR/app"
INSTALL_CONF="/etc/filey/install.conf"

if [[ $EUID -ne 0 ]]; then
    echo "This updater must be run as root, e.g.: sudo ./update.sh" >&2
    exit 1
fi

if [[ ! -d "$APP_SRC" ]]; then
    echo "Cannot find application files at $APP_SRC (expected alongside update.sh)." >&2
    exit 1
fi

echo "=================================================="
echo " Filey updater"
echo "=================================================="
echo

ask() {
    # ask <prompt> <default> -> echoes the answer
    local prompt="$1" default="$2" reply
    read -r -p "$prompt [$default]: " reply || true
    echo "${reply:-$default}"
}

ask_yn() {
    # ask_yn <prompt> <default: y|n> -> echoes y or n
    local prompt="$1" default="$2" reply
    while true; do
        read -r -p "$prompt [$default]: " reply || true
        reply="${reply:-$default}"
        case "$reply" in
            [Yy]*) echo "y"; return ;;
            [Nn]*) echo "n"; return ;;
            *) echo "Please answer y or n." >&2 ;;
        esac
    done
}

INSTALL_DIR=""
SERVICE_USER=""
if [[ -f "$INSTALL_CONF" ]]; then
    # shellcheck disable=SC1090
    source "$INSTALL_CONF"
fi

INSTALL_DIR=$(ask "Existing installation directory" "${INSTALL_DIR:-/opt/filey}")
SERVICE_USER=$(ask "System user Filey runs as" "${SERVICE_USER:-filey}")

if [[ ! -f "$INSTALL_DIR/server.py" ]]; then
    echo "No existing Filey installation found at $INSTALL_DIR (server.py missing)." >&2
    echo "Use install.sh for a fresh install instead." >&2
    exit 1
fi

USE_SYSTEMD="n"
if systemctl list-unit-files 2>/dev/null | grep -q '^filey\.service'; then
    USE_SYSTEMD="y"
fi

echo
echo "--- Summary ---"
echo "Install directory : $INSTALL_DIR"
echo "Run as user       : $SERVICE_USER"
echo "Systemd service    : $([[ "$USE_SYSTEMD" == y ]] && echo "detected (will restart)" || echo "not found (manual start/stop)")"
echo
CONFIRM=$(ask_yn "Proceed with update? (app code will be replaced, storage data is untouched)" "y")
if [[ "$CONFIRM" != "y" ]]; then
    echo "Update aborted."
    exit 0
fi

if [[ "$USE_SYSTEMD" == "y" ]]; then
    echo ">> Stopping filey.service"
    systemctl stop filey.service || true
else
    echo ">> Stopping any running Filey process"
    "$INSTALL_DIR/stop.sh" || true
fi

BACKUP_DIR="$INSTALL_DIR.bak-$(date +%Y%m%d%H%M%S)"
echo ">> Backing up current app code to $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"
for item in server.py backend static index.html requirements.txt start.sh stop.sh; do
    [[ -e "$INSTALL_DIR/$item" ]] && cp -a "$INSTALL_DIR/$item" "$BACKUP_DIR/"
done

echo ">> Copying updated application files to $INSTALL_DIR"
cp -a "$APP_SRC/." "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/start.sh" "$INSTALL_DIR/stop.sh"

echo ">> Updating Python dependencies"
if [[ ! -x "$INSTALL_DIR/.venv/bin/pip" ]]; then
    python3 -m venv "$INSTALL_DIR/.venv"
fi
"$INSTALL_DIR/.venv/bin/pip" install --upgrade pip
"$INSTALL_DIR/.venv/bin/pip" install --upgrade -r "$INSTALL_DIR/requirements.txt"

echo ">> Re-applying GPU (VAAPI) device group access to '$SERVICE_USER'"
for grp in render video; do
    if getent group "$grp" &>/dev/null; then
        usermod -aG "$grp" "$SERVICE_USER"
    fi
done

chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

echo ">> Refreshing /etc/filey/install.conf"
mkdir -p /etc/filey
STORAGE_DIR="${STORAGE_DIR:-}"
cat > "$INSTALL_CONF" <<EOF
INSTALL_DIR=$INSTALL_DIR
SERVICE_USER=$SERVICE_USER
STORAGE_DIR=$STORAGE_DIR
EOF

if [[ "$USE_SYSTEMD" == "y" ]]; then
    echo ">> Restarting filey.service"
    systemctl daemon-reload
    systemctl start filey.service
    echo ">> Update complete. Check status with: systemctl status filey"
else
    START_NOW=$(ask_yn "Start Filey now?" "y")
    if [[ "$START_NOW" == "y" ]]; then
        sudo -u "$SERVICE_USER" "$INSTALL_DIR/start.sh" &
        echo ">> Filey launched in background (PID $!). Use $INSTALL_DIR/stop.sh to stop it."
    fi
    echo ">> Update complete."
fi

echo
if [[ -n "${STORAGE_DIR:-}" && ! -f "$STORAGE_DIR/.filey-users.json" ]]; then
    echo "First administrator account"
    echo "----------------------------"
    echo "v3.2.0 requires an admin account, and none exists yet. Create one with:"
    echo "  cd \"$INSTALL_DIR\" && sudo -u \"$SERVICE_USER\" env FILEY_STORAGE_DIR=\"$STORAGE_DIR\" \\"
    echo "    .venv/bin/python3 -m backend.auth create-admin <username>"
    echo
    echo "Alternatively set FILEY_SETUP_TOKEN in /etc/filey/filey.env, restart Filey,"
    echo "and POST the token to /api/auth/setup. Then remove the variable and restart."
    echo "After signing in, add client accounts under Settings -> Users."
    echo
fi
echo "=================================================="
echo " Filey updated successfully."
echo " Previous app code backed up to: $BACKUP_DIR"
echo "=================================================="
