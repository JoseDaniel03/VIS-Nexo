#!/usr/bin/env python3
"""Package a Tauri Linux AppImage for unzip/unpack-and-run distribution."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import stat
import subprocess
import tarfile
import tempfile

ARCHIVE_NAME = "VIS-Nexo-Linux-x86_64-Portable.tar.gz"
LAUNCHER = """#!/usr/bin/env bash
set -euo pipefail
here="$(cd -- "$(dirname -- "$0")" && pwd -P)"
image="$here/VIS-Nexo.AppImage"
if [[ ! -f "$image" ]]; then
  echo "Falta VIS-Nexo.AppImage junto al script." >&2
  exit 1
fi
# FUSE is optional: Linux can extract a type-2 AppImage at launch time.
if [[ ! -r /dev/fuse ]]; then
  exec "$image" --appimage-extract-and-run "$@"
fi
exec "$image" "$@"
"""
README = """VIS NEXO LINUX x86_64 - SIN INSTALADOR

1. Descomprimí el TAR.GZ completo en la carpeta que elijas.
2. Abrí VIS-Nexo.AppImage con doble clic, o el archivo Abrir VIS Nexo.sh.
3. Si tu Linux no tiene FUSE, el script extrae y ejecuta AppImage
   sin instalar FUSE (el inicio puede ser algo más lento).
