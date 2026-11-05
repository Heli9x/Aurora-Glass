import datetime
import json
import mimetypes
import shutil
import uuid
from pathlib import Path

from werkzeug.utils import secure_filename

from backend import config as app_config
from backend import search as media_search


class MediaLibrary:
    """Reads and writes Filey's UUID pointer-file storage layout.

    Identity (the pointer files) always lives under the storage root at
    ``<storage_root>/<category>/<uuid>.json``. The actual media files may live in
    a per-category root chosen by the user (native or custom); generated caches
    stay in Filey's managed space under ``<storage_root>/<category>/cache/``.
    """

    def __init__(self, storage_root, categories=None):
        self.storage_root = Path(storage_root)
        self.source_dir = self.storage_root / 'storage'
        self.categories = {}
        self._scanned = None
        self._sorted_cache = {}
        self.set_categories(categories or app_config.default_categories())

    # -- categories ---------------------------------------------------------

    @property
    def ALLOWED_TYPES(self):
        return set(self.categories)

    def set_categories(self, categories):
        resolved = {}
        for category_id, spec in categories.items():
            entry = dict(spec)
            root = entry.get('root')
            entry['root_path'] = Path(root).expanduser() if root else None
            resolved[category_id] = entry
        self.categories = resolved
        self.ensure_storage()
        self._invalidate()

    def category_ids(self):
        return list(self.categories)

    def category_cache_dir(self, category_id):
        return self.storage_root / category_id / 'cache'

    def categories_view(self):
        counts = {}
        for record in self.read_files():
            counts[record['type']] = counts.get(record['type'], 0) + 1
        view = []
        for category_id, spec in self.categories.items():
            view.append({
                'id': category_id,
                'label': spec.get('label', category_id),
                'icon': spec.get('icon'),
                'mode': spec.get('mode', 'managed'),
                'root': spec.get('root'),
                'extensions': list(spec.get('extensions') or []),
                'builtin': bool(spec.get('builtin')),
                'count': counts.get(category_id, 0),
            })
        return view

    def cache_dir(self, record):
        return self.category_cache_dir(record['type']) / record['id']

    # -- storage layout -----------------------------------------------------

    def ensure_storage(self):
        self.source_dir.mkdir(parents=True, exist_ok=True)
        for category_id, spec in self.categories.items():
            (self.storage_root / category_id).mkdir(parents=True, exist_ok=True)
            self.category_cache_dir(category_id).mkdir(parents=True, exist_ok=True)
            root_path = spec.get('root_path')
            if root_path and spec.get('mode') == 'managed':
                try:
                    root_path.mkdir(parents=True, exist_ok=True)
                except OSError:
                    pass

    @property
    def upload_dir(self):
        return self.source_dir

    def _pointer_path(self, media_type, file_id):
        return self.storage_root / media_type / f'{file_id}.json'

    def _root_path_for(self, root_id):
        spec = self.categories.get(root_id) if root_id else None
        return spec.get('root_path') if spec else None

    def _source_path(self, record):
        source_root = record.get('sourceRoot')
        if source_root:
            return Path(source_root) / record['path']
        root_path = self._root_path_for(record.get('root'))
        if root_path:
            return root_path / record['path']
        return self.storage_root / record['path']

    def source_path(self, record):
        return self._source_path(record)

    # -- reading ------------------------------------------------------------

    def read_files(self):
        if self._scanned is not None:
            return list(self._scanned)
        self.ensure_storage()
        files = []
        for media_type in sorted(self.categories):
            pointer_dir = self.storage_root / media_type
            for pointer_path in sorted(pointer_dir.glob('*.json')):
                try:
                    data = json.loads(pointer_path.read_text(encoding='utf-8'))
                except (OSError, json.JSONDecodeError):
                    continue
                source = self._source_path({
                    'root': data.get('root') or data.get('category') or media_type,
                    'sourceRoot': data.get('source_root'),
                    'path': data.get('path', ''),
                })
                file_type = data.get('media_type') or data.get('category') or media_type
                original_name = data.get('file_name', pointer_path.stem)
                spec = self.categories.get(file_type, {})
                files.append({
                    'id': pointer_path.stem,
                    'name': data.get('name') or original_name,
                    'originalName': original_name,
                    'type': file_type,
                    'category': file_type,
                    'categoryLabel': spec.get('label', file_type),
                    'mode': data.get('mode') or spec.get('mode', 'managed'),
                    'root': data.get('root') or file_type,
                    'tags': data.get('tags') or [],
                    'ext': Path(original_name).suffix.lower(),
                    'icon': data.get('icon') or self.default_icon(file_type),
                    'size': self.format_size(source.stat().st_size) if source.is_file() else '',
                    'sizeBytes': source.stat().st_size if source.is_file() else 0,
                    'timeAdded': data.get('time_added', ''),
                    'action': 'View' if file_type == 'photos' else 'Play' if file_type in {'movies', 'music'} else 'Open',
                    'mimeType': mimetypes.guess_type(original_name)[0] or 'application/octet-stream',
                    'path': data.get('path', ''),
                    'sourceRoot': data.get('source_root'),
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

    def search(self, query, media_type=None):
        terms = media_search.parse_query(query)
        records = self.read_files()
        if media_type:
            records = [record for record in records if record['type'] == media_type]
        if not terms:
            return records
        return [record for record in records if media_search.match_record(record, terms)]

    def _invalidate(self):
        self._scanned = None
        self._sorted_cache = {}

    def find(self, file_id):
        return next((item for item in self.read_files() if item['id'] == file_id), None)

    @staticmethod
    def public_record(record):
        return {key: value for key, value in record.items()
                if key not in {'pointerPath', 'path', 'exists', 'root', 'sourceRoot'}}

    # -- classification -----------------------------------------------------

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

    def infer_category(self, mime_type, filename):
        base = self.infer_type(mime_type, filename)
        if base != 'other':
            return base
        extension = Path(filename).suffix.lower()
        for category_id, spec in self.categories.items():
            if category_id in app_config.BUILTIN_CATEGORY_IDS:
                continue
            if extension and extension in (spec.get('extensions') or []):
                return category_id
        return 'other'

    def file_matches_category(self, category_id, path):
        path = Path(path)
        extension = path.suffix.lower()
        spec = self.categories.get(category_id) or {}
        if extension and extension in (spec.get('extensions') or []):
            return True
        if category_id in app_config.BUILTIN_CATEGORY_IDS:
            return self.infer_type(mimetypes.guess_type(path.name)[0] or '', path.name) == category_id
        return False

    def default_icon(self, file_type):
        spec = self.categories.get(file_type)
        if spec and spec.get('icon'):
            return spec['icon']
        return {'movies': 'ri-play-fill', 'music': 'ri-music-2-fill',
                'photos': 'ri-image-2-line'}.get(file_type, 'ri-file-3-line')

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

    # -- writing ------------------------------------------------------------

    def _dedupe_destination(self, directory, filename):
        original = Path(filename)
        candidate = directory / original.name
        counter = 1
        while candidate.exists():
            candidate = directory / f'{original.stem}-{counter}{original.suffix}'
            counter += 1
        return candidate

    def add_upload(self, uploaded, display_name='', file_type='', icon=''):
        if uploaded is None or not uploaded.filename:
            raise ValueError('file is required')
        file_type = file_type or self.infer_category(uploaded.mimetype or '', uploaded.filename)
        if file_type not in self.categories:
            raise ValueError('invalid category')
        file_id = str(uuid.uuid4())
        original_name = secure_filename(uploaded.filename) or f'upload-{file_id}'
        spec = self.categories[file_type]
        root_path = spec.get('root_path')
        if root_path:
            try:
                root_path.mkdir(parents=True, exist_ok=True)
            except OSError as error:
                raise ValueError(f'cannot write to storage folder: {error}') from error
            destination = self._dedupe_destination(root_path, original_name)
            relative_path = destination.relative_to(root_path).as_posix()
        else:
            destination = self._dedupe_destination(self.source_dir, original_name)
            relative_path = f'storage/{destination.name}'
        try:
            uploaded.save(destination)
        except OSError as error:
            raise ValueError(f'cannot write file: {error}') from error
        pointer = {
            'media_type': file_type,
            'category': file_type,
            'root': file_type,
            'mode': 'managed',
            'path': relative_path,
            'name': display_name.strip() or Path(uploaded.filename).stem,
            'file_name': uploaded.filename,
            'time_added': str(datetime.datetime.now()),
            'tags': [],
            'icon': icon or self.default_icon(file_type),
        }
        self._pointer_path(file_type, file_id).write_text(json.dumps(pointer, indent=2), encoding='utf-8')
        self._invalidate()
        return self.find(file_id)

    def add_reference(self, category_id, abs_path, name=None):
        """Index an existing file in place without moving it (linked mode)."""
        spec = self.categories.get(category_id)
        if not spec or not spec.get('root_path'):
            return None
        root_path = spec['root_path']
        abs_path = Path(abs_path)
        try:
            relative_path = abs_path.resolve().relative_to(root_path.resolve()).as_posix()
        except (OSError, ValueError):
            return None
        abs_path = abs_path.resolve()
        for record in self.read_files():
            try:
                existing_path = self.source_path(record).resolve()
            except OSError:
                continue
            if existing_path == abs_path:
                return record
        file_id = str(uuid.uuid4())
        pointer = {
            'media_type': category_id,
            'category': category_id,
            'root': category_id,
            'mode': 'linked',
            'path': relative_path,
            'name': name or abs_path.stem,
            'file_name': abs_path.name,
            'time_added': str(datetime.datetime.now()),
            'tags': [],
            'icon': self.default_icon(category_id),
        }
        self._pointer_path(category_id, file_id).write_text(json.dumps(pointer, indent=2), encoding='utf-8')
        self._invalidate()
        return self.find(file_id)

    def scan(self, category_id, limit=5000):
        """Index supported files already present under a linked category root."""
        spec = self.categories.get(category_id)
        if not spec or not spec.get('root_path'):
            return 0
        root_path = spec['root_path']
        if not root_path.is_dir():
            return 0
        known = set()
        for record in self.read_files():
            try:
                known.add(self.source_path(record).resolve())
            except OSError:
                continue
        added = 0
        for path in sorted(root_path.rglob('*')):
            if added >= limit:
                break
            if not path.is_file() or path.name.startswith('.'):
                continue
            if not self.file_matches_category(category_id, path):
                continue
            try:
                resolved_path = path.resolve()
            except OSError:
                continue
            if resolved_path in known:
                continue
            if self.add_reference(category_id, path):
                added += 1
                known.add(resolved_path)
        return added

    def relayout_category(self, category_id, new_spec):
        """Relocate managed media or preserve linked sources across a root change."""
        new_root = new_spec.get('root_path')
        if not new_root and new_spec.get('root'):
            new_root = Path(new_spec['root']).expanduser()
        if new_spec.get('mode') == 'linked':
            for record in self.read_files():
                if record['type'] != category_id:
                    continue
                pointer_path = Path(record['pointerPath'])
                pointer = json.loads(pointer_path.read_text(encoding='utf-8'))
                pointer['source_root'] = str(
                    record.get('sourceRoot')
                    or self.categories[category_id].get('root_path')
                    or self.storage_root
                )
                pointer_path.write_text(json.dumps(pointer, indent=2), encoding='utf-8')
            self._invalidate()
            return

        moves = []
        for record in self.read_files():
            if record['type'] != category_id:
                continue
            pointer_path = Path(record['pointerPath'])
            pointer = json.loads(pointer_path.read_text(encoding='utf-8'))
            source = self.source_path(record)
            path = Path(record['path'])
            if not self.categories[category_id].get('root_path') and path.parts[:1] == ('storage',):
                path = Path(*path.parts[1:])
            if new_root is None:
                relative_path = Path('storage') / path
                destination = self.storage_root / relative_path
            else:
                relative_path = path
                destination = new_root / relative_path
            if source.resolve(strict=False) == destination.resolve(strict=False):
                pointer['mode'] = 'managed'
                pointer.pop('source_root', None)
                moves.append((None, None, pointer_path, pointer, relative_path.as_posix()))
                continue
            if source.is_file():
                destination.parent.mkdir(parents=True, exist_ok=True)
                if destination.exists():
                    destination = self._dedupe_destination(destination.parent, destination.name)
                    relative_path = destination.relative_to(
                        self.storage_root if new_root is None else new_root
                    )
                    if new_root is None:
                        relative_path = Path('storage') / relative_path
                moves.append((source, destination, pointer_path, pointer, relative_path.as_posix()))
            else:
                moves.append((None, None, pointer_path, pointer, relative_path.as_posix()))

        completed = []
        pointer_updates = []
        try:
            for source, destination, pointer_path, pointer, relative_path in moves:
                if source is not None:
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(source), str(destination))
                    completed.append((source, destination))
                pointer['path'] = relative_path
                pointer['root'] = category_id
                pointer['mode'] = 'managed'
                pointer.pop('source_root', None)
                previous = pointer_path.read_text(encoding='utf-8')
                pointer_updates.append((pointer_path, previous))
                pointer_path.write_text(json.dumps(pointer, indent=2), encoding='utf-8')
        except (OSError, shutil.Error):
            for pointer_path, previous in reversed(pointer_updates):
                pointer_path.write_text(previous, encoding='utf-8')
            for source, destination in reversed(completed):
                source.parent.mkdir(parents=True, exist_ok=True)
                if destination.exists():
                    shutil.move(str(destination), str(source))
            raise
        self._invalidate()

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
        if payload.get('type') in self.categories and payload['type'] != record['type']:
            pointer['media_type'] = payload['type']
            pointer['category'] = payload['type']
            pointer['root'] = payload['type']
            new_path = self._pointer_path(payload['type'], file_id)
            new_path.write_text(json.dumps(pointer, indent=2), encoding='utf-8')
            pointer_path.unlink(missing_ok=True)
        else:
            pointer_path.write_text(json.dumps(pointer, indent=2), encoding='utf-8')
        self._invalidate()
        return self.find(file_id)

    def delete(self, file_id, delete_source=None):
        """Delete a record.

        Returns 'deleted' (file + pointer removed), 'removed' (pointer only),
        'confirm' (linked file, caller must decide), or None when not found.
        """
        record = self.find(file_id)
        if not record:
            return None
        mode = record.get('mode') or self.categories.get(record['type'], {}).get('mode', 'managed')
        if mode == 'linked' and delete_source is None:
            return 'confirm'
        if delete_source is not False:
            self._source_path(record).unlink(missing_ok=True)
        Path(record['pointerPath']).unlink(missing_ok=True)
        self._invalidate()
        return 'deleted' if delete_source is not False else 'removed'

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
