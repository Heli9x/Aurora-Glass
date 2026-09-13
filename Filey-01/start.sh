#!/bin/bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PYTHON="$PROJECT_DIR/.venv/bin/python3"

if [[ ! -x "$PYTHON" ]]; then
	echo "Missing virtual environment: $PROJECT_DIR/.venv" >&2
	exit 1
fi
exec "$PYTHON" "$PROJECT_DIR/server.py"
