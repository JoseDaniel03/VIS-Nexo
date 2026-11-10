#!/usr/bin/env python3
"""Check the specific Rust source regressions that broke v2.4 builds.

This is a source-level safety check, NOT a substitute for `cargo check`.
"""
from pathlib import Path

root = Path(__file__).resolve().parent.parent
main = (root / "src-tauri/src/main.rs").read_text()
mc = (root / "src-tauri/src/minecraft.rs").read_text()
checks = {
    "MutexGuard holds a named lifetime": "fn locked<'a>(state: &'a State<'_, Mutex<Backend>>) -> Result<std::sync::MutexGuard<'a, Backend>, String>" in main,
    "game argument loop returns unit": "for arg in game_args { cmd.arg(arg); }" in mc,
    "Modrinth slug accepts byte literals": "b==b'-'" in mc and "b==b'_'" in mc,
    "No borrowed MutexGuard with ambiguous lifetime": "fn locked(state: &State<'_, Mutex<Backend>>)" not in main,
    "No char comparisons on bytes": "b=='-'" not in mc and "b=='_'" not in mc,
}
for label, ok in checks.items():
    print(f"{'OK' if ok else 'ERROR'} {label}")
if not all(checks.values()):
    raise SystemExit(1)
