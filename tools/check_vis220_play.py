#!/usr/bin/env python3
"""VIS Nexo v2.20: one-click engine selection and no visible Horizon boot.

These are source-contract tests, not a substitute for starting the game on an
actual Windows or Linux GPU. Upstream source patch is separately unit tested.
"""
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
ui=(ROOT/"web/app.js").read_text(encoding="utf-8")
game=(ROOT/"src-tauri/src/horizon.rs").read_text(encoding="utf-8")
source=(ROOT/"tools/horizon_from_source.py").read_text(encoding="utf-8")
manifest=(ROOT/"tools/package_vis_rust_engine.py").read_text(encoding="utf-8")

checks={
    "Java/Rust options live in VIS Nexo": 'new-java-instance' in ui and 'new-rust-instance' in ui,
    "Play can install a missing version automatically":
        "if(!instance.installed){" in ui and
        "if(!await performInstall(projectId,name))return;" in ui,
    "A failed installation must never launch":
        "if(!installed)return" not in ui or
        "if(!await performInstall(projectId,name))return;" in ui,
    "Only one launcher is used":
        "command('launch_horizon'" in ui and "horizon-client" in game and
        "horizon-launcher" not in game,
    "Both Rust launch paths opt into invisible boot":
        game.count('cmd.env("VIS_NEXO_DIRECT_START", "1");')==2,
    "The official source patch keeps game startup work":
        'window.set_visible(true)' in source and
        'Step::Ready(game)' in source and
        'App::Ready(game)' in source,
    "Horizon brand only hidden for VIS direct starts":
        'VIS_NEXO_DIRECT_START' in source and
        '"Minecraft Rust Edition"' in source and '"Horizon"' in source,
    "Unpatched engine cannot be published":
        'vis-nexo-direct-game-window-v1' in manifest,
}
for name,valid in checks.items():
    print(("OK " if valid else "FAIL ")+name)
if not all(checks.values()):
    raise SystemExit("El inicio directo de VIS Nexo tiene regresiones")
print(f"Direct Play tests: {sum(checks.values())}/{len(checks)}")
