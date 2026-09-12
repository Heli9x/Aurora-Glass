import os
import subprocess
import threading
from pathlib import Path


class PhotoService:
    """Creates cached WebP images and thumbnails on demand."""

    def __init__(self, source_dir, cache_dir, thumbnail_size=280):
        self.source_dir = Path(source_dir)
        self.cache_dir = Path(cache_dir)
        self.thumbnail_dir = self.cache_dir / 'thumbnails'
        self.thumbnail_size = thumbnail_size
        self.locks = {}
        self.guard = threading.Lock()
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.thumbnail_dir.mkdir(parents=True, exist_ok=True)

    def source_path(self, record):
        return self.source_dir / record['path'].split('/', 1)[1] if record.get('path', '').startswith('storage/') else self.source_dir / record['storedName']

    def cache_path(self, record, thumbnail=False):
        source = self.source_path(record)
        stamp = int(source.stat().st_mtime)
        stem = Path(record['originalName']).stem
        target_dir = self.thumbnail_dir if thumbnail else self.cache_dir
        suffix = '.thumb' if thumbnail else ''
        return target_dir / f'{stem}_{stamp}{suffix}.webp'

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
            temporary = destination.with_suffix('.tmp.webp')
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
