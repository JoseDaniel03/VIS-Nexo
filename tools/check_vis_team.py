#!/usr/bin/env python3
"""Static contracts for VIS Team / protected superadmin bootstrap.
Not a substitute for Rust compilation and real Cloudflare R2 tests.
"""
from pathlib import Path
root=Path(__file__).resolve().parent.parent
def content(path):return (root/path).read_text(encoding="utf8")
pack=content("src-tauri/src/team_pack.rs")
cloud=content("src-tauri/src/cloud.rs")
native=content("src-tauri/src/main.rs")
worker=content("services/universe/worker.mjs")
ui=content("web/app.js")
types=content("types/vis-commands.ts")
superadmin=content("tools/prepare_social_superadmin.py")
workflow=content(".github/workflows/vis-social-superadmin.yml")
checks={
    "Superadmin requires registered online password public verifier":
        "password_hash='ed25519:{pub}'" in superadmin and
        "AND disabled_at IS NULL" in superadmin and
        "NOT EXISTS(SELECT 1 FROM social_users WHERE role='super_admin')" in superadmin,
    "Superadmin cannot create user or accept private keys":
        "INSERT INTO social_users" not in superadmin and
        "VIS_SUPERADMIN_PUBLIC_KEY" in superadmin and "cloud_credential_public_key" in workflow,
    "Team package is built from an owned administrator instance":
        "s.admin()?" in native and "project_team_sources(&s" in native
        and "i.source_owner.is_empty()" in native,
    "Worlds and personal data never auto-exported":
        "allow_root(" in pack and '"saves"' not in pack.split("fn allow_root")[1].split("fn validate_game")[0]
        and "config" in pack and "defaultconfigs" in pack
        and "exclusions(&name)" in pack,
    "Server addresses and waypoints require deliberate opt-in":
        "include_servers:bool" in pack and "include_waypoints:bool" in pack
        and "if options.include_servers" in pack and "if options.include_waypoints" in pack,
    "Mods reference Modrinth IDs, not JAR distribution":
        '"modrinth_project_ids":&project.modrinth_mods' in pack
        and '".jar"' in pack,
    "ZIP has manifest and per-file SHA checksums":
        'writer.start_file(".bsconfig"' in pack
        and "format_version" in pack and "Sha256::new()" in pack,
    "Size, path and symlink defenses":
        "MAX_UNCOMPRESSED:u64=96*1024*1024" in pack
        and "MAX_ZIP:u64=32*1024*1024" in pack
        and "safe_pack_path" in pack and "symlink_metadata" in pack,
    "Import checks ownership, engine and loader":
        "manifest.project_id!=project.id" in pack
        and "manifest.engine!=project.engine" in pack
        and "manifest.loader!=project.loader" in pack,
    "Player files never overwritten":
        "if target.exists(){preserved+=1;continue;}" in pack
        and "create_new(true)" in pack
        and "let _game_lock=crate::instance_lock::try_lock(&game)?" in native,
    "Server checks publishing credentials and ZIP hash":
        'request.method==="PUT"' in worker
        and 'const secret=env.VIS_PUBLISH_TOKEN' in worker
        and 'hash!==packageMatch[2]' in worker,
    "R2 catalogs include immutable bundle metadata":
        '"team-packages/"+project.id+".json"' in worker
        and 'bundle_url:packageInfo.url' in worker,
    "Native publication rechecks file and catalog digest":
        "pub fn upload_team_pack(" in cloud
        and 'format!("{:x}",digest.finalize())!=pack.sha256' in cloud
        and "cloud::publish(&root,&projects,&token)?" in native,
    "UI requires explicit review before upload":
        'data-team-action="preview"' in ui and "teamReview.signature!==signature" in ui
        and "window.confirm('¿Publicar '" in ui,
    "Imported pack requires explicit destination":
        'data-action="apply-team-project"' in ui
        and "allowServers,allowWaypoints" in ui,
    "All new commands are registered and typed":
        all(x in native for x in ("preview_team_project","publish_team_project","apply_team_project"))
        and all(x in types for x in ("preview_team_project:","publish_team_project:","apply_team_project:")),
}
for title,success in checks.items():print(("OK  " if success else "FAIL"),title)
if not all(checks.values()):
    raise SystemExit("VIS Team source invariants failed")
print(f"VIS Team static invariants: {sum(checks.values())}/{len(checks)}")
