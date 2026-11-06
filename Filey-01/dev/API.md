# Filey API Reference

Covers Filey v3.2.1. The source of truth is the route definitions in
`server.py` and `ROUTE_PERMISSIONS` in `backend/auth/__init__.py`.

## Conventions

- Base path `/api`. Bodies and responses are JSON unless noted.
- Errors: `{"error": "message"}` with a 4xx/5xx status. Some add flags such as
  `needs_confirmation` (409) or `retry_after` (429).
- `{id}` is a record UUID from `GET /api/files`.

### Authentication

- Sign in with `POST /api/auth/login`. It sets a signed, HTTP-only session
  cookie and returns a `csrf_token`.
- Every `POST`, `PUT`, `PATCH` and `DELETE` (except login and setup) must send
  that token in an `X-CSRF-Token` header, otherwise `403 invalid csrf token`.
- Unauthenticated requests get `401`; a missing permission gets `403`.
- Successful mutating requests are written to the admin audit log.

### Roles and permissions

| Role | Permissions |
|---|---|
| `client` | `files.read` |
| `admin` | all of: `files.read`, `files.upload`, `files.edit`, `files.delete`, `library.manage`, `settings.manage`, `maintenance.run`, `users.manage` |

## Public endpoints (no login)

| Method | Path | Notes |
|---|---|---|
| GET | `/` | Serves the web app |
| GET | `/api/health` | `{status, service, platform_name, api_version}` |
| GET | `/api/discovery` | `{name, service, platform_name, api_version, root, files_path}` |
| POST | `/api/auth/login` | Body `{username, password}`. `200 {user, csrf_token}`, `401` bad credentials, `429` rate limited (`Retry-After`), `503` setup required |
| POST | `/api/auth/logout` | `{success: true}` |
| GET | `/api/auth/me` | `200 {user, csrf_token}` or `401 {error, setup_required}` |
| POST | `/api/auth/setup` | First admin only. Body `{token, username, password}`. `201 {user}`, `403` bad token, `409` already set up |

## Files (`files.read`)

### `GET /api/files`

Query parameters:

| Name | Meaning |
|---|---|
| `page` | Page number, default `1` |
| `per_page` | 1-100, default `24` |
| `type` | Category id (`movies`, `music`, `photos`, `other`, or a custom library) |
| `q` | Search names, filenames, tags, types, extensions |
| `sort` | `default` (recent), `oldest`, `name_asc`, `name_desc`, `size_asc`, `size_desc`, `type` |
| `artist`, `album`, `genre`, `theme`, `year` | Music tag filters. Case-insensitive exact match, combinable |

Response: `{files: [record], total, page, per_page, query}`.

A record:

```json
{
  "id": "uuid", "name": "Nowhere", "originalName": "Nowhere (Corteza) - Cyber.mp3",
  "type": "music", "icon": "ri-music-2-fill", "ext": ".mp3",
  "mimeType": "audio/mpeg", "sizeBytes": 6967923, "timeAdded": "2026-11-05 16:03:31",
  "tags": [],
  "artist": "Cyber", "album": "Evening", "genre": "Electronic", "theme": "",
  "year": 2026, "hasCover": true, "hasLyrics": false, "embeddedTitle": "Nowhere"
}
```

The audio fields (`artist` ... `embeddedTitle`) appear on music records only.
Filesystem paths are never returned.

### `GET /api/search?q=&type=&limit=`

`limit` 1-100, default 20. Returns `{query, total, results: [record]}`.

### `GET /api/stats` (also accepts `POST`)

`{total, counts: {category: n}, hls_cache: {bytes, files}, photo_cache: {bytes}, storage: {free, used, total}}`.

### Content endpoints

| Method | Path | Returns |
|---|---|---|
| GET | `/api/files/{id}/view[?thumbnail=true]` | Photo as WebP |
| GET | `/api/files/{id}/thumbnail` | WebP thumbnail (photos, movies) |
| GET | `/api/files/{id}/stream` | Movie or music file, supports range requests |
| GET | `/api/files/{id}/preview` | `view` for photos, `stream` otherwise |
| GET | `/api/files/{id}/download` | Original file as an attachment |

