#!/usr/bin/env python3
"""operator_ctl — operator-tier control for the Filey helper pool.

Approves or removes a registered helper device. Only a device that is BOTH
approved AND carries the admin role can act, and every action must carry an
HMAC-SHA256 signature over the OPERATOR token (FS_OPERATOR_TOKEN).

The signed parts reproduce server.py's ``authorize_operator`` call sites
byte-for-byte. Verify against backend/worker_gate.py:

  authorize_operator(storage_root, device_id, signature, *parts)
    -> verify(secret, signature, 'operator', device_id, *parts)

  approve route (server.py): POST /api/processing/workers/<did>/approve
      parts = ('admin', operator, 'approve', did, int(approved))
  remove  route (server.py): DELETE /api/processing/workers/<did>
      parts = ('admin', operator, 'remove',  did)

so this tool signs over:

  approve: ('operator', OPERATOR_ID, 'admin', OPERATOR_ID, 'approve', TARGET, int(approved))
  remove:  ('operator', OPERATOR_ID, 'admin', OPERATOR_ID, 'remove',  TARGET)

The operator ID appears twice (once as device identity, once as the action
part) because the server routes intentionally pass it in both positions; the
signature must mirror that exactly or authorization fails. The target device
id is a URL path segment, not a body field, on both routes.

Usage:
  FS_OPERATOR_TOKEN=<op-token> \\
    ./operator_ctl.py <server-url> approve <target-device> [0|1] --operator-id <op-device-id>
  FS_OPERATOR_TOKEN=<op-token> \\
    ./operator_ctl.py <server-url> remove <target-device> --operator-id <op-device-id>

Requires: the operator device itself registered with role=admin and approved.
"""
import argparse
import hashlib
import hmac
import json
import os
import sys
import urllib.request
import urllib.error

WORKER_TOKEN_ENV = 'FS_WORKER_TOKEN'
OPERATOR_TOKEN_ENV = 'FS_OPERATOR_TOKEN'

DEVICE_RE = __import__('re').compile(r'^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$')


def _hmac_sign(secret, *parts):
    msg = '\n'.join(str(p) for p in parts)
    return hmac.new(secret.encode('utf-8'), msg.encode('utf-8'),
                    hashlib.sha256).hexdigest()


def _sanitize_device_id(raw):
    value = (raw or '').strip()
    return value if DEVICE_RE.match(value) else None


def _raw_json(url, payload, method='POST'):
    body = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode('utf-8-sig')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8-sig')


def _run(cfg, action, target, approved):
    operator = cfg['operator_id']
    did = _sanitize_device_id(target)
    if did is None:
        return 1, 'invalid target device id'
    if approved not in (0, 1):
        return 1, 'approved must be 0 or 1'
    op_secret = os.environ.get(OPERATOR_TOKEN_ENV, '').strip()
    if not op_secret:
        return 1, f'{OPERATOR_TOKEN_ENV} not set'
    if action == 'approve':
        sig = _hmac_sign(op_secret, 'operator', operator, 'admin', operator,
                         'approve', did, int(approved))
        url = cfg['url'].rstrip('/') + f'/api/processing/workers/{did}/approve'
        status, text = _raw_json(url, {
            'operator_device_id': operator,
            'approved': int(approved),
            'signature': sig,
        })
    else:
        sig = _hmac_sign(op_secret, 'operator', operator, 'admin', operator,
                         'remove', did)
        url = cfg['url'].rstrip('/') + f'/api/processing/workers/{did}'
        status, text = _raw_json(url, {
            'operator_device_id': operator,
            'signature': sig,
        }, method='DELETE')
    return status, text


def main(argv=None):
    ap = argparse.ArgumentParser(prog='operator_ctl')
    ap.add_argument('url', help='server base URL, e.g. http://192.168.1.20:8000')
    ap.add_argument('action', choices=('approve', 'remove'))
    ap.add_argument('target_device', help='device id to approve/remove')
    ap.add_argument('approved', nargs='?', type=int, default=1,
                    help='1/0 for approve (default 1)')
    ap.add_argument('--operator-id', required=True,
                    help='this operator device id (registered + approved + admin role)')
    args = ap.parse_args(argv)
    cfg = {'url': args.url, 'operator_id': args.operator_id.strip()}
    if _sanitize_device_id(cfg['operator_id']) is None:
        return 1
    status, text = _run(cfg, args.action, args.target_device, int(args.approved))
    print(text)
    return 0 if status < 400 else status


if __name__ == '__main__':
    sys.exit(main())
