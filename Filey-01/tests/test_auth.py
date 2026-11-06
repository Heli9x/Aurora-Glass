import importlib
import io
import json
import os
import shutil
import stat
import tempfile
import threading
import time
import unittest
from pathlib import Path

from werkzeug.datastructures import FileStorage

import backend.auth as auth

ENV_KEYS = (
    'FILEY_CORS_ORIGINS',
    'FILEY_SESSION_HOURS',
    'FILEY_COOKIE_SECURE',
    'FILEY_LOGIN_MAX_ATTEMPTS',
    'FILEY_LOGIN_WINDOW_SECONDS',
    'FILEY_SETUP_TOKEN',
)
VALID_PASSWORD = 'correct-horse-battery'
SEGMENT_ID = 'segment-test-file'


def load_app(storage_dir, extra_env=None):
    for key in ENV_KEYS:
        os.environ.pop(key, None)
    os.environ['FILEY_STORAGE_DIR'] = str(storage_dir)
    if extra_env:
        os.environ.update(extra_env)
    import server
    importlib.reload(server)
    server.app.config['TESTING'] = True
    return server


def login(client, username, password=VALID_PASSWORD):
    return client.post('/api/auth/login',
                       json={'username': username, 'password': password})


def csrf_for(client, username, password=VALID_PASSWORD):
    response = login(client, username, password)
    assert response.status_code == 200, response.get_data(as_text=True)
    return response.get_json()['csrf_token']


class AppTestCase(unittest.TestCase):
    extra_env = None

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix='filey-auth-test-'))
        self.server = load_app(self.tmp, self.extra_env)
        self.store = self.server.auth_store
        self.admin = self.store.create('admin', VALID_PASSWORD, role='admin')
        self.client_user = self.store.create('client', VALID_PASSWORD, role='client')
        self.admin_client = self.server.app.test_client()
        self.client_client = self.server.app.test_client()
        self.admin_csrf = csrf_for(self.admin_client, 'admin')
        self.client_csrf = csrf_for(self.client_client, 'client')

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)
        for key in ENV_KEYS:
            os.environ.pop(key, None)

    def admin_mutating(self, method, path, **kwargs):
        headers = dict(kwargs.pop('headers', {}))
        headers['X-CSRF-Token'] = self.admin_csrf
        return getattr(self.admin_client, method)(path, headers=headers, **kwargs)

    def client_mutating(self, method, path, **kwargs):
        headers = dict(kwargs.pop('headers', {}))
        headers['X-CSRF-Token'] = self.client_csrf
        return getattr(self.client_client, method)(path, headers=headers, **kwargs)


class PasswordAndStoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix='filey-auth-store-'))
        self.store = auth.JsonUserStore(self.tmp)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_password_hash_and_unknown_user_path(self):
        user = self.store.create('alice', VALID_PASSWORD, role='admin')
        self.assertTrue(user['id'].startswith('u_'))
        self.assertEqual(self.store.verify_password('alice', VALID_PASSWORD)['id'],
                         user['id'])
        self.assertIsNone(self.store.verify_password('alice', 'wrong-password'))
        self.assertIsNone(self.store.verify_password('nobody', VALID_PASSWORD))
        raw = self.store.path.read_text(encoding='utf-8')
        self.assertNotIn(VALID_PASSWORD, raw)
        self.assertIn('password_hash', raw)

    def test_file_mode_and_atomic_replace(self):
        self.store.create('alice', VALID_PASSWORD)
        mode = stat.S_IMODE(self.store.path.stat().st_mode)
        self.assertEqual(mode, 0o600)
        leftovers = [item.name for item in self.tmp.iterdir()
                     if item.name.endswith('.tmp')]
        self.assertEqual(leftovers, [])

    def test_corrupt_file_becomes_empty_store(self):
        self.store.path.write_text('{ this is not json', encoding='utf-8')
        fresh = auth.JsonUserStore(self.tmp)
        self.assertEqual(fresh.list(), [])
        self.assertFalse(fresh.has_admin())

    def test_concurrent_creates_do_not_corrupt(self):
        errors = []

        def create(index):
            try:
                self.store.create(f'user{index}', VALID_PASSWORD)
            except Exception as error:  # pragma: no cover - assertion below
                errors.append(error)

        threads = [threading.Thread(target=create, args=(index,))
                   for index in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(errors, [])
        self.assertEqual(len(self.store.list()), 8)
        json.loads(self.store.path.read_text(encoding='utf-8'))
        self.assertEqual([item.name for item in self.tmp.iterdir()
                          if item.name.endswith('.tmp')], [])

    def test_secret_is_stable_and_rotatable(self):
        first = self.store.secret()
        self.assertEqual(auth.JsonUserStore(self.tmp).secret(), first)
        rotated = self.store.rotate_secret()
        self.assertNotEqual(first, rotated)
        self.assertEqual(auth.JsonUserStore(self.tmp).secret(), rotated)


class PermissionAndRateLimitTests(unittest.TestCase):
    def test_role_permission_map(self):
        admin_permissions = auth.ROLE_PERMISSIONS['admin']
        client_permissions = auth.ROLE_PERMISSIONS['client']
        self.assertEqual(set(admin_permissions), set(auth.ALL_PERMISSIONS))
        admin_only = set(auth.ALL_PERMISSIONS) - {'files.read'}
        self.assertTrue(admin_only.issubset(admin_permissions))
        self.assertFalse(admin_only.intersection(client_permissions))
        self.assertIn('files.read', client_permissions)
        for permission in auth.ROUTE_PERMISSIONS.values():
            self.assertIn(permission, admin_permissions)

    def test_rate_limit_window_with_injectable_clock(self):
        now = [100.0]
        limiter = auth.LoginRateLimiter(
            max_attempts=3, window_seconds=30, clock=lambda: now[0]
        )
        key = ('alice', '127.0.0.1')
        self.assertTrue(limiter.check(key)[0])
        self.assertFalse(limiter.fail(key)[0])
        self.assertFalse(limiter.fail(key)[0])
        locked, retry = limiter.fail(key)
        self.assertTrue(locked)
        self.assertEqual(retry, 30)
        self.assertFalse(limiter.check(key)[0])
        now[0] += 31
        self.assertTrue(limiter.check(key)[0])


class RouteCoverageTests(AppTestCase):
    def test_every_route_is_public_or_decorated(self):
        seen_permissions = {}
        for rule in self.server.app.url_map.iter_rules():
            endpoint = rule.endpoint
            view = self.server.app.view_functions[endpoint]
            permission = getattr(view, 'required_permission', None)
            if endpoint in auth.PUBLIC_ENDPOINTS:
                self.assertIsNone(permission, endpoint)
                continue
            self.assertIsNotNone(permission, f'unprotected route: {rule.rule}')
            self.assertEqual(permission, auth.ROUTE_PERMISSIONS.get(endpoint))
            seen_permissions[endpoint] = permission
        for endpoint in auth.ROUTE_PERMISSIONS:
            self.assertIn(endpoint, seen_permissions)

    def test_api_matrix_anonymous_client_admin(self):
        segment_dir = self.server.media.category_cache_dir('other') / SEGMENT_ID
        segment_dir.mkdir(parents=True, exist_ok=True)
        (segment_dir / 'clip.ts').write_bytes(b'segment-bytes')

        anonymous = self.server.app.test_client()
        for endpoint in auth.ROUTE_PERMISSIONS:
            method, path = self._request_spec(endpoint)
            with self.subTest(endpoint=endpoint, role='anonymous'):
                response = getattr(anonymous, method)(path)
                self.assertEqual(response.status_code, 401, (method, path))
            permission = auth.ROUTE_PERMISSIONS[endpoint]
            with self.subTest(endpoint=endpoint, role='client'):
                response = getattr(self.client_client, method)(
                    path, headers={'X-CSRF-Token': self.client_csrf}
                )
                if permission == 'files.read':
                    self.assertNotIn(response.status_code, (401, 403, 503),
                                     (method, path))
                else:
                    self.assertEqual(response.status_code, 403, (method, path))
            with self.subTest(endpoint=endpoint, role='admin'):
                response = getattr(self.admin_client, method)(
                    path, headers={'X-CSRF-Token': self.admin_csrf}
                )
                self.assertNotIn(response.status_code, (401, 403, 503),
                                 (method, path))
                self.assertLess(response.status_code, 500, (method, path))

    def _request_spec(self, endpoint):
        rules = list(self.server.app.url_map.iter_rules(endpoint))
        self.assertTrue(rules, endpoint)
        rule = rules[0]
        methods = rule.methods - {'HEAD', 'OPTIONS'}
        method = 'GET' if 'GET' in methods else sorted(methods)[0]
        method = method.lower()
        path = rule.rule
        path = path.replace('<path:segment>', 'clip.ts')
        path = path.replace('<segment>', 'clip.ts')
        path = path.replace('<file_id>', SEGMENT_ID)
        path = path.replace('<category_id>', 'movies')
        path = path.replace('<action>', 'pause')
        path = path.replace('<user_id>', 'u_missing')
        return method, path


class SetupRequiredTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix='filey-auth-setup-'))
        self.server = load_app(self.tmp)
        self.client = self.server.app.test_client()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_public_routes_work_without_admin(self):
        self.assertEqual(self.client.get('/api/health').status_code, 200)
        self.assertEqual(self.client.get('/api/discovery').status_code, 200)
        self.assertEqual(self.client.get('/').status_code, 200)
        self.assertEqual(self.client.get('/static/js/config.js').status_code, 200)

    def test_protected_routes_return_setup_required(self):
        for path in ('/api/files', '/api/settings', '/api/categories',
                     '/api/stats', '/api/users'):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.get_json()['error'], 'setup required')

    def test_me_and_login_report_setup(self):
        response = self.client.get('/api/auth/me')
        self.assertEqual(response.status_code, 401)
        self.assertTrue(response.get_json()['setup_required'])
        response = login(self.client, 'admin')
        self.assertEqual(response.status_code, 503)
        self.assertTrue(response.get_json()['setup_required'])

    def test_setup_token_creates_first_admin_once(self):
        os.environ['FILEY_SETUP_TOKEN'] = 'one-time-setup-token'
        try:
            response = self.client.post('/api/auth/setup', json={
                'token': 'wrong-token',
                'username': 'admin',
                'password': VALID_PASSWORD,
            })
            self.assertEqual(response.status_code, 403)
            response = self.client.post('/api/auth/setup', json={
                'token': 'one-time-setup-token',
                'username': 'admin',
                'password': VALID_PASSWORD,
            })
            self.assertEqual(response.status_code, 201)
            self.assertTrue(self.server.auth_store.has_admin())
            response = self.client.post('/api/auth/setup', json={
                'token': 'one-time-setup-token',
                'username': 'second',
                'password': VALID_PASSWORD,
            })
            self.assertEqual(response.status_code, 409)
        finally:
            os.environ.pop('FILEY_SETUP_TOKEN', None)
        response = login(self.server.app.test_client(), 'admin')
        self.assertEqual(response.status_code, 200)


