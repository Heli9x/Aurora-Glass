# Agent instructions — implement and test Filey v3.2.0

Spec: [`UPDATE_v3.2.0.md`](./UPDATE_v3.2.0.md) (read it fully first; it is the
source of truth). This file tells you **how** to build and verify it.

## Goal

Add accounts, session login, and role-based access control (`admin` / `client`)
to the Filey Flask app, enforced server-side on every API route, with a login
view and role-aware UI. No new dependencies, no SQLite, no changes to media
data (UUID pointers, caches, categories, config).

## Ground rules

- Work in `Filey-01/`. The repo root path contains a **space** (`Aurora _Glass`):
  always quote paths in shell commands.
- Make surgical changes. Do not refactor unrelated code or touch the v3.1.0
  behaviour (libraries, search, relayout, linked delete).
- Python deps are only `Flask`, `flask-cors`, `Werkzeug` (`requirements.txt`).
  Use `werkzeug.security` for hashing and Flask's signed cookie sessions. Do not
  add packages.
- The system may not have `python` or Flask installed. Use a throwaway venv:
  `python3 -m venv /tmp/filey-auth-venv && /tmp/filey-auth-venv/bin/pip install -q -r requirements.txt`.
  Delete it when finished.
- **Never test against `backend-data/`** (real data). Always set
  `FILEY_STORAGE_DIR` to a fresh temp directory.
- Do not use `pkill`/`killall`. Start servers in the background, record the PID,
  and stop with `kill <PID>`. Poll `/api/health` in a separate call.
- Create/edit files with the editor tools, not shell redirection.
- Keep code comments minimal; only where intent is non-obvious.

## Codebase orientation

- `server.py`: all routes (Flask app, `app.get/post/patch/delete`). Settings and
  category routes build on `backend/config.py` and `backend/media.py`.
- `static/js/app.js`: all client logic; many direct `fetch(`${API_BASE}/...`)`
  calls (also in `static/js/components/upload.js`, `rename.js`, `media.js`).
  `API_BASE` is in `static/js/config.js`.
- Settings UI: `static/js/components/settings.js` + `static/css/components/settings.css`.
- Navbar: `static/js/components/navbar.js` (`setLinks()`, search, actions).
- Info page text: `buildGuideSections()` in `static/js/app.js`.
- `index.html` loads scripts in order; new components must be added there.

## Implementation plan

Do the steps in order; run the quick checks after each.

### 1. `backend/auth.py` (new)

- `UserStore` interface (`get`, `get_by_username`, `list`, `create`, `update`,
  `delete`, `has_admin`, `verify_password`) and a `JsonUserStore` backed by
  `<STORAGE_DIR>/.filey-users.json` per the spec's data model.
- Persistence: module-level `threading.Lock` around read-modify-write; write a
  temp file in the same directory, `flush` + `os.fsync`, then `os.replace`;
  `os.chmod(path, 0o600)`. Corrupt/missing file → treat as empty store, never
  crash startup.
- Generate the session-signing secret on first run (`secrets.token_hex(32)`),
  stored in the users file.
- `ROLE_PERMISSIONS` map exactly as in the spec table (`client` has read-only
  permissions; `admin` has all). Put route→permission mapping in one place.
- `require(permission)` decorator: `401` JSON when no valid session, `403` JSON
  when the role lacks the permission, `503 {"error":"setup required"}` when no
  admin exists yet (except for the setup/health/static routes).
- CSRF: issue a token at login (kept in the session, also returned by
  `/api/auth/me`); require `X-CSRF-Token` on `POST/PATCH/DELETE` for logged-in
  sessions (login itself is exempt). Compare with `hmac.compare_digest`.
- Login rate limit: in-memory per `(username, ip)` with a window and lockout
  (`FILEY_LOGIN_MAX_ATTEMPTS`, default 5). Return `429` with a `Retry-After`.
  Always run a password hash check even for unknown users (avoid username
  enumeration timing) and return the same generic error.
- `audit(event, actor, **details)` appends one JSON line to
  `<STORAGE_DIR>/.filey-audit.log` (lock + append mode). Never log passwords or
  tokens.
- CLI: `python3 -m backend.auth create-admin <username>` (prompt with `getpass`,
  min length 8). Refuse to overwrite an existing user.

