"""Accounts, sessions, permissions, CSRF and rate limiting for Filey.

Users are stored in ``<STORAGE_DIR>/.filey-users.json`` behind a small
``UserStore`` interface so a different backend can replace it later without
changing routes.  Passwords are hashed with ``werkzeug.security`` and the
session secret lives in the same file.
"""

import argparse
import getpass
import hmac
import json
import os
import secrets
import tempfile
import threading
import time
from datetime import datetime, timedelta, timezone
from functools import wraps
from pathlib import Path

from flask import current_app, jsonify, request, session
from flask.sessions import SecureCookieSessionInterface
from werkzeug.security import check_password_hash, generate_password_hash

USERS_FILENAME = '.filey-users.json'
AUDIT_FILENAME = '.filey-audit.log'
SETUP_TOKEN_FILENAME = '.filey-setup-token'

ALL_PERMISSIONS = frozenset({
    'files.read',
    'files.upload',
    'files.edit',
    'files.delete',
    'library.manage',
    'settings.manage',
    'maintenance.run',
    'users.manage',
})

ROLE_PERMISSIONS = {
    'admin': frozenset(ALL_PERMISSIONS),
    'client': frozenset({'files.read'}),
}

# Endpoint name -> permission required.  This is the single source of truth for
# what a route needs; tests cross-check it against the decorators on the app.
ROUTE_PERMISSIONS = {
    'settings_get': 'files.read',
    'settings_post': 'settings.manage',
    'categories_get': 'files.read',
    'categories_post': 'library.manage',
    'categories_delete': 'library.manage',
    'library_scan': 'library.manage',
    'categories_scan': 'library.manage',
    'stats': 'files.read',
    'list_files': 'files.read',
    'search_files': 'files.read',
    'library_migrate': 'settings.manage',
    'upload_file': 'files.upload',
    'clean_files': 'maintenance.run',
    'view_file': 'files.read',
    'thumbnail_file': 'files.read',
    'stream_file': 'files.read',
    'cover_file': 'files.read',
    'set_cover': 'files.edit',
    'delete_cover': 'files.edit',
    'get_lyrics': 'files.read',
    'set_lyrics': 'files.edit',
    'preview_file': 'files.read',
    'download_file': 'files.read',
    'update_file': 'files.edit',
    'delete_file': 'files.delete',
    'start_hls': 'files.read',
    'hls_status': 'files.read',
    'hls_control': 'maintenance.run',
    'cancel_all_hls': 'maintenance.run',
    'clear_hls_cache': 'maintenance.run',
    'hls_stream': 'files.read',
    'hls_status_compat': 'files.read',
    'hls_action_compat': 'maintenance.run',
    'hls_segment_compat': 'files.read',
    'hls_playlist': 'files.read',
    'hls_segment': 'files.read',
    'users_get': 'users.manage',
    'users_post': 'users.manage',
    'users_patch': 'users.manage',
    'users_delete': 'users.manage',
}

PUBLIC_ENDPOINTS = frozenset({
    'static', 'index', 'health', 'discovery',
    'auth_login', 'auth_logout', 'auth_me', 'auth_setup',
})

CSRF_EXEMPT_ENDPOINTS = frozenset({'auth_login', 'auth_setup'})
MUTATING_METHODS = frozenset({'POST', 'PATCH', 'DELETE'})

_STORE_LOCK = threading.Lock()
_AUDIT_LOCK = threading.Lock()
_DUMMY_HASH = generate_password_hash('filey-invalid-password')


class AuthError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


def _utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec='seconds')


def _truthy(value):
    if value is None:
        return None
    return str(value).strip().lower() in {'1', 'true', 'yes', 'on'}


def _env_int(name, default):
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def public_user(user):
    if not user:
        return None
    return {
        'id': user.get('id'),
        'username': user.get('username'),
        'role': user.get('role'),
        'created': user.get('created'),
        'disabled': bool(user.get('disabled')),
    }


class UserStore:
    """Storage interface used by the routes and the CLI."""

    def get(self, user_id):
        raise NotImplementedError

    def get_by_username(self, username):
        raise NotImplementedError

    def list(self):
        raise NotImplementedError

    def create(self, username, password, role='client', disabled=False):
        raise NotImplementedError

    def update(self, user_id, **fields):
        raise NotImplementedError

    def delete(self, user_id):
        raise NotImplementedError

    def has_admin(self):
        raise NotImplementedError

    def verify_password(self, username, password):
        raise NotImplementedError


