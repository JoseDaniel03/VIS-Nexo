#!/usr/bin/env python3
"""Source contracts for new Horizon build library (not a substitute for cargo test)."""
from pathlib import Path
import json
p=Path(__file__).resolve().parent.parent
rust=(p/'src-tauri/src/horizon_download.rs').read_text()
hor=(p/'src-tauri/src/horizon.rs').read_text()
main=(p/'src-tauri/src/main.rs').read_text()
ui=(p/'web/app.js').read_text()
checks={
    'Bounded Launch API execution': 'Duration::from_secs(12)' in hor and 'stdout.take(1024*1024+1)' in hor,
    'Stores SHA256 for both game executables and research lock': 'fn game_stamp(' in rust and 'client_sha256:sha256_file(&binary(build,"horizon-client"))?' in rust and 'lock_sha256:sha256_file' in rust,
    'Streams binaries with 64KiB buffer': 'let mut buf=[0u8;64*1024]' in rust,
    'Hashes generated before release is published': rust.index('save_game_stamp(&build,&version)?') < rust.index('fs::rename(&unpacked,&destination)'),
    'Existing installations are never overwritten': 'if destination.exists(){' in rust and 'verify_managed_build(&build)?;' in rust,
    'Mismatch blocks managed binary execution': 'verify_managed_build(&folder)?;' in hor and 'return Err("Los binarios o research-lock.json' in rust,
    'Original or imported builds not falsely called verified': 'if !path.exists(){return Ok(false)}' in rust and '"legacy"' in rust,
    'Library only scans VIS-specific directory': 'data_root.join("horizon-builds")' in rust and 'entries.take(100)' in rust,
    'Library API requires an authenticated account': 'async fn horizon_installed_builds(state:State' in main and 's.username()?;s.data_root.clone()' in main,
    'Library is registered in Tauri': 'horizon_local_builds, horizon_installed_builds,' in main,
    'Unsafe builds cannot be selected': "if(['modified','incomplete'].includes(selected.integrity))" in ui,
    'No automatically selected unverified builds': "selected.integrity!=='verified' && !window.confirm" in ui,
    'Build library escapes all remote/local strings': '${esc(entry.tag)}' in ui and '${esc(entry.detail||entry.build_dir)}' in ui,
    'Styles are loaded': 'vis-nexo-v2.16.css' in (p/'web/index.html').read_text(),
    'Version metadata synchronized': all(x=='2.18.0' for x in [json.loads((p/'package.json').read_text())['version'],json.loads((p/'src-tauri/tauri.conf.json').read_text())['version']]),
}
for label,ok in checks.items():print(('OK' if ok else 'FAIL'), label)
if not all(checks.values()): raise SystemExit('Source contract v2.16 failed')
