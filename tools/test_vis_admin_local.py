#!/usr/bin/env python3
"""Validate that local VIS Ceibo bootstrap stores only an Argon2id password hash."""
import json
from pathlib import Path
import tempfile
from argon2 import PasswordHasher
from vis_ceibo_admin_local import provision
with tempfile.TemporaryDirectory() as tmp:
    file=Path(tmp)/'accounts.json'
    file.write_text(json.dumps({'accounts':[{'username':'player','password_hash':'existing','role':'user'}],
                                'messages':[{'from':'player','to':'friend','body':'Hola','created':'2026'}],
                                'friendships':[]}),encoding='utf8')
    key='test-only-secret-do-not-share-with-anyone-123456789'
    provision(file,key)
    contents=file.read_text(encoding='utf8')
    db=json.loads(contents)
    assert key not in contents
    assert len(db['accounts'])==2
    assert db['accounts'][0]['username']=='player'
    assert db['messages'][0]['body']=='Hola'
    owner=db['accounts'][1]
    assert owner['username']=='vis_studios' and owner['role']=='admin'
    assert owner['password_hash'].startswith('$argon2id$')
    assert PasswordHasher().verify(owner['password_hash'],key)
    assert len(list(Path(tmp).glob('accounts.backup-*.json')))==1
    print('OK local admin bootstrap: Argon2id, backup, other users/messages preserved')
