"""VIS Nexo 2.8 UI smoke checks. Browser-only tests, not a game launch."""
from pathlib import Path
from shutil import which
import re
from playwright.sync_api import sync_playwright
WEB=Path(__file__).resolve().parent.parent/'web'
fx=re.sub(r'^export\s+', '', (WEB/'effects.js').read_text(), flags=re.M)
app=re.sub(r'^import\s+.*?\s+from\s+["\']\./effects\.js["\'];', '', (WEB/'app.js').read_text(), count=1, flags=re.M)
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path=which('chromium') or which('google-chrome'))
    for width,height in [(880,620),(1366,820)]:
        page=browser.new_page(viewport={'width':width,'height':height},reduced_motion='reduce')
        errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.set_content('<html><head><meta charset="utf-8"/></head><body><div id="app"></div><div id="toast-region"></div></body></html>')
        for sheet in ['styles.css','visual-v2.1.css','motion-v2.2.css','project-v2.3.css','minecraft-v2.4.css','vslauncher-v2.5.css','vslauncher-v2.6.css','vis-nexo-v2.7.css','vis-nexo-v2.8.css']:
            page.add_style_tag(content=(WEB/sheet).read_text())
        page.add_script_tag(content=fx);page.add_script_tag(content=app)
        page.locator('[data-action="switch-auth"]').click()
        page.locator('#auth-name').fill('visadmin');page.locator('#auth-password').fill('password123');page.locator('#auth-repeat').fill('password123')
        page.locator('.auth-submit').click()
        page.locator('.top-actions [data-action="go-cloud"]').click()
        page.locator('.vis-cloud').wait_for()
        assert page.locator('.vis-cloud h1').inner_text()=='Proyectos en la nube'
        assert 'Virgoland' not in page.locator('#app').inner_text()
        page.locator('.top-actions .social-toggle').click()
        page.wait_for_timeout(450)
        assert page.locator('.top-actions .social-toggle').is_visible()
        # Close the overlay using its own close control at small desktop widths.
        if page.locator('.social-pane').is_visible():
            page.locator('.social-top [data-action="toggle-social"]').click()
            page.wait_for_timeout(420)
        page.locator('.top-actions [data-action="go-settings"]').click()
        assert page.locator('.update-card').count()==1
        assert page.locator('.cloud-settings').count()==1
        page.locator('.top-actions [data-action="go-cloud"]').click()
        if width==1366:
            page.screenshot(path=str(WEB.parent/'preview-vis-universe-v2.8.png'),full_page=True)
            page.locator('.top-actions .social-toggle').click()
            page.wait_for_timeout(420)
            page.screenshot(path=str(WEB.parent/'preview-vis-portals-v2.8.png'),full_page=True)
        assert not errors,errors
        assert not page.evaluate('document.documentElement.scrollWidth>innerWidth'),f'Horizontal overflow at {width}px'
        print(f'OK v2.8 Chromium UI {width}x{height}: Universe cloud, updater, brand, Portals')
        page.close()
    browser.close()
