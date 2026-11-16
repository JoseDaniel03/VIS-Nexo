import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from configure_android_installer import configure, a

class InstallerTests(unittest.TestCase):
    def fixture(self, root, provider=''):
        path=root/'app/src/main/AndroidManifest.xml'
        path.parent.mkdir(parents=True)
        path.write_text('<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application>'+provider+'</application></manifest>')
        return path

    def test_narrow_private_provider_and_concrete_class_are_generated(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);path=self.fixture(root)
            configure(root)
            doc=ET.parse(path).getroot();p=doc.find('application/provider')
            self.assertEqual(p.get(a('name')),'com.visstudios.nexo.mobile.McRustFileProvider')
            self.assertEqual(p.get(a('exported')),'false')
            self.assertEqual(p.get(a('grantUriPermissions')),'true')
            paths=ET.parse(root/'app/src/main/res/xml/vis_mcrust_paths.xml').getroot()
            self.assertEqual([(e.tag,e.get('path')) for e in paths],[('cache-path','mcrust/')])
            self.assertTrue((root/'app/src/main/java/com/visstudios/nexo/mobile/McRustFileProvider.kt').is_file())
            bridge=root/'app/src/main/java/com/visstudios/nexo/mobile/NexoDevice.kt'
            self.assertEqual(bridge.read_text(),(Path(__file__).resolve().parents[1]/'mobile/android/NexoDevice.kt').read_text())

    def test_repeated_setup_repairs_legacy_provider_without_duplicate_authorities(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);path=self.fixture(root,'<provider android:name="androidx.core.content.FileProvider" android:authorities="${applicationId}.mcrust.files"/><provider android:name="Other" android:authorities="other.files"/>')
            configure(root);configure(root)
            doc=ET.parse(path).getroot()
            providers=doc.findall('application/provider')
            self.assertEqual(len(providers),2)
            own=[p for p in providers if p.get(a('authorities'))=='${applicationId}.mcrust.files']
            self.assertEqual(len(own),1)
            self.assertEqual(len(own[0].findall('meta-data')),1)
            self.assertTrue(any(p.get(a('name'))=='Other' for p in providers))
            self.assertEqual(len(doc.findall('uses-permission')),1)
            self.assertEqual(len(doc.findall('queries/package')),1)

if __name__=='__main__': unittest.main()
