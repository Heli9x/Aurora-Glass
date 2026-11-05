import json
import os
import re
import shutil
from pathlib import Path

CONFIG_FILENAME = '.filey-config.json'
DEFAULT_NAME = 'Filey'

ALLOWED_KEYS = {'platform_name', 'storage_dir', 'hls', 'categories'}

HLS_PRESETS = (
    'ultrafast', 'superfast', 'veryfast', 'faster', 'fast',
    'medium', 'slow', 'slower', 'veryslow',
)
HLS_RANGES = {
    'concurrency': (1, 32),
    'rlimit_mb': (0, 32768),
    'x264_threads': (1, 64),
    'rc_lookahead': (0, 64),
}

CATEGORY_MODES = ('managed', 'linked')
DEFAULT_CATEGORY = 'other'

# Built-in libraries. Their binary roots default to the Filey storage folder
# (root=None) so an untouched config behaves exactly like the legacy layout.
BUILTIN_CATEGORIES = {
    'movies': {
        'label': 'Movies', 'icon': 'ri-play-fill',
        'extensions': ['.mp4', '.mkv', '.webm', '.mov'],
    },
    'music': {
        'label': 'Music', 'icon': 'ri-music-2-fill',
        'extensions': ['.mp3', '.wav', '.ogg', '.flac', '.m4a'],
    },
    'photos': {
        'label': 'Photos', 'icon': 'ri-image-2-line',
        'extensions': ['.png', '.jpg', '.jpeg', '.gif', '.webp'],
    },
    'other': {
        'label': 'Other', 'icon': 'ri-file-3-line', 'extensions': [],
    },
}
BUILTIN_CATEGORY_IDS = tuple(BUILTIN_CATEGORIES)
RESERVED_CATEGORY_IDS = set(BUILTIN_CATEGORY_IDS) | {
    'storage', 'cache', 'thumbnails', 'files', 'api', 'static',
}


def is_valid_category_id(category_id):
    return bool(isinstance(category_id, str)
                and re.fullmatch(r'[a-z0-9][a-z0-9-]{0,39}', category_id))


def slugify_category(label):
    slug = re.sub(r'[^a-z0-9]+', '-', str(label or '').strip().lower()).strip('-')
    return slug[:40]


def _clean_extensions(values):
    cleaned = []
    for value in values or []:
        extension = str(value).strip().lower()
        if not extension:
            continue
        if not extension.startswith('.'):
            extension = '.' + extension
        if extension not in cleaned:
            cleaned.append(extension)
    return cleaned


def default_categories():
    return {
        category_id: {
            'label': spec['label'],
            'root': None,
            'mode': 'managed',
            'extensions': list(spec['extensions']),
            'icon': spec['icon'],
            'builtin': True,
        }
        for category_id, spec in BUILTIN_CATEGORIES.items()
    }


def normalize_category(category_id, spec, base=None):
    base = base or {}
    root = spec.get('root', base.get('root'))
    root = str(root).strip() if root else None
    mode = str(spec.get('mode', base.get('mode', 'managed'))).strip().lower()
    if mode not in CATEGORY_MODES:
        mode = 'managed'
    label = str(spec.get('label') or base.get('label') or category_id).strip() or category_id
    icon = str(spec.get('icon') or base.get('icon') or 'ri-file-3-line')
    extensions = _clean_extensions(spec.get('extensions', base.get('extensions', [])))
    return {
        'label': label[:40],
        'root': root,
        'mode': mode,
        'extensions': extensions,
        'icon': icon,
        'builtin': bool(base.get('builtin')),
    }


def effective_categories(config):
    """Return the full category registry, merging config over the built-ins."""
    defaults = default_categories()
    categories = {}
    raw = config.get('categories') if isinstance(config, dict) else None
    if isinstance(raw, dict):
        for category_id, spec in raw.items():
            if not is_valid_category_id(category_id) or not isinstance(spec, dict):
                continue
            base = defaults.get(category_id) or {}
            categories[category_id] = normalize_category(category_id, spec, base)
    for category_id, spec in defaults.items():
        categories.setdefault(category_id, spec)
    return categories


def validate_category_root(path, mode='managed'):
    if not path:
        return False, 'A storage path is required'
    candidate = Path(str(path)).expanduser()
    if mode == 'linked':
        if not candidate.is_dir():
            return False, 'Linked folder does not exist'
        if not os.access(candidate, os.R_OK):
            return False, 'Linked folder is not readable'
        return True, ''
    if candidate.exists():
        if not candidate.is_dir():
            return False, 'Path is not a directory'
        if not os.access(candidate, os.W_OK):
            return False, 'Directory is not writable'
        return True, ''
    parent = candidate.parent
    if not parent.is_dir():
        return False, 'Parent directory does not exist'
    if not os.access(parent, os.W_OK):
        return False, 'Parent directory is not writable'
    return True, ''


