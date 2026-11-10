#!/usr/bin/env python3
"""Static acceptance of source-built Horizon integration (NOT Cargo compilation)."""
from pathlib import Path
import json
p=Path(__file__).resolve().parent.parent
main=(p/'src-tauri/src/main.rs').read_text()
horizon=(p/'src-tauri/src/horizon.rs').read_text()
ui=(p/'web/app.js').read_text()
package=json.loads((p/'package.json').read_text())
config=json.loads((p/'src-tauri/tauri.conf.json').read_text())
builder=(p/'tools/horizon_from_source.py').read_text()
checks={
  'Source build is automatic before Tauri app build': 'prepare_horizon.mjs build' in config['build']['beforeBuildCommand'],
  'Source build is automatic during developer launch': 'prepare_horizon.mjs build' in config['build']['beforeDevCommand'],
  'Compiles the client and preparer, never Horizon Launcher': all(s in builder for s in ["'horizon-client'", "'horizon-prepare'", "'cargo', 'build'", 'git', 'rev-parse']),
  'Includes source binaries and research lock as Tauri resources': 'resources/horizon/' in config['bundle']['resources'],
  'Does not bundle copyrighted Minecraft assets': 'minecraft_assets_included' in builder and 'False' in builder,
  'Source commit and SHA256 binaries recorded': all(s in builder for s in ['source_commit','sha256','digest(', 'research-lock.json']),
  'Legacy binary directories preserved': 'if ins.horizon_build_dir.is_empty() || ins.horizon_build_dir==SOURCE_BUILD_ID' in horizon and 'verify_managed_build(&folder)?;' in horizon,
  'Bundled binaries verified before invocation': 'verify_source_build(path)?;' in horizon and 'hash_file_sha256' in horizon,
  'No release download in automatic project installation': 'horizon::bundled_source_path()?;' in main and 'horizon_download::install(&cloned_app' not in main,
  'Horizon source ID allowed by backend validation': 'instance.horizon_build_dir!=horizon::SOURCE_BUILD_ID' in main,
  'VIS Studios game version validation preserved': 'ins.engine=project.engine.clone()' in main,
  'Fixes E0382 moved project id': 'ins.name=name;ins.project_id=project_id.clone();' in main,
  'Horizon source button wired in UI': "act==='use-horizon-source'" in ui and 'horizon_source_build' in main,
  'Versions synchronized': all(s=='2.18.0' for s in [package['version'],config['version'],__import__('re').search(r'version = "([^"]+)"',(p/'src-tauri/Cargo.toml').read_text()).group(1)]),
}
for name,ok in checks.items():print(('OK' if ok else 'FAIL'),name)
if not all(checks.values()):raise SystemExit('Source contracts 2.18 have failures')
print(f'VIS Horizon v2.18 static checks: {sum(checks.values())}/{len(checks)}')