### 2. `server.py`

- Initialise the user store and `app.secret_key`/session config
  (`HttpOnly`, `SameSite=Lax`, lifetime from `FILEY_SESSION_HOURS`, `Secure` per
  `FILEY_COOKIE_SECURE`).
- Replace `CORS(app)` with an allow-list from `FILEY_CORS_ORIGINS` (default: no
  cross-origin; `supports_credentials` only for listed origins).
- Add routes: `POST /api/auth/login`, `POST /api/auth/logout`,
  `GET /api/auth/me`, `POST /api/auth/setup` (only while no admin exists, one-time
  token), and `GET/POST /api/users`, `PATCH/DELETE /api/users/<id>` (admin).
  Guards: cannot delete/demote/disable the last enabled admin; cannot disable or
  delete yourself; disabled users are rejected on their next request.
- Decorate **every** existing route per the permission table. Keep
  `/api/health`, `/api/discovery`, `/`, and static files public. For client
  `GET /api/settings`, return a trimmed view (no `storage_dir`, `candidates`,
  HLS internals or filesystem paths); admins get the full payload.
- Audit-log all admin actions and failed logins.
- Make the bind host configurable (`FILEY_HOST`, default unchanged `0.0.0.0` to
  stay backward compatible).
- Add a startup log line when no admin exists, telling the operator how to create
  one.

### 3. Frontend

- Add an `apiFetch(path, options)` wrapper (in `static/js/config.js` or a small
  new file loaded before `app.js`) that: sends `credentials: 'same-origin'`,
  adds `X-CSRF-Token` for non-GET requests, and on `401` shows the login view /
  on `403` calls `notify.show('Not allowed')`. **Replace every direct
  `fetch(`${API_BASE}...`)`** (grep for `API_BASE` and `fetch(` in
  `static/js`), including upload (multipart: do not set `Content-Type`).
- `static/js/components/login.js` (new, add to `index.html`): username/password
  form, shown when `GET /api/auth/me` returns `401`; also a "setup required"
  message state. Reuse existing modal/settings styling; no new design language.
- `app.js`: fetch `/api/auth/me` before the first render; keep `state.user` and
  CSRF token; hide admin-only controls for clients (Upload, Clean library, Stop
  all conversions, Settings link, file-menu Rename/Delete). This is
  convenience only.
- Settings **Users** section (admin only): list, add (username, role,
  password), change role, reset password, disable/delete, with server error
  messages shown inline. Follow the existing settings form layout (see the
  Libraries form: responsive grid, no overlapping hints).
- Navbar account control (username + sign out).
- Info page: add an **Accounts and roles** section.
- Verify `<video>`/`<audio>`/hls.js/thumbnail requests carry the session cookie
  (same-origin, so they do by default). Do **not** put tokens in query strings.

### 4. Docs and install scripts

- `install.sh`: document the new env vars; print first-admin instructions.
- `update.sh`: print the first-admin note after an upgrade.
- `release/INSTALL.md` (and `dev/INSTALL.md`): accounts, roles, first-admin
  creation, reverse proxy/HTTPS example (Caddyfile), `FILEY_*` variables.
- Update `release/UPDATE_v3.2.0.md` and `dev/UPDATE_v3.2.0.md` (keep identical):
  change status to implemented and add an *Implementation notes* section for any
  deviation from the spec.

## Testing

There is no existing test suite. Create `tests/test_auth.py` (stdlib `unittest`
+ Flask test client; no new deps) and run it with
`/tmp/filey-auth-venv/bin/python -m unittest discover -s tests -v`. Each test
class builds a fresh temp `FILEY_STORAGE_DIR` and re-imports/reconfigures the
app so state never leaks between tests.

### Unit tests

- Password hash/verify; wrong password; unknown user takes the same path.
- User file: created with mode `0600`; atomic replace leaves no `.tmp`; corrupt
  file → empty store; concurrent `create` calls (threads) never corrupt the file.
- `ROLE_PERMISSIONS`: every permission in the spec table is assigned to `admin`;
  `client` has none of the admin-only ones.
- Last-admin guard; self-disable/delete guard.
- Rate limit: N failed attempts → `429`; succeeds again after the window
  (use an injectable clock).

