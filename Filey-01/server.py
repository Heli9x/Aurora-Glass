import os
from pathlib import Path

from flask import Flask, Response, jsonify, request, send_file, send_from_directory
from flask_cors import CORS

from backend.cleanup import CleanupService
from backend.media import MediaLibrary
from backend.photos import PhotoService

BASE_DIR = Path(__file__).resolve().parent
STORAGE_DIR = Path(os.environ.get('FILEY_STORAGE_DIR', '/run/media/heli9x/FS-STORAGE'))
if not STORAGE_DIR.is_dir():
    STORAGE_DIR = BASE_DIR / 'backend-data'

from backend.hls_project26 import HlsManager, placeholder_manifest
app = Flask(__name__, static_folder=str(BASE_DIR), static_url_path='')
CORS(app)
media = MediaLibrary(STORAGE_DIR)
photos = PhotoService(media.upload_dir, media.storage_root / 'storage' / '_webp')
hls = HlsManager(str(media.storage_root / 'storage' / '_hls_filey01'))
cleanup = CleanupService(media, photos, hls)


@app.get('/')
def index():
    return send_from_directory(BASE_DIR, 'index.html')


@app.get('/api/files')
def list_files():
    return jsonify({'files': [media.public_record(item) for item in media.read_files()]})


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


@app.get('/api/hls/<file_id>/stream.m3u8')
def hls_stream(file_id):
    record = media.find(file_id)
    if not record or record['type'] not in {'movies', 'music'}:
        return jsonify({'error': 'streamable file not found'}), 404
    playlist, status = hls.ensure_hls(file_id, str(media.source_path(record)), audio_only=record['type'] == 'music')
    if status == 'missing':
        return jsonify({'error': 'source file missing'}), 404
    if not os.path.isfile(playlist):
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
    hls.touch(file_id)
    return send_from_directory(hls._cache_dir(file_id), segment, mimetype='video/mp4')


@app.get('/api/files/<file_id>/hls/stream.m3u8')
def hls_playlist(file_id):
    return hls_stream(file_id)


@app.get('/api/files/<file_id>/hls/<path:segment>')
def hls_segment(file_id, segment):
    hls.touch(file_id)
    return send_from_directory(hls._cache_dir(file_id), segment, mimetype='video/mp4')


if __name__ == '__main__':
    port = int(os.environ.get('FILEY_PORT', '9100'))
    app.run(host='0.0.0.0', port=port, debug=False)
