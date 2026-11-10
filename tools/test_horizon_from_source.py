#!/usr/bin/env python3
"""Unit tests for source staging, SHA and cache without downloading Horizon."""
from pathlib import Path
import importlib.util
import json
import os
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('horizon_from_source',Path(__file__).with_name('horizon_from_source.py'))
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class TestSourceBuild(unittest.TestCase):
    def test_new_clone_honors_pinned_release_sha(self):
        with tempfile.TemporaryDirectory() as dirname:
            original_cache=module.CACHE
            module.CACHE=Path(dirname)/'cache'
            calls=[]
            def mocked_command(args,cwd=None,env=None):
                calls.append(args)
                if args[:2]==['git','clone']:
                    (module.CACHE/'source').mkdir(parents=True)
                return ''
            try:
                with patch.object(module,'command',side_effect=mocked_command):
                    module.source_checkout(None,'a'*40,False)
                self.assertEqual(calls[1],['git','fetch','--depth','1','origin','a'*40])
                self.assertEqual(calls[2],['git','checkout','--detach','FETCH_HEAD'])
            finally:
                module.CACHE=original_cache

    def test_sha256_blocks_modified_client(self):
        with tempfile.TemporaryDirectory() as dirname:
            path=Path(dirname)
            for name in ('horizon-client','horizon-prepare','research-lock.json'):
                (path/module.binary_name(name) if name!='research-lock.json' else path/name).write_bytes(name.encode())
            exporters=path/module.EXPORTER_SOURCES
            exporters.mkdir(parents=True)
            (exporters/'VanillaHeightmapOracle.java').write_text('// test exporter')
            files={p.relative_to(path).as_posix():module.digest(p) for p in path.rglob('*') if p.is_file()}
            (path/'vis-horizon-source.json').write_text(json.dumps({'source_commit':'a'*40,
               'platform':module.platform.system().lower(),'arch':module.platform.machine().lower(),
               'sha256':files}))
            self.assertTrue(module.is_valid(path,'a'*40))
            exporter=exporters/'VanillaHeightmapOracle.java'
            original=exporter.read_bytes()
            exporter.unlink()
            self.assertFalse(module.is_valid(path,'a'*40))
            exporter.write_bytes(original)
            self.assertTrue(module.is_valid(path,'a'*40))
            (path/module.binary_name('horizon-client')).write_bytes(b'tampered')
            self.assertFalse(module.is_valid(path,'a'*40))

    def test_compiler_artifacts_are_staged_and_reused(self):
        with tempfile.TemporaryDirectory() as dirname:
            tmp=Path(dirname)
            original_cache=module.CACHE
            module.CACHE=tmp/'cache'
            checkout=tmp/'fake-upstream';checkout.mkdir()
            (checkout/'.git').mkdir();(checkout/'Cargo.toml').write_text('[workspace]\n')
            (checkout/'research-lock.json').write_text('{}')
            (checkout/'LICENSE').write_text('MIT license placeholder for test')
            exporters=checkout/module.EXPORTER_SOURCES
            exporters.mkdir(parents=True)
            (exporters/'VanillaHeightmapOracle.java').write_text('// test exporter')
            root=tmp/'vis';root.mkdir()
            calls=[]
            def mocked_command(args,cwd=None,env=None):
                calls.append(args)
                if args[:2]==['git','rev-parse']:return 'b'*40
                if args[:2]==['cargo','build']:
                    out=Path(env['CARGO_TARGET_DIR'])/'release';out.mkdir(parents=True)
                    for binary in module.BINARIES:
                        (out/module.binary_name(binary)).write_bytes(binary.encode())
                    return ''
                raise AssertionError(args)
            try:
                with patch.object(module.shutil,'which',return_value='/usr/bin/fake'), patch.object(module,'command',side_effect=mocked_command):
                    module.build(str(checkout),None,False,project_root=root)
                    manifest=root/'src-tauri/resources/horizon/vis-horizon-source.json'
                    data=json.loads(manifest.read_text())
                    self.assertEqual(data['source_commit'],'b'*40)
                    self.assertFalse(data['minecraft_assets_included'])
                    self.assertTrue(module.is_valid(manifest.parent,'b'*40))
                    self.assertTrue(any(x[:2]==['cargo','build'] for x in calls))
                    calls.clear()
                    module.build(str(checkout),None,False,project_root=root)
                    self.assertFalse(any(x[:2]==['cargo','build'] for x in calls))
            finally:
                module.CACHE=original_cache

if __name__=='__main__':unittest.main()
