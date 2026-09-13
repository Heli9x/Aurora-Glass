import os
import shutil
from pathlib import Path

from flask import Flask, Response, jsonify, request, send_file, send_from_directory
from flask_cors import CORS

from backend import config as app_config
from backend.cleanup import CleanupService
from backend.media import MediaLibrary
from backend.photos import PhotoService

BASE_DIR = Path(__file__).resolve().parent
fallback_storage = BASE_DIR / 'backend-data'

preferred_storage = os.environ.get('FILEY_STORAGE_DIR', '')


def resolve_storage_dir():
    if preferred_storage and Path(preferred_storage).expanduser().is_dir():
        return Path(preferred_storage).expanduser()
    heads = [Path(preferred_storage).expanduser()] if preferred_storage else []
    for raw in [
        '/run/media',
        '/mnt/data',
        '/mnt',
        '/media',
    ]:
        heads.append(Path(raw))
    for head in heads:
        if head.is_dir() and app_config.config_path(head).is_file():
            return head
    for head in heads:
        if head.is_dir():
            return head
    return fallback_storage


STORAGE_DIR = resolve_storage_dir()
PLATFORM_NAME = app_config.load_config(STORAGE_DIR).get('platform_name') or app_config.DEFAULT_NAME

from backend.hls_project26 import HlsManager, placeholder_manifest
app = Flask(__name__, static_folder=str(BASE_DIR), static_url_path='')
CORS(app)
media = MediaLibrary(STORAGE_DIR)
photos = PhotoService(media.upload_dir, media.storage_root / 'storage' / '_webp')
hls = HlsManager(str(media.storage_root / 'storage' / '_hls_filey01'))
cleanup = CleanupService(media, photos, hls)


@app.get('/')
def index():
    index_path = BASE_DIR / 'index.html'
    if index_path.exists():
        return send_from_directory(BASE_DIR, 'index.html')
    return jsonify({'status': 'ok', 'service': 'Filey'}), 200


@app.get('/api/health')
def health():
    return jsonify({
        'status': 'ok',
        'service': PLATFORM_NAME,
        'platform_name': PLATFORM_NAME,
        'storage_dir': str(STORAGE_DIR),
        'api_version': '1.0',
    })


@app.get('/api/discovery')
def discovery():
    return jsonify({
        'name': PLATFORM_NAME,
        'service': PLATFORM_NAME,
        'platform_name': PLATFORM_NAME,
        'api_version': '1.0',
        'root': '/',
        'files_path': '/api/files',
    })


@app.get('/api/settings')
def settings_get():
    return jsonify({
        'platform_name': PLATFORM_NAME,
        'storage_dir': str(STORAGE_DIR),
        'candidates': list(app_config.discover_storage_roots(extra=[preferred_storage] if preferred_storage else [])),
    })


@app.post('/api/settings')
def settings_post():
    global PLATFORM_NAME
    payload = request.get_json(silent=True) or {}
    name = str(payload.get('name') or '').strip() if 'name' in payload else None
    if name is not None and (not name or len(name) > 40):
        return jsonify({'error': 'Platform name must be 1-40 characters'}), 400
    new_dir = str(payload.get('storage_dir') or '').strip() if 'storage_dir' in payload else None
    if new_dir is not None:
        ok, reason = app_config.validate_storage_dir(new_dir)
        if not ok:
            return jsonify({'error': reason}), 400
    target = STORAGE_DIR
    if new_dir is not None:
        target = Path(new_dir).expanduser()
    if name is None:
        name = app_config.load_config(target).get('platform_name') or PLATFORM_NAME
    app_config.save_config(target, platform_name=name, storage_dir=str(target))
    if name != PLATFORM_NAME:
        PLATFORM_NAME = name
    requires_restart = new_dir is not None and Path(new_dir).expanduser() != STORAGE_DIR
    return jsonify({
        'applied': True,
        'platform_name': name,
        'storage_dir': str(target),
        'requires_restart': requires_restart,
    })


