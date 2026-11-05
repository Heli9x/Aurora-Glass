# Filey Update — v3.2.1

Status: implemented
Builds on: v3.2.0 (accounts and roles)

## Audio media specialization

Music records gain tags, a cover image and synced lyrics, wired to the
`MusicPlayer-01` component through `static/js/music/`.

- **Tags:** artist, album, genre, theme, release year. Given at upload or edited
  later (`PATCH /api/files/<id>`). Missing values fall back to tags embedded in
  the file (ID3/MP4/Vorbis/FLAC) when `mutagen` is installed.
- **Cover:** uploaded with the file, taken from the embedded picture, or added
  later (`PUT/DELETE /api/files/<id>/cover`, `GET` to read). Optional.
- **Lyrics rows are read tolerantly:** `[text, speed, delay]` rows are extracted
  from JSON, trailing commas, single quotes, tuples, `lyrics = [...]`
  assignments, comments, missing commas/brackets, BOMs and smart quotes. The
  server (`backend/audio/lyrics.py`) and wizard (`static/js/music/lyrics.js`)
  share the same rules.
- **Full screen:** the player header has a full-screen button. It fills the
  window (and asks the browser for real full screen); Esc, minimize or close
  leaves it. Lyrics and the cover scale up to use the space.
- **Lyrics timing:** plain-text lyrics (pasted, uploaded or embedded) are spread
  over the song's length by line length, with extra room at blank lines; the
  wizard has an "Auto-estimate timing" button. Embedded synced lyrics (ID3
  `SYLT`) are used before unsynced ones, stamped `USLT` beats plain `USLT`, and
  LRC `[offset:+n]` now shows lines sooner as the format specifies. Existing
  tracks are rescanned once (`SCAN_REVISION`). `GET /api/files/<id>/lyrics`
  also returns `duration`.
- **Lyrics:** a lyrics file or pasted text at upload, embedded lyrics, or added
  later (`GET/PUT /api/files/<id>/lyrics`). Plain text, LRC and JSON are
  adapted to the stored row format `[text, speed, delay]` (speed = seconds per
  character, delay = second the line starts). The player's edit button opens an
  editor to write or retime lines.
- **Setup wizard:** after a music upload, and from the player's edit button, a
  step-by-step guide collects The song (artist, album, year), Style (genre,
  theme), Cover, Lyrics and a Review step. Cover and lyrics steps can be skipped.
  The upload API still accepts the same fields directly (`artist`, `cover`,
  `lyrics_file`, ...).
- **Filtering/search:** tag filters on `/api/files` (see "Music tag filters"
  below). Search also matches the new tags.
- **Storage:** tags live in the pointer file under `audio`; cover and lyrics in
  `<storage>/music/assets/<id>/`, removed when the record is deleted.
- **Dependency:** `mutagen` (optional at runtime; install with
  `pip install -r requirements.txt`).
- The old online lyric search/scrape script was dropped; Filey only adapts
  lyrics supplied by the user.

## Media dock

A floating dock (bottom-right, `static/js/components/media_dock.js`) hosts
minimized media viewers so playback survives page changes. The music player and
the video/audio viewer register with it; closing their dialog (X, Esc, outside
click) or pressing Minimize keeps playback running. Each dock card has
play/pause, expand and close; the round launcher collapses the whole dock.
Starting one player pauses the others, and signing out closes everything. New
viewers join via `window.mediaDock.register(id, {...})`.

## Embedded tags as defaults

- Tags embedded in the file (title, artist, album artist, album, genre, year,
  cover, lyrics) are read on upload, on every category/library scan, and once
  on the first music listing (to index tracks added earlier).
- They act as **defaults**: a value the user sets wins; setting a field back to
  the embedded value (or re-saving the wizard unchanged) keeps following the file.
- The embedded title is the display name unless the track was renamed.
- Cover/lyrics the user set, linked, or removed are never overwritten by a scan.
- Covers are extracted from MP3 (APIC), M4A (covr), FLAC (picture) and
  Ogg/Opus (METADATA_BLOCK_PICTURE). Lyrics: USLT, `©lyr`, `lyrics`/`unsyncedlyrics`.
- `POST /api/library/audio/rescan[?force=true]` (`library.manage`) re-reads
  embedded data for all tracks.

## Music tag filters

Artist, album, genre, theme and release year are **filters**, not sort orders.
The Music page has a filter menu (`/api/library/audio/facets` supplies the
values and track counts); `GET /api/files` accepts `artist`, `album`, `genre`,
`theme` and `year` (case-insensitive, combinable). Sorting stays recent / name /
size / type. Previously saved tag sort preferences fall back to Recent.

## Fixes

- `PUT` is now CSRF-protected and audit-logged like the other mutating methods
  (the cover and lyrics `PUT` routes were unprotected).

See `API.md` for the full endpoint reference.
