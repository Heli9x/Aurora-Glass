"""Audio specialization: tags, cover images and lyrics for music records.

Per-track metadata lives in the record's pointer file under ``audio``. Cover
images and lyrics are stored beside it in ``<storage>/music/assets/<id>/``.
Embedded tags (ID3, MP4, Vorbis, FLAC) are read through mutagen when it is
installed; without it uploads still work and tags can be entered manually.
"""

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
    if full is None:
        # MP3s with unusual audio frames still carry readable ID3 tags.
        try:
            from mutagen.id3 import ID3
            from mutagen.easyid3 import EasyID3
            full = type('Tagged', (), {'tags': ID3(path), 'pictures': None})()
            easy = type('Tagged', (), {'tags': EasyID3(path)})()
        except Exception:
            return result
    if easy and easy.tags:
        def first(key):
            try:
                values = easy.tags.get(key)
            except Exception:
                return ''
            return clean_text(values[0]) if values else ''
        result.update({'title': first('title'), 'artist': first('artist'), 'album': first('album'),
                       'genre': first('genre'), 'year': clean_year(first('date'))})
    tags = full.tags
    try:
        if hasattr(tags, 'getall'):
            pictures = tags.getall('APIC')
            if pictures:
                result['cover'] = bytes(pictures[0].data)
            lyric_frames = tags.getall('USLT')
            if lyric_frames:
                result['lyrics'] = str(lyric_frames[0].text)
        elif getattr(full, 'pictures', None):
            result['cover'] = bytes(full.pictures[0].data)
        if tags is not None and 'covr' in tags and tags['covr']:
            result['cover'] = bytes(tags['covr'][0])
        if tags is not None and '\xa9lyr' in tags and tags['\xa9lyr']:
            result['lyrics'] = str(tags['\xa9lyr'][0])
        if tags is not None and 'lyrics' in tags and tags['lyrics']:
            result['lyrics'] = str(tags['lyrics'][0])
    except Exception:
        pass
    return result


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
        """Update artist, album, genre, theme and release year; None when not found."""
        record = self._music_record(file_id)
        if not record:
            return None
        fields = {}
        for key in TEXT_FIELDS:
            if key in payload:
                fields[key] = clean_text(payload[key])
        if 'year' in payload:
            fields['year'] = clean_year(payload['year'])
        if fields:
            self.media.update_audio(file_id, fields)
        return self.media.find(file_id)

    # -- cover --------------------------------------------------------------

    def set_cover(self, file_id, data):
        if not self._music_record(file_id):
            return None
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
        self.media.update_audio(file_id, {'cover': True})
        return self.media.find(file_id)

    def remove_cover(self, file_id):
        if not self._music_record(file_id):
            return None
        for old in self.assets_dir(file_id).glob('cover.*'):
            old.unlink(missing_ok=True)
        self.media.update_audio(file_id, {'cover': False})
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

    def set_lyrics(self, file_id, source, fmt='auto', source_label='user'):
        """Adapt user supplied lyrics (rows, JSON, LRC or text); empty input clears them."""
        if not self._music_record(file_id):
            return None
        rows = lyrics_lib.parse(source, fmt)
        path = self._lyrics_path(file_id)
        if rows:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(rows, ensure_ascii=False), encoding='utf-8')
        else:
            path.unlink(missing_ok=True)
        self.media.update_audio(file_id, {'lyrics': source_label if rows else ''})
        return rows

    # -- upload -------------------------------------------------------------

    def ingest_upload(self, record, form, files):
        """Apply tags, cover and lyrics given at upload time, falling back to embedded data.

        Explicit user input always wins; a missing cover or lyrics is simply
        left empty so it can be added later.
        """
        file_id = record['id']
        embedded = read_embedded(self.media.source_path(record))
        fields = {}
        for key in TEXT_FIELDS:
            value = clean_text(form.get(key)) or embedded.get(key, '')
            if value:
                fields[key] = value
        year = clean_year(form.get('year')) or embedded.get('year')
        if year:
            fields['year'] = year
        if fields:
            self.media.update_audio(file_id, fields)

        warnings = []
        cover_upload = files.get('cover')
        cover_data = cover_upload.read(MAX_COVER_BYTES + 1) if cover_upload and cover_upload.filename else b''
        try:
            if cover_data:
                self.set_cover(file_id, cover_data)
            elif embedded.get('cover'):
                self.set_cover(file_id, embedded['cover'])
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
        elif embedded.get('lyrics'):
            lyrics_text, label = embedded['lyrics'], 'embedded'
        if lyrics_text.strip():
            try:
                self.set_lyrics(file_id, lyrics_text, source_label=label)
            except lyrics_lib.LyricsError as error:
                warnings.append(f'lyrics ignored: {error}')
        return self.media.find(file_id), warnings
