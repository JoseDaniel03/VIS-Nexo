#!/usr/bin/env python3
"""VIS 2.17 project install/user sharing UX: mock only, NO Rust/Minecraft execution."""
from pathlib import Path
from shutil import which
import re
from playwright.sync_api import sync_playwright
base=Path(__file__).resolve().parent.parent
web=base/'web'
fx=re.sub(r'^export\s+', '', (web/'effects.js').read_text(), flags=re.M)
app=re.sub(r'^import\s+.*?\s+from\s+["\']\./effects\.js["\'];', '',(web/'app.js').read_text(),count=1,flags=re.M)
project={"id":"virgoland","title":"Virgoland","subtitle":"","description":"Servidor","versions":[],"page_scene_id":None,"mc_version":"26.3","engine":"java","loader":"vanilla","loader_version":"","banner_path":"","logo_path":"","icon_path":"","visible_sections":{},"notes":"","community_url":"","installable":True,"posts":[],"calendar":[]}
with sync_playwright() as p:
  b=p.chromium.launch(headless=True,executable_path=which('chromium') or which('google-chrome'))
  for width in (880,1366):
    page=b.new_page(viewport={'width':width,'height':840});errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('dialog',lambda d:d.accept())
    page.set_content('<html><body><div id="app"></div><div id="toast-region"></div></body></html>')
    page.evaluate('''(project) => {window.calls=[];window.__mockState={user:{username:'player',role:'user',presence:'online'},projects:[project],instances:[],friends:[],incoming_requests:[],outgoing_requests:[],messages:[],branding:{name:'VIS Nexo'},project_execution:{},mode:'local'};
    window.__TAURI__={core:{invoke:async(name,args)=>{
      window.calls.push({name,args});let db=window.__mockState;
      if(name==='get_state')return structuredClone(db);
      if(name==='ensure_project_instance'){
        let instance={name:'VIS '+args.projectId,project_id:args.projectId,game_dir:args.gameDir,ram_mb:args.ramMb,version:'26.3',engine:'java',loader:'vanilla',loader_version:'',installed:false};
        db.instances.push(instance);return structuredClone(db);
      }
      if(name==='install_minecraft'){db.instances[0].installed=true;return structuredClone(db);}
      if(name==='launch_minecraft')return {pid:42,log_file:'game.log',offline:true};
      if(name==='check_app_update')return {available:false};
      if(name==='fetch_cloud_catalog')return {projects:[]};
      return [];
    }},event:{listen:async()=>()=>{}},dialog:{open:async()=>'/tmp/VIS-Game-Dir'}}; }''',project)
    for f in ('styles.css','visual-v2.1.css','motion-v2.2.css','project-v2.3.css','minecraft-v2.4.css','vslauncher-v2.5.css','vslauncher-v2.6.css','vis-nexo-v2.7.css','vis-nexo-v2.8.css','vis-nexo-v2.9.css','vis-nexo-v2.10.css','vis-nexo-v2.12.css','vis-nexo-v2.13.css','vis-nexo-v2.14.css','vis-nexo-v2.15.css','vis-nexo-v2.16.css','vis-nexo-v2.17.css'):
      if (web/f).exists():page.add_style_tag(content=(web/f).read_text())
    page.add_script_tag(content=fx);page.add_script_tag(content=app)
    page.wait_for_function("db.user?.username==='player'")
    page.evaluate("selectedId='virgoland';page='project';render()")
    page.locator('[data-action="project-play"]').click()
    assert page.locator('#vis-project-install-form').is_visible()
    assert page.locator('#vis-project-install-form input').count()==2, 'Players must only edit folder and RAM'
    assert page.locator('#vis-project-install-form select').count()==0
    page.locator('[data-action="pick-project-folder"]').click()
    assert page.locator('#vis-project-install-folder').input_value()=='/tmp/VIS-Game-Dir'
    page.locator('#vis-project-install-form [name="ram_mb"]').fill('6144')
    page.locator('[data-action="confirm-project-install"]').click()
    page.wait_for_function("window.calls.some(c=>c.name==='launch_minecraft')")
    calls=page.evaluate('window.calls')
    assert [c['name'] for c in calls if c['name'] in ('ensure_project_instance','install_minecraft','launch_minecraft')]==['ensure_project_instance','install_minecraft','launch_minecraft'],calls
    assert next(c['args'] for c in calls if c['name']=='ensure_project_instance') == {'projectId':'virgoland','gameDir':'/tmp/VIS-Game-Dir','ramMb':6144}
    assert not errors,errors
    page.evaluate("db.instances.push({name:'Instancia de amigo',project_id:'__personal__',source_owner:'otro',installed:true,version:'26.3',engine:'java',loader:'vanilla',ram_mb:4096});page='instances';libraryMode='user';render()")
    page.locator('[data-action="shared-ram"]').click()
    assert page.locator('#shared-ram-form input[name="ram_mb"]').is_visible()
    assert page.locator('#shared-ram-form select').count()==0
    assert page.locator('[name="game_dir"]').count()==0
    page.locator('[data-action="close-modal"]').first.click()
    page.evaluate("db.instances=db.instances.filter(i=>!i.source_owner);page='project';selectedId='virgoland';render()")
    page.evaluate("db.user={username:'VIS STUDIOS',role:'admin',presence:'online'};startProject('virgoland');")
    assert page.locator('[data-field="engine"]').is_visible()
    assert page.locator('[data-field="loader"]').is_visible()
    assert not errors,errors
    print(f'OK VIS 2.17 Chromium {width}: admin specs, player folder+RAM, install/launch sequence')
    page.close()
  b.close()
