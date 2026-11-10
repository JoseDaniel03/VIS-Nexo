"""Offline browser tests for friends/chat, settings, motion and visibility policy.
The injected Rust bridge is a test double, not evidence of remote chat service.
"""
from pathlib import Path
from shutil import which
import re
from playwright.sync_api import sync_playwright
WEB=Path(__file__).resolve().parent.parent/'web'
fx=re.sub(r'^export\s+','',(WEB/'effects.js').read_text(),flags=re.M)
app=re.sub(r'^import\s+.*?\s+from\s+["\']\./effects\.js["\'];','',(WEB/'app.js').read_text(),count=1,flags=re.M)
init="""
window.testState = {user:{username:'tester',role:'user',presence:'online',avatar:'',skin:''},projects:[],instances:[],
 friends:[{username:'amigo',presence:'online'}],incoming_requests:[],outgoing_requests:[],messages:[],
 branding:{name:'VSLauncher',launcher_logo:'',home_image:'',login_image:''},mode:'local'};
window.__TAURI__={core:{invoke:async(name,args={})=>{
 if(name==='get_state')return structuredClone(window.testState);
 if(name==='update_presence'){window.testState.user.presence=args.presence;return structuredClone(window.testState);}
 if(name==='send_message'){window.testState.messages.push({from:'tester',to:args.to,body:args.body});return structuredClone(window.testState);}
 throw new Error('Test bridge: '+name);
}}};
"""
with sync_playwright() as playwright:
  browser=playwright.chromium.launch(headless=True,executable_path=which('chromium') or which('google-chrome'))
  page=browser.new_page(viewport={'width':1366,'height':768})
  page.set_default_timeout(7000)
  errors=[]
  page.on('pageerror',lambda e: errors.append(str(e)))
  page.set_content('<html><head><meta charset="utf-8"></head><body><div id="app"></div><div id="toast-region"></div></body></html>')
  for f in ['styles.css','visual-v2.1.css','motion-v2.2.css']:page.add_style_tag(content=(WEB/f).read_text())
  page.add_script_tag(content=init)
  page.add_script_tag(content=fx)
  page.add_script_tag(content=app)
  page.locator('.social-tabs').wait_for()
  page.locator('[data-action="social-projects"]').click()
  assert page.locator('[data-action="social-projects"]').get_attribute('class')=='active'
  page.locator('[data-action="social-global"]').click()
  page.locator('[data-action="open-chat"][data-id="amigo"]').click()
  assert page.locator('.chat-drawer').count()==1
  assert page.locator('.chat-send input').evaluate('(e)=>document.activeElement===e')
  page.locator('.chat-send input').fill('Probando animaciones de mensajes')
  page.locator('.chat-send button').click()
  assert page.locator('.chat-messages .bubble').count()==1
  assert 'Probando animaciones' in page.locator('.chat-messages .bubble').inner_text()
  page.locator('[data-action="close-chat"]').click()
  page.locator('.chat-drawer').wait_for(state='detached')
  page.locator('#social-presence').select_option('away')
  assert page.locator('#social-presence').input_value()=='away'
  page.locator('[data-action="go-settings"]').first.click()
  page.locator('#reduced-motion').wait_for()
  page.locator('#reduced-motion').check()
  assert page.evaluate('document.body.classList.contains("reduce-motion")')
  page.locator('#reduced-motion').uncheck()
  assert not page.evaluate('document.body.classList.contains("reduce-motion")')
  assert not errors, errors
  print('OK Social Global/Proyectos, presencia, abrir/cerrar chat, enviar mensaje local simulado, Configuración, movimiento reducido')
  page.close();browser.close()
