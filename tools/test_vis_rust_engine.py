#!/usr/bin/env python3
"""Test optional source-built Rust Edition payload integrity without a game build."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
import zipfile

spec=importlib.util.spec_from_file_location("vis_rust_pack",Path(__file__).with_name("package_vis_rust_engine.py"))
runtime=importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


class RustEditionModuleTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        self.source=self.root/"source"
        self.source.mkdir()
        self.files={
            "horizon-client.exe":b"MZ Windows-game",
            "horizon-prepare.exe":b"MZ Windows-prepare",
            "horizon-client":b"\x7fELF Linux-game",
            "horizon-prepare":b"\x7fELF Linux-prepare",
            "research-lock.json":b"{}",
            "mods/horizon/src/test/java/dev/horizonlab/parity/Exporter.java":b"// source only"
        }
    def prepare(self,system):
        selected={k:v for k,v in self.files.items() if k not in
          (("horizon-client","horizon-prepare") if system=="windows" else
           ("horizon-client.exe","horizon-prepare.exe"))}
        for name,data in selected.items():
            path=self.source/name
            path.parent.mkdir(parents=True,exist_ok=True)
            path.write_bytes(data)
        hashes={name:hashlib.sha256(data).hexdigest() for name,data in selected.items()}
        (self.source/"vis-horizon-source.json").write_text(json.dumps({
          "source_repo":runtime.REPOSITORY,
          "source_commit":"a"*40,
          "vis_direct_patch":"vis-nexo-direct-game-window-v1",
          "sha256":hashes
        }))
    def test_windows_optional_zip_and_pinned_manifest(self):
        self.prepare("windows")
        archive,desc=runtime.package(self.source,self.root/"dist",self.root/"resources","windows","nexo-v2.20.0")
        info=json.loads(desc.read_text())
        self.assertEqual(info["archive_sha256"],runtime.sha256(archive))
        self.assertEqual(info["download_url"],"https://github.com/JoseDaniel03/VIS-Nexo/releases/download/nexo-v2.20.0/"+archive.name)
        with zipfile.ZipFile(archive) as reader:
            self.assertIn("horizon-client.exe",reader.namelist())
            self.assertIn("vis-horizon-source.json",reader.namelist())
            self.assertFalse(any("launcher" in n.lower() for n in reader.namelist()))
    def test_linux_optional_tar_preserves_executable_bit(self):
        self.prepare("linux")
        archive,desc=runtime.package(self.source,self.root/"dist",self.root/"resources","linux")
        with tarfile.open(archive,"r:gz") as reader:
            files={x.name:x for x in reader}
            self.assertTrue(files["horizon-client"].mode&0o111)
            self.assertTrue(files["horizon-prepare"].mode&0o111)
            self.assertIn("vis-horizon-source.json",files)
        self.assertEqual(json.loads(desc.read_text())["download_url"],"")
    def test_rejects_modified_binary(self):
        self.prepare("windows")
        (self.source/"horizon-client.exe").write_bytes(b"tampered")
        with self.assertRaisesRegex(ValueError,"alterado"):
            runtime.package(self.source,self.root/"dist",self.root/"resources","windows")
    def test_rejects_unverified_source(self):
        self.prepare("windows")
        data=json.loads((self.source/"vis-horizon-source.json").read_text())
        data["source_repo"]="https://invalid.example/clone"
        (self.source/"vis-horizon-source.json").write_text(json.dumps(data))
        with self.assertRaisesRegex(ValueError,"oficial"):
            runtime.package(self.source,self.root/"dist",self.root/"resources","windows")
    def test_rejects_invalid_release_tag(self):
        self.prepare("windows")
        with self.assertRaisesRegex(ValueError,"inválida"):
            runtime.package(self.source,self.root/"dist",self.root/"resources","windows","../../tag")


if __name__=="__main__":
    unittest.main()
