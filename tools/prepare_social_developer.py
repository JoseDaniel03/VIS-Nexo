#!/usr/bin/env python3
"""Create SQL for explicit GitHub-protected developer grant or revocation.

The registered cloud account must be bound to the exact Argon2id-derived
Ed25519 PUBLIC verifier. No password, PIN, private key or Cloudflare token is
ever passed via workflow inputs.
"""
import base64
import hashlib
import os
import re
from pathlib import Path

name = os.getenv("VIS_DEV_USERNAME", "").strip().lower()
public_key = os.getenv("VIS_DEV_PUBLIC_KEY", "").strip()
action = os.getenv("VIS_DEV_ACTION", "")
if not re.fullmatch(r"[a-z0-9_]{3,24}", name):
    raise SystemExit("Invalid cloud username")
if action not in ("grant", "revoke"):
    raise SystemExit("Invalid grant operation")
try:
    decoded = base64.b64decode(public_key, validate=True)
except Exception:
    raise SystemExit("Invalid Ed25519 public verifier")
if len(decoded) != 32 or base64.b64encode(decoded).decode() != public_key:
    raise SystemExit("Expected 32-byte base64 public key")
print("Cloud account:", name, "| operation:", action)
print("Public verifier SHA256:", hashlib.sha256(decoded).hexdigest())
# Explicit matching prevents someone entering a common username alone.
account_query = (
    "SELECT id FROM social_users WHERE username='" + name + "' "
    "AND password_hash='ed25519:" + public_key + "' "
    "AND disabled_at IS NULL"
)
if action == "grant":
    sql = (
        "INSERT OR IGNORE INTO developer_grants(user_id) "
        + account_query + ";\n"
    )
else:
    sql = (
        "DELETE FROM developer_grants WHERE user_id IN (" + account_query + ");\n"
    )
verify = (
    "SELECT u.username,u.public_id, CASE WHEN g.user_id IS NULL THEN 0 ELSE 1 END AS developer "
    "FROM social_users u LEFT JOIN developer_grants g ON u.id=g.user_id "
    "WHERE u.username='" + name + "' "
    "AND u.password_hash='ed25519:" + public_key + "' "
    "AND u.disabled_at IS NULL;\n"
)
root = Path("services/social")
(root / ".vis-developer-mutate.sql").write_text(sql, encoding="utf-8")
(root / ".vis-developer-verify.sql").write_text(verify, encoding="utf-8")
