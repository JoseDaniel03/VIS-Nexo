#!/usr/bin/env python3
"""Offline VIS Worlds contracts (source checks, not a substitute for cargo test)."""
from pathlib import Path
p=Path(__file__).resolve().parent.parent
accounts=(p/'src-tauri/src/accounts.rs').read_text()
backend=(p/'src-tauri/src/main.rs').read_text()
ui=(p/'web/app.js').read_text()
checks={
    'Offline owner prefix cannot impersonate registered user':
        'offline--' in accounts and 'offline_pref_owner' in accounts
        and 'valid_offline_owner' in accounts and 'self.get(name).is_none() && !valid_offline_owner(name)' in accounts,
    'Offline game profiles are persistent and have isolated storage':
        'fn guest_instances(&self)' in backend and 'self.storage.prefs(&owner).instances' in backend
        and 's.storage.save_prefs(&username,&prefs)?' in backend,
    'Guest cannot author admin projects':
        's.admin()?;' in backend and 's.guest_name.is_some() &&' in backend
        and 'instance.project_id!=PERSONAL_PROJECT_ID' in backend,
    'Guest can select Java but not Horizon personal installs':
        'instance.engine!="java"' in backend and 'project.engine!="java"' in backend,
    'Guest create/install/manage via same native bridge':
        'let username = s.player_owner()?;' in backend and
        'let (u,i)=checked_instance(&s,&project_id,&name,true)?' in backend and
        'locked(&state)?.player_owner()?' in backend,
    'Guest owns game processes, shared games remain isolated':
        's.machine_instances(None).into_iter()' in backend
        and 'let (owner,mut ins)=checked_instance(&s,&project_id,&name,true)?' in backend
        and 'if shared {' in backend and 'minecraft::launch_shared' in backend,
    'Guest cannot overwrite other accounts game directories':
        'se superpone con una instancia de otra cuenta VIS' in backend,
    'Guest can create, edit, import and manage local mods from UI':
        'const ownedInstances = ()' in ui and
        'const items=libraryMode' in ui and
        'function minecraftPage(){const i=selectedMcInstance();' in ui and
        'data-action="new-personal-instance"' in ui and 'import-worlds-instance' in ui,
    'Offline identity cannot gain online entitlement':
        "const isGuest = () => db.mode === 'offline';" in ui and
        'Para acceder a servidores online-mode' in ui,
    'Offline profile persists through local guest namespace only':
        'offline_nick_has_isolated_persistent_preferences_without_registration' in accounts,
}
for label, ok in checks.items():
    print(('OK' if ok else 'FAIL'), label)
if not all(checks.values()):
    raise SystemExit('Offline profile source contracts failed')
print(f'Offline profile checks: {sum(checks.values())}/{len(checks)}')
