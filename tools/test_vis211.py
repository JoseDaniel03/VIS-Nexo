#!/usr/bin/env python3
"""VIS v2.11: frontend test; does not imply a native Rust/MC runtime test."""
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
  page=browser.new_page(viewport={'width':width,'height':820},reduced_motion='reduce')
  errors=[];page.on('pageerror',lambda ex:errors.append(str(ex)))
  page.set_content('<html><body><div id="app"></div><div id="toast-region"></div></body></html>')
  for css in ('styles.css','visual-v2.1.css','motion-v2.2.css','project-v2.3.css','minecraft-v2.4.css','vslauncher-v2.5.css','vslauncher-v2.6.css','vis-nexo-v2.7.css','vis-nexo-v2.8.css','vis-nexo-v2.9.css','vis-nexo-v2.10.css'):
   page.add_style_tag(content=(web/css).read_text())
  page.add_script_tag(content=fx);page.add_script_tag(content=app)
  page.locator('[data-action="switch-auth"]').click()
  page.locator('#auth-name').fill('adminvis');page.locator('#auth-password').fill('password123');page.locator('#auth-repeat').fill('password123');page.locator('.auth-submit').click()
  page.evaluate('''() => {
   db.instances=[{name:'Pruebas',project_id:'__personal__',version:'26.3',game_dir:'',ram_mb:4096,fullscreen:false,installed:true,loader:'fabric',loader_version:'0.18.4',java_path:'',player_name:'',source_owner:''}];
   libraryMode='user';mcSelected={projectId:'__personal__',name:'Pruebas'};
   installedFiles=[{file:'fabric-api.jar',kind:'mod',bytes:200000,enabled:true},{file:'sodium.jar.disabled',kind:'mod',bytes:123,enabled:false}];
   page='minecraft';render();
  }''')
  buttons=page.locator('[data-action="toggle-instance-file"]')
  assert buttons.count()==2
  assert 'Desactivar' in buttons.nth(0).get_attribute('aria-label')
  assert 'Activar' in buttons.nth(1).get_attribute('aria-label')
  assert page.locator('.mc-file-entry').count()==2
  assert not errors,errors
  assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
  print(f'OK VIS 2.11 Chromium {width}px: mods enable/disable UI, no JS errors, responsive')
  page.close()
 browser.close()