class GuardTests(AppTestCase):
    def test_last_admin_and_self_guards(self):
        response = self.admin_mutating('patch', f"/api/users/{self.admin['id']}",
                                       json={'disabled': True})
        self.assertEqual(response.status_code, 400)
        response = self.admin_mutating('patch', f"/api/users/{self.admin['id']}",
                                       json={'role': 'client'})
        self.assertEqual(response.status_code, 400)
        response = self.admin_mutating('delete', f"/api/users/{self.admin['id']}")
        self.assertEqual(response.status_code, 400)

    def test_disable_other_user(self):
        response = self.admin_mutating('patch', f"/api/users/{self.client_user['id']}",
                                       json={'disabled': True})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()['user']['disabled'])
        self.assertIsNone(self.store.verify_password('client', VALID_PASSWORD))


class SecurityTests(AppTestCase):
    def test_csrf_required_on_mutations(self):
        response = self.admin_client.post('/api/settings', json={'name': 'X'})
        self.assertEqual(response.status_code, 403)
        response = self.admin_client.post(
            '/api/settings', json={'name': 'X'},
            headers={'X-CSRF-Token': 'wrong-token'}
        )
        self.assertEqual(response.status_code, 403)
        response = self.admin_mutating('post', '/api/settings', json={'name': 'X'})
        self.assertEqual(response.status_code, 200)
        response = login(self.server.app.test_client(), 'admin')
        self.assertEqual(response.status_code, 200)

    def test_logout_and_disabled_user_sessions(self):
        self.assertEqual(self.client_client.get('/api/files').status_code, 200)
        response = self.client_mutating('post', '/api/auth/logout')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client_client.get('/api/files').status_code, 401)

        other = self.server.app.test_client()
        csrf = csrf_for(other, 'client')
        self.assertEqual(other.get('/api/files').status_code, 200)
        self.admin_mutating('patch', f"/api/users/{self.client_user['id']}",
                            json={'disabled': True})
        self.assertEqual(other.get('/api/files').status_code, 401)
        self.assertTrue(csrf)

    def test_rotating_secret_signs_everyone_out(self):
        self.assertEqual(self.admin_client.get('/api/files').status_code, 200)
        self.store.rotate_secret()
        self.assertEqual(self.admin_client.get('/api/files').status_code, 401)

    def test_cookie_flags(self):
        os.environ['FILEY_COOKIE_SECURE'] = '1'
        try:
            response = login(self.server.app.test_client(), 'admin')
        finally:
            os.environ.pop('FILEY_COOKIE_SECURE', None)
        cookies = '; '.join(response.headers.getlist('Set-Cookie'))
        self.assertIn('HttpOnly', cookies)
        self.assertIn('SameSite=Lax', cookies)
        self.assertIn('Secure', cookies)

    def test_client_settings_are_trimmed(self):
        response = self.client_client.get('/api/settings')
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertNotIn('storage_dir', data)
        self.assertNotIn('candidates', data)
        self.assertNotIn('hls', data)
        self.assertNotIn(str(self.tmp), json.dumps(data))
        for category in data['categories']:
            self.assertNotIn('root', category)

    def test_no_secrets_in_responses_or_audit_log(self):
        secret = self.store.secret()
        failed = login(self.server.app.test_client(), 'admin', 'wrong-password')
        self.assertEqual(failed.status_code, 401)
        self.admin_mutating('post', '/api/settings', json={'name': 'Audit'})
        audit_text = (self.tmp / auth.AUDIT_FILENAME).read_text(encoding='utf-8')
        self.assertNotIn(VALID_PASSWORD, audit_text)
        self.assertNotIn('wrong-password', audit_text)
        self.assertNotIn(secret, audit_text)
        for response in (
            self.admin_client.get('/api/auth/me'),
            self.admin_client.get('/api/users'),
        ):
            body = response.get_data(as_text=True)
            self.assertNotIn(secret, body)
            self.assertNotIn(VALID_PASSWORD, body)
            self.assertNotIn('password_hash', body)

    def test_audit_log_is_json_lines(self):
        login(self.server.app.test_client(), 'admin', 'wrong-password')
        self.admin_mutating('post', '/api/settings', json={'name': 'Audited'})
        lines = (self.tmp / auth.AUDIT_FILENAME).read_text(
            encoding='utf-8').splitlines()
        records = [json.loads(line) for line in lines]
        self.assertGreaterEqual(len(records), 2)
        self.assertTrue(any(record['event'] == 'login.failed' for record in records))
        self.assertTrue(any(record['event'] == 'settings_post' for record in records))

    def test_rate_limit_returns_429_then_recovers(self):
        now = [1000.0]
        limiter = self.server.app.extensions['filey_auth']['limiter']
        limiter.clock = lambda: now[0]
        client = self.server.app.test_client()
        for _ in range(5):
            response = login(client, 'admin', 'wrong-password')
        self.assertEqual(response.status_code, 429)
        self.assertIn('Retry-After', response.headers)
        now[0] += limiter.window_seconds + 1
        response = login(client, 'admin', VALID_PASSWORD)
        self.assertEqual(response.status_code, 200)

    def test_stream_range_with_session_cookie(self):
        upload = FileStorage(
            stream=io.BytesIO(b'0123456789abcdef'),
            filename='clip.mp4',
            content_type='video/mp4',
        )
        record = self.server.media.add_upload(upload, display_name='Clip',
                                              file_type='movies')
        anonymous = self.server.app.test_client()
        response = anonymous.get(f"/api/files/{record['id']}/stream")
        self.assertEqual(response.status_code, 401)
        response = self.client_client.get(
            f"/api/files/{record['id']}/stream",
            headers={'Range': 'bytes=0-3'},
        )
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.data, b'0123')


class CorsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix='filey-auth-cors-'))
        self.server = load_app(
            self.tmp, {'FILEY_CORS_ORIGINS': 'https://allowed.example'}
        )
        self.server.auth_store.create('admin', VALID_PASSWORD, role='admin')
        self.client = self.server.app.test_client()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)
        for key in ENV_KEYS:
            os.environ.pop(key, None)

    def test_cors_allow_list(self):
        disallowed = self.client.get(
            '/api/health', headers={'Origin': 'https://evil.example'}
        )
        self.assertIsNone(disallowed.headers.get('Access-Control-Allow-Origin'))
        allowed = self.client.get(
            '/api/health', headers={'Origin': 'https://allowed.example'}
        )
        self.assertEqual(allowed.headers.get('Access-Control-Allow-Origin'),
                         'https://allowed.example')


class LegacyBehaviourTests(AppTestCase):
    def test_linked_delete_confirmation_flow(self):
        file_id = 'linked-file-1'
        source = self.tmp / 'clip.mp4'
        source.write_bytes(b'linked-data')
        pointer = {
            'media_type': 'movies',
            'category': 'movies',
            'root': 'movies',
            'mode': 'linked',
            'path': 'clip.mp4',
            'name': 'Linked clip',
            'file_name': 'clip.mp4',
            'time_added': '2026-01-01T00:00:00',
            'source_root': str(self.tmp),
            'tags': [],
        }
        (self.tmp / 'movies').mkdir(exist_ok=True)
        (self.tmp / 'movies' / f'{file_id}.json').write_text(
            json.dumps(pointer), encoding='utf-8'
        )
        response = self.admin_mutating('delete', f'/api/files/{file_id}')
        self.assertEqual(response.status_code, 409)
        self.assertTrue(response.get_json()['needs_confirmation'])
        response = self.admin_mutating(
            'delete', f'/api/files/{file_id}?delete_source=false'
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(source.exists())

    def test_confirm_relayout_flow(self):
        new_root = self.tmp / 'new-movies'
        new_root.mkdir()
        categories = {
            'movies': {
                'label': 'Movies', 'root': str(new_root), 'mode': 'managed',
                'extensions': ['.mp4'], 'icon': 'ri-play-fill',
            }
        }
        response = self.admin_mutating('post', '/api/settings',
                                       json={'categories': categories})
        self.assertEqual(response.status_code, 409)
        self.assertTrue(response.get_json()['needs_confirmation'])
        response = self.admin_mutating(
            'post', '/api/settings',
            json={'categories': categories, 'confirm_relayout': True},
        )
        self.assertEqual(response.status_code, 200)

    def test_search_and_filter_composition(self):
        for filename, content_type, category in (
            ('alpha.mp4', 'video/mp4', 'movies'),
            ('alpha.mp3', 'audio/mpeg', 'music'),
            ('beta.mp4', 'video/mp4', 'movies'),
        ):
            self.server.media.add_upload(
                FileStorage(stream=io.BytesIO(b'x'), filename=filename,
                            content_type=content_type),
                display_name=filename, file_type=category,
            )
        response = self.admin_client.get('/api/files?q=alpha&type=movies')
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data['total'], 1)
        self.assertEqual(data['files'][0]['type'], 'movies')
        response = self.admin_client.get('/api/search?q=alpha&type=music')
        self.assertEqual(response.get_json()['total'], 1)

    def test_custom_category_with_icon(self):
        response = self.admin_mutating('post', '/api/categories', json={
            'label': 'AI files',
            'extensions': ['.gguf'],
            'icon': 'ri-brain-line',
        })
        self.assertEqual(response.status_code, 201)
        categories = response.get_json()['categories']
        custom = next(item for item in categories if item['id'] == 'ai-files')
        self.assertEqual(custom['icon'], 'ri-brain-line')
        self.assertEqual(custom['extensions'], ['.gguf'])


if __name__ == '__main__':
    unittest.main()
