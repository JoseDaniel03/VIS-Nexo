#!/usr/bin/env python3
"""Check v2.14 source contracts; cannot replace the Rust compiler."""
from pathlib import Path
p=Path(__file__).resolve().parent.parent
h=(p/'src-tauri/src/horizon.rs').read_text()
ui=(p/'web/app.js').read_text()
main=(p/'src-tauri/src/main.rs').read_text()
checks={
 'Horizon native executables only': 'horizon-client' in h and 'horizon-prepare' in h and 'horizon-launcher' not in h.split('pub fn launch(')[-1],
 'Version and CLI options checked': 'fn compatible(' in h and 'fn require_options(' in h and '--session-stdin' in h,
 'Resources checked with Horizon stamp': 'arg("--check")' in h and 'output.status.success()' in h,
 'Pinned build fingerprint': 'lock_sha256:lock_hash(&folder)?' in h and 'r.build==client["horizon"]' in h,
 'Backward compatible marker deserialization': '#[serde(default)] lock_sha256:String' in h,
 'Progress monotonic': 'completed=completed.max(' in h,
 'Child killed on token-pipe failure': 'let _=child.kill();let _=child.wait();' in h,
 'Offline guest identity uses shared instance data': 'pub fn launch_guest' in (p/'src-tauri/src/minecraft.rs').read_text() and 'shared_game_directory(data_root,owner,ins,guest)' in (p/'src-tauri/src/minecraft.rs').read_text(),
 'Local build discovery bounded': 'entries.take(60)' in h and 'found.truncate(20)' in h,
 'Diagnostics registered': 'fn horizon_diagnostics(' in main and 'horizon_diagnostics, horizon_source_build, horizon_local_builds,' in main,
 'Diagnostics escaped in UI': '${esc(c.label)}' in ui and '${esc(c.detail)}' in ui,
 'Java controls unavailable for Horizon': "i.engine==='horizon'?'':`<div class=\"mc-manager-grid\"" in ui,
 'VIS v2.14 CSS loaded': 'vis-nexo-v2.14.css' in (p/'web/index.html').read_text(),
 'Preserved existing app data identifier': 'com.virgoland.vslauncher' in (p/'src-tauri/tauri.conf.json').read_text(),
}
for name,passed in checks.items():print(('OK' if passed else 'FAIL'),name)
if not all(checks.values()):raise SystemExit(1)