4. Por terminal: ./Abrir\\ VIS\\ Nexo.sh
5. Horizon va compilado desde el código fuente oficial e incluido en AppImage.
6. Los perfiles, mundos e instancias siguen en tus carpetas de usuario VIS.
7. Para actualizar, cerrá VIS y reemplazá la carpeta, no instales paquetes.
No requiere sudo, DEB, RPM ni instalador del launcher.
La compatibilidad entre distros depende de glibc y del sistema gráfico.
"""


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as reader:
        for chunk in iter(lambda: reader.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def verify_horizon_source(root: Path) -> dict:
    source = root / "vis-horizon-source.json"
    if not source.is_file():
        raise RuntimeError("No se compiló Horizon desde fuentes oficiales")
    data = json.loads(source.read_text(encoding="utf-8"))
    if data.get("source_repo") != "https://github.com/horizon-rust/horizon.git":
        raise RuntimeError("Origen Horizon no verificado")
    hashes = data.get("sha256")
    if not isinstance(hashes, dict):
        raise RuntimeError("Manifiesto Horizon sin SHA-256")
    for name in ("horizon-client", "horizon-prepare", "research-lock.json"):
        if name not in hashes:
            raise RuntimeError(f"Falta el recurso obligatorio Horizon: {name}")
    for name, expected in hashes.items():
        rel = PurePosixPath(name)
        if not name or rel.is_absolute() or ".." in rel.parts or "\\" in name:
            raise RuntimeError(f"Ruta de recurso Horizon inválida: {name}")
        path = root.joinpath(*rel.parts)
        if path.is_symlink() or not path.is_file() or not isinstance(expected, str) or len(expected) != 64:
            raise RuntimeError(f"Recurso Horizon inválido: {name}")
        if sha256_file(path).lower() != expected.lower():
            raise RuntimeError(f"SHA-256 incorrecto para Horizon: {name}")
    return data


def validate_appimage(image: Path) -> None:
    if not image.is_file() or image.stat().st_size < 128:
        raise RuntimeError("Falta el ejecutable AppImage")
    with image.open("rb") as reader:
        if reader.read(4) != b"\x7fELF":
            raise RuntimeError("AppImage inválida: no es ELF")


def verify_embedded_horizon(image: Path, manifest: dict) -> None:
    # Inspect the actual release bundle: a valid source directory is not enough.
    with tempfile.TemporaryDirectory(prefix="vis-appimage-audit-") as directory:
        result = subprocess.run([str(image.resolve()), "--appimage-extract"], cwd=directory,
                                capture_output=True, text=True, timeout=240, check=False)
        if result.returncode:
            raise RuntimeError("No se pudo extraer AppImage para auditar Horizon: " + result.stderr[-600:])
        root = Path(directory) / "squashfs-root"
        manifests = list(root.rglob("horizon/vis-horizon-source.json"))
        if len(manifests) != 1:
            raise RuntimeError("La AppImage debe contener exactamente un Horizon oficial")
        embedded = json.loads(manifests[0].read_text(encoding="utf-8"))
        if embedded.get("sha256") != manifest["sha256"] or embedded.get("source_repo") != manifest["source_repo"]:
            raise RuntimeError("Horizon empaquetado no coincide con la compilación verificada")
        for name, expected in manifest["sha256"].items():
            path = manifests[0].parent.joinpath(*PurePosixPath(name).parts)
            if not path.is_file() or sha256_file(path).lower() != expected.lower():
                raise RuntimeError(f"Falta o cambió el recurso Horizon dentro de AppImage: {name}")


def package(bundle_dir: Path, horizon_dir: Path, release_dir: Path, *, inspect: bool = True, slim: bool = False) -> tuple[Path, Path]:
    images = sorted(bundle_dir.glob("*.AppImage"))
    if len(images) != 1:
        raise RuntimeError(f"Se esperaba una sola AppImage en {bundle_dir}; encontradas {len(images)}")
    image = images[0]
    validate_appimage(image)
    if not slim:
        manifest = verify_horizon_source(horizon_dir)
        if inspect:
            verify_embedded_horizon(image, manifest)
    folder = release_dir / "portable-linux"
    app = folder / "app"
    if app.exists():
        shutil.rmtree(app)
    app.mkdir(parents=True)
    target = app / "VIS-Nexo.AppImage"
    shutil.copy2(image, target)
    target.chmod(target.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    opener = app / "Abrir VIS Nexo.sh"
    opener.write_text(LAUNCHER, encoding="utf-8")
    opener.chmod(0o755)
    (app / ".vis-portable").write_text("VIS Nexo Linux portable\n", encoding="utf-8")
    guide = README
    if slim:
        guide = guide.replace(
            "5. Horizon va compilado desde el código fuente oficial e incluido en AppImage.",
            "5. Rust Edition descarga su motor de juego oficial compilado por VIS cuando lo elegís.")
        guide += "\nVIS Nexo abre sin Horizon y no incluye binarios del motor Rust.\n"
    (app / "LEEME - VIS Nexo Linux.txt").write_text(guide, encoding="utf-8")
    archive = folder / ARCHIVE_NAME
    with tarfile.open(archive, "w:gz", compresslevel=6) as out:
        for file in sorted(app.iterdir()):
            if not file.is_file() or file.is_symlink():
                raise RuntimeError("La carpeta portable no admite enlaces simbólicos")
            out.add(file, arcname="VIS-Nexo-Linux-Portable/" + file.name, recursive=False)
    with tarfile.open(archive, "r:gz") as check:
        files = {entry.name: entry for entry in check}
        prefix = "VIS-Nexo-Linux-Portable/"
        for required in ("VIS-Nexo.AppImage", "Abrir VIS Nexo.sh", ".vis-portable", "LEEME - VIS Nexo Linux.txt"):
            if prefix + required not in files:
                raise RuntimeError(f"Falta {required} en la distribución")
        for executable in ("VIS-Nexo.AppImage", "Abrir VIS Nexo.sh"):
            if not (files[prefix + executable].mode & 0o111):
                raise RuntimeError(f"Se perdieron los permisos de ejecución de {executable}")
    print(f"VIS Nexo Linux portable: {archive} ({archive.stat().st_size // 1048576} MiB)")
    return app, archive


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle-dir", type=Path, default=Path("target/release/bundle/appimage"))
    parser.add_argument("--horizon-dir", type=Path, default=Path("src-tauri/resources/horizon"))
    parser.add_argument("--release-dir", type=Path, default=Path("target/release"))
    parser.add_argument("--slim", action="store_true", help="Game runtime is shipped as a separate download")
    args = parser.parse_args()
    package(args.bundle_dir.resolve(), args.horizon_dir.resolve(), args.release_dir.resolve(), slim=args.slim)


if __name__ == "__main__":
    main()
