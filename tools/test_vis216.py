#!/usr/bin/env python3
"""Horizon 2.16 UX/regression tests with a fake Tauri bridge; NO native game execution."""
from pathlib import Path
from shutil import which
from playwright.sync_api import sync_playwright
import re
p=Path(__file__).resolve().parent.parent
fx=re.sub(r'^export\s+', '', (p/'web/effects.js').read_text(), flags=re.M)
ui=re.sub(r'^import\s+.*?\s+from\s+["\']\./effects\.js["\'];','',(p/'web/app.js').read_text(),count=1,flags=re.M)
instance={"name":"Horizon test","project_id":"__personal__","engine":"horizon","version":"26.3","loader":"horizon","horizon_build_dir":"","game_dir":"","ram_mb":4096,"installed":False,"java_path":""}
managed=[
    {'tag':'nightly-2026-11-10-abcdef0','build_dir':'/vis/horizon-builds/ok','integrity':'verified','detail':'Archivos intactos'},
    {'tag':'nightly-2026-11-09-abcdef0','build_dir':'/vis/horizon-builds/bad','integrity':'modified','detail':'Se detectó una modificación'},
    {'tag':'<img src=x onerror=alert(1)>','build_dir':'/vis/horizon-builds/legacy','integrity':'legacy','detail':'<script>alert(1)</script>'},
]
with sync_playwright() as playwright:
    browser=playwright.chromium.launch(headless=True,executable_path=which('chromium') or which('google-chrome'))
    for width in (880,1366):
        page=browser.new_page(viewport={'width':width,'height':860})
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.on('dialog',lambda prompt:prompt.accept())
        page.set_content('<html><body><div id="app"></div><div id="toast-region"></div></body></html>')
        page.evaluate('''() => {window.__testCalls=[];window.__TAURI__={core:{invoke:async(name,args)=>{
          window.__testCalls.push({name,args});
          if(name==='get_state')return {user:{username:'test',role:'user',presence:'online'},projects:[],instances:[],friends:[],incoming_requests:[],outgoing_requests:[],messages:[],branding:{name:'VIS Nexo'},project_execution:{},mode:'local'};
          if(name==='horizon_local_builds')return ['/home/test/external-build'];
          if(name==='horizon_installed_builds')return window.__mockBuilds;
          if(name==='check_app_update')return {available:false};
          if(name==='fetch_cloud_catalog')return {projects:[]};
          return [];
        }},event:{listen:async()=>()=>{}},dialog:{open:async()=>null}};}''')
        page.evaluate('(builds) => window.__mockBuilds=builds', managed)
        for f in ('styles.css','visual-v2.1.css','motion-v2.2.css','project-v2.3.css','minecraft-v2.4.css','vslauncher-v2.5.css','vslauncher-v2.6.css','vis-nexo-v2.7.css','vis-nexo-v2.8.css','vis-nexo-v2.9.css','vis-nexo-v2.10.css','vis-nexo-v2.12.css','vis-nexo-v2.13.css','vis-nexo-v2.14.css','vis-nexo-v2.15.css','vis-nexo-v2.16.css'):
            page.add_style_tag(content=(p/'web'/f).read_text())
        page.add_script_tag(content=fx);page.add_script_tag(content=ui)
        page.wait_for_function("db.user?.username==='test'")
        page.evaluate('(inst)=>{db.instances=[inst];libraryMode="user";dialog={type:"instance",data:inst};render();}',instance)
        assert page.locator('#vis-horizon-library').is_hidden()
        page.locator('#horizon-build-dir').fill('/some/custom/value')
        page.locator('[data-action="detect-horizon-build"]').click()
        page.wait_for_function('document.querySelectorAll(".vis-horizon-build").length===4')
        assert page.locator('#horizon-build-dir').input_value()=='/some/custom/value', 'Loading library should not destroy form edits'
        assert page.locator('#vis-horizon-library img').count()==0, 'Untrusted release title injected HTML'
        assert page.locator('#vis-horizon-library script').count()==0, 'Untrusted release description injected HTML'
        assert page.locator('.vis-horizon-build.is-unsafe button').is_disabled()
        page.locator('[data-action="select-horizon-build"][data-index="0"]').click()
        assert page.locator('#horizon-build-dir').input_value()=='/vis/horizon-builds/ok'
        page.locator('[data-action="select-horizon-build"][data-index="2"]').click()
        assert page.locator('#horizon-build-dir').input_value()=='/vis/horizon-builds/legacy'
        assert len(page.evaluate('[...document.querySelectorAll(".vis-horizon-build")].map(x=>x.textContent)'))==4
        assert not errors, errors
        print(f'OK v2.16 UI {width}px: library, integrity flags, legacy confirmation, safe HTML and unsaved form data')
        page.close()
    browser.close()
