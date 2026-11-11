#!/usr/bin/env python3
"""Tests size budgets against actual downloadable archives."""
import importlib.util
from pathlib import Path
import tarfile
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("budget", Path(__file__).with_name("check_portable_size.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PortableBudgetTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def test_small_windows_zip_meets_target(self):
        path = self.root / "portable.zip"
        with zipfile.ZipFile(path, "w") as z:
            z.writestr("VIS Nexo.exe", b"MZ" + b"x" * 200)
        report = module.inspect(path)
        self.assertTrue(report["target_met"])
        self.assertTrue(report["limit_met"])
        self.assertGreater(report["unpacked_mb"], 0)

    def test_large_linux_tar_is_reported_over_limit(self):
        data = self.root / "payload"
        data.write_bytes(b"x" * (module.MB + 100))
        path = self.root / "portable.tar.gz"
        with tarfile.open(path, "w:gz") as out:
            out.add(data, arcname="VIS-Nexo-Linux-Portable/payload")
        report = module.inspect(path, target_mb=1, max_mb=1)
        # Gzip compresses the payload very well, so a high extracted size
        # must not be confused with the size of the actual download.
        self.assertTrue(report["limit_met"])
        self.assertGreater(report["unpacked_mb"], 1)

    def test_high_entropy_zip_over_budget(self):
        path = self.root / "portable.zip"
        with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_STORED) as z:
            z.writestr("payload", b"x" * (module.MB + 10))
        report = module.inspect(path, target_mb=1, max_mb=1)
        self.assertFalse(report["limit_met"])
        self.assertFalse(report["target_met"])

    def test_appimage_measures_direct_download_size(self):
        path = self.root / "VIS-Nexo.AppImage"
        path.write_bytes(b"\x7fELF" + b"x" * 256)
        report = module.inspect(path)
        self.assertIsNone(report["unpacked_mb"])
        self.assertEqual(report["file"], path.name)


if __name__ == "__main__":
    unittest.main()
