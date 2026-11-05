import os
import re
import secrets
import shutil
import time
from pathlib import Path

from flask import Flask, Response, jsonify, request, send_file, send_from_directory, session
from flask_cors import CORS

from backend import auth
from backend import config as app_config
from backend.cleanup import CleanupService
from backend.media import MediaLibrary
from backend.photos import PhotoService

BASE_DIR = Path(__file__).resolve().parent
fallback_storage = BASE_DIR / 'backend-data'

preferred_storage = os.environ.get('FILEY_STORAGE_DIR', '')


def resolve_storage_dir():
    if preferred_storage:
        preferred = Path(preferred_storage).expanduser()
        if preferred.is_dir() and os.access(preferred, os.W_OK):
            return preferred
    heads = [app_config.default_storage_dir()]
    if preferred_storage:
        heads.append(Path(preferred_storage).expanduser())
    for raw in [
        '/run/media',
        '/mnt/data',
        '/mnt',
        '/media',
    ]:
        heads.append(Path(raw))
    for head in heads:
        if (head.is_dir() and os.access(head, os.W_OK)
                and app_config.config_path(head).is_file()):
            return head
    for head in heads:
        if head.is_dir() and os.access(head, os.W_OK):
            return head
    return fallback_storage


STORAGE_DIR = resolve_storage_dir()
CONFIG = app_config.load_config(STORAGE_DIR)
PLATFORM_NAME = CONFIG.get('platform_name') or app_config.DEFAULT_NAME

from backend.hls_project26 import (
    HlsManager,
    placeholder_manifest,
    effective_hls_settings,
    HLS_CONCURRENCY,
    HLS_RLIMIT_MB,
    X264_THREADS,
    X264_LOOKAHEAD,
    X264_PRESET,
)
from backend.migrate import migrate_caches, preview_caches
from backend.paths import native_media_roots
app = Flask(__name__, static_folder=str(BASE_DIR), static_url_path='')
if os.environ.get('FILEY_TRUST_PROXY', '').strip().lower() in {'1', 'true', 'yes', 'on'}:
    from werkzeug.middleware.proxy_fix import ProxyFix
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)


def configure_cors(flask_app):
    origins = [
        origin.strip()
        for origin in os.environ.get('FILEY_CORS_ORIGINS', '').split(',')
        if origin.strip()
    ]
    if origins:
        CORS(flask_app, origins=origins, supports_credentials=True)


configure_cors(app)
auth_store = auth.init_app(app, STORAGE_DIR)
media = MediaLibrary(STORAGE_DIR, categories=app_config.effective_categories(CONFIG))
try:
    migrate_caches(media)
except Exception as error:  # never block startup on a cache migration problem
    print(f'Filey cache migration skipped: {error}', flush=True)
photos = PhotoService(media)


UUID_PATTERN = re.compile(r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}')


def hls_cache_dir(file_id):
    record = media.find(file_id)
    category = record['type'] if record else app_config.DEFAULT_CATEGORY
    return str(media.category_cache_dir(category) / file_id)


def known_file_id(file_id):
    return bool(UUID_PATTERN.fullmatch(file_id or '')) and media.find(file_id) is not None


def hls_cache_parents():
    return [str(media.category_cache_dir(category_id)) for category_id in media.category_ids()
            if category_id != 'photos']


hls = HlsManager(hls_cache_dir, config_root=str(media.storage_root),
                 cache_parents=hls_cache_parents)
cleanup = CleanupService(media, photos, hls)

if not auth_store.has_admin():
    print('Filey: no admin account exists yet. Create one with: '
          'python3 -m backend.auth create-admin <username>', flush=True)


@app.after_request
def audit_mutations(response):
    if (request.method in auth.MUTATING_METHODS
            and request.endpoint
            and request.endpoint not in auth.PUBLIC_ENDPOINTS
            and response.status_code < 400):
        user = auth.current_user()
        if user:
            auth.audit(STORAGE_DIR, request.endpoint, user.get('username'),
                       method=request.method, path=request.path,
                       status=response.status_code)
    return response


