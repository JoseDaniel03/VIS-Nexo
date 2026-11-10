#!/usr/bin/env python3
"""VIS 2.13 UI smoke tests; not a native Rust compilation or gameplay test."""
from pathlib import Path
from shutil import which
import re
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parent.parent
web=root/'web'
fx=re.sub(r'^export\s+', '', (web/'effects.js').read_text(), flags=re.M)
app=re.sub(r'^import\s+.*?\s+from\s+["\']\./effects\.js["\'];','',(web/'app.js').read_text(),count=1,flags=re.M)
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path=which('chromium') or which('google-chrome'))
    for width in (880,1366):
        page=browser.new_page(viewport={'width':width,'height':860},reduced_motion='reduce')
        errors=[]
        page.on('pageerror',lambda ex:errors.append(str(ex)))
        page.set_content('<html><body><div id="app"></div><div id="toast-region"></div></body></html>')
        for css in ('styles.css','visual-v2.1.css','motion-v2.2.css','project-v2.3.css','minecraft-v2.4.css','vslauncher-v2.5.css','vslauncher-v2.6.css','vis-nexo-v2.7.css','vis-nexo-v2.8.css','vis-nexo-v2.9.css','vis-nexo-v2.10.css','vis-nexo-v2.12.css','vis-nexo-v2.13.css'):
            page.add_style_tag(content=(web/css).read_text())
        page.add_script_tag(content=fx)
        page.add_script_tag(content=app)
        page.locator('[data-action="switch-auth"]').click()
        page.locator('#auth-name').fill('adminvis')
        page.locator('#auth-password').fill('password123')
        page.locator('#auth-repeat').fill('password123')
        page.locator('.auth-submit').click()
        page.evaluate('''() => {
          db.instances=[{name:'Prueba',project_id:'__personal__',version:'1.21.1',game_dir:'',ram_mb:4096,fullscreen:false,installed:true,loader:'vanilla',loader_version:'',engine:'java',share_offline:false,java_path:'',player_name:'',source_owner:''}];
          libraryMode='user';page='instances';dialog={type:'instance',data:clone(db.instances[0])};render();
        }''')
        assert page.locator('#mc-instance-engine').input_value()=='java'
        assert page.locator('#vis-horizon-fields').is_hidden()
        assert page.locator('[name="share_offline"]').count()==0
        page.locator('#mc-instance-engine').select_option('horizon')
        assert page.locator('#vis-horizon-fields').is_visible()
        assert page.locator('#mc-instance-version').input_value()=='26.3'
        assert page.locator('#mc-instance-loader').input_value()=='horizon'
        assert page.locator('#mc-instance-version').get_attribute('readonly') is not None
        page.locator('#mc-instance-engine').select_option('java')
        assert page.locator('#vis-horizon-fields').is_hidden()
        page.evaluate('''() => {
          db.mode='offline';db.user={username:'invitado',role:'user',presence:'offline'};
          db.instances=[{name:'Compartida',project_id:'__personal__',version:'1.21.1',game_dir:'',ram_mb:4096,fullscreen:false,installed:true,loader:'vanilla',engine:'java',share_offline:true,source_owner:'propietario'}];
          dialog=null;page='instances';render();
        }''')
        assert 'Instalada por propietario' in page.locator('.instance-card').inner_text()
        assert page.locator('[data-action="edit-instance"]').count()==0
        assert page.locator('[data-action="launch-minecraft"]').count()==1
        assert not errors, errors
        print(f'OK VIS 2.13 Chromium {width}px: Horizon engine editor, version lock, offline shared-instance view')
        page.close()
    browser.close()
