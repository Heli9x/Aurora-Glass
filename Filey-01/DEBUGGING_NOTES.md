# Debugging notes — Linux CLI helper client (final, verified)

Scope: `deployment/linux/client/helper_client.py` (worker) and
`deployment/linux/client/operator_ctl.py` (operator approve/remove) against
`server.py` / `backend/worker_gate.py`.

Status: **fixed and verified with a real, complete live HTTP round-trip**
(register → real ffmpeg benchmark → HTTP register → operator HTTP-approve →
worker HMAC `claim_many`), using the actual on-disk client code, ending in the
correct terminal state (404 "unknown or inactive job" because no job existed —
i.e. auth succeeded, only business logic said no).

## Real product bugs found and fixed

1. **Worker HMAC signed the wrong shape.** `helper_client.py` prefixed
   `('worker', did, …)` and duplicated `device_id`. The server verifies
   **action-first, no prefix, no did-dup**:
   - `claim_many` → `('claim_many', did, job_key, count)`
   - `claim` → `('claim', did, job_key, idx)`
   - `upload` → `('upload', did, job_key, idx)`
   Fixed at the `claim_many` and `upload_chunk` sign sites.

2. **`authorize_operator_cfg` in `helper_client.py` signed the wrong shape**
   (`('admin', did, action, target, …)`, missing the `'operator'` prefix and
   did-duplication). It was dead code (never called), so it wasn't causing
   live failures, but it was wrong and misleading. Fixed to match the real
   contract: `('operator', did, 'admin', did, action, target, …)`.

3. **`register()`'s benchmark subprocess was fundamentally broken, three ways:**
   - Wrong path resolution (`WORKDIR.parent/backend/benchmark.py` doesn't
     exist at any level from `deployment/linux/client/`); real file is at
     the repo root: `backend/benchmark.py`.
   - Invoked as a bare script (`python backend/benchmark.py`), which fails
     with `ModuleNotFoundError: No module named 'backend'` because Python
     only adds the *script's own directory* to `sys.path`, not the repo
     root, and `benchmark.py` does `from backend import hls_project26`.
   - Passed a nonexistent `--local` flag; the real CLI only accepts
     `--min-rt` and `--json`.
   - Fixed: invoke via `[py, '-m', 'backend.benchmark', '--json']` with
     `cwd=<repo root>`.

4. **Benchmark JSON output parsing was wrong.** `benchmark.py --json` prints
   pretty-printed (multi-line, indented) JSON, but `register()` parsed only
   `stdout.strip().splitlines()[-1]` (just the closing `"}"`, invalid alone),
   so `benchmark` was always `{}` and registration always failed with
   `"benchmark must have ran successfully"`. Fixed to parse the whole stdout.

5. **`operator_ctl.py` posted to the wrong URLs entirely.** The real routes are:
   - approve: `POST /api/processing/workers/<device_id>/approve` (target id
     is a **URL path segment**, not a JSON body field), body
     `{operator_device_id, approved, signature}`.
   - remove: `DELETE /api/processing/workers/<device_id>` (method is
     **DELETE**, path is `/api/processing/workers/<did>`, there is no
     `/remove` route at all), body `{operator_device_id, signature}`.
   The tool was POSTing to flat `/approve` and `/remove` paths with
   `device_id` in the body. Fixed `_raw_json` to support method override and
   `_run` to build the correct path/body per route. (The HMAC signature
   shape itself — `('operator', op, 'admin', op, action, target, …)` — was
   already correct; verified against `worker_gate.authorize_operator`'s
   literal source: `verify(secret, signature, 'operator', did, *parts)`.)

6. **`operator_ctl.py`'s `_run()` had an inconsistent return type** — some
   paths returned `(status, text)`, others returned a bare `int`, so any
   caller doing `status, text = _run(...)` crashed with
   `TypeError: cannot unpack non-iterable int object`. Fixed to always return
   `(status, text)`; `main()` updated to match and to actually print the
   response (it previously silently discarded it).

## Environment variables (verified from source, not guessed)

- Server bind: `FILEY_PORT` (default 9100), `FILEY_STORAGE_DIR`
  (`server.py:787`, `:19`). Host is hardcoded to `0.0.0.0`, not env-driven.
- Worker/operator tokens — used identically by client and server —
  are `FS_WORKER_TOKEN` / `FS_OPERATOR_TOKEN` (`backend/worker_gate.py:27-28`,
  `deployment/linux/client/helper_client.py`, `operator_ctl.py`). These must
  be set **on the server process itself** (`worker_gate` reads `os.environ`
  in-process), not just the client.
- `FS_ALLOW_CLIENT_WORKERS` (default off) gates whether `claim_many`/`claim`
  will ever hand out real work — separate from auth, a deliberate safety
  default.
- Client-side config: `FS_SERVER_URL`, `FS_WORKER_TOKEN`, `FS_DEVICE_ID`,
  `FS_DEVICE_NAME`, `FS_OPERATOR_TOKEN` (`helper_client.configured()`).

Correction to an earlier draft of this doc: it previously claimed the server
reads `FILEY_WORKER_TOKEN`/`FILEY_OPERATOR_TOKEN`. That was wrong — those
names don't exist anywhere in the codebase. Confirmed by direct grep across
`server.py` + `backend/worker_gate.py`.

## Bootstrap note (by design, not a bug)

There is no HTTP path to create or approve the very first admin/operator
device — `worker_gate.register()`'s `role`/`token` kwargs are never passed
by the HTTP `/register` route (every HTTP registration is forced to
`ROLE_NORMAL`), and `approve()` only flips a bool, it can't grant a role.
The first admin must be created and approved with direct, local calls to
`worker_gate.register(storage_root, id, name, benchmark, role=ROLE_ADMIN,
token=operator_secret)` and `worker_gate.approve(storage_root, id, True)` —
i.e. by whoever has filesystem/process access to the server. After that,
`operator_ctl.py` works entirely over HTTP for everything else.

## Verified end-to-end (final run)

```
0a) bootstrap register admin -> True None
0b) bootstrap approve admin  -> True None
[helper] registered cl-wire-fix as 'Wire Fix Client'
[helper] benchmark: True rt=4.307 -> awaiting operator approval
1) register client (real benchmark + real HTTP) -> True
2) operator approves client -> 200 {"approved":true,"device_id":"cl-wire-fix"}
3) claim_many (patched action-first HMAC, real route) -> None   # 404: no such job (expected — none created)
```

No auth/signature errors anywhere in the chain. The linux CLI helper and
operator CLI are wired correctly end-to-end.

## Harness pitfalls hit along the way (not product bugs, recorded so they
## aren't repeated)

- `pkill -f <pattern>` reliably wedged this persistent shell session
  (reproducible even against zero matching processes) — use `ps` + `kill -9
  <pid>` or `fuser -k <port>/tcp` instead.
- Repo root contains a space (`Aurora _Glass`); `for x in $unquoted_path`
  word-splits it silently. Always resolve with `find` and keep it quoted.
- Backgrounding a server with `&` in the *same* shell call as a polling loop
  can wedge the tool if any fd isn't redirected; spawn with
  `setsid … </dev/null >log 2>&1 &` in its own call, then poll in a
  **separate** call.
