"""Browser interaction smoke tests for v2.5, not a substitute for Tauri/Rust compilation."""
from pathlib import Path
from shutil import which
from io import BytesIO
import re
from PIL import Image
from playwright.sync_api import sync_playwright
WEB=Path(__file__).resolve().parent.parent/'web'
fx=re.sub(r'^export\s+','',(WEB/'effects.js').read_text(),flags=re.M)
app=re.sub(r'^import\s+.*?\s+from\s+["\']\./effects\.js["\'];','',(WEB/'app.js').read_text(),count=1,flags=re.M)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path=which('chromium'))
 for width,height in [(1024,768),(1366,768)]:
  page=browser.new_page(viewport={'width':width,'height':height},reduced_motion='reduce')
  page.set_default_timeout(5000)
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.set_content('<html><head><meta charset="utf-8"></head><body><div id="app"></div><div id="toast-region"></div></body></html>')
  for f in ['styles.css','visual-v2.1.css','motion-v2.2.css','project-v2.3.css','minecraft-v2.4.css','vslauncher-v2.5.css']:
   page.add_style_tag(content=(WEB/f).read_text())
  page.add_script_tag(content=fx);page.add_script_tag(content=app)
  # empty offline nickname with no accounts, no installation and no persistent profile
  page.locator('[data-action=auth-offline]').click()
  assert page.get_by_text('Entrá sin cuenta').count()==1
  page.locator('#auth-name').fill('Guest123')
  page.locator('button.auth-submit').click()
  page.locator('.project-sidebar').wait_for()
  assert page.evaluate('db.mode')=='offline'
  page.locator('[data-action=go-instances]').first.click()
  assert page.locator('[data-action="open-instance"]').is_disabled()
  page.locator('[data-action=go-profile]').first.click()
  page.locator('[data-action=logout]').first.click()
  # create account & project
  page.locator('[data-action="switch-auth"]').click()
  page.locator('#auth-name').fill('admin');page.locator('#auth-password').fill('password123');page.locator('#auth-repeat').fill('password123')
  page.locator('.auth-submit').click();page.locator('.side-add').wait_for()
  page.locator('[data-action=create-project]').first.click()
  page.locator('input[data-field=title]').fill('Virgoland')
  page.locator('input[data-field=mc_version]').fill('26.3')
  page.locator('[data-action=wizard-next]').click()
  # import image, remove association, title fallback
  im=Image.new('RGB',(640,360),'#8844cc');out=BytesIO();im.save(out,format='PNG')
  with page.expect_file_chooser() as cho:page.locator('[data-action=pick-asset][data-kind=logo]').click()
  cho.value.set_files({'name':'logo.png','mimeType':'image/png','buffer':out.getvalue()})
  page.locator('[data-action=remove-project-image][data-field=logo_path]').click()
  assert page.evaluate('wizard.logo_path')==''
  page.locator('[data-action=wizard-next]').click()
  page.locator('[data-visible=news]').uncheck()
  page.locator('[data-visible=calendar]').uncheck()
  page.locator('[data-visible=notes]').uncheck()
  if width==1366: page.screenshot(path=str(WEB.parent/'preview-visibilidad-v2.5.png'),full_page=True)
  page.locator('[data-action=wizard-next]').click();page.locator('[data-action=save-project]').click()
  page.locator('.project-wordmark h1').wait_for()
  assert page.locator('.feed-tabs [data-id=news]').count()==0
  assert page.locator('.feed-tabs [data-id=calendar]').count()==0
  assert page.locator('.project-details').count()==0
  # profile avatar import is STAGED: only committed by cropping
  page.locator('[data-action=go-profile]').first.click()
  page.locator('[data-action=edit-avatar]').first.click()
  with page.expect_file_chooser() as cho:page.locator('.avatar-modal [data-action=import-avatar]').click()
  cho.value.set_files({'name':'foto.png','mimeType':'image/png','buffer':out.getvalue()})
  page.locator('#crop-canvas').wait_for()
  assert page.evaluate('db.user.avatar')==''
  page.locator('[data-action=save-crop]').click()
  assert page.evaluate('db.user.avatar').startswith('preview/crop-avatar-')
  # recent-login shortcut never authenticates by itself
  page.locator('.avatar-modal [data-action=close-modal]').first.click()
  with page.expect_file_chooser() as cho:page.locator('[data-action=import-profile-banner]').click()
  cho.value.set_files({'name':'banner.png','mimeType':'image/png','buffer':out.getvalue()})
  page.locator('#crop-canvas').wait_for()
  assert page.evaluate('db.user.profile_banner')==''
  page.locator('[data-action=save-crop]').click()
  assert page.evaluate('db.user.profile_banner').startswith('preview/crop-profile_banner-')
  if width==1366: page.screenshot(path=str(WEB.parent/'preview-perfil-v2.5.png'),full_page=True)
  page.locator('[data-action=clear-profile-asset][data-kind=profile_banner]').click()
  assert page.evaluate('db.user.profile_banner')==''
  page.locator('[data-action=logout]').first.click()
  assert page.locator('.recent-account').count()==1
  page.locator('.recent-account').first.click()
  assert page.locator('#auth-name').input_value()=='admin'
  assert page.evaluate('db.user') is None
  if width==1366: page.screenshot(path=str(WEB.parent/'preview-acceso-v2.5.png'),full_page=True)
  assert not errors,errors
  assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
  print(f'OK v2.5 {width}x{height}: offline temporal, quitar logo, ocultar secciones, recorte previo, acceso rápido')
  page.close()
 browser.close()