## Upload and edit

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/api/upload` | `files.upload` | See below. `201 {file, warnings?}` |
| PATCH | `/api/files/{id}` | `files.edit` | Body any of `name`, `icon`, `type` (move category). For music also `artist`, `album`, `genre`, `theme`, `year`. `{file}` |
| DELETE | `/api/files/{id}` | `files.delete` | Optional `?delete_source=true|false`. `409 {needs_confirmation}` for linked files. `{success, removed}` |

`POST /api/upload` is `multipart/form-data`:

| Field | Meaning |
|---|---|
| `file` | The file (required) |
| `category` | Library id; detected from the file type when empty |
| `name`, `icon` | Optional display name and icon |
| `artist`, `album`, `genre`, `theme`, `year` | Music only, optional |
| `cover` | Music only: image file (JPEG, PNG, WebP, GIF, max 8 MiB) |
| `lyrics_file` or `lyrics` | Music only: lyrics file or pasted text |

Music uploads first read tags, cover and lyrics embedded in the file as
defaults; fields sent here override them. Problems with the optional cover or
lyrics are reported in `warnings` and do not fail the upload.

## Audio (music records)

Tags the user sets win over tags embedded in the file; a value equal to the
embedded one goes back to following the file.

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/files/{id}/cover` | `files.read` | Image, `404` when none |
| PUT | `/api/files/{id}/cover` | `files.edit` | Multipart field `cover` or the raw image as the body. `{file}` |
| DELETE | `/api/files/{id}/cover` | `files.edit` | Removes it (a rescan will not bring it back). `{file}` |
| GET | `/api/files/{id}/lyrics` | `files.read` | `{lyrics: [[text, speed, delay], ...], format: "text-speed-delay"}` |
| PUT | `/api/files/{id}/lyrics` | `files.edit` | Body `{lyrics: [[...]]}` or `{text, format?}` (`auto`, plain text, LRC, JSON), or multipart `lyrics_file`. `{lyrics, file}` |
| GET | `/api/library/audio/facets` | `files.read` | Distinct tag values: `{artist: [{value, count}], album, genre, theme, year}` |
| POST | `/api/library/audio/rescan` | `library.manage` | Re-read embedded tags. `?force=true` rescans every track. `{success, scanned}` |

Lyrics rows are `[text, speed, delay]`: `speed` is seconds per character and
`delay` is the second the line starts.

## Libraries (categories)

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/categories` | `files.read` | Category list and native roots |
| POST | `/api/categories` | `library.manage` | Create a custom library. `201` |
| DELETE | `/api/categories/{id}` | `library.manage` | Built-ins cannot be removed. `409 {needs_confirmation, count}` unless `?force=true` |
| POST | `/api/library/scan?category={id}` | `library.manage` | Index files in a linked root. `{success, category, added}` |
| POST | `/api/categories/{id}/scan` | `library.manage` | Same, by path. `{success, added}` |
| POST | `/api/library/migrate[?dry_run=true]` | `settings.manage` | Move legacy caches into the per-category layout |

Scanning the `music` library also reads embedded tags for new tracks.

## Settings

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/settings` | `files.read` | Admins get full settings; clients get a trimmed view without paths |
| POST | `/api/settings` | `settings.manage` | Body any of `name`, `storage_dir`, `hls`, `categories`. Changing library roots returns `409 {needs_confirmation, relayout}` until sent again with `confirm_relayout: true`. Returns `{applied, platform_name, storage_dir, requires_restart, ...}` |

## Streaming (HLS)

| Method | Path | Permission |
|---|---|---|
| POST | `/api/files/{id}/hls` | `files.read` (starts conversion, `202 {status, playlist}`) |
| GET | `/api/files/{id}/hls/status` | `files.read` |
| GET | `/api/files/{id}/hls/stream.m3u8` | `files.read` |
| GET | `/api/files/{id}/hls/{segment}` | `files.read` |
| POST | `/api/files/{id}/hls/{pause\|resume\|cancel}` | `maintenance.run` |
| POST | `/api/hls/cancel` | `maintenance.run` (stop all) |
| POST | `/api/hls/clear` | `maintenance.run` (clear cache) |

Legacy aliases kept for older clients: `GET /api/hls/{id}/stream.m3u8`,
`GET /api/hls/{id}/{segment}`, `POST /api/hls/{id}/{action}`,
`GET /api/hls_status/{id}`.

## Maintenance

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/api/clean` | `maintenance.run` | Remove records whose files are gone and stale caches. `{success, removed, cache, remaining}` |

## Users (`users.manage`)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/users` | `{users: [...]}` sorted by username |
| POST | `/api/users` | Body `{username, password, role?, disabled?}` (`role` defaults to `client`). `201 {user}` |
| PATCH | `/api/users/{id}` | Body any of `role`, `password`, `disabled`. Cannot remove or disable the last enabled admin, or disable yourself |
| DELETE | `/api/users/{id}` | Cannot delete yourself or the last enabled admin |