### API matrix (most important)

Enumerate routes from `app.url_map` and assert there is **no** route that is
neither on the public allow-list nor decorated (fail the test if a new
unprotected route appears). Then, for each protected route, call as anonymous,
client, and admin:

| Case | Expect |
|---|---|
| anonymous on protected route | `401` |
| client on admin-only route | `403` |
| admin on admin-only route | normal success / expected status |
| client on client-readable route | success |
| no admin exists yet | `503 setup required` on protected routes; `/api/health`, `/api/discovery`, `/` still `200` |

Also assert v3.1.0 behaviour is intact for admins: linked delete returns `409`
then works with `?delete_source=`, `POST /api/settings` with a changed root
returns `409 needs_confirmation` until `confirm_relayout: true`, search/filter
composition, custom category creation with an icon.

### Security tests

- CSRF: logged-in `POST/PATCH/DELETE` without `X-CSRF-Token` → `403`; with a
  wrong token → `403`; with the right token → success. Login is exempt.
- CORS: request with a disallowed `Origin` gets no `Access-Control-Allow-Origin`;
  an allow-listed origin does.
- Session: logout invalidates the cookie; a disabled user is rejected on the next
  request; rotating the secret signs everyone out; cookie has `HttpOnly` and
  `SameSite=Lax` (and `Secure` when configured).
- Client `GET /api/settings` contains no `storage_dir` / `candidates` / paths.
- No secrets in responses or the audit log (grep for the password and token used
  in tests).
- Audit log: one line per admin action and per failed login, valid JSON each.
- Streaming/download for clients: `GET /api/files/<id>/stream` honours `Range`
  requests (`206`) with a session cookie; anonymous gets `401`.

### Browser verification

Start the server in the background against a temp storage dir
(`FILEY_STORAGE_DIR=/tmp/filey-auth-qa FILEY_PORT=19110`), create an admin with
the CLI, then use the browser tools:

1. Anonymous visit → login view (no library data visible).
2. Wrong password shows a generic error; repeated failures show the lockout.
3. Log in as admin → full UI; create a client user in Settings → Users.
4. Log in as client (separate browser context) → no Upload / Clean / Stop /
   Settings / Rename / Delete controls; browsing, search, playback and download
   still work (play a small audio/video fixture; confirm seeking works).
5. As client, call an admin route from the console (`fetch`) → `403`.
6. Sign out returns to the login view; the back button does not reveal data.
7. Check the Users section layout at ~1280, 760, and 390 px widths (no overlap or
   misalignment), and the Info page **Accounts and roles** text.

### Static checks

- `python3 -m compileall -q backend server.py tests`
- `node --check` on every changed JS file
- `git diff --check`
- grep to confirm no remaining direct `fetch(`${API_BASE}` calls bypass
  `apiFetch`.

## Definition of done

- All routes are either public (health, discovery, index, static, login/setup) or
  permission-protected; the route-coverage test enforces this.
- Unit, API-matrix, and security tests pass; browser checklist completed with no
  console errors beyond expected `401`/`403`.
- v3.1.0 features verified unchanged for admins.
- No dependency changes; no edits to existing media data; temp venv, temp
  storage, test servers, and temp files removed.
- Docs updated (INSTALL, update notes, Info page) and the two
  `UPDATE_v3.2.0.md` copies are identical.

## Common pitfalls

- Forgetting a route: new `@app.route`s added later must be covered by the
  coverage test.
- Multipart upload: setting `Content-Type` manually breaks the boundary; let the
  browser set it, but still send the CSRF header.
- Media elements cannot send custom headers, so media GETs must authenticate by
  cookie only (they are read-only, so no CSRF header is needed).
- Caching: `pageCache` in `app.js` must be cleared on login/logout/user change so
  one user's data is never shown to another.
- Do not log or return `password_hash` or the session secret anywhere.
- Hot reload of config: `.filey-users.json` is read through the store, not
  cached forever, so CLI-created admins work without restarting where feasible
  (otherwise document the restart).

## Report back

When finished, summarize: files changed, route→permission table as implemented,
test results (counts and commands), anything deferred, and any spec deviations
(also recorded in the update notes).
