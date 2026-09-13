import os
import time
import shutil
import subprocess
import threading
import json
import signal

from flask import Response, send_file

FFMPEG = "ffmpeg"
FFPROBE = "ffprobe"

USE_GPU = os.environ.get("FS_GPU", "1") != "0"
VAAPI_DEVICE = os.environ.get("FS_VAAPI_DEVICE", "/dev/dri/renderD128")
QSV_DEVICE = os.environ.get("FS_QSV_DEVICE", "/dev/dri/renderD128")
DEFAULT_AUDIO = os.environ.get("FS_DEFAULT_AUDIO", "eng")
AUDIO_CHANNELS = int(os.environ.get("FS_AUDIO_CHANNELS", "2"))
IDLE_TIMEOUT = float(os.environ.get("FS_HLS_IDLE_TIMEOUT", "60"))
CACHE_MAX_AGE_DAYS = int(os.environ.get("FS_HLS_CACHE_MAX_AGE_DAYS", "7"))
CACHE_MAX_GB = int(os.environ.get("FS_HLS_CACHE_MAX_GB", "0") or 0)

ENCODER_CHAIN = ["vaapi", "qsv", "cpu"] if USE_GPU else ["cpu"]

HLS_TIME = 6
HLS_FLAGS = "independent_segments+temp_file"


def audio_streams(source):
    """Return [{index, a_index, lang}] for each audio stream in the source file."""
    try:
        out = subprocess.run(
            [FFPROBE, "-v", "error", "-print_format", "json",
             "-show_entries", "stream=index,codec_type:stream_tags=language",
             "-select_streams", "a", source],
            capture_output=True, text=True, timeout=20,
        )
        data = json.loads(out.stdout)
        streams = []
        for n, s in enumerate(data.get("streams", [])):
            lang = (s.get("tags") or {}).get("language")
            streams.append({"index": s["index"], "a_index": n, "lang": lang or "und"})
        return streams
    except Exception:
        return []


def audio_index_for_lang(source, lang):
    """Return the ffmpeg per-type audio index of the first track matching lang."""
    for s in audio_streams(source):
        if s["lang"] == lang:
            return s["a_index"]
    return None


def default_audio_index(source, default_lang=None):
    """Pick a single audio stream: prefer default_lang, else the first one."""
    streams = audio_streams(source)
    if not streams:
        return None
    if default_lang:
        for s in streams:
            if s["lang"] == default_lang:
                return s["a_index"]
    return streams[0]["a_index"]


def build_command(source, playlist, encoder=None, audio_index=None, resume_at=None):
    os.makedirs(os.path.dirname(playlist), exist_ok=True)
    if encoder is None:
        encoder = ENCODER_CHAIN[0]
    base, _ = os.path.splitext(playlist)
    output_options = [
        "-c:a", "aac",
        "-ac", str(AUDIO_CHANNELS),
        "-f", "hls",
        "-hls_time", str(HLS_TIME),
        "-hls_list_size", "0",
        "-hls_flags", HLS_FLAGS + ("+append_list" if resume_at is not None else ""),
        "-hls_segment_type", "1",
        "-force_key_frames", f"expr:gte(t,n_forced*{HLS_TIME})",
        "-hls_segment_filename", f"{base}_%03d.mp4",
        playlist,
    ]
    if resume_at is not None:
        # ffmpeg names the first resumed segment 'start_number + seek/6'
        # (the muxer derives it from the input '-ss' format start_time), so
        # a fixed 0 here yields exactly the next index (resume_at is always
        # an even multiple of HLS_TIME).
        output_options[0:0] = ["-start_number", "0"]
    cmd = [FFMPEG, "-y"]
    if encoder == "qsv":
        cmd += ["-init_hw_device", f"qsv=hw:{QSV_DEVICE}"]
    elif encoder == "vaapi":
        cmd += ["-vaapi_device", VAAPI_DEVICE]
    if resume_at is not None:
        cmd += ["-ss", str(resume_at)]
    cmd += ["-i", source]
    if audio_index is not None:
        cmd += ["-map", "0:v:0", "-map", f"0:a:{audio_index}"]
    else:
        cmd += ["-map", "0:v:0", "-an"]
    if encoder == "qsv":
        cmd += ["-c:v", "h264_qsv", "-global_quality", "20"]
    elif encoder == "vaapi":
        cmd += ["-vf", "format=nv12,hwupload", "-c:v", "h264_vaapi"]
    else:
        cmd += ["-c:v", "libx264"]
    return cmd + output_options


