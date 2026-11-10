#!/usr/bin/env python3
"""Source-level checks of VIS 2.17 project/game integration. Not native tests."""
from pathlib import Path
import json
root = Path(__file__).resolve().parent.parent
main = (root/'src-tauri/src/main.rs').read_text()
world = (root/'src-tauri/src/minecraft.rs').read_text()
horizon = (root/'src-tauri/src/horizon.rs').read_text()
ui = (root/'web/app.js').read_text()
model = (root/'legacy/crates/vsui-core/src/lib.rs').read_text()
checks = {
  'Project stores Minecraft engine and loader': all(x in model for x in ['pub engine: String','pub loader: String','pub loader_version: String']),
  'Backend validates game engine and loader for projects': all(x in main for x in ['if project.engine=="horizon"','"fabric"','project.installable && project.mc_version.trim().is_empty()']),
  'Project install command takes only folder and RAM from client': 'fn ensure_project_instance(state:State' in main and 'project_id:String,game_dir:String,ram_mb:u32' in main,
  'Project installation derives version, loader and engine from server-side catalog': all(x in main for x in ['ins.engine=project.engine.clone()','ins.version=project.mc_version.clone()','ins.loader=project.loader.clone()']),
  'Regular users cannot mutate published game specifications': 'Ordinary players can only register a published project through' in main,
  'Changing project version does not silently overwrite old installations': 'build_key=format!' in main and 'No podés cambiar el motor' in main,
  'VIS profile installation sharing only includes installed runtimes': 'fn machine_instances(' in main and 'if minecraft::installed(&dir,&instance)' in main,
  'Local accounts do not share credential stores': 'We never copy account credentials' in main,
  'Shared Java worlds and options are isolated': 'pub fn launch_shared(' in world and '.vis/players' in world,
  'Horizon uses visitor-specific world directory and session': 'pub fn launch_shared(' in horizon and 'launch_in_directory' in horizon and 'source_owner:Option<String>' in main,
  'Horizon game binary is provisioned by VIS': 'horizon::bundled_source_path()?' in main and 'horizon::prepare(&cloned_app' in main,
  'Minecraft server/client and JDK are provisioned by VIS for Horizon': 'pub fn horizon_prerequisites(' in world and 'Temurin JDK' in world,
  'UI only exposes RAM and folder in project install form': 'id="vis-project-install-form"' in ui and 'name="ram_mb"' in ui and 'vis-project-install-folder' in ui,
  'UI chains installation and actual launch commands': all(x in ui for x in ['ensure_project_instance','install_minecraft','launch_minecraft','launch_horizon']),
  'Tauri bridge passes separate source owner for shared games': 'sourceOwner:' in ui,
  'New VIS stylesheet is loaded': 'vis-nexo-v2.17.css' in (root/'web/index.html').read_text(),
  'Version 2.17 is synchronized': len(set([json.loads((root/'package.json').read_text())['version'], json.loads((root/'src-tauri/tauri.conf.json').read_text())['version']]))==1,
}
for label, ok in checks.items(): print(('OK' if ok else 'FAIL'),label)
if not all(checks.values()): raise SystemExit('VIS 2.17 source checks failed')
print(f'Checks VIS 2.17: {sum(checks.values())}/{len(checks)}')
