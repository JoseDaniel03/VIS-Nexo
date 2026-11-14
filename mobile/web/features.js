// VIS Nexo Android — Portals, Universe and Ceibo account management.
// All authenticated requests go through the Rust allowlisted native bridge;
// WebView sees no bearer tokens. Server owns all role/permission decisions.
export function createMobileFeatures({state,command,escape,toast,screen,refreshAll}){
  const E=escape;
  const allowedAccount=/^[a-z0-9_]{3,24}$/;
  const button=(action,text,extra='')=>'<button type="button" class="outline" data-action="'+action+'" '+extra+'>'+text+'</button>';
  const safeAttr=value=>E(value);
  let uiBusy=false;
  let avatarPreview='';
  let skinPreview='';
  const security={mfa:null,sessions:null};
  const trustedDataImage=(raw,mime,max)=>{
    const prefix='data:'+mime+';base64,';
    return typeof raw==='string'&&raw.startsWith(prefix)&&raw.length<max
      &&/^[A-Za-z0-9+/]*={0,2}$/.test(raw.slice(prefix.length))?raw:'';
  };
  const selectable=(id,value,options)=>{
    return '<select id="'+id+'" name="'+id+'">'+options.map(([key,label])=>
      '<option value="'+E(key)+'"'+(key===value?' selected':'')+'>'+E(label)+'</option>').join('')+'</select>';
  };
  const formInput=(name,placeholder,type='text',max=160,other='')=>
    '<input aria-label="'+E(placeholder)+'" name="'+name+'" type="'+type+
    '" placeholder="'+E(placeholder)+'" maxlength="'+max+'" '+other+' required>';
  function friendControls(friend){
    return '<div class="friend-tools">'+
      button('friend-alias','Apodo','data-name="'+safeAttr(friend.username)+'"')+
      '<span class="tiny-note">'+E(friend.custom_status||'')+'</span></div>';
  }
  function friendsPanel(){
    const incoming=state.social?.incoming_requests||[];
    const outgoing=state.social?.outgoing_requests||[];
    const presence=state.social?.presence||'online';
    const custom=state.social?.custom_status||'';
    return '<section class="mobile-panel"><div class="section-title">Mi presencia</div>'+
      '<form data-feature="presence" class="inline-form">'+
      selectable('presence',presence,[['online','Conectado'],['away','Ausente'],['busy','Ocupado'],['invisible','Invisible'],['offline','Desconectado']])+
      '<input name="custom_status" maxlength="160" aria-label="Estado personalizado" placeholder="Estado personalizado" value="'+E(custom)+'">'+
      '<button class="primary" type="submit">Guardar estado</button></form></section>'+
      '<section class="mobile-panel"><div class="section-title">Agregar amigo</div>'+
      '<form data-feature="friend-request" class="inline-form">'+
      formInput('username','@usuario VIS', 'text',24,'autocomplete="off"')+
      '<button class="primary" type="submit">Enviar solicitud</button></form></section>'+
      (incoming.length?'<section class="mobile-panel"><div class="section-title">Solicitudes recibidas</div>'+
       incoming.map(name=>
       '<div class="small-row"><b>@'+E(name)+'</b>'+
       button('friend-accept','Aceptar','data-name="'+safeAttr(name)+'"')+
       '</div>').join('')+'</section>':'')+
      (outgoing.length?'<div class="muted">Pendientes enviadas: '+outgoing.map(x=>'@'+E(x)).join(' · ')+'</div>':'');
  }
  function projectControls(project){
    return '<div class="project-actions">'+
     button('project-sub',project.subscribed?'Dejar de seguir':'Seguir proyecto',
       'data-id="'+safeAttr(project.id)+'" data-active="'+(project.subscribed?'1':'0')+'"')+
     (project.staff_role?'<span class="tag">'+E(project.staff_role)+'</span>':'')+
     '</div>';
  }
  function communityPanel(){
    const c=state.community;
    if(!c)return '';
    const members=Array.isArray(c.members)?c.members:[];
    const media=Array.isArray(c.media)?c.media:[];
    const pending=Array.isArray(c.pending)?c.pending:[];
    const projectId=state.communityId||'';
    const safeLink=(url)=>{
      try{const parsed=new URL(url);return parsed.protocol==='https:'?parsed.href:null;}
      catch{return null;}
    };
    return '<section class="mobile-panel community-details">'+
      '<div class="section-title">Comunidad · '+E(projectId)+'</div>'+
      '<div class="small-row"><span>Entrada: '+E(c.admission||'request')+'</span>'+
      '<span>'+E(c.can_play?'Acceso al juego':'Sin acceso al juego')+'</span></div>'+
      (c.request_status?'<p class="muted">Mi solicitud: '+E(c.request_status)+'</p>':'')+
      (!c.role&&!c.request_status&&c.admission!=='invite_only'?
       '<form data-feature="project-join">'+
        '<input type="hidden" name="project_id" value="'+safeAttr(projectId)+'">'+
        '<input maxlength="300" name="note" placeholder="Mensaje para los responsables (opcional)" aria-label="Nota al solicitar acceso">'+
        '<button class="primary" type="submit">Solicitar unirme</button></form>':'')+
      '<div class="section-title">Miembros · '+members.length+'</div>'+
      (members.map(m=>'<div class="small-row"><span>'+
        E(m.display_name||m.username)+' <small>@'+E(m.username)+'</small></span>'+
        '<span class="tag">'+E(m.member_role||'participante')+'</span></div>').join('')||
        '<p class="muted">No hay miembros para mostrar.</p>')+
      (media.length?'<div class="section-title">Novedades y videos</div>'+
        media.map(m=>{const link=safeLink(m.url);return '<div class="small-row">'+
        (link?'<a href="'+E(link)+'" rel="noreferrer noopener" target="_blank">'+E(m.title||'Publicación')+'</a>':
          '<span>'+E(m.title||'Publicación')+'</span>')+
        '<small>'+E(m.kind||'enlace')+'</small></div>'}).join(''):'')+
      (c.can_manage?
       '<div class="section-title">Administración de comunidad</div>'+
       '<form data-feature="project-policy" class="inline-form">'+
       '<input type="hidden" name="project_id" value="'+safeAttr(projectId)+'">'+
       '<label>Admisión</label>'+selectable('admission',c.admission||'request',
         [['open','Abierto'],['request','Por solicitud'],['invite_only','Solo invitación']])+
       '<label>Acceso al juego</label>'+selectable('play_access',c.play_access||'public',
         [['public','Público'],['members','Solo miembros autorizados']])+
       '<button class="primary" type="submit">Guardar reglas</button></form>'+
       (pending.length?'<div class="section-title">Solicitudes pendientes</div>'+
         pending.map(p=>'<div class="small-row"><span>'+E(p.username)+
         (p.note?' · '+E(p.note):'')+'</span>'+
         button('request-review','Aprobar','data-id="'+safeAttr(projectId)+'" data-name="'+safeAttr(p.username)+'" data-review="approve"')+
         button('request-review','Rechazar','data-id="'+safeAttr(projectId)+'" data-name="'+safeAttr(p.username)+'" data-review="reject"')+
         '</div>').join(''):'')+
       '<form data-feature="project-member" class="inline-form">'+
       '<input type="hidden" name="project_id" value="'+safeAttr(projectId)+'">'+
       formInput('username','Usuario de comunidad','text',24)+
       selectable('role','participant',[['participant','Participante'],['moderator','Moderador'],['guest','Invitado'],['mention','Mención']])+
       '<label><input type="checkbox" name="can_play" checked> Permiso de juego</label>'+
       '<button class="primary" type="submit">Añadir o editar miembro</button></form>'+
       '<form data-feature="community-media" class="inline-form">'+
       '<input type="hidden" name="project_id" value="'+safeAttr(projectId)+'">'+
       formInput('title','Título de publicación','text',90)+
       formInput('url','Enlace HTTPS','url',500)+
       '<button class="primary" type="submit">Añadir video/enlace</button></form>'
       :'')+
       '</section>';
  }
  function accountPanel(){
    const a=state.account?.account||{};
    const mfa=security.mfa;
    const sessions=Array.isArray(security.sessions?.sessions)?security.sessions.sessions:[];
    const enableMfa=mfa?.enrolled;
    return '<section class="mobile-panel"><div class="section-title">Editar perfil</div>'+
      '<form data-feature="display-name" class="inline-form">'+
      '<label>Nombre visible</label>'+
      '<input name="display_name" minlength="2" maxlength="32" value="'+E(a.display_name||'')+'" required>'+
      '<button class="primary" type="submit">Actualizar nombre</button></form>'+
      '<form data-feature="public-handle" class="inline-form">'+
      '<label>ID pública (@usuario)</label>'+
      '<input name="handle" minlength="3" maxlength="24" value="'+E(a.public_handle||'')+'" required>'+
      '<button class="primary" type="submit">Cambiar identificador</button></form></section>'+
      '<section class="mobile-panel"><div class="section-title">Correo y recuperación</div>'+
      '<p class="muted">El correo debe verificarse. Los cambios pueden requerir códigos del correo anterior y del nuevo. Necesitás una sesión de contraseña reciente.</p>'+
      '<form data-feature="request-email" class="inline-form">'+
      '<input name="email" type="email" maxlength="254" autocomplete="email" placeholder="tu@email.com" aria-label="Correo de recuperación" required>'+
      '<button class="primary" type="submit">Vincular correo</button></form>'+
      '<form data-feature="verify-email" class="inline-form">'+
      '<input name="code" minlength="43" maxlength="43" autocomplete="one-time-code" placeholder="Código de verificación de email" aria-label="Código de correo" required>'+
      '<button class="outline" type="submit">Verificar código</button></form></section>'+
      '<section class="mobile-panel"><div class="section-title">Seguridad · MFA</div>'+
      '<p class="muted">'+(enableMfa?'Authenticator activado':'Sin autenticación en dos pasos')+
        (mfa?.verified_for_seconds?' · Verificado recientemente':'')+'</p>'+
      (enableMfa?
        '<form data-feature="verify-mfa" class="inline-form">'+
        '<input name="code" maxlength="36" autocomplete="one-time-code" placeholder="Código TOTP o emergencia" aria-label="Verificar MFA" required>'+
        '<button class="outline" type="submit">Verificar segundo factor</button></form>'+
        button('rotate-codes','Generar códigos de emergencia nuevos') :
        button('setup-mfa','Activar MFA con Authenticator'))+
      '<div class="section-title">Sesiones abiertas</div>'+
      button('load-sessions','Ver sesiones')+
      (sessions.length?'<div class="session-list">'+sessions.map(x=>
        '<div class="small-row"><span>'+E(x.auth_method||'VIS')+
        (x.current?' · Este teléfono':'')+'</span>'+
        button('revoke-session','Cerrar','data-id="'+safeAttr(x.session_id)+'"')+'</div>').join('')+'</div>':'')+
      button('revoke-all','Cerrar sesiones en todos los dispositivos')+
      '</section>'+
      '<section class="mobile-panel"><div class="section-title">Cambiar contraseña</div>'+
      '<p class="muted">Pedimos la contraseña anterior y MFA (si está activo). Después se cierran todas las sesiones.</p>'+
      '<form data-feature="change-password" class="inline-form">'+
      formInput('current_password','Contraseña actual','password',128,'autocomplete="current-password"')+
      formInput('password','Contraseña nueva','password',128,'autocomplete="new-password" minlength="10"')+
      formInput('confirm','Confirmar contraseña','password',128,'autocomplete="new-password" minlength="10"')+
      '<input name="mfa_code" maxlength="36" placeholder="Código MFA si corresponde" autocomplete="one-time-code">'+
      '<button class="danger" type="submit">Cambiar y cerrar sesiones</button></form></section>'+
      '<section class="mobile-panel"><div class="section-title">Cosméticos VIS</div>'+
      '<p class="muted">Usá imágenes WebP para el avatar y PNG para las skins. Se publican en VIS Social, no en Minecraft directamente.</p>'+
      '<label>Avatar WebP</label><input class="file" type="file" accept="image/webp" data-feature-file="avatar">'+
      '<label>Skin PNG</label><input class="file" type="file" accept="image/png" data-feature-file="skin">'+
      (avatarPreview?'<div class="mobile-image-row"><img class="avatar-preview" alt="Avatar VIS" src="'+E(avatarPreview)+'"></div>':'')+
      (skinPreview?'<div class="mobile-image-row"><img class="skin-preview" alt="Skin VIS (textura)" src="'+E(skinPreview)+'"></div>':'')+
      '<div class="small-row">'+button('view-cosmetics','Ver avatar y skin publicados')+
        button('remove-skin','Quitar skin VIS')+'</div></section>';
  }
  function canEditProjects(){
    return state.social?.developer===true||state.account?.account?.developer===true;
  }
  function adminPanel(){
    if(!canEditProjects())return '';
    return '<section class="mobile-panel"><div class="section-title">VIS Universe Studio · proyectos</div>'+
      '<p class="muted">Gestión de metadatos remotos. Los archivos de Minecraft se editan desde el equipo de escritorio.</p>'+
      '<form data-feature="project-manage" class="inline-form">'+
      formInput('id','ID del proyecto','text',48)+
      formInput('title','Nombre del proyecto','text',100)+
      '<textarea name="summary" maxlength="500" placeholder="Descripción" aria-label="Descripción"></textarea>'+
      selectable('visibility','draft',[['draft','Borrador'],['published','Publicado'],['archived','Archivado']])+
      '<button class="primary" type="submit">Guardar proyecto</button></form>'+
      '<form data-feature="project-staff" class="inline-form">'+
      formInput('project_id','ID del proyecto','text',48)+
      formInput('username','Usuario VIS','text',24)+
      selectable('staff_role','editor',[['editor','Editor'],['manager','Responsable'],['none','Quitar permisos']])+
      '<button class="outline" type="submit">Gestionar equipo</button></form></section>'+
      (state.account?.account?.role==='super_admin'?
      '<section class="mobile-panel"><div class="section-title">VIS Ceibo · Superadministración</div>'+
      '<p class="muted">Se exige MFA reciente; los cambios de permisos los valida Cloudflare.</p>'+
      '<form data-feature="admin-role" class="inline-form">'+
      formInput('username','Usuario a gestionar','text',24)+
      selectable('role','user',[['user','Usuario'],['moderator','Moderador'],['project_manager','Responsable proyectos']])+
      '<button class="outline" type="submit">Asignar rol</button></form>'+
      '<form data-feature="admin-global" class="inline-form">'+
      formInput('username','Usuario administrador global','text',24)+
      selectable('enabled','true',[['true','Habilitar'],['false','Revocar']])+
      '<button class="outline" type="submit">Cambiar administrador global</button></form>'+
      '<form data-feature="admin-disable" class="inline-form">'+
      formInput('username','Usuario a habilitar/bloquear','text',24)+
      selectable('disabled','true',[['true','Bloquear cuenta'],['false','Rehabilitar cuenta']])+
      '<button class="danger" type="submit">Aplicar cambio</button></form></section>'
      :'');
  }
  function instancePanel(){
    const list=Array.isArray(state.instances)?state.instances:[];
    return '<section class="mobile-panel"><div class="section-title">Nueva instancia local</div>'+
      '<p class="muted">Prepará tus instancias. La prueba de Horizon 26.3 usa el APK VIS McRust Preview ARM64 instalado por separado. Java todavía no puede ejecutarse.</p>'+
      '<form data-feature="instance-create" class="inline-form">'+
      formInput('name','Nombre de instancia','text',64)+
      '<label>Motor de juego</label>'+
      selectable('engine','java',[['java','Minecraft Java Edition'],['horizon','Minecraft Rust Horizon']])+
      '<label>Versión Minecraft</label>'+
      formInput('version','Versión (ej. 26.3)','text',48)+
      '<label>Loader (Horizon requiere Vanilla)</label>'+
      selectable('loader','vanilla',[['vanilla','Vanilla'],['fabric','Fabric'],['quilt','Quilt'],['neoforge','NeoForge'],['forge','Forge']])+
      '<input name="project_id" maxlength="48" aria-label="ID del proyecto opcional" placeholder="ID VIS Universe (opcional)">'+
      '<button class="primary" type="submit">Crear carpetas e instancia</button></form></section>'+
      '<section class="mobile-panel"><div class="section-title">Mis instancias · '+list.length+'</div>'+
      (list.length?list.map(i=>
        '<article class="instance-card"><div class="small-row"><strong>'+
        E(i.name)+'</strong><span class="tag">'+E(i.engine==='horizon'?'RUST':'JAVA')+'</span></div>'+
        '<div class="muted">Versión '+E(i.version)+' · '+E(i.loader)+
        (i.project_id?' · '+E(i.project_id):'')+'</div>'+
        '<div class="small-row"><span class="tiny-note">Carpetas de mundos, mods, configuraciones y backups preparadas en el teléfono.</span>'+
        button('remove-instance','Quitar de lista','data-id="'+safeAttr(i.id)+'"')+'</div>'+
        (i.engine==='horizon'&&i.version==='26.3'?button('play-mcrust','Jugar McRust','data-id="'+safeAttr(i.id)+'"'):'<p class="muted">Motor no disponible en esta prueba Android.</p>')+'</article>'
      ).join(''):'<p class="muted">No creaste ninguna instancia Android.</p>')+
      '</section>';
  }
  async function refreshInstances(){
    if(!state.auth?.signed_in)return;
    const username=state.auth.username;
    try{
      const entries=await command('mobile_instances');
      if(!state.auth?.signed_in||state.auth.username!==username)return;
      state.instances=Array.isArray(entries)?entries:[];
      if(state.view==='instances')screen();
    }catch(e){toast('Instancias locales: '+String(e),true);}
  }
  async function nativeAction(action,body){
    // GET routes accept no body at all. Tauri's Option<Value> is None when
    // the property is omitted; {} would incorrectly be treated as POST data.
    return command('mobile_action',body===undefined?{action}:{action,body});
  }
  async function afterMutation(message,projectId=null){
    toast(message);
    await refreshAll();
    if(projectId){
      state.communityId=projectId;
      state.community=await command('mobile_community',{projectId});
      screen();
    }
  }
  function backupCodes(codes){
    if(!Array.isArray(codes)||!codes.length)return;
    // One-time visual presentation. Do not write recovery codes to
    // chat logs, IndexedDB, localStorage or analytics.
    window.alert('Guardá los códigos fuera del teléfono. Se muestran una sola vez:\n\n'+codes.join('\n'));
  }
  async function refreshSecurity(){
    if(!state.auth?.signed_in)return;
    const results=await Promise.allSettled([
      nativeAction('account.mfa.status'),
      nativeAction('account.sessions')
    ]);
    if(!state.auth.signed_in)return;
    security.mfa=results[0].status==='fulfilled'?results[0].value:null;
    security.sessions=results[1].status==='fulfilled'?results[1].value:null;
    if(state.view==='account')screen();
  }
  async function refreshCosmetics(){
    if(!state.auth?.signed_in)return;
    const user=state.auth.username;
    if(!allowedAccount.test(user||''))return;
    const results=await Promise.allSettled([
      nativeAction('avatar.get',{username:user}),
      nativeAction('skin.get',{username:user})
    ]);
    if(!state.auth?.signed_in||state.auth.username!==user)return;
    avatarPreview=trustedDataImage(
      results[0].status==='fulfilled'?results[0].value.avatar:null,'image/webp',33000);
    skinPreview=trustedDataImage(
      results[1].status==='fulfilled'?results[1].value.skin:null,'image/png',90000);
    if(state.view==='account')screen();
  }
  function clear(){
    security.mfa=null;security.sessions=null;
    avatarPreview='';skinPreview='';
  }
  async function handleForm(form){
    const name=form.dataset.feature;
    if(!name)return false;
    if(uiBusy)return true;
    uiBusy=true;
    const fd=new FormData(form);
    const value=x=>String(fd.get(x)||'').trim();
    let message='',projectId=null;
    try{
      if(name==='friend-request'){
        const username=value('username').replace(/^@/,'').toLowerCase();
        if(!allowedAccount.test(username))throw Error('Usuario VIS inválido');
        await nativeAction('friends.request',{username});message='Solicitud de amistad enviada';
      }else if(name==='presence'){
        await nativeAction('presence.set',{presence:value('presence'),custom_status:value('custom_status'),current_game:''});
        message='Estado actualizado';
      }else if(name==='display-name'){
        await nativeAction('account.display',{display_name:value('display_name')});message='Nombre visible actualizado';
      }else if(name==='public-handle'){
        await nativeAction('account.handle',{handle:value('handle').toLowerCase()});message='ID pública actualizada';
      }else if(name==='request-email'){
        const r=await nativeAction('account.email.request',{email:value('email')});
        message=r.dual_approval?'Revisá ambos correos; necesitan aprobar el cambio':'Revisá tu correo para verificarlo';
      }else if(name==='verify-email'){
        const r=await command('mobile_email_verify',{code:value('code')});
        message=r.verified?'Correo verificado correctamente':'Código aprobado; puede faltar el otro correo';
      }else if(name==='verify-mfa'){
        const code=value('code');
        await nativeAction('account.mfa.verify',
          /^\d{6}$/.test(code)?{code}:{recovery_code:code});
        message='Identidad validada';
        await refreshSecurity();
      }else if(name==='change-password'){
        if(value('password')!==value('confirm'))throw Error('Las contraseñas no coinciden');
        if(!window.confirm('Cambiar tu contraseña cerrará todas las sesiones. ¿Continuar?'))return true;
        state.auth=await command('mobile_password_change',{
          currentPassword:String(fd.get('current_password')||''),
          password:String(fd.get('password')||''),
          confirm:String(fd.get('confirm')||''),
          mfaCode:value('mfa_code')
        });
        state.account=null;state.social=null;state.projects=null;state.community=null;clear();
        toast('Contraseña modificada. Volvé a entrar.');screen();return true;
      }else if(name==='project-join'){
        projectId=value('project_id');
        await nativeAction('projects.request_join',{project_id:projectId,note:value('note')});
        message='Solicitud de ingreso enviada';
      }else if(name==='project-policy'){
        projectId=value('project_id');
        await nativeAction('community.policy',{project_id:projectId,
          admission:value('admission'),play_access:value('play_access')});
        message='Reglas de comunidad actualizadas';
      }else if(name==='project-member'){
        projectId=value('project_id');
        await nativeAction('community.members',{
          project_id:projectId,username:value('username'),
          role:value('role'),can_play:fd.has('can_play'),action:'grant'
        });
        message='Miembro actualizado';
      }else if(name==='community-media'){
        projectId=value('project_id');
        if(!/^https:\/\//i.test(value('url')))throw Error('Se requiere un enlace HTTPS');
        await nativeAction('community.media',{project_id:projectId,
          action:'add',title:value('title'),url:value('url'),kind:'video'});
        message='Enlace publicado';
      }else if(name==='project-manage'){
        const project={id:value('id'),title:value('title'),
          summary:value('summary'),visibility:value('visibility')};
        await nativeAction('projects.manage',project);
        message='Proyecto guardado';
      }else if(name==='instance-create'){
        const engine=value('engine');
        const loader=engine==='horizon'?'vanilla':value('loader');
        await command('mobile_instance_create',{
          name:value('name'),engine,loader,version:value('version'),
          projectId:value('project_id')||null
        });
        await refreshInstances();
        toast('Carpetas de instancia preparadas para Android');
        return true;
      }else if(name==='project-staff'){
        await nativeAction('projects.staff',{
          project_id:value('project_id'),username:value('username'),
          staff_role:value('staff_role')
        });message='Equipo del proyecto actualizado';
      }else if(name==='admin-role'){
        if(!window.confirm('¿Modificar el rol de esta cuenta VIS?'))return true;
        await nativeAction('accounts.role',{username:value('username'),role:value('role')});
        message='Rol actualizado';
      }else if(name==='admin-global'){
        if(!window.confirm('¿Modificar permisos de administrador global?'))return true;
        await nativeAction('accounts.global_admin',{
          username:value('username'),enabled:value('enabled')==='true'
        });message='Permiso global actualizado';
      }else if(name==='admin-disable'){
        if(!window.confirm('¿Cambiar el estado de esta cuenta?'))return true;
        await nativeAction('accounts.disable',{
          username:value('username'),disabled:value('disabled')==='true'
        });message='Estado de cuenta actualizado';
      }else return false;
      await afterMutation(message,projectId);
    }catch(e){toast(String(e),true)}
    finally{uiBusy=false}
    return true;
  }
  async function handleAction(button){
    const act=button.dataset.action;
    const supported=new Set([
      'friend-accept','friend-alias','project-sub','request-review','setup-mfa','rotate-codes',
      'load-sessions','revoke-session','revoke-all','remove-skin','view-cosmetics','remove-instance','play-mcrust'
    ]);
    if(!supported.has(act))return false;
    if(uiBusy)return true;
    uiBusy=true;
    try{
      const name=button.dataset.name;
      if(act==='play-mcrust'){
        const result=await command('mobile_mcrust_launch',{id:button.dataset.id});
        toast(result.status==='started'?'McRust está abriendo la instancia.':result.status==='permission_required'?'Permití que Nexo instale McRust y volvé a tocar Jugar.':'Confirmá la instalación de McRust y después tocá Jugar.');
      }else if(act==='friend-accept'){
        await nativeAction('friends.accept',{username:name});
        await afterMutation('Amistad aceptada');
      }else if(act==='friend-alias'){
        const alias=window.prompt('Nuevo apodo local de '+name+' (vacío para quitar):');
        if(alias===null)return true;
        await nativeAction('friends.alias',{username:name,alias:alias.trim().slice(0,80)});
        await afterMutation('Apodo actualizado');
      }else if(act==='project-sub'){
        const id=button.dataset.id;
        await nativeAction(button.dataset.active==='1'?'projects.unsubscribe':'projects.subscribe',{project_id:id});
        await afterMutation('Suscripción actualizada');
      }else if(act==='request-review'){
        const projectId=button.dataset.id;
        await nativeAction('community.review',{project_id:projectId,username:name,action:button.dataset.review});
        await afterMutation('Solicitud revisada',projectId);
      }else if(act==='setup-mfa'){
        const r=await nativeAction('account.mfa.setup');
        // Secret is displayed to the user once for enrollment; it is never
        // logged, persisted, sent to an analytics endpoint or included in URLs.
        window.alert('Agregá esta clave en tu app Authenticator:\n\n'+r.secret+
          '\n\nVIS Ceibo · TOTP · 6 dígitos, 30 segundos');
        const code=window.prompt('Código de seis dígitos para habilitar MFA:');
        if(!code)return true;
        const verified=await nativeAction('account.mfa.confirm',{code:code.trim()});
        backupCodes(verified.recovery_codes);
        await refreshSecurity();
        toast('MFA activado. Guardá tus códigos de emergencia.');
      }else if(act==='rotate-codes'){
        if(!window.confirm('Esto invalidará tus códigos de emergencia anteriores. ¿Continuar?'))return true;
        const r=await nativeAction('account.mfa.rotate');
        backupCodes(r.recovery_codes);
        toast('Nuevos códigos de emergencia generados');
      }else if(act==='load-sessions'){
        await refreshSecurity();toast('Sesiones actualizadas');
      }else if(act==='revoke-session'){
        if(!window.confirm('¿Cerrar esta sesión de VIS Ceibo?'))return true;
        await nativeAction('account.sessions.revoke',{session_id:button.dataset.id});
        await refreshSecurity();toast('Sesión cerrada');
      }else if(act==='revoke-all'){
        if(!window.confirm('¿Cerrar todas tus sesiones VIS Ceibo, incluida la de este móvil?'))return true;
        await nativeAction('account.sessions.revoke',{all:true});
        state.auth=await command('mobile_logout');
        clear();state.social=null;state.account=null;state.projects=null;state.community=null;screen();
        toast('Sesiones revocadas');
      }else if(act==='remove-instance'){
        if(!window.confirm('¿Quitar esta instancia del launcher Android? Sus carpetas y datos NO se borrarán.'))return true;
        await command('mobile_instance_remove',{id:button.dataset.id});
        await refreshInstances();toast('Instancia quitada de la lista. Archivos conservados.');
      }else if(act==='view-cosmetics'){
        await refreshCosmetics();
        toast('Avatar y skin sincronizados');
      }else if(act==='remove-skin'){
        if(!window.confirm('¿Eliminar la skin VIS guardada en la nube?'))return true;
        await nativeAction('skin.delete',{});skinPreview='';
        screen();toast('Skin eliminada');
      }
    }catch(e){toast(String(e),true)}
    finally{uiBusy=false}
    return true;
  }
  async function handleFile(input){
    const type=input.dataset.featureFile;
    if(!['avatar','skin'].includes(type)||uiBusy)return;
    const file=input.files?.[0];
    if(!file)return;
    const avatar=type==='avatar';
    if(file.type!==(avatar?'image/webp':'image/png')){
      toast('Elegí un archivo '+(avatar?'WebP':'PNG'),true);return;
    }
    if(file.size>(avatar?24576:65536)){
      toast('La imagen supera el límite permitido por VIS Social',true);return;
    }
    uiBusy=true;
    try{
      const raw=await new Promise((resolve,reject)=>{
        const reader=new FileReader();
        reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(Error('No se pudo leer el archivo'));
        reader.readAsDataURL(file);
      });
      const [,data]=raw.split(',');
      await nativeAction(avatar?'avatar.upload':'skin.upload',
        {mime:avatar?'image/webp':'image/png',data});
      toast(avatar?'Avatar actualizado':'Skin VIS publicada');
      await refreshCosmetics();
      await refreshAll();
    }catch(e){toast(String(e),true)}
    finally{uiBusy=false}
  }
  return {friendControls,friendsPanel,projectControls,communityPanel,
    accountPanel,adminPanel,instancePanel,canEditProjects,refreshSecurity,refreshCosmetics,refreshInstances,
    clear,handleForm,handleAction,handleFile};
}
