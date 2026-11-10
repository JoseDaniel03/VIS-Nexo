#!/usr/bin/env python3
"""VIS Nexo 2.10 frontend regression tests. Does NOT launch native Minecraft."""
from pathlib import Path
from shutil import which
import re
from playwright.sync_api import sync_playwright

WEB = Path(__file__).resolve().parent.parent / 'web'
fx = re.sub(r'^export\s+', '', (WEB / 'effects.js').read_text(), flags=re.M)
app = re.sub(r'^import\s+.*?\s+from\s+["\']\./effects\.js["\'];', '', (WEB / 'app.js').read_text(), count=1, flags=re.M)
styles = ['styles.css', 'visual-v2.1.css', 'motion-v2.2.css', 'project-v2.3.css',
          'minecraft-v2.4.css', 'vslauncher-v2.5.css', 'vslauncher-v2.6.css',
          'vis-nexo-v2.7.css', 'vis-nexo-v2.8.css', 'vis-nexo-v2.9.css', 'vis-nexo-v2.10.css']
with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, executable_path=which('chromium') or which('google-chrome'))
    for width in [880, 1366]:
        page = browser.new_page(viewport={'width':width, 'height':820}, reduced_motion='reduce')
        errs=[]; page.on('pageerror', lambda err: errs.append(str(err)))
        page.set_content('<html><head><meta charset="utf-8"/></head><body><div id="app"></div><div id="toast-region"></div></body></html>')
        for sheet in styles: page.add_style_tag(content=(WEB/sheet).read_text())
        page.add_script_tag(content=fx)
        page.add_script_tag(content=app)
        page.locator('[data-action="switch-auth"]').click()
        page.locator('#auth-name').fill('visadmin')
        page.locator('#auth-password').fill('password123')
        page.locator('#auth-repeat').fill('password123')
        page.locator('.auth-submit').click()
        page.evaluate('''() => {
          libraryMode='user';page='instances';
          db.instances=[{name:'Original',project_id:'__personal__',version:'26.3',game_dir:'/custom/game',
            ram_mb:2048,fullscreen:false,installed:true,loader:'fabric',loader_version:'0.18.4',
            java_path:'',player_name:'',source_owner:''}];
          minecraftVersions=[...Array.from({length:280},(_,i)=>({id:`1.${i}.0`,kind:'release'})),
              ...Array.from({length:100},(_,i)=>({id:`snapshot-${i}`,kind:'snapshot'}))];
          render();
        }''')
        page.locator('[data-action="duplicate-instance"]').click()
        state=page.evaluate('''() => ({instances:db.instances,dialog:dialog?.data})''')
        assert len(state['instances'])==2, state
        copy=next(i for i in state['instances'] if i['name']=='Original - copia')
        assert copy['installed'] is False and copy['game_dir']==''
        assert state['dialog']['name']==copy['name']
        assert page.locator('#mc-version-catalog option').count() <= 100
        ver=page.locator('#mc-instance-version')
        ver.fill('1.8')
        assert page.locator('#mc-version-catalog option').count() > 0
        assert page.locator('#mc-version-catalog option').count() <= 100
        page.locator('#mc-version-channel').select_option('snapshot')
        assert page.locator('#mc-version-catalog option').count()==0
        ver.fill('snapshot-')
        assert page.locator('#mc-version-catalog option').count()==60 or page.locator('#mc-version-catalog option').count()==100
        page.locator('[data-action="close-modal"]').first.click()
        page.wait_for_timeout(120)
        page.evaluate('''() => {
          chatWith='friend';socialVisible=true;page='instances';
          db.messages=Array.from({length:305},(_,i)=>({from:i%2?'friend':'visadmin',to:i%2?'visadmin':'friend',
            body:'Mensaje '+i,created:'2026-11-10'}));render();
        }''')
        assert page.locator('.bubble').count()==100, 'chat should render the last 100 only'
        assert page.locator('.chat-load-older').count()==1
        page.locator('[data-action="chat-load-older"]').click()
        assert page.locator('.bubble').count()==200
        assert not errs,errs
        assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
        print(f'OK VIS 2.10 Chromium {width}px: duplicate, catalog filtering, bounded chat DOM, responsive')
        page.close()
    browser.close()
