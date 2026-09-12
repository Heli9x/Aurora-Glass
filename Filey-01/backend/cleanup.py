import os
from pathlib import Path


class CleanupService:
    """Removes missing media records and stale generated caches."""

    def __init__(self, media_library, photo_service, hls_service=None):
        self.media = media_library
        self.photos = photo_service
        self.hls = hls_service

    def clean(self):
        removed_records = self.media.clean_missing()
        if self.hls:
            for record in self.media.read_files():
                if not record['exists']:
                    self.hls.remove(record['id'])
        removed_cache = self.clean_photo_cache()
        if self.hls:
            self.hls.run_cache_cleanup()
        return {'success': True, 'removed': removed_records, 'cache': removed_cache, 'remaining': len(self.media.read_files())}

    def clean_photo_cache(self):
        expected = set()
        for record in self.media.read_files():
            if record.get('type') != 'photos':
                continue
            source = self.photos.source_path(record)
            if not source.is_file():
                continue
            stamp = int(source.stat().st_mtime)
            stem = Path(record.get('originalName', record['name'])).stem
            expected.add(f'{stem}_{stamp}.webp')
            expected.add(f'{stem}_{stamp}.thumb.webp')
        removed = 0
        for folder in (self.photos.cache_dir, self.photos.thumbnail_dir):
            for item in folder.glob('*.webp'):
                if item.name not in expected:
                    item.unlink(missing_ok=True)
                    removed += 1
        return removed
