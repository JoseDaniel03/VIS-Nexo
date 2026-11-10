#!/usr/bin/env python3
"""VIS v2.14 interactive tests. UI-only mocks, not a Cargo/native game test."""
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
    for css in ('styles.css','visual-v2.1.css','motion-v2.2.css','project-v2.3.css','minecraft-v2.4.css','vslauncher-v2.5.css','vslauncher-v2.6.css','vis-nexo-v2.7.css','vis-nexo-v2.8.css','vis-nexo-v2.9.css','vis-nexo-v2.10.css','vis-nexo-v2.12.css','vis-nexo-v2.13.css','vis-nexo-v2.14.css'):
        page.add_style_tag(content=(web/css).read_text())
    page.add_script_tag(content=fx)
    page.add_script_tag(content=app)

with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True, executable_path=which('chromium') or which('google-chrome'))
    for width in (880,1366):
        page=browser.new_page(viewport={'width':width,'height':860},reduced_motion='reduce')
        errors=[]
        page.on('pageerror', lambda e: errors.append(str(e)))
        setup(page)
        page.locator('[data-action="switch-auth"]').click()
        page.locator('#auth-name').fill('vishoriz')
        page.locator('#auth-password').fill('password123')
        page.locator('#auth-repeat').fill('password123')
        page.locator('.auth-submit').click()
        page.evaluate('''(instance) => {
            libraryMode='user';db.instances=[instance];mcSelected={projectId:'__personal__',name:instance.name};
            page='minecraft';horizonChecks=[{label:'JDK 25',status:'missing',detail:'<img src=x onerror=alert(1)>'},
              {label:'Build',status:'ok',detail:'Cliente compatible'}, {label:'Microsoft',status:'manual',detail:'Iniciar sesión'}];render();
        }''',instance)
        assert page.locator('.vis-horizon-diagnostic').count()==1
        assert page.locator('.vis-horizon-check-item').count()==3
        assert page.locator('.vis-horizon-check-list img').count()==0, 'XSS escape broken'
        assert '<img src=x onerror=alert(1)>' in page.locator('.vis-horizon-check-list').inner_text()
        assert page.locator('.mc-manager-grid').count()==0, 'Fabric mod controls must not appear on Horizon'
        page.evaluate('''(instance) => {dialog={type:'instance',data:instance};render();}''',instance)
        assert page.locator('[data-action="detect-horizon-build"]').count()==1
        assert page.locator('#vis-horizon-fields').is_visible()
        assert not errors, errors
        print(f'OK v2.14 UI {width}px: diagnóstico seguro, mods Java ocultos, detector disponible')
        page.close()

    # A native bridge stub checks that the detection action consumes the returned
    # path, without downloading or executing any Horizon binary.
    page=browser.new_page(viewport={'width':1366,'height':860},reduced_motion='reduce')
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.evaluate('''() => {window.__TAURI__={core:{invoke:async (name,args)=>{
      if(name==='get_state')return {user:{username:'vishoriz',role:'user',presence:'online'},projects:[],instances:[],friends:[],incoming_requests:[],outgoing_requests:[],messages:[],branding:{name:'VIS Nexo'},project_execution:{},mode:'local'};
      if(name==='horizon_local_builds')return ['/home/user/.local/share/horizon/releases/nightly'];
      if(name==='horizon_diagnostics')return [{label:'Build',status:'ok',detail:'Compatible'}, {label:'Microsoft',status:'manual',detail:'Requiere inicio de sesión'}];
      if(name==='check_app_update')return {enabled:false};
      if(name==='fetch_cloud_catalog')return {projects:[]};
      return [];
    }},event:{listen:async()=>()=>{}},dialog:{open:async()=>null}};}''')
    setup(page)
    page.wait_for_function("db.user?.username === 'vishoriz'")
    page.evaluate('''(instance)=>{db.instances=[instance];libraryMode='user';dialog={type:'instance',data:instance};render();}''',instance)
    page.on('dialog',lambda prompt:prompt.accept())
    page.locator('[data-action="detect-horizon-build"]').click()
    page.locator('[data-action="select-horizon-build"]').first.wait_for()
    page.locator('[data-action="select-horizon-build"]').first.click()
    page.wait_for_function("document.getElementById('horizon-build-dir')?.value.includes('nightly')")
    assert page.locator('#horizon-build-dir').input_value()=='/home/user/.local/share/horizon/releases/nightly'
    page.evaluate('''(instance)=>{dialog=null;page='minecraft';mcSelected={projectId:instance.project_id,name:instance.name};render();}''',instance)
    page.locator('[data-action="horizon-check"]').click()
    page.wait_for_function("document.querySelectorAll('.vis-horizon-check-item').length===2")
    assert not errors, errors
    print('OK v2.14 mock bridge: detector y diagnóstico recibidos, sin ejecutar Horizon')
    browser.close()
