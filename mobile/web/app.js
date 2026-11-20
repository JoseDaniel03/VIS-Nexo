import {devicePanel} from './device.js';
import {refreshServices} from './service-refresh.js';
/* VIS Nexo Mobile Preview — native Rust bridge only.
   No credential, session token, MFA ticket or encrypted message is stored in JS.
   Android installs McRust from the verified shared PC/Android release. */
import { createMobileFeatures } from './features.js';
import { createDiagnosticDialog,redactDiagnostic } from './error-dialog.js';
'use strict';
const mount=document.getElementById('root');
const notify=document.getElementById('notifications');
const invoke=window.__TAURI__?.core?.invoke;
const state={
  auth:{signed_in:false,mfa_required:false,username:null},
  view:'home',form:'login',busy:false,network:null,device:null,
  social:null,projects:null,account:null,community:null,communityId:null,instances:null
};
const escapeHtml=text=>String(text??'').replace(/[&<>"']/g,ch=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[ch]));
const symbol={home:'◈',friends:'♧',projects:'▦',instances:'▣',account:'◇'};
const E=value=>escapeHtml(value);
const diagnostics=createDiagnosticDialog(document);
const features=createMobileFeatures({state,command,escape:E,toast,screen,refreshAll,reportError});
function toast(text,error=false,context=null){
  notify.textContent=(error?redactDiagnostic(text):String(text)).slice(0,250);
  notify.className=error?'error':'';
  if(error){
    const info={platform:'Android ARM64',system:context?.system||'VIS Nexo Android',
      stage:context?.stage||'Operación del launcher',
      error:String(text),code:context?.code||'',release:context?.release||''};
    const detail=document.createElement('button');
    detail.type='button';detail.className='vis-error-detail-button';
    detail.textContent='Ver y copiar diagnóstico';
    detail.addEventListener('click',()=>diagnostics.open(info));
    notify.append(detail);
    if(context?.automatic)diagnostics.open(info);
  }
}
function reportError(error,context={}){
  const text=String(error||'Error desconocido');
  toast(text,true,{...context,automatic:true});
}
async function command(name,args={}){
  if(!invoke)throw Error('Puente nativo Tauri no disponible. Instalá la APK, no abras este HTML en Chrome.');
  return invoke(name,args);
}
function header(){
  return '<header class="top"><img class="brand-mark section-mark" data-section="'+E(state.view)+'" src="./vis-nexo-mark.svg" alt="">'+
    '<div class="brand-text"><strong>VIS NEXO</strong><small>ANDROID PREVIEW / CEIBO</small></div>'+
    '<div class="server-dot '+(state.network?.ready?'online':'')+'" aria-label="Conexión"></div></header>';
}
function footer(){
  const active=state.view;
  return '<nav class="bottom-nav" aria-label="Secciones">'+
    Object.entries({home:'Inicio',friends:'Amigos',projects:'Universo',instances:'Mundos',account:'Cuenta'}).map(([key,label])=>
      '<button type="button" data-action="tab" data-tab="'+key+'" '+(active===key?'class="selected" aria-current="page"':'')+'><span>'+
        symbol[key]+'</span>'+label+'</button>').join('')+'</nav>';
}
function authPanel(){
  const step=state.auth.mfa_required?'mfa':state.form;
  const title={
    login:'Bienvenido a VIS',
    register:'Crear tu cuenta',
    mfa:'Verificá tu identidad',
    forgot:'Recuperar tu acceso',
    reset:'Nueva contraseña'
  }[step]||'VIS Ceibo';
  const sub={
    login:'Ingresá con tu cuenta VIS Ceibo. El launcher Android mantiene el acceso seguro en su proceso nativo.',
    register:'Creá tu perfil en la nube. Tus contraseñas no se envían en texto plano.',
    mfa:'La contraseña ya fue comprobada. Falta el código de tu aplicación de autenticación.',
    forgot:'Usá tu correo verificado o @usuario. No revelamos si existe la cuenta.',
    reset:'Ingresá el código recibido en tu correo verificado para cambiar la contraseña.'
  }[step];
  const input=(id,label,type='text',auto='off',extra='')=>
   '<label for="'+id+'">'+E(label)+'</label><input id="'+id+'" name="'+id+
   '" type="'+type+'" autocomplete="'+auto+'" '+extra+' required />';
  const body=step==='mfa'?
    input('code','Código de 6 dígitos o recuperación','text','one-time-code','maxlength="36" spellcheck="false"')+
    '<button class="primary" type="submit">Confirmar MFA</button>'+
    '<button class="link" type="button" data-action="cancel-mfa">Cancelar acceso</button>'
    :step==='forgot'?
    '<label for="kind">Recuperación</label><select id="kind" name="kind">'+
    '<option value="password">Olvidé mi contraseña</option><option value="username">Olvidé mi usuario</option></select>'+
    input('identity','Correo verificado o @usuario','text','username','maxlength="254"')+
    '<button class="primary" type="submit">Enviar instrucciones</button>'+
    '<button class="link" type="button" data-action="form-login">Volver al acceso</button>'
    :step==='reset'?
    input('code','Código recibido (43 caracteres)','text','off','minlength="43" maxlength="43"')+
    input('password','Contraseña nueva','password','new-password','minlength="10" maxlength="128"')+
    input('confirm','Repetir contraseña','password','new-password','minlength="10" maxlength="128"')+
    '<label for="recovery_code">Código MFA de emergencia (si corresponde)</label>'+
    '<input id="recovery_code" name="recovery_code" autocomplete="off" maxlength="36"/>'+
    '<button class="primary" type="submit">Restablecer contraseña</button>'+
    '<button class="link" type="button" data-action="form-login">Volver</button>'
    :'<div class="field-row">'+
      input('identifier',step==='register'?'Nombre de usuario':'@usuario o ID pública','text','username','minlength="3" maxlength="24"')+
      input('password','Contraseña VIS','password',step==='register'?'new-password':'current-password','minlength="10" maxlength="128"')+
      (step==='register'?input('confirm','Confirmar contraseña','password','new-password','minlength="10" maxlength="128"'):'')+'</div>'+
      '<label><input type="checkbox" name="remember"> Mantener mi sesión iniciada en este teléfono</label>'+
      '<button class="primary" type="submit">'+(step==='register'?'Crear cuenta VIS':'Entrar a VIS Nexo')+'</button>'+
      '<div class="form-links">'+
        '<button type="button" class="link" data-action="'+(step==='register'?'form-login':'form-register')+'">'+
          (step==='register'?'Tengo una cuenta':'Crear cuenta')+'</button>'+
        (step==='login'?'<button type="button" class="link" data-action="form-forgot">Recuperar cuenta</button>':'')+
      '</div>';
  return '<section class="auth-content">'+
    '<div class="hero-label">IDENTIDAD / VIS CEIBO</div>'+
    '<h1>'+title+'</h1><p class="hint">'+sub+'</p>'+
    '<div class="form-card"><form id="auth-form" data-step="'+step+'">'+body+'</form></div>'+
    '<button type="button" data-action="device-settings">Permisos de Android</button><button type="button" data-action="device-updates">Ver versiones de Nexo</button>'+
    '<div class="security-note">◈ Identidad y tokens protegidos por Rust · HTTPS hacia Cloudflare</div>'+
    '<div class="preview-note">Minecraft Rust VIS Nexo 26.3 es el único motor Android. Nexo verifica y solicita la instalación de McRust al jugar.</div>'+
  '</section>';
}
function statusArea(){
  const reachable=state.network?.reachable;
  const schema=state.network?.schema;
  const ready=state.network?.ready===true;
  return '<div class="health-card"><div><strong>VIS SERVICES</strong><span>'+
    (state.network===null?'Sin comprobar':ready?'VIS Ceibo operativo':
      reachable?'Servidor conectado · requiere configuración':'Sin conexión HTTPS')+
    '</span></div><div class="pill '+(ready?'success':'')+'">'+
    (ready?'OPERATIVO':reachable?'MIGRACIÓN':'PENDIENTE')+'</div></div>'+
    (reachable?'<p class="muted" role="note">Cloudflare HTTP '+E(state.network.http_status)+
      ' · Esquema D1 '+E(schema)+
      (ready?' · Ceibo Recovery y MFA disponibles en el servidor.':
      ' · Revisá las migraciones D1 0012/0013 y configuración de Cloudflare.')+
      '</p>':'');
}
function home(){
  return '<div class="section-label">VIS / CONTROL CENTER</div>'+
   '<h1>Tu universo,<br><em>en movimiento.</em></h1>'+
   '<p class="intro">La conexión de tu identidad, proyectos y amigos desde Android.</p>'+
   statusArea()+
   '<div class="section-title"><span>Acceso rápido</span></div>'+
   '<div class="tiles"><button data-action="tab" data-tab="friends"><b>♧</b><strong>VIS Portals</strong><small>Amigos y estados</small></button>'+
   '<button data-action="tab" data-tab="projects"><b>▦</b><strong>VIS Universe</strong><small>Proyectos vinculados</small></button>'+
   '<button data-action="tab" data-tab="instances"><b>▣</b><strong>VIS Worlds</strong><small>Instancias para Android</small></button></div>'+
   '<div class="locked-feature"><div class="lock-icon">▣</div><div><strong>Minecraft Rust</strong>'+
   '<p>VIS Nexo Rust 26.3 · Vanilla. Creá tu instancia en Mundos y Nexo descargará McRust Android desde la misma versión compartida con PC.</p></div><span class="tag">ANDROID</span></div>'+
   '<button class="outline full" data-action="refresh">Comprobar conexión con VIS</button>';
}
function friends(){
  const data=state.social;
  const list=Array.isArray(data?.friends)?[...data.friends].sort((a,b)=>Number(b.presence==='online')-Number(a.presence==='online')||String(a.alias||a.display_name||a.username).localeCompare(String(b.alias||b.display_name||b.username))):[];
  const connected=state.network?.ready===true&&!!data;
  const labels={online:'Conectado',away:'Ausente',busy:'Ocupado',invisible:'Desconectado',offline:'Desconectado'};
  const requests=Array.isArray(data?.incoming_requests)?data.incoming_requests:[];
  return '<div class="section-label">VIS / PORTALS</div><h1>Amigos</h1>'+
    '<p class="intro">Tu comunidad, estés donde estés.</p>'+
    '<div class="portals-mobile-network '+(connected?'is-online':'is-offline')+'" role="status">'+E(connected?'Cuenta VIS conectada · @'+state.auth.username:state.network?.reachable?'Servicio VIS pendiente de actualización':'Sin conexión a VIS Social')+'</div>'+
    '<div class="portals-mobile-counts"><span><b>'+list.length+'</b> contactos</span><span><b>'+list.filter(f=>connected&&['online','away','busy'].includes(f.presence)).length+'</b> disponibles</span><span><b>'+requests.length+'</b> solicitudes</span></div>'+
    '<button class="outline full" data-action="refresh">Actualizar presencia</button>'+features.friendsPanel()+
    '<div class="section-title"><span>Contactos</span><small>'+list.length+' vinculados</small></div>'+
    (list.length?'<div class="friends">'+list.map(f=>
      '<div class="friend"><div class="avatar">'+E((f.display_name||f.username||'?').slice(0,1).toUpperCase())+'</div>'+
      '<div><strong>'+E(f.alias||f.display_name||f.public_handle||f.username)+'</strong>'+
      '<small>@'+E(f.public_handle||f.username)+'</small>'+
      '<small class="activity">'+E(labels[connected?f.presence:'offline']||'Desconectado')+'</small>'+
      (connected&&f.presence==='online'&&f.current_game?'<small class="activity">Jugando: '+E(f.current_game)+'</small>':'')+features.friendControls(f)+
      '</div><span class="presence '+(connected&&['online','away','busy'].includes(f.presence)?f.presence:'offline')+'"></span></div>').join('')+'</div>':
      '<div class="empty">No hay contactos sincronizados todavía.</div>')+
    '<p class="muted">Los mensajes cifrados entre dispositivos requieren sincronización segura de claves; no se muestran como disponibles en esta versión.</p>';
}
function projects(){
  const list=Array.isArray(state.projects?.projects)?state.projects.projects:[];
  return '<div class="section-label">VIS / UNIVERSE</div>'+
    '<h1>Proyectos</h1><p class="intro">Información de VIS Universe accesible desde tu cuenta.</p>'+
    '<button class="outline full" data-action="refresh">Actualizar catálogo</button>'+
    (list.length?'<div class="project-list">'+list.map(p=>
     '<article class="project"><div class="project-cover">◈</div><div>'+
     '<strong>'+E(p.title||p.id)+'</strong><p>'+E((p.summary||'Proyecto VIS').slice(0,160))+'</p>'+
     '<span class="tag">'+E(p.subscribed?'SEGUÍS ESTE PROYECTO':'DESCUBRIR')+'</span></div>'+
     '<button type="button" data-action="community" data-id="'+E(p.id)+'" aria-label="Ver comunidad del proyecto">Ver comunidad</button>'+features.projectControls(p)+'</article>'
    ).join('')+'</div>':'<div class="empty">Todavía no hay proyectos disponibles.</div>')+
    features.communityPanel()+features.adminPanel();
}
function account(){
  const a=state.account?.account||{};
  return '<div class="section-label">IDENTIDAD / VIS CEIBO</div><h1>Tu cuenta</h1>'+
    '<div class="profile-card"><div class="avatar big">'+E((a.display_name||state.auth.username||'V').slice(0,1).toUpperCase())+
    '</div><div><strong>'+E(a.display_name||state.auth.username)+'</strong>'+
    '<small>@'+E(a.public_handle||state.auth.username)+'</small></div></div>'+
    '<div class="detail-list">'+
    '<div><span>ID pública</span><strong>'+E(a.public_id||'—')+'</strong></div>'+
    '<div><span>Correo verificado</span><strong>'+E(a.verified_email||'Sin registrar')+'</strong></div>'+
    '<div><span>Rol</span><strong>'+E(a.role||'Usuario')+'</strong></div>'+
    '<div><span>Cloud</span><strong>Autenticación activa</strong></div></div>'+
    '<p class="muted">La sesión solo existe en la memoria nativa de esta app. Al reiniciarla, deberás autenticarte nuevamente.</p>'+
    features.accountPanel()+'<button class="outline full" data-action="refresh">Actualizar perfil</button>'+
    '<button class="danger full" data-action="logout">Cerrar sesión VIS Ceibo</button>';
}
function screen(){
  if(state.device && !state.device.prepared){mount.innerHTML=header()+'<main class="content">'+devicePanel(state.device)+'</main>';return;}
  if(!mount)return;
  if(!state.auth.signed_in){
    mount.innerHTML=header()+authPanel();
  }else{
    mount.innerHTML=header()+'<main class="content">'+({
      home, friends, projects, account:()=>devicePanel(state.device)+account(), instances:()=>features.instancePanel()
    }[state.view]||home)()+'</main>'+footer();
  }
}
async function refreshAll({notify:showNotification=false}={}){
  return refreshServices({state,command,render:screen,notify:toast,announce:showNotification});
}

async function performAuth(form){
  const fd=new FormData(form),step=form.dataset.step;
  const read=key=>String(fd.get(key)||'').trim();
  if(step==='login'){
    state.auth=await command('mobile_login',{identifier:read('identifier'),password:String(fd.get('password')||''),remember:fd.get('remember')==='on'});

  }else if(step==='register'){
    state.auth=await command('mobile_register',{
      username:read('identifier'),password:String(fd.get('password')||''),
      confirm:String(fd.get('confirm')||''),remember:fd.get('remember')==='on'
    });

  }else if(step==='mfa'){
    state.auth=await command('mobile_mfa',{code:read('code')});

  }else if(step==='forgot'){
    await command('mobile_recovery_start',{kind:read('kind'),identity:read('identity')});
    toast('Si la cuenta tiene correo verificado, recibirás instrucciones.');
    if(read('kind')==='password')state.form='reset';
  }else if(step==='reset'){
    await command('mobile_recovery_reset',{
      code:read('code'),password:String(fd.get('password')||''),
      confirm:String(fd.get('confirm')||''),recoveryCode:read('recovery_code')
    });
    state.form='login';toast('Contraseña actualizada. Iniciá sesión.');
  }
}
document.addEventListener('submit',async e=>{
  if(e.target.id!=='auth-form'){
    if(e.target.dataset.feature){
      e.preventDefault();await features.handleForm(e.target);
    }
    return;
  }
  e.preventDefault();
  if(state.busy)return;
  state.busy=true;
  const button=e.target.querySelector('button[type=submit]');
  if(button)button.disabled=true;
  try{await performAuth(e.target);}
  catch(error){toast(error,true)}
  finally{
    state.busy=false;screen();
    if(state.auth.signed_in)void refreshAll();
  }
});
document.addEventListener('click',async e=>{
  const button=e.target.closest('button[data-action]');
  if(!button||state.busy)return;
  if(await features.handleAction(button))return;
  const act=button.dataset.action;
  if(act==='tab'){
    state.view=button.dataset.tab||'home';state.community=null;screen();
    if(state.view==='account'){
      void features.refreshSecurity();
      void features.refreshCosmetics();
      void features.refreshMicrosoft();
    }
    if(state.view==='instances')void features.refreshInstances();
    return;
  }
  if(act==='form-login'||act==='form-forgot'||act==='form-register'){
    state.form=act.slice(5);screen();return;
  }
  if(act==='cancel-mfa'){
    try{state.auth=await command('mobile_cancel_mfa');}
    catch(error){toast(error,true)}
    screen();return;
  }
  if(act==='device-diagnostics'){
    button.disabled=true;
    try{
      const result=await command('mobile_device',{operation:'diagnostics'});
      diagnostics.open({platform:'Android ARM64',system:'VIS Nexo Rust',stage:'Último cierre del juego',error:result.report});
    }catch(error){toast(error,true)}
    finally{button.disabled=false;}
    return;
  }
  if(act?.startsWith('device-')){
    try{await command('mobile_device',{operation:act.slice(7)});state.device=await command('mobile_device',{operation:'status'});screen();}
    catch(error){toast(error,true)}
    return;
  }
  if(act==='refresh'){void refreshAll({notify:true});return;}
  if(act==='logout'){
    state.busy=true;
    try{
      state.auth=await command('mobile_logout');
      state.social=null;state.projects=null;state.account=null;state.community=null;state.instances=null;
      features.clear();
      state.view='home';toast('Sesión cerrada.');
    }catch(error){toast(error,true)}
    finally{state.busy=false;screen();}
  }
  if(act==='community'){
    state.busy=true;
    try{
      state.communityId=button.dataset.id;
      state.community=await command('mobile_community',{projectId:button.dataset.id});
      toast('Comunidad sincronizada');}
    catch(error){toast(error,true)}
    finally{state.busy=false;screen();}
  }
});
document.addEventListener('change',e=>{
  if(e.target?.dataset?.featureFile)void features.handleFile(e.target);
});
(async()=>{
  try{state.device=await command('mobile_device',{operation:'status'});screen();state.auth=await command('mobile_restore');if(state.auth.signed_in)void command('mobile_ms_restore').then(()=>features.refreshMicrosoft()).catch(error=>toast(error,true));}
  catch(error){toast(error,true)}
  screen();void refreshAll();
})();


let checkingExit=false;
async function checkGameExit(){
  const key='vis.mcrust.launchTime';
  const started=Number(localStorage.getItem(key));
  if(document.hidden||checkingExit||!started)return;
  checkingExit=true;
  try{
    const {report}=await command('mobile_device',{operation:'diagnostics'});
    // The published engine already includes this line on Android 11+.
    const exit=/Android exit reason: (\d+); status: -?\d+; time: (\d+)/.exec(report);
    const failure=/^Startup failure: (\d+)$/m.exec(report);
    const startupFailed=Boolean(failure && Number(failure[1])>=started);
    if(document.hidden || Number(localStorage.getItem(key))!==started)return;
    if(!startupFailed && (!exit || Number(exit[2])<started))return;
    localStorage.removeItem(key);
    if(startupFailed || [2,3,4,5,6,7,9].includes(Number(exit[1]))){
      diagnostics.open({platform:'Android ARM64',system:'VIS McRust',stage:'Cierre del juego',error:report});
    }
  }catch{/* Keep the launch timestamp for retry and manual diagnostics. */}
  finally{checkingExit=false;}
}
let exitRetry;
function scheduleExitCheck(){
  clearTimeout(exitRetry);
  if(document.hidden || !localStorage.getItem('vis.mcrust.launchTime'))return;
  void checkGameExit();
  exitRetry=setTimeout(checkGameExit,1800);
}
window.addEventListener('vis-game-started',scheduleExitCheck);
window.addEventListener('focus',scheduleExitCheck);
scheduleExitCheck();

document.addEventListener('visibilitychange',()=>{
  if(!document.hidden)scheduleExitCheck();
  if(document.hidden)return;
  void command('mobile_device',{operation:'status'}).then(device=>{
    const changed=device.prepared!==state.device?.prepared||device.installer_allowed!==state.device?.installer_allowed;
    state.device=device;
    if(changed&&(!device.prepared||(state.auth.signed_in&&state.view==='account')))screen();
  }).catch(()=>{});
});
