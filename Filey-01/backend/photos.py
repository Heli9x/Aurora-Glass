import os
import subprocess
import threading
from pathlib import Path


class PhotoService:
    """Creates cached WebP images and thumbnails on demand.

    Caches live in Filey's managed space, one folder per media UUID:
    ``<storage_root>/photos/cache/<uuid>/{full,thumb}.webp``.
    """

    def __init__(self, media, thumbnail_size=280):
        self.media = media
        self.thumbnail_size = thumbnail_size
        self.locks = {}
        self.guard = threading.Lock()

    def source_path(self, record):
        return self.media.source_path(record)

    def cache_dir(self, record):
        return self.media.cache_dir(record)

    def cache_path(self, record, thumbnail=False):
        return self.cache_dir(record) / ('thumb.webp' if thumbnail else 'full.webp')

    def ensure_webp(self, record, thumbnail=False):
        source = self.source_path(record)
        if not source.is_file():
            raise FileNotFoundError(source)
        destination = self.cache_path(record, thumbnail)
        if destination.is_file():
            return destination
        key = (record['id'], thumbnail)
        with self.guard:
            lock = self.locks.setdefault(key, threading.Lock())
        with lock:
            if destination.is_file():
                return destination
            destination.parent.mkdir(parents=True, exist_ok=True)
            temporary = destination.with_name(destination.stem + '.tmp.webp')
            command = ['ffmpeg', '-y', '-i', str(source)]
            if thumbnail:
                command += ['-vf', f'scale=min({self.thumbnail_size}\\,iw):-2']
            command += ['-c:v', 'libwebp', '-quality', '85', '-f', 'webp', str(temporary)]
            try:
                result = subprocess.run(command, capture_output=True, timeout=90)
                if result.returncode != 0:
                    raise RuntimeError(result.stderr.decode(errors='replace')[-500:])
                os.replace(temporary, destination)
            except subprocess.TimeoutExpired as error:
                raise RuntimeError('thumbnail generation timed out') from error
            finally:
                temporary.unlink(missing_ok=True)
        return destination
