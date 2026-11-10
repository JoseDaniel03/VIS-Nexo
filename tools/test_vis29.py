"""VIS Nexo 2.9: browser regression for a completed Minecraft process.
Mock UI only; not a replacement for native Minecraft launch testing.
"""
from pathlib import Path
from shutil import which
import re
from playwright.sync_api import sync_playwright
WEB=Path(__file__).resolve().parent.parent/'web'
fx=re.sub(r'^export\s+', '', (WEB/'effects.js').read_text(), flags=re.M)
app=re.sub(r'^import\s+.*?\s+from\s+["\']\./effects\.js["\'];', '', (WEB/'app.js').read_text(), count=1, flags=re.M)
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path=which('chromium') or which('google-chrome'))
    for width in [880,1366]:
        page=browser.new_page(viewport={'width':width,'height':820},reduced_motion='reduce')
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.set_content('<html><head><meta charset="utf-8"/></head><body><div id="app"></div><div id="toast-region"></div></body></html>')
        for name in ['styles.css','visual-v2.1.css','motion-v2.2.css','project-v2.3.css','minecraft-v2.4.css','vslauncher-v2.5.css','vslauncher-v2.6.css','vis-nexo-v2.7.css','vis-nexo-v2.8.css','vis-nexo-v2.9.css']:
            page.add_style_tag(content=(WEB/name).read_text())
        page.add_script_tag(content=fx);page.add_script_tag(content=app)
        page.locator('[data-action="switch-auth"]').click()
        page.locator('#auth-name').fill('visadmin')
        page.locator('#auth-password').fill('password123')
        page.locator('#auth-repeat').fill('password123')
        page.locator('.auth-submit').click()
        page.evaluate('''() => {
            lastMinecraftExit = {pid:5678,success:false,exit_code:1,log_file:'/example/<world>/latest.log',error:'fallo de java'};
            page='instances';render();
        }''')
        notice=page.locator('.vis-crash-notice')
        assert notice.count()==1
        assert notice.get_attribute('role')=='alert'
        assert '5678' in notice.inner_text()
        assert '<world>' in notice.inner_text()
        assert notice.locator('world').count()==0, 'unescaped log path injected HTML'
        page.locator('[data-action="dismiss-launch-diagnostic"]').click()
        assert page.locator('.vis-crash-notice').count()==0
        assert not errors,errors
        print(f'OK VIS v2.9 Chromium {width}px: crash notice, escaped log path, dismiss')
        page.close()
    browser.close()
