# Filey Update — v3.1.0

Release package: `filey-release.zip`
Build date: 2026-10-11
Status: implemented (see [Implementation notes](#implementation-notes) for where
the build differs from the original specification)

## Highlights

- **Custom multimedia storage.** The actual media files (movies, music, photos,
  and any custom library) can now live in the OS's native folders (e.g.
  `~/Videos`, `~/Music`, `~/Pictures`) or any user-defined directory, instead of
  the single managed `storage/` folder.
- **UUID index and caches stay in Filey's managed space.** The UUID pointer
  system is unchanged — pointer files remain at `<STORAGE_DIR>/<type>/<uuid>.json`
  — and generated caches move out of `storage/` into a discreet per-UUID folder:
  `<STORAGE_DIR>/<media_type>/cache/<uuid>/`. Filey never writes its index or
  caches into native/user folders.
- **Event-driven libraries (categories).** Beyond the built-in movies / music /
  photos / other, users can create custom libraries on demand — for example an
  "AI files" library for `.gguf` / `.safetensors` — each with its own storage
  directory and extension rules. Custom categories are created only when the
  user asks; they are not seeded at install.
- **Two storage modes per library.** `managed` (Filey copies uploads into the
  chosen root and owns them) or `linked` (Filey indexes files already present
  without moving them). Deleting a linked file asks the user
  (**Remove from Filey** vs **Delete file permanently**).
- **Search.** A navbar search box queries the whole index — across every
  library and every storage root — by name, original filename, tags, type, and
  category, with server-side filtering that composes with sort and pagination.
  Because the UUID index is centralised, search covers files stored in native
  folders without scanning them.
- **Safe relayout.** Changing a library's root returns a move preview and is
  applied only on confirmation. Managed files are moved; linked files stay where
  they are and remain reachable. Defaults preserve today's behaviour exactly.
- **Custom libraries are first-class views.** Each custom library gets its own
  navbar link (`#<library-id>`), a category-filtered listing, and a
  user-chosen icon (any Remix Icon class) used for the library and its files.
- **Updated Info page.** The in-app guide documents search, libraries, managed
  vs linked storage, linked deletion, and root changes, and lists per-library
  file counts including custom libraries.

## Storage model

Three decoupled layers — identity and cache never leave Filey's managed space:

| Layer | Location | v3.1.0 change |
|---|---|---|
| Identity (UUID pointers) | `<STORAGE_DIR>/<type>/<uuid>.json` | Unchanged |
| Cache (webp, HLS) | `<STORAGE_DIR>/<type>/cache/<uuid>/` | Moved out of `storage/`; still managed |
| Binaries (actual files) | user/native dir per category | New — chosen by user or OS default |

`STORAGE_DIR` resolution (`resolve_storage_dir()` in `server.py`) is untouched.

## Concepts

### Categories

A **category** (library) describes a media type. Built-in four:
`movies`, `music`, `photos`, `other`. Custom categories are created on demand and
carry a label, a binary root, a mode, and optional extension/mime rules.

```json
"categories": {
  "movies":  { "label": "Movies",  "root": "/home/user/Videos",   "mode": "managed" },
  "music":   { "label": "Music",   "root": "/home/user/Music",    "mode": "managed" },
  "photos":  { "label": "Photos",  "root": "/home/user/Pictures", "mode": "managed" },
  "other":   { "label": "Other",   "root": null,                  "mode": "managed" },
  "ai-files":{ "label": "AI files","root": "/home/user/models",   "mode": "managed",
               "extensions": [".gguf", ".safetensors"], "icon": "ri-robot-2-line" }
}
```

- `root: null` → legacy managed `<STORAGE_DIR>/storage/` (backward compatible).
- Category id = slug of the label; reserved ids (`storage`, `cache`, built-ins)
  are rejected.
- Pointer dir: `<STORAGE_DIR>/<id>/`; cache dir: `<STORAGE_DIR>/<id>/cache/`.

### Pointer schema (additive, backward compatible)

Pointer files keep their path and keep `media_type`; new optional fields:

```json
{
  "media_type": "movies",
  "category": "movies",
  "root": "movies",
  "mode": "managed",
  "path": "Screencast_From_2026-09-04.mp4",
  "name": "Screencast_From_2026-09-04.mp4",
  "file_name": "Screencast_From_2026-09-04.mp4",
  "time_added": "2026-09-21 16:13:14.757668",
  "tags": [],
  "icon": "ri-file-3-line"
}
```

