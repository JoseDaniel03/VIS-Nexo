#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node --check web/app.js
node --check web/effects.js
node --check tools/dev.mjs
node tools/check.mjs
python3 tools/verify_bridge.py
python3 tools/check_rust_regressions.py
python3 -m json.tool src-tauri/tauri.conf.json >/dev/null
python3 -m json.tool src-tauri/capabilities/default.json >/dev/null
if [[ "${VS_TEST_BROWSER:-0}" == "1" ]]; then
  python3 tools/test_ui.py
  python3 tools/test_social_motion.py
  python3 tools/test_projects_v23.py
  python3 tools/test_minecraft_v24.py
  python3 tools/test_v26.py
  python3 tools/test_vis27.py
  python3 tools/test_vis28.py
  python3 tools/test_vis29.py
fi
if command -v cargo >/dev/null 2>&1; then
  echo 'Cargo disponible: verificando backend Rust...'
  cargo check -p vslauncher-tauri
else
  echo '[AVISO] Cargo no está disponible. No se ha verificado la compilación Rust.'
fi
