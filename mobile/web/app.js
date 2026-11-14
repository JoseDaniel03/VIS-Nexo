/* VIS Nexo Mobile Preview — native Rust bridge only.
   No credential, session token, MFA ticket or encrypted message is stored in JS.
   The Android preview does NOT launch Java/Horizon. */
'use strict';
const mount=document.getElementById('root');
const notify=document.getElementById('notifications');
const invoke=window.__TAURI__?.core?.invoke;
const state={
  auth:{signed_in:false,mfa_required:false,username:null},
  view:'home',form:'login',busy:false,network:null,
  social:null,projects:null,account:null,community:null,communityId:null
};
const escapeHtml=text=>String(text??'').replace(/[&<>"']/g,ch=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[ch]));
const symbol={home:'◈',friends:'♧',projects:'▦',account:'◇'};
const E=value=>escapeHtml(value);
function toast(text,error=false){
  notify.textContent=String(text).slice(0,250);
  notify.className=error?'error':'';
}
async function command(name,args={}){
  if(!invoke)throw Error('Puente nativo Tauri no disponible. Instalá la APK, no abras este HTML en Chrome.');
  return invoke(name,args);
}
function header(){
  return '<header class="top"><div class="brand-mark">V<span>N</span></div>'+
    '<div class="brand-text"><strong>VIS NEXO</strong><small>ANDROID PREVIEW / CEIBO</small></div>'+
    '<div class="server-dot '+(state.network?.reachable?'online':'')+'" aria-label="Conexión"></div></header>';
}
function footer(){
  const active=state.view;
  return '<nav class="bottom-nav" aria-label="Secciones">'+
    Object.entries({home:'Inicio',friends:'Amigos',projects:'Universo',account:'Cuenta'}).map(([key,label])=>
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
    '<div class="security-note">◈ Identidad y tokens protegidos por Rust · HTTPS hacia Cloudflare</div>'+
    '<div class="preview-note">Versión móvil de conexión. Minecraft Java y Rust Edition todavía no se ejecutan en Android.</div>'+
  '</section>';
}
function statusArea(){
  const reachable=state.network?.reachable;
  const schema=state.network?.schema;
  return '<div class="health-card"><div><strong>VIS SERVICES</strong><span>'+
    (state.network===null?'Sin comprobar':reachable?'Conexión HTTPS establecida':'Sin conexión')+
    '</span></div><div class="pill '+(reachable?'success':'')+'">'+
    (reachable?'CONECTADO':'PENDIENTE')+'</div></div>'+
    (reachable?'<p class="muted" role="note">D1 schema informado: '+E(schema)+
      '. El acceso con MFA necesita que Ceibo Recovery esté desplegado en el servidor.</p>':'');
}
function home(){
  return '<div class="section-label">VIS / CONTROL CENTER</div>'+
   '<h1>Tu universo,<br><em>en movimiento.</em></h1>'+
   '<p class="intro">La conexión de tu identidad, proyectos y amigos desde Android.</p>'+
   statusArea()+
   '<div class="section-title"><span>Acceso rápido</span></div>'+
   '<div class="tiles"><button data-action="tab" data-tab="friends"><b>♧</b><strong>VIS Portals</strong><small>Amigos y estados</small></button>'+
   '<button data-action="tab" data-tab="projects"><b>▦</b><strong>VIS Universe</strong><small>Proyectos vinculados</small></button></div>'+
   '<div class="locked-feature"><div class="lock-icon">▣</div><div><strong>Minecraft Rust / Java</strong>'+
   '<p>Preparado para el futuro port Android. La ejecución e instalación están deshabilitadas en esta preview.</p></div><span class="tag">PRÓXIMAMENTE</span></div>'+
   '<button class="outline full" data-action="refresh">Comprobar conexión con VIS</button>';
}
function friends(){
  const data=state.social;
  const list=Array.isArray(data?.friends)?data.friends:[];
  const requests=Array.isArray(data?.incoming_requests)?data.incoming_requests:[];
  return '<div class="section-label">VIS / PORTALS</div><h1>Amigos</h1>'+
    '<p class="intro">Presencia sincronizada con VIS Social. Los chats cifrados E2EE no se descifran en esta preview.</p>'+
    '<button class="outline full" data-action="refresh">Actualizar presencia</button>'+
    '<div class="section-title"><span>Contactos</span><small>'+list.length+' vinculados</small></div>'+
    (list.length?'<div class="friends">'+list.map(f=>
      '<div class="friend"><div class="avatar">'+E((f.display_name||f.username||'?').slice(0,1).toUpperCase())+'</div>'+
      '<div><strong>'+E(f.alias||f.display_name||f.public_handle||f.username)+'</strong>'+
      '<small>@'+E(f.public_handle||f.username)+'</small>'+
      (f.current_game?'<small class="activity">Jugando: '+E(f.current_game)+'</small>':'')+
      '</div><span class="presence '+(f.presence==='online'?'online':'')+'"></span></div>').join('')+'</div>':
      '<div class="empty">No hay contactos sincronizados todavía.</div>')+
    (requests.length?'<div class="section-title">Invitaciones recibidas</div>'+
       '<div class="empty">'+requests.map(E).join(' · ')+'</div>':'');
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
     '<button type="button" data-action="community" data-id="'+E(p.id)+'" aria-label="Ver comunidad del proyecto">Ver miembros</button></article>'
    ).join('')+'</div>':'<div class="empty">Todavía no hay proyectos disponibles.</div>')+
    (state.community?'<section class="community"><div class="section-title">Comunidad del proyecto</div>'+
      '<pre>'+E(JSON.stringify(state.community,null,2).slice(0,3600))+'</pre></section>':'');
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
    '<button class="outline full" data-action="refresh">Actualizar perfil</button>'+
    '<button class="danger full" data-action="logout">Cerrar sesión VIS Ceibo</button>';
}
function screen(){
  if(!mount)return;
  if(!state.auth.signed_in){
    mount.innerHTML=header()+authPanel();
  }else{
    mount.innerHTML=header()+'<main class="content">'+({
      home, friends, projects, account
    }[state.view]||home)()+'</main>'+footer();
  }
}
async function refreshAll(){
  if(state.busy)return;
  state.busy=true;
  try{
    state.network=await command('mobile_health').catch(()=>({reachable:false}));
    if(state.auth.signed_in){
      const values=await Promise.allSettled([
        command('mobile_read',{kind:'account'}),
        command('mobile_read',{kind:'social'}),
        command('mobile_read',{kind:'projects'})
      ]);
      const keys=['account','social','projects'];
      values.forEach((v,i)=>{
        if(v.status==='fulfilled')state[keys[i]]=v.value;
      });
      if(values.every(v=>v.status==='rejected'))toast('No se pudieron consultar los servicios VIS',true);
      else toast('Conexión y datos de VIS actualizados');
    }else toast(state.network.reachable?'VIS Ceibo respondió por HTTPS':'Servidor VIS Ceibo no disponible',!state.network.reachable);
  }catch(e){toast(String(e),true);}
  finally{state.busy=false;screen();}
}
async function performAuth(form){
  const fd=new FormData(form),step=form.dataset.step;
  const read=key=>String(fd.get(key)||'').trim();
  if(step==='login'){
    state.auth=await command('mobile_login',{identifier:read('identifier'),password:String(fd.get('password')||'')});
    if(state.auth.signed_in)await refreshAll();
  }else if(step==='register'){
    state.auth=await command('mobile_register',{
      username:read('identifier'),password:String(fd.get('password')||''),
      confirm:String(fd.get('confirm')||'')
    });
    if(state.auth.signed_in)await refreshAll();
  }else if(step==='mfa'){
    state.auth=await command('mobile_mfa',{code:read('code')});
    if(state.auth.signed_in)await refreshAll();
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
  if(e.target.id!=='auth-form')return;
  e.preventDefault();
  if(state.busy)return;
  state.busy=true;
  const button=e.target.querySelector('button[type=submit]');
  if(button)button.disabled=true;
  try{await performAuth(e.target);}
  catch(error){toast(error,true)}
  finally{state.busy=false;screen();}
});
document.addEventListener('click',async e=>{
  const button=e.target.closest('button[data-action]');
  if(!button||state.busy)return;
  const act=button.dataset.action;
  if(act==='tab'){
    state.view=button.dataset.tab||'home';state.community=null;screen();return;
  }
  if(act==='form-login'||act==='form-forgot'||act==='form-register'){
    state.form=act.slice(5);screen();return;
  }
  if(act==='cancel-mfa'){
    try{state.auth=await command('mobile_cancel_mfa');}
    catch(error){toast(error,true)}
    screen();return;
  }
  if(act==='refresh'){void refreshAll();return;}
  if(act==='logout'){
    state.busy=true;
    try{
      state.auth=await command('mobile_logout');
      state.social=null;state.projects=null;state.account=null;state.community=null;
      state.view='home';toast('Sesión cerrada.');
    }catch(error){toast(error,true)}
    finally{state.busy=false;screen();}
  }
  if(act==='community'){
    state.busy=true;
    try{state.community=await command('mobile_community',{projectId:button.dataset.id});
      toast('Comunidad sincronizada');}
    catch(error){toast(error,true)}
    finally{state.busy=false;screen();}
  }
});
(async()=>{
  try{state.auth=await command('mobile_status');}
  catch(error){toast(error,true)}
  screen();void refreshAll();
})();