def categories_payload():
    return {
        'categories': media.categories_view(),
        'native_roots': native_media_roots(),
        'modes': list(app_config.CATEGORY_MODES),
        'reserved': sorted(app_config.RESERVED_CATEGORY_IDS),
    }


def categories_for_config(source=None):
    source = source or media.categories
    return {
        category_id: {key: value for key, value in spec.items() if key != 'root_path'}
        for category_id, spec in source.items()
    }


def category_relayout_preview(categories):
    preview = []
    for category_id, spec in categories.items():
        current = media.categories.get(category_id)
        if not current:
            continue
        old_root = current.get('root')
        new_root = spec.get('root')
        old_path = Path(old_root).expanduser() if old_root else None
        new_path = Path(new_root).expanduser() if new_root else None
        old_resolved = old_path.resolve(strict=False) if old_path else media.storage_root.resolve()
        new_resolved = new_path.resolve(strict=False) if new_path else media.storage_root.resolve()
        if old_resolved == new_resolved:
            continue
        records = [record for record in media.read_files() if record['type'] == category_id]
        preview.append({
            'id': category_id,
            'label': spec.get('label', category_id),
            'mode': spec.get('mode', 'managed'),
            'from': str(old_path or media.storage_root),
            'to': str(new_path or media.storage_root),
            'files': len(records),
            'bytes': sum(record.get('sizeBytes', 0) for record in records),
        })
    return preview


def hls_settings_payload():
    """HLS resource limits plus the ranges/defaults the Settings UI needs."""
    return {
        'values': effective_hls_settings(STORAGE_DIR),
        'defaults': {
            'concurrency': HLS_CONCURRENCY,
            'rlimit_mb': HLS_RLIMIT_MB,
            'x264_threads': X264_THREADS,
            'rc_lookahead': X264_LOOKAHEAD,
            'preset': X264_PRESET,
        },
        'limits': dict(app_config.HLS_RANGES),
        'presets': list(app_config.HLS_PRESETS),
    }


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


@app.post('/api/auth/login')
def auth_login():
    store = auth.get_store()
    if not store.has_admin():
        return jsonify({'error': 'setup required', 'setup_required': True}), 503
    payload = request.get_json(silent=True) or {}
    username = str(payload.get('username') or '').strip()
    password = str(payload.get('password') or '')
    ip = request.remote_addr or ''
    key = (username.lower(), ip)
    limiter = app.extensions['filey_auth']['limiter']
    allowed, retry_after = limiter.check(key)
    if not allowed:
        auth.audit(STORAGE_DIR, 'login.locked', username, ip=ip,
                   retry_after=retry_after)
        response = jsonify({'error': 'too many attempts', 'retry_after': retry_after})
        response.status_code = 429
        response.headers['Retry-After'] = str(retry_after)
        return response
    user = store.verify_password(username, password)
    if not user:
        locked, retry_after = limiter.fail(key)
        auth.audit(STORAGE_DIR, 'login.failed', username, ip=ip)
        if locked:
            response = jsonify({'error': 'too many attempts', 'retry_after': retry_after})
            response.status_code = 429
            response.headers['Retry-After'] = str(retry_after)
            return response
        return jsonify({'error': 'Invalid username or password'}), 401
    limiter.reset(key)
    session.clear()
    session['user_id'] = user['id']
    session['csrf_token'] = secrets.token_urlsafe(32)
    session.permanent = True
    auth.audit(STORAGE_DIR, 'login.success', user['username'], ip=ip)
    return jsonify({'user': auth.public_user(user),
                    'csrf_token': session['csrf_token']})


@app.post('/api/auth/logout')
def auth_logout():
    user = auth.current_user()
    session.clear()
    if user:
        auth.audit(STORAGE_DIR, 'logout', user['username'])
    return jsonify({'success': True})


@app.get('/api/auth/me')
def auth_me():
    store = auth.get_store()
    user = auth.current_user()
    if not user:
        if session.get('user_id'):
            session.clear()
        return jsonify({
            'error': 'authentication required',
            'setup_required': not store.has_admin(),
        }), 401
    if not session.get('csrf_token'):
        session['csrf_token'] = secrets.token_urlsafe(32)
    return jsonify({
        'user': auth.public_user(user),
        'csrf_token': session['csrf_token'],
        'setup_required': False,
    })


