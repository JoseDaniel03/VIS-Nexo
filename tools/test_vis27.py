"""VIS Nexo v2.7 Chromium UI smoke test; not a Rust/Tauri functional test."""
from pathlib import Path
from shutil import which
import re
from playwright.sync_api import sync_playwright
WEB=Path(__file__).resolve().parent.parent/'web'
fx=re.sub(r'^export\s+', '', (WEB/'effects.js').read_text(), flags=re.M)
app=re.sub(r'^import\s+.*?\s+from\s+["\']\./effects\.js["\'];', '', (WEB/'app.js').read_text(), count=1, flags=re.M)
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path=which('chromium') or which('google-chrome'))
    for width,height in [(880,600),(1366,768)]:
        page=browser.new_page(viewport={'width':width,'height':height},reduced_motion='reduce')
        page.set_default_timeout(7000)
        errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.set_content('<html><head><meta charset="utf-8"/></head><body><div id="app"></div><div id="toast-region"></div></body></html>')
        for sheet in ['styles.css','visual-v2.1.css','motion-v2.2.css','project-v2.3.css','minecraft-v2.4.css','vslauncher-v2.5.css','vslauncher-v2.6.css','vis-nexo-v2.7.css']:
            page.add_style_tag(content=(WEB/sheet).read_text())
        page.add_script_tag(content=fx)
        page.add_script_tag(content=app)
        page.locator('[data-action="switch-auth"]').click()
        page.locator('#auth-name').fill('visadmin')
        page.locator('#auth-password').fill('password123')
        page.locator('#auth-repeat').fill('password123')
        page.locator('.auth-submit').click()
        page.locator('.top-actions .social-toggle').wait_for()
        social=page.locator('.top-actions .social-toggle')
        assert social.is_visible(), f'El botón VIS Portals no es visible a {width}px'
        before=social.get_attribute('aria-pressed')
        social.click(); page.wait_for_timeout(500)
        assert social.get_attribute('aria-pressed') != before
        (social if before=='true' else page.locator('.social-top [data-action="toggle-social"]')).click(); page.wait_for_timeout(500)
        assert social.get_attribute('aria-pressed') == before
        page.locator('.top-actions [data-action="go-settings"]').click()
        page.locator('[data-action="go-maintenance"]').click()
        page.locator('.vis-maintenance').wait_for()
        assert 'VIS Maintenance' in page.locator('h1').inner_text()
        assert page.locator('.maintenance-area').count()==4
        assert page.locator('[data-action="maintenance-clean"]').is_disabled()
        assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
        if width==1366:
            page.screenshot(path=str(WEB.parent/'preview-vis-maintenance-v2.7.png'),full_page=True)
        assert not errors,errors
        print(f'OK VIS Nexo v2.7 {width}x{height}: Portals siempre visible, Maintenance, aviso seguro, responsive')
        page.close()
    browser.close()
