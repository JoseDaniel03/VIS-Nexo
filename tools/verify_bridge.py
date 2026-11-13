#!/usr/bin/env python3
'''Confirm Rust commands and JS callers remain connected; check release metadata.

A source consistency test, not a replacement for cargo check or TS-checking app.js.
'''
import json, re, tomllib
from pathlib import Path
p=Path(__file__).resolve().parent.parent
rust=(p/'src-tauri/src/main.rs').read_text()
ui=(p/'web/app.js').read_text()
commands=set(re.findall(r'#\[tauri::command\]\s*(?:async\s+)?fn\s+(\w+)',rust))
# Commands may live in explicit native feature modules; Tauri registers them
# as module::command, while the WebView calls their exported short names.
native_modules={}
if 'mod social;' in rust:
    native_modules['social']=(p/'src-tauri/src/social.rs').read_text()
if 'mod microsoft;' in rust:
    native_modules['microsoft']=(p/'src-tauri/src/microsoft.rs').read_text()
for module, source in native_modules.items():
    commands.update(re.findall(r'#\[tauri::command\]\s*pub\(crate\)\s+(?:async\s+)?fn\s+(\w+)',source))
assert commands, 'Rust Tauri command list missing'
bridge=re.search(r'tauri::generate_handler!\[(.*?)\]',rust,re.S)
assert bridge, 'Tauri generate_handler missing'
registered={x.strip() for x in bridge.group(1).split(',') if x.strip()}
registered_names={name.rsplit('::',1)[-1] for name in registered}
assert registered_names==commands, f'Unregistered/unknown Rust commands: {registered_names ^ commands}'
extra_ui=(p/'web/social-remote.js').read_text() if (p/'web/social-remote.js').exists() else ''
extra_ui+='\n'+(p/'web/worlds-portals.js').read_text()
used=set(re.findall(r'''(?:command|apply)\(\s*["']([\w-]+)["']''',ui+'\n'+extra_ui))
assert used<=registered_names, f'JS invokes without Rust implementation: {used-registered_names}'
package=json.loads((p/'package.json').read_text())
cargo=tomllib.loads((p/'src-tauri/Cargo.toml').read_text())
conf=json.loads((p/'src-tauri/tauri.conf.json').read_text())
workspace=tomllib.loads((p/'Cargo.toml').read_text())
versions={package['version'],cargo['package']['version'],conf['version'],workspace['workspace']['package']['version']}
assert len(versions)==1, f'Inconsistent version numbers: {versions}'
assert conf['identifier']=='com.virgoland.vslauncher', 'Changed app identifier: old user data may be lost'
assert conf['app']['withGlobalTauri'], 'Frontend depends on window.__TAURI__'
assert not conf['app']['security'].get('dangerousDisableAssetCspModification',False)
print(f'OK bridge: {len(registered_names)} registered Rust commands, {len(used)} JS command references')
print(f'OK metadata: version {versions.pop()} consistent; application identifier preserved')

