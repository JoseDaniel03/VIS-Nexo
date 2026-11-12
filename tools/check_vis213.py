#!/usr/bin/env python3
"""Source invariants for Horizon and offline sharing. Does not compile Rust."""
from pathlib import Path
p=Path(__file__).resolve().parent.parent
main=(p/'src-tauri/src/main.rs').read_text()
accounts=(p/'src-tauri/src/accounts.rs').read_text()
mc=(p/'src-tauri/src/minecraft.rs').read_text()
hor=(p/'src-tauri/src/horizon.rs').read_text()
ui=(p/'web/app.js').read_text()
checks={
 'Horizon game client direct (no Horizon launcher)': 'horizon-client' in hor and 'horizon-launcher' not in hor.split('pub fn launch(')[-1],
 'API capability detection': '--launch-api' in hor and '0.1.' in hor,
 'preparer resource verification': '--check' in hor and '--complete' in hor,
 'separate Horizon worlds': '--game-dir' in hor and 'horizon-resources' in hor,
 'session not persisted in account': 'access_token' not in accounts and '--session-stdin' in hor and 'session_file' in main,
 'engine persisted without breaking previous profiles': 'default_engine' in accounts and '#[serde(default)] pub share_offline' in accounts,
 'shared machine instances opt-in replaced': 'fn machine_instances' in main and 'self.machine_instances(None)' in main,
 'guest reuses same instance world by default': 'pub fn launch_guest' in mc and 'shared_game_directory(data_root,owner,ins,guest)' in mc,
 'shared world directory by default': 'if ins.share_game_data {' in mc and 'prepare_player_directory(&root)?' in mc,
 'optional profile data isolation retained': 'pub fn private_shared_game_directory' in mc and '.vis/players' in mc,
 'old instance settings remain compatible': 'default_shared_game_data' in accounts,
 'legacy world and server recovery': 'pub fn shared_recovery' in mc and 'SHARED_RESTORE_FILES' in mc,
 'UI engine selector': 'mc-instance-engine' in ui and 'Minecraft Rust Edition — Horizon' in ui,
 'UI shared instance labels': 'Instalada por' in ui,
 'Horizon installer routed to adapter': 'horizon::prepare(&cloned_app' in main,
 'Horizon launch routed to adapter': 'horizon::launch(&app' in main,
}
for k,v in checks.items():print(('OK' if v else 'FAIL'),k)
if not all(checks.values()):raise SystemExit(1)
