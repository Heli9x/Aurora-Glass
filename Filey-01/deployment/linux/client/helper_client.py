#!/usr/bin/env python3
"""Filey Linux helper — claim → parallel encode → upload worker.

A tiny stdlib-only client that lives on an approved Linux **helper** device
(laptop/desktop with ffmpeg). It PULLS work from the Filey server:

    benchmark (once) → register → waits for operator approval →
    loop: claim_many → parallel ffmpeg encode of each chunk → upload

The helper never opens a port: everything is an outbound authenticated request.
Every claim and upload is HMAC-SHA256-signed exactly as ``backend/worker_gate``
expects, so only tokens and no server secrets ever leave the server.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import hmac
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

WORKDIR = Path(__file__).resolve().parent
if str(WORKDIR.parent) not in sys.path:
    sys.path.insert(0, str(WORKDIR.parent))
if str(WORKDIR) not in sys.path:
    sys.path.insert(0, str(WORKDIR))


def _hmac_sign(secret, *parts):
    """Same HMAC->hex shape as worker_gate.sign (SHA256, '\\n'-joined parts)."""
    msg = '\n'.join(str(p) for p in parts)
    return hmac.new(secret.encode('utf-8'), msg.encode('utf-8'),
                    hashlib.sha256).hexdigest()


def _json_request(url, payload, method='POST'):
    body = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode('utf-8-sig')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8-sig')


def configured():
    """Read FS_SERVER_URL / FS_WORKER_TOKEN / FS_DEVICE_ID / FS_DEVICE_NAME."""
    url = os.environ.get('FS_SERVER_URL', '')
    token = os.environ.get('FS_WORKER_TOKEN', '')
    device_id = os.environ.get('FS_DEVICE_ID', '').strip()
    device_name = os.environ.get('FS_DEVICE_NAME', '').strip()
    if not url or not token:
        raise SystemExit('FS_SERVER_URL and FS_WORKER_TOKEN are required '
                         '(export them, see deployment/linux/client/README.md)')
    return {
        'url': url.rstrip('/'),
        'token': token,
        'device_id': device_id,
        'device_name': device_name,
    }


def register(cfg):
    """Run the local benchmark, then register this device on the server."""
    py = sys.executable
    repo_root = WORKDIR.parent.parent.parent
    proc = subprocess.run(
        [py, '-m', 'backend.benchmark', '--json'],
        cwd=str(repo_root), capture_output=True, text=True, timeout=180)
    benchmark = {}
    if proc.returncode == 0:
        try:
            benchmark = json.loads(proc.stdout.strip())
        except ValueError:
            benchmark = {}
    did = cfg['device_id'] or f"dev-{int(time.time())}"
    payload = {
        'device_id': did,
        'device_name': cfg['device_name'] or os.uname().nodename,
        'token': cfg['token'],
        'benchmark': benchmark,
        'role': 'normal',
    }
    status, text = _json_request(f"{cfg['url']}/api/processing/workers/register",
                                payload)
    code = json.loads(text or '{}')
    if status == 201:
        print(f"[helper] registered {did} as '{payload['device_name']}'")
        print(f"[helper] benchmark: {benchmark.get('ok')} "
              f"rt={benchmark.get('realtime_ratio')} "
              f"-> awaiting operator approval")
        return True
    print(f"[helper] register failed {status}: {code.get('error')}")
    return False


def authorize_operator_cfg(cfg, target, action, *extra):
    """HMAC for operator-tier actions, opaque to normal helpers.

    Must mirror backend/worker_gate.authorize_operator's expected shape:
    ('operator', operator_device_id, 'admin', operator_device_id, action,
    target, *extra) -- the operator id appears twice because the server
    routes intentionally pass it in both positions.
    """
    token = os.environ.get('FS_OPERATOR_TOKEN', '')
    if not token:
        return ''
    return _hmac_sign(token, 'operator', cfg['device_id'], 'admin',
                      cfg['device_id'], action, target, *extra)


def claim_many(cfg, job_key, count):
    payload = {
        'device_id': cfg['device_id'],
        'job_key': job_key,
        'count': count,
        'signature': _hmac_sign(cfg['token'], 'claim_many',
                                cfg['device_id'], job_key, count),
    }
    status, text = _json_request(f"{cfg['url']}/api/processing/workers/claim_many",
                                payload)
    data = json.loads(text or '{}')
    if status == 200:
        return data.get('claims') or []
    if status == 404:
        return None
    print(f"[helper] claim_many {status}: {data.get('error')}")
    return []


def fetch_segment(cfg, request, out_path):
    """Download the encoded segment bytes for a chunk via its source_url."""
    src = request.get('source_url')
    if not src:
        return False
    url = src if src.startswith('http') else f"{cfg['url']}{src}"
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            data = r.read()
        out_path.write_bytes(data)
        return True
    except Exception as e:
        print(f"[helper] fetch {src} failed: {e}")
        return False


def encode_chunk(cfg, grant):
    """Encode one chunk with ffmpeg into segments; returns segment names or []."""
    from backend import hls_project26 as hls
    recipe = grant.get('recipe') or {}
    seg_prefix = recipe.get('segment_prefix') or 'stream_'
    idx = int(grant['chunk_index'])
    segs = recipe.get('segments') or SEGS_PER_CHUNK
    total = int(grant['total_chunks'] or 1)
    chunk_dur = float(grant.get('chunk_duration_seconds') or 0)
    start_sec = float(grant.get('chunk_start_seconds') or 0)

    # Build the HLS recipe the same way the server's own pipeline does, using
    # the exact recipe the server embedded in our grant.
    cache = Path(tempfile.mkdtemp(prefix='filey_worker_'))
    try:
        stream = cache.resolve()
        cmd = [
            'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
            '-i', grant.get('source_url') or f"{cfg['url']}/api/files/"
            f"{grant['job_key']}/stream",
        ]
        # pull just the chunk's time span when the source is a file
        if start_sec:
            cmd += ['-ss', f'{start_sec:.3f}', '-t', f'{chunk_dur:.3f}']
        cmd += ['-c:v', 'libx264', '-preset', 'veryfast',
                '-profile:v', 'main', '-g', str(int(chunk_dur)), '-sc_threshold', '0',
                '-c:a', 'aac', '-b:a', '128k',
                '-f', 'hls', '-hls_time', str(HLS_TIME),
                '-hls_list_size', '0', '-hls_segment_filename',
                str(stream / f'{seg_prefix}%03d.mp4'),
                str(stream / 'stream.m3u8')]
        run = subprocess.run(cmd, capture_output=True, text=True, timeout=None)
        if run.returncode != 0:
            print(f"[helper] encode chunk {idx} failed: "
                  f"{run.stderr.strip()[-200:]}")
            return []
        seg_files = sorted(stream.glob(f'{seg_prefix}*.mp4'))
        names = [f.name for f in seg_files]
        print(f"[helper] chunk {idx} encoded: {len(names)} segments")
        if not names:
            return []
        # Now upload
        upload_ok, detail = upload_chunk(cfg, grant, stream, names)
        return names if upload_ok else []
    finally:
        import shutil
        shutil.rmtree(cache, ignore_errors=True)


def upload_chunk(cfg, grant, cache_dir, seg_names):
    """POST the manifest + segment mp4s via the worker upload endpoint."""
    from backend import hls_project26 as hls
    from backend import worker_gate
    url = f"{cfg['url']}/api/processing/workers/upload"
    idx = int(grant['chunk_index'])
    job_key = str(grant['job_key'])
    sig = _hmac_sign(cfg['token'], 'upload', cfg['device_id'],
                     job_key, idx)
    boundary = '----fileyworker%d' % int(time.time() * 1000)
    body = b''
    def part(name, value, fname=None, content=b''):
        nonlocal body
        disp = f'name="{name}"' + (f'; filename="{fname}"' if fname else '')
        body += (f'--{boundary}\r\nContent-Disposition: form-data; {disp}\r\n'
                 .encode())
        if fname:
            body += b'Content-Type: video/mp4\r\n'
        body += b'\r\n' + (value.encode() if isinstance(value, str) else value) + b'\r\n'
    part('device_id', cfg['device_id'])
    part('job_key', job_key)
    part('chunk_index', str(idx))
    part('signature', sig)
    # manifest part
    manifest = {'init': 'init.mp4', 'segments': [
        {'uri': n} for n in seg_names]}
    part('manifest', json.dumps(manifest))
    for n in seg_names:
        part('segment', (cache_dir / n).read_bytes(), fname=n)
    body += f'--{boundary}--\r\n'.encode()
    req = urllib.request.Request(url, data=body, method='POST')
    req.add_header('Content-Type', f'multipart/form-data; boundary={boundary}')
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            data = json.loads(r.read().decode('utf-8-sig') or '{}')
            return data.get('ok', False), data
    except urllib.error.HTTPError as e:
        data = json.loads(e.read().decode('utf-8-sig') or '{}')
        return False, data


def run_loop(cfg, job_key, workers=1):
    print(f"[helper] worker {cfg['device_id']} polling job {job_key} "
          f"(workers={workers})")
    while True:
        claims = claim_many(cfg, job_key, workers)
        if claims is None:
            print(f"[helper] job {job_key} no longer active; exiting")
            return 0
        if not claims:
            if job_key:
                time.sleep(2)
                continue
        results = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
            futs = {ex.submit(encode_chunk, cfg, g): g for g in claims}
            for fut in concurrent.futures.as_completed(futs):
                names = fut.result()
                results.append(names)
        if not job_key:
            print("[helper] nothing to do; idle")
            time.sleep(10)


def main():
    ap = argparse.ArgumentParser(prog='filey_helper')
    ap.add_argument('job_key', nargs='?', help='job to pull chunks from')
    ap.add_argument('--workers', type=int, default=1)
    ap.add_argument('--once', action='store_true',
                    help='benchmark+register then claim ONE chunk and exit')
    ap.add_argument('--register', action='store_true',
                    help='just run benchmark and register, then exit')
    args = ap.parse_args()
    cfg = configured()
    if args.register:
        return 0 if register(cfg) else 1
    if not register(cfg):
        return 1
    # poll until approved
    print("[helper] waiting for operator to approve...")
    while True:
        claims = claim_many(cfg, args.job_key or 'x', 1)
        if claims is None or claims:
            break
        time.sleep(3)
    if args.once:
        return 0
    run_loop(cfg, args.job_key, args.workers)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
