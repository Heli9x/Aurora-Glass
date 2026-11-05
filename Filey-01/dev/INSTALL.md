# Installing Filey on Debian/Ubuntu

This package contains everything needed to install and run Filey (the
media library platform) on a Debian-based Linux system.

## Contents

- `install.sh` — interactive installer script (fresh install)
- `update.sh` — interactive updater script (upgrades an existing install)
- `app/` — the Filey application (backend, static frontend, server)

## Requirements

- A Debian or Debian-derived system (Debian, Ubuntu, etc.)
- Root access (`sudo`)
- Internet access to install `python3`, `python3-venv`, `python3-pip` and `ffmpeg` via `apt`

## Install

1. Unzip the release package:
   ```bash
   unzip filey-release.zip -d filey-release
   cd filey-release
   ```
2. Run the installer as root:
   ```bash
   sudo ./install.sh
   ```
3. Answer the questionnaire:
   - **Installation directory** — where the app files and Python virtual environment are placed (default `/opt/filey`).
   - **System user to run Filey as** — a dedicated/unprivileged user is recommended (default is the user who invoked `sudo`, or `filey`).
   - **Media storage directory** — where uploaded/scanned media and the library index live (default `/run/media/<user>/FS-STORAGE`). Point this at an external drive or a large data volume if desired.
   - **Platform display name** — the name shown in the web UI.
   - **Port** — the TCP port Filey listens on (default `9100`).
   - **Install as a systemd service** — if yes, Filey starts automatically on boot and can be managed with `systemctl`.
   - **Start now** — start Filey immediately after installation.

The installer will:
- Install required system packages (`python3`, `python3-venv`, `python3-pip`, `ffmpeg`).
- Create the target user if it doesn't already exist.
- Copy the application into the installation directory and create a Python virtual environment with the required dependencies.
- Create the media storage directory and write the initial platform configuration.
- Write `/etc/filey/filey.env` with a one-time `FILEY_SETUP_TOKEN` and print first-admin instructions.
- Optionally register and enable a `filey.service` systemd unit.

## After installation

Open `http://<server-ip>:<port>` (default port `9100`) in a browser.

### First administrator account

Filey has no open registration. Until an administrator exists, the web UI shows
**Setup required** and protected API routes return `503 setup required`.

Create the first admin in one of two ways:

**From a terminal on the server** (the password is prompted and not echoed):

```bash
cd /opt/filey
sudo -u <service-user> env FILEY_STORAGE_DIR=<storage-dir> \
  .venv/bin/python3 -m backend.auth create-admin <username>
sudo systemctl restart filey
```

**With the one-time setup token** printed by `install.sh` (also stored as
`FILEY_SETUP_TOKEN` in `/etc/filey/filey.env`):

```bash
curl -X POST http://127.0.0.1:9100/api/auth/setup \
  -H 'Content-Type: application/json' \
  -d '{"token":"<setup-token>","username":"admin","password":"choose-a-strong-password"}'
```

The setup endpoint only works while no admin exists. After the admin is created,
remove `FILEY_SETUP_TOKEN` from `/etc/filey/filey.env` and restart Filey
(`sudo systemctl restart filey`). Then sign in and add further accounts under
**Settings → Users**.

### Accounts and roles

- **client** — can browse, search, stream, download, and view thumbnails/photos.
- **admin** — everything a client can do, plus upload, rename/delete, manage
  libraries, change settings, run maintenance, and manage users.

Only admins see the Settings page and the upload, clean, stop-conversion, rename,
and delete controls. The server enforces the same rules: hiding a button is never
the only protection. Each account has a username, role, and password; admins can
change roles, reset passwords, disable accounts, and delete users from
**Settings → Users**. The last enabled admin cannot be deleted or demoted.

Sessions are signed, HTTP-only, `SameSite=Lax` cookies. State-changing API
requests also require the CSRF token issued at sign-in. Failed logins are rate
limited (five attempts per username/IP in a 15-minute window by default).

