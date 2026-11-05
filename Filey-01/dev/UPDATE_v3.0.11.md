# Filey Update — v3.0.11

Release package: `filey-release.zip`
Build date: 2026-09-22

## Highlights

- **Bounded on-demand HLS transcoding memory.** A single `ffmpeg` conversion
  (libx264 CPU fallback) could previously grow to multi-GB RSS because of
  ffmpeg's unbounded default thread count and look-ahead frame buffer. v3.0.11
  caps threads and look-ahead, applies a hard address-space limit (`RLIMIT_AS`)
  to every conversion worker, and limits how many conversions run at once.
- **New Settings page section — Transcoding / HLS.** All limits are adjustable
  from the web UI and apply to the next conversion without a server restart.
- **Settings API extended** — `GET /api/settings` now returns the active HLS
  limits (plus defaults, valid ranges, and presets); `POST /api/settings`
  accepts and validates an `hls` block.
- **UI fix** — the Settings save button text was light-on-light because the
  `--surface` CSS variable was referenced but never defined; it is now defined
  in `main.css`.

## Changes

### Backend

- `backend/config.py`
  - `.filey-config.json` can now store an `hls` block (whitelisted key).
  - New `validate_hls_settings()` with ranges:
    `concurrency` 1–32, `rlimit_mb` 0 or 512–32768, `x264_threads` 1–64,
    `rc_lookahead` 0–64, `preset` one of `ultrafast … veryslow`.
  - `save_config()` persists the `hls` block alongside the existing keys.
- `backend/hls_project26.py`
  - `effective_hls_settings()` resolves limits per storage root with
    precedence **config block → environment variable → shipped default**,
    read through on every conversion start (no restart required).
  - `_x264_tune()` adds `-threads`, `-x264-params rc-lookahead=…`, and an
    optional `-preset` to the libx264 CPU fallback. VAAPI/QSV commands are
    unchanged.
  - `_rlimit_preexec()` applies a hard `RLIMIT_AS` cap to each child `ffmpeg`.
    An undersized cap fails that attempt cleanly and falls back through the
    existing encoder chain instead of spiking memory.
  - `HlsManager` gained a concurrency gate (blocking `Condition` + live-process
    counter). A slot is held for the whole attempt and released in `finally`,
    covering success, encoder fallback, superseded, and paused paths.
  - `HlsManager.__init__` accepts `config_root` (path to the storage root that
    holds `.filey-config.json`).
  - Shipped defaults: concurrency `2`, memory cap `4096` MB, threads `4`,
    look-ahead `24`, preset `default` (none).
- `server.py`
  - `hls_settings_payload()`: `GET /api/settings` returns `hls` with
    `values`, `defaults`, `limits`, and `presets`.
  - `POST /api/settings` accepts an optional `hls` object, validates it, and
    writes it to the mounted storage root's config.
  - HlsManager is created with the correct `config_root`.
  - Fixed a missing `import time` that would crash the HLS segment-wait
    endpoints (`/api/hls/<file_id>/<path:segment>` and
    `/api/files/<file_id>/hls/<segment>`) with a `NameError` on first hit.

### Frontend

- `static/js/components/settings.js`
  - New **Transcoding / HLS** card with inputs for max concurrent conversions,
    per-conversion memory cap (MB, `0` = off), x264 threads, x264 look-ahead,
    and an x264 preset selector.
  - `setData({ hls })` populates the fields (including min/max from the API
    ranges) and `collectHls()` builds the payload to save.
- `static/js/app.js`
  - Stores `state.hls` from `GET /api/settings`, passes it into the Settings
    view, and wires `onSaveHls` to POST the new limits with success/error
    feedback.
- `static/css/components/settings.css`
  - Styling for `input[type=number]` inside `.settings-field` (mirrors the
    select styling) and spacing for the save button.
- `static/css/main.css`
  - **Bug fix:** `--surface` was used by `settings.css` but never defined,
    making the Settings button text inherit the light foreground color on the
    light button background (and leaving field backgrounds unset). Added
    `--surface: #111`, matching the existing dark-surface theme.

### Environment defaults (documented in `install.sh` env template and
`INSTALL.md`)

| Variable | Meaning | Default |
|---|---|---|
| `FS_HLS_CONCURRENCY` | Max simultaneous `ffmpeg` conversions | `2` |
| `FS_HLS_RLIMIT_MB` | Hard memory cap per conversion (MB, `0` = off) | `4096` |
| `FS_X264_THREADS` | libx264 threads (CPU fallback encoder) | `4` |
| `FS_X264_LOOKAHEAD` | libx264 look-ahead frame buffer | `24` |
| `FS_X264_PRESET` | libx264 preset (empty = default) | empty |

The `hls` block in `.filey-config.json` (set from the Settings page) takes
precedence over these variables when present. See `INSTALL.md` for the full
table and an example config.

## Files changed

```
static/css/components/settings.css
static/js/app.js
static/js/components/settings.js
backend/config.py
backend/hls_project26.py
server.py
static/css/main.css
install.sh
```

## Verification performed

- 18/18 automated checks: settings validation, x264 flag construction,
  config-vs-env precedence, concurrency capped at 1 with two queued
  conversions, 64 MB `RLIMIT` → clean fail-fast with slot release,
  4096 MB → conversion succeeds.
- `python3 -m py_compile` and `node --check` pass on all changed files.
- Live API smoke test: `GET /api/settings` returns the `hls` payload,
  `POST` persists valid values and rejects invalid ones (`400`).

## Upgrading

On an existing installation, run the bundled updater from an extracted copy of
this release:

```bash
unzip filey-release.zip -d filey-release
cd filey-release
sudo ./update.sh
```

Existing transcoding limits (if any) were not shipped before this release; the
server starts with the shipped defaults, which can then be adjusted from
**Settings → Transcoding / HLS**.