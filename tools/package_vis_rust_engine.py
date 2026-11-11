#!/usr/bin/env python3
"""Package the Rust Edition GAME separately from portable VIS Nexo.

Horizon is built from its official source by tools/horizon_from_source.py; no
Horizon Launcher is ever distributed. An SHA-256 pinned descriptor is bundled
into the lightweight VIS app. The game payload is downloaded only on demand.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import stat
import tarfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
REPOSITORY = "https://github.com/horizon-rust/horizon.git"
FILE_NAMES = {
    "windows": "VIS-Rust-Edition-Windows-x64-Engine.zip",
    "linux": "VIS-Rust-Edition-Linux-x86_64-Engine.tar.gz",
}
MAX_PAYLOAD = 512 * 1024 * 1024


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(128 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def verify_source(source: Path, system: str) -> tuple[dict, list[tuple[str, Path]]]:
    original = source / "vis-horizon-source.json"
    if not original.is_file():
        raise ValueError("Falta manifiesto oficial del motor VIS Rust Edition")
    manifest = json.loads(original.read_text(encoding="utf-8"))
    if manifest.get("source_repo") != REPOSITORY:
        raise ValueError("El motor debe compilarse desde el repositorio oficial Horizon")
    commit = manifest.get("source_commit", "")
    if not isinstance(commit, str) or len(commit) != 40 or any(x not in "0123456789abcdef" for x in commit):
        raise ValueError("Commit del motor de juego inválido")
    expected = manifest.get("sha256")
    if not isinstance(expected, dict):
        raise ValueError("Falta catálogo de huellas SHA-256")
    ext = ".exe" if system == "windows" else ""
    for required in (f"horizon-client{ext}", f"horizon-prepare{ext}", "research-lock.json"):
        if required not in expected:
            raise ValueError(f"Componente de Rust Edition ausente: {required}")
    names = dict(expected)
    names["vis-horizon-source.json"] = sha256(original)
    if len(names) > 16384:
        raise ValueError("Demasiados archivos para el motor del juego")
    files = []
    size = 0
    for name, value in sorted(names.items()):
        posix = PurePosixPath(name)
        if (not name or posix.is_absolute() or ".." in posix.parts or "\\" in name
                or name.startswith(".") or not isinstance(value, str) or len(value) != 64
                or any(ch not in "0123456789abcdef" for ch in value.lower())):
            raise ValueError(f"Ruta/huella insegura para el motor: {name}")
        path = source.joinpath(*posix.parts)
        if not path.is_file() or path.is_symlink() or sha256(path).lower() != value.lower():
            raise ValueError(f"Recurso Rust Edition alterado: {name}")
        size += path.stat().st_size
        if size > MAX_PAYLOAD:
            raise ValueError("El motor Rust Edition excede el límite de tamaño")
        files.append((name, path))
    return manifest, files


def package(source: Path, output: Path, resources: Path, system: str,
            release_tag: str = "") -> tuple[Path, Path]:
    if system not in FILE_NAMES:
        raise ValueError("Solo Windows x64 y Linux x86_64 están soportados")
    original, files = verify_source(source, system)
    output.mkdir(parents=True, exist_ok=True)
    resources.mkdir(parents=True, exist_ok=True)
    name = FILE_NAMES[system]
    archive = output / name
    if system == "windows":
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as dest:
            for relative, path in files:
                dest.write(path, arcname=relative)
    else:
        with tarfile.open(archive, "w:gz", compresslevel=6) as dest:
            for relative, path in files:
                info = dest.gettarinfo(str(path), arcname=relative)
                if not info.isfile():
                    raise ValueError(f"No se permite archivo no regular: {relative}")
                if relative in {"horizon-client", "horizon-prepare"}:
                    info.mode = 0o755
                else:
                    info.mode = 0o644
                with path.open("rb") as reader:
                    dest.addfile(info, reader)
    if archive.stat().st_size > 256 * 1024 * 1024:
        raise ValueError("El paquete del juego es demasiado grande")
    if release_tag and (not release_tag.startswith("nexo-v") or
                        not all(c.isalnum() or c in ".-_" for c in release_tag)):
        raise ValueError("Etiqueta GitHub Release inválida")
    url = (f"https://github.com/JoseDaniel03/VIS-Nexo/releases/download/{release_tag}/{name}"
           if release_tag else "")
    descriptor = {
        "format": 1,
        "product": "VIS Rust Edition — game runtime, not an external launcher",
        "source_repo": REPOSITORY,
        "source_commit": original["source_commit"],
        "os": system,
        "arch": "x86_64",
        "archive": name,
        "archive_sha256": sha256(archive),
        "archive_size": archive.stat().st_size,
        "download_url": url,
        "files_sha256": {relative: sha256(path) for relative, path in files},
        "minecraft_assets_included": False,
    }
    destination = resources / "vis-rust-runtime.json"
    destination.write_text(json.dumps(descriptor, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"[VIS Rust Edition] Optional game runtime: {archive} ({archive.stat().st_size / 1e6:.2f} MB)")
    print(f"[VIS Rust Edition] Launcher ships manifest only: {destination}")
    return archive, destination


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT / "src-tauri/resources/horizon")
    parser.add_argument("--out", type=Path, default=ROOT / "target/release/rust-engine")
    parser.add_argument("--resources", type=Path, default=ROOT / "src-tauri/resources")
    parser.add_argument("--os", choices=list(FILE_NAMES), default=("windows" if os.name == "nt" else "linux"))
    parser.add_argument("--release-tag", default=os.environ.get("VIS_RUST_RELEASE_TAG", ""))
    args = parser.parse_args()
    package(args.source, args.out, args.resources, args.os, args.release_tag)


if __name__ == "__main__":
    main()