def build_audio_command(source, playlist, encoder=None, resume_at=None):
    """Transcode a music file to an audio-only HLS (fMP4) stream."""
    os.makedirs(os.path.dirname(playlist), exist_ok=True)
    if encoder is None:
        encoder = ENCODER_CHAIN[0]
    base, _ = os.path.splitext(playlist)
    output_options = [
        "-vn",
        "-c:a", "aac",
        "-ac", str(AUDIO_CHANNELS),
        "-f", "hls",
        "-hls_time", str(HLS_TIME),
        "-hls_list_size", "0",
        "-hls_flags", HLS_FLAGS + ("+append_list" if resume_at is not None else ""),
        "-hls_segment_type", "1",
        "-hls_segment_filename", f"{base}_%03d.mp4",
        playlist,
    ]
    if resume_at is not None:
        output_options[0:0] = ["-start_number", "0"]
    cmd = [FFMPEG, "-y"]
    if resume_at is not None:
        cmd += ["-ss", str(resume_at)]
    cmd += ["-i", source] + output_options
    return cmd


def start_conversion(source, playlist, encoder=None, audio_index=None, audio_only=False, resume_at=None):
    if audio_only:
        return subprocess.Popen(build_audio_command(source, playlist, encoder, resume_at))
    return subprocess.Popen(build_command(source, playlist, encoder, audio_index, resume_at))


def placeholder_manifest():
    body = ("#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-TARGETDURATION:6\n"
            "#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-INDEPENDENT-SEGMENTS\n")
    return Response(body, mimetype="application/vnd.apple.mpegurl")


def _finalize_playlist(playlist):
    with open(playlist) as f:
        lines = f.read().splitlines()
    out = []
    has_vod_type = False
    for line in lines:
        if line == "#EXT-X-ENDLIST":
            continue
        if line.startswith("#EXT-X-PLAYLIST-TYPE"):
            has_vod_type = True
        out.append(line)
    if not has_vod_type:
        out.insert(1, "#EXT-X-PLAYLIST-TYPE:VOD")
    out.append("#EXT-X-ENDLIST")
    with open(playlist, "w") as f:
        f.write("\n".join(out) + "\n")


