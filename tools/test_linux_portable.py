#!/usr/bin/env python3
"""Regression tests for portable AppImage tarballs (no DEB or installation)."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import tarfile
import unittest

spec = importlib.util.spec_from_file_location(
    "linux_portable", Path(__file__).with_name("package_linux_portable.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class LinuxPortableTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.bundle = self.root / "target" / "release" / "bundle" / "appimage"
        self.horizon = self.root / "src-tauri" / "resources" / "horizon"
        self.release = self.root / "target" / "release"
        self.bundle.mkdir(parents=True)
        self.horizon.mkdir(parents=True)
        (self.bundle / "vis-nexo_2.20.0_amd64.AppImage").write_bytes(b"\x7fELF" + b"x" * 256)
        self.files = {
            "horizon-client": b"official compiled game",
            "horizon-prepare": b"official compiled tools",
            "research-lock.json": b"{}",
            "exporters/VanillaHeightmapOracle.java": b"// official exporter",
        }
        for name, data in self.files.items():
            target = self.horizon / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        self.manifest = {
            "source_repo": "https://github.com/horizon-rust/horizon.git",
            "sha256": {name: hashlib.sha256(data).hexdigest()
                       for name, data in self.files.items()},
        }
        self.write_manifest()

    def write_manifest(self):
        (self.horizon / "vis-horizon-source.json").write_text(json.dumps(self.manifest))

    def test_linux_archive_can_be_extracted_and_launched_without_install(self):
        app, archive = module.package(self.bundle, self.horizon, self.release, inspect=False)
        self.assertTrue((app / "VIS-Nexo.AppImage").is_file())
        self.assertFalse((app / "installer.deb").exists())
        self.assertTrue((app / ".vis-portable").is_file())
        with tarfile.open(archive, "r:gz") as source:
            files = {item.name: item for item in source}
            prefix = "VIS-Nexo-Linux-Portable/"
            self.assertIn(prefix + "VIS-Nexo.AppImage", files)
            self.assertIn(prefix + "Abrir VIS Nexo.sh", files)
            self.assertTrue(files[prefix + "VIS-Nexo.AppImage"].mode & 0o111)
            self.assertTrue(files[prefix + "Abrir VIS Nexo.sh"].mode & 0o111)
            script = source.extractfile(files[prefix + "Abrir VIS Nexo.sh"]).read().decode()
            self.assertIn("--appimage-extract-and-run", script)
            self.assertNotIn("sudo ", script)
            self.assertNotIn("apt install", script)
            readme = source.extractfile(files[prefix + "LEEME - VIS Nexo Linux.txt"]).read().decode()
            self.assertIn("SIN INSTALADOR", readme)


    def test_slim_launcher_is_independent_of_horizon(self):
        app, archive = module.package(self.bundle, self.horizon, self.release, inspect=False, slim=True)
        with tarfile.open(archive, "r:gz") as tarball:
            files = tarball.getnames()
            self.assertIn("VIS-Nexo-Linux-Portable/VIS-Nexo.AppImage", files)
            guide = tarball.extractfile("VIS-Nexo-Linux-Portable/LEEME - VIS Nexo Linux.txt").read().decode()
            self.assertIn("no incluye binarios", guide)

    def test_rejects_modified_horizon(self):
        (self.horizon / "horizon-client").write_bytes(b"tampered")
        with self.assertRaisesRegex(RuntimeError, "SHA-256"):
            module.package(self.bundle, self.horizon, self.release, inspect=False)

    def test_rejects_untrusted_source(self):
        self.manifest["source_repo"] = "https://example.invalid/repo.git"
        self.write_manifest()
        with self.assertRaisesRegex(RuntimeError, "Origen"):
            module.package(self.bundle, self.horizon, self.release, inspect=False)

    def test_rejects_malformed_or_extra_appimage(self):
        (self.bundle / "vis-nexo_2.20.0_amd64.AppImage").write_bytes(b"not an appimage")
        with self.assertRaisesRegex(RuntimeError, "AppImage"):
            module.package(self.bundle, self.horizon, self.release, inspect=False)
        (self.bundle / "vis-nexo_2.20.0_amd64.AppImage").write_bytes(b"\x7fELF" + b"x" * 256)
        (self.bundle / "other.AppImage").write_bytes(b"\x7fELF" + b"x" * 256)
        with self.assertRaisesRegex(RuntimeError, "una sola"):
            module.package(self.bundle, self.horizon, self.release, inspect=False)

    def test_rejects_manifest_traversal(self):
        self.manifest["sha256"]["../steal.txt"] = "a" * 64
        self.write_manifest()
        with self.assertRaisesRegex(RuntimeError, "Ruta"):
            module.package(self.bundle, self.horizon, self.release, inspect=False)


if __name__ == "__main__":
    unittest.main()
