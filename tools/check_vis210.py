#!/usr/bin/env python3
"""Source invariants for VIS 2.10, not a Rust compiler."""
from pathlib import Path
r=Path(__file__).resolve().parent.parent
mc=(r/'src-tauri/src/minecraft.rs').read_text()
main=(r/'src-tauri/src/main.rs').read_text()
ui=(r/'web/app.js').read_text()
checks={
    'Streaming cached checksums': 'fn sha1_reader(mut reader:impl Read)' in mc and 'let bytes=fs::read(target)' not in mc,
    'Bounded Rayon transfers': 'download_parallelism(total,cpus)' in mc and '.num_threads(8)' not in mc,
    'Mojang/Fabric TTL catalog': 'static VERSION_CACHE:' in mc and 'static FABRIC_CACHE:' in mc,
    'Kahn dependency ordering': 'fn mod_install_order(versions:&[Value])' in mc and 'if sorted.len()!=versions.len()' in mc,
    'Modrinth resolve before download': mc.index('let order=mod_install_order(&resolved)?;') < mc.index('obtain_file(&c,url,&stage.join(name)'),
    'Minecraft launching outside backend lock': 'async fn launch_minecraft(' in main and 'move||minecraft::launch(&launch_app' in main,
    'Maintenance work off UI thread': 'move||maintenance::report(&root,false)' in main,
    'Historical version selector': 'minecraftVersionChannel' in ui and 'versionSuggestions(' in ui,
    'Duplicate instance never copies data': "copy.game_dir='';" in ui and 'copy.installed=false' in ui,
    'Chat window bounded': 'const visible=msgs.slice(-chatWindowSize)' in ui,
}
for k,ok in checks.items():print(('OK' if ok else 'FAIL'), k)
if not all(checks.values()):raise SystemExit('VIS 2.10 source guards failed')
