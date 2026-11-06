import os
import sys
from pathlib import Path

# XDG user-dirs keys -> Filey category ids.
XDG_KEYS = {
    'XDG_VIDEOS_DIR': 'movies',
    'XDG_MUSIC_DIR': 'music',
    'XDG_PICTURES_DIR': 'photos',
}

# Fallback folder names per category, in preference order.
FALLBACK_NAMES = {
    'movies': ('Videos', 'Movies'),
    'music': ('Music',),
    'photos': ('Pictures',),
}


def _xdg_config_home():
    return Path(os.environ.get('XDG_CONFIG_HOME') or (Path.home() / '.config'))


def _parse_user_dirs():
    values = {}
    try:
        text = (_xdg_config_home() / 'user-dirs.dirs').read_text(encoding='utf-8')
    except OSError:
        return values
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, _, raw = line.partition('=')
        key = key.strip()
        if key not in XDG_KEYS:
            continue
        value = raw.strip().strip('"').replace('$HOME', str(Path.home()))
        if value:
            values[key] = value
    return values


def native_media_roots():
    """Return {category_id: absolute_path} for OS-native media folders that exist."""
    home = Path.home()
    candidates = {}

    if os.name == 'nt':
        base = Path(os.environ.get('USERPROFILE') or home)
        candidates = {
            'movies': base / 'Videos',
            'music': base / 'Music',
            'photos': base / 'Pictures',
        }
    elif sys.platform == 'darwin':
        candidates = {
            'movies': home / 'Movies',
            'music': home / 'Music',
            'photos': home / 'Pictures',
        }
    else:
        xdg = _parse_user_dirs()
        for key, category_id in XDG_KEYS.items():
            if key in xdg:
                candidates[category_id] = Path(xdg[key])
        for category_id, names in FALLBACK_NAMES.items():
            candidates.setdefault(category_id, home / names[0])

    for category_id, names in FALLBACK_NAMES.items():
        if category_id in candidates:
            continue
        for name in names:
            candidate = home / name
            if candidate.is_dir():
                candidates[category_id] = candidate
                break

    roots = {}
    for category_id, path in candidates.items():
        try:
            if path.is_dir():
                roots[category_id] = str(path)
        except OSError:
            continue
    return roots
