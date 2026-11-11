#!/usr/bin/env python3
"""Measure the actual user download (not GitHub's outer artifact ZIP).

Portable size policy:
- aspirational <=50 MB download;
- hard release ceiling <=150 MB download;
- CI reports oversized packages without suppressing diagnostic artifacts.
Project artwork is fetched separately and never counted as bundled weight.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import tarfile
import zipfile

TARGET_MB = 50
MAX_MB = 150
MB = 1_000_000


def inspect(path: Path, target_mb: int = TARGET_MB, max_mb: int = MAX_MB) -> dict:
    if not path.is_file() or not path.stat().st_size:
        raise ValueError(f"El paquete portable no existe o está vacío: {path}")
    size = path.stat().st_size
    if not target_mb or max_mb < target_mb:
        raise ValueError("El máximo debe ser igual o mayor que la meta de tamaño")
    unpacked = None
    if path.name.endswith(".tar.gz"):
        with tarfile.open(path, "r:gz") as archive:
            items = archive.getmembers()
            if any(not item.isfile() and not item.isdir() for item in items):
                raise ValueError("El TAR contiene enlaces o elementos no permitidos")
            unpacked = sum(item.size for item in items if item.isfile())
    elif path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path) as archive:
            bad = archive.testzip()
            if bad:
                raise ValueError(f"ZIP corrupto: {bad}")
            unpacked = sum(item.file_size for item in archive.infolist() if not item.is_dir())
    elif path.suffix.lower() != ".appimage":
        raise ValueError("Formato portable no admitido para la medición")
    return {
        "file": path.name,
        "download_bytes": size,
        "download_mb": round(size / MB, 2),
        "unpacked_mb": round(unpacked / MB, 2) if unpacked is not None else None,
        "target_mb": target_mb,
        "limit_mb": max_mb,
        "target_met": size <= target_mb * MB,
        "limit_met": size <= max_mb * MB,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", type=Path)
    parser.add_argument("--target-mb", type=int, default=TARGET_MB)
    parser.add_argument("--max-mb", type=int, default=MAX_MB)
    parser.add_argument("--strict", action="store_true", help="Fail release if above hard ceiling")
    args = parser.parse_args()
    result = inspect(args.file, args.target_mb, args.max_mb)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    status = "OK" if result["limit_met"] else "OVER LIMIT"
    markdown = (
        f"| Portable | Descarga | Descomprimido | Meta | Máximo | Estado |\n"
        f"| --- | ---: | ---: | ---: | ---: | --- |\n"
        f"| {result['file']} | {result['download_mb']} MB | "
        f"{result['unpacked_mb'] if result['unpacked_mb'] is not None else '—'} MB | "
        f"{args.target_mb} MB | {args.max_mb} MB | {status} |\n"
    )
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as report:
            report.write("### VIS Nexo — Peso portable\n\n" + markdown + "\n")
    if args.strict and not result["limit_met"]:
        parser.exit(2, f"Release rechazada: {result['download_mb']} MB supera {args.max_mb} MB\n")


if __name__ == "__main__":
    main()