Resolution in `MediaLibrary._source_path()`:
- if the pointer has a `source_root` → `<source_root>/<path>` (see below);
- else if `record["root"]` is a configured category root → `<root>/<path>`;
- otherwise (legacy pointer, no `root`) → `<STORAGE_DIR>/<path>` (existing
  `backend-data` pointers keep working unchanged).

`source_root` is an optional, additive field written only when a **linked**
library's root is changed: it pins existing linked records to the folder they
were indexed from, so they keep resolving after the library's root moves. It is
never exposed through the public API.

### Search

Search runs over the centralised UUID index, so it covers files in every
library and every storage root without touching (or needing write access to) the
native folders.

- **Query shape.** Whitespace-separated terms, all must match (AND). Matching is
  case-insensitive and substring-based, with optional prefix boosting for name
  matches. Fields searched: `name`, `file_name` (`originalName`), `tags`,
  `media_type` / category label, and file extension.
- **Composition.** `q` combines with the existing `type` (library) filter,
  `sort`, and `page` / `per_page` so results paginate like any other listing.
- **No index files touched.** The query is answered from the already-scanned
  pointer set (`MediaLibrary._scanned`), invalidated on upload/edit/delete.

## Changes

### Backend

- `backend/config.py`
  - `ALLOWED_KEYS` gains `categories`.
  - New `validate_category_root(path, mode)` — `managed` roots must exist or be
    creatable and writable; `linked` roots must exist and be readable. Separate
    from `validate_storage_dir()`, which intentionally rejects non-empty
    directories and must not be used for native folders.
  - New `slugify_category()` with a reserved-name guard.
  - `load_config()` / `save_config()` persist the `categories` block.
- `backend/paths.py` (new)
  - `native_media_roots()` discovers OS defaults: Linux via
    `~/.config/user-dirs.dirs` (`XDG_VIDEOS_DIR`, `XDG_MUSIC_DIR`,
    `XDG_PICTURES_DIR`) falling back to `~/Videos`, `~/Music`, `~/Pictures`;
    macOS `~/Movies`, `~/Music`, `~/Pictures`; Windows `%USERPROFILE%\Videos`,
    `Music`, `Pictures`. No new third-party dependencies.
- `backend/search.py` (new)
  - `parse_query(raw)` normalises a search string into lowercase terms.
  - `match_record(record, terms, category_labels)` implements the AND/substring
    matching described under **Search**; `highlight(record, terms)` returns
    match ranges for the UI. Kept separate from `media.py` so matching rules can
    be unit-tested in isolation and reused by the API.
- `backend/media.py`
  - Replace the hard-coded `ALLOWED_TYPES` set with a category registry loaded
    from config; `read_files()` iterates category ids.
  - `_source_path()` gains the root-aware resolution above (legacy fallback
    preserved).
  - `ensure_storage()` creates pointer dirs and `<id>/cache/` only; it never
    creates directories inside native/user roots.
  - `infer_type()` consults category extension/mime rules before defaulting to
    `other`.
  - `add_upload()` writes the binary to the category's root (managed; suffix on
    collision) and writes the pointer with `category` / `root` / `mode`.
  - New `add_reference(category, abs_path)` indexes an existing file without
    moving it; dedupe by resolved absolute path (so a file indexed under an old
    root is not re-indexed after a root change) — one physical file maps to
    exactly one UUID.
  - New `scan(category)` indexes supported files under a linked root.
  - New `relayout_category(category, new_spec)` applies a confirmed root change:
    linked → pins existing records with `source_root`; managed → moves each file
    to the new root (collision-safe), rewrites the pointer, and rolls back
    moved files and pointer edits if any step fails.
  - New `search(query, media_type=None)` filters the scanned index via
    `backend/search.py`; results stay in the existing sort order and feed the
    same paginator, so search, type filter, sort, and paging compose.
  - `delete()`: `managed` → remove source + pointer (current behaviour);
    `linked` → `delete_source` flag: `True` deletes the file, `False` removes
    the pointer only, `None` signals "needs confirmation".
- `backend/photos.py`
  - Cache becomes `<STORAGE_DIR>/<category>/cache/<uuid>/full.webp` and
    `thumb.webp` (was `<STORAGE_DIR>/storage/_webp/<stem>_<mtime>.webp`).
  - Source resolution is injected (`media.source_path`) instead of a fixed
    `source_dir`.
- `backend/hls_project26.py`
  - `HlsManager` resolves cache per record: `<STORAGE_DIR>/<category>/cache/
    <uuid>[/<lang>]`. `ensure_hls()` / `_cache_dir()` take the category; the
    server passes `record["type"]`.
  - Sweeper, `run_cache_cleanup()`, `clear_cache()`, `_dir_size()` and
    `remove()` iterate all category cache roots instead of one `cache_root`.
