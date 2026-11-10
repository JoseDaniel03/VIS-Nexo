#!/usr/bin/env python3
"""VIS 2.12 invariants — source checks, not a Rust compilation test."""
from pathlib import Path
p=Path(__file__).resolve().parent.parent
mc=(p/'src-tauri/src/minecraft.rs').read_text()
main=(p/'src-tauri/src/main.rs').read_text()
ui=(p/'web/app.js').read_text()
ombu=(p/'src-tauri/src/ombu.rs').read_text()
checks={
    'isolated new runtime': 'let runtime=new_runtime(&dir)' in mc and 'runtime_storage:"instance-v1".into()' in mc,
    'backwards compatible runtime': 'fn installed_runtime(' in mc and 'data_root.join("minecraft-runtime")' in mc,
    'read-only known roots': 'candidate_roots(data_root,known_instances,&runtime)' in mc and 'fn public_cache_roots()' in mc,
    'only copy with official SHA1': 'fn obtain_or_reuse(' in mc and 'if let Some(hash)=task.sha1.as_deref()' in mc,
    'verify as copy': 'hash.update(&buf[..read])' in mc and 'promote_download(&partial,target)?' in mc,
    'fresh file promotion': 'let partial=sibling_path(target,"reuse")?' in mc,
    'dedicated progress dock': 'function downloadDock()' in ui and 'function updateDownloadDock()' in ui,
    'import/export commands': all(x in main for x in ['fn export_worlds_instance(','fn import_worlds_instance(','mod ombu;']),
    'zip path safety': 'entry.enclosed_name()' in ombu and 'MAX_BYTES' in ombu,
    'new UI controls': all(x in ui for x in ['data-action="import-worlds-instance"','data-action="export-worlds-instance"']),
    'admin secret generated locally': "getpass.getpass('Clave segura" in (p/'tools/vis_ceibo_admin_local.py').read_text(),
    'preserve data app id': 'com.virgoland.vslauncher' in (p/'src-tauri/tauri.conf.json').read_text(),
}
for label,ok in checks.items():print(('OK' if ok else 'FAIL'),label)
if not all(checks.values()):raise SystemExit(1)
