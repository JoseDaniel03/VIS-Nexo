"""Source-builder regressions: .hnmod activation only when game's feature is compiled."""
from __future__ import annotations
import importlib.util
from pathlib import Path
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().with_name("horizon_from_source.py")
spec = importlib.util.spec_from_file_location("vis_horizon_source", SCRIPT)
assert spec and spec.loader
vis = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vis)

class VSClientSourceBuildTests(unittest.TestCase):
    def test_full_official_game_with_nonempty_feature_dependency(self):
        with tempfile.TemporaryDirectory() as td:
            home=Path(td)
            cargo=home/"crates/horizon-official/Cargo.toml"
            cargo.parent.mkdir(parents=True)
            cargo.write_text('[package]\nname="horizon-official"\n[features]\nvis-vsclient=["dep:horizon-client","dep:horizon-mods"]\n')
            adapter=home/"integrations/vsclient-horizon/api/src/lib.rs"
            adapter.parent.mkdir(parents=True)
            adapter.write_text("pub fn hooks() {}\n")
            self.assertTrue(vis.has_embedded_vsclient(home))
            cargo.write_text('[package]\nname="horizon-official"\n[features]\nother=[]\n')
            self.assertFalse(vis.has_embedded_vsclient(home))
            cargo.unlink()
            self.assertFalse(vis.has_embedded_vsclient(home))

    def test_an_old_game_cache_cannot_be_misreported_as_modded(self):
        # The caller passes has_embedded_vsclient to the cache validator so
        # prelinked and vanilla builds never alias under a single git SHA.
        import inspect
        source=inspect.getsource(vis.build)
        self.assertIn("is_valid(output, sha, vsclient_native)",source)
        self.assertIn("'horizon-official/vis-vsclient'",source)
        self.assertIn("'vsclient_embedded': '0.4.1' if vsclient_native else None",source)

if __name__=="__main__":
    unittest.main()
