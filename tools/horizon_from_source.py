#!/usr/bin/env python3
"""Compile the official Horizon GAME from its Rust repository, not its launcher.

The Horizon workspace is intentionally separate from Tauri's Cargo workspace.
The built game binaries and research lock are packaged as read-only Tauri resources.
Do not publish/commit proprietary Minecraft JARs, worlds or prepared resources.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile

REPOSITORY = 'https://github.com/horizon-rust/horizon.git'
ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / 'src-tauri' / 'resources' / 'horizon'
CACHE = ROOT / '.vis-build-cache' / 'horizon'
BINARIES = ('horizon-client', 'horizon-prepare')
EXPORTER_SOURCES = Path('mods/horizon/src/test/java/dev/horizonlab/parity')


def command(args: list[str], cwd: Path | None = None, env: dict[str, str] | None = None) -> str:
    shown = ' '.join(map(str, args))
    print('[VIS Horizon Source]', shown, flush=True)
    proc = subprocess.run(args, cwd=cwd, env=env, text=True, check=True,
                          stdout=subprocess.PIPE if args[:2] == ['git', 'rev-parse'] else None)
    return proc.stdout.strip() if proc.stdout else ''


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(64 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def binary_name(stem: str) -> str:
    return stem + ('.exe' if os.name == 'nt' else '')


def source_checkout(override: str | None, ref: str | None, update: bool) -> Path:
    if override:
        path = Path(override).expanduser().resolve(strict=True)
        if not (path / '.git').exists() or not (path / 'Cargo.toml').is_file():
            raise RuntimeError('La carpeta externa debe ser un checkout Git del código de Horizon')
        if ref:
            actual = command(['git', 'rev-parse', 'HEAD'], cwd=path)
            if actual != ref:
                raise RuntimeError(f'Checkout local {actual} no coincide con VIS_HORIZON_REF={ref}')
        return path
    path = CACHE / 'source'
    if not path.is_dir():
        path.parent.mkdir(parents=True, exist_ok=True)
        command(['git', 'clone', '--depth', '1', '--branch', 'main', REPOSITORY, str(path)])
        if ref:
            # First CI checkout must honor the pinned release SHA too.
            command(['git', 'fetch', '--depth', '1', 'origin', ref], cwd=path)
            command(['git', 'checkout', '--detach', 'FETCH_HEAD'], cwd=path)
    elif update or ref:
        # Only update on explicit request: prevent moving source during every build.
        command(['git', 'fetch', '--depth', '1', 'origin', ref or 'main'], cwd=path)
        command(['git', 'checkout', '--detach', 'FETCH_HEAD'], cwd=path)
    return path


def is_valid(output: Path, commit: str) -> bool:
    manifest = output / 'vis-horizon-source.json'
    try:
        record = json.loads(manifest.read_text(encoding='utf-8'))
        return (record.get('source_commit') == commit
                and record.get('platform') == platform.system().lower()
                and record.get('arch') == platform.machine().lower()
                and all(digest(output / name) == expected
                        for name, expected in record['sha256'].items())
                and all((output / binary_name(n)).is_file() for n in BINARIES)
                and (output / 'research-lock.json').is_file()
                and (output / EXPORTER_SOURCES / 'VanillaHeightmapOracle.java').is_file()
                and (EXPORTER_SOURCES / 'VanillaHeightmapOracle.java').as_posix() in record['sha256'])
    except (OSError, KeyError, TypeError, ValueError):
        return False


def build(override: str | None, ref: str | None, update: bool, *, project_root: Path = ROOT) -> None:
    if not shutil.which('cargo') or not shutil.which('git'):
        raise RuntimeError('Necesitás Git y Rust/Cargo para compilar VIS con Horizon desde el repositorio')
    checkout = source_checkout(override, ref, update)
    sha = command(['git', 'rev-parse', 'HEAD'], cwd=checkout)
    if len(sha) != 40 or any(c not in '0123456789abcdef' for c in sha):
        raise RuntimeError(f'Commit de Horizon inválido: {sha}')
    output = project_root / 'src-tauri' / 'resources' / 'horizon'
    if not update and is_valid(output, sha):
        print(f'[VIS Horizon Source] Build cacheado y verificado: {sha[:12]}')
        return
    env = dict(os.environ)
    target_dir = CACHE / 'target'
    target_dir.mkdir(parents=True, exist_ok=True)
    env['CARGO_TARGET_DIR'] = str(target_dir.resolve())
    env.setdefault('CARGO_BUILD_JOBS', '2')
    command(['cargo', 'build', '--release', '-p', 'horizon-client', '--bin', 'horizon-client',
             '-p', 'horizon-prepare', '--bin', 'horizon-prepare'], cwd=checkout, env=env)
    source_root = target_dir / 'release'
    for bin_name in BINARIES:
        if not (source_root / binary_name(bin_name)).is_file():
            raise RuntimeError(f'Cargo no generó {binary_name(bin_name)}')
    if not (checkout / 'research-lock.json').is_file():
        raise RuntimeError('El repositorio Horizon no contiene research-lock.json')
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.horizon-stage-', dir=output.parent) as temp:
        stage = Path(temp)
        for name in BINARIES:
            shutil.copy2(source_root / binary_name(name), stage / binary_name(name))
        for name in ('research-lock.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md'):
            src = checkout / name
            if src.is_file():
                shutil.copy2(src, stage / name)
        shutil.copytree(checkout / EXPORTER_SOURCES, stage / EXPORTER_SOURCES)
        hashes = {path.relative_to(stage).as_posix(): digest(path) for path in stage.rglob('*') if path.is_file()}
        metadata = {
            'format': 1, 'source_repo': REPOSITORY, 'source_commit': sha,
            'source_ref': ref or 'main', 'platform': platform.system().lower(),
            'arch': platform.machine().lower(), 'sha256': hashes,
            'minecraft_assets_included': False,
            'note': 'Compiled from public Horizon Rust source; Minecraft assets are NOT included.'
        }
        (stage / 'vis-horizon-source.json').write_text(json.dumps(metadata, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
        # Build in staging; only publish completed outputs. Keep previous build on error.
        old = output.parent / '.horizon-old'
        if old.exists():
            shutil.rmtree(old)
        if output.exists():
            output.rename(old)
        try:
            shutil.copytree(stage, output)
        except BaseException:
            if output.exists():
                shutil.rmtree(output)
            if old.exists():
                old.rename(output)
            raise
        if old.exists():
            shutil.rmtree(old)
    print(f'[VIS Horizon Source] Juego Rust compilado e incluido: {sha[:12]} -> {output}')


def main() -> int:
    parser = argparse.ArgumentParser(description='Compila Horizon del repositorio como recurso de VIS Nexo')
    parser.add_argument('action', choices=['build', 'verify'])
    parser.add_argument('--update', action='store_true', help='Actualizar desde el repositorio antes de compilar')
    parser.add_argument('--source-dir', default=os.environ.get('VIS_HORIZON_SOURCE_DIR'))
    parser.add_argument('--ref', default=os.environ.get('VIS_HORIZON_REF'))
    args = parser.parse_args()
    try:
        if args.action == 'verify':
            manifest = OUTPUT / 'vis-horizon-source.json'
            if not manifest.is_file():
                raise RuntimeError('Horizon todavía no fue compilado dentro de VIS')
            sha = json.loads(manifest.read_text())['source_commit']
            if not is_valid(OUTPUT, sha):
                raise RuntimeError('El juego Horizon incluido fue modificado o está incompleto')
            print(f'[VIS Horizon Source] Integridad verificada: {sha}')
        else:
            build(args.source_dir, args.ref, args.update)
    except (OSError, RuntimeError, subprocess.CalledProcessError) as exc:
        print(f'[VIS Horizon Source] ERROR: {exc}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
