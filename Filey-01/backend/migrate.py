"""One-time migration of legacy caches into the per-category cache layout.

Before v3.1.0 caches lived under ``<storage>/storage/_webp`` and
``<storage>/storage/_hls_filey01``. They now live in Filey's managed space at
``<storage_root>/<category>/cache/<uuid>/``.

The migration is idempotent: it only acts on directories that still exist, moves
what it can, and regenerates anything it cannot map.
"""

import re
import shutil
from pathlib import Path

WEBP_NAME = re.compile(r'^(?P<stem>.+)_(?P<stamp>\d+)(?P<thumb>\.thumb)?\.webp$')


def preview_caches(media):
    """Describe what migrate_caches would move without touching the filesystem."""
    storage_root = Path(media.storage_root)
    legacy_root = storage_root / 'storage'
    moves = {'hls': 0, 'photos': 0}
    if not legacy_root.is_dir():
        return moves
    for legacy in (legacy_root / '_hls_filey01', legacy_root / '.hls_cache'):
        if legacy.is_dir():
            moves['hls'] += sum(1 for entry in legacy.iterdir() if entry.is_dir())
    webp = legacy_root / '_webp'
    if webp.is_dir():
        moves['photos'] += sum(1 for _ in webp.rglob('*.webp'))
    return moves


def migrate_caches(media):
    """Relocate legacy HLS and photo caches. Returns the number of entries moved."""
    storage_root = Path(media.storage_root)
    legacy_root = storage_root / 'storage'
    moved = 0
    if not legacy_root.is_dir():
        return 0
    for legacy in (legacy_root / '_hls_filey01', legacy_root / '.hls_cache'):
        if legacy.is_dir():
            moved += _migrate_hls(media, legacy)
    webp = legacy_root / '_webp'
    if webp.is_dir():
        moved += _migrate_webp(media, webp)
    return moved


def _migrate_hls(media, legacy):
    moved = 0
    for entry in list(legacy.iterdir()):
        if not entry.is_dir():
            continue
        record = media.find(entry.name)
        category = record['type'] if record else 'other'
        destination = media.category_cache_dir(category) / entry.name
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            shutil.rmtree(destination, ignore_errors=True)
        try:
            shutil.move(str(entry), str(destination))
            moved += 1
        except OSError:
            continue
    _remove_if_empty(legacy)
    return moved


def _migrate_webp(media, legacy):
    by_stem = {}
    for record in media.read_files():
        if record.get('type') != 'photos':
            continue
        stem = Path(record.get('originalName') or record.get('name') or '').stem
        by_stem.setdefault(stem, record)
    moved = 0
    for item in list(legacy.rglob('*.webp')):
        match = WEBP_NAME.match(item.name)
        if not match:
            continue
        record = by_stem.get(match.group('stem'))
        if not record:
            continue
        destination = media.cache_dir(record) / ('thumb.webp' if match.group('thumb') else 'full.webp')
        destination.parent.mkdir(parents=True, exist_ok=True)
        try:
            shutil.move(str(item), str(destination))
            moved += 1
        except OSError:
            continue
    shutil.rmtree(legacy, ignore_errors=True)
    return moved


def _remove_if_empty(directory):
    try:
        if not any(directory.iterdir()):
            directory.rmdir()
    except OSError:
        pass
