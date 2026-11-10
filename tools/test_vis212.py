#!/usr/bin/env python3
"""Visual smoke tests for portable instance actions and download dock."""
from pathlib import Path
import re
from shutil import which
from playwright.sync_api import sync_playwright
web=Path(__file__).resolve().parent.parent/'web'
fx=re.sub(r'^export\s+', '', (web/'effects.js').read_text(), flags=re.M)
app=re.sub(r'^import\s+.*?\s+from\s+["\']\./effects\.js["\'];','',(web/'app.js').read_text(),count=1,flags=re.M)
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path=which('chromium') or which('google-chrome'))
    for width in (880,1366):
        page=browser.new_page(viewport={'width':width,'height':860},reduced_motion='reduce')
        errors=[]
        page.on('pageerror',lambda ex:errors.append(str(ex)))
        page.set_content('<html><body><div id="app"></div><div id="toast-region"></div></body></html>')
        for css in ('styles.css','visual-v2.1.css','motion-v2.2.css','project-v2.3.css','minecraft-v2.4.css','vslauncher-v2.5.css','vslauncher-v2.6.css','vis-nexo-v2.7.css','vis-nexo-v2.8.css','vis-nexo-v2.9.css','vis-nexo-v2.10.css','vis-nexo-v2.12.css'):
            page.add_style_tag(content=(web/css).read_text())
        page.add_script_tag(content=fx)
        page.add_script_tag(content=app)
        page.locator('[data-action="switch-auth"]').click()
        page.locator('#auth-name').fill('adminvis');page.locator('#auth-password').fill('password123');page.locator('#auth-repeat').fill('password123');page.locator('.auth-submit').click()
        page.evaluate('''() => {
          db.instances=[{name:'MiInstancia',project_id:'__personal__',version:'1.21.1',game_dir:'/tmp/MC1',ram_mb:4096,fullscreen:false,installed:true,loader:'fabric',loader_version:'0.16.9',java_path:'',player_name:'',source_owner:''}];
          libraryMode='user';page='instances';minecraftBusy=true;
          installProgress={stage:'libraries',completed:12,total:20,detail:'Copia local verificada · foo.jar'};
          render();
        }''')
        assert page.locator('[data-action="import-worlds-instance"]').count()==1
        assert page.locator('[data-action="export-worlds-instance"]').count()==1
        assert page.locator('#vis-download-dock').count()==1
        assert '60%' in page.locator('#vis-download-percent').inner_text()
        assert 'Copia local' in page.locator('#vis-download-detail').inner_text()
        page.evaluate('''() => {installProgress={stage:'assets',completed:9,total:10,detail:'Descargado · asset'};updateDownloadDock();}''')
        assert page.locator('#vis-download-percent').inner_text()=='90%'
        assert 'Archivos de Minecraft' in page.locator('.vis-download-head').inner_text()
        assert not errors,errors
        assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
        print(f'OK VIS 2.12 Chromium {width}px: import/export actions, live progress dock, responsive')
        page.close()
    browser.close()