@app.post('/api/auth/setup')
def auth_setup():
    store = auth.get_store()
    if store.has_admin():
        return jsonify({'error': 'setup already complete'}), 409
    payload = request.get_json(silent=True) or {}
    token = str(payload.get('token') or '')
    if not auth.setup_token_valid(token):
        auth.audit(STORAGE_DIR, 'setup.failed', str(payload.get('username') or ''),
                   reason='invalid token')
        return jsonify({'error': 'invalid setup token'}), 403
    try:
        user = store.create(
            payload.get('username'), payload.get('password'), role='admin'
        )
    except auth.AuthError as error:
        return jsonify({'error': error.message}), error.status
    auth.audit(STORAGE_DIR, 'user.create', user['username'], role='admin',
               source='setup', target=user['username'])
    try:
        (Path(STORAGE_DIR) / auth.SETUP_TOKEN_FILENAME).unlink(missing_ok=True)
    except OSError:
        pass
    return jsonify({'user': user}), 201


@app.get('/api/users')
@auth.require('users.manage')
def users_get():
    users = sorted(
        (auth.public_user(user) for user in auth.get_store().list()),
        key=lambda user: (user.get('username') or '').lower(),
    )
    return jsonify({'users': users})


@app.post('/api/users')
@auth.require('users.manage')
def users_post():
    payload = request.get_json(silent=True) or {}
    try:
        user = auth.get_store().create(
            payload.get('username'), payload.get('password'),
            role=payload.get('role') or 'client',
            disabled=bool(payload.get('disabled')),
        )
    except auth.AuthError as error:
        return jsonify({'error': error.message}), error.status
    return jsonify({'user': user}), 201


@app.patch('/api/users/<user_id>')
@auth.require('users.manage')
def users_patch(user_id):
    store = auth.get_store()
    target = store.get(user_id)
    if not target:
        return jsonify({'error': 'user not found'}), 404
    payload = request.get_json(silent=True) or {}
    current = auth.current_user()
    is_self = current and str(current.get('id')) == str(user_id)
    disable = 'disabled' in payload and bool(payload.get('disabled'))
    new_role = payload.get('role')
    demote = (new_role is not None and target.get('role') == 'admin'
              and new_role != 'admin')
    if target.get('role') == 'admin' and not target.get('disabled') and (disable or demote):
        if auth.enabled_admin_count(store) <= 1:
            return jsonify({'error': 'cannot remove the last enabled admin'}), 400
    if is_self and disable:
        return jsonify({'error': 'cannot disable your own account'}), 400
    fields = {}
    if 'role' in payload:
        fields['role'] = payload.get('role')
    if 'password' in payload and payload.get('password') is not None:
        fields['password'] = payload.get('password')
    if 'disabled' in payload:
        fields['disabled'] = bool(payload.get('disabled'))
    if not fields:
        return jsonify({'error': 'no supported fields to update'}), 400
    try:
        user = store.update(user_id, **fields)
    except auth.AuthError as error:
        return jsonify({'error': error.message}), error.status
    return jsonify({'user': user})


@app.delete('/api/users/<user_id>')
@auth.require('users.manage')
def users_delete(user_id):
    store = auth.get_store()
    target = store.get(user_id)
    if not target:
        return jsonify({'error': 'user not found'}), 404
    current = auth.current_user()
    if current and str(current.get('id')) == str(user_id):
        return jsonify({'error': 'cannot delete your own account'}), 400
    if target.get('role') == 'admin' and not target.get('disabled'):
        if auth.enabled_admin_count(store) <= 1:
            return jsonify({'error': 'cannot delete the last enabled admin'}), 400
    store.delete(user_id)
    return jsonify({'success': True})


@app.get('/api/settings')
@auth.require('files.read')
def settings_get():
    user = auth.current_user()
    if user and user.get('role') == 'client':
        categories = media.categories_view()
        for category in categories:
            category.pop('root', None)
        return jsonify({
            'platform_name': PLATFORM_NAME,
            'categories': categories,
            'native_roots': {},
        })
    payload = {
        'platform_name': PLATFORM_NAME,
        'storage_dir': str(STORAGE_DIR),
        'candidates': list(app_config.discover_storage_roots(extra=[preferred_storage] if preferred_storage else [])),
        'hls': hls_settings_payload(),
    }
    payload.update(categories_payload())
    return jsonify(payload)


