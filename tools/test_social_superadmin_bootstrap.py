#!/usr/bin/env python3
"""Offline regression for privileged, one-time VIS Cloud admin provisioning."""
import base64
import os
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

script=Path(__file__).with_name("prepare_social_superadmin.py").resolve()
public=base64.b64encode(bytes(range(32))).decode()
different=base64.b64encode(bytes(range(1,33))).decode()

def prepare(username="visstudios",key=public):
    with tempfile.TemporaryDirectory() as dirname:
        root=Path(dirname)
        (root/"services/social").mkdir(parents=True)
        result=subprocess.run([sys.executable,str(script)],cwd=root,env={
            **os.environ,"VIS_SUPERADMIN_USERNAME":username,"VIS_SUPERADMIN_PUBLIC_KEY":key
        },capture_output=True,text=True)
        if result.returncode:
            return result,None,None
        return result,(root/"services/social/.vis-superadmin-grant.sql").read_text(),(
            root/"services/social/.vis-superadmin-verify.sql").read_text()

def database():
    db=sqlite3.connect(":memory:")
    db.execute("""CREATE TABLE social_users(
        username TEXT PRIMARY KEY,password_hash TEXT,
        signing_public_key TEXT DEFAULT '',role TEXT NOT NULL,
        disabled_at INTEGER,updated_at INTEGER DEFAULT 0)""")
    return db

result,grant,verify=prepare()
assert result.returncode==0 and grant and verify
db=database()
db.execute("INSERT INTO social_users(username,password_hash,role) VALUES(?,?,?)",(
    "visstudios","ed25519:"+public,"user"))
db.executescript(grant)
assert db.execute("SELECT role FROM social_users WHERE username='visstudios'").fetchone()==("super_admin",)
assert db.execute(verify).fetchall()==[("visstudios","super_admin",public)]
db.executescript(grant)
assert db.execute("SELECT count(*) FROM social_users WHERE role='super_admin'").fetchone()[0]==1
db.close()

for bad_key,bad_role,disabled in [(different,"user",None),(public,"moderator",None),(public,"user",42)]:
    db=database()
    db.execute("INSERT INTO social_users(username,password_hash,role,disabled_at) VALUES(?,?,?,?)",(
        "visstudios","ed25519:"+bad_key,bad_role,disabled))
    db.executescript(grant)
    assert db.execute("SELECT role FROM social_users").fetchone()[0]==bad_role
    assert db.execute(verify).fetchall()==[]
    db.close()

db=database()
db.execute("INSERT INTO social_users(username,password_hash,role) VALUES(?,?,?)",(
    "existing","ed25519:"+different,"super_admin"))
db.execute("INSERT INTO social_users(username,password_hash,role) VALUES(?,?,?)",(
    "visstudios","ed25519:"+public,"user"))
db.executescript(grant)
assert db.execute("SELECT role FROM social_users WHERE username='visstudios'").fetchone()[0]=="user"
db.close()

for name,key in [("VIS STUDIOS",public),("visstudios","' OR 1=1 --"),("..",public)]:
    attempt,_,_=prepare(name,key)
    assert attempt.returncode!=0

print("VIS superadmin bootstrap: only existing active cloud verifier can be promoted, one time")