@app.get('/api/stats')
def stats():
    records = media.read_sorted(None, 'default')
    counts = {'movies': 0, 'music': 0, 'photos': 0, 'other': 0}
    for record in records:
        counts[record['type']] = counts.get(record['type'], 0) + 1

    def dir_bytes(root):
        total = 0
        file_count = 0
        if root.is_dir():
            for item in root.rglob('*'):
                if item.is_file():
                    total += item.stat().st_size
                    file_count += 1
        return total, file_count

    hls_bytes, hls_files = dir_bytes(media.storage_root / 'storage' / '_hls_filey01')
    photo_bytes, _ = dir_bytes(media.storage_root / 'storage' / '_webp')
    try:
        usage = shutil.disk_usage(media.storage_root)
        free, used, total = usage.free, usage.used, usage.total
    except OSError:
        free = used = total = 0
    return jsonify({
        'total': len(records),
        'counts': counts,
        'hls_cache': {'bytes': hls_bytes, 'files': hls_files},
        'photo_cache': {'bytes': photo_bytes},
        'storage': {'free': free, 'used': used, 'total': total},
    })


@app.get('/api/files')
def list_files():
    try:
        page = max(1, int(request.args.get('page', 1)))
    except (TypeError, ValueError):
        page = 1
    try:
        per_page = min(100, max(1, int(request.args.get('per_page', 24))))
    except (TypeError, ValueError):
        per_page = 24
    sort = request.args.get('sort', 'default')
    media_type = request.args.get('type') or None
    records = [media.public_record(item) for item in media.read_sorted(media_type, sort)]
    files, total = media.paginate(records, page, per_page)
    return jsonify({'files': files, 'total': total, 'page': page, 'per_page': per_page})


@app.post('/api/upload')
def upload_file():
    try:
        record = media.add_upload(
            request.files.get('file'),
            display_name=request.form.get('name', ''),
            file_type=request.form.get('category', ''),
            icon=request.form.get('icon', ''),
        )
    except ValueError as error:
        return jsonify({'error': str(error)}), 400
    return jsonify({'file': record}), 201


@app.post('/api/clean')
def clean_files():
    return jsonify(cleanup.clean())


@app.get('/api/files/<file_id>/view')
def view_file(file_id):
    record = media.find(file_id)
    if not record or record['type'] != 'photos':
        return jsonify({'error': 'file not found'}), 404
    try:
        preview_path = photos.ensure_webp(record, thumbnail=request.args.get('thumbnail') == 'true')
    except (FileNotFoundError, RuntimeError):
        return jsonify({'error': 'photo preview unavailable'}), 404
    return send_file(preview_path, mimetype='image/webp', conditional=True)


@app.get('/api/files/<file_id>/thumbnail')
def thumbnail_file(file_id):
    record = media.find(file_id)
    if not record or record['type'] not in {'photos', 'movies'}:
        return jsonify({'error': 'thumbnail unavailable'}), 404
    try:
        thumbnail_path = photos.ensure_webp(record, thumbnail=True)
    except (FileNotFoundError, RuntimeError):
        return jsonify({'error': 'thumbnail unavailable'}), 404
    return send_file(thumbnail_path, mimetype='image/webp', conditional=True, max_age=3600)


@app.get('/api/files/<file_id>/stream')
def stream_file(file_id):
    record = media.find(file_id)
    if not record or record['type'] not in {'movies', 'music'}:
        return jsonify({'error': 'streamable file not found'}), 404
    stored_path = media.source_path(record)
    if not stored_path.is_file():
        return jsonify({'error': 'file not found'}), 404
    return send_from_directory(media.storage_root, record['path'], mimetype=record.get('mimeType'), conditional=True, max_age=3600)


@app.get('/api/files/<file_id>/preview')
def preview_file(file_id):
    record = media.find(file_id)
    if not record:
        return jsonify({'error': 'file not found'}), 404
    return view_file(file_id) if record['type'] == 'photos' else stream_file(file_id)


@app.get('/api/files/<file_id>/download')
def download_file(file_id):
    record = media.find(file_id)
    if not record:
        return jsonify({'error': 'file not found'}), 404
    stored_path = media.source_path(record)
    if not stored_path.is_file():
        return jsonify({'error': 'file not found'}), 404
    return send_file(stored_path, as_attachment=True, download_name=record['originalName'], mimetype=record.get('mimeType'))


@app.patch('/api/files/<file_id>')
def update_file(file_id):
    record = media.update(file_id, request.get_json(silent=True) or {})
    if not record:
        return jsonify({'error': 'file not found'}), 404
    return jsonify({'file': media.public_record(record)})


@app.delete('/api/files/<file_id>')
def delete_file(file_id):
    if not media.delete(file_id):
        return jsonify({'error': 'file not found'}), 404
    hls.remove(file_id)
    return jsonify({'success': True})