### Accounts and session settings

Set these in `/etc/filey/filey.env`, then restart Filey:

| Variable | Purpose | Default |
|---|---|---|
| `FILEY_SESSION_HOURS` | Session lifetime in hours | `12` |
| `FILEY_LOGIN_MAX_ATTEMPTS` | Failed logins before the lockout window | `5` |
| `FILEY_LOGIN_WINDOW_SECONDS` | Lockout window in seconds | `900` |
| `FILEY_COOKIE_SECURE` | Force `Secure` session cookies (use behind HTTPS) | auto-detect |
| `FILEY_CORS_ORIGINS` | Comma-separated browser origins allowed to call the API | same origin only |
| `FILEY_HOST` | Bind address | `0.0.0.0` |
| `FILEY_TRUST_PROXY` | Trust `X-Forwarded-*` from a local reverse proxy (`1`) | off |
| `FILEY_SETUP_TOKEN` | One-time first-admin setup token | unset |

The user database and audit log live in the storage directory as
`.filey-users.json` (mode `0600`) and `.filey-audit.log`. Back up the users file
if you want to preserve accounts across storage moves.

### Managing the systemd service

```bash
sudo systemctl status filey     # check status
sudo systemctl restart filey    # restart
sudo systemctl stop filey       # stop
sudo systemctl disable filey    # disable auto-start
```

Logs can be viewed with:

```bash
journalctl -u filey -f
```

### Configuration files

- `/etc/filey/filey.env` — runtime environment variables (`FILEY_PORT`, `FILEY_STORAGE_DIR`, account/session settings). Edit and run `sudo systemctl restart filey` to apply changes.
- `<storage-dir>/.filey-config.json` — platform name, storage directory, and transcoding limits, also editable from the in-app Settings page.

### HLS / transcoding resource settings

On-demand HLS conversion (for formats the browser cannot decode, e.g. MKV) runs `ffmpeg`. Filey bounds how much memory and how many conversions can run at once. All of these are adjustable from **Settings → Transcoding / HLS** in the web UI and are stored under an `hls` block in `.filey-config.json`; changes apply to the next conversion, no restart needed.

| Setting | Meaning | Default | Range |
|---|---|---|---|
| `concurrency` | Max simultaneous `ffmpeg` conversions | 2 | 1–32 |
| `rlimit_mb` | Hard memory cap per conversion (MB); `0` disables | 4096 | 0 or 512–32768 |
| `x264_threads` | libx264 threads (applies to the CPU fallback encoder) | 4 | 1–64 |
| `rc_lookahead` | libx264 look-ahead frame buffer | 24 | 0–64 |
| `preset` | libx264 preset (e.g. `veryfast`); empty = default | default | ultrafast … veryslow |

Example `.filey-config.json`:

```json
{
  "platform_name": "Filey",
  "storage_dir": "/path/to/fs-storage",
  "hls": {
    "concurrency": 4,
    "rlimit_mb": 8192,
    "x264_threads": 8,
    "rc_lookahead": 24,
    "preset": "veryfast"
  }
}
```

Servers with ample RAM/CPU can raise `concurrency`, `rlimit_mb`, and `x264_threads` past the shipped defaults from the UI.

Each setting has an equivalent environment variable (used as the default when the `hls` block is absent; the config block, when present, takes precedence): `FS_HLS_CONCURRENCY`, `FS_HLS_RLIMIT_MB`, `FS_X264_THREADS`, `FS_X264_LOOKAHEAD`, `FS_X264_PRESET`. Set them in `/etc/filey/filey.env` and restart to apply.

### Libraries and storage modes

Filey keeps a small UUID **index** (pointer files) and generated **caches** in
the media storage directory (`<storage-dir>/<category>/`), but the actual media
files can live anywhere. Manage this from **Settings → Libraries**.

