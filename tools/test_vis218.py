#!/usr/bin/env python3
"""Chromium-only Horizon source selection test (backend mocked, no native build)."""
from pathlib import Path
from shutil import which
from playwright.sync_api import sync_playwright
import re
p=Path(__file__).resolve().parent.parent
fx=re.sub(r'^export\s+', '',(p/'web/effects.js').read_text(),flags=re.M)
ui=re.sub(r'^import\s+.*?\s+from\s+["\']\./effects\.js["\'];','',(p/'web/app.js').read_text(),count=1,flags=re.M)
instance={'name':'Horizon source','project_id':'__personal__','engine':'horizon','version':'26.3','loader':'horizon','horizon_build_dir':'','game_dir':'','ram_mb':4096,'installed':False,'java_path':''}
with sync_playwright() as playwright:
    browser=playwright.chromium.launch(headless=True,executable_path=which('chromium') or which('google-chrome'))
    for width in (880,1366):
        page=browser.new_page(viewport={'width':width,'height':860});errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.set_content('<html><body><div id="app"></div><div id="toast-region"></div></body></html>')
        page.evaluate('''() => {window.calls=[];window.__TAURI__={core:{invoke:async(name,args)=>{
            window.calls.push(name);
            if(name==='get_state')return {user:{username:'VIS STUDIOS',role:'admin',presence:'online'},projects:[],instances:[],friends:[],incoming_requests:[],outgoing_requests:[],messages:[],branding:{name:'VIS Nexo'},project_execution:{},mode:'local'};
            if(name==='horizon_source_build')return '/usr/lib/vis-nexo/horizon';
            if(name==='check_app_update')return {available:false};
            if(name==='fetch_cloud_catalog')return {projects:[]};
            return [];
        }},event:{listen:async()=>()=>{}},dialog:{open:async()=>null}};}''')
        page.add_script_tag(content=fx);page.add_script_tag(content=ui)
        page.wait_for_function("db.user?.username==='VIS STUDIOS'")
        page.evaluate('(inst)=>{db.instances=[inst];libraryMode="user";dialog={type:"instance",data:inst};render();}',instance)
        assert page.locator('#horizon-build-dir').input_value()=='vis:source'
        assert page.locator('[data-action="install-horizon-game"]').count()==0, 'Old Nightly download UI should be hidden'
        page.locator('summary').filter(has_text='Opciones avanzadas de Horizon').click()
        page.locator('#horizon-build-dir').fill('/custom/older-build')
        page.locator('[data-action="use-horizon-source"]').first.click()
        page.wait_for_function("window.calls.includes('horizon_source_build')")
        assert page.locator('#horizon-build-dir').input_value()=='vis:source'
        page.evaluate("async()=>{db.instances[0].installed=true; await performLaunch('__personal__','Horizon source');}")
        assert page.evaluate("window.calls.includes('launch_horizon')")
        page.evaluate("""() => {
            window.requests=[];
            const original=window.__TAURI__.core.invoke;
            window.__TAURI__.core.invoke=async(name,args)=>{
                window.requests.push({name,args});
                if(name==='save_instance')return {...db,instances:[{...args.instance}]};
                if(name==='install_minecraft')return {...db,instances:db.instances.map(i=>({...i,installed:true}))};
                if(name==='launch_horizon')return {pid:123,log_file:'/tmp/test.log',offline:true};
                return original(name,args);
            };
            window.__TAURI__.dialog.open=async()=>'/tmp/vis-chosen-game';
            dialog={type:'instance',data:{}};render();
        }""")
        page.locator('[name="name"]').fill('Rust desde VIS')
        page.locator('#mc-instance-engine').select_option('horizon')
        assert page.locator('#mc-instance-version').input_value()=='26.3'
        page.locator('[data-action="pick-folder"]').click()
        page.locator('[data-action="submit-install-instance"]').click()
        page.wait_for_function("window.requests.some(x=>x.name==='launch_horizon')")
        requests=page.evaluate('window.requests')
        saved=next(x['args']['instance'] for x in requests if x['name']=='save_instance')
        assert saved['engine']=='horizon' and saved['game_dir']=='/tmp/vis-chosen-game'
        assert saved['loader']=='horizon' and saved['version']=='26.3'
        assert [x['name'] for x in requests if x['name'] in ('save_instance','install_minecraft','launch_horizon')]==['save_instance','install_minecraft','launch_horizon']
        assert next(x['args'] for x in requests if x['name']=='launch_horizon')['sessionFile']==''
        assert not errors,errors
        print(f'OK VIS v2.18 Chromium {width}: bundled source is default, no Nightly downloader, selection works')
        page.close()
    browser.close()