@app.post('/api/settings')
@auth.require('settings.manage')
def settings_post():
    global PLATFORM_NAME
    payload = request.get_json(silent=True) or {}
    categories_value = payload.get('categories') if 'categories' in payload else None
    normalized_categories = None
    relayout = []
    if categories_value is not None:
        ok, reason, normalized_categories = app_config.normalize_categories_payload(
            categories_value, media.categories
        )
        if not ok:
            return jsonify({'error': reason}), 400
        relayout = category_relayout_preview(normalized_categories)
        if relayout and payload.get('confirm_relayout') is not True:
            return jsonify({
                'error': 'Changing library roots requires confirmation',
                'needs_confirmation': True,
                'relayout': relayout,
            }), 409
    name = str(payload.get('name') or '').strip() if 'name' in payload else None
    if name is not None and (not name or len(name) > 40):
        return jsonify({'error': 'Platform name must be 1-40 characters'}), 400
    new_dir = str(payload.get('storage_dir') or '').strip() if 'storage_dir' in payload else None
    if new_dir is not None:
        ok, reason = app_config.validate_storage_dir(new_dir)
        if not ok:
            return jsonify({'error': reason}), 400
    hls_value = payload.get('hls') if 'hls' in payload else None
    if hls_value is not None:
        if not isinstance(hls_value, dict):
            return jsonify({'error': 'hls settings must be an object'}), 400
        ok, reason = app_config.validate_hls_settings(hls_value)
        if not ok:
            return jsonify({'error': reason}), 400
    if relayout:
        try:
            for item in relayout:
                media.relayout_category(item['id'], normalized_categories[item['id']])
        except (OSError, shutil.Error) as error:
            return jsonify({'error': f'Could not move library files: {error}'}), 500
    if hls_value is not None:
        # HLS limits live in the currently-mounted storage root (read by
        # HlsManager on each conversion start; no restart needed).
        app_config.save_config(STORAGE_DIR, hls=hls_value)
    target = STORAGE_DIR
    if new_dir is not None:
        target = Path(new_dir).expanduser()
    if name is None:
        name = app_config.load_config(target).get('platform_name') or PLATFORM_NAME
    app_config.save_config(target, platform_name=name, storage_dir=str(target))
    if name != PLATFORM_NAME:
        PLATFORM_NAME = name
    if normalized_categories is not None:
        normalized = categories_for_config(normalized_categories)
        app_config.save_config(STORAGE_DIR, categories=normalized)
        media.set_categories(normalized)
    requires_restart = new_dir is not None and Path(new_dir).expanduser() != STORAGE_DIR
    response = {
        'applied': True,
        'platform_name': name,
        'storage_dir': str(target),
        'requires_restart': requires_restart,
    }
    if hls_value is not None:
        response['hls'] = hls_settings_payload()
    if categories_value is not None:
        response.update(categories_payload())
    return jsonify(response)


@app.get('/api/categories')
@auth.require('files.read')
def categories_get():
    return jsonify(categories_payload())


@app.post('/api/categories')
@auth.require('library.manage')
def categories_post():
    payload = request.get_json(silent=True) or {}
    ok, reason, created = app_config.validate_category(payload, media.category_ids())
    if not ok:
        return jsonify({'error': reason}), 400
    updated = categories_for_config()
    updated[created['id']] = created['spec']
    app_config.save_config(STORAGE_DIR, categories=updated)
    media.set_categories(updated)
    return jsonify(categories_payload()), 201


