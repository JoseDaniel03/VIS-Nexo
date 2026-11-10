"""VSLauncher v2.3: pruebas de las novedades en Chromium y backend simulado local.
No prueban Tauri compilado ni sincronización remota.
"""
from pathlib import Path
from shutil import which
from io import BytesIO
import re
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

WEB=Path(__file__).resolve().parent.parent/'web'
fx=re.sub(r'^export\s+','',(WEB/'effects.js').read_text(),flags=re.M)
app=re.sub(r'^import\s+.*?\s+from\s+["\']\./effects\.js["\'];','',(WEB/'app.js').read_text(),count=1,flags=re.M)
pic=Image.new('RGB',(1280,720),'#35305c')
draw=ImageDraw.Draw(pic)
draw.ellipse((490,190,790,490), fill='#a86ff0')
img=BytesIO();pic.save(img,format='PNG')

with sync_playwright() as playwright:
  browser=playwright.chromium.launch(headless=True,executable_path=which('chromium') or which('google-chrome'))
  for width,height in [(880,600),(1024,768),(1366,768),(1920,1080)]:
    page=browser.new_page(viewport={'width':width,'height':height})
    page.set_default_timeout(8000)
    errors=[]
    page.on('pageerror',lambda e: errors.append(str(e)))
    page.set_content('<html><head><meta charset="utf-8"></head><body><div id="app"></div><div id="toast-region"></div></body></html>')
    for f in ['styles.css','visual-v2.1.css','motion-v2.2.css','project-v2.3.css']:
      page.add_style_tag(content=(WEB/f).read_text())
    page.add_script_tag(content=fx)
    page.add_script_tag(content=app)
    page.get_by_role('button',name='Registrate').click()
    page.locator('#auth-name').fill('admin')
    page.locator('#auth-password').fill('password123')
    page.locator('#auth-repeat').fill('password123')
    page.locator('.auth-submit').click()
    page.locator('.side-add').click()
    page.locator('input[data-field="title"]').fill('Virgoland')
    page.locator('input[data-field="mc_version"]').fill('26.3')
    page.locator('[data-action="wizard-next"]').click()
    with page.expect_file_chooser() as info:
      page.locator('[data-action="pick-asset"][data-kind="banner"]').click()
    info.value.set_files({'name':'portada.png','mimeType':'image/png','buffer':img.getvalue()})
    crop=page.locator('[data-action="crop-asset"][data-kind="banner"]')
    crop.wait_for()
    crop.click()
    canvas=page.locator('#crop-canvas')
    canvas.wait_for()
    page.wait_for_function("document.querySelector('#crop-canvas')?.toDataURL('image/png')?.length > 5000")
    if width==1366:
      page.evaluate("document.querySelector('#toast-region').replaceChildren()")
      page.wait_for_timeout(300)
      page.screenshot(path=str(WEB.parent/'preview-recortador-v2.3.png'),full_page=True)
    page.locator('#crop-zoom').evaluate("e=>{e.value='1.5';e.dispatchEvent(new Event('input',{bubbles:true}));}")
    assert page.locator('#crop-zoom-value').inner_text()=='150%'
    bounds=canvas.bounding_box()
    page.mouse.move(bounds['x']+bounds['width']/2,bounds['y']+bounds['height']/2)
    page.mouse.down()
    page.mouse.move(bounds['x']+bounds['width']*.58,bounds['y']+bounds['height']*.54,steps=4)
    page.mouse.up()
    page.locator('[data-action="save-crop"]').click()
    crop.wait_for()
    page.locator('[data-action="wizard-next"]').click()
    page.locator('[data-action="wizard-next"]').click()
    page.locator('[data-action="save-project"]').click()
    page.locator('.project-wordmark').wait_for()
    assert page.locator('.cinematic-project-hero').count()==1
    assert page.evaluate('db.projects[0].banner_path')
    assert page.locator('.cinematic-project-hero').get_attribute('style') is not None
    assert page.locator('.project-admin-actions .admin-action').count()==5
    # Admin can post without entering full wizard
    page.locator('[data-action="quick-publish"][data-kind="news"]').click()
    page.locator('#quick-publish-form input[name="title"]').fill('Nueva versión')
    page.locator('#quick-publish-form textarea[name="body"]').fill('Pruebas de contenido')
    page.locator('#quick-publish-form button[type="submit"]').click()
    page.get_by_text('Nueva versión').first.wait_for()
    assert page.locator('.news-item').count()==1
    page.locator('[data-action="edit-publication"]').click()
    page.locator('#quick-publish-form input[name="title"]').fill('Nueva versión 2')
    page.locator('#quick-publish-form button[type="submit"]').click()
    assert 'Nueva versión 2' in page.locator('.news-item').inner_text()
    page.locator('[data-action="remove-publication"]').click()
    assert page.locator('.news-item').count()==0
    # Event creates item in calendar
    page.locator('[data-action="quick-publish"][data-kind="event"]').click()
    page.locator('#quick-publish-form input[name="title"]').fill('Torneo del domingo')
    page.locator('#quick-publish-form button[type="submit"]').click()
    assert page.locator('.feed-tabs .active').inner_text()=='Eventos'
    assert 'Torneo del domingo' in page.locator('.news-item').inner_text()
    page.locator('[data-action="quick-publish"][data-kind="patch"]').click()
    page.locator('#quick-publish-form input[name="title"]').fill('Parche 0.1')
    page.locator('#quick-publish-form button[type="submit"]').click()
    assert 'Parche 0.1' in page.locator('.news-item').inner_text()
    if width==1366:
      page.evaluate("document.querySelector('#toast-region').replaceChildren()")
      page.wait_for_timeout(450)
      page.screenshot(path=str(WEB.parent/'preview-proyecto-v2.3.png'),full_page=True)
      page.locator('[data-action="quick-publish"][data-kind="update"]').click()
      page.wait_for_timeout(360)
      page.screenshot(path=str(WEB.parent/'preview-publicar-v2.3.png'),full_page=True)
      page.locator('[data-action="close-modal"]').first.click()
    assert not errors,errors
    assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
    print(f'OK proyectos 2.3 {width}x{height}: importar, recortar, zoom/arrastre, publicar, editar, eliminar, evento, parche, responsive')
    page.close()
  browser.close()
