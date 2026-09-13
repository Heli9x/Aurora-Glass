#!/bin/bash

set -u

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${FILEY_PORT:-9100}"
killed=0

kill_project_server() {
    local pid cwd
    for pid in "$@"; do
        [ -z "$pid" ] && continue
        case "$pid" in *[!0-9]*) continue ;; esac
        cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null)" || continue
        if [ "$cwd" = "$PROJECT_DIR" ]; then
            kill "$pid" 2>/dev/null && killed=$((killed + 1))
        fi
    done
}

kill_project_server $(pgrep -f 'server\.py' || true)
sleep 1

if leak="$(fuser "$PORT/tcp" 2>/dev/null)"; then
    kill_project_server $leak
fi

for _ in $(seq 1 40); do
    if [ -z "$(fuser "$PORT/tcp" 2>/dev/null)" ]; then
        break
    fi
    sleep 0.5
done

if [ -n "$(fuser "$PORT/tcp" 2>/dev/null)" ]; then
    echo "stop.sh: port $PORT is still in use" >&2
    exit 1
fi

if [ "$killed" -gt 0 ]; then
    echo "Stopped $killed Filey server instance(s)"
fi
exit 0