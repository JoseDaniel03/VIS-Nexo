#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo 'Falta Node.js. Instalá nodejs y npm en CachyOS.' >&2; exit 1
fi
if ! command -v cargo >/dev/null 2>&1; then
  echo 'Falta Cargo/Rust. Instalá rustup y ejecutá rustup default stable.' >&2; exit 1
fi
if [[ ! -x node_modules/.bin/tauri ]]; then
  echo 'Instalando CLI de Tauri 2 (se necesita acceso a npm)...'
  npm install --no-audit --no-fund
fi
exec npm run dev
