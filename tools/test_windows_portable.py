#!/usr/bin/env python3
"""Regression tests for unzip-and-run Windows portable distribution."""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest
import zipfile

MODULE_PATH = Path(__file__).with_name("package_windows_portable.py")
spec = importlib.util.spec_from_file_location("vis_windows_portable", MODULE_PATH)
portable = importlib.util.module_from_spec(spec)
spec.loader.exec_module(portable)


class WindowsPortableTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.release = self.root / "target" / "release"
        self.horizon = self.root / "src-tauri" / "resources" / "horizon"
        self.release.mkdir(parents=True)
        self.horizon.mkdir(parents=True)
        fake_pe = bytearray(256)
        fake_pe[:2] = b"MZ"
        struct.pack_into("<I", fake_pe, 0x3C, 0x80)
        fake_pe[0x80:0x84] = b"PE\x00\x00"
        (self.release / "vslauncher-tauri.exe").write_bytes(fake_pe)
        (self.release / "WebView2Loader.dll").write_bytes(b"safe fixture")
        self.resources = {
            "horizon-client.exe": b"compiled from horizon",
            "horizon-prepare.exe": b"preparer from horizon",
            "research-lock.json": b"{}",
            "exporters/VanillaHeightmapOracle.java": b"// heightmap fixture",
        }
        for name, value in self.resources.items():
            file = self.horizon / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(value)
        self.manifest = {
            "source_repo": "https://github.com/horizon-rust/horizon.git",
            "sha256": {
                name: hashlib.sha256(value).hexdigest()
                for name, value in self.resources.items()
            },
        }
        self.write_manifest()

    def write_manifest(self):
        (self.horizon / "vis-horizon-source.json").write_text(
            json.dumps(self.manifest), encoding="utf-8"
        )

    def test_portable_zip_contains_launcher_and_all_verified_resources(self):
        directory, archive = portable.package(self.release, self.horizon)
        self.assertTrue((directory / "VIS Nexo.exe").is_file())
        self.assertTrue((directory / ".vis-portable").is_file())
        self.assertTrue((directory / "horizon" / "horizon-client.exe").is_file())
        self.assertTrue((directory / "WebView2Loader.dll").is_file())
        self.assertFalse((directory / "setup.exe").exists())
        with zipfile.ZipFile(archive) as z:
            self.assertIsNone(z.testzip())
            self.assertIn("VIS Nexo.exe", z.namelist())
            self.assertIn("horizon/horizon-prepare.exe", z.namelist())
            self.assertIn(".vis-portable", z.namelist())
            self.assertIn("horizon/exporters/VanillaHeightmapOracle.java", z.namelist())
            self.assertIn("WebView2Loader.dll", z.namelist())
            info = z.read("LEEME - VIS Nexo Portable.txt").decode()
            self.assertIn("SIN INSTALADOR\n1.", info.replace("\r\n", "\n"))
            self.assertNotIn("accounts.json", z.namelist())

    def test_rejects_tampered_horizon_executable(self):
        (self.horizon / "horizon-client.exe").write_bytes(b"modified game")
        with self.assertRaisesRegex(RuntimeError, "cambió"):
            portable.package(self.release, self.horizon)

    def test_rejects_modified_or_unsupported_origin(self):
        self.manifest["source_repo"] = "https://example.invalid/fake"
        self.write_manifest()
        with self.assertRaisesRegex(RuntimeError, "Origen"):
            portable.package(self.release, self.horizon)

    def test_rejects_non_pe_executable(self):
        (self.release / "vslauncher-tauri.exe").write_bytes(b"random fake executable")
        with self.assertRaisesRegex(RuntimeError, "PE"):
            portable.package(self.release, self.horizon)

    def test_rejects_manifest_path_escape(self):
        self.manifest["sha256"]["../secrets.txt"] = "a" * 64
        self.write_manifest()
        with self.assertRaisesRegex(RuntimeError, "Ruta no válida"):
            portable.package(self.release, self.horizon)


if __name__ == "__main__":
    unittest.main()
