#!/usr/bin/env python3
"""Generate one-time VIS Social super-admin bootstrap SQL.
Run only in the GitHub production environment. Public key is NOT a secret.
Requires an existing VIS online account with an Argon2id-derived Ed25519 public credential.
No account is auto-created and no plaintext password or signing seed is used.
"""
import base64
import hashlib
import os
import re
from pathlib import Path

name = os.environ.get("VIS_SUPERADMIN_USERNAME", "").strip().lower()
public_key = os.environ.get("VIS_SUPERADMIN_PUBLIC_KEY", "").strip()
if not re.fullmatch(r"[a-z0-9_]{3,24}", name):
    raise SystemExit("Invalid VIS Social admin username")
if not re.fullmatch(r"[A-Za-z0-9+/]{43}=", public_key):
    raise SystemExit("Ed25519 public key must be standard base64 (32 bytes)")
try:
    decoded = base64.b64decode(public_key, validate=True)
except (ValueError, base64.binascii.Error):
    raise SystemExit("Invalid public key")
if len(decoded) != 32:
    raise SystemExit("Invalid Ed25519 key length")
fp = hashlib.sha256(decoded).hexdigest()
print("Requested super-admin user:", name)
print("Device Ed25519 public-key SHA-256:", fp)
print("No device private key, local PIN or Cloudflare token is needed here.")

# VIS Cloud accounts use password_hash='ed25519:<PUBLIC verifier>' and
# deliberately have signing_public_key=''. Matching signing_public_key instead
# would silently prevent promotion of every native VIS Cloud account.
# Require the verifier AND an enabled normal user; never transfer existing admins.
grant = """UPDATE social_users SET role='super_admin',updated_at=unixepoch()
WHERE username='{name}' AND password_hash='ed25519:{pub}' AND role='user'
  AND disabled_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM social_users WHERE role='super_admin');
""".format(name=name, pub=public_key)
verify = """SELECT username,role,
SUBSTR(password_hash,9) AS cloud_credential_public_key
FROM social_users WHERE username='{name}'
AND password_hash='ed25519:{pub}' AND role='super_admin'
AND disabled_at IS NULL;
""".format(name=name, pub=public_key)
directory = Path("services/social")
(directory / ".vis-superadmin-grant.sql").write_text(grant, encoding="utf-8")
(directory / ".vis-superadmin-verify.sql").write_text(verify, encoding="utf-8")
