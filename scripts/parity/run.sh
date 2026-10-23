#!/usr/bin/env bash
# Preview = export calibration. Requires: backend venv (pillow, pydantic), ffmpeg,
# the Vite dev server (npm run dev) and playwright for node.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-$ROOT/storage/parity}"
PY="${PYTHON:-python3}"
"$PY" "$ROOT/scripts/parity/make_reference.py" "$OUT"
node "$ROOT/scripts/parity/render_preview.mjs" "$OUT" "${BASE_URL:-http://localhost:5173}"
"$PY" "$ROOT/scripts/parity/compare.py" "$OUT"
