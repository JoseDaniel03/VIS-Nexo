#!/usr/bin/env python3
"""Source-level performance and safety regressions for VIS Portals/Nexo.

This is NOT a network benchmark or a substitute for cargo check / Node tests.
"""
from pathlib import Path

root=Path(__file__).resolve().parent.parent
def src(path):return (root/path).read_text(encoding="utf-8")

ui=src("web/app.js")
social=src("web/social-remote.js")
host=src("src-tauri/src/social.rs")
worker=src("services/social/worker.mjs")
tests=src("tools/test_social_peer_key.mjs")
checks={
  "One pooled Rust HTTPS client, not per-message TLS setup":
    "static SOCIAL_HTTP: OnceLock<Client>" in host
    and ".pool_idle_timeout(Duration::from_secs(90))" in host
    and ".redirect(reqwest::redirect::Policy::none())" in host,
  "Auth strength remains Argon2id and native bearer isolation":
    "Argon2::default().hash_password_into" in host
    and "active.bearer.clone()" in host
    and '"/v1/state"' in host,
  "Adaptive foreground polling, bounded failure backoff":
    "export function socialPollDelay(chatOpen,failures=0)" in social
    and "base=chatOpen?2200:8500" in social
    and "Math.min(45000,base*2**attempts)" in social,
  "No polling while hidden or after invalid session":
    "document.hidden" in social and "/HTTP 401" in social
    and "window.addEventListener('online', onOnline)" in social,
  "Async sync is isolated from account switches":
    "sessionEpoch" in social and "if(!valid())return" in social
    and "Cambió la cuenta activa; mensaje no enviado" in social,
  "Encrypted messages shown before delivery acknowledgement":
    "notify();\n      if (ack.length)" in social,
  "Identity pinning and bounded AES derived-key caches remain":
    "validatePinnedPeerKey(saved,friend.public_key)" in social
    and "const pinnedPeers=new Map(), derivedKeys=new Map()" in social
    and "pinnedPeers.clear();derivedKeys.clear()" in social,
  "IndexedDB reads only active account":
    "IDBKeyRange.bound(prefix, prefix + " in social
    and "allMessages(privateDb, currentUser)" in social,
  "Expired local chat records removed in one transaction":
    "await removeMessages(privateDb, expired)" in social
    and "const tx = db.transaction('messages','readwrite')" in social,
  "No full local history scan during each empty poll":
    "if(newMessages)await refreshLocalMessages()" in social
    and "if(request===historyRequest)messages=fresh" in social,
  "Login paints first, then loads media":
    ui.count("page='home';render();void refreshAssets().catch(()=>{});")==2
    and "await refreshAssets();render();" not in ui,
  "UI previews bounded by count and encoded bytes":
    "PREVIEW_CACHE_ENTRIES=64,PREVIEW_CACHE_BYTES=32*1024*1024" in ui
    and "if(source.length>PREVIEW_CACHE_BYTES)" in ui
    and "previewCacheOrder.length=0;previewCacheBytes=0" in ui,
  "Social media concurrency and per-account guards":
    "socialMediaActive<3" in ui
    and "socialMediaQueue.length=0" in ui
    and "generation!==accountGeneration||db.user?.username!==owner" in ui,
  "Server D1 reads parallelized without skipping authentication":
    "incomingRequest,outgoingRequest,queueRequest" in worker
    and "const user = await getSession(request, db);" in worker
    and "developerRequest.then(allowed=>getProjects(db,user,allowed))" in worker,
  "Pure backoff tests included in release suite":
    "socialPollDelay(true,0)" in tests and "socialPollDelay(false,9)" in tests,
}
for title,passed in checks.items():
    print(("OK  " if passed else "FAIL"),title)
if not all(checks.values()):
    raise SystemExit("VIS network performance contract not fully satisfied")
print(f"VIS Network Performance static checks: {sum(checks.values())}/{len(checks)}")
