#!/usr/bin/env python3
"""Static acceptance: portable Horizon GAME from user's fork, not Horizon Launcher.

These are source invariants; Rust build and real install are separately tested
in GitHub Actions / two-computer smoke testing.
"""
from pathlib import Path
import json
import re

p = Path(__file__).resolve().parent.parent
main = (p / "src-tauri/src/main.rs").read_text()
horizon = (p / "src-tauri/src/horizon.rs").read_text()
download = (p / "src-tauri/src/horizon_download.rs").read_text()
ui = (p / "web/app.js").read_text()
checks_script = (p / "tools/horizon_from_source.py").read_text()
workflow = (p / ".github/workflows/vis-nexo-build.yml").read_text()
package = json.loads((p / "package.json").read_text())
config = json.loads((p / "src-tauri/tauri.conf.json").read_text())
build = config["build"]

checks = {
    "Tauri never compiles Horizon on launcher build":
        "prepare_horizon.mjs" not in str(build)
        and "horizon:source" not in workflow,
    "Game executable is NOT bundled into the AppImage or NSIS":
        "resources/horizon/" not in json.dumps(config.get("bundle", {})),
    "Launcher builds without Java25 or upstream Horizon compilation":
        "Build Minecraft Horizon GAME" not in workflow
        and "setup-java" not in workflow,
    "On-demand game download is part of instance installation":
        "horizon_download::install_fork(&cloned_app,&dir,&chosen.version)" in main,
    "Only the user's fork supplies the game":
        'https://api.github.com/repos/JoseDaniel03/horizon-VISNEXO/releases' in download,
    "No arbitrary game-binary download URLs":
        'https://github.com/{VIS_FORK}/releases/download/{tag}/{archive}' in download,
    "GitHub SHA-256 digest is mandatory":
        'strip_prefix("sha256:")' in download
        and 'download_stream(app,response,&archive_path,&sha,asset.size)' in download,
    "No duplicate game engine inside instance":
        "if source.starts_with(&local_root)" in horizon,
    "Source manifest bound to the fork and exact release tag":
        '"source_repo"' in download and 'source_commit' in download
        and "commit.starts_with(tag.strip_prefix" in download,
    "Extracted file hashes rechecked before execution":
        "fork_metadata(&built,&tag)?" in download
        and "save_game_stamp(&built,&tag)?" in download,
    "Minecraft assets and Java25 remain instance-owned":
        "minecraft::horizon_prerequisites" in main
        and "horizon::prepare" in main,
    "Preserve legacy imported instance binaries":
        "crate::horizon_download::verify_managed_build(&folder)?;" in horizon,
    "User interface offers automatic fork downloads":
        "Descargar Horizon al instalar" in ui
        and "use-horizon-source" in ui,
    "Optional source compilers remain separate from normal installer":
        all(term in checks_script for term in
            ["'horizon-client'", "'horizon-prepare'", "'cargo', 'build'", "git", "rev-parse"]),
    "Minecraft project version validation preserved":
        "ins.engine=project.engine.clone()" in main,
    "Tauri, Cargo and npm versions synchronized":
        len({
            package["version"], config["version"],
            re.search(r'version = "([^"]+)"', (p / "src-tauri/Cargo.toml").read_text()).group(1)
        }) == 1,
}
for name, passed in checks.items():
    print(("OK" if passed else "FAIL"), name)
if not all(checks.values()):
    raise SystemExit("VIS Horizon portable static contracts are incomplete")
print(f"VIS Horizon portable checks: {sum(checks.values())}/{len(checks)}")
