#!/usr/bin/env bash
# Local development without Docker: Redis + API (reload) + worker + Vite.
# Requires: python3.12, node 20+, ffmpeg, redis-server.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV="${VENV:-$ROOT/backend/.venv}"
export STORAGE_DIR="${STORAGE_DIR:-$ROOT/storage}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"
mkdir -p "$STORAGE_DIR"

if [ ! -x "$VENV/bin/python" ]; then
  echo "→ creating virtualenv in $VENV"
  python3.12 -m venv "$VENV"
  "$VENV/bin/pip" install -q -r "$ROOT/backend/requirements-dev.txt" -r "$ROOT/backend/requirements-whisper.txt"
fi
if [ ! -d "$ROOT/frontend/node_modules" ]; then
  (cd "$ROOT/frontend" && npm install)
fi

pids=()
cleanup() { kill "${pids[@]}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

if ! redis-cli -u "$REDIS_URL" ping >/dev/null 2>&1; then
  redis-server --port 6379 --save "" --appendonly no >/dev/null &
  pids+=($!)
  sleep 0.5
fi
(cd "$ROOT/backend" && "$VENV/bin/uvicorn" app.main:app --reload --port 8000) &
pids+=($!)
(cd "$ROOT/backend" && "$VENV/bin/arq" app.worker.tasks.WorkerSettings) &
pids+=($!)
(cd "$ROOT/frontend" && npx vite --host) &
pids+=($!)
echo "→ Bannerka: http://localhost:5173  (API http://localhost:8000/api/docs)"
wait
