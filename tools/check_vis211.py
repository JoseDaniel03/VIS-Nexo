#!/usr/bin/env python3
"""VIS v2.11 source invariants; NOT Rust compiler verification."""
from pathlib import Path
p=Path(__file__).resolve().parent.parent
mc=(p/'src-tauri/src/minecraft.rs').read_text()
main=(p/'src-tauri/src/main.rs').read_text()
ui=(p/'web/app.js').read_text()
checks={
 'distinct download temp path': 'sibling_path(target,"part")?' in mc and 'target.with_extension("part")' not in mc,
 'safe file replacement': 'promote_download(&temp,target)?' in mc and 'if target.exists(){fs::remove_file(target)' not in mc,
 'reject symlink target': 'fs::symlink_metadata(target)' in mc and 'metadata.file_type().is_symlink()' in mc,
 'reject conflicting checksum': 'fn normalize_download_plan' in mc and 'Conflicto de SHA-1 de biblioteca' in mc,
 'stage mods before promotion': mc.index('obtain_file(&c,url,&stage.join(name)')<mc.index('promote_mod_batch(&directory,&stage,&changed)'),
 'mod batch rollback': 'for (file,backup) in promoted.into_iter().rev()' in mc,
 'require Modrinth checksum': 'Modrinth no suministró SHA-1' in mc,
 'no filename collision': 'Dos mods intentan usar el archivo' in mc,
 'instance path collision': (
   'instance_guard::independent(&dir,&previous_dir)?' in main
   and 'mod instance_guard;' in main
   and 'crate::instance_guard::destination(' in mc
   and '.minecraft' in (p/'src-tauri/src/instance_guard.rs').read_text()
 ),
 'enable disable files': 'pub fn toggle_local(' in mc and 'async fn toggle_instance_file(' in main and "data-action=\"toggle-instance-file\"" in ui,
 'retain app identifier': 'com.virgoland.vslauncher' in (p/'src-tauri/tauri.conf.json').read_text(),
}
for key,ok in checks.items():print(('OK' if ok else 'FAIL'),key)
if not all(checks.values()):raise SystemExit('source invariant failed')
