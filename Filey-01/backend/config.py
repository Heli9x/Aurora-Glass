import json
import os
import shutil
from pathlib import Path

CONFIG_FILENAME = '.filey-config.json'
DEFAULT_NAME = 'Filey'


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
    return {key: value for key, value in data.items() if key in {'platform_name', 'storage_dir'}}


def save_config(storage_root, platform_name=None, storage_dir=None):
    root = Path(storage_root)
    root.mkdir(parents=True, exist_ok=True)
    current = load_config(root)
    if platform_name is not None:
        current['platform_name'] = platform_name
    if storage_dir is not None:
        current['storage_dir'] = storage_dir
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