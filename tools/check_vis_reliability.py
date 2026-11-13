#!/usr/bin/env python3
"""VIS Reliability: source-level wiring/invariant checks, not a Rust build.

The real behavior is covered by Rust tests in instance_backup and
instance_health and requires Cargo/Windows/Linux validation before release.
"""
from pathlib import Path

root = Path(__file__).resolve().parent.parent
read = lambda path: (root / path).read_text(encoding="utf-8")
accounts = read("src-tauri/src/accounts.rs")
backup = read("src-tauri/src/instance_backup.rs")
health = read("src-tauri/src/instance_health.rs")
java = read("src-tauri/src/minecraft.rs")
horizon = read("src-tauri/src/horizon.rs")
main = read("src-tauri/src/main.rs")
ui = read("web/app.js")
types = read("types/vis-commands.ts")

checks = {
    "Backups off by default, preserved by serde":
        "auto_backup: false" in accounts
        and "#[serde(default)] pub auto_backup: bool" in accounts,
    "Owner-only VIS command registered and typed":
        "fn set_instance_auto_backup(" in main
        and "instance.source_owner.is_empty()" in main
        and "set_instance_auto_backup, backup_instance_data" in main
        and "set_instance_auto_backup:" in types,
    "UI exposes opt-in for personal and published projects":
        'name="auto_backup"' in ui
        and "instance-data-toggle-auto-backup" in ui
        and "auto_backup:data.has('auto_backup')" in ui,
    "Java + Horizon automatic backups before launch":
        "instance_backup::create_if_due(&dir)?" in main
        and "if instance.auto_backup && instance.installed && visitor.is_none()" in main
        and "if !shared && guest_name.is_none() && ins.auto_backup && ins.installed" in main,
    "Daily interval and bounded automatic retention":
        "AUTO_BACKUP_INTERVAL_SECS:u64=24*60*60" in backup
        and "MAX_AUTO_BACKUPS:usize=3" in backup
        and 'name.starts_with("vis-data-auto-")' in backup,
    "Manual backups are not expired by automatic rotation":
        "pub fn create(game:&Path)" in backup
        and "create_internal(game,false)" in backup
        and "automatic_backups(&backups)?.into_iter().skip(MAX_AUTO_BACKUPS)" in backup,
    "Crash restore stages block new launches and new backups":
        "pub fn require_clean_restore_state(game:&Path)" in backup
        and "require_clean_restore_state(game_dir)?" in java
        and "require_clean_restore_state(game_dir)?" in horizon
        and "require_clean_restore_state(game)?" in backup,
    "Failed revert keeps staging for human recovery":
        "Staging conservado en" in backup
        and "rollback.display(),stage.display()" in backup,
    "Safe diagnostics never publish complete log text":
        "fn classify_log_tail(contents:&str)" in health
        and "file.take(128*1024)" in health
        and "result.last_error_hint=latest_log_hint(game)" in health
        and "pub last_error_hint:String" in health
        and "Reportes de caída:" in ui,
    "Diagnostic UI opens only an authorized local folder":
        "instance-data-open-logs" in ui
        and "open_instance_location" in main,
    "Smoke examples link modules used by production backend":
        all('mod instance_backup;' in read(path) and "mod instance_lock;" in read(path)
            for path in ("src-tauri/examples/minecraft_smoke.rs",
                         "src-tauri/examples/horizon_smoke.rs")),
}

for description, passed in checks.items():
    print(("OK  " if passed else "FAIL"), description)
if not all(checks.values()):
    raise SystemExit("VIS Reliability source contracts are incomplete")
print(f"VIS Reliability source checks: {len(checks)}/{len(checks)}")
