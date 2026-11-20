#!/usr/bin/env python3
"""Add the narrowly scoped APK installer after `tauri android init`."""
from pathlib import Path
import shutil
import xml.etree.ElementTree as ET
ROOT = Path(__file__).resolve().parents[1]
ANDROID = 'http://schemas.android.com/apk/res/android'
ET.register_namespace('android', ANDROID)
a = lambda name: '{'+ANDROID+'}'+name

def configure(root):
    path = root / 'app/src/main/AndroidManifest.xml'
    tree = ET.parse(path)
    manifest = tree.getroot()
    if not any(e.get(a('name')) == 'android.permission.REQUEST_INSTALL_PACKAGES' for e in manifest.findall('uses-permission')):
        ET.SubElement(manifest, 'uses-permission', {a('name'): 'android.permission.REQUEST_INSTALL_PACKAGES'})
    queries = manifest.find('queries')
    if queries is None: queries = ET.SubElement(manifest, 'queries')
    if not any(e.get(a('name')) == 'com.visstudios.mcrust' for e in queries.findall('package')):
        ET.SubElement(queries, 'package', {a('name'): 'com.visstudios.mcrust'})
    app = manifest.find('application')
    assert app is not None
    authority = '${applicationId}.mcrust.files'
    package = 'com.visstudios.nexo.mobile'
    provider_name = package + '.McRustFileProvider'
    # A dedicated subclass avoids manifest-merger collisions with Tauri/plugins.
    providers = [e for e in app.findall('provider') if e.get(a('authorities')) == authority]
    provider = providers[0] if providers else ET.SubElement(app, 'provider')
    for duplicate in providers[1:]: app.remove(duplicate)
    provider.attrib.update({a('name'): provider_name, a('authorities'): authority,
                           a('exported'): 'false', a('grantUriPermissions'): 'true'})
    metadata = [e for e in provider.findall('meta-data') if e.get(a('name')) == 'android.support.FILE_PROVIDER_PATHS']
    item = metadata[0] if metadata else ET.SubElement(provider, 'meta-data')
    item.attrib.update({a('name'): 'android.support.FILE_PROVIDER_PATHS', a('resource'): '@xml/vis_mcrust_paths'})
    for duplicate in metadata[1:]: provider.remove(duplicate)
    source = root / 'app/src/main/java' / Path(*package.split('.')) / 'McRustFileProvider.kt'
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_text('package ' + package + '\n\nclass McRustFileProvider : androidx.core.content.FileProvider()\n', encoding='utf-8')
    shutil.copyfile(ROOT / 'mobile/android/NexoDevice.kt', source.parent / 'NexoDevice.kt')
    tree.write(path, encoding='utf-8', xml_declaration=True)
    paths = root / 'app/src/main/res/xml/vis_mcrust_paths.xml'
    paths.parent.mkdir(parents=True, exist_ok=True)
    paths.write_text('<paths><cache-path name="mcrust" path="mcrust/"/></paths>\n')

if __name__ == '__main__': configure(ROOT / 'mobile/src-tauri/gen/android')
