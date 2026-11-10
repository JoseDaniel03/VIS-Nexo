"""Publication tool test without network and without touching player data."""
import hashlib, json, pathlib, subprocess, sys, tempfile, zipfile
script=pathlib.Path(__file__).resolve().parent/'create_catalog.py'
with tempfile.TemporaryDirectory() as work:
    base=pathlib.Path(work)
    archive=base/'test-project.zip'
    with zipfile.ZipFile(archive,'w') as zipped:zipped.writestr('manifest.json','{"name":"Demo"}')
    spec={'projects':[{'id':'demo','name':'Demo','version':'1.2.3','archive_path':str(archive),
                      'bundle_url':'https://github.com/owner/repo/releases/download/demo-v1.2.3/demo.zip',
                      'minecraft_version':'26.3','loader':'vanilla'}]}
    spec_path=base/'spec.json';spec_path.write_text(json.dumps(spec))
    output=base/'catalog.json'
    subprocess.run([sys.executable,str(script),'--spec',str(spec_path),'--output',str(output)],check=True,capture_output=True)
    actual=json.loads(output.read_text())
    project=actual['projects'][0]
    assert actual['format_version']==1
    assert project['sha256']==hashlib.sha256(archive.read_bytes()).hexdigest()
    assert project['size_bytes']==archive.stat().st_size
    assert 'archive_path' not in project
    print('OK VIS Universe: catálogo generado, SHA-256 comprobado y ruta privada excluida')
