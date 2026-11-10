#!/usr/bin/env python3
"""Provision VIS STUDIOS as a LOCAL admin. Run on the owner's machine only.

This does not create a cloud administrator. Never bundle a shared master key in
clients or commit accounts.json to a public repository.
"""
import argparse
import getpass
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
from datetime import datetime, timezone


def candidates():
    found = []
    home = Path.home()
    if os.name == 'nt':
        appdata = Path(os.environ.get('APPDATA', home / 'AppData/Roaming'))
        # Tauri keeps the legacy identifier to preserve settings.
        found.extend([appdata / 'com.virgoland.vslauncher/local-accounts/accounts.json',
                      appdata / 'vslauncher/local-accounts/accounts.json'])
    else:
        xdg = Path(os.environ.get('XDG_DATA_HOME', home / '.local/share'))
        found.extend([xdg / 'vslauncher/accounts.json'])
    return [path for path in found if path.is_file()]


def provision(path, secret):
    from argon2 import PasswordHasher
    if len(secret) < 32:
        raise ValueError('La clave debe tener al menos 32 caracteres aleatorios.')
    if not path.is_file() or path.is_symlink():
        raise ValueError('Debe existir una base de cuentas local válida, no un enlace simbólico.')
    data = json.loads(path.read_text(encoding='utf-8'))
    accounts = data.get('accounts')
    if not isinstance(accounts, list):
        raise ValueError('accounts.json no contiene la lista de cuentas requerida.')
    if any(str(a.get('username', '')).lower() == 'vis_studios' for a in accounts):
        raise ValueError('Ya existe vis_studios. No se sobreescriben contraseñas ni roles.')
    from argon2.low_level import Type
    hasher = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1, hash_len=32, salt_len=16, type=Type.ID)
    accounts.append({'username': 'vis_studios', 'password_hash': hasher.hash(secret), 'role': 'admin',
                     'avatar': '', 'skin': '', 'cape': '', 'avatar_layer': '',
                     'profile_banner': '', 'microsoft_linked': False})
    backup = path.with_name('accounts.backup-' + datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S-%f') + '.json')
    shutil.copy2(path, backup)
    fd, temp = tempfile.mkstemp(prefix='.vis-ceibo-', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as output:
            json.dump(data, output, ensure_ascii=False, indent=2)
            output.flush()
            os.fsync(output.fileno())
        if os.name != 'nt':
            os.chmod(temp, 0o600)
            os.chmod(backup, 0o600)
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)
    print('Cuenta administrativa LOCAL creada: VIS STUDIOS (usuario: vis_studios).')
    print(f'Respaldo conservado: {backup}')
    print('La clave no se almacenó en texto plano. Reiniciá VIS Nexo para iniciar sesión.')


def main():
    parser = argparse.ArgumentParser(description='VIS Ceibo - alta local de VIS STUDIOS')
    parser.add_argument('--accounts-file', type=Path, help='Ruta absoluta a accounts.json de VIS, si hay más de una')
    args = parser.parse_args()
    paths = [args.accounts_file] if args.accounts_file else candidates()
    if len(paths) != 1:
        print('No se identificó una base de cuentas inequívoca. Cerrá VIS Nexo y usá --accounts-file /ruta/accounts.json.', file=sys.stderr)
        return 2
    print('IMPORTANTE: cerrá VIS Nexo antes de continuar. Esto crea una cuenta local, no un administrador cloud.')
    secret = getpass.getpass('Clave segura de VIS STUDIOS: ')
    confirm = getpass.getpass('Repetí la clave: ')
    if secret != confirm:
        print('Las claves no coinciden.', file=sys.stderr)
        return 2
    try:
        provision(paths[0], secret)
    except (ValueError, OSError, json.JSONDecodeError, ImportError) as ex:
        print(f'No se modificó la cuenta: {ex}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