- `backend/cleanup.py`
  - Photo-cache pruning walks per-UUID cache dirs and removes orphans (pointers
    are the source of truth).
- `server.py`
  - Fix co-location assumption: `stream_file()` uses
    `send_file(media.source_path(record))` instead of
    `send_from_directory(media.storage_root, record["path"])`.
  - `GET /api/files` gains an optional `q` query parameter, applied before
    pagination via `media.search()`; the response echoes `query` and, on a
    filtered result, the total is the match count. `GET /api/search?q=` is added
    as a thin alias for clients that want a dedicated endpoint.
  - `GET/POST /api/settings` return/accept the `categories` block plus native
    candidates. A `categories` save that changes any root responds
    `409 { needs_confirmation: true, relayout: [{ id, label, mode, from, to,
    files, bytes }] }` and changes nothing; resending with
    `confirm_relayout: true` applies it. Category changes take effect
    immediately (no restart); only `storage_dir` still sets `requires_restart`.
  - New `GET/POST/DELETE /api/categories` (event-driven library management).
  - New `POST /api/library/scan?category=` (index a linked root).
  - New `POST /api/library/migrate?dry_run=true` (preview moves → confirm).
  - `DELETE /api/files/<id>` returns `409 { needs_confirmation: true }` for
    linked records so the UI can ask.
  - `/api/stats` sums bytes across configured roots; cache stats walk per-UUID
    cache dirs.

### Frontend

- `static/js/components/settings.js`
  - New **Libraries / Categories** section: built-in + custom categories, each
    with a root picker (native candidates + custom path), a managed/linked
    toggle, and a **Scan** action. **Add category** accepts label, extensions,
    and an **Icon class** (Remix Icon, with live preview). The form keeps the
    entered values when creation fails and shows the server's reason.
- `static/js/components/confirm.js` (new)
  - Promise-based confirmation dialog used for linked-file deletion, library
    relayout, and cache migration.
- `static/js/components/guide.js`
  - Stat rows render their value in a child element so the row label is kept
    when statistics load.
- `static/js/components/navbar.js`
  - New search control in `nav-actions` (icon + input). Debounced input (~200 ms)
    emits a query; `/` focuses it and `Esc` clears it. In `only-icons` mode it
    collapses to an icon that expands on focus.
  - `setLinks()` rebuilds the page links so custom libraries can be added or
    removed at runtime; link ids are derived from the link hash.
- `static/js/app.js`
  - `state.query` is added to `pageKey()` and to the `/api/files` request, so
    search results are cached, paginated, and re-rendered like any listing;
    `loadPage()` shows a "No results for …" empty state and a match count.
  - Card titles highlight matched substrings (via `search.py` ranges or a
    client-side fallback); a small "N results" indicator replaces the page meta
    while a query is active.
  - Storage changes call `migrate?dry_run=true` and show a confirmation modal
    listing the moves; apply on confirm.
  - Saving libraries with a changed root shows a **Confirm library relayout**
    dialog (library, file count, size, from → to) and applies on confirm.
  - Custom libraries are added to the navbar and page routing from the live
    category registry (`#<id>`); removed libraries fall back to Home.
  - Info page: new Search and Library storage sections, updated Get started /
    Manage files / Browse text, and per-library counts for custom libraries.
  - Delete on a linked record surfaces a **Remove from Filey** vs **Delete file
    permanently** modal when the API returns `409`.
  - Upload flow lists custom categories.
- `static/css/components/settings.css`
  - Styling for the category rows and add-category form (three columns on wide
    screens, two on medium, one on narrow; icon field with preview and hint).
- `static/css/components/navbar/actions.css` (and `main.css` if needed)
  - Styling for the navbar search input and its collapsed icon state; match
    highlighting uses a `.search-hit` class on card titles. The collapsed search
    control matches the neighbouring round action buttons (size, background,
    hover) and stays available on small screens.

### Configuration

`categories` lives in `<storage-dir>/.filey-config.json` and is editable from the
Settings page. Example:

```json
{
  "platform_name": "Filey",
  "storage_dir": "/run/media/user/FS-STORAGE",
  "categories": {
    "movies": { "label": "Movies", "root": "/home/user/Videos", "mode": "managed" },
    "photos": { "label": "Photos", "root": "/home/user/Pictures", "mode": "managed" }
  },
  "hls": { "concurrency": 2, "rlimit_mb": 4096, "x264_threads": 4, "preset": "" }
}
```

## Backward compatibility

- No `categories` block → binaries stay under `<STORAGE_DIR>/storage/` and
  existing pointers continue to resolve via the legacy branch.
