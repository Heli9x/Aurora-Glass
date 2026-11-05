import shutil


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
        live = {
            record['id']
            for record in self.media.read_files()
            if record.get('type') == 'photos' and record['exists']
        }
        photos_cache = self.media.category_cache_dir('photos')
        removed = 0
        if photos_cache.is_dir():
            for entry in photos_cache.iterdir():
                if entry.is_dir() and entry.name not in live:
                    shutil.rmtree(entry, ignore_errors=True)
                    removed += 1
        return removed
