#!/usr/bin/env python3
"""Fail CI if old zip crate's vulnerable extraction helpers are introduced.

RUSTSEC-2026-0367, -0368, -0369 and -0429 involve ZipArchive::extract
or ZipStreamReader::extract. This is a defense-in-depth guard; the crate was
migrated to zip 9.4.2 and cargo audit independently checks its locked version.
"""
from pathlib import Path
import re
import sys

root = Path(__file__).resolve().parents[1] / "src-tauri/src"
offenders = []
for path in root.rglob("*.rs"):
    source = path.read_text(encoding="utf-8")
    if "zip::" not in source and "ZipArchive" not in source and "ZipStreamReader" not in source:
        continue
    # Don't allow any built-in unzip/extract method in code importing zip.
    # Explicitly parse archive entries and validate each output path instead.
    for match in re.finditer(r"(?:ZipStreamReader|\bzip\b|\barchive\b)\s*\.\s*extract\s*\(", source):
        line = source.count("\n", 0, match.start()) + 1
        offenders.append(f"{path.relative_to(root)}:{line}")
    if "ZipStreamReader" in source:
        offenders.append(f"{path.relative_to(root)}: ZipStreamReader is forbidden")
if offenders:
    print("Unsafe zip extraction API found:\n" + "\n".join(offenders), file=sys.stderr)
    raise SystemExit(1)
print("ZIP extraction policy: manual validated members only; audit validates the dependency.")