- Existing `backend-data/<type>/<uuid>.json` pointers keep working untouched.
- The only intentional change for existing installs is the cache relocation
  (`storage/_webp`, `storage/_hls_filey01` → `<type>/cache/`), migrated once.

## Cache migration (one-time)

On first start after upgrading:
1. Move each `storage/_hls_filey01/<uuid>` → `<category>/cache/<uuid>`
   (category resolved from the UUID's pointer).
2. Map `storage/_webp/<stem>_<mtime>.webp` → `<category>/cache/<uuid>/` using the
   pointer's `originalName`; entries with no matching pointer are regenerated on
   demand.
3. Remove the now-empty legacy cache directories.

Caches are always rebuilt in Filey's managed space, so read-only or linked media
roots never need to be writable.

## Files to change

```
backend/config.py
backend/paths.py            (new)
backend/search.py           (new)
backend/migrate.py          (new)
backend/media.py
backend/photos.py
backend/hls_project26.py
backend/cleanup.py
server.py
static/js/app.js
static/js/components/navbar.js
static/js/components/settings.js
static/js/components/confirm.js (new)
static/js/components/guide.js
static/css/components/settings.css
static/css/components/navbar/actions.css
install.sh                  (document categories in the env template)
release/INSTALL.md          (document categories + storage modes + search)
```

## Verification plan

- Unit: category validation (managed/linked, reserved slugs, non-empty native
  dirs), root-aware `_source_path` (legacy vs configured), `infer_type` with
  custom extension rules, link dedupe.
- Search: `parse_query`/`match_record` over name, original filename, tags, type
  and extension — case-insensitivity, multi-term AND, no-match, and composition
  with the `type` filter, sort, and pagination (`q` + `type` + `page`).
- Migration dry-run vs apply: correct move list, pointers rewritten atomically,
  rollback on partial failure.
- Cache: HLS and webp resolve to `<type>/cache/<uuid>/`; legacy migration moves
  the right entries; orphan pruning removes stale cache.
- API smoke: `GET/POST /api/settings` with categories; `GET/POST/DELETE
  /api/categories`; `scan`; `migrate?dry_run=true`; `409` delete confirmation;
  `GET /api/files?q=…` returns filtered totals; `GET /api/search?q=…` alias.
- `python3 -m py_compile` and `node --check` on all changed files.
- Live playback from a native folder (managed and linked) to confirm streaming
  and thumbnails work with the new path resolution; search returns files from
  those roots.

## Upgrading

On an existing installation, run the bundled updater from an extracted copy of
this release:

```bash
unzip filey-release.zip -d filey-release
cd filey-release
sudo ./update.sh
```

Storage data is never touched by the updater. Existing installs start in legacy
layout (all files under `<STORAGE_DIR>/storage/`); caches migrate once on first
start. Point libraries at native folders from **Settings → Libraries** at any
time — relayout prompts with a preview before moving anything.

## Rollback

The previous stable release is archived as `dev/filey_release_v3.0.11.zip`.
`update.sh` also writes a per-update backup to `<install-dir>.bak-<timestamp>`.

## Implementation notes

Differences from the original specification, and issues found and fixed while
testing the build (details in `FEATURE_QA_ISSUES.md`):

- **Relayout is confirmed server-side.** Root changes originally applied
  immediately and broke access to existing records (download returned 404). They
  now require `confirm_relayout`, preserve linked records via `source_root`, and
  move managed files with rollback. Category changes no longer need a restart.
- **Custom libraries have their own view.** The navbar and routing were
  hard-coded to the built-ins; they now follow the category registry.
- **Icon is chosen at creation.** The add-library form takes an icon class that
  is stored with the category and used for its files.
- **Linked uploads.** Uploading directly into a linked library saves the file in
  that library's folder and treats the record as managed.
- **Not included.** Music playlists (temporary, play-while-active queues) were
  scoped but are not part of this release.

## Verification performed

- Isolated API runs (temporary storage root): built-ins only on first start;
  custom linked library create/scan; global search composed with `type`, `sort`,
  and pagination; linked delete confirmation (`409`) and remove-only keeping the
  source; managed upload into a configured root; linked and managed relayout
  (preview, confirmation, pointers and downloads preserved, files moved).
- Browser checks: custom library link and filtered view, relayout confirmation
  dialog, Info page content and per-library counts, search control collapsed /
  hover / focus / small-screen states, icon field layout at three widths.
- `python3 -m compileall` and `node --check` on changed files; `git diff
  --check`.
- Not yet covered: automated unit tests and the live-playback check from a
  native folder listed in the verification plan.
