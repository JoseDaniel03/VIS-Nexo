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
  "No game start UI while Android port does not exist":
    'Minecraft Rust / Java' in ui
    and 'deshabilitadas en esta preview' in ui,
  "Android package has a distinct ID and content security policy":
    config["identifier"]=="com.visstudios.nexo.mobile"
    and config["app"]["withGlobalTauri"] is True
    and "connect-src ipc: http://ipc.localhost" in config["app"]["security"]["csp"]
    and "https://*" not in config["app"]["security"]["csp"],
  "Android frontend has device viewport and no external CDN scripts":
    'viewport-fit=cover' in html and '<script src="./app.js"' in html
    and 'https://' not in html,
}
for title,ok in checks.items():
    print(("OK  " if ok else "FAIL"),title)
if not all(checks.values()): raise SystemExit("Android companion security contracts failed")
print(f"VIS Android preview static checks: {sum(checks.values())}/{len(checks)}")
