# Filey Update — v3.2.0

Status: implemented
Builds on: v3.1.0 (custom libraries, linked/managed storage, search, safe relayout)

## Highlights

- **Accounts and roles.** Filey gains server-side access control with two roles:
  `admin` and `client`. Every API route is checked on the server; hiding buttons
  in the UI is a convenience only.
- **Session logins.** Username + password sign-in with signed, HTTP-only,
  `SameSite` session cookies. No open registration: the first admin is created
  locally during setup, and admins create further accounts.
- **Permission-based routes.** Each action maps to a named permission enforced by
  a `@require("<permission>")` decorator, so roles can be extended later without
  touching route code.
- **Admin audit log.** Every admin action (who, what, when) is appended to a
  log file.
- **Hardened transport.** CSRF protection on state-changing requests, an
  explicit CORS origin allow-list (replacing today's open `CORS(app)`), and login
  rate limiting. HTTPS is documented through a reverse proxy.
- **No new dependencies and no migration.** Users live in a JSON file in Filey's
  managed storage, behind a small `UserStore` interface so a SQLite-backed store
  can replace it later without changing routes.

## Why

Today the API is unauthenticated, binds to `0.0.0.0`, and allows every CORS
origin. Anyone on the network can delete files, change library roots, run
cleanup, or stop conversions. v3.2.0 closes that gap while keeping the
single-process, file-based design.

## Roles and permissions

| Role | Allowed |
|---|---|
| `client` | Browse, search, stream, download, view thumbnails/photos |
| `admin` | Everything a client can do, plus the actions below |

Admin-only permissions:

| Permission | Routes |
|---|---|
| `files.upload` | `POST /api/upload` |
| `files.edit` | `PATCH /api/files/<id>` (rename, icon, type) |
| `files.delete` | `DELETE /api/files/<id>` (including the linked-file `409` flow) |
| `library.manage` | `POST/DELETE /api/categories*`, `POST /api/library/scan`, `POST /api/categories/<id>/scan`, `categories` in `POST /api/settings` (including `confirm_relayout`) |
| `settings.manage` | `POST /api/settings` (name, storage, HLS limits), `POST /api/library/migrate` |
| `maintenance.run` | `POST /api/clean`, `POST /api/hls/clear`, `POST /api/hls/cancel`, `POST /api/files/<id>/hls/<action>` |
| `users.manage` | New `/api/users*` routes |

Client-readable routes (login required): `GET /api/files`, `GET /api/search`,
`GET /api/stats`, `GET /api/categories`, `GET /api/settings` (read-only view,
secrets and filesystem paths trimmed for clients), `/api/files/<id>/{view,
thumbnail,stream,preview,download}`, and the HLS playlist/segment routes.

Public routes (no login): `GET /api/health`, `GET /api/discovery`, static
assets, `POST /api/auth/login`.

Optional later: a per-user `upload` grant for clients. The decorator model makes
this a data change, not a code change.

## Data model

Stored in `<STORAGE_DIR>/.filey-users.json` (mode `0600`):

```json
{
  "version": 1,
  "users": {
    "u_3f9c…": {
      "username": "alice",
      "role": "admin",
      "password_hash": "<argon2/scrypt hash>",
      "created": "2026-11-04T12:00:00",
      "disabled": false
    }
  },
  "secret": "<random session-signing key>"
}
```

- Passwords are hashed with `werkzeug.security` (scrypt), already installed with
  Flask — no new dependency.
- The session-signing secret is generated on first run and stored in this file;
  rotating it signs everyone out.
- The audit log is `<STORAGE_DIR>/.filey-audit.log`, one JSON object per line
  (append-only).

## Backend changes

- `backend/auth.py` (new)
  - `UserStore` interface (`get`, `list`, `create`, `update`, `delete`,
    `verify_password`) with a JSON implementation.
  - Safe persistence: process-wide lock around read-modify-write; write a temp
    file in the same directory, `fsync`, then `os.replace`; enforce `0600`.
  - `ROLE_PERMISSIONS` map and `require(permission)` decorator. Responds `401`
    when unauthenticated and `403` when the role lacks the permission.
  - Session helpers using Flask's signed cookie sessions
    (`HttpOnly`, `SameSite=Lax`, `Secure` when served over HTTPS).
  - CSRF token issued at login and required (header) on `POST/PATCH/DELETE`.
  - Login rate limiting (per username + per IP, in memory, with backoff).
  - `audit(event, **details)` writes to the audit log.
- `server.py`
  - Load the user store at start; refuse to serve admin routes until at least one
    admin exists.
  - Decorate every route per the permission table above.
  - New auth routes: `POST /api/auth/login`, `POST /api/auth/logout`,
    `GET /api/auth/me` (current user, role, CSRF token).
  - New user routes (admin): `GET/POST /api/users`,
    `PATCH/DELETE /api/users/<id>` (change role, reset password, disable).
    Guards: cannot delete or demote the last enabled admin; cannot disable
    yourself.
  - Replace `CORS(app)` with an explicit allow-list from `FILEY_CORS_ORIGINS`
    (default: same origin only).
  - Audit-log all `files.*`, `library.*`, `settings.*`, `maintenance.*`, and
    `users.*` actions, plus failed logins.
- `backend/config.py`
  - `ALLOWED_KEYS` unchanged; auth settings come from environment variables and
    the users file, not `.filey-config.json`.
- First-admin bootstrap (no open registration)
  - `python3 -m backend.auth create-admin <username>` prompts for a password and
    creates the first admin locally.
  - Alternative for headless installs: `install.sh` generates a one-time setup
    token, printed once, accepted only by `POST /api/auth/setup` while no admin
    exists.

## Frontend changes

- `static/js/components/login.js` (new): sign-in view; shown when `/api/auth/me`
  returns `401`.
- `static/js/app.js`
  - Load the current user before rendering; store the CSRF token and send it on
    every state-changing request (shared `apiFetch` wrapper).
  - Handle `401` (return to login) and `403` (notify "not allowed").
  - Hide admin-only controls for clients: Upload, Clean library, Stop all
    conversions, Settings link, and the file menu's Rename/Delete. This is a
    convenience; the server remains the source of truth.
- `static/js/components/settings.js`: new **Users** section for admins (list,
  add, change role, reset password, disable/delete).
- `static/js/components/navbar.js`: account control (name, sign out).
- `static/js/app.js` Info page: new **Accounts and roles** section explaining
  what clients and admins can do.

## Configuration

| Variable | Purpose | Default |
|---|---|---|
| `FILEY_CORS_ORIGINS` | Comma-separated allowed origins | same origin only |
| `FILEY_SESSION_HOURS` | Session lifetime | `12` |
| `FILEY_COOKIE_SECURE` | Force `Secure` cookies (set behind HTTPS) | auto-detect |
| `FILEY_LOGIN_MAX_ATTEMPTS` | Failed logins before lockout window | `5` |

`install.sh` documents these in the environment template and prints the
first-admin instructions.

## HTTPS

Run Filey behind a reverse proxy (Caddy or nginx) terminating TLS and forwarding
to `127.0.0.1:<FILEY_PORT>`. Set `FILEY_COOKIE_SECURE=1`. Document a minimal
Caddyfile in `release/INSTALL.md`. Also bind to `127.0.0.1` when a proxy is in
front (make the host configurable; it is currently hard-coded to `0.0.0.0`).

## Backward compatibility

- Fresh installs and upgrades require creating an admin before the UI is usable.
  Until an admin exists, the server answers admin and login-required routes with
  a clear "setup required" response and the UI shows setup instructions.
- Media data (UUID pointers, caches, categories, config) is untouched. No storage
  migration.
- API clients that previously called the API unauthenticated must sign in
  (session cookie + CSRF header). `GET /api/health` and `GET /api/discovery`
  stay public so discovery and uptime checks keep working.

## SQLite: deferred, by design

The JSON store is sufficient for a single process with a handful of users. Move
to SQLite only if one of these appears:

- persistent login rate-limit counters or a session revocation list,
- multiple server processes (e.g. gunicorn workers),
- many users, or per-user data (favourites, history, playlists),
- a need for a versioned, evolving schema.

`UserStore` keeps the routes and decorator independent of storage, so the swap
is local to `backend/auth.py`. The media pointer index stays as-is; moving it is
a separate decision.

## Files to change

```
backend/auth.py             (new)
backend/config.py           (env docs only)
server.py
static/js/app.js
static/js/components/login.js     (new)
static/js/components/navbar.js
static/js/components/settings.js
static/css/components/settings.css
static/css/components/navbar/actions.css
install.sh                  (env template, first-admin instructions)
update.sh                   (print first-admin note on upgrade)
release/INSTALL.md          (accounts, roles, reverse proxy / HTTPS)
```

## Verification plan

- Unit: password hashing/verification; permission map (each role × each route);
  last-admin guards; atomic write and `0600` mode; lock under concurrent writes;
  rate-limit window.
- API matrix: for every route, call as anonymous, client, and admin and assert
  `401` / `403` / success; confirm the linked-delete `409` flow and
  `confirm_relayout` still work for admins and are blocked for clients.
- CSRF: state-changing requests without the token are rejected; with it they
  succeed. CORS: disallowed origins receive no CORS headers.
- Sessions: expiry, logout, secret rotation signs users out, disabled user is
  rejected on the next request.
- Streaming/HLS: playback and thumbnails work for clients (cookie auth on media
  requests) with no regression in seeking or segment loading.
- Browser: login flow, client view hides admin controls, admin sees the Users
  section, `401` returns to the login view.
- Audit: each admin action and each failed login produces one log line.
- `python3 -m compileall` and `node --check` on changed files.

## Upgrading

```bash
unzip filey-release.zip -d filey-release
cd filey-release
sudo ./update.sh
python3 -m backend.auth create-admin <username>
```

Storage data is never touched by the updater. Restart the service after creating
the first admin, then sign in and add client accounts from **Settings → Users**.

## Implementation notes

Implemented in `backend/auth.py`, `server.py`, the login/account UI, the
installer/updater, and the new `tests/test_auth.py` suite (29 stdlib `unittest`
tests). Deviations and additions from the specification:

- Session signing uses a small custom `SecureCookieSessionInterface` that reads
  the secret from the users store for every request. Rotating the secret in
  `.filey-users.json` invalidates existing cookies immediately, without a
  restart.
- CSRF enforcement applies to authenticated `POST`/`PATCH`/`DELETE` requests.
  `POST /api/auth/login` and `POST /api/auth/setup` are exempt because no
  authenticated session exists yet.
- Added `FILEY_LOGIN_WINDOW_SECONDS` (default `900`), `FILEY_HOST`, and
  `FILEY_TRUST_PROXY` (Werkzeug `ProxyFix` for reverse proxies) alongside the
  documented settings. `FILEY_SETUP_TOKEN` may be supplied via the environment
  or a `.filey-setup-token` file in the storage directory.
- `install.sh` writes a generated `FILEY_SETUP_TOKEN` to `/etc/filey/filey.env`
  and prints it once with the setup instructions. Removing it after the first
  admin exists is documented.
- HLS start/status/playlist/segment routes require `files.read`, so clients can
  play and trigger on-demand conversion. Cancelling, clearing caches, and
  conversion actions require `maintenance.run`.
- The route-to-permission map lives in `backend/auth.ROUTE_PERMISSIONS`; the test
  suite enumerates `app.url_map` and fails if a route is neither public nor
  decorated.
- Audit events use endpoint identifiers (for example `settings_post`) plus
  `login.success`, `login.failed`, `login.locked`, `logout`, `setup.failed`, and
  `user.create`.
- Client settings responses omit `storage_dir`, `candidates`, `hls`, and each
  category's filesystem `root`; admins still receive the full payload.
- Automated verification is the Flask test-client suite plus `python3 -m
  compileall -q backend server.py tests` and `node --check` on the changed
  JavaScript. A headless Firefox smoke test also covered anonymous → login,
  admin/client sign-in, admin upload and user creation, client `403` on
  `/api/users`, hidden admin controls and file-menu actions, sign-out, the Info
  accounts section, and responsive layouts at 1280 and 760 px. Headless Firefox
  clamps its window to 500 px, so the 390 px phone layout and full playback /
  lockout interaction checks still need a real device or browser pass.

Run the automated suite from the project root:

```bash
python3 -m unittest discover -s tests -v
```

## Rollback

`update.sh` writes a per-update backup to `<install-dir>.bak-<timestamp>`.
Rolling back to v3.1.0 restores the unauthenticated API; the users and audit
files are ignored by v3.1.0 and can be left in place.
