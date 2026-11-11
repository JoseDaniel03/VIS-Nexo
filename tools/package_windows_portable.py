#!/usr/bin/env python3
"""Create an unzip-and-run Windows distribution for Tauri 2 (no NSIS/MSI).

Tauri embeds the frontend into the PE executable. On Windows its resource_dir()
is the executable's directory; the Horizon resource map points to ./horizon/.
The portable marker makes the in-app updater refuse an NSIS install.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import struct
import zipfile


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as reader:
        for chunk in iter(lambda: reader.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_pe(path: Path) -> None:
    if not path.is_file():
        raise RuntimeError(f"No existe el ejecutable principal: {path}")
    with path.open("rb") as reader:
        header = reader.read(64)
        if len(header) != 64 or header[:2] != b"MZ":
            raise RuntimeError(f"El ejecutable no es un PE de Windows: {path}")
        pe_offset = struct.unpack_from("<I", header, 0x3C)[0]
        if pe_offset < 64 or pe_offset > 1024 * 1024:
            raise RuntimeError("Cabecera PE incorrecta")
        reader.seek(pe_offset)
        if reader.read(4) != b"PE\x00\x00":
            raise RuntimeError("Firma PE inválida")
    if path.stat().st_size < 128:
        raise RuntimeError("Ejecutable demasiado pequeño")


def horizon_payload(source: Path) -> list[tuple[Path, str]]:
    manifest_file = source / "vis-horizon-source.json"
    if not manifest_file.is_file():
        raise RuntimeError("No se compiló Horizon desde el código fuente")
    manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    if manifest.get("source_repo") != "https://github.com/horizon-rust/horizon.git":
        raise RuntimeError("Origen de Horizon no verificado")
    hashes = manifest.get("sha256")
    if not isinstance(hashes, dict):
        raise RuntimeError("Manifiesto Horizon sin SHA-256")
    for name in ("horizon-client.exe", "horizon-prepare.exe", "research-lock.json"):
        if name not in hashes:
            raise RuntimeError(f"Falta la huella de {name}")
    for name, expected in hashes.items():
        relative = PurePosixPath(name)
        if not name or relative.is_absolute() or ".." in relative.parts or "\\" in name:
            raise RuntimeError(f"Ruta no válida en el manifiesto: {name}")
        file = source.joinpath(*relative.parts)
        if file.is_symlink() or not file.is_file() or not isinstance(expected, str) or len(expected) != 64:
            raise RuntimeError(f"Recurso Horizon ausente o inválido: {name}")
        if sha256_file(file).lower() != expected.lower():
            raise RuntimeError(f"El recurso Horizon cambió después de compilar: {name}")
    result = []
    for path in sorted(source.rglob("*")):
        if path.is_symlink():
            raise RuntimeError(f"El paquete no admite enlaces simbólicos: {path}")
        if path.is_file():
            relative = path.relative_to(source).as_posix()
            result.append((path, "horizon/" + relative))
    return result


def package(release_dir: Path, horizon_dir: Path, *, slim: bool = False) -> tuple[Path, Path]:
    executable = release_dir / "vslauncher-tauri.exe"
    validate_pe(executable)
    resource_files = [] if slim else horizon_payload(horizon_dir)
    portable = release_dir / "portable"
    app_dir = portable / "app"
    if app_dir.exists():
        shutil.rmtree(app_dir)
    app_dir.mkdir(parents=True)
    shutil.copy2(executable, app_dir / "VIS Nexo.exe")
    dlls = sorted(release_dir.glob("*.dll"))
    for dll in dlls:
        if dll.is_symlink():
            raise RuntimeError("No se pueden incluir DLL enlazadas")
        shutil.copy2(dll, app_dir / dll.name)
    for source, relative in resource_files:
        dest = app_dir / Path(relative)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, dest)
    if slim:
        metadata = horizon_dir.parent / "vis-rust-runtime.json"
        if not metadata.is_file():
            raise RuntimeError("El portable ligero necesita el manifiesto verificado VIS Rust Edition")
        data = json.loads(metadata.read_text(encoding="utf-8"))
        if data.get("format") != 1 or data.get("source_repo") != "https://github.com/horizon-rust/horizon.git":
            raise RuntimeError("No se compiló el manifiesto válido de Rust Edition")
        shutil.copy2(metadata, app_dir / "vis-rust-runtime.json")
    (app_dir / ".vis-portable").write_text("VIS Nexo portable v1\n", encoding="utf-8")
    (app_dir / "LEEME - VIS Nexo Portable.txt").write_text(
        ("VIS NEXO PARA WINDOWS - SIN INSTALADOR\n"
         "1. Descomprimí todo el ZIP. Abrí VIS Nexo.exe con doble clic.\n"
         "2. Minecraft Java y VIS Social funcionan sin Horizon Launcher.\n"
         "3. Rust Edition descarga el motor de juego compilado por VIS desde\n"
         "   GitHub Releases únicamente al elegir Instalar Rust Edition.\n"
         "4. Conservá mundos y cuentas en los directorios de usuario VIS.\n"
         "5. Windows 10/11 x64 puede requerir Microsoft Edge WebView2 Runtime.\n"
         "6. Para actualizar, cerrá VIS y reemplazá la carpeta del launcher.\n")
        if slim else
        ("VIS NEXO PARA WINDOWS - SIN INSTALADOR\n"
         "1. Descomprimí todo el ZIP y abrí VIS Nexo.exe.\n"
         "2. Conservá la carpeta horizon junto al ejecutable.\n"
         "3. Tus mundos y perfiles permanecen fuera del ZIP.\n"),
        encoding="utf-8",
    )
    archive = portable / "VIS-Nexo-Windows-x64-Portable.zip"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as target:
        for path in sorted(app_dir.rglob("*")):
            if path.is_file():
                target.write(path, arcname=path.relative_to(app_dir).as_posix())
    with zipfile.ZipFile(archive) as target:
        bad = target.testzip()
        if bad:
            raise RuntimeError(f"ZIP corrupto: {bad}")
        names = set(target.namelist())
        required = {"VIS Nexo.exe", ".vis-portable"}
        if slim:
            required.add("vis-rust-runtime.json")
        if not slim:
            required.update({"horizon/horizon-client.exe", "horizon/horizon-prepare.exe",
                             "horizon/research-lock.json", "horizon/vis-horizon-source.json"})
        elif any(name.startswith("horizon/") for name in names):
            raise RuntimeError("El ZIP ligero no puede contener el motor Rust Edition")
        if not required.issubset(names):
            raise RuntimeError("El ZIP portable está incompleto")
    print(f"VIS Nexo portable: {archive} ({archive.stat().st_size // (1024 * 1024)} MiB)")
    print(f"Directorio para GitHub Actions: {app_dir}")
    return app_dir, archive


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-dir", type=Path, default=Path("target/release"))
    parser.add_argument("--horizon-dir", type=Path, default=Path("src-tauri/resources/horizon"))
    parser.add_argument("--slim", action="store_true", help="Do not include the optional Rust Edition game engine")
    args = parser.parse_args()
    package(args.release_dir.resolve(), args.horizon_dir.resolve(), slim=args.slim)


if __name__ == "__main__":
    main()