class HlsManager:
    def __init__(self, cache_root):
        self.cache_root = cache_root
        self.locks = {}
        self.locks_guard = threading.Lock()
        self.conversions = {}
        self.active_procs = {}
        self.last_access = {}
        self.conversion_gen = {}
        self.default_lang = {}
        self.audio_only = set()
        self.paused = set()
        os.makedirs(cache_root, exist_ok=True)
        self._migrate_legacy_cache(cache_root)
        self._migrate_json_suffix_cache(cache_root)
        threading.Thread(target=self._sweeper, daemon=True).start()
        threading.Thread(target=self._cache_cleaner, daemon=True).start()
        self.run_cache_cleanup()

    def _migrate_legacy_cache(self, cache_root):
        legacy = os.path.join(os.path.dirname(cache_root), ".hls_cache")
        if not os.path.isdir(legacy):
            return
        for entry in os.scandir(legacy):
            dest = os.path.join(cache_root, entry.name)
            if os.path.isdir(dest):
                shutil.rmtree(dest, ignore_errors=True)
            shutil.move(entry.path, dest)
        shutil.rmtree(legacy, ignore_errors=True)
        print("HLS cache migrated to", cache_root, flush=True)

    def _migrate_json_suffix_cache(self, cache_root):
        """Rename cache dirs created when UUIDs still carried their '.json'
        suffix (pre-bare-UUID API) to the extensionless canonical key."""
        if not os.path.isdir(cache_root):
            return
        for entry in os.scandir(cache_root):
            if not entry.is_dir():
                continue
            name = entry.name
            if not name.lower().endswith(".json"):
                continue
            bare = name[: -len(".json")]
            dest = os.path.join(cache_root, bare)
            if os.path.exists(dest):
                shutil.rmtree(entry.path, ignore_errors=True)
            else:
                os.rename(entry.path, dest)
            print(f"HLS cache renamed {name} -> {bare}", flush=True)

    def _key(self, uuid, lang=None):
        return f"{uuid}:{lang}" if lang else uuid

    def _cache_dir(self, uuid, lang=None):
        if lang:
            return os.path.join(self.cache_root, uuid, lang)
        return os.path.join(self.cache_root, uuid)

    def tracks(self, uuid, source):
        streams = audio_streams(source)
        langs = [s["lang"] for s in streams]
        if langs:
            with self.locks_guard:
                self.default_lang[uuid] = (
                    DEFAULT_AUDIO if DEFAULT_AUDIO in langs else langs[0]
                )
        return [{"lang": s["lang"], "a_index": s["a_index"]} for s in streams]

    def default_track(self, uuid, source):
        streams = audio_streams(source)
        if not streams:
            with self.locks_guard:
                self.default_lang.pop(uuid, None)
            return None
        idx = default_audio_index(source, DEFAULT_AUDIO)
        lang = streams[idx]["lang"] if 0 <= idx < len(streams) else streams[0]["lang"]
        with self.locks_guard:
            self.default_lang[uuid] = lang
        return lang

    def ensure_hls(self, uuid, source, lang=None, audio_only=False):
        cache_dir = self._cache_dir(uuid, lang)
        playlist = os.path.join(cache_dir, "stream.m3u8")
        marker = os.path.join(cache_dir, ".source_mtime")
        key = self._key(uuid, lang)
        try:
            source_mtime = str(os.path.getmtime(source))
        except OSError:
            return playlist, "missing"

        with self.locks_guard:
            lock = self.locks.setdefault(key, threading.Lock())

        with lock:
            if os.path.exists(marker) and self._read(marker) == source_mtime:
                return playlist, "done"

            with self.locks_guard:
                state = self.conversions.get(key)
            if isinstance(state, tuple):
                _, failed_at = state
                if time.time() - failed_at < 60:
                    return playlist, "failed"
                state = None
            if state is None:
                if self._has_endlist(playlist):
                    _finalize_playlist(playlist)
                    with open(marker, "w") as m:
                        m.write(source_mtime)
                    with self.locks_guard:
                        self.conversions[key] = "done"
                        if audio_only:
                            self.audio_only.add(key)
                    return playlist, "done"
                resume_at = self._resume_point(cache_dir, playlist)
                if resume_at == 0:
                    self._purge_cache_dir(cache_dir)
                with self.locks_guard:
                    self.conversions[key] = "converting"
                    self.last_access[key] = time.time()
                    if audio_only:
                        self.audio_only.add(key)
                    gen = self.conversion_gen.get(key, 0) + 1
                    self.conversion_gen[key] = gen
                stream_index = None
                if audio_only:
                    stream_index = None
                elif lang:
                    stream_index = audio_index_for_lang(source, lang)
                    if stream_index is None:
                        stream_index = default_audio_index(source)
                else:
                    stream_index = default_audio_index(source)
                thread = threading.Thread(
                    target=self._convert_worker,
                    args=(source, cache_dir, playlist, marker, source_mtime,
                          key, stream_index, audio_only, gen, resume_at),
                    daemon=True,
                )
                thread.start()
            with self.locks_guard:
                cur = self.conversions.get(key, "converting")
            if isinstance(cur, tuple):
                cur = "failed"
            return playlist, cur

    def _has_endlist(self, playlist):
        try:
            with open(playlist) as f:
                return any(line.strip() == "#EXT-X-ENDLIST" for line in f)
        except OSError:
            return False

    def wait_for_playlist_ready(self, cache_dir, timeout=3.0):
        """Wait briefly for the first segment to appear while ffmpeg is warming up."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                for name in os.listdir(cache_dir):
                    lower = name.lower()
                    if lower.startswith("stream_") and lower.endswith(".mp4"):
                        return True
            except OSError:
                pass
            time.sleep(0.2)
        return False

    def _resume_point(self, cache_dir, playlist):
        """Return seconds to resume from, 0 meaning start over.

        Counts completed segments referenced by an existing playlist (no
        ENDLIST == interrupted), so a killed/closed conversion continues
        from the last fully-written segment instead of restarting.
        """
        max_seg = -1
        try:
            with open(playlist) as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("#EXT-X-ENDLIST"):
                        return 0
                    if line.startswith("stream_") and line.endswith(".mp4"):
                        idx = line[len("stream_"):-len(".mp4")]
                        if idx.isdigit():
                            max_seg = max(max_seg, int(idx))
        except OSError:
            return 0
        return (max_seg + 1) * HLS_TIME

    def _purge_cache_dir(self, cache_dir):
        """Remove partial/abandoned artifacts so a fresh run starts clean."""
        if not os.path.isdir(cache_dir):
            return
        for name in os.listdir(cache_dir):
            path = os.path.join(cache_dir, name)
            try:
                if os.path.isdir(path):
                    shutil.rmtree(path, ignore_errors=True)
                else:
                    os.remove(path)
            except OSError:
                pass

    def _convert_worker(self, source, cache_dir, playlist, marker, source_mtime,
                        key, stream_index, audio_only, gen, resume_at):
        try:
            status = self._start_attempt(source, playlist, key, stream_index,
                                         audio_only, gen, resume_at)
            if status == "cancelled":
                return
            if status == "failed":
                raise RuntimeError("conversion failed on all encoders (vaapi, qsv, cpu)")
            _finalize_playlist(playlist)
            with open(marker, "w") as m:
                m.write(source_mtime)
            with self.locks_guard:
                self.paused.discard(key)
                if self.conversion_gen.get(key) == gen:
                    self.conversions[key] = "done"
        except Exception as e:
            with self.locks_guard:
                if self.conversion_gen.get(key) == gen:
                    self.conversions[key] = ("failed", time.time())
            print(f"HLS conversion failed for {key}: {e}", flush=True)
        finally:
            with self.locks_guard:
                if self.conversion_gen.get(key) == gen:
                    self.active_procs.pop(key, None)

    def _start_attempt(self, source, playlist, key, stream_index, audio_only, gen, resume_at=None):
        for i, encoder in enumerate(ENCODER_CHAIN):
            attempt_resume = resume_at if (i == 0 and resume_at) else None
            if attempt_resume is None:
                self._purge_cache_dir(os.path.dirname(playlist))
            proc = start_conversion(source, playlist, encoder=encoder,
                                    audio_index=stream_index, audio_only=audio_only,
                                    resume_at=attempt_resume)
            with self.locks_guard:
                self.active_procs[key] = (proc, os.path.dirname(playlist))
                should_stop = key in self.paused
                stale = self.conversion_gen.get(key) != gen
            if stale:
                print(f"HLS {key}: superseded, terminating orphaned ffmpeg", flush=True)
                try:
                    proc.terminate()
                    proc.wait(timeout=10)
                except (ProcessLookupError, subprocess.TimeoutExpired):
                    try:
                        proc.kill()
                    except (ProcessLookupError, PermissionError):
                        pass
                return "cancelled"
            if should_stop:
                try:
                    proc.send_signal(signal.SIGSTOP)
                except (ProcessLookupError, PermissionError):
                    pass
            rc = proc.wait()
            with self.locks_guard:
                if self.conversion_gen.get(key) != gen:
                    return "cancelled"
            if rc == 0:
                if encoder != ENCODER_CHAIN[0]:
                    print(f"HLS {key}: fell back to encoder '{encoder}'", flush=True)
                return "ok"
        return "failed"

    def _state_string(self, key):
        with self.locks_guard:
            if key in self.paused:
                return "paused"
            state = self.conversions.get(key)
        if isinstance(state, tuple):
            return "failed"
        if isinstance(state, str):
            return state
        return "converting" if state else "none"

    def pause(self, uuid, lang=None):
        """User paused playback: freeze the ffmpeg process (kept from idle sweep)."""
        key = self._key(uuid, lang)
        proc = None
        with self.locks_guard:
            entry = self.active_procs.get(key)
            if entry is not None and entry[0].poll() is None:
                self.paused.add(key)
                self.last_access[key] = time.time()
                proc = entry[0]
        if proc is None:
            return self._state_string(key)
        try:
            proc.send_signal(signal.SIGSTOP)
        except (ProcessLookupError, PermissionError):
            pass
        return "paused"

    def resume(self, uuid, lang=None):
        """User resumed playback: unfreeze a paused ffmpeg process."""
        key = self._key(uuid, lang)
        with self.locks_guard:
            was_paused = key in self.paused
            self.paused.discard(key)
            self.last_access[key] = time.time()
            entry = self.active_procs.get(key)
            proc = entry[0] if entry else None
        if was_paused and proc is not None and proc.poll() is None:
            try:
                proc.send_signal(signal.SIGCONT)
            except (ProcessLookupError, PermissionError):
                pass
        return self._state_string(key)

    def cancel(self, uuid, lang=None):
        """User stopped/closed the player: stop the conversion, keep partial cache."""
        self._kill_conversion(uuid, lang)
        return self._state_string(self._key(uuid, lang))

    def _kill_conversion(self, uuid, lang=None):
        key = self._key(uuid, lang)
        cache_dir = self._cache_dir(uuid, lang)
        with self.locks_guard:
            entry = self.active_procs.pop(key, None)
            self.conversions.pop(key, None)
            self.conversion_gen[key] = self.conversion_gen.get(key, 0) + 1
            was_paused = key in self.paused
            self.paused.discard(key)
        if entry is not None:
            proc = entry[0]
            if proc.poll() is None:
                if was_paused:
                    try:
                        proc.send_signal(signal.SIGCONT)
                    except (ProcessLookupError, PermissionError):
                        pass
                proc.terminate()
                try:
                    proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait()
        self._strip_endlist(cache_dir)
        print(f"Stopped conversion for {key} (cache kept)", flush=True)

    def _strip_endlist(self, cache_dir):
        """Undo ffmpeg's graceful-close finalize on an interrupted conversion.

        ffmpeg appends '#EXT-X-ENDLIST' when it receives SIGTERM mid-stream, so a
        killed conversion would otherwise look complete (and playback would stop at
        the truncated point). Drop the ENDLIST and any trailing partial segment so
        a later open resumes from the last fully-written segment instead.
        """
        playlist = os.path.join(cache_dir, "stream.m3u8")
        try:
            with open(playlist) as f:
                lines = f.read().splitlines()
        except OSError:
            return
        lines = [l for l in lines if l.strip() != "#EXT-X-ENDLIST"]
        uri_idx = [i for i, l in enumerate(lines)
                   if l.startswith("stream_") and l.endswith(".mp4")]
        dropped = []
        while uri_idx:
            last = uri_idx[-1]
            extinf = last - 1
            if extinf < 0 or not lines[extinf].startswith("#EXTINF:"):
                break
            try:
                dur = float(lines[extinf][len("#EXTINF:"):].split(",")[0])
            except ValueError:
                break
            if dur >= 5.0:
                break
            seg = lines[last]
            dropped.append(seg)
            lines[last] = None
            lines[extinf] = None
            uri_idx.pop()
            try:
                os.remove(os.path.join(cache_dir, seg))
            except OSError:
                pass
        lines = [l for l in lines if l is not None]
        if not lines:
            try:
                os.remove(playlist)
            except OSError:
                pass
        else:
            with open(playlist, "w") as f:
                f.write("\n".join(lines) + "\n")
        if dropped:
            print(f"HLS {cache_dir}: dropped partial segment(s) after interrupt: {dropped}", flush=True)

    def _sweeper(self):
        while True:
            time.sleep(10)
            now = time.time()
            with self.locks_guard:
                idle = [
                    key for key in self.active_procs
                    if key not in self.paused
                    and now - self.last_access.get(key, 0) > IDLE_TIMEOUT
                ]
            for key in idle:
                if ":" in key:
                    u, l = key.split(":", 1)
                    self._kill_conversion(u, l)
                else:
                    self._kill_conversion(key)

    def touch(self, uuid, lang=None):
        key = self._key(uuid, lang)
        now = time.time()
        with self.locks_guard:
            self.last_access[key] = now
        cache_dir = self._cache_dir(uuid, lang)
        if os.path.isdir(cache_dir):
            try:
                with open(os.path.join(cache_dir, ".last_access"), "w") as f:
                    f.write(str(int(now)))
            except OSError:
                pass

    def remove(self, uuid):
        """On-demand removal (file deleted): stop conversions and delete its cache."""
        self._kill_conversion(uuid)
        with self.locks_guard:
            keys = [k for k in list(self.conversion_gen) if k.startswith(uuid + ":")]
        for key in keys:
            u, l = key.split(":", 1)
            self._kill_conversion(u, l)
        with self.locks_guard:
            for k in list(self.last_access):
                if k == uuid or k.startswith(uuid + ":"):
                    self.last_access.pop(k, None)
            for k in list(self.audio_only):
                if k == uuid or k.startswith(uuid + ":"):
                    self.audio_only.discard(k)
            self.default_lang.pop(uuid, None)
        shutil.rmtree(os.path.join(self.cache_root, uuid), ignore_errors=True)

    def status(self, uuid, source, lang=None):
        cache_dir = self._cache_dir(uuid, lang)
        marker = os.path.join(cache_dir, ".source_mtime")
        if not os.path.isfile(source):
            return "missing"
        try:
            source_mtime = str(os.path.getmtime(source))
        except OSError:
            return "missing"
        if os.path.exists(marker) and self._read(marker) == source_mtime:
            return "done"
        return self._state_string(self._key(uuid, lang))

    def _dir_size(self, path):
        total = 0
        for root, _, files in os.walk(path):
            for name in files:
                total += os.path.getsize(os.path.join(root, name))
        return total

    def run_cache_cleanup(self):
        if not os.path.isdir(self.cache_root):
            return
        now = time.time()
        aged = []
        for entry in os.scandir(self.cache_root):
            if not entry.is_dir():
                continue
            try:
                with self.locks_guard:
                    converting = any(
                        k == entry.name or k.startswith(entry.name + ":")
                        for k in list(self.active_procs) + list(self.conversions)
                    )
                    if converting:
                        continue
            except OSError:
                pass

            last_file = os.path.join(entry.path, ".last_access")
            try:
                with open(last_file) as f:
                    last = float(f.read().strip())
            except Exception:
                last = entry.stat().st_mtime
            if now - last > CACHE_MAX_AGE_DAYS * 86400:
                shutil.rmtree(entry.path, ignore_errors=True)
                print(f"HLS cache cleaned (age): {entry.name}", flush=True)
            else:
                aged.append((last, entry.name, entry.path))

        if CACHE_MAX_GB and os.path.isdir(self.cache_root):
            limit = CACHE_MAX_GB * 1e9
            total = sum(self._dir_size(p) for _, _, p in aged)
            for _, name, path in sorted(aged):
                if total <= limit:
                    break
                size = self._dir_size(path)
                shutil.rmtree(path, ignore_errors=True)
                total -= size
                print(f"HLS cache cleaned (size cap): {name}", flush=True)

    def _cache_cleaner(self):
        while True:
            time.sleep(3600)
            self.run_cache_cleanup()

    def clear_cache(self):
        with self.locks_guard:
            keys = list(self.active_procs)
        for key in keys:
            if ":" in key:
                u, l = key.split(":", 1)
                self._kill_conversion(u, l)
            else:
                self._kill_conversion(key)
        with self.locks_guard:
            self.conversions.clear()
            self.conversion_gen.clear()
            self.paused.clear()
            self.last_access.clear()
            self.audio_only.clear()
            self.default_lang.clear()
        subprocess.run(["pkill", "-x", "ffmpeg"], capture_output=True)
        if os.path.isdir(self.cache_root):
            shutil.rmtree(self.cache_root, ignore_errors=True)
            os.makedirs(self.cache_root, exist_ok=True)
        print("HLS cache cleared", flush=True)

    def _read(self, filename):
        try:
            with open(filename, "r") as f:
                return f.read()
        except OSError:
            return ""