def validate_category(payload, existing_ids=()):
    """Validate an event-driven category creation request."""
    if not isinstance(payload, dict):
        return False, 'category must be an object', None
    label = str(payload.get('label') or '').strip()
    if not label or len(label) > 40:
        return False, 'Label must be 1-40 characters', None
    category_id = payload.get('id') or slugify_category(label)
    category_id = str(category_id).strip().lower()
    if not is_valid_category_id(category_id):
        return False, 'Category id is invalid', None
    if category_id in RESERVED_CATEGORY_IDS or category_id in set(existing_ids):
        return False, f'"{category_id}" is reserved or already exists', None
    mode = str(payload.get('mode') or 'managed').strip().lower()
    if mode not in CATEGORY_MODES:
        return False, 'Mode must be "managed" or "linked"', None
    root = payload.get('root')
    root = str(root).strip() if root else None
    if root is not None:
        ok, reason = validate_category_root(root, mode)
        if not ok:
            return False, reason, None
    spec = normalize_category(category_id, {
        'label': label,
        'root': root,
        'mode': mode,
        'extensions': payload.get('extensions') or [],
        'icon': payload.get('icon') or 'ri-file-3-line',
    }, {'builtin': False})
    return True, '', {'id': category_id, 'spec': spec}


def normalize_categories_payload(raw, existing=None):
    """Validate a full 'categories' settings object (built-ins preserved)."""
    defaults = default_categories()
    existing = existing or defaults
    result = {}
    if isinstance(raw, dict):
        for category_id, spec in raw.items():
            if not is_valid_category_id(category_id) or not isinstance(spec, dict):
                continue
            base = existing.get(category_id) or defaults.get(category_id) or {}
            normalized = normalize_category(category_id, spec, base)
            if normalized['root']:
                ok, reason = validate_category_root(normalized['root'], normalized['mode'])
                if not ok:
                    return False, f'{category_id}: {reason}', None
            result[category_id] = normalized
    for category_id, spec in defaults.items():
        if category_id not in result:
            result[category_id] = existing.get(category_id) or spec
    return True, '', result


def default_storage_dir():
    username = os.environ.get('SUDO_USER') or os.environ.get('USER') or Path.home().name
    return Path('/run/media') / username / 'FS-STORAGE'


def config_path(storage_root):
    return Path(storage_root) / CONFIG_FILENAME


def load_config(storage_root):
    try:
        data = json.loads(config_path(storage_root).read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        return {}
    return {key: value for key, value in data.items() if key in ALLOWED_KEYS}


def validate_hls_settings(value):
    """Validate a user-supplied 'hls' settings dict, normalising integers in place."""
    if not isinstance(value, dict):
        return False, 'hls settings must be an object'
    for key in value:
        if key not in HLS_RANGES and key != 'preset':
            return False, f'unknown hls setting: {key}'
    for key, (low, high) in HLS_RANGES.items():
        if key not in value:
            continue
        try:
            number = int(value[key])
        except (TypeError, ValueError):
            return False, f'"{key}" must be an integer'
        if not (low <= number <= high):
            return False, f'"{key}" must be between {low} and {high}'
        value[key] = number
    if 'preset' in value:
        preset = value['preset']
        if preset is None:
            preset = ''
        if not isinstance(preset, str) or (preset and preset not in HLS_PRESETS):
            return False, f'"preset" must be one of: {", ".join(HLS_PRESETS)}'
        value['preset'] = preset
    return True, ''


def save_config(storage_root, platform_name=None, storage_dir=None, hls=None, categories=None):
    root = Path(storage_root)
    root.mkdir(parents=True, exist_ok=True)
    current = load_config(root)
    if platform_name is not None:
        current['platform_name'] = platform_name
    if storage_dir is not None:
        current['storage_dir'] = storage_dir
    if hls is not None:
        current['hls'] = hls
    if categories is not None:
        current['categories'] = categories
    config_path(root).write_text(json.dumps(current, indent=2), encoding='utf-8')
    return current


def discover_storage_roots(extra=None):
    roots = []
    if extra:
        for raw in extra:
            if raw:
                roots.append(Path(raw))
    roots.append(default_storage_dir())
    for raw in [
        '/run/media',
        '/mnt/data',
        '/mnt',
        '/media',
    ]:
        roots.append(Path(raw))
    folded = []
    for root in roots:
        if root in folded:
            continue
        folded.append(root)
        if not root.is_dir():
            continue
        try:
            usage = shutil.disk_usage(root)
            free = usage.free
        except OSError:
            free = 0
        yield {
            'path': str(root),
            'exists_schema': (root / 'storage').is_dir(),
            'writable': os.access(root, os.W_OK),
            'free_bytes': free,
        }


def validate_storage_dir(path):
    candidate = Path(str(path)).expanduser()
    if not candidate.is_dir():
        return False, 'Path is not an existing directory'
    if not os.access(candidate, os.W_OK):
        return False, 'Directory is not writable'
    if not (candidate / 'storage').is_dir() and any(candidate.iterdir()):
        return False, 'Directory must be empty or already contain a Filey storage layout'
    return True, ''