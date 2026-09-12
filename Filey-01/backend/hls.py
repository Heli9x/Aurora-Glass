import os
import shutil
import signal
import subprocess
import threading
import time
from pathlib import Path


class HlsService:
    """Manages cached HLS conversion jobs for video and audio media."""

    FORMAT_VERSION = '3-project26-cpu-profile'

    def __init__(self, cache_dir, idle_timeout=60):
        self.cache_dir = Path(cache_dir)
        self.audio_cache_dir = self.cache_dir.parent / '_audio'
        self.transcode_cache_dir = self.cache_dir.parent / '_transcoded'
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.audio_cache_dir.mkdir(parents=True, exist_ok=True)
        self.transcode_cache_dir.mkdir(parents=True, exist_ok=True)
        self.idle_timeout = idle_timeout
        self.jobs = {}
        self.transcode_jobs = {}
        self.lock = threading.Lock()

    def _job_dir(self, file_id):
        return self.cache_dir / file_id

    def _playlist(self, file_id):
        return self._job_dir(file_id) / 'stream.m3u8'

    def _command(self, source, playlist, audio_only=False):
        playlist.parent.mkdir(parents=True, exist_ok=True)
        segment_pattern = str(playlist.with_name('segment_%03d.m4s'))
        command = ['ffmpeg', '-y', '-i', str(source)]
        if audio_only:
            command += ['-map', '0:a:0', '-vn', '-c:a', 'aac', '-profile:a', 'aac_low', '-ar', '48000', '-ac', '2']
        else:
            command += ['-map', '0:v:0', '-map', '0:a:0', '-c:v', 'libx264', '-c:a', 'aac', '-profile:a', 'aac_low', '-ar', '48000', '-ac', '2']
        return command + ['-f', 'hls', '-hls_time', '6', '-hls_list_size', '0', '-hls_flags', 'independent_segments+temp_file', '-hls_segment_type', 'fmp4', '-force_key_frames', 'expr:gte(t,n_forced*6)', '-hls_fmp4_init_filename', 'init.mp4', '-hls_segment_filename', segment_pattern, str(playlist)]

    def ensure(self, file_id, source, audio_only=False):
        source = Path(source)
        playlist = self._playlist(file_id)
        if not source.is_file():
            return {'status': 'missing', 'playlist': playlist}
        if playlist.is_file():
            playlist_text = playlist.read_text(errors='ignore')
            version_file = self._job_dir(file_id) / '.format_version'
            cached_version = version_file.read_text(errors='ignore').strip() if version_file.is_file() else ''
            if cached_version != self.FORMAT_VERSION or '#EXT-X-MAP' not in playlist_text:
                self._purge_cache_dir(self._job_dir(file_id))
            elif '#EXT-X-ENDLIST' in playlist_text:
                return {'status': 'done', 'playlist': playlist}
        with self.lock:
            job = self.jobs.get(file_id)
            if job and job['process'].poll() is None:
                job['last_access'] = time.time()
                return {'status': 'converting', 'playlist': playlist}
            process = subprocess.Popen(self._command(source, playlist, audio_only), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            self.jobs[file_id] = {'process': process, 'last_access': time.time()}
        threading.Thread(target=self._finish, args=(file_id, process, playlist), daemon=True).start()
        return {'status': 'converting', 'playlist': playlist}

    def _finish(self, file_id, process, playlist):
        return_code = process.wait()
        if return_code == 0:
            (playlist.parent / '.format_version').write_text(self.FORMAT_VERSION, encoding='utf-8')
        with self.lock:
            job = self.jobs.get(file_id)
            if job:
                job['status'] = 'done' if return_code == 0 else 'failed'
                job['last_access'] = time.time()

    def status(self, file_id):
        with self.lock:
            job = self.jobs.get(file_id)
            if job and job.get('process') and job['process'].poll() is None:
                return 'converting'
            if job and job.get('status'):
                return job['status']
        return 'done' if self._playlist(file_id).is_file() else 'idle'

    def pause(self, file_id):
        return self._signal(file_id, 'STOP')

    def resume(self, file_id):
        return self._signal(file_id, 'CONT')

    def cancel(self, file_id):
        with self.lock:
            job = self.jobs.get(file_id)
        if not job or job['process'].poll() is not None:
            return 'idle'
        job['process'].terminate()
        return 'cancelled'

    def cancel_all(self):
        stopped = 0
        with self.lock:
            jobs = list(self.jobs.values())
            transcode_jobs = list(self.transcode_jobs.values())
            self.jobs.clear()
            self.transcode_jobs.clear()
        for job in jobs:
            process = job['process']
            if process.poll() is None:
                process.terminate()
                stopped += 1
        for job in transcode_jobs:
            process = job['process']
            if process.poll() is None:
                process.terminate()
                stopped += 1
        return stopped

    def _signal(self, file_id, signal_name):
        with self.lock:
            job = self.jobs.get(file_id)
        if not job or job['process'].poll() is not None:
            return 'idle'
        job['process'].send_signal(getattr(signal, f'SIG{signal_name}'))
        return 'paused' if signal_name == 'STOP' else 'converting'

    def remove(self, file_id):
        with self.lock:
            job = self.jobs.pop(file_id, None)
        if job and job['process'].poll() is None:
            job['process'].terminate()
        shutil.rmtree(self._job_dir(file_id), ignore_errors=True)

    def clean_cache(self):
        removed = 0
        for directory in self.cache_dir.iterdir():
            if not directory.is_dir():
                continue
            if not any(directory.iterdir()):
                directory.rmdir()
                removed += 1
        return removed

    def ensure_audio_mp3(self, file_id, source):
        destination = self.audio_cache_dir / f'{file_id}.mp3'
        if destination.is_file():
            return destination
        command = ['ffmpeg', '-y', '-i', str(source), '-vn', '-map', '0:a:0', '-c:a', 'libmp3lame', '-q:a', '2', str(destination)]
        result = subprocess.run(command, capture_output=True, timeout=180)
        if result.returncode != 0:
            destination.unlink(missing_ok=True)
            raise RuntimeError(result.stderr.decode(errors='replace')[-500:])
        return destination

    def _transcode_path(self, file_id):
        return self.transcode_cache_dir / f'{file_id}.mp4'

    def ensure_progressive(self, file_id, source):
        destination = self._transcode_path(file_id)
        if destination.is_file() and self._valid_mp4(destination):
            return 'done'
        destination.unlink(missing_ok=True)
        with self.lock:
            job = self.transcode_jobs.get(file_id)
            if job and job['process'].poll() is None:
                return 'converting'
            partial = destination.with_suffix('.part.mp4')
            partial.unlink(missing_ok=True)
            command = ['ffmpeg', '-y', '-i', str(source), '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-c:a', 'aac', '-profile:a', 'aac_low', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', str(partial)]
            process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            self.transcode_jobs[file_id] = {'process': process, 'status': 'converting', 'partial': partial, 'destination': destination}
        threading.Thread(target=self._finish_progressive, args=(file_id, process, partial, destination), daemon=True).start()
        return 'converting'

    def _finish_progressive(self, file_id, process, partial, destination):
        status = 'failed'
        if process.wait() == 0 and partial.is_file() and self._valid_mp4(partial):
            os.replace(partial, destination)
            status = 'done'
        else:
            partial.unlink(missing_ok=True)
        with self.lock:
            self.transcode_jobs[file_id] = {'process': process, 'status': status}

    def progressive_status(self, file_id):
        with self.lock:
            job = self.transcode_jobs.get(file_id)
            if job:
                return job['status'] if job['process'].poll() is not None else 'converting'
        return 'done' if self._transcode_path(file_id).is_file() else 'idle'

    def cancel_progressive(self, file_id):
        with self.lock:
            job = self.transcode_jobs.get(file_id)
        if job and job['process'].poll() is None:
            job['process'].terminate()
            return 'cancelled'
        return 'idle'

    @staticmethod
    def _valid_mp4(path):
        result = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return result.returncode == 0

    @staticmethod
    def _purge_cache_dir(directory):
        if not directory.is_dir():
            return
        for item in directory.iterdir():
            if item.is_dir():
                shutil.rmtree(item, ignore_errors=True)
            else:
                item.unlink(missing_ok=True)
