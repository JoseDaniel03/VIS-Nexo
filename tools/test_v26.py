"""Functional browser smoke tests for Virgoland/User mode; Chromium is NOT Tauri/WebKitGTK."""
from pathlib import Path
from shutil import which
import re
from playwright.sync_api import sync_playwright
WEB=Path(__file__).resolve().parent.parent/'web'
fx=re.sub(r'^export\s+', '', (WEB/'effects.js').read_text(), flags=re.M)
app=re.sub(r'^import\s+.*?\s+from\s+["\']\./effects\.js["\'];', '', (WEB/'app.js').read_text(), count=1, flags=re.M)
with sync_playwright() as pw:
 browser=pw.chromium.launch(headless=True,executable_path=which('chromium'))
 for width,height in [(880,600),(1024,768),(1366,768),(1920,1080)]:
  page=browser.new_page(viewport={'width':width,'height':height},reduced_motion='reduce')
  page.set_default_timeout(7500)
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.set_content('<html><head><meta charset="utf-8"/></head><body><div id="app"></div><div id="toast-region"></div></body></html>')
  for sheet in ['styles.css','visual-v2.1.css','motion-v2.2.css','project-v2.3.css','minecraft-v2.4.css','vslauncher-v2.5.css','vslauncher-v2.6.css']:
   page.add_style_tag(content=(WEB/sheet).read_text())
  page.add_script_tag(content=fx);page.add_script_tag(content=app)
  assert page.locator('button.auth-choice').count()==3
  ms=page.locator('button.auth-choice:has(.ms-icon)')
  assert ms.is_disabled()
  assert ms.inner_text().strip()=='Microsoft'
  assert page.evaluate('''() => {const a=document.querySelector('.ms-icon').getBoundingClientRect(),b=document.querySelector('button.auth-choice:has(.ms-icon) span:not(.ms-icon)').getBoundingClientRect();return a.right<=b.left+1}'''), 'Microsoft text overlaps icon'
  page.locator('[data-action="switch-auth"]').click()
  page.locator('#auth-name').fill('admin26')
  page.locator('#auth-password').fill('password123')
  page.locator('#auth-repeat').fill('password123')
  page.locator('.auth-submit').click()
  page.locator('.library-mode-switch').wait_for()
  assert page.locator('.library-mode-choice').count()==2
  assert page.locator('.side-section-label').inner_text()=='PROYECTOS'
  assert page.locator('.portal-feature').count()==1
  page.locator('[data-action="mode-user"]').click()
  assert page.locator('.side-section-label').inner_text()=='MIS JUEGOS'
  assert page.get_by_text('Todavía no creaste instancias personales').count()==1
  assert page.locator('[data-action="new-personal-instance"]').count()>=1
  page.locator('.user-library-hero [data-action="new-personal-instance"]').click()
  page.locator('input[name="name"]').fill('Mi Vanilla 1.21')
  page.locator('input[name="version"]').fill('1.21.4')
  assert page.locator('#instance-project').input_value()=='__personal__'
  page.locator('[data-action="submit-instance"]').click()
  page.locator('.user-library-page .instance-card').wait_for()
  assert page.evaluate("db.instances[0].project_id")=='__personal__'
  assert page.locator('.side-projects .side-project').count()==1
  assert page.locator('.instance-card [data-action="install-minecraft"]').is_enabled()
  if width==1366: page.screenshot(path=str(WEB.parent/'preview-modo-usuario-v2.6.png'),full_page=True)
  page.locator('[data-action="mode-vs"]').click()
  assert page.locator('.side-section-label').inner_text()=='PROYECTOS'
  assert page.locator('.side-projects .side-project').count()==0
  page.locator('[data-action="create-project"]').first.click()
  page.locator('input[data-field="title"]').fill('VS Pruebas')
  page.locator('input[data-field="mc_version"]').fill('1.21.4')
  page.locator('input[data-field="installable"]').check(force=True)
  for _ in range(3):page.locator('[data-action="wizard-next"]').click()
  page.locator('[data-action="save-project"]').click()
  page.locator('[data-action="go-home"]').click()
  assert page.locator('.side-projects .side-project').count()==1
  page.locator('[data-action="mode-user"]').click()
  assert page.locator('.side-projects .side-project').count()==1
  assert page.locator('.user-library-page .instance-card').count()==1
  page.locator('[data-action="go-instances"]').first.click()
  assert page.locator('.instance-card').count()==1
  assert page.locator('.instance-card .instance-notice').inner_text().find('Bloqueado por el administrador')==-1
  assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
  assert not errors,errors
  print(f'OK v2.6 {width}x{height}: dos modos, instancia personal sin catálogo, preservación VS, Microsoft, responsive')
  page.close()
 browser.close()