@app.delete('/api/categories/<category_id>')
@auth.require('library.manage')
def categories_delete(category_id):
    if category_id in app_config.BUILTIN_CATEGORY_IDS:
        return jsonify({'error': 'built-in categories cannot be removed'}), 400
    if category_id not in media.categories:
        return jsonify({'error': 'category not found'}), 404
    count = sum(1 for record in media.read_files() if record['type'] == category_id)
    if count and request.args.get('force') != 'true':
        return jsonify({'error': 'category is not empty', 'count': count,
                        'needs_confirmation': True}), 409
    updated = categories_for_config()
    updated.pop(category_id, None)
    app_config.save_config(STORAGE_DIR, categories=updated)
    media.set_categories(updated)
    return jsonify(categories_payload())


@app.post('/api/library/scan')
@auth.require('library.manage')
def library_scan():
    category_id = (request.args.get('category') or '').strip()
    if not category_id:
        payload = request.get_json(silent=True) or {}
        category_id = str(payload.get('category') or '').strip()
    if category_id not in media.categories:
        return jsonify({'error': 'category not found'}), 404
    added = media.scan(category_id)
    return jsonify({'success': True, 'category': category_id, 'added': added})


@app.post('/api/categories/<category_id>/scan')
@auth.require('library.manage')
def categories_scan(category_id):
    if category_id not in media.categories:
        return jsonify({'error': 'category not found'}), 404
    added = media.scan(category_id)
    return jsonify({'success': True, 'added': added})


@app.post('/api/stats')
@app.get('/api/stats')
@auth.require('files.read')
def stats():
    counts = {}
    for record in media.read_files():
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

    hls_bytes = 0
    hls_files = 0
    photo_bytes = 0
    for category_id in media.category_ids():
        hls_root = media.category_cache_dir(category_id)
        category_bytes, category_files = dir_bytes(hls_root)
        if category_id == 'photos':
            photo_bytes += category_bytes
        else:
            hls_bytes += category_bytes
            hls_files += category_files
    try:
        usage = shutil.disk_usage(media.storage_root)
        free, used, total = usage.free, usage.used, usage.total
    except OSError:
        free = used = total = 0
    return jsonify({
        'total': len(media.read_files()),
        'counts': counts,
        'hls_cache': {'bytes': hls_bytes, 'files': hls_files},
        'photo_cache': {'bytes': photo_bytes},
        'storage': {'free': free, 'used': used, 'total': total},
    })


@app.get('/api/files')
@auth.require('files.read')
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
    query = request.args.get('q', '').strip()
    if query:
        records = media.sort_records(media.search(query, media_type), sort)
    else:
        records = media.read_sorted(media_type, sort)
    records = [media.public_record(item) for item in records]
    files, total = media.paginate(records, page, per_page)
    return jsonify({'files': files, 'total': total, 'page': page,
                    'per_page': per_page, 'query': query})


@app.get('/api/search')
@auth.require('files.read')
def search_files():
    query = request.args.get('q', '').strip()
    media_type = request.args.get('type') or None
    try:
        limit = min(100, max(1, int(request.args.get('limit', 20))))
    except (TypeError, ValueError):
        limit = 20
    records = media.sort_records(media.search(query, media_type), 'default')
    return jsonify({
        'query': query,
        'total': len(records),
        'results': [media.public_record(item) for item in records[:limit]],
    })


@app.post('/api/library/migrate')
@auth.require('settings.manage')
def library_migrate():
    if request.args.get('dry_run') == 'true':
        return jsonify({'dry_run': True, 'moves': preview_caches(media)})
    moved = migrate_caches(media)
    media._invalidate()
    return jsonify({'success': True, 'moved': moved})


@app.post('/api/upload')
@auth.require('files.upload')
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
    return jsonify({'file': media.public_record(record)}), 201


@app.post('/api/clean')
@auth.require('maintenance.run')
def clean_files():
    return jsonify(cleanup.clean())


@app.get('/api/files/<file_id>/view')
@auth.require('files.read')
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
@auth.require('files.read')
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
@auth.require('files.read')
def stream_file(file_id):
    record = media.find(file_id)
    if not record or record['type'] not in {'movies', 'music'}:
        return jsonify({'error': 'streamable file not found'}), 404
    stored_path = media.source_path(record)
    if not stored_path.is_file():
        return jsonify({'error': 'file not found'}), 404
    return send_file(stored_path, mimetype=record.get('mimeType'), conditional=True, max_age=3600)


