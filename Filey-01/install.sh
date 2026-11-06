#!/bin/bash
# Filey installer for Debian/Ubuntu systems.
# Run as root (or via sudo). Interactively asks for install preferences,
# installs system dependencies, sets up a Python virtualenv and an
# optional systemd service.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_SRC="$SCRIPT_DIR/app"

if [[ $EUID -ne 0 ]]; then
    echo "This installer must be run as root, e.g.: sudo ./install.sh" >&2
    exit 1
fi

if [[ ! -d "$APP_SRC" ]]; then
    echo "Cannot find application files at $APP_SRC (expected alongside install.sh)." >&2
    exit 1
fi

echo "=================================================="
echo " Filey installer"
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

DEFAULT_USER="${SUDO_USER:-filey}"

INSTALL_DIR=$(ask "Installation directory" "/opt/filey")
SERVICE_USER=$(ask "System user to run Filey as" "$DEFAULT_USER")
DEFAULT_STORAGE="/run/media/$SERVICE_USER/FS-STORAGE"
STORAGE_DIR=$(ask "Media storage directory (created if missing)" "$DEFAULT_STORAGE")
PLATFORM_NAME=$(ask "Platform display name" "Filey")
PORT=$(ask "Port to serve on" "9100")
ENABLE_SERVICE=$(ask_yn "Install as a systemd service (auto-start on boot)?" "y")
START_NOW=$(ask_yn "Start Filey now after installation?" "y")

echo
echo "--- Summary ---"
echo "Install directory : $INSTALL_DIR"
echo "Run as user       : $SERVICE_USER"
echo "Storage directory : $STORAGE_DIR"
echo "Platform name     : $PLATFORM_NAME"
echo "Port              : $PORT"
echo "Systemd service   : $ENABLE_SERVICE"
echo "Start now         : $START_NOW"
echo
CONFIRM=$(ask_yn "Proceed with installation?" "y")
if [[ "$CONFIRM" != "y" ]]; then
    echo "Installation aborted."
    exit 0
fi

if ! id "$SERVICE_USER" &>/dev/null; then
    echo ">> Creating system user '$SERVICE_USER'"
    useradd --system --create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi

echo ">> Granting GPU (VAAPI) device access to '$SERVICE_USER'"
for grp in render video; do
    if getent group "$grp" &>/dev/null; then
        usermod -aG "$grp" "$SERVICE_USER"
    fi
done

echo ">> Installing system dependencies (python3, venv, pip, ffmpeg)"
apt-get update -y
apt-get install -y python3 python3-venv python3-pip ffmpeg

echo ">> Copying application files to $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
cp -a "$APP_SRC/." "$INSTALL_DIR/"

echo ">> Creating Python virtual environment"
python3 -m venv "$INSTALL_DIR/.venv"
"$INSTALL_DIR/.venv/bin/pip" install --upgrade pip
"$INSTALL_DIR/.venv/bin/pip" install -r "$INSTALL_DIR/requirements.txt"

echo ">> Preparing storage directory $STORAGE_DIR"
mkdir -p "$STORAGE_DIR"
cat > "$STORAGE_DIR/.filey-config.json" <<EOF
{
  "platform_name": "$PLATFORM_NAME",
  "storage_dir": "$STORAGE_DIR"
}
EOF

chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR" "$STORAGE_DIR"

SETUP_TOKEN="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"

echo ">> Writing environment file /etc/filey/filey.env"
mkdir -p /etc/filey
cat > /etc/filey/filey.env <<EOF
FILEY_PORT=$PORT
FILEY_STORAGE_DIR=$STORAGE_DIR
# One-time token for POST /api/auth/setup. Remove this line once the first
# administrator exists, then restart Filey.
FILEY_SETUP_TOKEN=$SETUP_TOKEN
# Accounts and sessions:
#FILEY_SESSION_HOURS=12
#FILEY_LOGIN_MAX_ATTEMPTS=5
#FILEY_LOGIN_WINDOW_SECONDS=900
#FILEY_CORS_ORIGINS=https://filey.example.com
# Bind to loopback when a TLS reverse proxy (Caddy/nginx) is in front, and let
# Filey trust its X-Forwarded-* headers so session cookies get the Secure flag:
#FILEY_HOST=127.0.0.1
#FILEY_TRUST_PROXY=1
#FILEY_COOKIE_SECURE=1
# Optional HLS transcoding defaults (the in-app Transcoding / HLS
# settings under .filey-config.json override these when set):
#FS_HLS_CONCURRENCY=2
#FS_HLS_RLIMIT_MB=4096
#FS_X264_THREADS=4
#FS_X264_LOOKAHEAD=24
#FS_X264_PRESET=
EOF
chmod 640 /etc/filey/filey.env
chown root:"$SERVICE_USER" /etc/filey/filey.env

cat > /etc/filey/install.conf <<EOF
INSTALL_DIR=$INSTALL_DIR
SERVICE_USER=$SERVICE_USER
STORAGE_DIR=$STORAGE_DIR
EOF

chmod +x "$INSTALL_DIR/start.sh" "$INSTALL_DIR/stop.sh"

if [[ "$ENABLE_SERVICE" == "y" ]]; then
    echo ">> Installing systemd service"
    cat > /etc/systemd/system/filey.service <<EOF
[Unit]
Description=Filey media platform
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=/etc/filey/filey.env
ExecStart=$INSTALL_DIR/.venv/bin/python3 $INSTALL_DIR/server.py
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable filey.service
    if [[ "$START_NOW" == "y" ]]; then
        systemctl restart filey.service
        echo ">> Filey service started. Check status with: systemctl status filey"
    else
        echo ">> Service enabled but not started. Start it with: systemctl start filey"
    fi
else
    echo ">> Skipping systemd service setup."
    if [[ "$START_NOW" == "y" ]]; then
        echo ">> Starting Filey directly (foreground)."
        sudo -u "$SERVICE_USER" env FILEY_PORT="$PORT" FILEY_STORAGE_DIR="$STORAGE_DIR" "$INSTALL_DIR/start.sh" &
        echo ">> Filey launched in background (PID $!). Use $INSTALL_DIR/stop.sh to stop it."
    fi
fi

echo
echo "=================================================="
echo " Installation complete."
echo " Access Filey at: http://<this-machine-ip>:$PORT"
echo "=================================================="
echo
if [[ ! -f "$STORAGE_DIR/.filey-users.json" ]]; then
    echo "First administrator account"
    echo "----------------------------"
    echo "Filey has no accounts yet. Create the first admin in one of two ways:"
    echo
    echo "1. Complete setup from a terminal (password is prompted, not echoed):"
    echo "   cd \"$INSTALL_DIR\" && sudo -u \"$SERVICE_USER\" env FILEY_STORAGE_DIR=\"$STORAGE_DIR\" \\"
    echo "     .venv/bin/python3 -m backend.auth create-admin <username>"
    echo
    echo "2. Or POST this one-time setup token to /api/auth/setup:"
    echo "   $SETUP_TOKEN"
    echo "   curl -X POST http://127.0.0.1:$PORT/api/auth/setup \\"
    echo "     -H 'Content-Type: application/json' \\"
    echo "     -d '{\"token\":\"$SETUP_TOKEN\",\"username\":\"admin\",\"password\":\"choose-a-strong-password\"}'"
    echo
    echo "After the admin exists, remove FILEY_SETUP_TOKEN from /etc/filey/filey.env"
    echo "and restart Filey. Then sign in and add client accounts under Settings -> Users."
    echo
fi
