#!/usr/bin/env python3
"""Generate a public VIS Universe catalog, hashing local ZIPs before publication.

The public catalog is metadata only; cloud archives are uploaded to GitHub Releases/R2.
Never bundle secrets, accounts or private worlds into project releases.
"""
import argparse, hashlib, json, pathlib, sys, urllib.parse
p = argparse.ArgumentParser()
p.add_argument('--spec', required=True, type=pathlib.Path)
p.add_argument('--output', required=True, type=pathlib.Path)
a = p.parse_args()
data = json.loads(a.spec.read_text(encoding='utf-8'))
projects = []
for entry in data['projects']:
    for key in ('id', 'name', 'version', 'bundle_url', 'archive_path'):
        if not isinstance(entry.get(key), str) or not entry[key]:
            p.error(f'project entry missing {key}')
    file = pathlib.Path(entry['archive_path']).expanduser()
    if not file.is_file() or file.suffix.lower() != '.zip':
        p.error(f'ZIP missing: {file}')
    url = urllib.parse.urlparse(entry['bundle_url'])
    if url.scheme != 'https' or not url.hostname or url.username or url.password:
        p.error(f'Invalid HTTPS bundle URL: {entry["bundle_url"]}')
    size = file.stat().st_size
    if not (0 < size <= 1024 * 1024 * 1024):
        p.error('Archive exceeds 1 GiB limit')
    digest = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    project = {key: entry.get(key, '') for key in ('id', 'name', 'version', 'description', 'minecraft_version', 'loader', 'bundle_url')}
    project.update({'sha256': digest.hexdigest(), 'size_bytes': size})
    project.pop('archive_path', None)
    projects.append(project)
result = {'format_version': 1, 'projects': projects}
a.output.parent.mkdir(parents=True, exist_ok=True)
a.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'Created {a.output} with {len(projects)} projects. Upload ZIP files before publishing this manifest.')