class JsonUserStore(UserStore):
    def __init__(self, storage_dir):
        self.storage_dir = Path(storage_dir)
        self.path = self.storage_dir / USERS_FILENAME
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self._ensure_file()

    # -- persistence --------------------------------------------------------

    def _empty(self):
        return {'version': 1, 'users': {}, 'secret': secrets.token_hex(32)}

    def _load(self):
        try:
            data = json.loads(self.path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return None, False
        if not isinstance(data, dict):
            return None, False
        needs_write = False
        users = data.get('users')
        if not isinstance(users, dict):
            users = {}
            needs_write = True
        secret = data.get('secret')
        if not isinstance(secret, str) or not secret:
            secret = secrets.token_hex(32)
            needs_write = True
        cleaned = {}
        for user_id, user in users.items():
            if isinstance(user, dict) and user.get('username'):
                cleaned[str(user_id)] = user
        if len(cleaned) != len(users):
            needs_write = True
        return {'version': 1, 'users': cleaned, 'secret': secret}, needs_write

    def _write_locked(self, data):
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        handle = tempfile.NamedTemporaryFile(
            'w', encoding='utf-8', dir=str(self.storage_dir),
            prefix=USERS_FILENAME + '.', suffix='.tmp', delete=False,
        )
        tmp_path = Path(handle.name)
        try:
            with handle:
                json.dump(data, handle, indent=2, sort_keys=True)
                handle.write('\n')
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp_path, self.path)
            os.chmod(self.path, 0o600)
        finally:
            if tmp_path.exists():
                try:
                    tmp_path.unlink()
                except OSError:
                    pass

    def _ensure_file(self):
        with _STORE_LOCK:
            data, needs_write = self._load()
            if data is None:
                self._write_locked(self._empty())
            elif needs_write:
                self._write_locked(data)

    def secret(self):
        with _STORE_LOCK:
            data, needs_write = self._load()
            if data is None:
                data = self._empty()
                needs_write = True
            if needs_write:
                self._write_locked(data)
            return data['secret']

    def rotate_secret(self):
        with _STORE_LOCK:
            data, _ = self._load()
            if data is None:
                data = self._empty()
            data['secret'] = secrets.token_hex(32)
            self._write_locked(data)
            return data['secret']

    # -- reads --------------------------------------------------------------

    def get(self, user_id):
        with _STORE_LOCK:
            data, _ = self._load()
            if data is None or not user_id:
                return None
            user = data['users'].get(str(user_id))
            if not user:
                return None
            result = dict(user)
            result['id'] = str(user_id)
            return result

    def get_by_username(self, username):
        username = str(username or '').strip()
        if not username:
            return None
        with _STORE_LOCK:
            data, _ = self._load()
            if data is None:
                return None
            folded = username.lower()
            for user_id, user in data['users'].items():
                if str(user.get('username', '')).lower() == folded:
                    result = dict(user)
                    result['id'] = str(user_id)
                    return result
            return None

    def list(self):
        with _STORE_LOCK:
            data, _ = self._load()
            if data is None:
                return []
            users = []
            for user_id, user in data['users'].items():
                result = dict(user)
                result['id'] = str(user_id)
                users.append(result)
            return users

    def has_admin(self):
        return any(
            user.get('role') == 'admin' and not user.get('disabled')
            for user in self.list()
        )

    def verify_password(self, username, password):
        user = self.get_by_username(username)
        stored = user.get('password_hash') if user else _DUMMY_HASH
        valid = check_password_hash(stored, str(password or '')) if stored else False
        if not user or not valid or user.get('disabled'):
            return None
        return user

    # -- writes -------------------------------------------------------------

    def _new_id(self, users):
        while True:
            user_id = 'u_' + secrets.token_hex(8)
            if user_id not in users:
                return user_id

    def _validate_new(self, username, password, role):
        username = str(username or '').strip()
        if not username or len(username) > 64:
            raise AuthError('Username must be 1-64 characters')
        if role not in ROLE_PERMISSIONS:
            raise AuthError('Role must be "admin" or "client"')
        if not password or len(str(password)) < 8:
            raise AuthError('Password must be at least 8 characters')
        return username

    def create(self, username, password, role='client', disabled=False):
        username = self._validate_new(username, password, role)
        with _STORE_LOCK:
            data, _ = self._load()
            if data is None:
                data = self._empty()
            folded = username.lower()
            if any(str(user.get('username', '')).lower() == folded
                   for user in data['users'].values()):
                raise AuthError('Username already exists', 409)
            user_id = self._new_id(data['users'])
            user = {
                'username': username,
                'role': role,
                'password_hash': generate_password_hash(str(password)),
                'created': _utcnow(),
                'disabled': bool(disabled),
            }
            data['users'][user_id] = user
            self._write_locked(data)
            result = dict(user)
            result['id'] = user_id
            return public_user(result)

    def update(self, user_id, **fields):
        with _STORE_LOCK:
            data, _ = self._load()
            if data is None:
                return None
            user = data['users'].get(str(user_id))
            if not user:
                return None
            changed = False
            if 'role' in fields and fields['role'] is not None:
                role = fields['role']
                if role not in ROLE_PERMISSIONS:
                    raise AuthError('Role must be "admin" or "client"')
                if user.get('role') != role:
                    user['role'] = role
                    changed = True
            if 'disabled' in fields and fields['disabled'] is not None:
                disabled = bool(fields['disabled'])
                if bool(user.get('disabled')) != disabled:
                    user['disabled'] = disabled
                    changed = True
            if fields.get('password') is not None:
                password = str(fields['password'])
                if len(password) < 8:
                    raise AuthError('Password must be at least 8 characters')
                user['password_hash'] = generate_password_hash(password)
                changed = True
            if 'username' in fields and fields['username'] is not None:
                username = str(fields['username']).strip()
                if not username or len(username) > 64:
                    raise AuthError('Username must be 1-64 characters')
                folded = username.lower()
                if any(other_id != str(user_id)
                       and str(other.get('username', '')).lower() == folded
                       for other_id, other in data['users'].items()):
                    raise AuthError('Username already exists', 409)
                if user.get('username') != username:
                    user['username'] = username
                    changed = True
            if not changed:
                return public_user({**user, 'id': str(user_id)})
            self._write_locked(data)
            return public_user({**user, 'id': str(user_id)})

    def delete(self, user_id):
        with _STORE_LOCK:
            data, _ = self._load()
            if data is None or str(user_id) not in data['users']:
                return False
            del data['users'][str(user_id)]
            self._write_locked(data)
            return True