@app.get('/api/files/<file_id>/preview')
@auth.require('files.read')
def preview_file(file_id):
    record = media.find(file_id)
    if not record:
        return jsonify({'error': 'file not found'}), 404
    return view_file(file_id) if record['type'] == 'photos' else stream_file(file_id)


@app.get('/api/files/<file_id>/download')
@auth.require('files.read')
def download_file(file_id):
    record = media.find(file_id)
    if not record:
        return jsonify({'error': 'file not found'}), 404
    stored_path = media.source_path(record)
    if not stored_path.is_file():
        return jsonify({'error': 'file not found'}), 404
    return send_file(stored_path, as_attachment=True, download_name=record['originalName'], mimetype=record.get('mimeType'))


@app.patch('/api/files/<file_id>')
@auth.require('files.edit')
def update_file(file_id):
    record = media.update(file_id, request.get_json(silent=True) or {})
    if not record:
        return jsonify({'error': 'file not found'}), 404
    return jsonify({'file': media.public_record(record)})


@app.delete('/api/files/<file_id>')
@auth.require('files.delete')
def delete_file(file_id):
    delete_source = None
    if 'delete_source' in request.args:
        delete_source = request.args.get('delete_source') != 'false'
    result = media.delete(file_id, delete_source=delete_source)
    if result is None:
        return jsonify({'error': 'file not found'}), 404
    if result == 'confirm':
        return jsonify({'error': 'This file is linked from a shared folder.',
                        'needs_confirmation': True}), 409
    hls.remove(file_id)
    return jsonify({'success': True, 'removed': result == 'removed'})


@app.post('/api/files/<file_id>/hls')
@auth.require('files.read')
def start_hls(file_id):
    record = media.find(file_id)
    if not record:
        return jsonify({'error': 'file not found'}), 404
    playlist, status = hls.ensure_hls(file_id, str(media.source_path(record)), audio_only=record['type'] == 'music')
    return jsonify({'status': status, 'playlist': f'/api/hls/{file_id}/stream.m3u8'}), 202


@app.get('/api/files/<file_id>/hls/status')
@auth.require('files.read')
def hls_status(file_id):
    record = media.find(file_id)
    if not record:
        return jsonify({'status': 'missing'}), 404
    return jsonify({'status': hls.status(file_id, str(media.source_path(record)))})


@app.post('/api/files/<file_id>/hls/<action>')
@auth.require('maintenance.run')
def hls_control(file_id, action):
    actions = {'pause': hls.pause, 'resume': hls.resume, 'cancel': hls.cancel}
    if action not in actions:
        return jsonify({'error': 'unknown HLS action'}), 404
    return jsonify({'status': actions[action](file_id)})


@app.post('/api/hls/cancel')
@auth.require('maintenance.run')
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
@auth.require('maintenance.run')
def clear_hls_cache():
    hls.clear_cache()
    return jsonify({'success': True, 'cleared': True})


@app.get('/api/hls/<file_id>/stream.m3u8')
@auth.require('files.read')
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
@auth.require('files.read')
def hls_status_compat(file_id):
    return hls_status(file_id)


@app.post('/api/hls/<file_id>/<action>')
@auth.require('maintenance.run')
def hls_action_compat(file_id, action):
    actions = {'pause': hls.pause, 'resume': hls.resume, 'cancel': hls.cancel}
    if action not in actions:
        return jsonify({'error': 'unknown HLS action'}), 404
    return jsonify({'status': actions[action](file_id)})


@app.get('/api/hls/<file_id>/<path:segment>')
@auth.require('files.read')
def hls_segment_compat(file_id, segment):
    if not known_file_id(file_id):
        return jsonify({'error': 'file not found'}), 404
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
@auth.require('files.read')
def hls_playlist(file_id):
    return hls_stream(file_id)


@app.get('/api/files/<file_id>/hls/<path:segment>')
@auth.require('files.read')
def hls_segment(file_id, segment):
    if not known_file_id(file_id):
        return jsonify({'error': 'file not found'}), 404
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
    host = os.environ.get('FILEY_HOST', '0.0.0.0')
    app.run(host=host, port=port, debug=False)
 