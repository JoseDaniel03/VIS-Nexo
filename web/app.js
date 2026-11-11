import { socialOnlinePanel, syncSocialOwner } from './social-cloud.js';
import { animateEntrance, animateAuthSwap, animateModal, animateModalStep, animateSocial, animateSocialTab, animateChat, animateFeed, animateAvatar, animateControl, animateProjectMotion, beginSectionChange, beginSurfaceDismiss, animateSetting, cancelPendingSectionChange, enableButtonFeedback } from './effects.js';
/* VIS Nexo 2.16 — Horizon library, integrity selection and version pinning.
   VIS Nexo 2.14 — Horizon diagnostics and local build discovery.
   VIS Nexo 2.17 — Universe / Worlds / Horizon Rust Edition + compartir instancias offline.
   VIS Nexo 2.6 — VIS Universe and User libraries, personal instances.
   VIS Nexo 2.3 — Projects & inline publishing.
   VIS Nexo 2.2 — motion & interaction release (Tauri 2 WebView, Rust backend unchanged).
   GPU compositing only for brief interactions, no animation timers when idle.
   VIS Nexo 2.1 — lightweight frontend (Tauri 2 native bridge; no React runtime).
   Desktop operations ALWAYS pass through Rust commands. Browser preview is ephemeral. */
const root = document.querySelector('#app');
const toastRegion = document.querySelector('#toast-region');
const T = window.__TAURI__;
const native = !!T?.core?.invoke;
const empty = () => ({user:null,projects:[],instances:[],friends:[],incoming_requests:[],outgoing_requests:[],messages:[],branding:{name:'VIS Nexo',launcher_logo:'',home_image:'',login_image:''},project_execution:{},paused_projects:[],recent_accounts:[],mode:native?'local':'preview'});
let db = empty();
let page = 'home', selectedId = '', authMode='login', authBusy=false, showPassword=false;
let socialVisible = innerWidth >= 980, socialTab='global', chatWith='', friendFilter='', activeFeed='news', dialog=null;
let socialMode=(()=>{try{return localStorage.getItem('vis-social-mode')==='cloud'?'cloud':'local';}catch{return 'local';}})();
function setSocialMode(mode){socialMode=mode==='cloud'?'cloud':'local';try{localStorage.setItem('vis-social-mode',socialMode);}catch{}render();}
let wizard=null, wizardStep=0, assetCache={}, query='', contextMenu=null;
let designerMode = false;
// The display mode is a local UI preference; it does not change account permissions.
const PERSONAL_PROJECT_ID = '__personal__';
let libraryMode = (() => {try { return (localStorage.getItem('vis-library-mode') ?? localStorage.getItem('vslauncher-library-mode')) === 'user' ? 'user' : 'vs'; } catch { return 'vs'; }})();
const personalInstances = () => db.instances.filter(i => i.project_id === PERSONAL_PROJECT_ID);
const officialInstances = () => db.instances.filter(i => i.project_id !== PERSONAL_PROJECT_ID);
function setLibraryMode(mode) {
  libraryMode = mode === 'user' ? 'user' : 'vs';
  try { localStorage.setItem('vis-library-mode', libraryMode); } catch {}
  page='home'; selectedId=''; mcSelected=null; activeFeed='news'; dialog=null; chatWith='';
  render();
}

