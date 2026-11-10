#!/usr/bin/env python3
"""UI mock test; it does not download a game or execute any native binary."""
from pathlib import Path
from shutil import which
import re
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parent.parent
web=root/'web'
fx=re.sub(r'^export\s+', '', (web/'effects.js').read_text(), flags=re.M)
app=re.sub(r'^import\s+.*?\s+from\s+["\']\./effects\.js["\'];','',(web/'app.js').read_text(),count=1,flags=re.M)
instance={"name":"Prueba Horizon","project_id":"__personal__","engine":"horizon","version":"26.3","loader":"horizon","horizon_build_dir":"","game_dir":"","ram_mb":4096,"installed":False,"java_path":""}

def setup(page):
    page.set_content('<html><body><div id="app"></div><div id="toast-region"></div></body></html>')
    for f in ('styles.css','visual-v2.1.css','motion-v2.2.css','project-v2.3.css','minecraft-v2.4.css','vslauncher-v2.5.css','vslauncher-v2.6.css','vis-nexo-v2.7.css','vis-nexo-v2.8.css','vis-nexo-v2.9.css','vis-nexo-v2.10.css','vis-nexo-v2.12.css','vis-nexo-v2.13.css','vis-nexo-v2.14.css','vis-nexo-v2.15.css'):
        page.add_style_tag(content=(web/f).read_text())
    page.add_script_tag(content=fx)
    page.add_script_tag(content=app)

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=which('chromium') or which('google-chrome'))
    for width in (880,1366):
        page=browser.new_page(viewport={'width':width,'height':860})
        errors=[];events=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.on('dialog',lambda d:d.accept())
        page.evaluate('''() => {window.__testCalls=[];window.__TAURI__={core:{invoke:async (name,args)=>{
          window.__testCalls.push({name,args});
          if(name==='get_state')return {user:{username:'test',role:'user',presence:'online'},projects:[],instances:[],friends:[],incoming_requests:[],outgoing_requests:[],messages:[],branding:{name:'VIS Nexo'},project_execution:{},mode:'local'};
          if(name==='horizon_latest_release')return {tag:'nightly-2026-11-10-abcdef1',archive:'horizon-linux-x86_64.tar.gz',size:45000000,published:'2026-11-10'};
          if(name==='horizon_install_release')return {tag:'nightly-2026-11-10-abcdef1',build_dir:'/vis/horizon-builds/nightly-2026-11-10-abcdef1',archive_sha256:'abc'};
          if(name==='check_app_update')return {available:false};
          if(name==='fetch_cloud_catalog')return {projects:[]};
          return [];
        }},event:{listen:async()=>()=>{}},dialog:{open:async()=>null}};}''')
        setup(page)
        page.wait_for_function("db.user?.username==='test'")
        page.evaluate('''(i)=>{db.instances=[i];libraryMode='user';dialog={type:'instance',data:i};render();}''',instance)
        assert page.locator('[data-action="install-horizon-game"]').count()==1
        page.locator('[data-action="install-horizon-game"]').click()
        page.wait_for_function("document.getElementById('horizon-build-dir')?.value.includes('nightly-2026-11-10-abcdef1')")
        calls=page.evaluate('window.__testCalls')
        assert any(c['name']=='horizon_install_release' and c['args']=={'expectedTag':'nightly-2026-11-10-abcdef1'} for c in calls)
        assert page.locator('#horizon-build-dir').input_value()=='/vis/horizon-builds/nightly-2026-11-10-abcdef1'
        assert not errors, errors
        print(f'OK v2.15 UI {width}px: firmado/pinned, carpeta asignada y selector intacto')
        page.close()
    browser.close()
