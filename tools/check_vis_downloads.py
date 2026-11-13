#!/usr/bin/env python3
"""VIS Download Manager source contracts; not a substitute for cargo test.

Run as part of npm run check:release before producing native binaries.
"""
from pathlib import Path

root = Path(__file__).resolve().parent.parent
def src(path):
    return (root / path).read_text(encoding="utf-8")

manager = src("src-tauri/src/download_manager.rs")
main = src("src-tauri/src/main.rs")
mc = src("src-tauri/src/minecraft.rs")
horizon = src("src-tauri/src/horizon_download.rs")
ui = src("web/app.js")
types = src("types/vis-commands.ts")
css = src("web/vis-nexo-v2.21.css")

checks = {
    "One controlled installation at a time": "if state.active.is_some()" in manager
        and "Ya hay una instalación en curso" in manager,
    "Only account owner can see/cancel": "job.owner==owner" in manager
        and "s.username()?" in main and "fn cancel_download(" in main,
    "No downloader credentials persisted": "fn registry()->" in manager
        and "std::fs" not in manager and "pub struct DownloadJob" in manager,
    "In-memory bounded recent jobs": "HISTORY_LIMIT:usize=8" in manager
        and "state.history.truncate(HISTORY_LIMIT)" in manager,
    "Cancellation is a cooperative flag": "pub fn checkpoint()->Result<(),String>" in manager
        and "job.cancel_requested=true;" in manager,
    "Cancellation never reports a successful install as cancelled": 
        'if failed&&cancelled{"cancelled"}' in manager,
    "Rust commands registered": "download_jobs, cancel_download" in main
        and "mod download_manager;" in main,
    "Java and Horizon share lifecycle": "download_manager::begin(&cloned_app,&user" in main
        and "job.finish(&result);" in main and "download_manager::checkpoint()?;" in main,
    "Java resource pool checks cancellation": "tasks.par_iter().try_for_each" in mc
        and "crate::download_manager::checkpoint()?;" in mc,
    "Java runtime transfer checks cancellation": "let n=response.read(&mut buf)" in mc
        and "loop {crate::download_manager::checkpoint()?;" in mc,
    "Horizon transfer checks cancellation": "let n=reader.read(&mut buffer)" in horizon
        and "crate::download_manager::checkpoint()?;" in horizon,
    "Existing verification remains in place": "SHA-1 esperado inválido" in mc
        and "SHA-256 del juego no coincide" in horizon,
    "Native state events and frontend cancel action": "vis-download-state" in manager
        and "T.event.listen('vis-download-state'" in ui
        and "command('cancel_download',{id:job.id})" in ui,
    "History and current user filtering": "downloadsHistorySection()" in ui
        and "job.owner!==db.user.username" in ui
        and "j.owner===db.user?.username" in ui
        and "command('download_jobs')" in ui,
    "Portable responsive download dock": ".vis-download-dock [data-action=" in css,
    "Both standalone examples use the new module":
        all("mod download_manager;" in src(path) for path in (
            "src-tauri/examples/minecraft_smoke.rs",
            "src-tauri/examples/horizon_smoke.rs")),
    "Typed API interface": "export type DownloadJob" in types
        and "download_jobs:" in types and "cancel_download:" in types,
}
for label, success in checks.items():
    print(("OK  " if success else "FAIL"), label)
if not all(checks.values()):
    raise SystemExit("VIS Download Manager contracts require repair before building")
print(f"VIS Download Manager: {sum(checks.values())}/{len(checks)} static contracts")