- **Built-in libraries** — `movies`, `music`, `photos`, `other`. With no
  configuration their files stay in `<storage-dir>/storage/`, exactly like
  earlier versions.
- **Managed mode** — Filey copies uploads into the library's folder and owns
  them. Point a library at an external drive to keep large files off the system
  disk.
- **Linked mode** — Filey indexes existing files in place without moving them.
  Use **Scan** to index a folder (existing files are matched by extension), and
  deleting a linked file asks whether to remove it from Filey only or delete the
  original permanently.
- **Custom libraries** — create one on demand (for example an "AI files"
  library for `.gguf`). A library is described by a label, a list of file
  extensions, a root folder, and a mode. Unrecognised uploads fall back to the
  `other` library.

The chosen folders appear as candidates from your operating system's native
media directories (Videos/Music/Pictures) and as a free-text path field. Caches
always stay in Filey's managed space, so linked or read-only folders never need
write access.

Example category block in `.filey-config.json`:

```json
{
  "categories": {
    "movies": { "label": "Movies", "root": "/mnt/media/videos", "mode": "managed", "extensions": [".mp4", ".mkv"] },
    "ai-files": { "label": "AI files", "root": "/mnt/models", "mode": "linked", "extensions": [".gguf", ".safetensors"] }
  }
}
```

Changing a library's storage directory sets `requires_restart`; caches are
migrated into the new per-category layout automatically on the next start (a
**Migrate caches** prompt also appears after saving).

### Search

The top navigation bar has a search box covering the whole index. Press `/` to
focus it and `Esc` to clear. Search matches the display name, original filename,
tags, library label, and file extension (all terms must match), and composes
with sort, type filter, and pagination. Because the index is centralised, search
also finds files stored in native and linked folders.

### Manual start/stop (non-systemd installs)

From the installation directory:

```bash
./start.sh   # starts the server in the foreground
./stop.sh    # stops a running server bound to the configured port
```

### HTTPS with a reverse proxy

Run Filey behind Caddy or nginx that terminates TLS and forwards to
`127.0.0.1:<port>`. In `/etc/filey/filey.env` set:

```bash
FILEY_HOST=127.0.0.1
FILEY_TRUST_PROXY=1
FILEY_COOKIE_SECURE=1
```

Minimal Caddyfile (Caddy obtains and renews the certificate automatically):

```caddyfile
filey.example.com {
    reverse_proxy 127.0.0.1:9100
}
```

For nginx, forward `Host`, `X-Forwarded-For`, and `X-Forwarded-Proto`, and allow
large uploads (`client_max_body_size`). Do not expose Filey directly to the
internet without TLS: passwords and session cookies would travel in clear text.

## Updating an existing installation

To apply a newer release package to a system that already has Filey installed:

1. Unzip the new release package on the target machine.
2. Run the updater as root:
   ```bash
   sudo ./update.sh
   ```
3. Confirm (or correct) the detected installation directory and service user.

`update.sh` will:
- Stop the running service (systemd, or a foreground process via `stop.sh`).
- Back up the current application code to `<install-dir>.bak-<timestamp>` (media storage is never touched).
- Copy in the new `server.py`, `backend/`, `static/`, `index.html`, `requirements.txt`, `start.sh`, `stop.sh`.
- Upgrade Python dependencies in the existing virtual environment.
- Re-apply `render`/`video` group access for GPU (VAAPI) transcoding.
- Restart the service (or relaunch it in the foreground).
- Print first-admin instructions when upgrading from a pre-v3.2.0 install.

After upgrading to v3.2.0, create the first admin as described in
[First administrator account](#first-administrator-account), then add client
accounts under **Settings → Users**. Existing media, categories, and caches are
not changed.

## Uninstalling

```bash
sudo systemctl disable --now filey
sudo rm -f /etc/systemd/system/filey.service
sudo rm -rf /etc/filey
sudo rm -rf /opt/filey   # or your chosen installation directory
```

Your media storage directory is left untouched so your files are not deleted.