@app.post('/api/files/<file_id>/hls')
def start_hls(file_id):
    record = media.find(file_id)
    if not record:
        return jsonify({'error': 'file not found'}), 404
    playlist, status = hls.ensure_hls(file_id, str(media.source_path(record)), audio_only=record['type'] == 'music')
    return jsonify({'status': status, 'playlist': f'/api/hls/{file_id}/stream.m3u8'}), 202


@app.get('/api/files/<file_id>/hls/status')
def hls_status(file_id):
    record = media.find(file_id)
    if not record:
        return jsonify({'status': 'missing'}), 404
    return jsonify({'status': hls.status(file_id, str(media.source_path(record)))})


@app.post('/api/files/<file_id>/hls/<action>')
def hls_control(file_id, action):
    actions = {'pause': hls.pause, 'resume': hls.resume, 'cancel': hls.cancel}
    if action not in actions:
        return jsonify({'error': 'unknown HLS action'}), 404
    return jsonify({'status': actions[action](file_id)})


@app.post('/api/hls/cancel')
def cancel_all_hls():
    with hls.locks_guard:
        keys = list(hls.active_procs)
    for key in keys:
        if ':' in key:
            uuid, lang = key.split(':', 1)
            hls.cancel(uuid, lang)
        else:
            hls.cancel(key)
    return jsonify({'success': True, 'stopped': len(keys)})


@app.post('/api/hls/clear')
def clear_hls_cache():
    hls.clear_cache()
    return jsonify({'success': True, 'cleared': True})


@app.get('/api/hls/<file_id>/stream.m3u8')
def hls_stream(file_id):
    record = media.find(file_id)
    if not record or record['type'] not in {'movies', 'music'}:
        return jsonify({'error': 'streamable file not found'}), 404
    playlist, status = hls.ensure_hls(file_id, str(media.source_path(record)), audio_only=record['type'] == 'music')
    if status == 'missing':
        return jsonify({'error': 'source file missing'}), 404
    if not os.path.isfile(playlist):
        cache_dir = hls._cache_dir(file_id)
        if hls.wait_for_playlist_ready(cache_dir, timeout=3.0):
            playlist = os.path.join(cache_dir, 'stream.m3u8')
        else:
            return placeholder_manifest()
    hls.touch(file_id)
    return send_file(playlist, mimetype='application/vnd.apple.mpegurl', max_age=0)


@app.get('/api/hls_status/<file_id>')
def hls_status_compat(file_id):
    return hls_status(file_id)


@app.post('/api/hls/<file_id>/<action>')
def hls_action_compat(file_id, action):
    actions = {'pause': hls.pause, 'resume': hls.resume, 'cancel': hls.cancel}
    if action not in actions:
        return jsonify({'error': 'unknown HLS action'}), 404
    return jsonify({'status': actions[action](file_id)})


@app.get('/api/hls/<file_id>/<path:segment>')
def hls_segment_compat(file_id, segment):
    cache_dir = hls._cache_dir(file_id)
    segment_path = os.path.join(cache_dir, segment)
    if not os.path.exists(segment_path):
        deadline = time.monotonic() + 3.0
        while not os.path.exists(segment_path) and time.monotonic() < deadline:
            time.sleep(0.2)
    if not os.path.exists(segment_path):
        return jsonify({'error': 'segment not ready yet'}), 404
    hls.touch(file_id)
    return send_from_directory(cache_dir, segment, mimetype='video/mp4')


@app.get('/api/files/<file_id>/hls/stream.m3u8')
def hls_playlist(file_id):
    return hls_stream(file_id)


@app.get('/api/files/<file_id>/hls/<path:segment>')
def hls_segment(file_id, segment):
    cache_dir = hls._cache_dir(file_id)
    segment_path = os.path.join(cache_dir, segment)
    if not os.path.exists(segment_path):
        deadline = time.monotonic() + 3.0
        while not os.path.exists(segment_path) and time.monotonic() < deadline:
            time.sleep(0.2)
    if not os.path.exists(segment_path):
        return jsonify({'error': 'segment not ready yet'}), 404
    hls.touch(file_id)
    return send_from_directory(cache_dir, segment, mimetype='video/mp4')


if __name__ == '__main__':
    port = int(os.environ.get('FILEY_PORT', '9100'))
    app.run(host='0.0.0.0', port=port, debug=False)
