#!/usr/bin/env python3
"""VIS Ceibo mutable public @handles with immutable account and E2EE identity.

Source-level checks only; Node D1 tests and platform Cargo checks are separate.
"""
from pathlib import Path
root=Path(__file__).resolve().parent.parent
read=lambda name:(root/name).read_text(encoding="utf8")
schema=read("services/social/migrations/0010_public_handles.sql")
worker=read("services/social/worker.mjs")
bridge=read("src-tauri/src/social.rs")
crypto=read("web/social-remote.js")
app=read("web/app.js")
premium=read("src-tauri/src/accounts.rs")
tests=read("tools/test_social_worker.mjs")
checks={
 "Stable immutable social account ID and public ID":
    "id TEXT PRIMARY KEY" in read("services/social/migrations/0001_social_core.sql")
    and "idx_social_users_public_id" in read("services/social/migrations/0004_cloud_credentials.sql")
    and "ALTER TABLE social_users ADD COLUMN public_handle" in schema,
 "Old names are reserved to prevent impersonation":
    "CREATE TABLE IF NOT EXISTS public_handle_history" in schema
    and "public_handle_history WHERE handle=?" in worker
    and "historicallyClaimed" in worker,
 "Server enforces unique and rate-limited aliases":
    "idx_social_users_public_handle" in schema
    and "HANDLE_COOLDOWN=7*24*60*60" in worker
    and "history.n>=5" in worker
    and "RESERVED_HANDLES" in worker,
 "Never mutate the login/E2EE username on an alias change":
    "UPDATE social_users SET public_handle=?,public_handle_updated_at=?" in worker
    and "UPDATE social_users SET username" not in worker
    and "const proof=\"VIS-CLOUD-AUTH-V2" in worker,
 "Friend relationships remain bound to IDs":
    "user_id FROM public_handle_history WHERE handle=?" in worker
    and "FROM friendships WHERE user_a=?" in worker
    and "public_handle:f.public_handle||f.username" in worker,
 "Cloud identity supports login via alias without changing signing identity":
    "(username=? OR public_id=? OR public_handle=?)" in worker
    and "row.username" in worker
    and "identifier:'cloudhero'" in tests,
 "Protected native bridge and frontend editor":
    '"/v1/account/handle"' in bridge
    and "social-save-public-handle" in app
    and "setPublicHandle" in crypto,
 "ECDH message identity still uses original username":
    "currentUser+':'+item.id" in crypto
    and "keys.pair.privateKey" in crypto
    and "username, incoming.client_message_id, aes" in crypto,
 "Premium local profile derived from official Minecraft UUID, not name":
    "ensure_microsoft_profile(&mut self, minecraft_uuid: &str)" in premium
    and 'format!("msa_{}"' in premium,
 "Tests include alias collisions, stable IDs and historical resolution":
    "aliceBefore.data.account.public_id" in tests
    and "old aliases resolve to the same stable account" in tests
    and "account/handle" in tests,
}
for title,okay in checks.items():
    print(("OK  " if okay else "FAIL"),title)
if not all(checks.values()):raise SystemExit("VIS Ceibo identity invariants incomplete")
print(f"VIS Ceibo identity contracts: {sum(checks.values())}/{len(checks)}")