let avatarDraft = '';
const isGuest = () => db.mode === 'offline';
const ownedInstances = () => db.instances.filter(i=>!i.source_owner);
const visibleSection = (p,key) => p?.visible_sections?.[key] !== false;
let cropState = null, cropImage = null, cropPointer = null;
let previousView = null;
let minecraftVersions = [], fabricLoaders = [], modResults = [], installedFiles = [];
let minecraftVersionChannel = "release", chatWindowSize = 100;
// Render at most 100 datalist rows; historical versions remain searchable.
function versionSuggestions(query=''){
 const filter=String(query).trim().toLowerCase();
 return minecraftVersions.filter(v=>v.kind===minecraftVersionChannel&&(!filter||v.id.toLowerCase().includes(filter))).slice(0,100);
}
function syncVersionSuggestions(){
 const list=document.getElementById('mc-version-catalog');
 if(list)list.innerHTML=versionSuggestions(document.getElementById('mc-instance-version')?.value||'')
  .map(v=>`<option value="${attr(v.id)}">${esc(v.kind)}</option>`).join('');
}
let maintenanceReport = null, maintenanceLoading = false;
let updateInfo = null, updateBusy = false, cloudCatalog = null, cloudCatalogBusy = false;
let lastMinecraftExit = null;
let horizonChecks = [];
let horizonLibraryBuilds = [];
let mcSelected = null, modKind = 'mod', modSearchQuery = '', installProgress = null, minecraftBusy = false;
let lastDialogTrigger = null;
let prefs = {reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches};
let demoAccounts=[];
const demoOfflineProfiles=new Map();
const clone = (x) => JSON.parse(JSON.stringify(x));
const esc = (v) => String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const attr=esc;
const humanRole = (role) => role === 'admin'?'Administrador':'Jugador';
const displayAccount = (name) => name==='vis_studios' ? 'VIS STUDIOS' : name;
const isAdmin = () => db.user?.role === 'admin';
const currentProject = () => db.projects.find(p=>p.id===selectedId);
const isCurrent = (p) => selectedId===p.id;
const names = {online:'Conectado',away:'Ausente',busy:'Ocupado',invisible:'Invisible',offline:'Desconectado'};
const iconPaths = {
  package:'<path d="M12 2 3 7v10l9 5 9-5V7l-9-5ZM3 7l9 5 9-5M12 12v10"/>',
  home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M9 21v-7h6v7"/>',
  user:'<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/>',
  users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  lock:'<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  eye:'<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff:'<path d="m3 3 18 18M10.6 5.1A11.5 11.5 0 0 1 12 5c6.4 0 10 7 10 7a14 14 0 0 1-3.1 3.9M6.3 6.3C3.4 8.2 2 12 2 12s3.6 7 10 7c1.4 0 2.6-.3 3.7-.7"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  settings:'<path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 1 0 0-7"/><path d="m19.4 15 .8 1.4-2 2-1.5-.8a8 8 0 0 1-1.7.7L14.6 20h-2.9l-.5-1.7a8 8 0 0 1-1.7-.7l-1.5.8-2-2 .8-1.5a8 8 0 0 1-.7-1.7L4.5 12l1.6-1.1a8 8 0 0 1 .7-1.7L6 7.8l2-2 1.5.8a8 8 0 0 1 1.7-.7L11.7 4h2.9l.5 1.9a8 8 0 0 1 1.7.7l1.5-.8 2 2-.8 1.5a8 8 0 0 1 .7 1.7L22 12l-1.8 1.2a8 8 0 0 1-.8 1.8Z"/>',
  message:'<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 9.2 9.2 0 0 1-4-.8L3 21l1.8-5.2A8.5 8.5 0 1 1 21 11.5Z"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  folder:'<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  upload:'<path d="M12 16V4m-4 4 4-4 4 4M4 16v4h16v-4"/>',
  chevron:'<path d="m9 18 6-6-6-6"/>',
  chevrondown:'<path d="m6 9 6 6 6-6"/>',
  arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/>',
  image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m21 16-5-5L5 21"/>',
  rocket:'<path d="M5 16c-1-4 3-10 13-13l3 3c-3 10-9 14-13 13l-3-3Z"/><path d="m6 14-3 2v5l5-3m2-11L8 3H3L2 8m9 5 2 2M12 13l3-3"/>',
  game:'<rect x="2" y="7" width="20" height="13" rx="5"/><path d="M7 11v5m-2.5-2.5h5M16 12h.01M19 15h.01"/>',
  play:'<path d="m8 5 11 7-11 7V5Z"/>',
  pause:'<path d="M8 5v14M16 5v14"/>',
  monitor:'<rect x="2" y="3" width="20" height="15" rx="2"/><path d="M8 22h8M12 18v4"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  x:'<path d="M18 6 6 18M6 6l12 12"/>',
  menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
  logout:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5m5 5H9"/>',
  copy:'<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  dots:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  send:'<path d="m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13"/>',
  star:'<path d="m12 2 3 7 7 1-5 5 1 7-6-4-6 4 1-7-5-5 7-1z"/>',
  info:'<circle cx="12" cy="12" r="10"/><path d="M12 11v6M12 7h.01"/>',
  trash:'<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',
  edit:'<path d="m15 5 4 4M4 20l4-.8L20 7a2.8 2.8 0 0 0-4-4L4 15l-.8 4Z"/>',
  shield:'<path d="M12 22s9-4.5 9-11V5l-9-3-9 3v6c0 6.5 9 11 9 11Z"/>',
  cloud:'<path d="M20 17a4 4 0 0 0-1.3-7.8A7 7 0 0 0 5 11a4 4 0 0 0 0 8h15"/>',
  database:'<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 2 4 3 9 3s9-1 9-3V5M3 12c0 2 4 3 9 3s9-1 9-3"/>',
  sliders:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="currentColor"/><circle cx="16" cy="17" r="2" fill="currentColor"/>',
  external:'<path d="M12 4H4v16h16v-8M13 3h8v8M21 3l-11 11"/>',
  timer:'<circle cx="12" cy="13" r="9"/><path d="M12 13l4-3M9 2h6"/>',
  layers:'<path d="m12 2 10 5-10 5L2 7l10-5ZM2 12l10 5 10-5M2 17l10 5 10-5"/>',
  crop:'<path d="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14"/>',
  newspaper:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 8h5M7 12h5M7 16h10M15 8h2v4h-2z"/>',
  moon:'<path d="M20 14a8 8 0 0 1-10-10A9 9 0 1 0 20 14Z"/>',
  circle:'<circle cx="12" cy="12" r="9"/>',
};
function I(name,size=19){return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name]||iconPaths.grid}</svg>`}
const logo = (big=false) => `<span class="vs-mark${big?' large':''}" aria-hidden="true">${db.branding?.launcher_logo&&preview(db.branding.launcher_logo)?`<img src="${preview(db.branding.launcher_logo)}" alt=""/>`:'<span>V</span>'}</span>`;
const msMark=()=>'<span class="ms-icon" aria-hidden="true"><i></i><i></i><i></i><i></i></span>';
function message(text,bad=false){ while(toastRegion.querySelectorAll('.toast').length>=3)toastRegion.querySelector('.toast')?.remove(); const d=document.createElement('div');d.className=`toast ${bad?'bad':''}`;d.innerHTML=`${I(bad?'info':'check',17)}<span>${esc(text)}</span>`;toastRegion.append(d);setTimeout(()=>d.remove(),4400);}
function closeDialog(){
 beginSurfaceDismiss(root,'.dialog',()=>{
   const target=lastDialogTrigger;
   if(dialog?.type==='crop'){dialog=cropState?.origin==='profile'?(cropState.kind==='avatar'?{type:'avatar'}:null):{type:'project'};cropState=null;cropImage=null;}else{dialog=null;wizard=null;}render();
   if(target?.isConnected) target.focus({preventScroll:true});
   lastDialogTrigger=null;
 },{reducedMotion:prefs.reducedMotion,axis:'y'});
}
function preview(path){if(assetCache[path])return assetCache[path];return /^https:\/\/[a-z0-9.-]+\.(?:workers|r2)\.dev\/assets\/[a-f0-9]{64}\.(?:png|jpg|webp)$/i.test(path||'')?path:'';}
function bgPhoto(path){return preview(path)?`style="background-image:linear-gradient(90deg,rgba(12,8,24,.2),rgba(12,8,24,.1)),url('${preview(path)}')"`:'';}
function projectHeroPhoto(path){return preview(path)?`style="background-image:url('${preview(path)}')"`:'';}
function projectIcon(p,more=''){return preview(p?.icon_path)?`<img src="${preview(p.icon_path)}" alt="" ${more}/>`:`${I('game',22)}`;}
function instanceIcon(i,size=27){return preview(i?.icon_path)?
  `<img class="vis-instance-custom-icon" src="${attr(preview(i.icon_path))}" alt="" width="${size}" height="${size}"/>`:
  I('game',size);}
const suggestedMinecraftNick=()=>/^[A-Za-z0-9_]{3,16}$/.test(db.user?.username||'')?db.user.username:'';

async function command(name,args={}) {
  if(native) return await T.core.invoke(name,args);
  return mockCommand(name,args);
}
function mockCommand(name,args){
  const u=db.user;
  if(name==='get_state')return clone(db);
  if(name==='register'){
    if(args.password!==args.confirm) throw new Error('Las contraseñas no coinciden.');
    if(args.username.trim().length<3||args.password.length<4)throw new Error('Completá los datos para probar la interfaz.');
    const user={username:args.username.trim().toLowerCase(),role:demoAccounts.length?'user':'admin',presence:'online',avatar:'',skin:'',cape:'',avatar_layer:'',profile_banner:''};demoAccounts.push({...user,password:args.password});db.user=user;db.mode='preview';rememberMockAccount(user.username);return clone(db);
  }
  if(name==='login'){
    const found=demoAccounts.find(x=>x.username===args.username.trim().toLowerCase()&&x.password===args.password);
    if(!found)throw new Error('En la vista web primero creá una cuenta de prueba.');
    db.user={username:found.username,role:found.role,presence:'online',avatar:'',skin:'',cape:'',avatar_layer:'',profile_banner:''};db.mode='preview';rememberMockAccount(found.username);return clone(db);
  }
  if(name==='login_offline'){
    const nick=String(args.nickname||'').trim();
    if(!/^[a-zA-Z0-9_]{3,16}$/.test(nick))throw new Error('Nick offline: 3–16 letras, números o _.');
    const key=nick.toLowerCase();db.user={username:key,role:'user',presence:'offline',avatar:'',skin:'',cape:'',avatar_layer:'',profile_banner:''};db.mode='offline';db.instances=clone(demoOfflineProfiles.get(key)||[]);db.paused_projects=[];return clone(db);
  }
  if(name==='logout'){if(db.mode==='offline')demoOfflineProfiles.set(db.user.username.toLowerCase(),clone(ownedInstances()));db.user=null;db.mode='preview';db.instances=[];db.paused_projects=[];return clone(db);}
  if(name==='clear_asset') { if(!db.user)throw new Error('Iniciá sesión');
    if(['home','launcher_logo'].includes(args.kind)){if(db.user.role!=='admin')throw new Error('Solo admin');db.branding[args.kind==='home'?'home_image':'launcher_logo']='';}
    else if(['avatar','skin','cape','avatar_layer','profile_banner'].includes(args.kind))db.user[args.kind]='';
    return clone(db); }
  if(name==='commit_profile_asset'){if(!db.user||db.mode==='offline')throw new Error('Iniciá sesión');db.user[args.kind]=args.path;return clone(db);}
  if(name==='set_avatar_preset'){if(!db.user)throw new Error('Iniciá sesión');if(!['nova','orbit','eclipse','nebula','pulse'].includes(args.preset))throw new Error('Avatar inválido');db.user.avatar='preset:'+args.preset;return clone(db);}
  if(!u)throw new Error('Iniciá sesión primero');
  // The browser preview can edit fake guest profiles, but cannot install native game files.
  if(name==='save_project'){
    if(u.role!=='admin')throw new Error('Solo admin');
    const p=args.project;p.id=p.id||p.title.trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    if(!p.id)throw new Error('Necesitás un nombre para el proyecto');
    const ix=db.projects.findIndex(x=>x.id===p.id);if(ix>=0)db.projects[ix]=clone(p);else db.projects.push(clone(p));return clone(db);
  }
  if(name==='set_project_execution'){if(u.role!=='admin')throw new Error('Solo admin');db.project_execution[args.projectId]=args.enabled;return clone(db);}
  if(name==='delete_project'){db.projects=db.projects.filter(p=>p.id!==args.projectId);return clone(db);}
  if(name==='save_instance'){
    if(db.mode==='offline'&&(args.instance.project_id!==PERSONAL_PROJECT_ID||args.instance.engine!=='java'))throw Error('El modo offline crea únicamente instancias Java personales.');
    if(!args.instance.game_dir)throw Error('Elegí la carpeta de esta instancia.');
    const i=db.instances.findIndex(x=>x.name===args.instance.name&&x.project_id===args.instance.project_id&&!x.source_owner);
    if(i>=0)db.instances[i]=args.instance;else db.instances.push(args.instance);
    if(db.mode==='offline')demoOfflineProfiles.set(u.username.toLowerCase(),clone(ownedInstances()));
    return clone(db);
  }
  if(name==='delete_instance'){db.instances=db.instances.filter(x=>x.name!==args.name||x.project_id!==args.projectId);if(db.mode==='offline')demoOfflineProfiles.set(u.username.toLowerCase(),clone(ownedInstances()));return clone(db);}
  if(name==='list_instance_files')return [];
  if(name==='set_project_active'){
    db.paused_projects=db.paused_projects||[];
    db.paused_projects=db.paused_projects.filter(id=>id!==args.projectId);
    if(!args.enabled)db.paused_projects.push(args.projectId);
    return clone(db);
  }
  if(name==='ensure_project_instance'){
    const p=db.projects.find(p=>p.id===args.projectId);
    if(!p||db.mode==='offline'&&p.engine!=='java')throw Error('Proyecto no disponible para este perfil.');
    const instance={name:'VIS '+p.id,project_id:p.id,version:p.mc_version,loader:p.loader,
      loader_version:p.loader_version||'',engine:p.engine,ram_mb:args.ramMb,game_dir:args.gameDir,installed:false,source_owner:''};
    db.instances.push(instance);
    return clone(db);
  }
  if(name==='update_presence'){db.user.presence=args.presence;return clone(db);}
  if(name==='save_brand_name'){db.branding.name=args.name;return clone(db);}
  if(name==='request_friend')throw new Error('El modo de vista previa no tiene otras cuentas conectadas.');
  if(name==='accept_friend')return clone(db);
  if(name==='send_message')throw new Error('Mensajería disponible al abrir el cliente Tauri.');
  throw new Error(`Acción nativa no disponible en el navegador: ${name}`);
}
function rememberMockAccount(username){
 db.recent_accounts=[{username,provider:'local'},...(db.recent_accounts||[]).filter(x=>x.username!==username)].slice(0,3);
}
async function refreshAssets(){
  if(!native||!db.user)return;
  const paths = new Set([db.user.avatar,db.user.skin,db.user.cape,db.user.avatar_layer,db.user.profile_banner,db.branding.launcher_logo,db.branding.home_image,
    ...db.projects.flatMap(p=>[p.icon_path,p.banner_path,p.logo_path]),
    ...db.instances.map(i=>i.icon_path)].filter(Boolean));
  const missing=[...paths].filter(p=>!assetCache[p]);
  await Promise.all(missing.map(async p=>{try{assetCache[p]=await command('preview_asset',{path:p})}catch{}}));
}
async function apply(name,args={},success=''){
  try {db=await command(name,args);await refreshAssets();render();if(success)message(success);return true}
  catch(e){message(String(e),true);return false}
}
function brandLabel(){return esc(db.branding?.name||'VIS Nexo');}
function loginView(){
  const reg=authMode==='register', guest=authMode==='offline';
  return `<main class="auth-screen">
    <section class="auth-glass" aria-label="${guest?'Acceso offline':reg?'Crear cuenta':'Inicio de sesión'}">
      <div class="auth-brand">${logo(true)}<span>${brandLabel()}</span></div>
      <div class="auth-intro"><span class="kicker">ACCESO A TU CUENTA</span><h1>${guest?'Entrá sin cuenta':reg?'Creá tu cuenta':'Iniciá sesión'}</h1><p>${guest?'Elegí un nick para guardar y jugar tus instancias Minecraft, sin crear cuenta VIS.':reg?'Registrate para empezar a gestionar tus proyectos.':'Ingresá a tu biblioteca, proyectos y comunidad.'}</p></div>
      <div class="auth-switch" role="tablist" aria-label="Método de acceso">
        <button class="auth-choice ${guest?'inactive':'active'}" data-action="auth-local" type="button" aria-selected="${!guest}">${I('user',17)}<span>Cuenta local</span></button>
        <button class="auth-choice inactive" type="button" disabled aria-label="Microsoft OAuth no conectado">${msMark()}<span>Microsoft</span></button>
        <button class="auth-choice ${guest?'active':'inactive'}" data-action="auth-offline" type="button" aria-selected="${guest}">${I('game',17)}<span>Offline</span></button>
      </div>
      ${!guest&&db.recent_accounts?.length?`<div class="recent-logins"><span class="field-label">ACCESO RÁPIDO · ÚLTIMAS 3 CUENTAS</span><div class="recent-account-list">${db.recent_accounts.slice(0,3).map(r=>`<button type="button" data-action="recent-account" data-id="${attr(r.username)}" class="recent-account">${I('user',16)}<span>${esc(r.username)}</span><small>${esc(r.provider==='microsoft'?'Microsoft':'Local')}</small></button>`).join('')}</div><small>Elegir una cuenta no omite su contraseña.</small></div>`:''}
      <form id="auth-form" class="auth-form" autocomplete="on">
        <label class="field-label" for="auth-name">${guest?'Nick offline':'Usuario'}</label>
        <div class="auth-input">${I('user',18)}<input required minlength="3" maxlength="${guest?16:24}" id="auth-name" name="${guest?'nickname':'username'}" autocomplete="${guest?'off':'username'}" placeholder="${guest?'Nick para Minecraft':'Nombre de usuario'}" spellcheck="false" /></div>
        ${guest?'':`<div class="field-header"><label class="field-label" for="auth-password">Contraseña</label></div>
        <div class="auth-input">${I('lock',18)}<input required minlength="4" maxlength="128" type="${showPassword?'text':'password'}" id="auth-password" name="password" autocomplete="${reg?'new-password':'current-password'}" placeholder="${reg?'Creá una contraseña':'Ingresá tu contraseña'}"/><button class="eye-button" type="button" data-action="toggle-password" aria-label="Mostrar u ocultar contraseña">${I(showPassword?'eyeoff':'eye',19)}</button></div>
        `}
        ${reg?`<label class="field-label" for="auth-repeat">Confirmar contraseña</label><div class="auth-input">${I('lock',18)}<input required minlength="4" maxlength="128" type="${showPassword?'text':'password'}" name="confirm" id="auth-repeat" autocomplete="new-password" placeholder="Repetí tu contraseña" /></div>`:''}
        <button class="primary-btn auth-submit" type="submit" ${authBusy?'disabled':''}>${authBusy?I('timer',20):I('arrow',20)}<span>${authBusy?'Validando...':guest?'Continuar sin cuenta':reg?'Crear cuenta':'Entrar al launcher'}</span></button>
      </form>
      ${guest?`<button class="auth-footer" data-action="auth-local" type="button">Volver al inicio de sesión</button>`:`<button class="auth-footer" data-action="switch-auth" type="button">${reg?'¿Ya tenés cuenta?':'¿Todavía no tenés cuenta?'} <strong>${reg?'Iniciá sesión':'Registrate'}</strong></button>`}
      ${!native?`<p class="auth-preview">Vista previa en navegador · Los datos de prueba no se guardan.</p>`:''}
    </section>
    <div class="auth-corner" aria-hidden="true">${I('shield',18)} <span>ACCESO LOCAL SEGURO</span></div>
  </main>`;
}
function header(){
 const crumb=page==='project'?currentProject()?.title:({home:libraryMode==='vs'?'Inicio VS':'Mi biblioteca',profile:'Mi perfil',instances:'Instancias',minecraft:'Minecraft',settings:'Configuración',maintenance:'Maintenance',assets:'Recursos'}[page]||'Inicio');
 return `<header class="app-topbar"><div class="top-left"><span class="breadcrumb">${libraryMode==='vs'?'VIS UNIVERSE':'MIS MUNDOS'}</span>${I('chevron',13)}<span class="crumb-current">${esc(crumb||'Proyecto')}</span></div>
   <div class="top-actions">${isGuest()?'':`<button class="icon-btn social-toggle" data-action="toggle-social" aria-label="Abrir o cerrar amigos" aria-pressed="${socialVisible}" title="VIS Portals · Amigos">${I('users',19)}</button>`}<button class="icon-btn" data-action="go-cloud" title="VIS Universe · Catálogo en la nube" aria-label="Catálogo online">${I('cloud',19)}</button><button class="icon-btn" data-action="go-settings" title="Configuración" aria-label="Configuración">${I('settings',19)}</button><span class="top-sep"></span><button class="profile-chip" data-action="go-profile" title="Abrir perfil">${userAvatar(30)}<span>${esc(displayAccount(db.user?.username))}</span>${I('chevrondown',14)}</button></div>
 </header>`;
}
function avatarVisual(avatar,username,size=36,owned=false){
 const preset=typeof avatar==='string'&&avatar.startsWith('preset:')?avatar.slice(7):'';
 const valid=['nova','orbit','eclipse','nebula','pulse'].includes(preset)?preset:'nova';
 const content=avatar&&preview(avatar)?`<img alt="" src="${preview(avatar)}"/>`:preset?`<span class="avatar-glyph">${I(preset==='orbit'?'circle':preset==='eclipse'?'moon':preset==='pulse'?'rocket':preset==='nebula'?'star':'layers',Math.round(size*.48))}</span>`:esc(username?.[0]?.toUpperCase()||'V');
 return `<span class="avatar avatar-style-${valid}" style="width:${size}px;height:${size}px">${content}${owned&&db.user?.avatar_layer&&preview(db.user.avatar_layer)?`<img class="avatar-layer-overlay" src="${preview(db.user.avatar_layer)}" alt=""/>`:''}</span>`;
}
function userAvatar(size=36){return avatarVisual(db.user?.avatar,db.user?.username,size,true)}
function sidebar(){
 const personal = libraryMode==='user';
 const items = personal
   ? `${personalInstances().map(i=>`<button class="side-project ${page==='instances'&&mcSelected?.name===i.name?'selected':''}" data-action="sidebar-instance" data-id="${attr(i.name)}" data-project="${attr(i.project_id)}" title="${attr(i.name)} · ${attr(i.version)}" aria-label="Instancia ${attr(i.name)}">${instanceIcon(i,22)}<span class="side-tooltip">${esc(i.name)}</span></button>`).join('')}
      <button class="side-add" data-action="new-personal-instance" title="Crear instancia personal" aria-label="Crear instancia personal">${I('plus',22)}</button>`
   : `${db.projects.map(p=>`<button class="side-project ${page==='project'&&isCurrent(p)?'selected':''}" data-action="open-project" data-id="${attr(p.id)}" data-context="${attr(p.id)}" title="${attr(p.title)}">${projectIcon(p)}<span class="side-tooltip">${esc(p.title)}</span></button>`).join('')}
      ${isAdmin()?`<button class="side-add" data-action="create-project" aria-label="Crear proyecto" title="Crear proyecto">${I('plus',22)}</button>`:''}
      ${db.projects.length===0&&!isAdmin()?`<span class="sidebar-placeholder">${I('grid',19)}</span>`:''}`;
 return `<nav class="project-sidebar" aria-label="${personal?'Instancias del usuario':'Proyectos VIS Universe'}"><button class="side-logo ${page==='home'?'selected':''}" data-action="go-home" title="Inicio de VIS Nexo" aria-label="Inicio">${logo()}</button>
 <div class="side-divider"></div><div class="side-section-label">${personal?'MIS JUEGOS':'PROYECTOS'}</div>
 <div class="side-projects">${items}</div>
 <div class="side-footer"><button class="side-round" data-action="go-minecraft" title="${isGuest()?'Instancias instaladas':'Minecraft y mods'}" aria-label="Minecraft y mods">${I('game',21)}</button><button class="side-round" data-action="go-instances" title="Instancias">${I('layers',21)}</button><button class="side-avatar" data-action="go-profile" title="Mi perfil">${userAvatar(43)}<i class="presence-pin"></i></button></div></nav>`;
}
function socialPanel(){return socialMode==='cloud'?socialOnlinePanel(socialVisible):localSocialPanel();}
function localSocialPanel(){
 const related = socialTab==='projects' && page==='project';
 const friends = db.friends; // Global friendships persist; project context is a view, not a second friend list.
 return `<aside class="social-pane ${socialVisible?'':'is-hidden'}" aria-label="Amigos">
 <div class="social-top"><div class="social-brand"><span class="social-title">${I('users',20)} VIS PORTALS</span><small>Amigos y mensajes</small></div><button class="icon-btn" data-action="toggle-social" title="Ocultar panel">${I('x',18)}</button></div>
 <div class="social-tabs"><button data-action="social-cloud" title="Abrir VIS Humile en la nube">VIS Humile</button><button class="${socialTab==='global'?'active':''}" data-action="social-global">Global</button><button class="${socialTab==='projects'?'active':''}" data-action="social-projects">Proyectos</button></div>
 <div class="social-person"><div class="person-left">${userAvatar(37)}<div><b>${esc(db.user?.username||'')}</b><span>${esc(names[db.user?.presence||'online']||'Conectado')}</span></div></div><span class="dot ${esc(db.user?.presence||'online')}"></span></div>
 <label class="social-small-title" for="social-presence">TU ESTADO</label><div class="presence-picker">${I('circle',16)}<select id="social-presence" aria-label="Cambiar estado">${['online','away','busy','invisible'].map(v=>`<option value="${v}" ${db.user?.presence===v?'selected':''}>${names[v]}</option>`).join('')}</select>${I('chevrondown',14)}</div>
 <div class="social-group-head"><span>${socialTab==='global'?'MIS CONTACTOS':'CONTACTOS POR PROYECTO'}</span><span>${friends.length}</span></div>
 <div class="social-search">${I('search',15)}<input id="friend-filter" value="${attr(friendFilter)}" placeholder="Filtrar amigos" aria-label="Filtrar amigos" autocomplete="off"></div>
 <div class="friend-scroll" aria-live="polite">${related?`<p class="small-note">Amigos globales · el filtro por servidor se habilitará con la presencia online.</p>`:''}
 ${socialTab==='projects'&&page!=='project'?`<p class="social-empty">Abrí un proyecto para ver sus contactos.</p>`:''}
 ${friends.filter(f=>f.username.toLowerCase().includes(friendFilter.toLowerCase())).map(f=>`<button class="friend-item ${chatWith===f.username?'selected':''}" data-action="open-chat" data-id="${attr(f.username)}">${avatarVisual('',f.username,34)}<span class="friend-meta"><b>${esc(f.username)}</b><small>${names[f.presence]||'Desconectado'}</small></span><span class="dot offline"></span></button>`).join('')}
 ${friends.length===0&&socialTab==='global'?`<p class="social-empty">Todavía no tenés amigos. Agregá a alguien por su usuario.</p>`:''}
 ${db.incoming_requests.length?`<div class="social-group-head"><span>SOLICITUDES</span><span>${db.incoming_requests.length}</span></div>${db.incoming_requests.map(u=>`<div class="request-row"><span>${esc(u)}</span><button class="mini-add" data-action="accept-friend" data-id="${attr(u)}">Aceptar</button></div>`).join('')}`:''}
 </div>
 <div class="social-bottom"><form id="friend-form" class="friend-add-row"><input name="username" placeholder="Agregar por usuario" aria-label="Usuario de amigo" minlength="3" maxlength="24" required/><button title="Enviar solicitud">${I('plus',19)}</button></form>
 <span class="local-hint">${I('shield',13)} Amigos locales · Conexión global pendiente</span></div>
 ${chatWith?chatDrawer():''}
 </aside>`;
}
function chatDrawer(){
 const msgs=db.messages.filter(m=>(m.from===db.user?.username&&m.to===chatWith)||(m.to===db.user?.username&&m.from===chatWith));
 // Bounded DOM rendering: O(min(messages, window)), older messages stay in data.
 const visible=msgs.slice(-chatWindowSize);
 return `<section class="chat-drawer"><div class="chat-head"><b>${I('message',18)} ${esc(chatWith)}</b><button data-action="close-chat" class="icon-btn">${I('x',18)}</button></div><div class="chat-messages">${msgs.length>visible.length?`<button type="button" class="chat-load-older" data-action="chat-load-older">Ver mensajes anteriores (${msgs.length-visible.length})</button>`:''}${visible.map(m=>`<div class="bubble ${m.from===db.user?.username?'mine':''}">${esc(m.body)}<small class="message-date">${esc(m.created||'')}</small></div>`).join('')||'<p class="small-note">Sin mensajes todavía</p>'}</div><form id="message-form" class="chat-send"><input name="body" maxlength="2000" placeholder="Escribí un mensaje..." required/><button title="Enviar">${I('send',19)}</button></form></section>`;
}
function emptyHome(){return `<div class="empty-projects"><div class="empty-orbit">${I('layers',38)}</div><h3>Todavía no hay proyectos</h3><p>${isAdmin()?'Creá el primer proyecto y personalizá su identidad visual desde el administrador.':'Los proyectos aparecerán acá cuando se publiquen en el catálogo.'}</p>${isAdmin()?`<button class="outline-btn" data-action="create-project">${I('plus',17)} Crear proyecto</button>`:''}</div>`;}
function modeSelector(){
 return `<nav class="library-mode-switch" aria-label="Seleccionar modo del launcher">
 <button type="button" data-action="mode-vs" class="library-mode-choice ${libraryMode==='vs'?'active':''}" aria-pressed="${libraryMode==='vs'}">${I('shield',20)}<span><b>VIS Universe</b><small>Explorar proyectos y novedades</small></span></button>
 <button type="button" data-action="mode-user" class="library-mode-choice ${libraryMode==='user'?'active':''}" aria-pressed="${libraryMode==='user'}">${I('layers',20)}<span><b>Usuario</b><small>Tu Minecraft, tus instancias</small></span></button>
 </nav>`;
}
function personalHomePage(){
 const items=personalInstances();
 return `<div class="content-inner home-page user-library-page">${modeSelector()}
 <div class="user-library-hero"><div><span class="page-eyebrow">BIBLIOTECA PERSONAL</span><h1>Tu Minecraft, a tu manera.</h1><p>Creá varias versiones Vanilla o Fabric, instalá mods y mantené cada mundo separado de los proyectos oficiales.</p></div>
 <button class="primary-btn" data-action="new-personal-instance">${I('plus',18)} Crear instancia</button></div>
 <div class="section-heading"><div><span class="page-eyebrow">MIS PERFILES</span><h2>Instancias personales <small>${items.length}</small></h2></div><button class="outline-btn" data-action="go-instances">${I('layers',16)} Ver todas</button></div>
 ${items.length?`<div class="instance-list">${items.map(instanceLine).join('')}</div>`:quietEmpty('Todavía no creaste instancias personales','Elegí Vanilla o Fabric, una versión Minecraft, la RAM y una carpeta para comenzar.')}
 ${isGuest()?'<p class="muted">Tus mundos e instancias se guardan por nickname local. No equivalen a una cuenta con contraseña o licencia Microsoft.</p>':''}
 </div>`;
}
function homePage(){
 if(libraryMode==='user')return personalHomePage();
 const featured=db.projects.find(p=>!isProjectPaused(p))||db.projects[0];
 const withBanner=featured?.banner_path&&preview(featured.banner_path);
 return `<div class="content-inner home-page portal-home">${modeSelector()}<div class="section-kicker">${I('grid',15)} CENTRO DE JUEGOS <span class="line"></span> ${db.projects.length} PROYECTOS</div>
 <section class="hero feature-hero portal-feature" ${withBanner?bgPhoto(featured.banner_path):''} data-motion="hero"><div class="hero-vignette"></div>
 <div class="hero-inner"><span class="hero-tag">${I('game',15)} ${featured?'DESTACADO':'VIS NEXO'}</span>
 ${featured?`<div class="featured-wordmark">${featured.logo_path&&preview(featured.logo_path)?`<img src="${preview(featured.logo_path)}" alt=""/>`:`<h1>${esc(featured.title)}</h1>`}</div><p>${esc(featured.subtitle||featured.description||'')}</p><div class="hero-actions"><button class="primary-btn hero-cta" data-action="open-project" data-id="${attr(featured.id)}">${I('play',19)} Ver proyecto</button><span class="hero-status">${isExecutionEnabled(featured)?'Disponible':featured.installable?'Pausado':'Próximamente'}</span></div>`:
 `<h1>Tu espacio de juegos.</h1><p>Explorá proyectos, noticias y actualizaciones desde un solo lugar.</p>${isAdmin()?`<button class="primary-btn hero-cta" data-action="create-project">${I('plus',19)} Crear primer proyecto</button>`:`<span class="hero-muted">El catálogo está vacío por ahora</span>`}`}</div>
 <div class="hero-watermark" aria-hidden="true">${logo(true)}</div></section>
 <div class="section-heading portal-section-title"><div><span class="page-eyebrow">EXPLORAR</span><h2>Todos los proyectos <small>${db.projects.length}</small></h2></div><div class="section-tools"><label class="catalog-search">${I('search',16)} <input id="catalog-search" aria-label="Buscar proyectos" type="search" placeholder="Buscar proyectos..." value="${attr(query)}" /></label>${isAdmin()?`<button class="outline-btn" data-action="create-project">${I('plus',17)} Nuevo proyecto</button>`:''}</div></div>
 ${db.projects.length?`<div class="project-grid portal-grid">${db.projects.filter(p=>`${p.title} ${p.subtitle}`.toLowerCase().includes(query.toLowerCase())).map(p=>projectCard(p)).join('')||'<div class="quiet-empty">Sin coincidencias</div>'}</div>`:emptyHome()}
 <div class="portal-footer-note">${I('shield',14)} Catálogo local · Las actualizaciones se publican desde la administración.</div></div>`;
}
function projectCard(p){const available=isExecutionEnabled(p);return `<button class="project-card portal-game-card" data-action="open-project" data-id="${attr(p.id)}" data-context="${attr(p.id)}"><div class="project-card-cover" ${p.banner_path?bgPhoto(p.banner_path):''}><span class="project-card-watermark">${projectIcon(p)}</span><span class="availability ${available?'available':''}">${available?'Disponible':isProjectPaused(p)?'En pausa':p.installable?'Bloqueado':'Próximamente'}</span><span class="card-hover-cta">${I('arrow',17)} Abrir proyecto</span></div><div class="project-card-info"><span class="project-card-logo">${projectIcon(p)}</span><div><strong>${esc(p.title)}</strong><small>${esc(p.subtitle||p.mc_version||'Proyecto VIS Universe')}</small></div>${I('chevron',19)}</div></button>`;}
function projectPage(){
 const p=currentProject();if(!p)return `<div class="content-inner">${emptyHome()}</div>`;
 const tabs=[['news','Noticias'],['patches','Notas de parche'],['updates','Actualizaciones'],['calendar','Eventos'],['community','Comunidad']].filter(([key])=>visibleSection(p,key));
 const feed=tabs.some(([key])=>key===activeFeed)?activeFeed:tabs[0]?.[0]||'news';
 const filtered=(p.posts||[]).map((post,index)=>({...post,_index:index})).filter(post=>feed==='news'?post.kind==='news':feed==='patches'?post.kind==='patch':feed==='updates'?post.kind==='update':feed==='community'?post.kind==='community':false);
 const posts=(feed==='calendar'?(p.calendar||[]).map((ev,index)=>({...ev,_index:index})):filtered);
 const isCalendar=feed==='calendar';
 const enabled=db.project_execution?.[p.id]!==false;
 const paused=isProjectPaused(p);
 const available=p.installable&&enabled&&!paused&&(!isGuest()||p.engine!=='horizon');
 const ownInstalledProject=db.instances.find(i=>compatibleProjectInstance(i,p)&&!i.source_owner);
 const installedProject=ownInstalledProject||db.instances.find(i=>compatibleProjectInstance(i,p));
 const adminActions=isAdmin()?`<div class="project-admin-actions" aria-label="Publicación rápida"><span class="admin-actions-title">${I('shield',15)} ADMINISTRACIÓN</span><button class="admin-action" data-action="quick-publish" data-kind="news" title="Publicar una noticia">${I('newspaper',16)} Noticia</button><button class="admin-action" data-action="quick-publish" data-kind="patch" title="Publicar notas de parche">${I('settings',16)} Nota de parche</button><button class="admin-action" data-action="quick-publish" data-kind="update" title="Publicar una actualización">${I('upload',16)} Actualización</button><button class="admin-action" data-action="quick-publish" data-kind="event" title="Agregar un evento al calendario">${I('calendar',16)} Evento</button><button class="admin-action light" data-action="edit-project" data-id="${attr(p.id)}" title="Editar identidad visual, recursos y configuraciones">${I('edit',16)} Editar proyecto</button></div>`:'';
 return `<div class="content-inner project-page riot-project-page project-page-v23"><section class="project-hero portal-project-hero cinematic-project-hero" ${p.banner_path?projectHeroPhoto(p.banner_path):''} data-motion="hero"><div class="project-hero-shade"></div><div class="project-hero-content"><span class="hero-tag">${I('game',16)} ${esc(p.mc_version?'MINECRAFT '+p.mc_version:'PROYECTO VIS UNIVERSE')}</span><div class="project-wordmark">${p.logo_path&&preview(p.logo_path)?`<img class="project-logo-image" src="${preview(p.logo_path)}" alt="Logo de ${attr(p.title)}"/>`:`<h1>${esc(p.title)}</h1>`}</div><p>${esc(p.description||p.subtitle||'')}</p>
 <div class="project-actions"><button class="primary-btn" ${!available&&!paused?'disabled title="Proyecto no habilitado"':''} data-action="${paused?'toggle-personal-project':'project-play'}" data-id="${attr(p.id)}">${I(paused?'play':available?'play':'timer',19)} ${paused?'Activar proyecto':available?(installedProject?'Jugar':'Instalar y jugar'):'Próximamente'}</button>${!paused?`<button class="glass-btn" data-action="toggle-personal-project" data-id="${attr(p.id)}">${I(paused?'check':'pause',17)} ${paused?'Reanudar':'Pausar en mi biblioteca'}</button>`:''}<button class="glass-btn" data-action="go-instances" title="Gestionar instancias locales">${I('settings',18)} Instancias</button></div></div><span class="portal-hero-caption">${paused?'PAUSADO EN TU BIBLIOTECA':available?'DISPONIBLE':enabled?'EN PREPARACIÓN':'EJECUCIÓN DESHABILITADA'}</span></section>
 ${isAdmin()?`<div class="project-execution-control"><span>${I('shield',17)} Ejecución de Minecraft: <b>${p.installable?(enabled?'Habilitada':'Bloqueada'):'Proyecto no publicado para jugar'}</b></span><button class="outline-btn" data-action="toggle-project-execution" data-id="${attr(p.id)}" title="Habilitar o deshabilitar las instalaciones y el botón Jugar">${enabled?'Bloquear ejecución':'Permitir ejecución'}</button></div>`:''}
 ${!isGuest()&&ownInstalledProject?.installed&&projectContentCount(p)>0?`<section class="surface-card" style="margin-bottom:18px"><div class="card-heading">${I('package',19)} Contenido del proyecto · ${projectContentCount(p)} recursos</div><p class="muted">Mods, resource packs y shaders definidos por VIS STUDIOS. Podés sincronizarlos sin borrar mundos.</p><button class="outline-btn" data-action="sync-project-content" data-id="${attr(ownInstalledProject.name)}" data-project="${attr(p.id)}" ${!available||minecraftBusy?'disabled':''}>${I('upload',17)} Sincronizar contenido</button></section>`:''}${adminActions}<div class="project-lower portal-project-lower ${visibleSection(p,'notes')?'':'full-content'}"><section class="project-main"><div class="project-content-head"><div><span class="page-eyebrow">CENTRO DE NOVEDADES</span><h2>Lo último de ${esc(p.title)}</h2></div></div><div class="feed-tabs">${tabs.map(([v,label])=>`<button class="${feed===v?'active':''}" data-action="feed-tab" data-id="${v}">${label}</button>`).join('')}</div>
 ${!tabs.length?quietEmpty('Secciones ocultas','El administrador todavía no habilitó las secciones de novedades.'):posts.length?`<div class="news-list portal-news">${posts.map(post=>`<article class="news-item"><div class="news-icon">${I(isCalendar?'calendar':post.kind==='patch'?'settings':post.kind==='update'?'upload':'bell',21)}</div><div class="news-content"><small>${esc(isCalendar?post.date:(post.date||'Publicación'))}</small><h3>${esc(post.title)}</h3><p>${esc(isCalendar?post.description:post.body)}</p></div>${isAdmin()?`<div class="news-admin"><button class="icon-btn" data-action="edit-publication" data-kind="${isCalendar?'event':post.kind}" data-index="${post._index}" aria-label="Editar ${isCalendar?'evento':'publicación'}" title="Editar">${I('edit',16)}</button><button class="icon-btn danger" data-action="remove-publication" data-kind="${isCalendar?'event':post.kind}" data-index="${post._index}" aria-label="Eliminar ${isCalendar?'evento':'publicación'}" title="Eliminar">${I('trash',16)}</button></div>`:''}</article>`).join('')}</div>`:quietEmpty(isCalendar?'Todavía no hay eventos':'Todavía no hay publicaciones',isCalendar?'El calendario aparecerá cuando se publiquen eventos.':'Las novedades, parches y notas aparecerán acá cuando estén disponibles.')}</section>
 ${visibleSection(p,'notes')?`<aside class="project-details"><h3>${I('info',17)} Acerca de este proyecto</h3><div class="detail-line"><span>Estado</span><strong>${available?'Disponible':'Próximamente'}</strong></div><div class="detail-line"><span>Minecraft</span><strong>${esc(p.mc_version||'Sin configurar')} · ${esc(p.engine==='horizon'?'Rust / Horizon':(p.loader||'Vanilla'))}</strong></div><div class="detail-line"><span>Perfiles</span><strong>${p.versions?.length||0}</strong></div><div class="project-micro-info">Minecraft Java: instalación y ejecución local disponibles desde Instancias. Para servidores oficiales se requiere Microsoft.</div>${p.community_url?`<button class="outline-btn full" data-action="open-community" data-id="${attr(p.id)}">${I('external',17)} Comunidad</button>`:''}</aside>`:''}</div>
 </div>`;
}
function quietEmpty(title,desc){return `<div class="quiet-empty">${I('layers',25)}<h3>${esc(title)}</h3><p>${esc(desc)}</p></div>`;}
function profilePage(){if(isGuest())return `<div class="content-inner"><div class="page-heading"><h1>Modo offline</h1></div><section class="surface-card"><p>Nickname: <b>${esc(db.user?.username)}</b>. Podés crear, instalar, jugar e importar tus instancias Java, y gestionar sus mods y resource packs.</p><p class="muted">Las instancias se guardan en este equipo por nickname. Cualquiera que use el mismo nickname local puede abrirlas: no es una cuenta con contraseña. Los servidores premium requieren Microsoft.</p><div class="profile-actions"><button class="primary-btn" data-action="new-personal-instance">${I('plus',16)} Crear instancia</button><button class="outline-btn" data-action="go-instances">Mis instancias</button><button class="outline-btn" data-action="logout">Salir</button></div></section></div>`;return `<div class="content-inner profile-page"><div class="page-heading"><div><span class="page-eyebrow">IDENTIDAD / CUENTA</span><h1>Mi perfil</h1><p>Tu presencia e identidad en el ecosistema VIS Nexo.</p></div><button class="outline-btn" data-action="edit-avatar">${I('edit',17)} Personalizar avatar</button></div>
 <div class="profile-banner portal-profile-banner" ${db.user?.profile_banner&&preview(db.user.profile_banner)?`style="background-image:linear-gradient(90deg,rgba(18,12,35,.9),rgba(20,12,38,.33)),url('${preview(db.user.profile_banner)}');background-position:center;background-size:cover"`:''}><div class="profile-orb"></div><div class="profile-portrait">${userAvatar(116)}<button type="button" class="avatar-overlay-edit" data-action="edit-avatar" aria-label="Cambiar avatar">${I('edit',18)}</button></div><div class="profile-titles"><span class="page-eyebrow">MI CUENTA</span><h2>${esc(displayAccount(db.user?.username))}</h2><div><span class="role-chip">${humanRole(db.user?.role)}</span><span class="role-chip ghost">${esc(names[db.user?.presence]||'Conectado')}</span></div></div></div>
 <div class="profile-stat-row"><div>${I('grid',20)} <strong>${db.projects.length}</strong><span>Proyectos</span></div><div>${I('layers',20)} <strong>${db.instances.length}</strong><span>Instancias</span></div><div>${I('users',20)} <strong>${db.friends.length}</strong><span>Amigos globales</span></div></div>
 <div class="settings-grid"><section class="surface-card"><div class="card-heading">${I('user',21)} Avatar y apariencia</div><p class="muted">Importá una imagen o elegí un emblema abstracto. Los ajustes se guardan en tu cuenta local.</p><div class="profile-actions"><button class="outline-btn" data-action="edit-avatar">${I('image',18)} Abrir editor de avatar</button><button class="subtle-btn" data-action="import-avatar">${I('upload',17)} Importar foto</button><button class="subtle-btn" data-action="import-avatar-layer">${I('layers',17)} Capa superpuesta PNG</button><button class="outline-btn" data-action="import-profile-banner">${I('image',17)} Banner de perfil</button>${db.user?.profile_banner?`<button class="subtle-btn" data-action="clear-profile-asset" data-kind="profile_banner">${I('trash',15)} Quitar banner</button><button class="subtle-btn" data-action="crop-profile-existing" data-kind="profile_banner">${I('crop',15)} Ajustar banner</button>`:''}</div></section><section class="surface-card"><div class="card-heading">${I('game',21)} Skin de Minecraft</div><p class="muted">Importá una skin Minecraft PNG 64×64 o 64×32 para tu biblioteca local. Para aplicarla a tu personaje oficial necesitás Microsoft.</p>${db.user?.skin&&preview(db.user.skin)?`<img class="mc-skin-preview" src="${preview(db.user.skin)}" alt="Skin local importada"/>`:''}<div class="profile-actions"><button class="outline-btn" data-action="import-skin">${I('upload',18)} Importar skin PNG</button><button class="outline-btn" data-action="import-cape">${I('upload',18)} Importar capa local</button>${db.user?.skin?`<button class="subtle-btn" data-action="clear-profile-asset" data-kind="skin">${I('trash',16)} Quitar skin</button>`:''}${db.user?.cape?`<button class="subtle-btn" data-action="clear-profile-asset" data-kind="cape">${I('trash',16)} Quitar capa</button>`:''}</div><small class="muted">Las capas locales NO se muestran automáticamente en servidores oficiales.</small></section><section class="surface-card"><div class="card-heading">${I('layers',21)} Instancias</div><p class="muted">Administrá la memoria y las versiones de las instancias de tu equipo.</p><button class="outline-btn" data-action="go-instances">Ver mis instancias ${I('arrow',17)}</button></section><section class="surface-card"><div class="card-heading">${I('shield',21)} Acceso y privacidad</div><p class="muted">Cuenta local protegida con Argon2id. Microsoft se conectará posteriormente.</p><button class="outline-btn" data-action="logout">${I('logout',17)} Cerrar sesión</button></section></div></div>`;}
function isProjectPaused(p){return !!p && Array.isArray(db.paused_projects) && db.paused_projects.includes(p.id);}
function isExecutionEnabled(p){return !!p?.installable && db.project_execution?.[p.id]!==false && !isProjectPaused(p) && (!isGuest()||p.engine!=='horizon');}
function projectContentCount(p){return (p?.required_mods?.length||0)+(p?.required_resourcepacks?.length||0)+(p?.required_shaders?.length||0);}
function selectedMcInstance(){const items=isGuest()?ownedInstances():db.instances;return items.find(i=>i.project_id===mcSelected?.projectId&&i.name===mcSelected?.name)||(libraryMode==='user'?items.find(i=>i.project_id===PERSONAL_PROJECT_ID):items.find(i=>i.project_id!==PERSONAL_PROJECT_ID))||items[0]||null;}
function instanceLine(i){const p=db.projects.find(p=>p.id===i.project_id);const allow=i.project_id===PERSONAL_PROJECT_ID || isExecutionEnabled(p);
 return `<article class="instance-card"><div class="instance-visual">${instanceIcon(i,27)}</div><div class="instance-descriptor"><h3>${esc(i.name)}</h3><p>${esc(p?.title||(i.project_id===PERSONAL_PROJECT_ID?'Biblioteca personal':i.project_id))} · ${esc(i.version||'Sin versión')} · ${esc(i.engine==='horizon'?'Horizon Rust':(i.loader||'vanilla'))} ${esc(i.loader_version||'')} · ${(i.ram_mb/1024).toFixed(1)} GB RAM</p>${i.source_owner?`<small>Instalada por ${esc(i.source_owner)} · partidas separadas para tu perfil</small>`:''}<small class="vis-instance-nickname">Jugador en modo local: <strong>${esc(i.source_owner?db.user?.username:(i.player_name||db.user?.username||'Por configurar'))}</strong></small><span class="instance-notice ${i.installed?'mc-ok':''}">${i.installed?'Instalación preparada':'Sin instalar'}${allow?'':isProjectPaused(p)?' · Pausada por vos':' · Bloqueado por VIS STUDIOS'}</span></div>
 <div class="mc-instance-actions">${i.source_owner?'':`<button class="outline-btn" data-action="manage-instance" data-id="${attr(i.name)}" data-project="${attr(i.project_id)}">${I('settings',16)} Mods y archivos</button>
 <button class="outline-btn" data-action="import-instance-icon" data-id="${attr(i.name)}" data-project="${attr(i.project_id)}">${I('image',16)} Cambiar icono</button>
 ${i.installed&&projectContentCount(p)>0?`<button class="outline-btn" data-action="sync-project-content" data-id="${attr(i.name)}" data-project="${attr(i.project_id)}" ${!allow||minecraftBusy?'disabled':''}>${I('package',16)} Actualizar mods</button>`:''}
 <button class="outline-btn" data-action="install-minecraft" data-id="${attr(i.name)}" data-project="${attr(i.project_id)}" ${!allow||minecraftBusy?'disabled':''}>${I('upload',16)} ${i.installed?'Reparar':'Instalar'}</button>`}
 <button class="primary-btn" data-action="launch-minecraft" data-id="${attr(i.name)}" data-project="${attr(i.project_id)}" data-source="${attr(i.source_owner||'')}" ${!i.installed||!allow||minecraftBusy?'disabled':''}>${I('play',17)} Jugar</button>
 ${i.source_owner&&!isGuest()?`<button class="outline-btn" data-action="shared-ram" data-id="${attr(i.name)}" data-project="${attr(i.project_id)}" data-source="${attr(i.source_owner)}">${I('settings',16)} RAM</button>`:''}
 ${i.source_owner?'':`<button class="icon-btn" data-action="export-worlds-instance" data-id="${attr(i.name)}" data-project="${attr(i.project_id)}" title="Exportar instancia completa a ZIP" aria-label="Exportar ${attr(i.name)}">${I('upload',16)}</button>`}
 ${i.source_owner?'':`<button class="icon-btn" data-action="duplicate-instance" data-id="${attr(i.name)}" data-project="${attr(i.project_id)}" title="Duplicar configuración sin copiar mundos" aria-label="Duplicar ${attr(i.name)}">${I('layers',16)}</button><button class="icon-btn" data-action="edit-instance" data-id="${attr(i.name)}" data-project="${attr(i.project_id)}" title="Ajustar instancia">${I('edit',16)}</button><button class="icon-btn danger" data-action="delete-instance" data-id="${attr(i.name)}" data-project="${attr(i.project_id)}" title="Eliminar instancia">${I('trash',18)}</button>`}</div></article>`;
}
function minecraftExitNotice(){
 if(!lastMinecraftExit || lastMinecraftExit.success)return '';
 return `<section class="surface-card vis-crash-notice" role="alert">
 <div class="card-heading">${I('info',20)} Minecraft se cerró inesperadamente</div>
 <p>Proceso ${esc(lastMinecraftExit.pid)} · Código ${esc(lastMinecraftExit.exit_code??'desconocido')}${lastMinecraftExit.error?` · ${esc(lastMinecraftExit.error)}`:''}</p>
 <p class="muted">Revisá los logs para identificar mods incompatibles, Java faltante o errores gráficos. VIS no borra archivos del juego al detectar un crash.</p>
 <code class="vis-crash-path">${esc(lastMinecraftExit.log_file)}</code>
 <button class="outline-btn" data-action="dismiss-launch-diagnostic">Cerrar diagnóstico</button>
 </section>`;
}
function instancesPage(){const items=libraryMode==='user'?personalInstances():officialInstances();return `<div class="content-inner"><div class="page-heading"><div><span class="page-eyebrow">MINECRAFT / INSTANCIAS</span><h1>${libraryMode==='user'?'Mis instancias':'Instancias de Universe'}</h1><p>${isGuest()?'Creá e instalá Minecraft Java Vanilla o Fabric. Cada nickname offline conserva sus mundos por separado.':'Instalá Minecraft Java (Vanilla/Fabric) o prepará Horizon Rust Edition sin utilizar su launcher.'}</p></div><div class="vis-instance-toolbar"><button class="outline-btn" data-action="import-worlds-instance">${I('upload',18)} Importar ZIP VIS</button><button class="primary-btn" data-action="open-instance" ${libraryMode==='user'||db.projects.length?'':'disabled'}>${I('plus',18)} Nueva instancia</button></div></div>
 ${minecraftBusy?`<div class="mc-progress" id="minecraft-progress">${I('upload',16)} ${esc(installProgress?.detail||'Preparando descarga...')}</div>`:''}
 <aside class="vis-smart-tip">${I('info',17)} <div><strong>VIS Smart Install</strong><span>Si ya tenés esta versión en Minecraft oficial, CurseForge, Prism o VIS Worlds, se intentarán copiar únicamente los archivos comprobados por SHA-1. El resto se descarga normalmente.</span></div></aside>
 ${minecraftExitNotice()}
 ${items.length?`<div class="instance-list">${items.map(instanceLine).join('')}</div>`:quietEmpty('Sin instancias configuradas',libraryMode==='user'?'Creá un Minecraft personal sin depender de un proyecto del administrador.':isGuest()?'Necesitás una instancia Java instalada en cualquiera de los perfiles locales de VIS.':'Elegí un proyecto habilitado, seleccioná la versión de Minecraft y creá tu primera instancia.')}</div>`;}
function minecraftPage(){const i=selectedMcInstance();const p=db.projects.find(x=>x.id===i?.project_id);
 if(i?.loader!=='fabric'&&modKind==='mod')modKind='resourcepack';
 return `<div class="content-inner mc-manager"><div class="page-heading"><div><span class="page-eyebrow">VIS WORLDS · MOTORES</span><h1>Centro de Minecraft</h1><p>Buscá mods compatibles, importá tus JARs y administrá recursos sin abrir carpetas a mano.</p></div><button class="outline-btn" data-action="go-instances">${I('layers',16)} Instancias</button></div>
 ${!i?quietEmpty('Primero creá una instancia','Desde Instancias elegí un proyecto, la versión oficial de Minecraft y Fabric o Vanilla.'):
 `<section class="surface-card mc-profile-card"><div><span class="page-eyebrow">PERFIL ACTIVO</span><h2>${esc(i.name)}</h2><p>${esc(p?.title||(i.project_id===PERSONAL_PROJECT_ID?'Biblioteca personal':'Proyecto'))} · Minecraft ${esc(i.version)} · ${esc(i.engine==='horizon'?'Horizon Rust':i.loader==='fabric'?'Fabric '+(i.loader_version||''):'Vanilla')}</p></div><select id="mc-active-instance" aria-label="Seleccionar instancia">${(isGuest()?ownedInstances():db.instances).map(x=>`<option value="${attr(x.project_id+'|'+x.name)}" ${x===i?'selected':''}>${esc(x.name)} · ${esc(x.version)}</option>`).join('')}</select><button class="primary-btn" data-action="launch-minecraft" data-id="${attr(i.name)}" data-project="${attr(i.project_id)}" data-source="${attr(i.source_owner||'')}" ${!i.installed||(p&&!isExecutionEnabled(p))?'disabled':''}>${I('play',17)} Jugar</button></section>
 ${i.engine==='horizon'?`<section class="surface-card vis-horizon-diagnostic"><div class="card-heading">${I('info',20)} Diagnóstico de Horizon</div><p>Este motor usa <strong>horizon-client</strong> directamente. Los mods .hmod/.hnmod no funcionan como JARs Fabric; su instalador especializado está pendiente.</p><button class="outline-btn" data-action="horizon-check" data-id="${attr(i.name)}" data-project="${attr(i.project_id)}">${I('check',17)} Comprobar requisitos y recursos</button>
 ${horizonChecks.length?`<ul class="vis-horizon-check-list">${horizonChecks.map(c=>`<li class="vis-horizon-check-item ${c.status==='ok'?'vis-horizon-success':c.status==='missing'?'vis-horizon-missing':'vis-horizon-manual'}"><strong>${esc(c.label)}</strong><small>${esc(c.detail)}</small></li>`).join('')}</ul>`:''}</section>`:''}
 ${i.engine==='horizon'?'':projectContentCount(p)>0?`<section class="surface-card mc-project-content"><div class="card-heading">${I('package',19)} Contenido definido por VIS STUDIOS</div><p class="muted">${projectContentCount(p)} recursos oficiales del proyecto. Sincronizalos sin borrar mundos ni mods personales.</p><button class="outline-btn" data-action="sync-project-content" data-id="${attr(i.name)}" data-project="${attr(i.project_id)}" ${!i.installed||!isExecutionEnabled(p)||minecraftBusy?'disabled':''}>${I('upload',16)} Sincronizar mods y packs</button></section>`:''}${i.engine==='horizon'?'':`<div class="mc-manager-grid"><section class="surface-card"><div class="card-heading">${I('search',20)} Explorar Modrinth</div>
 <form id="modrinth-search-form" class="mc-search-form"><div class="mc-filter-row"><select name="kind" id="mc-mod-kind"><option value="mod" ${modKind==='mod'?'selected':''} ${i.loader==='fabric'?'':'disabled'}>Mods Fabric</option><option value="resourcepack" ${modKind==='resourcepack'?'selected':''}>Resource packs</option><option value="shader" ${modKind==='shader'?'selected':''}>Shaders</option></select><span class="mc-version-chip">MC ${esc(i.version)}</span></div><div class="mc-search-box"><input name="query" maxlength="120" placeholder="Sodium, Fabric API, Iris..." value="${attr(modSearchQuery)}" aria-label="Buscar mods"/><button class="primary-btn" ${!native?'title="Requiere Tauri"':''}>${I('search',17)} Buscar</button></div></form>
 <div class="mc-results">${modResults.length?modResults.map(m=>`<article class="mc-result"><div class="mc-result-icon">${I('package',22)}</div><div><h3>${esc(m.title)}</h3><p>${esc(m.description)}</p><small>${Number(m.downloads||0).toLocaleString('es-AR')} descargas · compatible con MC ${esc(i.version)}</small></div><button data-action="install-modrinth" data-id="${attr(m.id)}" title="Instalar versión compatible">${I('plus',17)} Instalar</button></article>`).join(''):'<p class="muted">Resultados compatibles según versión y loader. Buscá para empezar.</p>'}</div></section>
 <section class="surface-card mc-files"><div class="card-heading">${I('folder',20)} Recursos instalados</div><p class="muted">Copias locales independientes por instancia; podés eliminar sin tocar el proyecto principal.</p><div class="mc-file-buttons"><button class="outline-btn" data-action="import-instance-resource" data-kind="mod" ${i.loader==='fabric'?'':'disabled'}>${I('upload',16)} Importar JAR</button><button class="outline-btn" data-action="import-instance-resource" data-kind="resourcepack">${I('upload',16)} Texture pack ZIP</button><button class="outline-btn" data-action="import-instance-resource" data-kind="shader">${I('upload',16)} Shader ZIP</button></div>
 <div class="mc-local-files">${installedFiles.length?installedFiles.map(f=>`<div class="mc-file-entry"><span>${I('package',15)} ${esc(f.file)} <small>${esc(f.kind)} · ${f.enabled===false?'Desactivado':'Activo'}</small></span><div class="mc-file-actions"><button data-action="toggle-instance-file" data-kind="${attr(f.kind)}" data-file="${attr(f.file)}" aria-label="${f.enabled===false?'Activar':'Desactivar'} ${attr(f.file)}" title="${f.enabled===false?'Activar':'Desactivar'} sin eliminar">${I(f.enabled===false?'play':'pause',16)}</button><button data-action="remove-instance-file" data-kind="${attr(f.kind)}" data-file="${attr(f.file)}" aria-label="Eliminar ${attr(f.file)}">${I('trash',16)}</button></div></div>`).join(''):'<p class="muted">Sin mods ni packs importados.</p>'}</div></section></div>`}
 ${minecraftExitNotice()}
 <div class="mc-disclaimer">${I('info',17)} Las cuentas locales ejecutan Minecraft en modo sin autenticación oficial (pruebas/singleplayer). Para acceder a servidores online-mode, skins y capas oficiales se requiere Microsoft OAuth.</div>`}</div>`;}
function settingsPage(){if(isGuest())return `<div class="content-inner"><div class="page-heading"><div><span class="page-eyebrow">PREFERENCIAS LOCALES</span><h1>Configuración offline</h1><p>Los mundos y las instancias pertenecen a este nickname local. No necesitás crear una cuenta VIS.</p></div></div><div class="settings-grid"><section class="surface-card"><div class="card-heading">${I('game',20)} VIS Worlds</div><p class="muted">Minecraft Java Vanilla o Fabric, mods, shaders y resource packs.</p><button class="primary-btn" data-action="new-personal-instance">${I('plus',16)} Nueva instancia</button><button class="outline-btn" data-action="go-instances">Administrar instancias</button></section><section class="surface-card"><div class="card-heading">${I('monitor',20)} Rendimiento y apariencia</div><label class="toggle-line"><span><b>Reducir animaciones</b><small>Menos movimiento decorativo y menor carga visual.</small></span><input type="checkbox" id="reduced-motion" ${prefs.reducedMotion?'checked':''}/></label></section><section class="surface-card"><div class="card-heading">${I('shield',20)} Privacidad y acceso</div><p class="muted">El nickname offline no tiene contraseña, no da permisos de VIS STUDIOS y no autoriza servidores Minecraft premium.</p><button class="outline-btn" data-action="logout">Salir del perfil offline</button></section></div></div>`;return `<div class="content-inner"><div class="page-heading"><div><span class="page-eyebrow">PREFERENCIAS</span><h1>Configuración</h1><p>Personalizá la experiencia del launcher.</p></div></div><div class="settings-grid">
 ${updateSection()}${isAdmin()?`<section class="surface-card cloud-settings"><div class="card-heading">${I('cloud',20)} Publicación de VIS Universe</div><p class="muted">URL HTTPS del JSON público en GitHub Pages o Cloudflare R2. Se configura localmente; para distribuirla a todos, incluí VIS_CATALOG_URL al compilar el launcher.</p><form id="cloud-catalog-form" class="settings-form"><label class="field-label">Dirección del catálogo<input type="url" name="url" placeholder="https://usuario.github.io/vis/catalog.json" value="${attr(cloudCatalog?.source||'')}"/></label><button class="outline-btn">Guardar catálogo</button></form><form id="universe-publish-form" class="settings-form"><label class="field-label">Credencial de publicación del servidor (no se guarda)<input type="password" name="token" minlength="32" autocomplete="off" required placeholder="Credencial Cloudflare Worker"/></label><button class="primary-btn">Publicar proyectos y novedades</button><small>Publica los proyectos locales de VIS STUDIOS en el catálogo central. Los usuarios recibirán los cambios cuando abran VIS.</small></form></section>`:''}<section class="surface-card"><div class="card-heading">${I('monitor',21)} Rendimiento</div><label class="toggle-line"><span><b>Reducir animaciones</b><small>Evita movimientos decorativos innecesarios.</small></span><input type="checkbox" id="reduced-motion" ${prefs.reducedMotion?'checked':''}/></label><label class="toggle-line"><span><b>Panel de amigos</b><small>Mostrar el panel social a la derecha.</small></span><input type="checkbox" id="social-visibility" ${socialVisible?'checked':''}/></label></section>
 <section class="surface-card"><div class="card-heading">${I('database',21)} VIS Maintenance</div><p class="muted">Analizá espacio recuperable de forma segura, sin tocar mundos, mods, cuentas ni conversaciones.</p><button class="outline-btn" data-action="go-maintenance">${I('sliders',17)} Abrir centro de mantenimiento</button></section>
 <section class="surface-card"><div class="card-heading">${I('shield',21)} Estado de integraciones</div><div class="detail-line"><span>Cliente Tauri 2</span><strong class="success-text">Interfaz local</strong></div><div class="detail-line"><span>Inicio de sesión</span><strong class="success-text">Local Argon2id</strong></div><div class="detail-line"><span>Microsoft OAuth</span><strong>Por conectar</strong></div><div class="detail-line"><span>Minecraft installer</span><strong>Motor local Vanilla / Fabric</strong></div><div class="detail-line"><span>Chat por Internet</span><strong>Por conectar</strong></div></section>
 ${isAdmin()?`<section class="surface-card wide"><div class="card-heading">${I('sliders',21)} Identidad del launcher</div><p class="muted">El acceso utiliza un fondo violeta sólido. Podés personalizar la marca con el editor de imágenes.</p><form id="brand-form" class="settings-form"><label class="field-label">Nombre del launcher<input name="name" maxlength="40" value="${attr(db.branding?.name||'VIS Nexo')}"/></label><button class="outline-btn">Guardar nombre</button></form><div class="asset-settings"><button class="asset-setting" data-action="import-launcher-logo">${I('upload',17)} Logo del launcher</button><button class="asset-setting" data-action="import-home">${I('image',17)} Portada de Inicio</button>${db.branding?.home_image?`<button class="asset-setting" data-action="clear-client-asset" data-kind="home">${I('trash',16)} Quitar portada</button>`:''}${db.branding?.launcher_logo?`<button class="asset-setting" data-action="clear-client-asset" data-kind="launcher_logo">${I('trash',16)} Quitar logo del launcher</button>`:''}</div></section>`:''}
 </div></div>`;}
function fmtBytes(n){const v=Number(n||0);if(v<1024)return `${v} B`;if(v<1048576)return `${(v/1024).toFixed(1)} KB`;if(v<1073741824)return `${(v/1048576).toFixed(1)} MB`;return `${(v/1073741824).toFixed(2)} GB`;}
function maintenancePage(){
 const report=maintenanceReport;
 return `<div class="content-inner vis-maintenance"><div class="page-heading"><div><span class="page-eyebrow">VIS / MANTENIMIENTO</span><h1>VIS Maintenance</h1><p>Control de temporales, diagnósticos y logs de esta computadora. No modifica datos en la nube.</p></div><button class="outline-btn" data-action="go-settings">${I('chevron',16)} Volver a ajustes</button></div>
 <section class="surface-card maintenance-intro"><div class="maintenance-total"><span class="page-eyebrow">ESPACIO RECUPERABLE</span><strong>${report?fmtBytes(report.total_bytes):'—'}</strong><small>${report?`${report.total_files} archivos candidatos`:'Ejecutá el análisis para conocer los archivos vencidos'}</small></div><div class="maintenance-controls"><button class="outline-btn" data-action="maintenance-preview" ${maintenanceLoading||!native?'disabled':''}>${I('search',17)} ${maintenanceLoading?'Analizando...':'Analizar archivos'}</button><button class="danger-btn" data-action="maintenance-clean" ${maintenanceLoading||!native||!report?.total_files?'disabled':''}>${I('trash',17)} Limpiar vencidos</button></div></section>
 <div class="maintenance-grid">${(report?.areas||[{label:'Temporales VIS',retained_days:3},{label:'Descargas incompletas',retained_days:7},{label:'Diagnósticos antiguos',retained_days:90},{label:'Logs del launcher',retained_days:30}]).map(area=>`<section class="surface-card maintenance-area"><span class="page-eyebrow">RETENCIÓN ${area.retained_days} DÍAS</span><h3>${esc(area.label)}</h3><strong>${fmtBytes(area.candidate_bytes)}</strong><small>${area.candidate_files||0} archivos para revisión</small></section>`).join('')}</div>
 <section class="surface-card maintenance-safe"><h3>${I('shield',19)} Archivos protegidos</h3><p>No se inspeccionan ni borran cuentas, chats, mundos, instancias, mods, texturas, bibliotecas Minecraft, proyectos o banners. Se ignoran enlaces simbólicos y archivos recientes.</p><p class="muted">Los historiales de chat de VIS Humile se depurarán solamente desde el servicio cloud, con respaldos y avisos a los usuarios. Esa función no está conectada todavía.</p>${!native?'<p class="muted">La vista previa de navegador no tiene acceso a archivos locales.</p>':''}</section></div>`;
}
async function loadMaintenance(){
 if(!native){maintenanceReport=null;render();return;}
 maintenanceLoading=true;render();
 try{maintenanceReport=await command('maintenance_preview');}
 catch(e){maintenanceReport=null;message(String(e),true);}
 finally{maintenanceLoading=false;render();}
}
async function cleanMaintenance(){
 if(!native)return message('La limpieza requiere ejecutar VIS Nexo desde Tauri.',true);
 if(!maintenanceReport?.total_files)return message('No hay archivos vencidos para borrar.');
 if(!confirm(`Se eliminarán hasta ${maintenanceReport.total_files} archivos temporales y logs antiguos (${fmtBytes(maintenanceReport.total_bytes)}). Los datos de Minecraft y chats están excluidos. ¿Confirmás?`))return;
 maintenanceLoading=true;render();
 try{const result=await command('maintenance_clean',{confirmed:true});message(`Se liberaron ${fmtBytes(result.freed_bytes)} (${result.deleted_files} archivos).`);maintenanceReport=await command('maintenance_preview');}
 catch(e){message(String(e),true);maintenanceReport=null;}
 finally{maintenanceLoading=false;render();}
}
function assetsPage(){if(isGuest())return `<div class="content-inner"><h1>Recursos</h1><p>Iniciá sesión para administrar recursos visuales.</p></div>`;return `<div class="content-inner"><div class="page-heading"><div><span class="page-eyebrow">BIBLIOTECA DE RECURSOS</span><h1>Recursos visuales</h1><p>Importá las imágenes desde el explorador, sin escribir rutas manualmente.</p></div></div><div class="assets-grid">${db.projects.map(p=>`<article class="surface-card"><div class="asset-preview" ${p.banner_path?bgPhoto(p.banner_path):''}>${!p.banner_path?I('image',36):''}</div><h3>${esc(p.title)}</h3><p class="muted">Banner y logo del proyecto</p><button class="outline-btn" data-action="edit-project" data-id="${attr(p.id)}">Abrir gestor ${I('arrow',16)}</button></article>`).join('')}
 <div class="surface-card assets-card"><div class="asset-preview placeholder">${I('upload',36)}</div><h3>Recursos del cliente</h3><p class="muted">Logo y portada de Inicio configurables desde Ajustes.</p><button class="outline-btn" data-action="go-settings">Abrir configuración</button></div></div></div>`;}
function cloudPage(){
 const items=Array.isArray(cloudCatalog?.projects)?cloudCatalog.projects:[];
 return `<div class="content-inner vis-cloud"><div class="page-heading"><div><span class="page-eyebrow">VIS UNIVERSE / PUBLICACIÓN</span><h1>Proyectos en la nube</h1><p>Catálogo compartido alojado por HTTPS. Los proyectos locales y mundos nunca se sobrescriben.</p></div><button class="outline-btn" data-action="refresh-cloud" ${cloudCatalogBusy?'disabled':''}>${I('cloud',18)} ${cloudCatalogBusy?'Conectando…':'Actualizar catálogo'}</button></div>
 <section class="surface-card cloud-guide"><div>${I('cloud',24)}<h3>Distribución sin alojar en tu PC</h3><p>Publicá el catálogo en GitHub Pages y los paquetes de proyecto en GitHub Releases o VIS Ombú (R2). Los clientes descargarán desde allí; no reciben cambios hasta que publicás una versión nueva.</p></div><span class="cloud-label">${cloudCatalog?.source?'Catálogo conectado':'Falta configurar URL'}</span></section>
 ${cloudCatalog?.source?`<p class="muted">Origen: ${esc(cloudCatalog.source)} · ${items.length} proyectos disponibles</p>`:`<p class="muted">La URL pública se configura al compilar desde <code>VIS_CATALOG_URL</code>, o por un administrador desde Configuración.</p>`}
 <div class="cloud-project-grid">${items.map(p=>`<article class="surface-card cloud-project"><div class="cloud-project-top">${I('layers',24)}<span>${esc(p.version||'Sin versión')}</span></div><h3>${esc(p.name)}</h3><p>${esc(p.description||'Proyecto de VIS Universe')}</p><div class="cloud-project-meta"><span>${I('game',14)} Minecraft ${esc(p.minecraft_version||'—')}</span><span>${esc(p.loader||'vanilla')}</span></div>${p.bundle_url?`<button class="outline-btn" data-action="download-cloud-bundle" data-id="${attr(p.id)}">${I('cloud',16)} Descargar paquete</button>`:'<small>Sin archivo publicado</small>'}</article>`).join('')||'<div class="quiet-empty">'+I('cloud',25)+'<h3>No hay publicaciones todavía</h3><p>Conectá un catálogo público para mostrar proyectos disponibles.</p></div>'}</div>
 </div>`;
}
function updateSection(){return `<section class="surface-card update-card"><div class="card-heading">${I('cloud',20)} VIS Nexo · Actualizaciones</div><p class="muted">${updateInfo?.configured?`Versión instalada: ${esc(updateInfo.current_version)}. ${updateInfo.available?'Nueva versión '+esc(updateInfo.version)+' disponible.':'Sin actualizaciones detectadas.'}`:'Las actualizaciones firmadas se activan al configurar el repositorio y la clave pública de firma durante la compilación.'}</p>${updateInfo?.notes?`<p class="muted">${esc(updateInfo.notes)}</p>`:''}<div class="update-actions"><button class="outline-btn" data-action="check-update" ${updateBusy?'disabled':''}>${I('cloud',16)} ${updateBusy?'Comprobando…':'Buscar actualizaciones'}</button>${updateInfo?.available?`<button class="primary-btn" data-action="install-update" ${updateBusy?'disabled':''}>${I('cloud',17)} Instalar versión ${esc(updateInfo.version)}</button>`:''}</div><small>Se conserva la carpeta de datos y el identificador de aplicación anterior para preservar proyectos, mundos y perfiles.</small></section>`;}
async function checkAppUpdate(silent=false){if(!native)return;if(updateBusy)return;updateBusy=true;if(!silent)render();try{updateInfo=await command('check_app_update');if(updateInfo.available)message(`VIS Nexo ${updateInfo.version} disponible`);else if(!silent)message(updateInfo.configured?'Ya tenés la última versión.':'Las actualizaciones todavía no están configuradas.');}catch(e){if(!silent)message(String(e),true);}finally{updateBusy=false;if(!silent||page==='settings')render();}}
async function installAppUpdate(){if(!native)return;if(!updateInfo?.available)return;if(!confirm('¿Instalar la actualización firmada de VIS Nexo? Antes se guardará una copia de seguridad de tus preferencias. Los mundos y las instancias se conservan.'))return;updateBusy=true;render();try{await command('install_app_update',{confirmed:true});message('Actualización instalada. Reiniciá VIS Nexo si es necesario.');}catch(e){message(String(e),true);}finally{updateBusy=false;render();}}
async function refreshCloudCatalog(silent=false){if(!native)return;if(cloudCatalogBusy)return;cloudCatalogBusy=true;if(!silent)render();try{db=await command('sync_universe');cloudCatalog=await command('fetch_cloud_catalog');await refreshAssets();if(!silent)message(`Catálogo actualizado: ${cloudCatalog.projects?.length||0} proyectos`);}catch(e){if(!silent)message(String(e),true);}finally{cloudCatalogBusy=false;render();}}
async function downloadCloudBundle(id){const project=cloudCatalog?.projects?.find(p=>p.id===id);if(!project||!confirm(`¿Descargar el archivo de ${project.name}? Se guardará en VIS/descargas. El archivo no se ejecutará automáticamente.`))return;try{const path=await command('download_cloud_bundle',{projectId:id});message(`Paquete descargado: ${path}`);}catch(e){message(String(e),true);}}
function downloadDock(){
 if(!minecraftBusy)return '';
 const progress=installProgress||{stage:'init',completed:0,total:0,detail:'Preparando instalación'};
 const total=Number(progress.total)||0,completed=Math.max(0,Math.min(total,Number(progress.completed)||0));
 const pct=total?Math.min(100,Math.round(completed*100/total)):0;
 const stage={libraries:'Bibliotecas y versión',indexes:'Índice de recursos',assets:'Archivos de Minecraft',java:'Java',done:'Instalación completada'}[progress.stage]||'Preparación';
 return `<aside class="vis-download-dock" id="vis-download-dock" role="status" aria-live="polite"><div class="vis-download-head"><span>${I('upload',15)} <b>Instalando Minecraft · ${esc(stage)}</b></span><strong id="vis-download-percent">${total?pct+'%':'…'}</strong></div><div class="vis-download-track" role="progressbar" aria-label="Progreso de etapa" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span id="vis-download-fill" style="width:${pct}%"></span></div><small id="vis-download-detail">${esc(progress.detail||'Preparando archivos')} ${total?`· ${completed}/${total} archivos de esta etapa`:''}</small></aside>`;
}
function updateDownloadDock(){
 const bar=root.querySelector('#vis-download-dock');if(!bar)return;
 const p=installProgress||{};const count=Number(p.total)||0;const done=Math.max(0,Math.min(count,Number(p.completed)||0));const pct=count?Math.round(done*100/count):0;
 const stage={libraries:'Bibliotecas y versión',indexes:'Índice de recursos',assets:'Archivos de Minecraft',java:'Java',done:'Instalación completada'}[p.stage]||'Preparación';
 const headline=bar.querySelector('b');if(headline)headline.textContent='Instalando Minecraft · '+stage;
 const percent=bar.querySelector('#vis-download-percent');if(percent)percent.textContent=count?pct+'%':'…';
 const fill=bar.querySelector('#vis-download-fill');if(fill)fill.style.width=pct+'%';
 const track=bar.querySelector('.vis-download-track');if(track)track.setAttribute('aria-valuenow',String(pct));
 const detail=bar.querySelector('#vis-download-detail');if(detail)detail.textContent=String(p.detail||'Preparando archivos')+(count?` · ${done}/${count} archivos de esta etapa`:'');
}
function shell(){return `<div class="app-shell ${socialVisible&&!isGuest()?'has-social':''}">${sidebar()}<div class="main-column">${header()}<main class="main-scroll" id="main-scroll">${page==='home'?homePage():page==='project'?projectPage():page==='profile'?profilePage():page==='instances'?instancesPage():page==='minecraft'?minecraftPage():page==='settings'?settingsPage():page==='maintenance'?maintenancePage():page==='cloud'?cloudPage():assetsPage()}</main></div>${isGuest()?'':socialPanel()}</div>${downloadDock()}${contextMenu?contextMenuView():''}${dialog?dialogView():''}`;}
function contextMenuView(){const p=db.projects.find(p=>p.id===contextMenu.id);if(!p||!isAdmin())return '';return `<div class="context-menu" style="left:${Math.min(contextMenu.x,innerWidth-230)}px;top:${Math.min(contextMenu.y,innerHeight-170)}px"><div class="context-title">${esc(p.title)}</div><button data-action="edit-project" data-id="${attr(p.id)}">${I('edit',16)} Editar proyecto</button><button data-action="open-project" data-id="${attr(p.id)}">${I('external',16)} Abrir página</button><button data-action="toggle-project-execution" data-id="${attr(p.id)}">${I('shield',16)} ${db.project_execution?.[p.id]===false?'Habilitar Minecraft':'Bloquear Minecraft'}</button><button class="destructive" data-action="delete-project" data-id="${attr(p.id)}">${I('trash',16)} Eliminar proyecto</button></div>`;}
function newProject(){return {id:'',title:'',subtitle:'',description:'',versions:[],page_scene_id:null,mc_version:'',engine:'java',loader:'vanilla',loader_version:'',required_mods:[],required_resourcepacks:[],required_shaders:[],banner_path:'',logo_path:'',icon_path:'',notes:'',community_url:'',installable:true,visible_sections:{},posts:[],calendar:[]};}
function startProject(id=''){
 if(!isAdmin()){message('Solo el administrador puede gestionar proyectos.',true);return;}
 wizard=clone(db.projects.find(p=>p.id===id)||newProject());wizardStep=0;dialog={type:'project'};render();
}
function projectWizard(){
 const stepLabels=['Datos','Identidad visual','Novedades','Revisar'];
 const a=wizard||newProject();
 const step0=`<div class="wiz-fields"><div class="form-pair"><label>Nombre del proyecto<input data-field="title" maxlength="80" value="${attr(a.title)}" placeholder="Nombre del proyecto" autofocus/></label><label>Versión de Minecraft<input list="mc-version-catalog" data-field="mc_version" value="${attr(a.mc_version)}" placeholder="1.21.4"/><datalist id="mc-version-catalog">${minecraftVersions.map(v=>`<option value="${attr(v.id)}">${esc(v.kind)}</option>`).join('')}</datalist></label></div><div class="form-pair"><label>Motor del proyecto<select data-field="engine" id="vis-project-engine"><option value="java" ${(a.engine||'java')==='java'?'selected':''}>Minecraft Java Edition</option><option value="horizon" ${a.engine==='horizon'?'selected':''} ${isGuest()?'disabled':''}>Minecraft Rust Edition — Horizon</option></select></label><label>Modloader<select data-field="loader" id="vis-project-loader" ${a.engine==='horizon'?'disabled':''}><option value="vanilla" ${(a.loader||'vanilla')==='vanilla'?'selected':''}>Vanilla</option><option value="fabric" ${a.loader==='fabric'?'selected':''}>Fabric</option><option value="horizon" ${a.loader==='horizon'?'selected':''}>Horizon nativo</option></select></label></div><label id="vis-project-fabric" class="${a.loader==='fabric'&&a.engine!=='horizon'?'':'hidden'}">Fabric Loader<input data-field="loader_version" id="vis-project-loader-version" list="mc-fabric-catalog" value="${attr(a.loader_version||'')}" placeholder="Versión oficial de Fabric Loader"/><datalist id="mc-fabric-catalog">${fabricLoaders.map(v=>`<option value="${attr(v)}"></option>`).join('')}</datalist></label><p class="muted">Estos parámetros los configura VIS STUDIOS una sola vez. Los jugadores solo eligen una carpeta y la RAM.</p><div class="manage-row-head"><h3>Mods y contenido del proyecto</h3><span>${projectContentCount(a)} recursos</span></div><p class="muted">IDs o slugs de Modrinth separados por coma. VIS instalará las versiones compatibles. Mods solo con Fabric; los packs y shaders son para Java. Máximo 32 recursos por proyecto. Los shaders pueden requerir Iris.</p><label>Mods obligatorios (Fabric)<textarea data-field="required_mods_csv" rows="2" placeholder="fabric-api, sodium, lithium">${esc((a.required_mods||[]).join(', '))}</textarea></label><label>Resource packs<textarea data-field="required_resourcepacks_csv" rows="2" placeholder="nombre-del-pack">${esc((a.required_resourcepacks||[]).join(', '))}</textarea></label><label>Shaders<textarea data-field="required_shaders_csv" rows="2" placeholder="complementary-shaders">${esc((a.required_shaders||[]).join(', '))}</textarea></label><label>Versiones o perfiles (separadas por coma)<input data-field="versions_csv" value="${attr((a.versions||[]).join(', '))}" placeholder="Ej. Survival, Optimizador, 26.3"/></label><label>Subtítulo<input data-field="subtitle" maxlength="180" value="${attr(a.subtitle)}" placeholder="Una frase breve sobre el proyecto"/></label><label>Descripción<textarea data-field="description" maxlength="2000" rows="4" placeholder="Descripción del proyecto">${esc(a.description)}</textarea></label><label class="toggle-line large"><span><b>Permitir configuración de instancias</b><small>Habilita la configuración, instalación y ejecución de Minecraft en este proyecto.</small></span><input type="checkbox" data-field="installable" ${a.installable?'checked':''}/></label></div>`;
 const assets=[['banner_path','banner','Banner del proyecto','Panorámico · 16:9 recomendado'],['logo_path','logo','Logo','PNG o WebP transparente'],['icon_path','icon','Icono de sidebar','Cuadrado · mínimo 128 × 128']];
 const step1=`<p class="wizard-hint">Importá tus imágenes; después podés moverlas, ampliarlas y recortarlas sin modificar el archivo original.</p><div class="asset-picker-grid">${assets.map(([field,kind,label,tip])=>`<div class="asset-tile"><div class="asset-picture ${field}" ${a[field]&&preview(a[field])?`style="background-image:url('${preview(a[field])}')"`:''}>${!preview(a[field])?I('image',27):''}</div><div class="asset-tile-bottom"><div><strong>${label}</strong><small>${tip}</small></div><div class="asset-tile-actions"><button data-action="pick-asset" data-kind="${kind}" data-field="${field}" class="outline-btn small">${I('upload',16)} Importar</button>${a[field]&&preview(a[field])?`<button data-action="crop-asset" data-kind="${kind}" data-field="${field}" class="outline-btn small" title="Mover, ampliar y recortar imagen">${I('crop',16)} Ajustar / recortar</button>`:''}${a[field]?`<button data-action="remove-project-image" data-field="${field}" class="subtle-btn small" title="Quitar esta imagen y mostrar el título si es el logo">${I('trash',15)} Quitar</button>`:''}</div></div></div>`).join('')}</div>`;
 const step2=`<div class="wiz-fields"><label>Notas del proyecto<textarea data-field="notes" rows="3" placeholder="Información general">${esc(a.notes)}</textarea></label><label>Enlace de comunidad<input data-field="community_url" value="${attr(a.community_url)}" placeholder="https://..."/></label>
 <div class="manage-row-head"><h3>Visibilidad de la página</h3></div><p class="muted">Ocultá secciones sin borrar sus noticias, parches o eventos.</p><div class="project-section-switches">${[['news','Noticias'],['patches','Notas de parche'],['updates','Actualizaciones'],['calendar','Eventos'],['community','Comunidad'],['notes','Acerca / Notas']].map(([key,label])=>`<label class="toggle-line section-visibility"><span>${label}</span><input type="checkbox" data-visible="${key}" ${visibleSection(a,key)?'checked':''}></label>`).join('')}</div>
 <div class="manage-row-head"><h3>Novedades y parches</h3><span>${a.posts?.length||0}</span></div><div class="wizard-post-list">${(a.posts||[]).map((p,index)=>`<div class="wizard-post"><b>${esc(p.title)}</b><small>${esc(p.kind)} · ${esc(p.date)}</small><button data-action="remove-post" data-index="${index}" aria-label="Eliminar publicación">${I('x',16)}</button></div>`).join('')}</div>
 <div class="small-form"><select id="post-kind"><option value="news">Novedad</option><option value="patch">Parche</option><option value="update">Actualización</option><option value="community">Comunidad</option></select><input id="post-title" placeholder="Título de la publicación"/><textarea id="post-body" rows="2" placeholder="Contenido"></textarea><button class="outline-btn" data-action="add-post">${I('plus',16)} Agregar publicación</button></div>
 <div class="manage-row-head"><h3>Calendario</h3><span>${a.calendar?.length||0}</span></div><div class="wizard-post-list">${(a.calendar||[]).map((e,index)=>`<div class="wizard-post"><b>${esc(e.title)}</b><small>${esc(e.date)}</small><button data-action="remove-event" data-index="${index}" aria-label="Eliminar evento">${I('x',16)}</button></div>`).join('')}</div>
 <div class="small-form"><input id="event-title" placeholder="Nombre del evento"/><input id="event-date" type="date"/><input id="event-description" placeholder="Descripción"/><button class="outline-btn" data-action="add-event">${I('plus',16)} Agregar evento</button></div></div>`;
 const step3=`<div class="wizard-summary"><div class="summary-banner" ${a.banner_path?bgPhoto(a.banner_path):''}><div>${a.logo_path&&preview(a.logo_path)?`<img class="summary-logo" src="${preview(a.logo_path)}" alt=""/>`:`<h2>${esc(a.title||'Nombre del proyecto')}</h2>`}<span>${esc(a.subtitle||'Sin subtítulo')}</span></div></div><div class="summary-columns"><div><span>Versión MC</span><strong>${esc(a.mc_version||'Sin definir')}</strong></div><div><span>Mods y packs</span><strong>${projectContentCount(a)}</strong></div><div><span>Publicaciones</span><strong>${(a.posts||[]).length}</strong></div><div><span>Eventos</span><strong>${(a.calendar||[]).length}</strong></div><div><span>Estado</span><strong>${a.installable?'Disponible para instancias':'Próximamente'}</strong></div></div><p class="wizard-hint">Al guardar, el proyecto queda local. Desde Configuración → Publicación podés enviarlo al catálogo de VIS Universe.</p></div>`;
 const bodies=[step0,step1,step2,step3];
 return `<div class="modal-backdrop" data-action="modal-backdrop"><div class="dialog modal-wide project-editor-dialog" role="dialog" aria-modal="true" aria-label="Editor de proyectos">
 <header class="modal-head"><div><span class="page-eyebrow">EDITOR DE PROYECTOS</span><h2>${a.id?'Gestionar proyecto':'Crear proyecto'}</h2><p class="wizard-header-subtitle">Completá lo esencial; la vista previa se actualiza al instante.</p></div><button class="icon-btn" data-action="close-modal" aria-label="Cerrar">${I('x',21)}</button></header>
 <div class="wizard-steps">${stepLabels.map((s,i)=>`<button type="button" data-action="wizard-jump" data-index="${i}" class="wizard-step ${i===wizardStep?'active':''} ${i<wizardStep?'done':''}" ${i>wizardStep+1?'disabled':''}><span>${i<wizardStep?I('check',14):i+1}</span>${s}</button>`).join('')}</div>
 <div class="wizard-layout"><div class="modal-body">${bodies[wizardStep]}</div><aside class="wizard-live-preview"><span class="page-eyebrow">VISTA PREVIA</span><div class="wizard-live-banner" ${a.banner_path?bgPhoto(a.banner_path):''}><div class="wizard-live-shade"><span class="wizard-live-kicker">${esc(a.mc_version||'MINECRAFT')}</span><h3 data-live-title>${esc(a.title||'Tu proyecto')}</h3><p data-live-subtitle>${esc(a.subtitle||'Tu descripción aparecerá aquí.')}</p><span class="wizard-live-action">${I('play',14)} ${a.installable?'Configurar instancia':'Próximamente'}</span></div></div><div class="wizard-live-meta"><span class="wizard-live-logo">${a.icon_path&&preview(a.icon_path)?`<img src="${preview(a.icon_path)}" alt=""/>`:I('game',20)}</span><div><strong data-live-name>${esc(a.title||'Nombre del proyecto')}</strong><small>Así se verá en el catálogo</small></div></div><p class="wizard-live-tip">${I('info',15)} Una sola edición actualiza la página, la barra lateral y los accesos del launcher.</p></aside></div>
 <footer class="modal-footer"><button class="subtle-btn" data-action="close-modal">Cancelar</button><div class="modal-footer-right">${wizardStep>0?`<button class="outline-btn" data-action="wizard-back">${I('arrow',16)} Volver</button>`:''}<button class="primary-btn" data-action="${wizardStep===3?'save-project':'wizard-next'}">${wizardStep===3?'Guardar proyecto':'Continuar'} ${I(wizardStep===3?'check':'chevron',17)}</button></div></footer>
 </div></div>`;
}
function quickPublishDialog(){
 const p=db.projects.find(x=>x.id===dialog.projectId);
 if(!p||!isAdmin())return '';
 const edit=Number.isInteger(dialog.index);
 const kind=dialog.kind||'news';
 const original=edit?(kind==='event'?p.calendar?.[dialog.index]:p.posts?.[dialog.index]):null;
 const labels={news:'Noticia',patch:'Nota de parche',update:'Actualización',community:'Comunidad',event:'Evento'};
 const label=labels[kind]||'Publicación';
 return `<div class="modal-backdrop" data-action="modal-backdrop"><div class="dialog modal-medium quick-publish-dialog" role="dialog" aria-modal="true" aria-label="${edit?'Editar':'Publicar'} ${attr(label)}"><header class="modal-head"><div><span class="page-eyebrow">${esc(p.title)} · PUBLICACIONES</span><h2>${edit?'Editar':'Nueva'} ${esc(label.toLowerCase())}</h2></div><button class="icon-btn" data-action="close-modal" aria-label="Cerrar">${I('x',19)}</button></header><form id="quick-publish-form" class="quick-publish-form"><div class="modal-body wiz-fields"><label>Tipo<select name="kind" ${edit?'disabled':''}><option value="news" ${kind==='news'?'selected':''}>Noticia</option><option value="patch" ${kind==='patch'?'selected':''}>Nota de parche</option><option value="update" ${kind==='update'?'selected':''}>Actualización</option><option value="community" ${kind==='community'?'selected':''}>Comunidad</option><option value="event" ${kind==='event'?'selected':''}>Evento</option></select></label><label>Título<input name="title" required maxlength="120" autofocus placeholder="Título de la publicación" value="${attr(original?.title||'')}"/></label><label>Fecha<input type="date" name="date" required value="${attr(original?.date||new Date().toISOString().slice(0,10))}"/></label><label>Descripción<textarea name="body" maxlength="4000" rows="5" placeholder="Explicá qué cambió, qué se agregó o qué va a ocurrir">${esc(original?.body||original?.description||'')}</textarea></label><p class="form-notice">${I('info',16)} Se publica directamente en el catálogo local. La sincronización por Internet se conectará después.</p></div><footer class="modal-footer"><button type="button" class="subtle-btn" data-action="close-modal">Cancelar</button><button type="submit" class="primary-btn">${I('check',17)} ${edit?'Guardar cambios':'Publicar ahora'}</button></footer></form></div></div>`;
}
async function saveQuickPublish(form){
 if(!dialog||dialog.type!=='quick-post'||!isAdmin())return;
 const p=db.projects.find(x=>x.id===dialog.projectId);if(!p)return;
 const data=new FormData(form),kind=String(data.get('kind')||dialog.kind||'news');
 const title=String(data.get('title')||'').trim(),date=String(data.get('date')||'').trim(),body=String(data.get('body')||'').trim();
 if(!title||title.length>120||!/^\d{4}-\d{2}-\d{2}$/.test(date)||body.length>4000){message('Completá correctamente título, fecha y contenido.',true);return;}
 const next=clone(p);
 if(kind==='event'){
  next.calendar=next.calendar||[];
  const ev={title,date,description:body};
  if(Number.isInteger(dialog.index))next.calendar[dialog.index]=ev;else next.calendar.unshift(ev);
 }else{
  next.posts=next.posts||[];
  const post={kind,title,date,body};
  if(Number.isInteger(dialog.index))next.posts[dialog.index]=post;else next.posts.unshift(post);
 }
 const ok=await apply('save_project',{project:next},'Contenido guardado en el proyecto');
 if(ok){dialog=null;activeFeed=kind==='event'?'calendar':kind==='news'?'news':kind==='patch'?'patches':kind==='update'?'updates':'community';render();}
}
function cropDialog(){
 if(!cropState)return '';
 const dims=['icon','avatar'].includes(cropState.kind)?[512,512]:cropState.kind==='logo'?[960,400]:cropState.kind==='profile_banner'?[1280,420]:[1280,720];
 const names={banner:'Portada',logo:'Logo',icon:'Icono',avatar:'Avatar',profile_banner:'Banner de perfil'};
 return `<div class="modal-backdrop" data-action="modal-backdrop"><div class="dialog crop-dialog" role="dialog" aria-modal="true" aria-label="Ajustar y recortar imagen"><header class="modal-head"><div><span class="page-eyebrow">RECURSOS VISUALES · ${names[cropState.kind]||'IMAGEN'}</span><h2>Mover y recortar imagen</h2><p class="wizard-header-subtitle">Arrastrá para posicionar. Ajustá el zoom y guardá una copia recortada.</p></div><button class="icon-btn" data-action="cancel-crop" aria-label="Cerrar">${I('x',20)}</button></header><div class="crop-body"><div class="crop-stage"><canvas id="crop-canvas" width="${dims[0]}" height="${dims[1]}" aria-label="Vista previa interactiva del recorte" tabindex="0"></canvas></div><div class="crop-controls"><label for="crop-zoom">Zoom <output id="crop-zoom-value">${Math.round(cropState.zoom*100)}%</output></label><input type="range" min="1" max="3" step="0.05" id="crop-zoom" value="${cropState.zoom}"/><div class="crop-actions"><button class="subtle-btn" data-action="crop-reset" type="button">${I('circle',15)} Restablecer</button><span>${dims[0]} × ${dims[1]} PNG</span></div></div></div><footer class="modal-footer"><button class="subtle-btn" data-action="cancel-crop">Volver sin guardar</button>${cropState.origin==='profile'?`<button class="outline-btn" data-action="apply-original-profile">Usar original</button>`:''}<button class="primary-btn" data-action="save-crop">${I('crop',17)} Guardar recorte</button></footer></div></div>`;
}
function openCrop(field,kind){
 if(!wizard?.[field]||!preview(wizard[field])){message('Primero importá una imagen.',true);return;}
 acceptWizardInput();
 cropState={field,kind,path:wizard[field],zoom:1,panX:0,panY:0,origin:'project'};cropImage=null;
 dialog={type:'crop'};render();
}
function openPersonalCrop(kind,path){
 if(!path||!preview(path))return message('Primero elegí una imagen.',true);
 cropState={field:kind,kind,path,zoom:1,panX:0,panY:0,origin:'profile'};
 cropImage=null;dialog={type:'crop'};render();
}
function startCropCanvas(){
 if(!cropState)return;
 const uri=preview(cropState.path);if(!uri)return;
 const img=new Image();img.onload=()=>{cropImage=img;paintCrop();};img.onerror=()=>message('No se pudo leer la imagen.',true);img.src=uri;
}
function paintCrop(){
 const canvas=document.querySelector('#crop-canvas');if(!canvas||!cropState||!cropImage?.naturalWidth)return;
 const ctx=canvas.getContext('2d',{alpha:true});if(!ctx)return;
 const cw=canvas.width,ch=canvas.height,iw=cropImage.naturalWidth,ih=cropImage.naturalHeight;
 const factor=Math.max(cw/iw,ch/ih)*cropState.zoom,dw=iw*factor,dh=ih*factor;
 let x=(cw-dw)/2+cropState.panX*cw,y=(ch-dh)/2+cropState.panY*ch;
 x=Math.max(cw-dw,Math.min(0,x));y=Math.max(ch-dh,Math.min(0,y));
 cropState.panX=(x-(cw-dw)/2)/cw;cropState.panY=(y-(ch-dh)/2)/ch;
 ctx.clearRect(0,0,cw,ch);ctx.drawImage(cropImage,x,y,dw,dh);
}
async function saveCrop(){
 if(!cropState||(cropState.origin!=='profile'&&(!wizard||!isAdmin())))return;
 const canvas=document.querySelector('#crop-canvas');if(!canvas)return;
 const png=canvas.toDataURL('image/png'),field=cropState.field,kind=cropState.kind;
 try{
  let result;
  const personal=cropState.origin==='profile';
  if(native){result=await command('save_cropped_asset',{dataUrl:png,kind,projectId:personal?null:wizard.id||null});}
  else {result={path:`preview/crop-${kind}-${Date.now()}.png`,data_url:png};if(personal)db.user[kind]=result.path;}
  assetCache[result.path]=result.data_url;
  if(personal){if(native)db=await command('get_state');}
  else wizard[field]=result.path;
  cropState=null;cropImage=null;dialog=personal&&kind==='avatar'?{type:'avatar'}:personal?null:{type:'project'};
  render();message('Recorte guardado. El original sigue disponible.');
 }catch(e){message(String(e),true);}
}
function avatarDialog(){
 const selected=(db.user?.avatar?.startsWith('preset:')?db.user.avatar.slice(7):'');
 const choices=[['nova','Nova'],['orbit','Órbita'],['eclipse','Eclipse'],['nebula','Nebulosa'],['pulse','Pulso']];
 return `<div class="modal-backdrop" data-action="modal-backdrop"><div class="dialog avatar-modal" role="dialog" aria-modal="true" aria-label="Personalizar avatar"><header class="modal-head"><div><span class="page-eyebrow">TU IDENTIDAD</span><h2>Personalizar avatar</h2></div><button class="icon-btn" data-action="close-modal" aria-label="Cerrar">${I('x',20)}</button></header><div class="avatar-dialog-body"><div class="avatar-stage"><span class="avatar-stage-ring">${userAvatar(130)}</span><strong>${esc(displayAccount(db.user?.username))}</strong><small>Vista previa de tu perfil</small></div><div class="avatar-options"><h3>Emblemas</h3><p class="muted">Elegí un estilo o importá tu propia imagen.</p><div class="avatar-preset-grid">${choices.map(([key,label])=>`<button class="avatar-preset-option ${selected===key?'active':''}" data-action="preset-avatar" data-id="${key}" aria-label="Avatar ${label}" aria-pressed="${selected===key}">${avatarVisual('preset:'+key,db.user?.username,64)}<span>${label}</span></button>`).join('')}</div><button class="outline-btn full" data-action="import-avatar">${I('upload',18)} Importar y ajustar foto</button>${db.user?.avatar&&preview(db.user.avatar)?`<button class="outline-btn full" data-action="crop-profile-existing" data-kind="avatar">${I('crop',17)} Ajustar foto actual</button><button class="subtle-btn full" data-action="clear-profile-asset" data-kind="avatar">${I('trash',16)} Quitar foto</button>`:''}<button class="outline-btn full" data-action="import-avatar-layer">${I('layers',18)} Agregar capa de avatar (PNG)</button>${db.user?.avatar_layer?`<button class="subtle-btn full" data-action="clear-profile-asset" data-kind="avatar_layer">${I('trash',16)} Quitar capa del avatar</button>`:''}<p class="tiny-disclaimer">La foto se ajusta antes de guardarse. Los emblemas no se sincronizan con Microsoft.</p></div></div><footer class="modal-footer"><button class="subtle-btn" data-action="close-modal">Cerrar</button></footer></div></div>`;
}
function instanceDialog(){const a=dialog?.data||{};const p=db.projects.find(p=>p.id===a.project_id);
 return `<div class="modal-backdrop" data-action="modal-backdrop"><div class="dialog modal-medium" role="dialog" aria-modal="true" aria-label="Configuración de instancia"><header class="modal-head"><div><span class="page-eyebrow">MINECRAFT / INSTANCIAS</span><h2>${a.name?'Ajustar instancia':'Nueva instancia'}</h2></div><button class="icon-btn" data-action="close-modal">${I('x',19)}</button></header>
 <form id="instance-form" class="modal-body wiz-fields"><label>Nombre de la instancia<input name="name" required maxlength="60" value="${attr(a.name||'')}" placeholder="Mi instancia"/></label><label>Biblioteca<select name="project_id" id="instance-project" required>
 <option value="${PERSONAL_PROJECT_ID}" ${a.project_id===PERSONAL_PROJECT_ID?'selected':''}>Mi biblioteca · Personal</option>
 ${isAdmin()?db.projects.map(x=>`<option value="${attr(x.id)}" ${a.project_id===x.id?'selected':''}>VIS Universe · ${esc(x.title)}</option>`).join(''):''}</select></label>
 <label>Motor de juego<select name="engine" id="mc-instance-engine"><option value="java" ${(a.engine||'java')==='java'?'selected':''}>Minecraft Java Edition</option><option value="horizon" ${a.engine==='horizon'?'selected':''}>Minecraft Rust Edition — Horizon</option></select></label>
 <div class="form-pair"><label>Versión de Minecraft<select id="mc-version-channel" aria-label="Canal del catálogo"><option value="release" ${minecraftVersionChannel==='release'?'selected':''}>Versiones estables (incluidas anteriores)</option><option value="snapshot" ${minecraftVersionChannel==='snapshot'?'selected':''}>Snapshots (últimas 60)</option></select><input list="mc-version-catalog" id="mc-instance-version" name="version" required value="${attr(a.version||p?.mc_version||'')}" placeholder="Seleccioná del catálogo oficial"/><datalist id="mc-version-catalog">${versionSuggestions(a.version||p?.mc_version||'').map(v=>`<option value="${attr(v.id)}">${esc(v.kind)}</option>`).join('')}</datalist></label><label>RAM (MB)<input name="ram_mb" type="number" min="1024" max="32768" step="256" value="${attr(a.ram_mb||4096)}"/></label></div>
 <div class="form-pair"><label>Modloader<select name="loader" id="mc-instance-loader"><option value="horizon" ${a.loader==='horizon'?'selected':''} ${isGuest()?'disabled':''}>Horizon (Rust)</option><option value="vanilla" ${(a.loader||'vanilla')==='vanilla'?'selected':''}>Minecraft Vanilla</option><option value="fabric" ${a.loader==='fabric'?'selected':''}>Fabric</option></select></label><label id="fabric-version-field" class="${a.loader==='fabric'?'':'hidden'}">Versión de Fabric Loader<input list="mc-fabric-catalog" id="fabric-loader-version" name="loader_version" value="${attr(a.loader_version||'')}" placeholder="Versión estable"/><datalist id="mc-fabric-catalog">${fabricLoaders.map(v=>`<option value="${attr(v)}"></option>`).join('')}</datalist></label></div>
 <section id="vis-horizon-fields" class="vis-horizon-fields ${a.engine==='horizon'?'':'hidden'}"><div class="vis-smart-tip">${I('info',17)} Elegí la carpeta de tu instancia. VIS descarga y prepara los recursos de Minecraft 26.3; después podés abrir el juego con <b>Jugar</b>. La primera preparación puede tardar varios minutos. Requiere una copia legítima de Minecraft Java.</div>
 <details><summary>Opciones avanzadas de Horizon</summary><label>Motor Horizon<div class="folder-row"><input id="horizon-build-dir" name="horizon_build_dir" value="${attr(a.horizon_build_dir||'vis:source')}" placeholder="vis:source (incluido en VIS)"/><button type="button" data-action="use-horizon-source" title="Usar cliente Rust incorporado">${I('check',18)}</button></div></label><div class="vis-horizon-download-options"><button type="button" class="primary-btn" data-action="use-horizon-source">${I('game',16)} Usar Horizon compilado con VIS</button><button type="button" class="outline-btn vis-horizon-find" data-action="detect-horizon-build">${I('search',16)} Builds anteriores (opcional)</button></div><div id="vis-horizon-library" class="vis-horizon-library" role="region" aria-label="Builds antiguos de Horizon" aria-live="polite" hidden></div><p class="vis-horizon-download-note">Horizon se incorpora al instalador de VIS desde el repositorio Git oficial y queda fijado al commit compilado. Ningún jugador necesita instalar Rust, Cargo, ni Horizon Launcher. Los recursos oficiales de Minecraft se preparan por separado con una cuenta propietaria.</p>
 <label>Carpeta Minecraft Java 26.3 instalada<div class="folder-row"><input id="horizon-minecraft-dir" name="horizon_minecraft_dir" value="${attr(a.horizon_minecraft_dir||'')}" placeholder=".../.minecraft"/><button type="button" data-action="pick-horizon-minecraft">${I('folder',18)}</button></div></label>
 <label>Server JAR oficial 26.3<div class="folder-row"><input id="horizon-server-jar" name="horizon_server_jar" value="${attr(a.horizon_server_jar||'')}" placeholder=".../server.jar"/><button type="button" data-action="pick-horizon-server">${I('folder',18)}</button></div></label>
 </details><p class="form-notice">Instalar descarga y prepara los recursos oficiales automáticamente. Jugar abre Minecraft en Rust en modo local. Microsoft y los servidores con autenticación oficial todavía no están integrados.</p></section>
 <label>Carpeta del juego<div class="folder-row"><input id="instance-folder-path" name="game_dir" required value="${attr(a.game_dir||'')}" placeholder="Elegí la carpeta de esta instancia"/><button type="button" data-action="pick-folder" title="Elegir carpeta">${I('folder',20)}</button></div></label><label>Instalación existente para reutilizar (opcional)<div class="folder-row"><input id="instance-reuse-path" name="reuse_source" value="${attr(a.reuse_source||'')}" placeholder="Detección automática si está vacío"/><button type="button" data-action="pick-reuse-folder" title="Elegir carpeta de origen sin modificarla">${I('folder',20)}</button></div><small class="muted">VIS examina carpetas conocidas de Minecraft y otras instancias. Esta ruta adicional solo se lee; nunca se sobrescribe.</small></label>
 <label>Nick dentro de Minecraft (máximo 16 caracteres)<div class="vis-nickname-field"><input name="player_name" maxlength="16" pattern="[A-Za-z0-9_]{3,16}" value="${attr(isGuest()?db.user?.username:(a.player_name||suggestedMinecraftNick()))}" ${isGuest()?'readonly':''} placeholder="Tu nombre en el juego"/>${!isGuest()?`<button type="button" class="outline-btn" data-action="use-profile-nick" title="Usar tu nombre de VIS en el juego">Usar mi nombre VIS</button>`:''}</div><small>Para Java y Horizon offline; con Microsoft se mantiene el nombre oficial de la sesión.</small></label>
 ${a.name?`<div class="vis-instance-icon-controls"><span class="vis-instance-icon-preview">${instanceIcon(a,42)}</span><div><strong>Icono de la instancia</strong><small>PNG, JPG o WebP · máximo 3 MB</small></div><button type="button" class="outline-btn" data-action="import-instance-icon" data-id="${attr(a.name)}" data-project="${attr(a.project_id)}">Cambiar</button>${a.icon_path?`<button type="button" class="subtle-btn" data-action="clear-instance-icon" data-id="${attr(a.name)}" data-project="${attr(a.project_id)}">Quitar</button>`:''}</div>`:''}<input type="hidden" name="java_path" value="${attr(a.java_path||'')}"/><p class="muted">VIS instala un Java privado dentro de la instancia.</p>
 <p class="form-notice">${I('users',16)} ${isGuest()?'Este nickname offline conserva su propio perfil de instancias. No tiene contraseña; otras personas con acceso al equipo pueden reutilizarlo.':'Los archivos instalados pueden ser visibles para otros perfiles VIS de esta computadora. Las cuentas Microsoft y partidas no se comparten automáticamente.'}</p>
 <label class="toggle-line large"><span><b>Pantalla completa</b><small>Se aplica al iniciar Minecraft Java.</small></span><input type="checkbox" name="fullscreen" ${a.fullscreen?'checked':''}/></label><p class="form-notice">${I('info',16)} VIS Smart Install busca copias locales verificadas (otras instancias y launchers conocidos), y solo descarga de Mojang/Fabric lo que falta. Minecraft, Java, el motor Rust, los recursos y los registros se guardan dentro de la carpeta de la instancia. Si falta Java, usamos Temurin verificado con SHA-256. Las cuentas locales permiten jugar sin autenticación oficial; para servidores online premium será necesaria una cuenta Microsoft.</p></form>
 <footer class="modal-footer"><button class="subtle-btn" data-action="close-modal">Cancelar</button><button class="outline-btn" data-action="submit-instance">${I('check',17)} Guardar</button><button class="primary-btn" data-action="submit-install-instance">${I('play',17)} ${a.installed?'Guardar y jugar':'Crear, instalar y jugar'}</button></footer></div></div>`;
}
function compatibleProjectInstance(instance,project){return !!instance&&instance.installed&&
 instance.project_id===project.id&&instance.version===project.mc_version&&
 (instance.engine||'java')===(project.engine||'java')&&
 (instance.loader||'vanilla')===(project.loader||'vanilla')&&
 (instance.loader_version||'')===(project.loader_version||'');}
function projectInstallDialog(){
 const p=db.projects.find(p=>p.id===dialog?.projectId);if(!p)return '';
 const existing=db.instances.find(i=>compatibleProjectInstance(i,p)&&!i.source_owner);
 const folder=dialog?.folder??existing?.game_dir??'';
 const ram=dialog?.ram??existing?.ram_mb??4096;
 return `<div class="modal-backdrop" data-action="modal-backdrop"><div class="dialog modal-medium" role="dialog" aria-modal="true" aria-label="Instalar proyecto"><header class="modal-head"><div><span class="page-eyebrow">VIS UNIVERSE / INSTALAR Y JUGAR</span><h2>${esc(p.title)}</h2></div><button class="icon-btn" data-action="close-modal" aria-label="Cerrar">${I('x',19)}</button></header>
 <form id="vis-project-install-form" class="modal-body wiz-fields"><p class="vis-smart-tip">${I('game',16)} <strong>${esc(p.engine==='horizon'?'Horizon Rust Edition':'Minecraft Java Edition')} · ${esc(p.mc_version)} · ${esc(p.loader||'Vanilla')}</strong><br>Motor, versión y mods establecidos por VIS STUDIOS. VIS Smart Install reutilizará los archivos válidos.</p>
 <label>Carpeta donde instalar Minecraft<div class="folder-row"><input name="game_dir" id="vis-project-install-folder" value="${attr(folder)}" placeholder="Elegí la carpeta en tu disco" required/><button type="button" data-action="pick-project-folder" title="Elegir carpeta">${I('folder',19)}</button></div></label>
 <label>Memoria RAM (MB)<input name="ram_mb" type="number" min="1024" max="32768" step="256" value="${Number(ram)||4096}" required/></label>${projectContentCount(p)?`<p class="vis-smart-tip">${I('package',16)} Incluye ${p.required_mods?.length||0} mods, ${p.required_resourcepacks?.length||0} resource packs y ${p.required_shaders?.length||0} shaders de Modrinth. Se descargarán después del juego base.</p>`:''}
 <p class="muted">Las instancias ya instaladas en este equipo aparecen en todas las cuentas locales. Los mundos se mantienen separados. Minecraft Rust funciona en modo local; se requiere una copia legítima de Minecraft Java. Microsoft todavía no está integrado.</p></form>
 <footer class="modal-footer"><button type="button" class="subtle-btn" data-action="close-modal">Cancelar</button><button type="button" class="primary-btn" data-action="confirm-project-install">${I('play',17)} Crear, instalar y jugar</button></footer></div></div>`;
}
async function projectPlay(projectId){
 const p=db.projects.find(p=>p.id===projectId);if(!p)return;
 if(!isExecutionEnabled(p))return message(isProjectPaused(p)?'Reanudá el proyecto en tu biblioteca para poder jugar.':'VIS STUDIOS todavía no habilitó este proyecto.',true);
 const match=db.instances.find(i=>compatibleProjectInstance(i,p)&&!i.source_owner)||db.instances.find(i=>compatibleProjectInstance(i,p));
 if(match){await performLaunch(projectId,match.name,match.source_owner||'');return;}
 // Los nicknames offline también pueden instalar proyectos Java publicados.
 dialog={type:'project-install',projectId};render();
}
async function projectInstallAndPlay(){
 const form=document.querySelector('#vis-project-install-form');if(!(form instanceof HTMLFormElement)||!form.reportValidity())return;
 const data=new FormData(form);const projectId=dialog?.projectId;
 const gameDir=String(data.get('game_dir')||'').trim();const ramMb=Number(data.get('ram_mb'));
 try {
   db=await command('ensure_project_instance',{projectId,gameDir,ramMb});dialog=null;render();
   const ins=db.instances.find(i=>i.project_id===projectId&&!i.source_owner);
   if(!ins)throw Error('No se pudo registrar la instancia');
   if(!ins.installed)await performInstall(ins.project_id,ins.name);
   const ready=db.instances.find(i=>i.project_id===projectId&&i.name===ins.name&&!i.source_owner);
   if(ready?.installed)await performLaunch(projectId,ready.name);
 }catch(e){message('No se pudo instalar el proyecto: '+String(e),true)}
}
function sharedRamDialog(){const i=db.instances.find(i=>i.project_id===dialog?.projectId&&i.name===dialog?.name&&i.source_owner===dialog?.sourceOwner);return `<div class="modal-backdrop" data-action="modal-backdrop"><div class="dialog modal-small" role="dialog" aria-modal="true" aria-label="RAM de instancia compartida"><header class="modal-head"><h2>RAM de ${esc(i?.name||'Instancia')}</h2><button class="icon-btn" data-action="close-modal">${I('x',17)}</button></header><form id="shared-ram-form" class="modal-body"><label>Memoria RAM (MB)<input name="ram_mb" type="number" min="1024" max="32768" step="256" value="${Number(i?.ram_mb)||4096}" required/></label><p class="muted">Este ajuste es exclusivo de tu perfil VIS. No modifica la instalación ni los mundos del propietario.</p></form><footer class="modal-footer"><button type="button" class="subtle-btn" data-action="close-modal">Cancelar</button><button type="button" class="primary-btn" data-action="save-shared-ram">Guardar RAM</button></footer></div></div>`;}
function confirmDialog(){return `<div class="modal-backdrop" data-action="modal-backdrop"><div class="dialog modal-small" role="alertdialog" aria-modal="true"><header class="modal-head"><h2>Confirmar eliminación</h2><button class="icon-btn" data-action="close-modal">${I('x',18)}</button></header><div class="modal-body"><p>¿Seguro que querés eliminar <strong>${esc(dialog.label)}</strong>? Esta acción no se puede deshacer.</p></div><footer class="modal-footer"><button class="subtle-btn" data-action="close-modal">Cancelar</button><button class="danger-btn" data-action="confirm-delete">${I('trash',17)} Eliminar</button></footer></div></div>`;}
function dialogView(){return dialog?.type==='project'?projectWizard():dialog?.type==='quick-post'?quickPublishDialog():dialog?.type==='crop'?cropDialog():dialog?.type==='avatar'?avatarDialog():dialog?.type==='instance'?instanceDialog():dialog?.type==='project-install'?projectInstallDialog():dialog?.type==='shared-ram'?sharedRamDialog():confirmDialog();}
function viewSnapshot(){
 return {
   screen:db.user?`${libraryMode}:${page}:${page==='project'?selectedId:''}`:'auth',authMode,
   user:db.user?.username||'',
   dialog:dialog?.type||'',wizardStep:dialog?.type==='project'?wizardStep:-1,
   socialVisible, socialTab,chatWith,feed:activeFeed,
   messages:db.messages?.filter(m=>(m.from===db.user?.username&&m.to===chatWith)||(m.to===db.user?.username&&m.from===chatWith)).length||0,
   avatar:db.user?.avatar||'', avatarPreset:db.user?.avatar_preset||'',
   presence:db.user?.presence||'', friends:db.friends?.length||0,
 };
}
function render(){
 syncSocialOwner(db.user?.username || '', isGuest());
 const old=previousView;
 const next=viewSnapshot();
 const currentMain=root.querySelector('#main-scroll');
 const currentChat=root.querySelector('.chat-messages');
 const keepScroll=old&&old.screen===next.screen;
 const mainScrollTop=keepScroll?currentMain?.scrollTop:0;
 const chatScrollTop=currentChat?.scrollTop||0;
 const wasAtBottom=currentChat?currentChat.scrollHeight-currentChat.scrollTop-currentChat.clientHeight<30:true;
 document.title=`VIS Nexo${db.user?` · ${displayAccount(db.user.username)}`:''}`;
 document.body.classList.toggle('reduce-motion',!!prefs.reducedMotion);
 root.innerHTML=db.user?shell():loginView();
 if(dialog?.type==='crop')startCropCanvas();
 if(keepScroll)root.querySelector('#main-scroll')?.scrollTo({top:mainScrollTop||0,behavior:'instant'});
 const newChat=root.querySelector('.chat-messages');
 if(newChat&&next.chatWith===old?.chatWith){newChat.scrollTop=wasAtBottom?newChat.scrollHeight:chatScrollTop;}
 const options={reducedMotion:prefs.reducedMotion};
 if(!old||old.screen!==next.screen||old.user!==next.user){
   animateEntrance(root,{...options,kind:db.user?'page':'auth'});
 } else if(old.authMode!==next.authMode && next.screen==='auth'){
   animateAuthSwap(root,options);
 } else if(old.feed!==next.feed&&next.screen.startsWith('project:')) {
   animateFeed(root,options);
 }
 if(next.dialog){
   if(!old?.dialog||old.dialog!==next.dialog)animateModal(root,options);
   else if(next.wizardStep!==old.wizardStep)animateModalStep(root,options);
 }
 if(next.socialVisible&&!old?.socialVisible)animateSocial(root,options);
 if(next.socialVisible&&old?.socialTab!==next.socialTab)animateSocialTab(root,options);
 if(next.chatWith){
   if(old?.chatWith!==next.chatWith)animateChat(root,options);
   else if(next.messages>old.messages)animateChat(root,{...options,freshMessage:true});
 }
 if(old&&(next.avatar!==old.avatar||next.avatarPreset!==old.avatarPreset))animateAvatar(root,options);
 if(old&&next.presence!==old.presence)animateControl(root,options);
 previousView=next;
 animateProjectMotion(root,options);
 if(next.dialog&&!old?.dialog){
   root.querySelector('.dialog input[autofocus],.dialog input:not([type=hidden]),.dialog button[data-action=close-modal]')?.focus({preventScroll:true});
 }else if(next.chatWith&&old?.chatWith!==next.chatWith){
   root.querySelector('.chat-send input')?.focus({preventScroll:true});
 }
}
function navigate(to,id='') {
 const nextId=id||selectedId;
 if(db.user && page===to && (to!=='project'||nextId===selectedId)){
   root.querySelector('#main-scroll')?.scrollTo({top:0,behavior:prefs.reducedMotion?'instant':'smooth'});
   return;
 }
 beginSectionChange(root,()=>{
   if(id)selectedId=id;
   page=to;
   if(to==='project')activeFeed='news';
   contextMenu=null;render();
   root.querySelector('#main-scroll')?.scrollTo(0,0);
 },{reducedMotion:prefs.reducedMotion});
}
async function changeInstanceIcon(projectId,name,clear=false) {
  if(!native||!T?.dialog?.open)return message('Los iconos personalizados requieren VIS Nexo de escritorio.',true);
  try{
    const path=clear?null:await T.dialog.open({multiple:false,directory:false,title:'Icono de la instancia',filters:[{name:'Imágenes PNG, JPG o WebP',extensions:['png','jpg','jpeg','webp']}]});
    if(!clear&&!path)return;
    db=await command('set_instance_icon',{projectId,name,path});
    await refreshAssets();
    if(dialog?.type==='instance'&&dialog.data?.name===name&&dialog.data?.project_id===projectId){
      dialog.data=db.instances.find(i=>i.project_id===projectId&&i.name===name&&!i.source_owner)||dialog.data;
    }
    render();message(clear?'Icono restaurado al predeterminado.':'Icono de la instancia actualizado.');
  }catch(e){message(String(e),true)}
}
async function chooseAsset(kind,field='',projectId='') {
 try {
   if(native){
     const path=await T.dialog.open({multiple:false,directory:false,title:'Seleccionar imagen',filters:[{name:'Imágenes (PNG, JPG, WebP)',extensions:['png','jpg','jpeg','webp']}]});
     if(!path)return;
     const personal=['avatar','profile_banner'].includes(kind);
     const result=await command('import_asset',{path,kind,projectId:projectId||null,stageOnly:personal});
     assetCache[result.path]=result.data_url;
     if(wizard&&field)wizard[field]=result.path;
     if(personal){openPersonalCrop(kind,result.path);return;}
     if(['skin','cape','avatar_layer','home','login','launcher_logo'].includes(kind)) db=await command('get_state');
     render();message('Recurso importado correctamente.');
   }else{
     const input=document.createElement('input');input.type='file';input.accept=['skin','cape','avatar_layer'].includes(kind)?'image/png':'image/png,image/jpeg,image/webp';
     input.onchange=async()=>{const file=input.files?.[0];if(!file)return;const url=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file)});const path='preview/'+file.name;assetCache[path]=url;if(wizard&&field)wizard[field]=path;else if(['avatar','profile_banner'].includes(kind)){openPersonalCrop(kind,path);return;}else if(db.user&&['skin','cape','avatar_layer'].includes(kind)){db.user[kind]=path;if(kind==='avatar')dialog={type:'avatar'};}else if(kind==='home')db.branding.home_image=path;render();message('Recurso cargado en vista previa.');};input.click();
   }
 }catch(e){message(String(e),true)}
}
async function chooseFolder(){
 if(!native){message('Selector de carpetas disponible en el cliente Tauri.');return;}
 try {const path=await T.dialog.open({directory:true,multiple:false,title:'Carpeta para Minecraft'});if(path){const el=document.getElementById('instance-folder-path');if(el)el.value=path;}}catch(e){message(String(e),true)}
}
async function chooseReuseFolder(){
 if(!native||!T?.dialog?.open){message('Disponible en la aplicación Tauri.',true);return;}
 try{const path=await T.dialog.open({directory:true,multiple:false,title:'Seleccionar carpeta de instalación existente (solo lectura)'});
  if(path){const input=document.getElementById('instance-reuse-path');if(input)input.value=path;}}
 catch(e){message(String(e),true)}
}
async function openCommunity(url){
 try{const u=new URL(url);if(!['https:','http:'].includes(u.protocol))throw new Error('Solo enlaces web');if(native)await T.opener.openUrl(u.toString());else window.open(u.toString(),'_blank','noopener,noreferrer');}
 catch(e){message('Enlace de comunidad inválido.',true)}
}
function storeWizardField(key,el){if(!wizard)return;
 if(key==='versions_csv'){wizard.versions=el.value.split(',').map(s=>s.trim()).filter(Boolean).slice(0,30);}
 else if(['required_mods_csv','required_resourcepacks_csv','required_shaders_csv'].includes(key)){wizard[key.slice(0,-4)]=el.value.split(',').map(s=>s.trim()).filter(Boolean).slice(0,33);}
 else {wizard[key]=el.type==='checkbox'?el.checked:el.value;}
}
function acceptWizardInput(){if(!wizard)return;document.querySelectorAll('input[data-field],select[data-field],textarea[data-field]').forEach(el=>{storeWizardField(el.dataset.field,el);});document.querySelectorAll('[data-visible]').forEach(el=>{wizard.visible_sections ||= {};wizard.visible_sections[el.dataset.visible]=el.checked;});if(wizard.engine==='horizon'){wizard.mc_version='26.3';wizard.loader='horizon';wizard.loader_version='';}else if(wizard.loader==='vanilla'){wizard.loader_version='';}}
function validateStep(){
 if(wizardStep===0){
   if(!wizard.title?.trim()){message('Poné un nombre al proyecto.',true);return false;}
   if(wizard.title.length>80){message('El nombre es demasiado largo.',true);return false;}
    const lists=[wizard.required_mods||[],wizard.required_resourcepacks||[],wizard.required_shaders||[]];
    const ids=lists.flat();
    if(ids.length>32||ids.some(id=>!id||id.length>80||!/^[a-zA-Z0-9_-]+$/.test(id))||
       lists.some(list=>new Set(list.map(x=>x.toLowerCase())).size!==list.length)){
      message('Ingresá hasta 32 IDs de Modrinth válidos, sin duplicados.',true);return false;
    }
    if(wizard.loader!=='fabric'&&lists[0].length){message('Elegí Fabric para instalar mods obligatorios.',true);return false;}
    if(wizard.engine==='horizon'&&ids.length){message('Los recursos Modrinth son exclusivos de Minecraft Java, no Horizon.',true);return false;}
 }
 return true;
}
root.addEventListener('input',event=>{
 const el=event.target;
 if(el?.id==='crop-zoom'&&cropState){cropState.zoom=Number(el.value);const output=document.querySelector('#crop-zoom-value');if(output)output.textContent=`${Math.round(cropState.zoom*100)}%`;paintCrop();return;}
 if(el?.id==='vis-project-engine'&&wizard){wizard.engine=el.value;if(el.value==='horizon'){wizard.mc_version='26.3';wizard.loader='horizon';wizard.loader_version='';}else if(wizard.loader==='horizon'){wizard.loader='vanilla';}render();return;}
 if(el?.id==='vis-project-loader'&&wizard){wizard.loader=el.value;render();if(el.value==='fabric')void loadFabricLoaders(wizard.mc_version);return;}
 if(el?.dataset?.field==='mc_version'&&wizard?.loader==='fabric')void loadFabricLoaders(el.value);
 if(el?.id==='mc-instance-version'){syncVersionSuggestions();return;}
 if(el?.id==='catalog-search'){query=el.value;document.querySelectorAll('.portal-game-card').forEach(card=>{const p=db.projects.find(p=>p.id===card.dataset.id);card.hidden=!p||!`${p.title} ${p.subtitle}`.toLowerCase().includes(query.toLowerCase());});return;}
 if(wizard&&el?.dataset?.field){const field=el.dataset.field;if(field==='title'){document.querySelectorAll('[data-live-title],[data-live-name]').forEach(n=>n.textContent=el.value||'Tu proyecto');}if(field==='subtitle'){document.querySelectorAll('[data-live-subtitle]').forEach(n=>n.textContent=el.value||'Tu descripción aparecerá aquí.');}if(field==='mc_version'){document.querySelectorAll('.wizard-live-kicker').forEach(n=>n.textContent=el.value||'MINECRAFT');}}if(wizard&&el instanceof HTMLElement&&el.matches('[data-field]')){
  storeWizardField(el.dataset.field,el);
 }
});
function syncHorizonEditor(){
 const select=document.getElementById('mc-instance-engine');if(!select)return;
 const rust=select.value==='horizon';
 document.getElementById('vis-horizon-fields')?.classList.toggle('hidden',!rust);
 const loader=document.getElementById('mc-instance-loader');
 if(loader){if(rust)loader.value='horizon';else if(loader.value==='horizon')loader.value='vanilla';}
 document.getElementById('fabric-version-field')?.classList.toggle('hidden',rust||loader?.value!=='fabric');
 const version=document.getElementById('mc-instance-version');
 if(version){if(rust){version.dataset.previousVersion=version.value!=='26.3'?version.value:(version.dataset.previousVersion||'');version.value='26.3';version.readOnly=true;}
  else{version.readOnly=false;if(version.dataset.previousVersion){version.value=version.dataset.previousVersion;delete version.dataset.previousVersion;}}}
 const picker=document.getElementById('mc-version-channel');if(picker)picker.disabled=rust;
 if(rust){const share=document.querySelector('#instance-form [name="share_offline"]');if(share)share.checked=false;}
}
root.addEventListener('change',async event=>{
 const el=event.target;
 if(el?.id==='social-presence')await apply('update_presence',{presence:el.value});
 else if(el?.id==='reduced-motion'){prefs.reducedMotion=el.checked;render();animateSetting(root,{reducedMotion:prefs.reducedMotion});}
 else if(el?.id==='mc-active-instance'){const [projectId,...parts]=el.value.split('|');mcSelected={projectId,name:parts.join('|')};modResults=[];installedFiles=[];render();void refreshInstalledFiles();}
 else if(el?.id==='mc-mod-kind'){modKind=el.value;modResults=[];render();}
 else if(el?.id==='mc-instance-engine'){syncHorizonEditor();}
 else if(el?.id==='mc-instance-loader'){if(document.getElementById('mc-instance-engine')?.value==='horizon'){el.value='horizon';return;}document.querySelector('#fabric-version-field')?.classList.toggle('hidden',el.value!=='fabric');if(el.value==='fabric')void loadFabricLoaders(document.querySelector('#mc-instance-version')?.value||'');}
 else if(el?.id==='mc-instance-version'){if(document.querySelector('#mc-instance-loader')?.value==='fabric')void loadFabricLoaders(el.value);}
 else if(el?.id==='mc-version-channel'){
   minecraftVersionChannel=el.value==='snapshot'?'snapshot':'release';
   syncVersionSuggestions();
 }
 else if(el?.id==='instance-project'){const p=db.projects.find(p=>p.id===el.value);const version=document.querySelector('#mc-instance-version');if(version&&p?.mc_version)version.value=p.mc_version;}
 else if(el?.id==='social-visibility'){socialVisible=el.checked;render();animateSetting(root,{reducedMotion:prefs.reducedMotion});}
 else if(wizard&&el instanceof HTMLElement&&el.matches('[data-visible]')){wizard.visible_sections ||= {};wizard.visible_sections[el.dataset.visible]=el.checked;}
 else if(wizard&&el instanceof HTMLElement&&el.matches('[data-field]')) {if(el.dataset.field==='versions_csv')wizard.versions=el.value.split(',').map(s=>s.trim()).filter(Boolean).slice(0,30);else wizard[el.dataset.field]=el.type==='checkbox'?el.checked:el.value;}
});
root.addEventListener('input',e=>{if(e.target?.id==='friend-filter'){friendFilter=e.target.value;document.querySelectorAll('.friend-item').forEach(item=>{item.hidden=!item.dataset.id.toLowerCase().includes(friendFilter.toLowerCase());});}});
root.addEventListener('submit',async event=>{
 const form=event.target;
 if(!(form instanceof HTMLFormElement))return;
 event.preventDefault();const formData=new FormData(form);
 if(form.id==='auth-form'){
  const username=String(formData.get('username')||''),password=String(formData.get('password')||'');
  authBusy=true;
  try {
   db=authMode==='offline'?await command('login_offline',{nickname:String(formData.get('nickname')||'')}):await command(authMode==='register'?'register':'login',authMode==='register'?{username,password,confirm:String(formData.get('confirm')||'')}:{username,password});
   if(isGuest()){libraryMode='user';try{localStorage.setItem('vis-library-mode','user');}catch{}}
    page='home';await refreshAssets();render();message(`Sesión iniciada · ${db.user?.username}`);
  }catch(e){message(String(e),true)}finally{authBusy=false;}
  return;
 }
 if(form.id==='modrinth-search-form'){await performModSearch(formData);return;}
 if(form.id==='quick-publish-form'){await saveQuickPublish(form);return;}
 if(form.id==='friend-form'){const username=String(formData.get('username')||'');if(username)await apply('request_friend',{username},'Solicitud enviada');return;}
 if(form.id==='message-form'){const body=String(formData.get('body')||'');if(body&&chatWith)await apply('send_message',{to:chatWith,body});return;}
 if(form.id==='cloud-catalog-form'){try{await command('configure_cloud_catalog',{url:String(formData.get('url')||'').trim()});message('Catálogo configurado');await refreshCloudCatalog();}catch(e){message(String(e),true);}return;}
 if(form.id==='universe-publish-form'){
  if(!isAdmin()||!native)return;
  const token=String(formData.get('token')||'');
  form.reset();
  try{await command('publish_universe',{token});message('Proyectos publicados en VIS Universe.');await refreshCloudCatalog(true);}
  catch(e){message(String(e),true)}
  return;
 }
 if(form.id==='brand-form'){const name=String(formData.get('name')||'');await apply('save_brand_name',{name},'Nombre guardado');return;}
 if(form.id==='instance-form')await saveInstanceForm();
});
async function saveInstanceForm(installAndPlay=false){
 const f=document.querySelector('#instance-form');if(!f||!f.reportValidity())return;
 const data=new FormData(f);
 const instance={name:String(data.get('name')||'').trim(),engine:String(data.get('engine')||'java'),share_offline:data.has('share_offline'),horizon_build_dir:String(data.get('horizon_build_dir')||''),horizon_minecraft_dir:String(data.get('horizon_minecraft_dir')||''),horizon_server_jar:String(data.get('horizon_server_jar')||''),loader:String(data.get('loader')||'vanilla'),loader_version:String(data.get('loader_version')||''),java_path:String(data.get('java_path')||''),player_name:String(data.get('player_name')||''),project_id:String(data.get('project_id')||''),version:String(data.get('version')||''),game_dir:String(data.get('game_dir')||''),reuse_source:String(data.get('reuse_source')||''),ram_mb:Number(data.get('ram_mb')||4096),fullscreen:data.has('fullscreen'),installed:false};
 if(instance.engine==='horizon'){instance.loader='horizon';instance.loader_version='';instance.version='26.3';instance.share_offline=false;}
 const ok=await apply('save_instance',{instance},'Instancia guardada');if(ok){dialog=null;render();if(installAndPlay){await performInstall(instance.project_id,instance.name);const actual=db.instances.find(x=>x.project_id===instance.project_id&&x.name===instance.name);if(actual?.installed){await performLaunch(instance.project_id,instance.name);}}}
}
root.addEventListener('click',async event=>{
 if(!(event.target instanceof Element))return;
 const button=event.target.closest('[data-action]');
 if(!button){if(contextMenu){contextMenu=null;render();}return;}
 const act=button.dataset.action,id=button.dataset.id||'',projectId=button.dataset.project||'';
 if(['create-project','edit-project','edit-avatar','open-instance','edit-instance','delete-instance','delete-project'].includes(act))lastDialogTrigger=button;
 if(act==='modal-backdrop'){if(event.target===button)closeDialog();return;}
 if(act==='auth-offline'){authMode='offline';showPassword=false;render();return;}
 if(act==='auth-local'){authMode='login';showPassword=false;render();return;}
 if(act==='recent-account'){authMode='login';render();const name=root.querySelector('#auth-name');if(name){name.value=id;root.querySelector('#auth-password')?.focus();}return;}
 if(act==='switch-auth'){cancelPendingSectionChange();authMode=authMode==='login'?'register':'login';showPassword=false;render();return;}
 if(act==='toggle-password'){const input=document.querySelector('#auth-password'),repeat=document.querySelector('#auth-repeat');if(input){showPassword=!showPassword;input.type=showPassword?'text':'password';if(repeat)repeat.type=input.type;button.innerHTML=I(showPassword?'eyeoff':'eye',19);}return;}
 if(act==='close-modal'){closeDialog();return;}
 if(act==='go-home')navigate('home');
 else if(act==='mode-vs')setLibraryMode('vs');
 else if(act==='mode-user')setLibraryMode('user');
 else if(act==='import-worlds-instance')await importWorldsInstance();
 else if(act==='export-worlds-instance')await exportWorldsInstance(projectId,id);
 else if(act==='new-personal-instance'){dialog={type:'instance',data:{project_id:PERSONAL_PROJECT_ID,ram_mb:4096,loader:'vanilla'}};render();void loadMinecraftVersions();}
 else if(act==='use-profile-nick'){const input=document.querySelector('#instance-form input[name="player_name"]');const nick=suggestedMinecraftNick();if(!nick)return message('Tu usuario VIS no es un nick Minecraft válido de 3 a 16 caracteres. Escribí uno manualmente.',true);if(input){input.value=nick;input.focus();}return;}
 else if(act==='import-instance-icon'){await changeInstanceIcon(projectId,id);return;}
 else if(act==='clear-instance-icon'){await changeInstanceIcon(projectId,id,true);return;}
 else if(act==='sidebar-instance'){mcSelected={projectId:projectId||PERSONAL_PROJECT_ID,name:id};navigate('instances');}
 else if(act==='open-project')navigate('project',id);
 else if(act==='go-profile')navigate('profile');
 else if(act==='go-instances')navigate('instances');
 else if(act==='go-minecraft'){navigate('minecraft');void refreshInstalledFiles();}
 else if(act==='go-settings')navigate('settings');
 else if(act==='go-cloud'){navigate('cloud');void refreshCloudCatalog(true);}
 else if(act==='refresh-cloud')await refreshCloudCatalog();
 else if(act==='download-cloud-bundle')await downloadCloudBundle(id);
 else if(act==='check-update')await checkAppUpdate();
 else if(act==='install-update')await installAppUpdate();
 else if(act==='go-maintenance'){navigate('maintenance');void loadMaintenance();}
 else if(act==='maintenance-preview')await loadMaintenance();
 else if(act==='maintenance-clean')await cleanMaintenance();
 else if(act==='go-assets')navigate('assets');
 else if(act==='toggle-social'){if(socialVisible){beginSurfaceDismiss(root,'.social-pane',()=>{socialVisible=false;render();},{reducedMotion:prefs.reducedMotion});}else{socialVisible=true;render();}}
 else if(act==='social-cloud'){setSocialMode('cloud');return;}
 else if(act==='social-local'){setSocialMode('local');return;}
 else if(act==='social-global'){socialTab='global';render();}
 else if(act==='social-projects'){socialTab='projects';render();}
 else if(act==='open-chat'){chatWith=id;chatWindowSize=100;render();}
 else if(act==='chat-load-older'){chatWindowSize=Math.min(10000,chatWindowSize+100);render();}
 else if(act==='close-chat'){beginSurfaceDismiss(root,'.chat-drawer',()=>{chatWith='';render();},{reducedMotion:prefs.reducedMotion});}
 else if(act==='accept-friend'){await apply('accept_friend',{username:id},'Solicitud aceptada');}
 else if(act==='logout'){cancelPendingSectionChange();db=await command('logout');page='home';dialog=null;authMode='login';showPassword=false;render();}
 else if(act==='create-project'){startProject();void loadMinecraftVersions();}
 else if(act==='quick-publish'){if(!isAdmin())return;dialog={type:'quick-post',projectId:selectedId,kind:button.dataset.kind||'news'};render();}
 else if(act==='edit-publication'){if(!isAdmin())return;dialog={type:'quick-post',projectId:selectedId,kind:button.dataset.kind,index:Number(button.dataset.index)};render();}
 else if(act==='remove-publication'){if(!isAdmin())return;const p=currentProject();if(!p)return;const next=clone(p),index=Number(button.dataset.index);const list=button.dataset.kind==='event'?next.calendar:next.posts;if(!list||!list[index])return;list.splice(index,1);await apply('save_project',{project:next},'Publicación eliminada');}
 else if(act==='remove-project-image'){if(!isAdmin()||!wizard)return;acceptWizardInput();const field=button.dataset.field;if(['banner_path','logo_path','icon_path'].includes(field)){wizard[field]='';render();message('Imagen quitada del proyecto. El original no se eliminó.');}}
 else if(act==='clear-profile-asset'){const kind=button.dataset.kind;await apply('clear_asset',{kind},'Recurso quitado');if(kind==='avatar')dialog={type:'avatar'};render();}
 else if(act==='clear-client-asset'){const kind=button.dataset.kind;await apply('clear_asset',{kind},'Recurso quitado');}
 else if(act==='crop-profile-existing'){const kind=button.dataset.kind;openPersonalCrop(kind,db.user?.[kind]);}
 else if(act==='apply-original-profile'){if(!cropState||cropState.origin!=='profile')return;const kind=cropState.kind,path=cropState.path;try{if(native)db=await command('commit_profile_asset',{path,kind});else db.user[kind]=path;cropState=null;dialog=kind==='avatar'?{type:'avatar'}:null;render();message('Imagen original aplicada.');}catch(e){message(String(e),true);}}
 else if(act==='crop-asset'){openCrop(button.dataset.field,button.dataset.kind);}
 else if(act==='cancel-crop'){const personal=cropState?.origin==='profile',kind=cropState?.kind;cropState=null;cropImage=null;dialog=personal?(kind==='avatar'?{type:'avatar'}:null):{type:'project'};render();}
 else if(act==='crop-reset'&&cropState){cropState.zoom=1;cropState.panX=0;cropState.panY=0;const slider=document.querySelector('#crop-zoom');if(slider)slider.value='1';const pct=document.querySelector('#crop-zoom-value');if(pct)pct.textContent='100%';paintCrop();}
 else if(act==='save-crop'){await saveCrop();}
 else if(act==='edit-avatar'){dialog={type:'avatar'};render();}
 else if(act==='preset-avatar'){await apply('set_avatar_preset',{preset:id},'Avatar actualizado');dialog={type:'avatar'};render();}
 else if(act==='wizard-jump'){acceptWizardInput();const target=Number(button.dataset.index);if(target<=wizardStep||validateStep()){wizardStep=Math.max(0,Math.min(3,target));render();}}
 else if(act==='edit-project'){startProject(id);void loadMinecraftVersions();}
 else if(act==='wizard-next'){acceptWizardInput();if(validateStep()){wizardStep=Math.min(3,wizardStep+1);render();}}
 else if(act==='wizard-back'){acceptWizardInput();wizardStep=Math.max(0,wizardStep-1);render();}
 else if(act==='save-project'){
   acceptWizardInput();if(!wizard?.title?.trim())return message('El proyecto necesita un nombre.',true);
   const ok=await apply('save_project',{project:clone(wizard)},'Proyecto guardado localmente');
   if(ok){selectedId=(db.projects.find(p=>p.id===wizard.id)?.id)||db.projects.find(p=>p.title===wizard.title)?.id||'';wizard=null;dialog=null;page='project';render();}
 }
 else if(act==='add-post'){
   const kind=document.querySelector('#post-kind')?.value||'news',title=document.querySelector('#post-title')?.value?.trim(),body=document.querySelector('#post-body')?.value?.trim();
   if(!title)return message('Agregá un título a la publicación.',true);
   wizard.posts.push({kind,title,body,date:new Date().toISOString().slice(0,10)});render();
 }
 else if(act==='remove-post'){wizard.posts.splice(Number(button.dataset.index),1);render();}
 else if(act==='add-event'){
   const title=document.querySelector('#event-title')?.value?.trim(),date=document.querySelector('#event-date')?.value||'',description=document.querySelector('#event-description')?.value?.trim()||'';
   if(!title||!date)return message('Completá nombre y fecha del evento.',true);
   wizard.calendar.push({title,date,description});render();
 }
 else if(act==='remove-event'){wizard.calendar.splice(Number(button.dataset.index),1);render();}
 else if(act==='pick-asset'){await chooseAsset(button.dataset.kind,button.dataset.field,wizard?.id||'');}
 else if(act==='import-avatar'){await chooseAsset('avatar');}
 else if(act==='import-skin'){await chooseAsset('skin');}
 else if(act==='import-cape'){await chooseAsset('cape');}
 else if(act==='import-avatar-layer'){await chooseAsset('avatar_layer');}
 else if(act==='import-profile-banner'){await chooseAsset('profile_banner');}
 else if(act==='import-home'){await chooseAsset('home');}
 else if(act==='import-launcher-logo'){await chooseAsset('launcher_logo');}
 else if(act==='feed-tab'){activeFeed=id;render();}
 else if(act==='open-community'){const p=db.projects.find(p=>p.id===id);if(p)await openCommunity(p.community_url);}
 else if(act==='shared-ram'){dialog={type:'shared-ram',name:id,projectId,sourceOwner:button.dataset.source};render();}
 else if(act==='save-shared-ram'){
   const form=document.querySelector('#shared-ram-form');if(!(form instanceof HTMLFormElement)||!form.reportValidity())return;
   const ramMb=Number(new FormData(form).get('ram_mb'));
   const ok=await apply('configure_shared_ram',{sourceOwner:dialog.sourceOwner,projectId:dialog.projectId,name:dialog.name,ramMb},'Memoria de este perfil actualizada');
   if(ok){dialog=null;render();}
 }
 else if(act==='toggle-personal-project'){
    if(!db.user)return message('Elegí un perfil para administrar tu biblioteca.',true);
    const paused=db.paused_projects?.includes(id)||false;
    await apply('set_project_active',{projectId:id,enabled:paused},paused?'Proyecto reanudado. Tus archivos siguen intactos.':'Proyecto pausado para esta cuenta. Mundos y mods conservados.');
 }
 else if(act==='project-play'){await projectPlay(id);}
 else if(act==='confirm-project-install'){await projectInstallAndPlay();}
 else if(act==='pick-project-folder'){
   if(!T?.dialog?.open)return message('Elegí una carpeta desde VIS Nexo instalado.',true);
   try{const folder=await T.dialog.open({directory:true,multiple:false,title:'Elegir carpeta para esta instancia'});if(folder){const el=document.getElementById('vis-project-install-folder');if(el)el.value=folder;}}catch(e){message(String(e),true)}
 }
 else if(act==='open-instance'){const target=id||(libraryMode==='user'||!db.projects.length?PERSONAL_PROJECT_ID:db.projects[0].id);if(target!==PERSONAL_PROJECT_ID){dialog={type:'project-install',projectId:target};render();return;}dialog={type:'instance',data:{project_id:id||(libraryMode==='user'||!db.projects.length?PERSONAL_PROJECT_ID:db.projects[0].id),ram_mb:4096,loader:'vanilla'}};render();void loadMinecraftVersions();}
 else if(act==='edit-instance'){if(!isAdmin()&&projectId!==PERSONAL_PROJECT_ID){dialog={type:'project-install',projectId};render();return;}const instance=db.instances.find(i=>i.name===id&&i.project_id===projectId);if(instance){dialog={type:'instance',data:clone(instance)};render();void loadMinecraftVersions();if(instance.loader==='fabric')void loadFabricLoaders(instance.version);}}
 else if(act==='duplicate-instance'){
   const original=db.instances.find(i=>i.project_id===projectId&&i.name===id&&!i.source_owner);
   if(!original)return;
   const copy=clone(original);copy.installed=false;copy.game_dir='';copy.source_owner='';copy.reuse_source='';copy.share_offline=false;
   const existing=new Set(db.instances.filter(i=>i.project_id===projectId).map(i=>i.name));
   let candidate=original.name+' - copia',number=2;
   while(existing.has(candidate)&&number<100){candidate=`${original.name} - copia ${number++}`;}
   if(existing.has(candidate)||candidate.length>60)return message('No se puede generar un nombre único de instancia.',true);
   copy.name=candidate;
   dialog={type:'instance',data:copy};render();void loadMinecraftVersions();if(copy.loader==='fabric')void loadFabricLoaders(copy.version);
 }
 else if(act==='pick-folder'){await chooseFolder();}
 else if(act==='pick-reuse-folder'){await chooseReuseFolder();}
 else if(['pick-horizon-build','pick-horizon-minecraft','pick-horizon-server'].includes(act)){
   if(!native||!T?.dialog?.open)return message('Elegí rutas desde VIS Nexo instalado.',true);
   const field=act==='pick-horizon-build'?'horizon-build-dir':act==='pick-horizon-minecraft'?'horizon-minecraft-dir':'horizon-server-jar';
   const chosen=await T.dialog.open({directory:act!=='pick-horizon-server',multiple:false,
     title:act==='pick-horizon-server'?'Seleccionar server.jar oficial de Minecraft':'Seleccionar carpeta de Horizon / Minecraft'});
   if(chosen){const input=document.getElementById(field);if(input)input.value=chosen;}
 }
 else if(act==='toggle-project-execution'){if(isAdmin())await apply('set_project_execution',{projectId:id,enabled:db.project_execution?.[id]===false},'Política de ejecución actualizada');}
 else if(act==='dismiss-launch-diagnostic'){lastMinecraftExit=null;render();}
 else if(act==='install-minecraft'){await performInstall(projectId,id);}
 else if(act==='sync-project-content'){
    if(!native)return message('Necesitás VIS Nexo instalado.',true);
    if(minecraftBusy)return;
    minecraftBusy=true;render();
    try{const files=await command('sync_project_content',{projectId,name:id});message(files.length?`Contenido sincronizado: ${files.length} archivos gestionados.`:'El proyecto no requiere mods o packs.');await refreshInstalledFiles();}
    catch(e){message(String(e),true)}finally{minecraftBusy=false;render();}
 }
 else if(act==='horizon-check'){
   try{horizonChecks=await command('horizon_diagnostics',{projectId,name:id});render();
     const problems=horizonChecks.filter(c=>c.status==='missing').length;
     message(problems?`${problems} requisito(s) pendientes. Revisá el diagnóstico de Horizon.`:'Diagnóstico Horizon completado. Ya podés jugar en modo local.',!!problems);
   }catch(e){message(String(e),true)}
 }
 else if(act==='use-horizon-source'){
   if(!native)return message('La versión del repositorio está disponible en VIS Nexo compilado.',true);
   try {
     const path=await command('horizon_source_build');
     const input=document.getElementById('horizon-build-dir');if(input)input.value='vis:source';
     message(`Horizon del repositorio integrado en VIS. Cliente verificado en ${path}. Guardá la instancia.`);
   }catch(e){message('El build Rust de Horizon no está incluido: '+String(e),true)}
 }
 else if(act==='detect-horizon-build'){
   if(!native)return message('La biblioteca de Horizon necesita VIS Nexo instalado.',true);
   try{
     const managed=await command('horizon_installed_builds');
     const local=await command('horizon_local_builds');
     const seen=new Set((managed||[]).map(b=>b.build_dir));
     horizonLibraryBuilds=[...(managed||[]),...(local||[]).filter(path=>!seen.has(path)).map(path=>({tag:'Build externo',build_dir:path,integrity:'external',detail:'Build encontrado fuera de VIS: verificá su procedencia'}))];
     const panel=document.getElementById('vis-horizon-library');
     if(!panel)return;
     panel.hidden=false;
     if(!horizonLibraryBuilds.length){
       panel.innerHTML='<p class="vis-horizon-library-empty">No hay versiones instaladas. Usá «Descargar» o elegí una carpeta del juego.</p>';
       return;
     }
     panel.innerHTML=`<div class="vis-horizon-library-title"><b>Versiones disponibles</b><span>${horizonLibraryBuilds.length} build(s)</span></div>`+
       horizonLibraryBuilds.map((entry,index)=>{
         const status=entry.integrity==='verified'?'Verificado':entry.integrity==='legacy'?'Anterior':entry.integrity==='modified'?'Modificado':entry.integrity==='incomplete'?'Incompleto':'Externo';
         const bad=entry.integrity==='modified'||entry.integrity==='incomplete';
         return `<div class="vis-horizon-build ${bad?'is-unsafe':''}"><div><strong>${esc(entry.tag)}</strong><span class="vis-horizon-build-status">${esc(status)}</span><small title="${attr(entry.build_dir)}">${esc(entry.detail||entry.build_dir)}</small></div><button type="button" class="outline-btn" data-action="select-horizon-build" data-index="${index}" ${bad?'disabled title="Archivos ausentes o modificados"':''}>Utilizar</button></div>`;
       }).join('');
   }catch(e){message('No se pudo leer la biblioteca Horizon: '+String(e),true)}
 }
 else if(act==='select-horizon-build'){
   const index=Number(button.dataset.index);
   const selected=horizonLibraryBuilds[index];
   if(!Number.isInteger(index)||!selected)return message('Selección de build inválida.',true);
   if(['modified','incomplete'].includes(selected.integrity))return message('No es seguro utilizar ese build. Reinstalá Horizon.',true);
   if(selected.integrity!=='verified' && !window.confirm('Este build no posee una verificación de integridad reciente de VIS. ¿Querés seleccionarlo igualmente?'))return;
   const input=document.getElementById('horizon-build-dir');
   if(input)input.value=selected.build_dir;
   message(`Versión ${selected.tag} seleccionada. Guardá la instancia para fijarla y ejecutá el diagnóstico.`);
 }
 else if(act==='launch-minecraft'){await performLaunch(projectId,id,button.dataset.source||'');}
 else if(act==='manage-instance'){mcSelected={projectId,name:id};installedFiles=[];horizonChecks=[];navigate('minecraft');void refreshInstalledFiles();}
 else if(act==='install-modrinth'){await performModInstall(id);}
 else if(act==='import-instance-resource'){await importMcFile(button.dataset.kind);}
 else if(act==='remove-instance-file'){await removeMcFile(button.dataset.kind,button.dataset.file);}
 else if(act==='toggle-instance-file'){await toggleMcFile(button.dataset.kind,button.dataset.file);}
 else if(act==='submit-instance'){await saveInstanceForm();}
 else if(act==='submit-install-instance'){await saveInstanceForm(true);}
 else if(act==='delete-instance'){dialog={type:'confirm',kind:'instance',name:id,projectId,label:id};render();}
 else if(act==='delete-project'){dialog={type:'confirm',kind:'project',projectId:id,label:db.projects.find(p=>p.id===id)?.title||id};contextMenu=null;render();}
 else if(act==='confirm-delete'){
  if(dialog?.kind==='project'){const ok=await apply('delete_project',{projectId:dialog.projectId},'Proyecto eliminado');if(ok){dialog=null;selectedId='';page='home';render();}}
  else if(dialog?.kind==='instance'){const ok=await apply('delete_instance',{projectId:dialog.projectId,name:dialog.name},'Instancia eliminada');if(ok){dialog=null;render();}}
 }
});
root.addEventListener('contextmenu',e=>{
 if(!(e.target instanceof Element)||!isAdmin())return;
 const proj=e.target.closest('[data-context]');if(!proj)return;
 e.preventDefault();contextMenu={id:proj.dataset.context,x:e.clientX,y:e.clientY};render();
});
window.addEventListener('keydown',e=>{
 if(e.key==='Tab' && dialog){
   const controls=[...root.querySelectorAll('.dialog button:not([disabled]),.dialog input:not([disabled]),.dialog select:not([disabled]),.dialog textarea:not([disabled]),.dialog [tabindex]:not([tabindex="-1"])')].filter(el=>el.getClientRects().length);
   if(controls.length){const first=controls[0],last=controls[controls.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
 }
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'&&db.user){e.preventDefault();navigate('home');document.querySelector('#catalog-search')?.focus();return;}
 if(e.key==='Escape'){
   if(contextMenu){contextMenu=null;render();}
   else if(dialog)closeDialog();
   else if(chatWith){chatWith='';render();}
 }
});
root.addEventListener('pointerdown',e=>{if(e.target?.id!=='crop-canvas'||!cropState)return;cropPointer={x:e.clientX,y:e.clientY,px:cropState.panX,py:cropState.panY};e.target.setPointerCapture(e.pointerId);});
root.addEventListener('pointermove',e=>{if(!cropPointer||e.target?.id!=='crop-canvas'||!cropState)return;const rect=e.target.getBoundingClientRect();cropState.panX=cropPointer.px+(e.clientX-cropPointer.x)/rect.width;cropState.panY=cropPointer.py+(e.clientY-cropPointer.y)/rect.height;paintCrop();});
root.addEventListener('pointerup',()=>{cropPointer=null;});root.addEventListener('pointercancel',()=>{cropPointer=null;});
enableButtonFeedback(root,()=>prefs.reducedMotion);

async function loadMinecraftVersions(){
 if(minecraftVersions.length||!native)return;
 try{minecraftVersions=await command('minecraft_versions');const dl=document.getElementById('mc-version-catalog');if(dl)syncVersionSuggestions();const versionInput=document.getElementById('mc-instance-version');if(versionInput&&!versionInput.value){versionInput.value=(minecraftVersions.find(v=>v.kind==='release')||minecraftVersions[0])?.id||'';}}
 catch(e){message('No se pudo consultar Mojang: '+String(e),true)}
}
async function loadFabricLoaders(version){
 if(!native||!version)return;
 try{fabricLoaders=await command('fabric_loaders',{version});const dl=document.getElementById('mc-fabric-catalog');if(dl)dl.innerHTML=fabricLoaders.map(v=>`<option value="${attr(v)}"></option>`).join('');const input=document.getElementById('fabric-loader-version');if(input&&!input.value&&fabricLoaders.length)input.value=fabricLoaders[0];}
 catch(e){message('No se pudo consultar Fabric: '+String(e),true)}
}
async function exportWorldsInstance(projectId,name){
 if(!native||!T?.dialog?.save)return message('Exportar requiere VIS Nexo instalado.',true);
 const instance=db.instances.find(i=>i.project_id===projectId&&i.name===name);if(!instance)return;
 const safe=String(name).replace(/[^a-zA-Z0-9_-]+/g,'-').slice(0,60)||'instancia';
 try{const destination=await T.dialog.save({title:'Exportar instancia VIS Worlds',defaultPath:`${safe}.zip`,filters:[{name:'VIS Worlds ZIP',extensions:['zip']}]});
  if(!destination)return;
  message('Creando paquete portátil de la instancia…');
  const result=await command('export_worlds_instance',{projectId,name,destination});message(`Paquete listo: ${result}`);
 }catch(e){message(String(e),true)}
}
async function importWorldsInstance(){
 if(!native||!T?.dialog?.open)return message('Importar requiere VIS Nexo instalado.',true);
 try{
  const archive=await T.dialog.open({title:'Abrir paquete de instancia VIS Worlds',directory:false,multiple:false,filters:[{name:'VIS Worlds ZIP',extensions:['zip']}]});
  if(!archive)return;
  const library=await T.dialog.open({title:'Elegir dónde guardar la instancia importada (incluidos sus archivos de Minecraft)',directory:true,multiple:false});
  if(!library)return;
  message('Importando instancia y verificando rutas…');
  db=await command('import_worlds_instance',{archive,library});render();message('Instancia importada. Revisá la versión antes de jugar.');
 }catch(e){message(String(e),true)}
}
async function performInstall(projectId,name){
 if(!native)return message('La instalación real requiere ejecutar el cliente Tauri.',true);
 if(minecraftBusy)return;
 minecraftBusy=true;installProgress={detail:'Iniciando instalación',completed:0,total:1};render();
 try{db=await command('install_minecraft',{projectId,name});message('Minecraft se instaló correctamente.');}
 catch(e){message(String(e),true)}finally{minecraftBusy=false;installProgress=null;render();}
}
async function performLaunch(projectId,name,sourceOwner=''){
 lastMinecraftExit=null;
 if(!native)return message('Para iniciar Minecraft abrí el cliente Tauri.',true);
 try{
  const instance=db.instances.find(i=>i.project_id===projectId&&i.name===name);
  let result;
  if(instance?.engine==='horizon'){
    const sessionFile=''; // Supported local game mode; Microsoft integration remains separate.
    result=await command('launch_horizon',{projectId,name,sessionFile,sourceOwner:sourceOwner||null});
  }else{
    result=await command('launch_minecraft',{projectId,name,sourceOwner:sourceOwner||null});
  }
  message(`Minecraft iniciado · PID ${result.pid}. Logs en ${result.log_file}`);
 }catch(e){message(String(e),true)}
}
async function performModSearch(data){
 const i=selectedMcInstance();if(!i)return;
 modKind=String(data.get('kind')||'mod');modSearchQuery=String(data.get('query')||'').trim();
 if(!native)return message('La búsqueda Modrinth requiere ejecutar Tauri.',true);
 try{
  if(modKind==='mod'&&i.loader!=='fabric')return message('Para instalar mods necesitás una instancia Fabric. Los packs sí funcionan con Vanilla.',true);
  modResults=await command('search_modrinth',{query:modSearchQuery,version:i.version,kind:modKind});render();message(`${modResults.length} resultados compatibles`);
 }
 catch(e){message(String(e),true)}
}
async function performModInstall(modId){
 const i=selectedMcInstance();if(!i)return;
 if(!native)return message('La descarga requiere Tauri.',true);
 try{const files=await command('install_modrinth',{projectId:i.project_id,name:i.name,modId,kind:modKind});message(`Instalado: ${files.join(', ')}`);await refreshInstalledFiles();}
 catch(e){message(String(e),true)}
}
async function refreshInstalledFiles(){
 const i=selectedMcInstance();if(!native||!i)return;
 try{installedFiles=await command('list_instance_files',{projectId:i.project_id,name:i.name});if(page==='minecraft')render();}
 catch(e){message(String(e),true)}
}
async function importMcFile(kind){
 const i=selectedMcInstance();if(!i)return;
 if(!native)return message('La importación requiere Tauri.',true);
 try{const filter=kind==='mod'?'jar':'zip';const path=await T.dialog.open({directory:false,multiple:false,title:'Importar recurso Minecraft',filters:[{name:'Recurso Minecraft',extensions:[filter]}]});
  if(!path)return;await command('import_instance_file',{projectId:i.project_id,name:i.name,path,kind});message('Archivo importado');await refreshInstalledFiles();}
 catch(e){message(String(e),true)}
}
async function toggleMcFile(kind,file){
 const i=selectedMcInstance();if(!i)return;
 if(!native)return message('Esta acción requiere VIS Nexo instalado.',true);
 try{const renamed=await command('toggle_instance_file',{projectId:i.project_id,name:i.name,kind,file});
  message(`Recurso ${renamed.endsWith('.disabled')?'desactivado':'activado'} sin borrar sus datos.`);await refreshInstalledFiles();}
 catch(e){message(String(e),true)}
}
async function removeMcFile(kind,file){
 const i=selectedMcInstance();if(!i||!confirm(`¿Eliminar ${file} de esta instancia?`))return;
 try{await command('remove_instance_file',{projectId:i.project_id,name:i.name,kind,file});message('Recurso eliminado');await refreshInstalledFiles();}
 catch(e){message(String(e),true)}
}
async function boot(){
 if(native&&T?.event?.listen){
  T.event.listen('minecraft-progress',e=>{installProgress=e.payload;const el=document.querySelector('#minecraft-progress');if(el)el.textContent=`${e.payload.stage}: ${e.payload.completed}/${e.payload.total} · ${e.payload.detail}`;updateDownloadDock();}).catch(()=>{});
  T.event.listen('minecraft-process-exited',e=>{
    lastMinecraftExit=e.payload;
    if(!e.payload.success)message(`Minecraft finalizó con error (${e.payload.exit_code??'sin código'}). Revisá el log: ${e.payload.log_file}`,true);
    else message('Minecraft se cerró correctamente.');
    if(page==='minecraft'||page==='instances')render();
  }).catch(()=>{});
}
 try {db=await command('get_state');await refreshAssets();}
 catch(e){message(`No se pudo inicializar el cliente: ${String(e)}`,true);}
 render();
 if(native){void checkAppUpdate(true);void refreshCloudCatalog(true);}
}
boot();
