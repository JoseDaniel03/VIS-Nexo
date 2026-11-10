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
assert commands, 'Rust Tauri command list missing'
bridge=re.search(r'tauri::generate_handler!\[(.*?)\]',rust,re.S)
assert bridge, 'Tauri generate_handler missing'
registered={x.strip() for x in bridge.group(1).split(',') if x.strip()}
assert registered==commands, f'Unregistered/unknown Rust commands: {registered ^ commands}'
used=set(re.findall(r'''(?:command|apply)\(\s*["']([\w-]+)["']''',ui))
assert used<=registered, f'JS invokes without Rust implementation: {used-registered}'
package=json.loads((p/'package.json').read_text())
cargo=tomllib.loads((p/'src-tauri/Cargo.toml').read_text())
conf=json.loads((p/'src-tauri/tauri.conf.json').read_text())
workspace=tomllib.loads((p/'Cargo.toml').read_text())
versions={package['version'],cargo['package']['version'],conf['version'],workspace['workspace']['package']['version']}
assert len(versions)==1, f'Inconsistent version numbers: {versions}'
assert conf['identifier']=='com.virgoland.vslauncher', 'Changed app identifier: old user data may be lost'
assert conf['app']['withGlobalTauri'], 'Frontend depends on window.__TAURI__'
assert not conf['app']['security'].get('dangerousDisableAssetCspModification',False)
print(f'OK bridge: {len(registered)} registered Rust commands, {len(used)} JS command references')
print(f'OK metadata: version {versions.pop()} consistent; application identifier preserved')
