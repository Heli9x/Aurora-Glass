"""Audio specialization: tags, cover images and lyrics for music records.

Per-track metadata lives in the record's pointer file under ``audio``. Cover
images and lyrics are stored beside it in ``<storage>/music/assets/<id>/``.
Embedded tags (ID3, MP4, Vorbis, FLAC) are read through mutagen when it is
installed; without it uploads still work and tags can be entered manually.
"""

import base64
import json
import re
import shutil
from pathlib import Path

from backend.audio import lyrics as lyrics_lib

try:
    import mutagen
except ImportError:
    mutagen = None

TEXT_FIELDS = ('artist', 'album', 'genre', 'theme')
MAX_FIELD = 200
MAX_COVER_BYTES = 8 * 1024 * 1024
MAX_LYRICS_BYTES = 512 * 1024
COVER_TYPES = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif'}
_YEAR = re.compile(r'(\d{4})')


def clean_text(value):
    return ' '.join(str(value or '').split())[:MAX_FIELD]


def clean_year(value):
    match = _YEAR.search(str(value or ''))
    if not match:
        return None
    year = int(match.group(1))
    return year if 1000 <= year <= 9999 else None


def sniff_image(data):
    if data.startswith(b'\xff\xd8\xff'):
        return 'image/jpeg'
    if data.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'image/png'
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'image/webp'
    if data[:6] in (b'GIF87a', b'GIF89a'):
        return 'image/gif'
    return None


def _first(value):
    if isinstance(value, (list, tuple)):
        value = value[0] if value else ''
    return value


def _vorbis_cover(tags):
    """Ogg Vorbis/Opus/FLAC-in-Ogg store covers as base64 FLAC picture blocks."""
    try:
        from mutagen.flac import Picture
        for encoded in tags.get('metadata_block_picture', []):
            picture = Picture(base64.b64decode(encoded))
            if picture.data:
                return bytes(picture.data)
    except Exception:
        pass
    return None


def _synced_lyrics(frames):
    """Turn an ID3 SYLT (synchronised lyrics) frame into LRC text, or '' when unusable."""
    for frame in frames:
        if getattr(frame, 'format', 2) != 2:
            continue  # timestamps in MPEG frames cannot be converted without the audio layout
        lines = []
        for text, millis in frame.text:
            text = text.replace('\r', '').strip()
            if text:
                lines.append(f'[{int(millis // 60000):02d}:{(millis % 60000) / 1000:05.2f}]{text}')
        if lines:
            return '\n'.join(lines)
    return ''


def read_embedded(path):
    """Return tags, cover bytes and lyrics embedded in an audio file (best effort)."""
    result = {}
    if mutagen is None:
        return result
    try:
        easy = mutagen.File(path, easy=True)
        full = mutagen.File(path)
    except Exception:
        easy = full = None
    length = getattr(getattr(full, 'info', None), 'length', None)
    if isinstance(length, (int, float)) and length > 0:
        result['duration'] = float(length)
    if full is None:
        # MP3s with unusual audio frames still carry readable ID3 tags.
        try:
            from mutagen.easyid3 import EasyID3
            from mutagen.id3 import ID3
            full = type('Tagged', (), {'tags': ID3(path), 'pictures': None})()
            try:
                from mutagen.mp3 import MP3
                result['duration'] = float(MP3(path).info.length)
            except Exception:
                pass
            easy = type('Tagged', (), {'tags': EasyID3(path)})()
        except Exception:
            return result

    if easy is not None and easy.tags:
        def tag(key):
            try:
                return clean_text(_first(easy.tags.get(key)))
            except Exception:
                return ''
        values = {'title': tag('title'), 'artist': tag('artist') or tag('albumartist'),
                  'album': tag('album'), 'genre': tag('genre'), 'year': clean_year(tag('date'))}
        result.update({key: value for key, value in values.items() if value})

    tags = full.tags
    try:
        if hasattr(tags, 'getall'):
            pictures = tags.getall('APIC')
            if pictures:
                result['cover'] = bytes(pictures[0].data)
            lyrics_text = _synced_lyrics(tags.getall('SYLT'))
            if not lyrics_text:
                texts = [str(frame.text) for frame in tags.getall('USLT') if str(frame.text).strip()]
                # Prefer a frame carrying [mm:ss] stamps over a plain-text one.
                lyrics_text = next((text for text in texts if '[' in text and lyrics_lib.has_stamps(text)),
                                   texts[0] if texts else '')
            if lyrics_text:
                result['lyrics'] = lyrics_text
        else:
            if getattr(full, 'pictures', None):
                result['cover'] = bytes(full.pictures[0].data)
            elif tags is not None and 'covr' in tags and tags['covr']:
                result['cover'] = bytes(tags['covr'][0])
            elif tags is not None:
                cover = _vorbis_cover(tags)
                if cover:
                    result['cover'] = cover
            for key in ('\xa9lyr', 'lyrics', 'unsyncedlyrics'):
                if tags is not None and key in tags and tags[key]:
                    result['lyrics'] = str(_first(tags[key]))
                    break
    except Exception:
        pass
    if result.get('lyrics', '').strip() == '':
        result.pop('lyrics', None)
    return result


