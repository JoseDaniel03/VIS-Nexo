#!/usr/bin/env python3
"""Add the narrowly scoped APK installer after `tauri android init`."""
from pathlib import Path
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
    if not any(e.get(a('authorities')) == authority for e in app.findall('provider')):
        provider = ET.SubElement(app, 'provider', {a('name'): 'androidx.core.content.FileProvider', a('authorities'): authority, a('exported'): 'false', a('grantUriPermissions'): 'true'})
        ET.SubElement(provider, 'meta-data', {a('name'): 'android.support.FILE_PROVIDER_PATHS', a('resource'): '@xml/vis_mcrust_paths'})
    tree.write(path, encoding='utf-8', xml_declaration=True)
    paths = root / 'app/src/main/res/xml/vis_mcrust_paths.xml'
    paths.parent.mkdir(parents=True, exist_ok=True)
    paths.write_text('<paths><cache-path name="mcrust" path="mcrust/"/></paths>\n')

if __name__ == '__main__': configure(ROOT / 'mobile/src-tauri/gen/android')
