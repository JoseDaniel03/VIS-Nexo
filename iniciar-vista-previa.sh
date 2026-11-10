#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then echo 'Falta Node.js'; exit 1; fi
echo 'Vista previa sin backend: http://127.0.0.1:1420'
exec node tools/dev.mjs
