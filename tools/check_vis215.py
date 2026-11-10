#!/usr/bin/env python3
"""Legacy Horizon signed-game import safety plus source-build migration."""
from pathlib import Path
p=Path(__file__).resolve().parent.parent
r=(p/'src-tauri/src/horizon_download.rs').read_text()
main=(p/'src-tauri/src/main.rs').read_text()
ui=(p/'web/app.js').read_text()
checks={
 'Pinned upstream Ed25519 key': 'MU4oiIQcCxkZvbwSjjXs7SySCuM6ywRQ3nGaJYZG0gw=' in r and 'verifying_key.verify(&msg,&sig)' in r,
 'Version bound to release title, not mutable nightly': 'fn signed_version(' in r and 'split_once(" · ")' in r and 'signature_is_valid(&version,' in r,
 'Current nightly and dated tags accepted': 'release.tag_name!="nightly"' in r and 'format!("nightly-{date}")' in r,
 'Signed manifest gates download': r.index('signature_is_valid(&version,') < r.index('stream_archive(app,'),
 'Streaming archive hash verified': 'let mut buffer=[0u8;64*1024]' in r and 'format!("{:x}",hasher.finalize())!=expected' in r,
 'Zip and TAR traversal and symlinks defended': 'fn safe_rel(' in r and 'if !kind.is_file()&&!kind.is_dir()' in r and '0o120000' in r,
 'No Horizon launcher binary selected': 'horizon-linux-x86_64.tar.gz' in r and 'horizon-windows-x64.zip' in r and 'horizon-client' in r,
 'Dedicated stable build folder and rollback': 'data_root.join("horizon-builds")' in r and '.vis-release-sha256' in r and 'fs::rename(&unpacked,&destination)' in r,
 'Bounded memory and extraction': 'const MAX_UNPACKED:' in r and 'const MAX_ARCHIVE:' in r and 'MAX_ITEMS' in r,
 'Legacy integrity verification available, Nightly downloader not exposed': 'mod horizon_download;' in main and 'horizon_latest_release, horizon_install_release' not in main,
 'VIS now selects source-compiled Horizon instead of Nightly downloads': "act==='install-horizon-game'" not in ui and "act==='use-horizon-source'" in ui,
 'New styles loaded': 'vis-nexo-v2.15.css' in (p/'web/index.html').read_text(),
 'No legacy data migration': 'com.virgoland.vslauncher' in (p/'src-tauri/tauri.conf.json').read_text(),
}
for name,passed in checks.items(): print(('OK' if passed else 'FAIL'),name)
if not all(checks.values()): raise SystemExit('VIS 2.15 source invariants failed')