def enabled_admin_count(store):
    return sum(
        1 for user in store.list()
        if user.get('role') == 'admin' and not user.get('disabled')
    )


# -- Flask integration ------------------------------------------------------

def _state():
    state = current_app.extensions.get('filey_auth')
    if not state:
        raise RuntimeError('Filey auth is not configured for this app')
    return state


def get_store():
    return _state()['store']


def current_user():
    user_id = session.get('user_id')
    if not user_id:
        return None
    user = get_store().get(user_id)
    if not user or user.get('disabled'):
        return None
    return user


def has_permission(user, permission):
    if not user:
        return False
    if not permission:
        return True
    return permission in ROLE_PERMISSIONS.get(user.get('role'), frozenset())


def require(permission):
    def decorator(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            store = get_store()
            if not store.has_admin():
                return jsonify({'error': 'setup required', 'setup_required': True}), 503
            user = current_user()
            if not user:
                return jsonify({'error': 'authentication required'}), 401
            if not has_permission(user, permission):
                return jsonify({'error': 'not allowed'}), 403
            return view(*args, **kwargs)
        wrapped.required_permission = permission
        return wrapped
    return decorator


require_permission = require


def audit(storage_dir, event, actor=None, **details):
    record = {'ts': _utcnow(), 'event': event}
    if actor:
        record['actor'] = actor
    for key, value in details.items():
        lowered = key.lower()
        if any(word in lowered for word in ('password', 'token', 'secret', 'hash')):
            continue
        record[key] = value
    line = json.dumps(record, sort_keys=True)
    path = Path(storage_dir) / AUDIT_FILENAME
    with _AUDIT_LOCK:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            is_new = not path.exists()
            with path.open('a', encoding='utf-8') as handle:
                handle.write(line + '\n')
                handle.flush()
                os.fsync(handle.fileno())
            if is_new:
                os.chmod(path, 0o600)
        except OSError:
            pass


def audit_current(event, **details):
    actor = None
    try:
        user = current_user()
        actor = user.get('username') if user else None
    except RuntimeError:
        pass
    storage_dir = request.environ.get('filey.storage_dir')
    if storage_dir:
        audit(storage_dir, event, actor, method=request.method,
              path=request.path, **details)


class LoginRateLimiter:
    def __init__(self, max_attempts=5, window_seconds=900, clock=None):
        self.max_attempts = max(1, int(max_attempts))
        self.window_seconds = max(1, int(window_seconds))
        self.clock = clock or time.monotonic
        self._lock = threading.Lock()
        self._attempts = {}

    def _current(self, key, now):
        entry = self._attempts.get(key)
        if entry and entry['reset_at'] <= now:
            self._attempts.pop(key, None)
            return None
        return entry

    def check(self, key):
        now = self.clock()
        with self._lock:
            entry = self._current(key, now)
            if entry and entry['locked_until'] > now:
                return False, max(1, int(round(entry['locked_until'] - now)))
            return True, 0

    def fail(self, key):
        now = self.clock()
        with self._lock:
            entry = self._current(key, now) or {
                'count': 0,
                'locked_until': 0,
                'reset_at': now + self.window_seconds,
            }
            entry['count'] += 1
            if entry['count'] >= self.max_attempts:
                entry['locked_until'] = now + self.window_seconds
                entry['reset_at'] = entry['locked_until']
            self._attempts[key] = entry
            if entry['locked_until'] > now:
                return True, max(1, int(round(entry['locked_until'] - now)))
            return False, 0

    def reset(self, key):
        with self._lock:
            self._attempts.pop(key, None)


def _cookie_secure():
    configured = _truthy(os.environ.get('FILEY_COOKIE_SECURE'))
    if configured is not None:
        return configured
    return request.is_secure


class _DynamicSecretSessionInterface(SecureCookieSessionInterface):
    """Sign cookies with the secret currently stored in the users file."""

    def __init__(self, store):
        super().__init__()
        self.store = store

    def get_signing_serializer(self, app):
        app.secret_key = self.store.secret()
        return super().get_signing_serializer(app)


def _csrf_valid():
    expected = session.get('csrf_token')
    provided = request.headers.get('X-CSRF-Token', '')
    if not expected or not provided:
        return False
    return hmac.compare_digest(str(expected), str(provided))


def init_app(app, storage_dir):
    storage_dir = Path(storage_dir)
    store = JsonUserStore(storage_dir)
    limiter = LoginRateLimiter(
        max_attempts=_env_int('FILEY_LOGIN_MAX_ATTEMPTS', 5),
        window_seconds=_env_int('FILEY_LOGIN_WINDOW_SECONDS', 900),
    )
    app.extensions['filey_auth'] = {
        'store': store,
        'limiter': limiter,
        'storage_dir': str(storage_dir),
    }
    app.secret_key = store.secret()
    app.session_interface = _DynamicSecretSessionInterface(store)
    app.config.update(
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE='Lax',
        SESSION_COOKIE_SECURE=False,
        PERMANENT_SESSION_LIFETIME=timedelta(
            hours=_env_int('FILEY_SESSION_HOURS', 12)
        ),
    )

    @app.before_request
    def _filey_auth_before_request():
        app.secret_key = store.secret()
        app.config['SESSION_COOKIE_SECURE'] = _cookie_secure()
        request.environ['filey.storage_dir'] = str(storage_dir)
        if (request.method in MUTATING_METHODS
                and request.endpoint not in CSRF_EXEMPT_ENDPOINTS
                and session.get('user_id')):
            if not _csrf_valid():
                return jsonify({'error': 'invalid csrf token'}), 403
        return None

    return store


def configured_setup_token():
    token = os.environ.get('FILEY_SETUP_TOKEN')
    if token:
        return token
    try:
        return (Path(current_app.extensions['filey_auth']['storage_dir'])
                / SETUP_TOKEN_FILENAME).read_text(encoding='utf-8').strip()
    except (OSError, KeyError):
        return ''


# -- CLI --------------------------------------------------------------------

def setup_token_valid(token):
    expected = configured_setup_token()
    if not expected or not token:
        return False
    return hmac.compare_digest(str(token), str(expected))


def _cli_storage_dir():
    raw = os.environ.get('FILEY_STORAGE_DIR')
    if raw:
        return Path(raw).expanduser()
    try:
        text = Path('/etc/filey/install.conf').read_text(encoding='utf-8')
        for line in text.splitlines():
            key, _, value = line.partition('=')
            if key.strip() == 'STORAGE_DIR' and value.strip():
                return Path(value.strip()).expanduser()
    except OSError:
        pass
    from backend.core import config as app_config
    default = app_config.default_storage_dir()
    if default.is_dir():
        return default
    return Path(__file__).resolve().parents[2] / 'backend-data'


def create_admin_cli(username, storage_dir=None):
    storage_dir = Path(storage_dir) if storage_dir else _cli_storage_dir()
    store = JsonUserStore(storage_dir)
    if store.get_by_username(username):
        print(f'User "{username}" already exists; refusing to overwrite.')
        return 1
    password = getpass.getpass('New admin password: ')
    if len(password) < 8:
        print('Password must be at least 8 characters.')
        return 1
    confirm = getpass.getpass('Confirm password: ')
    if password != confirm:
        print('Passwords do not match.')
        return 1
    try:
        user = store.create(username, password, role='admin')
    except AuthError as error:
        print(error.message)
        return 1
    audit(storage_dir, 'user.create', username, role='admin', source='cli',
          target=user['username'])
    print(f'Admin "{username}" created in {storage_dir / USERS_FILENAME}.')
    print('Restart Filey (or it will pick the user up on the next request).')
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description='Filey account management')
    sub = parser.add_subparsers(dest='command', required=True)
    create = sub.add_parser('create-admin', help='create an administrator')
    create.add_argument('username')
    create.add_argument('--storage-dir', default=None)
    args = parser.parse_args(argv)
    if args.command == 'create-admin':
        return create_admin_cli(args.username, args.storage_dir)
    parser.error('unknown command')
    return 2

