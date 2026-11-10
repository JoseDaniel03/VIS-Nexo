"""Browser smoke test of real frontend source, injected as classic scripts for offline testing.
Actual ES-module loading, WebKitGTK and Rust/Tauri are not validated here.
"""
from pathlib import Path
from shutil import which
import re
from playwright.sync_api import sync_playwright

WEB=Path(__file__).resolve().parent.parent/'web'
fx=re.sub(r'^export\s+', '', (WEB/'effects.js').read_text(), flags=re.M)
app=re.sub(r'^import\s+.*?\s+from\s+[\"\']\./effects\.js[\"\'];', '', (WEB/'app.js').read_text(), count=1, flags=re.M)
with sync_playwright() as playwright:
    browser=playwright.chromium.launch(headless=True,executable_path=which('chromium') or which('google-chrome'))
    for width,height in [(880,600),(1024,768),(1366,768),(1920,1080)]:
        page=browser.new_page(viewport={'width':width,'height':height})
        page.set_default_timeout(7000)
        errors=[]
        page.on('pageerror',lambda error: errors.append(str(error)))
        page.set_content('<html><head><meta charset=\"utf-8\"></head><body><div id=\"app\"></div><div id=\"toast-region\"></div></body></html>')
        for style in ['styles.css','visual-v2.1.css','motion-v2.2.css']:
            page.add_style_tag(content=(WEB/style).read_text())
        page.add_script_tag(content=fx)
        page.add_script_tag(content=app)
        assert page.locator('h1').inner_text()=='Iniciá sesión'
        assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
        page.get_by_role('button',name='Registrate').click()
        assert page.locator('h1').inner_text()=='Creá tu cuenta'
        page.locator('#auth-name').fill('admin')
        page.locator('#auth-password').fill('password123')
        page.locator('#auth-repeat').fill('password123')
        page.locator('.auth-submit').click()
        page.locator('.side-add').wait_for()
        assert page.locator('.social-tabs button').count()==2
        assert page.locator('.portal-feature').count()==1
        page.locator('.side-add').click()
        assert page.locator('.wizard-live-preview').count()==1
        page.locator('input[data-field="title"]').fill('Virgoland Test')
        assert page.locator('[data-live-title]').inner_text()=='Virgoland Test'
        page.locator('input[data-field="versions_csv"]').fill('26.3, Optimizado')
        page.locator('input[data-field="installable"]').check(force=True)
        for _ in range(3):
            page.locator('[data-action="wizard-next"]').click()
        page.locator('[data-action="save-project"]').click()
        page.locator('.project-wordmark').wait_for()
        page.locator('[data-action="open-instance"]').first.click()
        page.locator('input[name="name"]').fill('Principal')
        page.locator('input[name="version"]').fill('1.21.4')
        page.locator('[data-action="submit-instance"]').click()
        page.locator('[data-action="go-instances"]').first.click()
        page.locator('.instance-card').wait_for()
        page.locator('[data-action="go-profile"]').first.click()
        page.locator('[data-action="edit-avatar"]').first.click()
        page.locator('[data-action="preset-avatar"][data-id="nebula"]').click()
        assert page.locator('.avatar-preset-option.active').count()==1
        page.locator('[data-action="close-modal"]').first.click()
        assert page.locator('.profile-portrait .avatar').count()==1
        page.locator('[data-action="go-settings"]').first.click()
        page.locator('#reduced-motion').check(force=True)
        assert page.locator('#reduced-motion').is_checked()
        page.locator('#reduced-motion').uncheck(force=True)
        assert page.locator('#reduced-motion').is_checked()==False
        assert '.feed-tabs button::after' in (WEB/'motion-v2.2.css').read_text()
        assert not errors,errors
        assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
        print(f'OK {width}x{height}: acceso, proyectos, modales, instancias, avatar, ajustes, responsive, JS')
        page.close()
    browser.close()
