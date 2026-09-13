import datetime
import json
import mimetypes
import uuid
from pathlib import Path

from werkzeug.utils import secure_filename


class MediaLibrary:
    """Reads and writes Project 26 Filey's UUID pointer-file storage layout."""

    ALLOWED_TYPES = {'movies', 'music', 'other', 'photos'}

    def __init__(self, storage_root):
        self.storage_root = Path(storage_root)
        self.source_dir = self.storage_root / 'storage'
        self._scanned = None
        self._sorted_cache = {}
        self.ensure_storage()

    def ensure_storage(self):
        self.source_dir.mkdir(parents=True, exist_ok=True)
        for media_type in self.ALLOWED_TYPES:
            (self.storage_root / media_type).mkdir(parents=True, exist_ok=True)

    @property
    def upload_dir(self):
        return self.source_dir

    def _pointer_path(self, media_type, file_id):
        return self.storage_root / media_type / f'{file_id}.json'

    def _source_path(self, record):
        return self.storage_root / record['path']

    def source_path(self, record):
        return self._source_path(record)

    def read_files(self):
        if self._scanned is not None:
            return list(self._scanned)
        self.ensure_storage()
        files = []
        for media_type in sorted(self.ALLOWED_TYPES):
            pointer_dir = self.storage_root / media_type
            for pointer_path in sorted(pointer_dir.glob('*.json')):
                try:
                    data = json.loads(pointer_path.read_text(encoding='utf-8'))
                except (OSError, json.JSONDecodeError):
                    continue
                source = self._source_path(data)
                file_type = data.get('media_type', media_type)
                files.append({
                    'id': pointer_path.stem,
                    'name': data.get('name') or data.get('file_name', pointer_path.stem),
                    'originalName': data.get('file_name', pointer_path.stem),
                    'type': file_type,
                    'icon': data.get('icon') or self.default_icon(file_type),
                    'size': self.format_size(source.stat().st_size) if source.is_file() else '',
                    'sizeBytes': source.stat().st_size if source.is_file() else 0,
                    'timeAdded': data.get('time_added', ''),
                    'action': 'View' if file_type == 'photos' else 'Play' if file_type in {'movies', 'music'} else 'Open',
                    'mimeType': mimetypes.guess_type(data.get('file_name', ''))[0] or 'application/octet-stream',
                    'path': data.get('path', ''),
                    'pointerPath': str(pointer_path),
                    'exists': source.is_file(),
                })
        self._scanned = files
        return list(self._scanned)

    def read_sorted(self, media_type=None, sort='default'):
        """Return records filtered by media_type (None = all), sorted and cached per (type, sort)."""
        key = (media_type or '', sort)
        if key not in self._sorted_cache:
            records = self.read_files() if not media_type else [r for r in self.read_files() if r['type'] == media_type]
            self._sorted_cache[key] = self.sort_records(records, sort)
        return list(self._sorted_cache[key])

    def _invalidate(self):
        self._scanned = None
        self._sorted_cache = {}

    def find(self, file_id):
        return next((item for item in self.read_files() if item['id'] == file_id), None)

    @staticmethod
    def public_record(record):
        return {key: value for key, value in record.items() if key not in {'pointerPath', 'path', 'exists'}}

    @staticmethod
    def infer_type(mime_type, filename):
        if mime_type.startswith('video/'):
            return 'movies'
        if mime_type.startswith('audio/'):
            return 'music'
        if mime_type.startswith('image/'):
            return 'photos'
        extension = Path(filename).suffix.lower()
        if extension in {'.mp4', '.mkv', '.webm', '.mov'}:
            return 'movies'
        if extension in {'.mp3', '.wav', '.ogg', '.flac', '.m4a'}:
            return 'music'
        if extension in {'.png', '.jpg', '.jpeg', '.gif', '.webp'}:
            return 'photos'
        return 'other'

    @staticmethod
    def default_icon(file_type):
        return {'movies': 'ri-play-fill', 'music': 'ri-music-2-fill', 'photos': 'ri-image-2-line'}.get(file_type, 'ri-file-3-line')

    @staticmethod
    def sort_records(records, mode='default'):
        ordered = list(records)
        if mode == 'oldest':
            ordered.sort(key=lambda r: r.get('timeAdded') or '')
        elif mode == 'name_asc':
            ordered.sort(key=lambda r: r.get('name') or '')
        elif mode == 'name_desc':
            ordered.sort(key=lambda r: r.get('name') or '', reverse=True)
        elif mode == 'size_asc':
            ordered.sort(key=lambda r: r.get('sizeBytes') or 0)
        elif mode == 'size_desc':
            ordered.sort(key=lambda r: r.get('sizeBytes') or 0, reverse=True)
        elif mode == 'type':
            ordered.sort(key=lambda r: (r.get('type') or '', r.get('name') or ''))
        else:
            ordered.sort(key=lambda r: r.get('timeAdded') or '', reverse=True)
        return ordered

    @staticmethod
    def paginate(records, page=1, per_page=24):
        total = len(records)
        start = max(0, (max(1, page) - 1) * max(1, per_page))
        return records[start:start + per_page], total

    def add_upload(self, uploaded, display_name='', file_type='', icon=''):
        if uploaded is None or not uploaded.filename:
            raise ValueError('file is required')
        file_type = file_type or self.infer_type(uploaded.mimetype or '', uploaded.filename)
        if file_type not in self.ALLOWED_TYPES:
            raise ValueError('invalid category')
        file_id = str(uuid.uuid4())
        original_name = secure_filename(uploaded.filename) or f'upload-{file_id}'
        stored_name = original_name
        source_path = self.source_dir / stored_name
        counter = 1
        while source_path.exists():
            source_path = self.source_dir / f'{Path(original_name).stem}-{counter}{Path(original_name).suffix}'
            stored_name = source_path.name
            counter += 1
        uploaded.save(source_path)
        pointer = {
            'media_type': file_type,
            'path': f'storage/{stored_name}',
            'name': display_name.strip() or Path(uploaded.filename).stem,
            'file_name': uploaded.filename,
            'time_added': str(datetime.datetime.now()),
            'tags': [],
            'icon': icon or self.default_icon(file_type),
        }
        self._pointer_path(file_type, file_id).write_text(json.dumps(pointer, indent=2), encoding='utf-8')
        self._invalidate()
        return self.find(file_id)

    def update(self, file_id, payload):
        record = self.find(file_id)
        if not record:
            return None
        pointer_path = Path(record['pointerPath'])
        pointer = json.loads(pointer_path.read_text(encoding='utf-8'))
        if payload.get('name'):
            pointer['name'] = str(payload['name']).strip()
        if payload.get('icon'):
            pointer['icon'] = str(payload['icon'])
        if payload.get('type') in self.ALLOWED_TYPES and payload['type'] != record['type']:
            pointer['media_type'] = payload['type']
            new_path = self._pointer_path(payload['type'], file_id)
            new_path.write_text(json.dumps(pointer, indent=2), encoding='utf-8')
            pointer_path.unlink(missing_ok=True)
        else:
            pointer_path.write_text(json.dumps(pointer, indent=2), encoding='utf-8')
        self._invalidate()
        return self.find(file_id)

    def delete(self, file_id):
        record = self.find(file_id)
        if not record:
            return False
        self._source_path(record).unlink(missing_ok=True)
        Path(record['pointerPath']).unlink(missing_ok=True)
        self._invalidate()
        return True

    def clean_missing(self):
        removed = 0
        for record in self.read_files():
            if not record['exists']:
                Path(record['pointerPath']).unlink(missing_ok=True)
                removed += 1
        if removed:
            self._invalidate()
        return removed

    @staticmethod
    def format_size(size):
        if size < 1024:
            return f'{size} B'
        if size < 1024 * 1024:
            return f'{size / 1024:.1f} KB'
        if size < 1024 * 1024 * 1024:
            return f'{size / 1024 / 1024:.1f} MB'
        return f'{size / 1024 / 1024 / 1024:.1f} GB'
