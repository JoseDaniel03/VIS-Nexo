#!/usr/bin/env python3
"""VIS Nexo Android static connection-preview security contracts.

This script checks intentionally narrow mobile behavior; it does NOT
replace a real Android emulator/device test or Cloudflare staging.
"""
from pathlib import Path
import json

ROOT=Path(__file__).resolve().parents[1]
def read(p): return (ROOT/p).read_text(encoding="utf-8")
native=read("mobile/src-tauri/src/lib.rs")
ui=read("mobile/web/app.js")
features=read("mobile/web/features.js")
html=read("mobile/web/index.html")
config=json.loads(read("mobile/src-tauri/tauri.conf.json"))
cargo=read("mobile/src-tauri/Cargo.toml")
checks={
  "Independent Rust crate does not pull desktop Minecraft/Horizon runtime":
    "[workspace]" in cargo
    and 'vsui-core' not in cargo
    and 'tauri-plugin-shell' not in cargo
    and 'minecraft' not in cargo.lower(),
  "Native-only credential exchange uses Argon2id/Ed25519 over HTTPS":
    'https://vis-social.defreitascarranza-845.workers.dev' in native
    and 'Argon2::default().hash_password_into' in native
    and 'VIS-CLOUD-AUTH-V2' in native
    and 'reqwest::redirect::Policy::none()' in native,
  "MFA requires second step before session is returned":
    'mobile_mfa' in native and 'mfa_ticket' in native
    and 'session.pending=Some' in native
    and 'session.bearer=Some' in native,
  "Tokens and MFA tickets never serialized to WebView":
    'struct AuthView' in native and 'bearer:' not in native.split('struct AuthView')[1].split('}')[0]
    and 'ticket:' not in native.split('struct AuthView')[1].split('}')[0]
    and '"token":token' not in native,
  "No arbitrary URL, path or elevated native command exposure":
    'match kind.as_str()' in native
    and 'mobile_read' in native
    and 'mobile_community' in native
    and 'mobile_logout' in native
    and 'mobile_launch_minecraft' not in native
    and 'std::process::Command' not in native,
  "WebView sends no direct requests and stores no secrets":
    'window.__TAURI__?.core?.invoke' in ui
    and 'fetch(' not in ui
    and 'localStorage' not in ui
    and 'sessionStorage' not in ui
    and 'indexedDB' not in ui,
  "Native-action bridge restricts paths and enforces upper bounds":
    'fn action_route(action:&str)' in native
    and '"POST","/v1/admin/accounts/role"' in native
    and '"GET","/v1/account/mfa/status"' in native
    and 'encoded.as_ref().is_some_and(|v|v.len()>max_bytes)' in native
    and 'nonce_guard(&guard,generation)' in native,
  "Portals, Universe and Ceibo mobile forms call only native Rust":
    "createMobileFeatures" in features
    and "mobile_action" in features
    and "mobile_password_change" in features
    and 'fetch(' not in features
    and 'localStorage.' not in features
    and 'sessionStorage.' not in features
    and 'indexedDB.open(' not in features,
  "Android instances are sandboxed metadata, never runnable game engines":
    'fn instance_root(' in native and 'app.path().app_data_dir()' in native
    and 'fn persist_instances(' in native
    and 'mobile_instance_create' in native
    and 'mobile_instance_remove' in native
    and 'No se pudieron preparar las carpetas Android' in native
    and 'launch_minecraft' not in native
    and 'launch_horizon' not in native,
  "Java remains unavailable; McRust installs from the shared engine catalog":
    'Minecraft Rust / Java' in ui
    and 'mobile_mcrust_launch' in features
    and 'mcrust::mobile_mcrust_launch' in native,
  "Android package has a distinct ID and content security policy":
    config["identifier"]=="com.visstudios.nexo.mobile"
    and config["app"]["withGlobalTauri"] is True
    and "connect-src ipc: http://ipc.localhost" in config["app"]["security"]["csp"]
    and "https://*" not in config["app"]["security"]["csp"],
  "Android frontend has device viewport and no external CDN scripts":
    'viewport-fit=cover' in html and 'type="module" src="./app.js"' in html
    and 'https://' not in html,
  "Mobile scripts are ES modules with isolated features":
    "from './features.js'" in ui,
}
for title,ok in checks.items():
    print(("OK  " if ok else "FAIL"),title)
if not all(checks.values()): raise SystemExit("Android companion security contracts failed")
print(f"VIS Android preview static checks: {sum(checks.values())}/{len(checks)}")