# Bump when scanning changes so existing tracks pick up the better defaults once.
SCAN_REVISION = 2


class AudioService:
    def __init__(self, media_library):
        self.media = media_library

    # -- storage ------------------------------------------------------------

    def assets_dir(self, file_id):
        return self.media.storage_root / 'music' / 'assets' / file_id

    def _lyrics_path(self, file_id):
        return self.assets_dir(file_id) / 'lyrics.json'

    def cover_path(self, file_id):
        directory = self.assets_dir(file_id)
        for extension in COVER_TYPES.values():
            candidate = directory / f'cover{extension}'
            if candidate.is_file():
                return candidate
        return None

    def remove_assets(self, file_id):
        shutil.rmtree(self.assets_dir(file_id), ignore_errors=True)

    def _music_record(self, file_id):
        record = self.media.find(file_id)
        return record if record and record['type'] == 'music' else None

    # -- metadata -----------------------------------------------------------

    def set_metadata(self, file_id, payload):
        """Record the user's tag edits; a value equal to the embedded default follows it again."""
        record = self._music_record(file_id)
        if not record:
            return None
        changes = {}
        for key in TEXT_FIELDS:
            if key in payload:
                changes[key] = clean_text(payload[key])
        if 'year' in payload:
            changes['year'] = clean_year(payload['year'])

        def mutate(pointer):
            embedded = pointer.get('embedded') or {}
            overrides = pointer.get('audio') if isinstance(pointer.get('audio'), dict) else {}
            for key, value in changes.items():
                default = embedded.get(key)
                if value == (default if key == 'year' else (default or '')) or (value in ('', None) and default is None):
                    overrides.pop(key, None)
                else:
                    overrides[key] = value
            pointer['audio'] = overrides
        if changes:
            self.media.edit_pointer(file_id, mutate)
        return self.media.find(file_id)

    def _set_asset(self, file_id, **states):
        def mutate(pointer):
            assets = pointer.get('assets') if isinstance(pointer.get('assets'), dict) else {}
            assets.update(states)
            pointer['assets'] = assets
        self.media.edit_pointer(file_id, mutate)

    def _asset_state(self, file_id, name):
        pointer = self.media.pointer_data(file_id) or {}
        return (pointer.get('assets') or {}).get(name)

    # -- cover --------------------------------------------------------------

    def _write_cover(self, file_id, data):
        if not data or len(data) > MAX_COVER_BYTES:
            raise ValueError('cover image must be under 8 MB')
        mime = sniff_image(data)
        if mime is None:
            raise ValueError('cover must be a JPEG, PNG, WebP or GIF image')
        directory = self.assets_dir(file_id)
        directory.mkdir(parents=True, exist_ok=True)
        for old in directory.glob('cover.*'):
            old.unlink(missing_ok=True)
        (directory / f'cover{COVER_TYPES[mime]}').write_bytes(data)

    def set_cover(self, file_id, data):
        if not self._music_record(file_id):
            return None
        self._write_cover(file_id, data)
        self._set_asset(file_id, cover='user')
        return self.media.find(file_id)

    def remove_cover(self, file_id):
        if not self._music_record(file_id):
            return None
        for old in self.assets_dir(file_id).glob('cover.*'):
            old.unlink(missing_ok=True)
        self._set_asset(file_id, cover='removed')
        return self.media.find(file_id)

    # -- lyrics -------------------------------------------------------------

    def get_lyrics(self, file_id):
        """Return stored ``[text, speed, delay]`` rows, or None when the track is unknown."""
        if not self._music_record(file_id):
            return None
        path = self._lyrics_path(file_id)
        if not path.is_file():
            return []
        try:
            return lyrics_lib.validate_rows(json.loads(path.read_text(encoding='utf-8')))
        except (OSError, json.JSONDecodeError, lyrics_lib.LyricsError):
            return []

    def duration(self, file_id):
        """Length of the audio in seconds (cached beside the tags), or None when unknown."""
        record = self._music_record(file_id)
        if not record:
            return None
        pointer = self.media.pointer_data(file_id) or {}
        if pointer.get('duration'):
            return pointer['duration']
        length = read_embedded(self.media.source_path(record)).get('duration')
        if length:
            self.media.edit_pointer(file_id, lambda data: data.__setitem__('duration', length))
        return length

    def _store_lyrics(self, file_id, rows):
        path = self._lyrics_path(file_id)
        if rows:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(rows, ensure_ascii=False), encoding='utf-8')
        else:
            path.unlink(missing_ok=True)

    def set_lyrics(self, file_id, source, fmt='auto', source_label='user'):
        """Adapt user supplied lyrics (rows, JSON, LRC or text); empty input clears them."""
        if not self._music_record(file_id):
            return None
        rows = lyrics_lib.parse(source, fmt, duration=self.duration(file_id))
        state = self._asset_state(file_id, 'lyrics')
        if rows and state == 'embedded' and rows == self.get_lyrics(file_id):
            return rows  # saved unchanged: keep following the embedded lyrics
        self._store_lyrics(file_id, rows)
        if rows:
            self._set_asset(file_id, lyrics=source_label)
        elif state in ('user', 'file', 'embedded'):
            self._set_asset(file_id, lyrics='removed')
        return rows

    # -- embedded defaults --------------------------------------------------

    def sync_embedded(self, file_id, force=False):
        """Read tags, cover and lyrics from the file and store them as defaults.

        Anything the user set or removed is left alone; only the defaults move.
        Returns True when the file was (re)scanned.
        """
        if mutagen is None:
            # Nothing can be read, so do not mark the track as scanned.
            return False
        record = self._music_record(file_id)
        if not record:
            return False
        pointer = self.media.pointer_data(file_id) or {}
        # A scan that found nothing is retried, since it may have been run without a tag reader.
        if pointer.get('embedded_scanned') == SCAN_REVISION and pointer.get('embedded') and not force:
            return False
        data = read_embedded(self.media.source_path(record))
        assets = pointer.get('assets') or {}

        if data.get('cover') and assets.get('cover') not in ('user', 'removed'):
            try:
                self._write_cover(file_id, data['cover'])
                self._set_asset(file_id, cover='embedded')
            except ValueError:
                pass
        if data.get('lyrics') and assets.get('lyrics') not in ('user', 'file', 'removed'):
            try:
                rows = lyrics_lib.parse(data['lyrics'], duration=data.get('duration'))
            except lyrics_lib.LyricsError:
                rows = []
            if rows:
                self._store_lyrics(file_id, rows)
                self._set_asset(file_id, lyrics='embedded')

        embedded = {key: value for key, value in data.items() if key not in ('cover', 'lyrics', 'duration')}

        def mutate(pointer):
            pointer['embedded'] = embedded
            if data.get('duration'):
                pointer['duration'] = data['duration']
            pointer['embedded_scanned'] = SCAN_REVISION
        self.media.edit_pointer(file_id, mutate)
        return True

    def sync_all(self, force=False):
        """Scan every music record not yet scanned (or all with ``force``); returns the count."""
        scanned = 0
        for record in self.media.read_files():
            if record['type'] == 'music' and record['exists'] and self.sync_embedded(record['id'], force):
                scanned += 1
        return scanned

    # -- upload -------------------------------------------------------------

    def ingest_upload(self, record, form, files):
        """Apply embedded defaults, then anything the user gave explicitly at upload."""
        file_id = record['id']
        self.sync_embedded(file_id)
        warnings = []

        explicit = {key: form.get(key) for key in (*TEXT_FIELDS, 'year') if form.get(key)}
        if explicit:
            self.set_metadata(file_id, explicit)

        cover_upload = files.get('cover')
        cover_data = cover_upload.read(MAX_COVER_BYTES + 1) if cover_upload and cover_upload.filename else b''
        if cover_data:
            try:
                self.set_cover(file_id, cover_data)
            except ValueError as error:
                warnings.append(str(error))

        lyrics_text, label = '', 'user'
        lyrics_upload = files.get('lyrics_file')
        if lyrics_upload and lyrics_upload.filename:
            raw = lyrics_upload.read(MAX_LYRICS_BYTES + 1)
            if len(raw) > MAX_LYRICS_BYTES:
                warnings.append('lyrics file is too large')
            else:
                lyrics_text, label = raw.decode('utf-8', errors='replace'), 'file'
        elif (form.get('lyrics') or '').strip():
            lyrics_text = form['lyrics']
        if lyrics_text.strip():
            try:
                self.set_lyrics(file_id, lyrics_text, source_label=label)
            except lyrics_lib.LyricsError as error:
                warnings.append(f'lyrics ignored: {error}')
        return self.media.find(file_id), warnings
