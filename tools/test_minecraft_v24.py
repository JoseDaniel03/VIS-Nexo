"""Browser tests for v2.4 interface and prototype-mode boundaries.
No native Tauri or remote Minecraft download is claimed by these tests.
"""
from pathlib import Path
from shutil import which
from playwright.sync_api import sync_playwright
import re
WEB=Path(__file__).resolve().parent.parent/'web'
js=re.sub(r'^import\s+.*?\s+from\s+["\']\./effects\.js["\'];','',(WEB/'app.js').read_text(),count=1,flags=re.M)
effects=re.sub(r'^export\s+','',(WEB/'effects.js').read_text(),flags=re.M)
with sync_playwright() as playwright:
  browser=playwright.chromium.launch(headless=True,executable_path=which('chromium') or which('google-chrome'))
  for width,height in [(880,600),(1024,768),(1366,768),(1920,1080)]:
    page=browser.new_page(viewport={'width':width,'height':height})
    errors=[]
    page.on('pageerror',lambda err:errors.append(str(err)))
    page.set_content('<html><head><meta charset="utf-8"></head><body><div id="app"></div><div id="toast-region"></div></body></html>')
    for f in ['styles.css','visual-v2.1.css','motion-v2.2.css','project-v2.3.css','minecraft-v2.4.css']:
      page.add_style_tag(content=(WEB/f).read_text())
    page.add_script_tag(content=effects)
    page.add_script_tag(content=js)
    page.get_by_role('button',name='Registrate').click()
    page.locator('#auth-name').fill('admin')
    page.locator('#auth-password').fill('abcdefgh123')
    page.locator('#auth-repeat').fill('abcdefgh123')
    page.locator('.auth-submit').click()
    assert page.locator('.side-add').count()==1
    assert page.evaluate('db.projects.length')==0
    page.locator('.side-add').click()
    page.locator('input[data-field="title"]').fill('Virgoland')
    page.locator('input[data-field="mc_version"]').fill('1.21.4')
    page.locator('input[data-field="installable"]').check()
    for _ in range(3):page.locator('[data-action="wizard-next"]').click()
    page.locator('[data-action="save-project"]').click()
    assert page.locator('.project-execution-control').count()==1
    page.locator('[data-action="toggle-project-execution"]').click()
    assert page.evaluate('db.project_execution["virgoland"]') is False
    assert page.locator('[data-action="open-instance"]').first.is_disabled()
    page.locator('[data-action="toggle-project-execution"]').click()
    assert page.evaluate('db.project_execution["virgoland"]') is True
    page.locator('[data-action="open-instance"]').first.click()
    form=page.locator('#instance-form')
    form.locator('input[name="name"]').fill('Fabric local')
    form.locator('input[name="version"]').fill('1.21.4')
    form.locator('select[name="loader"]').select_option('fabric')
    form.locator('input[name="loader_version"]').fill('0.18.4')
    page.locator('[data-action="submit-instance"]').click()
    assert page.evaluate('db.instances[0].loader')=='fabric'
    assert page.evaluate('db.instances[0].version')=='1.21.4'
    page.locator('[data-action="go-instances"]').first.click()
    page.locator('.instance-card').wait_for()
    assert page.locator('.instance-card').count()==1
    assert page.locator('.instance-card [data-action="launch-minecraft"]').is_disabled()
    page.locator('.instance-card [data-action="install-minecraft"]').click()
    assert page.locator('.instance-card [data-action="launch-minecraft"]').is_disabled()
    page.locator('.instance-card [data-action="manage-instance"]').click()
    page.locator('.mc-manager').wait_for()
    assert page.locator('.mc-manager').count()==1
    assert page.locator('#modrinth-search-form').count()==1
    assert page.locator('[data-action="import-instance-resource"]').count()==3
    page.locator('input[name="query"]').fill('sodium')
    page.locator('#modrinth-search-form button').click()
    assert page.locator('.toast.bad').count()>0
    assert not errors,errors
    assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
    if width==1366:
      page.evaluate("document.querySelector('#toast-region').replaceChildren()")
      page.wait_for_timeout(400)
      page.screenshot(path=str(WEB.parent/'preview-minecraft-v2.4.png'),full_page=True)
    print(f'OK Minecraft UI {width}x{height}: proyecto on/off, Fabric, instancia, navegación, mods, seguridad de preview')
    page.close()
  browser.close()
