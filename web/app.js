import { animateEntrance, animateAuthSwap, animateModal, animateModalStep, animateSocial, animateSocialTab, animateChat, animateFeed, animateAvatar, animateControl, animateProjectMotion, beginSectionChange, beginSurfaceDismiss, animateSetting, cancelPendingSectionChange, enableButtonFeedback } from './effects.js';
import { createSocialRemote } from './social-remote.js';
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
const empty = () => ({user:null,projects:[],instances:[],friends:[],incoming_requests:[],outgoing_requests:[],messages:[],branding:{name:'VIS Nexo',launcher_logo:'',home_image:'',login_image:''},project_execution:{},recent_accounts:[],catalog_source:'',hidden_shared_instances:[],mode:native?'local':'preview'});
let db = empty();
// Network responses and UI actions belong to the account that started them.
let accountGeneration=0;
const pendingOperations=new Set();
function resetAccountView(){
 accountGeneration++;
 mcSelected=null;modResults=[];installedFiles=[];horizonChecks=[];
 bulkInstanceMode=false;bulkInstanceSelection.clear();
 cloudCatalog=null;premiumCosmetics=null;socialOverlay=null;downloadJobs=[];teamReview=null;
  premiumSkinSync=true;premiumSkinModel='classic';
 socialAvatars.clear();socialSkins.clear();skinLoads.clear();avatarLoads.clear();
 socialMediaQueue.length=0;publicSkinLookup=null;
 projectCommunity=null;projectCommunityId='';projectCommunityLoading=false;projectCommunityError='';
 for(const path of Object.keys(assetCache))delete assetCache[path];
 previewCacheOrder.length=0;previewCacheBytes=0;previewFailed.clear();
 previewLoading.clear();
 chatWith='';chatWindowSize=100;friendFilter='';
}
async function onceOperation(key,operation){
 if(pendingOperations.has(key))return false;
 pendingOperations.add(key);
 try{return await operation();}finally{pendingOperations.delete(key);}
}
let page = 'home', selectedId = '', authMode='login', authProvider=native?'cloud':'local', authBusy=false, showPassword=false;
let microsoftTicket=null, microsoftPollGeneration=0, microsoftGamertag=null;
let premiumCosmetics=null, premiumCosmeticsBusy=false;
let premiumSkinSync=true, premiumSkinModel='classic';
async function cancelMicrosoftLogin(){
 microsoftPollGeneration++;
 microsoftTicket=null;
 if(native)try{await command('microsoft_cancel');}catch{/* Already cancelled. */}
}
async function copyMicrosoftText(value,label){
 if(typeof value!=='string'||!value)return;
 try{
   if(!navigator.clipboard?.writeText)throw Error('Clipboard API unavailable');
   await navigator.clipboard.writeText(value);
   message(label+' copiado al portapapeles.');
 }catch{
   // Native clipboard can be denied by the desktop/Wayland portal.
   // The text remains selectable in the browser prompt.
   window.prompt('Copiá el '+label.toLowerCase()+' manualmente:',value);
 }
}
async function beginMicrosoftLogin(){
 if(authBusy)return;
 if(!native){message('Microsoft requiere la aplicación de escritorio.',true);return;}
 microsoftPollGeneration++;
 const generation=microsoftPollGeneration;
 authMode='login';authProvider='microsoft';microsoftTicket=null;authBusy=true;render();
 try{
   const ticket=await command('microsoft_begin');
   if(generation!==microsoftPollGeneration){await command('microsoft_cancel');return;}
   microsoftTicket=ticket;authBusy=false;render();
   let interval=Number(ticket.interval||5);
   while(generation===microsoftPollGeneration&&authProvider==='microsoft'&&!db.user){
     await new Promise(resolve=>setTimeout(resolve,Math.max(3,interval)*1000));
     if(generation!==microsoftPollGeneration||authProvider!=='microsoft'||db.user)break;
     const result=await command('microsoft_poll');
     if(result.status==='pending'){interval=Number(result.interval||5);continue;}
     if(result.status==='connected'){
       microsoftTicket=null;
       resetAccountView();
       db=result.snapshot;
       microsoftGamertag=result.minecraft_name;
       premiumCosmetics=null;
       page='home';render();void refreshAssets().catch(()=>{});
       message('Microsoft conectado · Minecraft '+result.minecraft_name);
       // Minecraft authentication and VIS Social are separate identities.
       // Connect the user's VIS Portals session too (never send a Minecraft token).
       if(native)void connectSocial(false);
       return;
     }
     if(result.status==='expired'||result.status==='denied'){
       microsoftTicket=null;render();message(result.status==='expired'?
         'El código Microsoft venció. Volvé a intentar.':
         'Se canceló la autorización Microsoft.',true);return;
     }
     if(result.status==='idle'){microsoftTicket=null;render();return;}
   }
 }catch(error){
   if(generation===microsoftPollGeneration){microsoftTicket=null;message(String(error),true);render();}
 }finally{if(generation===microsoftPollGeneration){authBusy=false;render();}}
}

let socialVisible = innerWidth >= 980, socialTab='global', chatWith='', friendFilter='', activeFeed='news', dialog=null, stateEditorOpen=false;
let projectCommunity=null, projectCommunityId='', projectCommunityLoading=false, projectCommunityError='';
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
const visibleSection = (p,key) => p?.visible_sections?.[key] !== false;
let cropState = null, cropImage = null, cropPointer = null;
let previousView = null;
let minecraftVersions = [], fabricLoaders = [], modResults = [], installedFiles = [];
let projectModResults = [], projectModQuery = '';
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
let maintenanceReport = null, maintenanceLoading = false, legacyReport = null, legacyLoading = false;
let updateInfo = null, updateBusy = false, cloudCatalog = null, cloudCatalogBusy = false;
let lastMinecraftExit = null;
let horizonChecks = [];
let horizonLibraryBuilds = [];
let mcSelected = null, modKind = 'mod', modSearchQuery = '', installProgress = null, minecraftBusy = false;
let teamReview=null;
let downloadJobs = []; // Native, in-memory, account-filtered installer history.
let bulkInstanceMode=false;
const bulkInstanceSelection=new Set();
const instanceSelectionKey=(instance)=>JSON.stringify([instance.source_owner||'',instance.project_id,instance.name]);
let lastDialogTrigger = null;
let prefs = {reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches};
let demoAccounts=[];
const clone = (x) => JSON.parse(JSON.stringify(x));
const esc = (v) => String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const attr=esc;
const humanRole = (role) => role === 'admin'?'Administrador':'Jugador';
const displayAccount = (name) => name==='vis_studios' ? 'VIS STUDIOS' :
  (name?.startsWith('msa_')&&microsoftGamertag?microsoftGamertag:name);
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
  download:'<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  refresh:'<path d="M20 7v5h-5M4 17v-5h5M6 9a7 7 0 0 1 12-2l2 5M4 12l2 5a7 7 0 0 0 12-2"/>',
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
    db.user={username:nick,role:'user',presence:'offline',avatar:'',skin:'',cape:'',avatar_layer:'',profile_banner:''};db.mode='offline';db.instances=[];return clone(db);
  }
  if(name==='logout'){db.user=null;db.mode='preview';return clone(db);}
  if(name==='clear_asset') { if(!db.user)throw new Error('Iniciá sesión');
    if(['home','launcher_logo'].includes(args.kind)){if(db.user.role!=='admin')throw new Error('Solo admin');db.branding[args.kind==='home'?'home_image':'launcher_logo']='';}
    else if(['avatar','skin','cape','avatar_layer','profile_banner'].includes(args.kind))db.user[args.kind]='';
    return clone(db); }
  if(name==='commit_profile_asset'){if(!db.user||db.mode==='offline')throw new Error('Iniciá sesión');db.user[args.kind]=args.path;return clone(db);}
  if(name==='set_avatar_preset'){if(!db.user)throw new Error('Iniciá sesión');if(!['nova','orbit','eclipse','nebula','pulse'].includes(args.preset))throw new Error('Avatar inválido');db.user.avatar='preset:'+args.preset;return clone(db);}
  if(!u)throw new Error('Iniciá sesión primero');
  if(db.mode==='offline')throw new Error('El modo offline solo permite jugar instancias instaladas.');
  if(name==='save_project'){
    if(u.role!=='admin')throw new Error('Solo admin');
    const p=args.project;p.id=p.id||p.title.trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    if(!p.id)throw new Error('Necesitás un nombre para el proyecto');
    const ix=db.projects.findIndex(x=>x.id===p.id);if(ix>=0)db.projects[ix]=clone(p);else db.projects.push(clone(p));return clone(db);
  }
  if(name==='set_project_execution'){if(u.role!=='admin')throw new Error('Solo admin');db.project_execution[args.projectId]=args.enabled;return clone(db);}
  if(name==='delete_project'){db.projects=db.projects.filter(p=>p.id!==args.projectId);return clone(db);}
  if(name==='save_instance'){const i=db.instances.findIndex(x=>x.name===args.instance.name&&x.project_id===args.instance.project_id);if(i>=0)db.instances[i]=args.instance;else db.instances.push(args.instance);return clone(db);}
  if(name==='delete_instance'){db.instances=db.instances.filter(x=>x.name!==args.name||x.project_id!==args.projectId);return clone(db);}
  if(name==='list_instance_files')return [];
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
// Full-size originals stay on disk. Cache reduced in-memory WebP previews;
// loading hundreds of 12-MB images concurrently caused large UI RAM spikes.
const previewLoading=new Map();
const previewFailed=new Set();
const PREVIEW_CACHE_ENTRIES=64,PREVIEW_CACHE_BYTES=32*1024*1024;
const previewCacheOrder=[];
let previewCacheBytes=0;
function rememberPreview(path,source){
  if(typeof source!=='string'||!source)return;
  // Oversized or damaged images must never monopolize the WebView heap.
  if(source.length>PREVIEW_CACHE_BYTES){previewFailed.add(path);return;}
  if(assetCache[path]){
    previewCacheBytes-=assetCache[path].length;
    const index=previewCacheOrder.indexOf(path);
    if(index>=0)previewCacheOrder.splice(index,1);
  }
  assetCache[path]=source;
  previewCacheOrder.push(path);
  previewCacheBytes+=source.length;
  while((previewCacheOrder.length>PREVIEW_CACHE_ENTRIES||previewCacheBytes>PREVIEW_CACHE_BYTES)
      &&previewCacheOrder.length>1){
    const oldest=previewCacheOrder.shift();
    previewCacheBytes-=assetCache[oldest]?.length||0;
    delete assetCache[oldest];
  }
}
async function compactPreview(path,source){
  if(typeof source!=='string'||!source.startsWith('data:image/')||source.length<512*1024)return source;
  if([db.user?.skin,db.user?.cape,db.user?.avatar_layer].includes(path))return source;
  try{
    const img=new Image();img.src=source;await img.decode();
    const icon=db.projects.some(p=>p.icon_path===path);
    const max=icon?512:1920;
    const ratio=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(img.naturalWidth*ratio));
    canvas.height=Math.max(1,Math.round(img.naturalHeight*ratio));
    const ctx=canvas.getContext('2d');
    if(!ctx||canvas.width*canvas.height>4_000_000)return source;
    ctx.drawImage(img,0,0,canvas.width,canvas.height);
    const webp=canvas.toDataURL('image/webp',0.84);
    return webp.startsWith('data:image/webp;')&&webp.length<source.length?webp:source;
  }catch{return source;}
}
async function fetchPreview(path){
  if(!path||assetCache[path]||previewFailed.has(path))return;
  if(previewLoading.has(path))return previewLoading.get(path);
  const generation=accountGeneration;
  const pending=(async()=>{
    try{
      const source=await command('preview_asset',{path});
      if(generation!==accountGeneration)return;
      const reduced=await compactPreview(path,source);
      if(generation===accountGeneration)rememberPreview(path,reduced);
    }catch{if(generation===accountGeneration)previewFailed.add(path);}
    finally{if(previewLoading.get(path)===pending)previewLoading.delete(path);}
  })();
  previewLoading.set(path,pending);
  return pending;
}
async function refreshAssets(){
  if(!native||!db.user)return;
  const generation=accountGeneration;
  const selected=db.projects.find(p=>p.id===selectedId);
  // Fetch only assets visible now, never the entire catalogue at login.
  const visible=[db.user.avatar,db.user.skin,db.user.cape,db.user.avatar_layer,
    db.user.profile_banner,db.branding.launcher_logo,db.branding.home_image,
    selected?.icon_path,selected?.banner_path,selected?.logo_path,
    ...db.projects.slice(0,5).flatMap(p=>[p.icon_path,p.banner_path])].filter(Boolean);
  const items=[...new Set(visible)];
  for(let i=0;i<items.length;i+=3){
    if(generation!==accountGeneration)return;
    await Promise.all(items.slice(i,i+3).map(fetchPreview));
  }
  if(generation===accountGeneration)scheduleSocialRender();
}
let socialMode = 'disconnected', socialError = '', socialOverlay = null;
const socialAvatars=new Map(), avatarLoads=new Set();
const socialSkins=new Map(), skinLoads=new Set();
// Limit simultaneous image requests after login: avoid bursts of dozens
// of Cloudflare/IndexedDB operations on slow or metered connections.
const socialMediaQueue=[];
let socialMediaActive=0;
function pumpSocialMedia(){
 while(socialMediaActive<3&&socialMediaQueue.length){
   const task=socialMediaQueue.shift();
   socialMediaActive++;
   Promise.resolve().then(task).catch(()=>{}).finally(()=>{
     socialMediaActive--;pumpSocialMedia();
   });
 }
}
function queueSocialMedia(task){
 if(socialMediaQueue.length>=80)return false;
 socialMediaQueue.push(task);pumpSocialMedia();return true;
}
function rememberSocialMedia(cache,username,data,maxEntries){
 if(cache.has(username))cache.delete(username);
 cache.set(username,data);
 while(cache.size>maxEntries)cache.delete(cache.keys().next().value);
}
let publicSkinLookup=null, skinSharingBusy=false;
let socialRenderScheduled=false;
function scheduleSocialRender(){
  if(socialRenderScheduled||!db.user||document.hidden)return;
  socialRenderScheduled=true;
  requestAnimationFrame(()=>{
    socialRenderScheduled=false;
    if(db.user&&!document.hidden)render();
  });
}
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden&&db.user)scheduleSocialRender();
});
function socialAvatarHtml(username,size=34,owned=false) {
 const entry=socialAvatars.get(username);
 if(entry?.url)return `<span class="avatar" style="width:${size}px;height:${size}px"><img alt="" src="${attr(entry.url)}"/></span>`;
 const head=socialSkins.get(username)?.head;
 if(head)return `<span class="avatar vis-skin-head" style="width:${size}px;height:${size}px"><img alt="Skin VIS de ${attr(username)}" src="${attr(head)}"/></span>`;
 return owned?avatarVisual(db.user?.avatar,username,size,true):avatarVisual('',username,size);
}
function refreshSocialAvatars(snapshot) {
 const generation=accountGeneration,owner=snapshot.username;
 const currentChat=(snapshot.friends||[]).find(p=>p.username===chatWith);
 const entries=[{username:owner,avatar_version:snapshot.avatar_version},
   ...(snapshot.friends||[]).slice(0,50),...(currentChat?[currentChat]:[])];
 for(const person of entries){
   const version=Number(person.avatar_version||0),username=person.username;
   if(!username||!version||socialAvatars.get(username)?.version===version)continue;
   const key=username+':'+version;
   if(avatarLoads.has(key))continue;
   avatarLoads.add(key);
   if(!queueSocialMedia(async()=>{
     try{
       if(generation!==accountGeneration||db.user?.username!==owner||!social.connected())return;
       const result=await social.getAvatar(username);
       if(generation!==accountGeneration||db.user?.username!==owner)return;
       if(result.avatar&&(!result.avatar.startsWith('data:image/webp;base64,')||result.avatar.length>40000))return;
       rememberSocialMedia(socialAvatars,username,{version,url:result.avatar||''},80);
       scheduleSocialRender();
     }catch{/* Network/media failures must never stop the chat itself. */}
     finally{avatarLoads.delete(key);}
   }))avatarLoads.delete(key);
 }
}
function skinHeadPreview(dataUrl){
 return new Promise((resolve,reject)=>{
   if(!/^data:image\/png;base64,[A-Za-z0-9+/]*={0,2}$/.test(dataUrl)||dataUrl.length>87500){
     reject(Error('PNG de skin inválido'));return;
   }
   const image=new Image();
   image.onload=()=>{
     if(image.naturalWidth!==64||![32,64].includes(image.naturalHeight)){
       reject(Error('La skin debe medir 64×64 o 64×32'));return;
     }
     const canvas=document.createElement('canvas');canvas.width=8;canvas.height=8;
     const ctx=canvas.getContext('2d');if(!ctx){reject(Error('Vista previa no disponible'));return;}
     ctx.imageSmoothingEnabled=false;
     ctx.drawImage(image,8,8,8,8,0,0,8,8);
     ctx.drawImage(image,40,8,8,8,0,0,8,8);
     resolve(canvas.toDataURL('image/png'));
   };
   image.onerror=()=>reject(Error('No se pudo decodificar la skin'));
   image.src=dataUrl;
 });
}
function refreshSocialSkins(snapshot){
 const generation=accountGeneration,owner=snapshot.username;
 const currentChat=(snapshot.friends||[]).find(p=>p.username===chatWith);
 const entries=[{username:owner,skin_version:snapshot.skin_version},
   ...(snapshot.friends||[]).slice(0,40),...(currentChat?[currentChat]:[])];
 for(const entry of entries){
   const username=entry.username,version=Number(entry.skin_version||0);
   if(!username||!Number.isFinite(version)||version<0)continue;
   if(socialSkins.get(username)?.version===version)continue;
   if(version===0){
     rememberSocialMedia(socialSkins,username,{version,skin:null,head:''},45);
     continue;
   }
   const key=username+':'+version;if(skinLoads.has(key))continue;
   skinLoads.add(key);
   if(!queueSocialMedia(async()=>{
     try{
       if(generation!==accountGeneration||db.user?.username!==owner||!social.connected())return;
       const result=await social.getSkin(username),png=result.skin||null;
       if(generation!==accountGeneration||db.user?.username!==owner)return;
       if(png&&(!png.startsWith('data:image/png;base64,')||png.length>87500))return;
       const head=png?await skinHeadPreview(png):'';
       if(generation!==accountGeneration||db.user?.username!==owner)return;
       rememberSocialMedia(socialSkins,username,{version,skin:png,head},45);
       scheduleSocialRender();
     }catch{/* Invalid or unavailable skins remain placeholders. */}
     finally{skinLoads.delete(key);}
   }))skinLoads.delete(key);
 }
}
async function normalizeSkinForSocial(dataUrl){
 if(!dataUrl){
   const path=db.user?.skin;
   if(!path)throw Error('Importá una skin PNG antes de compartirla');
   dataUrl=preview(path)||(native?await command('preview_asset',{path}):'');
 }
 // Browser decoding and re-encoding strips untrusted ancillary metadata from
 // uploaded PNGs while preserving 64x64/64x32 alpha pixel layouts.
 const image=new Image();
 image.src=dataUrl;
 await new Promise((resolve,reject)=>{
   if(image.complete&&image.naturalWidth)return resolve();
   image.onload=resolve;image.onerror=()=>reject(Error('PNG de skin inválido'));
 });
 if(image.naturalWidth!==64||![32,64].includes(image.naturalHeight))
   throw Error('La skin debe medir 64×64 o 64×32');
 const canvas=document.createElement('canvas');canvas.width=64;canvas.height=image.naturalHeight;
 const ctx=canvas.getContext('2d');
 if(!ctx)throw Error('No se pudo procesar la skin');
 ctx.imageSmoothingEnabled=false;ctx.drawImage(image,0,0);
 const clean=canvas.toDataURL('image/png');
 if(clean.length>87500)throw Error('La skin supera 64 KiB; optimizá su textura antes de publicarla');
 return clean;
}
async function publishLocalSkin(dataUrl=null){
 if(skinSharingBusy)return;
 if(!social.connected()){
   message('Skin guardada localmente. Conectá VIS Social para publicarla a otros jugadores.',true);return;
 }
 skinSharingBusy=true;render();
 try{
   const clean=await normalizeSkinForSocial(dataUrl);
   await social.uploadSkin(clean);
   socialSkins.delete(db.user.username);
   const result=await social.getSkin(db.user.username);
   const head=result.skin?await skinHeadPreview(result.skin):'';
   rememberSocialMedia(socialSkins,db.user.username,{version:Number(result.skin_version||0),skin:result.skin||null,head},45);
   message('Skin VIS publicada. Otros jugadores conectados pueden verla por tu usuario VIS.');
 }catch(error){message('No se pudo publicar la skin: '+String(error),true);}
 finally{skinSharingBusy=false;render();}
}
async function removePublicSkin(){
 if(!social.connected())return message('Conectá VIS Social para quitar la skin pública.',true);
 if(!window.confirm('¿Dejar de mostrar tu skin VIS a otros jugadores? La skin local se conserva.'))return;
 try{
   await social.deleteSkin();
   socialSkins.delete(db.user.username);
   message('La skin pública ya no está disponible. Tu skin local sigue intacta.');
   render();
 }catch(error){message(String(error),true);}
}
async function lookupPublicSkin(username){
 if(!social.connected())return message('Conectá VIS Social para buscar skins públicas.',true);
 const handle=String(username||'').trim().toLowerCase();
 if(!/^[a-z0-9_]{3,24}$/.test(handle))return message('Ingresá un usuario VIS válido.',true);
 publicSkinLookup={username:handle,loading:true,skin:null,head:'',error:''};
 dialog={type:'vis-skin'};render();
 try{
   const skin=await social.getSkin(handle);
   const head=skin.skin?await skinHeadPreview(skin.skin):'';
   rememberSocialMedia(socialSkins,handle,{version:Number(skin.skin_version||0),skin:skin.skin||null,head},45);
   if(publicSkinLookup?.username===handle){publicSkinLookup={username:handle,skin:skin.skin||null,head,loading:false,error:''};render();}
 }catch(error){
   if(publicSkinLookup?.username===handle){publicSkinLookup={username:handle,skin:null,head:'',loading:false,error:String(error)};render();}
 }
}
function mergeSocialView() {
  if (!socialOverlay || !db.user || socialOverlay.username !== db.user.username) return;
  db.friends = socialOverlay.friends;
  db.incoming_requests = socialOverlay.incoming_requests;
  db.outgoing_requests = socialOverlay.outgoing_requests;
  db.messages = socialOverlay.messages;
}
const social = createSocialRemote(command, (snapshot, messages) => {
  if (!db.user || snapshot.username !== db.user.username) return;
  socialOverlay = { username:snapshot.username, friends:snapshot.friends||[],
    incoming_requests:snapshot.incoming_requests||[], outgoing_requests:snapshot.outgoing_requests||[],
    messages:messages||[] };
  mergeSocialView();
  if(page==='project'&&selectedId&&projectCommunityId!==selectedId&&!projectCommunityLoading)void loadProjectCommunity(selectedId);
  refreshSocialAvatars(snapshot);
  refreshSocialSkins(snapshot);
  scheduleSocialRender();
}, (mode, error) => {
  if (socialMode === mode && socialError === (error||'')) return;
  socialMode = mode;
  socialError = error || '';
  if (db.user) scheduleSocialRender();
});
async function enableSocialCloudPassword(){
 if(!social.connected()){message('Conectá VIS Social para vincular la cuenta.',true);return;}
 const password=window.prompt('Nueva contraseña online (mínimo 10 caracteres, no uses el PIN local):');
 if(password===null)return;
 const confirm=window.prompt('Repetí la nueva contraseña online:');
 if(confirm===null)return;
 try{const reply=await command('social_enable_cloud_password',{password,confirm});
   message('Cuenta vinculada. Tu ID pública: '+reply.public_id);
   await social.sync();
 }catch(error){message(String(error),true);}
}
async function selectAndUploadSocialAvatar(){
 if(!social.connected()){message('Conectá VIS Social para subir tu imagen.',true);return;}
 const chooser=document.createElement('input');chooser.type='file';
 chooser.accept='image/png,image/jpeg,image/webp';chooser.hidden=true;
 chooser.addEventListener('change',async()=>{
  const file=chooser.files?.[0];if(!file)return;
  if(file.size>8*1024*1024){message('La imagen de origen supera 8 MB.',true);return;}
  let url='';
  try{
   url=URL.createObjectURL(file);
   const img=new Image();img.src=url;
   await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('Imagen no válida'));});
   const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;
   const ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvas no disponible');
   const crop=Math.min(img.naturalWidth,img.naturalHeight);
   if(!crop)throw Error('Imagen vacía');
   ctx.drawImage(img,(img.naturalWidth-crop)/2,(img.naturalHeight-crop)/2,crop,crop,0,0,128,128);
   let data='';
   for(const quality of [0.80,0.65,0.48,0.30]){
    data=canvas.toDataURL('image/webp',quality);
    if(data.startsWith('data:image/webp;base64,')&&data.length<32800)break;
   }
   if(!data.startsWith('data:image/webp;base64,')||data.length>=32800)
     throw Error('No se pudo comprimir la imagen en WebP a 24 KB');
   await social.uploadAvatar(data);
   socialAvatars.delete(db.user?.username);
   const avatar=await social.getAvatar(db.user.username);
   socialAvatars.set(db.user.username,{version:avatar.avatar_version,url:avatar.avatar||''});
   render();message('Foto de perfil sincronizada en VIS Social.');
  }catch(error){message(String(error),true);}
  finally{if(url)URL.revokeObjectURL(url);}
 },{once:true});
 chooser.click();
}
async function connectSocial(reuseCloudSession=false) {
  if (!native || !db.user || isGuest()) return;
  try { await social.start(db.user.username,reuseCloudSession); }
  catch (error) { message('VIS Social sin conexión: ' + String(error), true); }
}
async function apply(name,args={},success=''){
 const generation=accountGeneration;
 return onceOperation('mutation:'+name+':'+JSON.stringify(args),async()=>{
  try {
    const updated=await command(name,args);
    if(generation!==accountGeneration)return false;
    db=updated;
    mergeSocialView();
    render();
    void refreshAssets().catch(()=>{});
    if(success)message(success);
    return true;
  }catch(e){if(generation===accountGeneration)message(String(e),true);return false;}
 });
}
function brandLabel(){return esc(db.branding?.name||'VIS Nexo');}
function loginView(){
  const reg=authMode==='register', guest=authMode==='offline';
  return `<main class="auth-screen">
    <section class="auth-glass" aria-label="${guest?'Acceso offline':reg?'Crear cuenta':'Inicio de sesión'}">
      <div class="auth-brand">${logo(true)}<span>${brandLabel()}</span></div>
      <div class="auth-intro"><span class="kicker">ACCESO A TU CUENTA</span><h1>${guest?'Entrá sin cuenta':reg?'Creá tu cuenta':'Iniciá sesión'}</h1><p>${guest?'Elegí un nick temporal para iniciar instancias ya instaladas.':reg?'Registrate para empezar a gestionar tus proyectos.':'Ingresá a tu biblioteca, proyectos y comunidad.'}</p></div>
      <div class="auth-switch" role="tablist" aria-label="Método de acceso">
        <button class="auth-choice ${!guest&&authProvider==='cloud'?'active':'inactive'}" data-action="auth-online" type="button" aria-selected="${!guest&&authProvider==='cloud'}">${I('cloud',17)}<span>Cuenta VIS</span></button>
        <button class="auth-choice ${!guest&&authProvider==='local'?'active':'inactive'}" data-action="auth-local" type="button" aria-selected="${!guest&&authProvider==='local'}">${I('user',17)}<span>Cuenta local</span></button>
        <button class="auth-choice ${authProvider==='microsoft'?'active':'inactive'}" data-action="auth-microsoft" type="button" aria-selected="${authProvider==='microsoft'}">${msMark()}<span>Microsoft</span></button>
        <button class="auth-choice ${guest?'active':'inactive'}" data-action="auth-offline" type="button" aria-selected="${guest}">${I('game',17)}<span>Offline</span></button>
      </div>
      ${!guest&&db.recent_accounts?.length?`<div class="recent-logins"><span class="field-label">ACCESO RÁPIDO · ÚLTIMAS 3 CUENTAS</span><div class="recent-account-list">${db.recent_accounts.slice(0,3).map(r=>`<button type="button" data-action="recent-account" data-id="${attr(r.username)}" class="recent-account">${I('user',16)}<span>${esc(r.provider==='microsoft'?'Minecraft Premium':r.username)}</span><small>${esc(r.provider==='microsoft'?'Microsoft · Reautorizar si venció':'Local')}</small></button>`).join('')}</div><small>Elegir una cuenta no omite su contraseña.</small></div>`:''}
      ${authProvider==='microsoft'?`<section class="microsoft-device-flow" aria-label="Inicio de sesión de Minecraft oficial">
        <p>Iniciá sesión desde el navegador oficial de Microsoft. VIS Nexo nunca te solicita la contraseña de Microsoft.</p>
        ${microsoftTicket?`<div class="ms-code" aria-label="Código Microsoft">${esc(microsoftTicket.user_code)}</div>
        <button class="primary-btn" type="button" data-action="microsoft-open-verification">${I('external',18)} Abrir Microsoft y colocar el código</button>
        <div class="ms-copy-options"><button class="outline-btn" type="button" data-action="microsoft-copy-code">${I('copy',15)} Copiar código</button><button class="outline-btn" type="button" data-action="microsoft-copy-url">${I('copy',15)} Copiar enlace</button></div>
        <p class="muted">Si no se abre Zen Browser, ingresá manualmente a <strong>microsoft.com/link</strong>, pegá el código y mantené VIS Nexo abierto.</p>
        <p class="muted">Código válido por ${Math.ceil(microsoftTicket.expires_in/60)} minutos. VIS Nexo verificará la autorización automáticamente.</p>
        <button class="auth-footer" type="button" data-action="microsoft-cancel">Cancelar autorización</button>`:
        `<p class="muted">${authBusy?'Solicitando código seguro…':'La autorización aún no comenzó.'}</p>
        <button class="primary-btn" data-action="auth-microsoft" type="button" ${authBusy?'disabled':''}>Obtener nuevo código</button>`}</section>`:
      `<form id="auth-form" class="auth-form" autocomplete="on">
        <label class="field-label" for="auth-name">${guest?'Nick offline':authProvider==='cloud'&&!reg?'ID o nombre de usuario':'Usuario'}</label>
        <div class="auth-input">${I('user',18)}<input required minlength="3" maxlength="${guest?16:reg?24:25}" id="auth-name" name="${guest?'nickname':'username'}" autocomplete="${guest?'off':'username'}" placeholder="${guest?'Nick para Minecraft':authProvider==='cloud'&&!reg?'ID VIS o nombre de usuario':'Nombre de usuario'}" spellcheck="false" /></div>
        ${guest?'':`<div class="field-header"><label class="field-label" for="auth-password">Contraseña</label></div>
        <div class="auth-input">${I('lock',18)}<input required minlength="${authProvider==='cloud'?10:4}" maxlength="128" type="${showPassword?'text':'password'}" id="auth-password" name="password" autocomplete="${reg?'new-password':'current-password'}" placeholder="${reg?'Creá una contraseña':'Ingresá tu contraseña'}"/><button class="eye-button" type="button" data-action="toggle-password" aria-label="Mostrar u ocultar contraseña">${I(showPassword?'eyeoff':'eye',19)}</button></div>
        `}
        ${reg?`<label class="field-label" for="auth-repeat">Confirmar contraseña</label><div class="auth-input">${I('lock',18)}<input required minlength="${authProvider==='cloud'?10:4}" maxlength="128" type="${showPassword?'text':'password'}" name="confirm" id="auth-repeat" autocomplete="new-password" placeholder="Repetí tu contraseña" /></div>`:''}
        <button class="primary-btn auth-submit" type="submit" ${authBusy?'disabled':''}>${authBusy?I('timer',20):I('arrow',20)}<span>${authBusy?'Validando...':guest?'Continuar sin cuenta':reg?'Crear cuenta':'Entrar al launcher'}</span></button>
      </form>`}
      ${authProvider==='microsoft'?'':guest?`<button class="auth-footer" data-action="auth-local" type="button">Volver al inicio de sesión</button>`:`<button class="auth-footer" data-action="switch-auth" type="button">${reg?'¿Ya tenés cuenta?':'¿Todavía no tenés cuenta?'} <strong>${reg?'Iniciá sesión':'Registrate'}</strong></button>`}
      ${!native?`<p class="auth-preview">Vista previa en navegador · Los datos de prueba no se guardan.</p>`:''}
    </section>
    <div class="auth-corner" aria-hidden="true">${I('shield',18)} <span>${guest?'ACCESO TEMPORAL':authProvider==='cloud'?'CUENTA VIS EN LA NUBE':authProvider==='microsoft'?'MICROSOFT + MINECRAFT OFICIAL':'ACCESO LOCAL SEGURO'}</span></div>
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
function socialDisplayName(username){
 const configured=social.state()?.display_name?.trim();
 return configured&&configured!==username?configured:displayAccount(username);
}
function publicVisHandle(){
 return social.state()?.public_handle||db.user?.username||'';
}
function userAvatar(size=36){return socialAvatarHtml(db.user?.username,size,true)}
function sidebar(){
 const personal = libraryMode==='user';
 const items = personal
   ? `${personalInstances().map(i=>`<button class="side-project ${page==='instances'&&mcSelected?.name===i.name?'selected':''}" data-action="sidebar-instance" data-id="${attr(i.name)}" data-project="${attr(i.project_id)}" title="${attr(i.name)} · ${attr(i.version)}" aria-label="Instancia ${attr(i.name)}">${I('game',22)}<span class="side-tooltip">${esc(i.name)}</span></button>`).join('')}
      ${!isGuest()?`<button class="side-add" data-action="new-personal-instance" title="Crear instancia personal" aria-label="Crear instancia personal">${I('plus',22)}</button>`:''}`
   : `${db.projects.map(p=>`<button class="side-project ${page==='project'&&isCurrent(p)?'selected':''}" data-action="open-project" data-id="${attr(p.id)}" data-context="${attr(p.id)}" title="${attr(p.title)}">${projectIcon(p)}<span class="side-tooltip">${esc(p.title)}</span></button>`).join('')}
      ${isAdmin()?`<button class="side-add" data-action="create-project" aria-label="Crear proyecto" title="Crear proyecto">${I('plus',22)}</button>`:''}
      ${db.projects.length===0&&!isAdmin()?`<span class="sidebar-placeholder">${I('grid',19)}</span>`:''}`;
 return `<nav class="project-sidebar" aria-label="${personal?'Instancias del usuario':'Proyectos VIS Universe'}"><button class="side-logo ${page==='home'?'selected':''}" data-action="go-home" title="Inicio de VIS Nexo" aria-label="Inicio">${logo()}</button>
 <div class="side-divider"></div><div class="side-section-label">${personal?'MIS JUEGOS':'PROYECTOS'}</div>
 <div class="side-projects">${items}</div>
 <div class="side-footer"><button class="side-round" data-action="go-minecraft" title="${isGuest()?'Instancias instaladas':'Minecraft y mods'}" aria-label="Minecraft y mods">${I('game',21)}</button><button class="side-round" data-action="go-instances" title="Instancias">${I('layers',21)}</button><button class="side-avatar" data-action="go-profile" title="Mi perfil">${userAvatar(43)}<i class="presence-pin"></i></button></div></nav>`;
}
function socialPanel(){
 const related = socialTab==='projects' && page==='project';
 const friends = db.friends; // Global friendships persist; project context is a view, not a second friend list.
 const cloudProjects=social.state()?.projects||[];
 const projectId=page==='project'?currentProject()?.id||'':'';
 const projectFriends=socialTab==='projects'?
   projectId?friends.filter(f=>(f.shared_projects||[]).includes(projectId)):[]
   :friends;
 const socialOwner=social.state()?.developer===true;
 const accountAdmin=social.state()?.role==='super_admin';
 return `<aside class="social-pane ${socialVisible?'':'is-hidden'}" aria-label="Amigos">
 <div class="social-top"><div class="social-brand"><span class="social-title">${I('users',20)} VIS PORTALS</span><small>Amigos y mensajes</small></div><button class="icon-btn" data-action="toggle-social" title="Ocultar panel">${I('x',18)}</button></div>
 <div class="social-tabs"><button class="${socialTab==='global'?'active':''}" data-action="social-global">Global</button><button class="${socialTab==='projects'?'active':''}" data-action="social-projects">Proyectos</button></div>
 <div class="social-person"><div class="person-left">${userAvatar(37)}<div><b>${esc(socialDisplayName(db.user?.username||''))}</b><span>${esc(names[db.user?.presence||'online']||'Conectado')} · Cuenta VIS</span></div></div><span class="dot ${esc(db.user?.presence||'online')}"></span><button type="button" class="icon-btn" data-action="social-upload-avatar" title="Subir foto de perfil a VIS Social" aria-label="Subir foto de perfil">${I('image',14)}</button><button type="button" class="icon-btn status-edit" data-action="social-edit-status" title="Cambiar estado" aria-label="Cambiar estado">${I('edit',14)}</button>${stateEditorOpen?`<div class="status-inline"><label for="social-presence">Mi estado</label><select id="social-presence" aria-label="Cambiar estado">${['online','away','busy','invisible'].map(v=>`<option value="${v}" ${db.user?.presence===v?'selected':''}>${names[v]}</option>`).join('')}</select></div>`:''} </div>

 <div class="social-group-head"><span class="social-contacts-label">${I('users',15)} ${socialTab==='global'?'MIS CONTACTOS':'CONTACTOS POR PROYECTO'} ${db.incoming_requests?.length?`<span class="contact-notification" title="Solicitudes de amistad pendientes">${db.incoming_requests.length}</span>`:''} </span><span>${projectFriends.length}</span></div>
 <div class="social-search">${I('search',15)}<input id="friend-filter" value="${attr(friendFilter)}" placeholder="Filtrar amigos" aria-label="Filtrar amigos" autocomplete="off"></div>
 <div class="friend-scroll" aria-live="polite">${related?`<p class="small-note">Amigos globales · el filtro por servidor se habilitará con la presencia online.</p>`:''}
 ${socialTab==='projects'&&!projectId?`<p class="social-empty">Abrí un proyecto para ver contactos que también lo siguen.</p>`:''}
 ${projectFriends.filter(f=>(f.username+' '+(f.public_handle||'')+' '+(f.alias||'')+' '+(f.display_name||'')).toLowerCase().includes(friendFilter.toLowerCase())).map(f=>`<button class="friend-item ${chatWith===f.username?'selected':''}" data-action="open-chat" data-id="${attr(f.username)}" title="Clic derecho: cambiar apodo">${socialAvatarHtml(f.username,34)}<span class="friend-meta"><b>${esc(f.alias||f.display_name||f.username)}</b><small>${esc('@'+(f.public_handle||f.username)+' · ')}${names[f.presence]||'Desconectado'}</small></span>${socialSkins.get(f.username)?.head?`<img class="friend-skin-thumb" src="${attr(socialSkins.get(f.username).head)}" alt="Skin VIS de ${attr(f.username)}" title="Skin compartida en VIS"/>`:''}<span class="dot ${f.presence==='online'?'online':'offline'}"></span></button>`).join('')}
 ${projectFriends.length===0&&socialTab==='global'?`<p class="social-empty">Todavía no tenés amigos. Agregá a alguien por su usuario.</p>`:''}
 ${socialTab==='projects'?`<div class="social-group-head"><span>PROYECTOS PUBLICADOS</span><span>${cloudProjects.filter(p=>p.visibility==='published').length}</span></div>
 ${cloudProjects.filter(p=>p.visibility==='published').slice(0,40).map(p=>`<div class="request-row"><span title="${attr(p.summary||'')}"><b>${esc(p.title)}</b><small> · ${esc(p.id)}</small></span><button type="button" class="mini-add" data-action="social-subscribe-project" data-id="${attr(p.id)}" data-subscribed="${!!p.subscribed}">${p.subscribed?'Dejar de seguir':'Seguir'}</button></div>`).join('')||'<p class="small-note">Aún no hay proyectos publicados en VIS Social.</p>'}
 ${socialOwner?`<div class="social-group-head"><span>ADMINISTRACIÓN</span></div><button class="mini-add" type="button" data-action="social-register-project">Registrar proyecto</button><button class="mini-add" type="button" data-action="social-assign-staff">Permisos de proyecto</button>${accountAdmin?`<button class="mini-add" type="button" data-action="social-manage-user">Gestionar usuario</button><button class="mini-add" type="button" data-action="social-global-admin">Administradores globales</button>`:''}`:''}
 ${social.connected()&&social.state()?.cloud_login_enabled?`<button class="mini-add" type="button" data-action="social-developer-key" title="Consultar clave pública de la cuenta para una habilitación manual en GitHub">Identidad de desarrollador${socialOwner?' · habilitada':''}</button><button class="mini-add" type="button" data-action="social-superadmin-key" title="Preparar solicitud protegida de superadministrador, sin revelar contraseña">Identidad para superadmin${accountAdmin?' · habilitada':''}</button>`:''}
 <button class="mini-add" type="button" data-action="social-public-identity" title="Obtiene la clave pública, nunca la contraseña ni el PIN">Identidad de este dispositivo</button>${social.connected()&&!social.state()?.cloud_login_enabled?`<button class="mini-add" type="button" data-action="social-enable-cloud">Vincular contraseña online</button>`:''}
 `:''}
 ${db.incoming_requests.length?`<div class="social-group-head"><span>SOLICITUDES</span><span>${db.incoming_requests.length}</span></div>${db.incoming_requests.map(u=>`<div class="request-row"><span>${esc(u)}</span><button class="mini-add" data-action="accept-friend" data-id="${attr(u)}">Aceptar</button></div>`).join('')}`:''}
 </div>
 <div class="social-bottom"><button type="button" class="mini-add" data-action="skin-lookup" title="Ver la skin pública de cualquier cuenta VIS">${I('game',14)} Buscar skin pública VIS</button><button type="button" class="mini-add" data-action="social-copy-handle" title="Compartir este usuario para que te agreguen a VIS Portals">${I('copy',14)} Copiar mi usuario VIS</button><form id="friend-form" class="friend-add-row"><input name="username" placeholder="@usuario VIS o ID" aria-label="@usuario VIS o ID pública de tu amigo" minlength="3" maxlength="25" required/><button title="Enviar solicitud">${I('plus',19)}</button></form>
 <small class="muted">Para encontrar amigos usá su <b>@usuario VIS</b> o ID; su nombre de Minecraft puede cambiar.</small>
 <span class="local-hint" title="${attr(socialError)}">${I('shield',13)} ${socialMode==='connected'?'VIS Social · Mensajes cifrados':socialMode==='connecting'?'Conectando VIS Social…':socialMode==='degraded'?'VIS Social · Reconectando…':socialMode==='security_warning'?'ALERTA: verificar clave del contacto':'Modo local · VIS Social desconectado'}</span>${native&&socialMode!=='connected'?`<button type="button" class="icon-btn" data-action="social-retry" title="Reintentar VIS Social" aria-label="Reintentar conexión">${I('cloud',14)}</button>`:''}</div>
 ${chatWith?chatDock():''}
 </aside>`;
}
function chatDock(){
 const me=db.user?.username;
 const latest=new Map();
 for(const msg of db.messages||[]){const peer=msg.from===me?msg.to:msg.from;if(peer&&peer!==me)latest.set(peer,msg);}
 if(chatWith&&!latest.has(chatWith)) latest.set(chatWith,null);
 const contacts=[...latest.entries()].sort((a,b)=>Date.parse(b[1]?.created||0)-Date.parse(a[1]?.created||0));
 return `<div class="chat-floating" role="dialog" aria-label="Conversaciones de VIS Portals"><nav class="chat-recent" aria-label="Chats recientes"><div class="chat-recent-heading">${I('users',16)} RECIENTES</div>${contacts.slice(0,35).map(([user,m])=>`<button type="button" data-action="open-chat" data-id="${attr(user)}" class="chat-recent-item ${user===chatWith?'active':''}"><b>${esc(db.friends.find(f=>f.username===user)?.alias||user)}</b><small>${esc(m?.body||'Iniciar conversación')}</small></button>`).join('')}</nav>${chatDrawer()}</div>`;
}
function chatDrawer(){
 const msgs=db.messages.filter(m=>(m.from===db.user?.username&&m.to===chatWith)||(m.to===db.user?.username&&m.from===chatWith));
 // Bounded DOM rendering: O(min(messages, window)), older messages stay in data.
 const visible=msgs.slice(-chatWindowSize);
 return `<section class="chat-drawer"><div class="chat-head"><b>${I('message',18)} ${esc(chatWith)}</b><button data-action="close-chat" class="icon-btn">${I('x',18)}</button></div><div class="chat-messages">${msgs.length>visible.length?`<button type="button" class="chat-load-older" data-action="chat-load-older">Ver mensajes anteriores (${msgs.length-visible.length})</button>`:''}${visible.map(m=>`<div class="bubble ${m.from===db.user?.username?'mine':''}">${esc(m.body)}<small class="message-date">${esc(m.created||'')}</small></div>`).join('')||'<p class="small-note">Sin mensajes todavía</p>'}</div><form id="message-form" class="chat-send"><input name="body" maxlength="1300" placeholder="Escribí un mensaje..." required/><button title="Enviar">${I('send',19)}</button></form></section>`;
}
function emptyHome(){return `<div class="empty-projects"><div class="empty-orbit">${I('layers',38)}</div><h3>Todavía no hay proyectos</h3><p>${isAdmin()?'Creá el primer proyecto y personalizá su identidad visual desde el administrador.':'Los proyectos publicados aparecerán acá automáticamente. Si no tenés un catálogo configurado, VIS Studios debe vincular primero la URL pública de Universe.'}</p>${isAdmin()?`<button class="outline-btn" data-action="create-project">${I('plus',17)} Crear proyecto</button>`:''}</div>`;}
function modeSelector(){
 return `<nav class="library-mode-switch" aria-label="Seleccionar modo del launcher">
 <button type="button" data-action="mode-vs" class="library-mode-choice ${libraryMode==='vs'?'active':''}" aria-pressed="${libraryMode==='vs'}">${I('shield',20)}<span><b>VIS Universe</b><small>Explorar proyectos y novedades</small></span></button>
 <button type="button" data-action="mode-user" class="library-mode-choice ${libraryMode==='user'?'active':''}" aria-pressed="${libraryMode==='user'}">${I('layers',20)}<span><b>Usuario</b><small>Tu Minecraft, tus instancias</small></span></button>
 </nav>`;
}
function personalHomePage(){
 const items=personalInstances();
 return `<div class="content-inner home-page user-library-page">${modeSelector()}
 <div class="user-library-hero"><div><span class="page-eyebrow">BIBLIOTECA PERSONAL</span><h1>Tu Minecraft, a tu manera.</h1><p>Creá varias versiones Vanilla, Fabric o Horizon Rust, instalá mods compatibles y mantené cada mundo separado de los proyectos oficiales.</p></div>
 ${!isGuest()?`<button class="primary-btn" data-action="new-personal-instance">${I('plus',18)} Crear instancia</button>`:''}</div>
 <div class="section-heading"><div><span class="page-eyebrow">MIS PERFILES</span><h2>Instancias personales <small>${items.length}</small></h2></div><div class="vis-instance-toolbar">${items.length?`<button class="outline-btn" data-action="bulk-instance-mode">${I('trash',16)} ${bulkInstanceMode?'Cancelar selección':'Seleccionar'}</button>`:''}<button class="outline-btn" data-action="go-instances">${I('layers',16)} Ver todas</button></div></div>
 ${bulkInstanceMode?bulkInstanceToolbar(items):''}
 ${items.length?`<div class="instance-list">${items.map(instanceLine).join('')}</div>`:quietEmpty('Todavía no creaste instancias personales',isGuest()?'Las cuentas offline solo pueden iniciar instancias ya instaladas.':'Elegí la versión de Minecraft, Vanilla o Fabric, configurá la RAM y empezá sin crear un proyecto oficial.')}
 ${isGuest()?`<button class="outline-btn" data-action="go-instances">${I('play',16)} Ver juegos offline disponibles</button>`:''}
 </div>`;
}
function homePage(){
 if(libraryMode==='user')return personalHomePage();
 const featured=db.projects[0];
 const withBanner=featured?.banner_path&&preview(featured.banner_path);
 return `<div class="content-inner home-page portal-home">${modeSelector()}<div class="section-kicker">${I('grid',15)} CENTRO DE JUEGOS <span class="line"></span> ${db.projects.length} PROYECTOS</div>
 <section class="hero feature-hero portal-feature" ${withBanner?bgPhoto(featured.banner_path):''} data-motion="hero"><div class="hero-vignette"></div>
 <div class="hero-inner"><span class="hero-tag">${I('game',15)} ${featured?'DESTACADO':'VIS NEXO'}</span>
 ${featured?`<div class="featured-wordmark">${featured.logo_path&&preview(featured.logo_path)?`<img src="${preview(featured.logo_path)}" alt=""/>`:`<h1>${esc(featured.title)}</h1>`}</div><p>${esc(featured.subtitle||featured.description||'')}</p><div class="hero-actions"><button class="primary-btn hero-cta" data-action="open-project" data-id="${attr(featured.id)}">${I('play',19)} Ver proyecto</button><span class="hero-status">${isExecutionEnabled(featured)?'Disponible':featured.installable?'Pausado':'Próximamente'}</span></div>`:
 `<h1>Tu espacio de juegos.</h1><p>Explorá proyectos, noticias y actualizaciones desde un solo lugar.</p>${isAdmin()?`<button class="primary-btn hero-cta" data-action="create-project">${I('plus',19)} Crear primer proyecto</button>`:`<span class="hero-muted">El catálogo está vacío por ahora</span>`}`}</div>
 <div class="hero-watermark" aria-hidden="true">${logo(true)}</div></section>
 <div class="section-heading portal-section-title"><div><span class="page-eyebrow">EXPLORAR</span><h2>Todos los proyectos <small>${db.projects.length}</small></h2></div><div class="section-tools"><label class="catalog-search">${I('search',16)} <input id="catalog-search" aria-label="Buscar proyectos" type="search" placeholder="Buscar proyectos..." value="${attr(query)}" /></label>${isAdmin()?`<button class="outline-btn" data-action="create-project">${I('plus',17)} Nuevo proyecto</button>`:''}</div></div>
 ${db.projects.length?`<div class="project-grid portal-grid">${db.projects.filter(p=>`${p.title} ${p.subtitle}`.toLowerCase().includes(query.toLowerCase())).map(p=>projectCard(p)).join('')||'<div class="quiet-empty">Sin coincidencias</div>'}</div>`:emptyHome()}
 <div class="portal-footer-note">${I('shield',14)} ${db.catalog_source?'VIS Universe · Catálogo online: '+esc(db.catalog_source):'VIS Universe · Falta configurar el catálogo remoto en Configuración → Publicación.'} Los borradores locales solo se muestran al administrador.</div></div>`;
}
function projectCard(p){const available=isExecutionEnabled(p);return `<button class="project-card portal-game-card" data-action="open-project" data-id="${attr(p.id)}" data-context="${attr(p.id)}"><div class="project-card-cover" ${p.banner_path?bgPhoto(p.banner_path):''}><span class="project-card-watermark">${projectIcon(p)}</span><span class="availability ${available?'available':''}">${available?'Disponible':p.installable?'Pausado':'Próximamente'}</span><span class="card-hover-cta">${I('arrow',17)} Abrir proyecto</span></div><div class="project-card-info"><span class="project-card-logo">${projectIcon(p)}</span><div><strong>${esc(p.title)}</strong><small>${esc(p.subtitle||p.mc_version||'Proyecto VIS Universe')}</small></div>${I('chevron',19)}</div></button>`;}

const visProjectRoles=[
 ['creator','Creadores'],['helper','Ayudantes'],['content_creator','Creadores de contenido'],
 ['participant','Participantes'],['guest','Invitados'],['collaborator','Colaboradores'],['mention','Menciones']
];
async function loadProjectCommunity(id=selectedId){
 if(!id||!social.connected()||projectCommunityLoading)return;
 const generation=accountGeneration;
 projectCommunityLoading=true;projectCommunityError='';
 try{
   const data=await social.projectCommunity(id);
   if(generation!==accountGeneration||selectedId!==id)return;
   projectCommunityId=id;projectCommunity=data;
 }catch(error){
   if(generation!==accountGeneration||selectedId!==id)return;
   projectCommunityId=id;projectCommunity=null;projectCommunityError=String(error);
 }finally{
   projectCommunityLoading=false;
   if(generation===accountGeneration&&selectedId===id&&page==='project')render();
 }
}
function projectMediaThumbnail(item){
 if(item.provider!=='youtube')return '';
 let video='';
 try{
   const url=new URL(item.url);
   if(url.hostname==='www.youtube.com'&&url.pathname==='/watch')video=url.searchParams.get('v')||'';
 }catch{}
 return /^[a-zA-Z0-9_-]{11}$/.test(video)?
   '<img loading="lazy" alt="" src="https://i.ytimg.com/vi/'+attr(video)+'/mqdefault.jpg"/>':'';
}
function projectCommunitySection(p){
 const c=projectCommunityId===p.id?projectCommunity:null;
 if(!social.connected())return '<section class="vis-project-community"><h2>'+I('users',19)+' Participantes y medios</h2><p class="muted">Conectá tu cuenta VIS Cloud para ver los roles, solicitudes y videos de este proyecto.</p></section>';
 if(!c)return '<section class="vis-project-community"><h2>'+I('users',19)+' Participantes y medios</h2><p class="muted">'+esc(projectCommunityError||'Cargando miembros del proyecto…')+'</p><button type="button" class="outline-btn" data-action="project-community-refresh">Consultar participantes</button></section>';
 const media=(c.media||[]).map(item=>'<article class="vis-community-media-card">'+
  '<div class="vis-community-media-thumb">'+(projectMediaThumbnail(item)||I(item.kind==='stream'?'play':'image',28))+'</div>'+
  '<b>'+esc(item.title)+'</b><small>'+esc(item.kind==='stream'?'Directo':'Video')+' · '+esc(item.author)+'</small>'+
  '<div class="vis-data-actions"><button class="outline-btn" type="button" data-action="project-community-open-media" data-id="'+attr(item.id)+'">Abrir '+esc(item.provider)+'</button>'+
  (c.can_manage||item.author===db.user?.username?'<button class="outline-btn" type="button" data-action="project-community-delete-media" data-id="'+attr(item.id)+'">Quitar</button>':'')+'</div></article>').join('');
 const roles=visProjectRoles.map(([key,label])=>{
   const members=(c.members||[]).filter(x=>x.member_role===key);
   return '<div class="vis-community-role"><h3>'+esc(label)+' <small>'+members.length+'</small></h3>'+
     (members.length?members.map(m=>'<div class="vis-community-member"><span><b>'+esc(m.display_name||m.username)+'</b> <small>@'+esc(m.public_handle||m.username)+'</small></span>'+
        (m.can_play?'<span class="vis-access-yes">Puede jugar</span>':'')+
        (m.presence==='online'&&m.current_game?'<small title="Estado declarado por el jugador, no verificado por el servidor">'+I('game',12)+' '+esc(m.current_game)+'</small>':'')+'</div>').join(''):'<p class="muted">Sin integrantes todavía</p>')+'</div>';
 }).join('');
 const join=c.role?'':'<div class="vis-community-join">'+
   '<p>'+esc(c.admission==='open'?'Podés unirte libremente.':c.admission==='request'?'Podés solicitar una invitación para participar.':'Se requiere invitación de los responsables.')+'</p>'+
   (c.admission!=='invite_only'?'<button class="outline-btn" data-action="project-community-request" '+(c.request_status==='pending'?'disabled':'')+'>'+
    (c.request_status==='pending'?'Solicitud pendiente':c.admission==='open'?'Unirme al proyecto':'Solicitar unirme')+'</button>':'')+'</div>';
 const controls=c.can_manage?'<div class="vis-community-manage">'+
   '<button class="outline-btn" data-action="project-community-member">Asignar rol / acceso</button>'+
   '<button class="outline-btn" data-action="project-community-remove-member">Quitar miembro</button>'+
   '<button class="outline-btn" data-action="project-community-policy">Invitaciones y acceso</button></div>'+
   '<div class="vis-community-requests">'+(c.pending||[]).map(x=>'<div class="vis-community-member"><span>'+esc(x.username)+
   (x.note?'<small>'+esc(x.note)+'</small>':'')+'</span>'+
   '<button class="outline-btn" data-action="project-community-review" data-mode="approve" data-user="'+attr(x.username)+'">Aceptar</button>'+
   '<button class="outline-btn" data-action="project-community-review" data-mode="reject" data-user="'+attr(x.username)+'">Rechazar</button></div>').join('')+'</div>':'';
 const postable=c.can_manage||c.role==='content_creator';
 return '<section class="vis-project-community"><div class="vis-community-heading"><div><span class="page-eyebrow">VIS UNIVERSE / COMUNIDAD</span><h2>Participantes de '+esc(p.title)+'</h2></div>'+
   '<button class="outline-btn" data-action="project-community-refresh">'+I('refresh',16)+' Actualizar</button></div>'+
   '<p class="muted">Acceso: '+esc(c.play_access==='members'?'Solo usuarios autorizados':'Público')+' · Solicitudes: '+
   esc(c.admission==='open'?'Abiertas':c.admission==='request'?'Con aprobación':'Solo por invitación')+'</p>'+
   (c.play_access==='members'&&!c.can_play?'<p class="vis-community-permission">Todavía no tenés autorización del proyecto para jugar. El servidor también debe verificar este permiso.</p>':'')+
   join+controls+'<div class="vis-community-roles">'+roles+'</div>'+
   '<div class="vis-community-heading"><h2>Streams y videos</h2>'+
   (postable?'<button class="outline-btn" data-action="project-community-add-media">'+I('plus',16)+' Vincular contenido</button>':'')+'</div>'+
   (media?'<div class="vis-community-media-grid">'+media+'</div>':'<p class="muted">Todavía no hay directos o videos vinculados por los participantes.</p>')+'</section>';
}

function projectPage(){
 const p=currentProject();if(!p)return `<div class="content-inner">${emptyHome()}</div>`;
 const tabs=[['news','Noticias'],['patches','Notas de parche'],['updates','Actualizaciones'],['calendar','Eventos'],['community','Comunidad']].filter(([key])=>visibleSection(p,key));
 const feed=tabs.some(([key])=>key===activeFeed)?activeFeed:tabs[0]?.[0]||'news';
 const filtered=(p.posts||[]).map((post,index)=>({...post,_index:index})).filter(post=>feed==='news'?post.kind==='news':feed==='patches'?post.kind==='patch':feed==='updates'?post.kind==='update':feed==='community'?post.kind==='community':false);
 const posts=(feed==='calendar'?(p.calendar||[]).map((ev,index)=>({...ev,_index:index})):filtered);
 const isCalendar=feed==='calendar';
 const enabled=db.project_execution?.[p.id]!==false;
 const available=p.installable&&enabled;
 const installedProject=db.instances.find(i=>compatibleProjectInstance(i,p));
 const playBlocked=projectCommunityId===p.id&&projectCommunity?.play_access==='members'&&!projectCommunity.can_play;
 const adminActions=isAdmin()?`<div class="project-admin-actions" aria-label="Publicación rápida"><span class="admin-actions-title">${I('shield',15)} ADMINISTRACIÓN</span><button class="admin-action" data-action="quick-publish" data-kind="news" title="Publicar una noticia">${I('newspaper',16)} Noticia</button><button class="admin-action" data-action="quick-publish" data-kind="patch" title="Publicar notas de parche">${I('settings',16)} Nota de parche</button><button class="admin-action" data-action="quick-publish" data-kind="update" title="Publicar una actualización">${I('upload',16)} Actualización</button><button class="admin-action" data-action="quick-publish" data-kind="event" title="Agregar un evento al calendario">${I('calendar',16)} Evento</button><button class="admin-action light" data-action="edit-project" data-id="${attr(p.id)}" title="Editar identidad visual, recursos y configuraciones">${I('edit',16)} Editar proyecto</button></div>`:'';
 return `<div class="content-inner project-page riot-project-page project-page-v23"><section class="project-hero portal-project-hero cinematic-project-hero" ${p.banner_path?projectHeroPhoto(p.banner_path):''} data-motion="hero"><div class="project-hero-shade"></div><div class="project-hero-content"><span class="hero-tag">${I('game',16)} ${esc(p.mc_version?'MINECRAFT '+p.mc_version:'PROYECTO VIS UNIVERSE')}</span><div class="project-wordmark">${p.logo_path&&preview(p.logo_path)?`<img class="project-logo-image" src="${preview(p.logo_path)}" alt="Logo de ${attr(p.title)}"/>`:`<h1>${esc(p.title)}</h1>`}</div><p>${esc(p.description||p.subtitle||'')}</p>
 <div class="project-actions"><button class="primary-btn" ${!available||playBlocked?'disabled title="'+(playBlocked?'Necesitás autorización para jugar':'Disponible próximamente')+'"':''} data-action="project-play" data-id="${attr(p.id)}">${I(available?'play':'timer',19)} ${available?(installedProject?'Jugar':'Instalar y jugar'):'Próximamente'}</button><button class="glass-btn" data-action="go-instances" title="Gestionar instancias locales">${I('settings',18)} Instancias</button>${installedProject && !installedProject.source_owner && p.engine==='java'&&p.loader==='fabric'? `<button class="glass-btn" data-action="sync-project-mods" data-project="${attr(p.id)}" data-id="${attr(installedProject.name)}" ${minecraftBusy?'disabled':''} title="Aplicar mods añadidos y quitar los retirados, sin borrar tus mundos">${I('package',18)} Actualizar mods</button>`:''}</div></div><span class="portal-hero-caption">${available?'DISPONIBLE':enabled?'EN PREPARACIÓN':'EJECUCIÓN DESHABILITADA'}</span></section>
 ${isAdmin()?`<div class="project-execution-control"><span>${I('shield',17)} Ejecución de Minecraft: <b>${p.installable?(enabled?'Habilitada':'Bloqueada'):'Proyecto no publicado para jugar'}</b></span><button class="outline-btn" data-action="toggle-project-execution" data-id="${attr(p.id)}" title="Habilitar o deshabilitar las instalaciones y el botón Jugar">${enabled?'Bloquear ejecución':'Permitir ejecución'}</button></div>`:''}
 ${adminActions}<div class="project-lower portal-project-lower ${visibleSection(p,'notes')?'':'full-content'}"><section class="project-main"><div class="project-content-head"><div><span class="page-eyebrow">CENTRO DE NOVEDADES</span><h2>Lo último de ${esc(p.title)}</h2></div></div><div class="feed-tabs">${tabs.map(([v,label])=>`<button class="${feed===v?'active':''}" data-action="feed-tab" data-id="${v}">${label}</button>`).join('')}</div>
 ${!tabs.length?quietEmpty('Secciones ocultas','El administrador todavía no habilitó las secciones de novedades.'):posts.length?`<div class="news-list portal-news">${posts.map(post=>`<article class="news-item"><div class="news-icon">${I(isCalendar?'calendar':post.kind==='patch'?'settings':post.kind==='update'?'upload':'bell',21)}</div><div class="news-content"><small>${esc(isCalendar?post.date:(post.date||'Publicación'))}</small><h3>${esc(post.title)}</h3><p>${esc(isCalendar?post.description:post.body)}</p></div>${isAdmin()?`<div class="news-admin"><button class="icon-btn" data-action="edit-publication" data-kind="${isCalendar?'event':post.kind}" data-index="${post._index}" aria-label="Editar ${isCalendar?'evento':'publicación'}" title="Editar">${I('edit',16)}</button><button class="icon-btn danger" data-action="remove-publication" data-kind="${isCalendar?'event':post.kind}" data-index="${post._index}" aria-label="Eliminar ${isCalendar?'evento':'publicación'}" title="Eliminar">${I('trash',16)}</button></div>`:''}</article>`).join('')}</div>`:quietEmpty(isCalendar?'Todavía no hay eventos':'Todavía no hay publicaciones',isCalendar?'El calendario aparecerá cuando se publiquen eventos.':'Las novedades, parches y notas aparecerán acá cuando estén disponibles.')}</section>
 ${visibleSection(p,'notes')?`<aside class="project-details"><h3>${I('info',17)} Acerca de este proyecto</h3><div class="detail-line"><span>Estado</span><strong>${available?'Disponible':'Próximamente'}</strong></div><div class="detail-line"><span>Minecraft</span><strong>${esc(p.mc_version||'Sin configurar')} · ${esc(p.engine==='horizon'?'Rust / Horizon':(p.loader||'Vanilla'))}</strong></div><div class="detail-line"><span>Perfiles</span><strong>${p.versions?.length||0}</strong></div><div class="detail-line"><span>Mods del proyecto</span><strong>${(p.modrinth_mods||[]).length}</strong></div><div class="project-micro-info">Minecraft Java: instalación y ejecución local disponibles desde Instancias. Para servidores premium se requiere Microsoft.</div>${p.community_url?`<button class="outline-btn full" data-action="open-community" data-id="${attr(p.id)}">${I('external',17)} Comunidad</button>`:''}</aside>`:''}</div>
 ${projectCommunitySection(p)}</div>`;
}
function quietEmpty(title,desc){return `<div class="quiet-empty">${I('layers',25)}<h3>${esc(title)}</h3><p>${esc(desc)}</p></div>`;}
async function loadPremiumCosmetics(){
 if(!native||!microsoftGamertag||premiumCosmeticsBusy)return;
 premiumCosmeticsBusy=true;if(page==='profile')render();
 try{premiumCosmetics=await command('microsoft_cosmetics');}
 catch(error){message('Minecraft Premium: '+String(error),true);}
 finally{premiumCosmeticsBusy=false;if(page==='profile')render();}
}
async function changePremiumCosmetic(action,params={}){
 if(!native||!microsoftGamertag||premiumCosmeticsBusy)return;
 premiumCosmeticsBusy=true;render();
 try{
   const next=await command(action,params);
   premiumCosmetics={...next,history:next.history||premiumCosmetics?.history||[]};
   message('Cosmético oficial actualizado en Minecraft.');
   // The refreshed official inventory also records the new texture in the
   // private, token-free history for this same Minecraft UUID.
   void Promise.resolve().then(()=>loadPremiumCosmetics());
 }catch(error){message('Minecraft Premium: '+String(error),true);}
 finally{premiumCosmeticsBusy=false;render();}
}
function premiumCosmeticsPanel(){
 if(!microsoftGamertag)return '';
 const skins=premiumCosmetics?.skins||[],capes=premiumCosmetics?.capes||[];
 const skinRows=skins.map(skin=>'<div class="premium-cosmetic-entry">'+
   (skin.url?'<img src="'+attr(skin.url)+'" alt="Textura de skin" loading="lazy"/>':'')+
   '<span>'+esc(skin.variant==='SLIM'?'Modelo delgado':'Modelo clásico')+
   '<small>'+(skin.state==='ACTIVE'?' · Equipada':' · Anterior')+'</small></span>'+
   (skin.state==='ACTIVE'?'':'<button class="outline-btn" data-action="premium-use-skin" data-id="'+attr(skin.id)+'">Usar</button>')+'</div>').join('');
 const history=premiumCosmetics?.history||[];
 const savedRows=history.map((item,index)=>'<div class="premium-cosmetic-entry">'+
   '<img src="'+attr(item.url)+'" alt="Textura oficial guardada" loading="lazy"/>'+
   '<span>Skin guardada '+(index+1)+'<small> · '+esc(item.variant==='SLIM'?'Delgado':'Clásico')+'</small></span>'+
   '<button class="outline-btn" data-action="premium-use-saved-skin" data-id="'+attr(item.url)+'" '+(premiumCosmeticsBusy?'disabled':'')+'>Equipar</button></div>').join('');
 const capeRows=capes.map(cape=>'<div class="premium-cosmetic-entry">'+
   (cape.url?'<img src="'+attr(cape.url)+'" alt="Textura de capa" loading="lazy"/>':'')+
   '<span>'+esc(cape.alias||'Capa oficial')+
   '<small>'+(cape.state==='ACTIVE'?' · Equipada':' · Disponible')+'</small></span>'+
   (cape.state==='ACTIVE'?'':'<button class="outline-btn" data-action="premium-use-cape" data-id="'+attr(cape.id)+'">Equipar</button>')+'</div>').join('');
 return '<section class="surface-card premium-cosmetics">'+
   '<div class="card-heading">'+I('game',20)+' Perfil oficial de Minecraft Java '+
     '<button class="outline-btn" data-action="premium-refresh" '+(premiumCosmeticsBusy?'disabled':'')+'>'+I('cloud',15)+' Actualizar</button></div>'+
   '<p class="muted"><b>'+esc(microsoftGamertag)+'</b> · Skins y capas oficiales de tu cuenta Microsoft. No son el avatar de VIS Social.</p>'+
   (premiumCosmeticsBusy?'<p class="muted">Consultando Minecraft Services…</p>':'')+
   (premiumCosmetics?'<div class="premium-cosmetics-grid">'+
     '<div class="premium-cosmetics-group"><h3>Skins oficiales actuales ('+skins.length+')</h3>'+
       (skinRows||'<p class="muted">No hay skins para mostrar.</p>')+
       '<details class="profile-advanced"><summary>Historial guardado por VIS Nexo ('+history.length+')</summary>'+
       '<small class="muted">VIS recuerda las texturas que consultás o equipás desde ahora. No puede recuperar automáticamente todas las skins usadas antes de VIS.</small>'+
       (savedRows||'<p class="muted">El historial se completará cuando consultes o uses nuevas skins.</p>')+'</details>'+
       '<div class="profile-actions"><label>Modelo <select id="premium-skin-model"><option value="classic" '+(premiumSkinModel==='classic'?'selected':'')+'>Clásico</option><option value="slim" '+(premiumSkinModel==='slim'?'selected':'')+'>Delgado</option></select></label>'+
         '<button class="primary-btn" data-action="premium-upload-skin" '+(premiumCosmeticsBusy?'disabled':'')+'>'+I('upload',16)+' Guardar en VIS y Minecraft oficial</button></div></div>'+
     '<div class="premium-cosmetics-group"><h3>Capas oficiales ('+capes.length+')</h3>'+
       (capeRows||'<p class="muted">No tenés capas oficiales disponibles.</p>')+
       '<button class="outline-btn" data-action="premium-hide-cape" '+(!capes.some(c=>c.state==='ACTIVE')?'disabled':'')+'>Ocultar capa</button>'+
       '<small class="muted">Solo se pueden equipar capas que la cuenta ya posee.</small></div></div>':
     '<button class="outline-btn" data-action="premium-refresh">Consultar mis skins y capas</button>')+
   '</section>';
}

function profilePage(){
 if(isGuest())return '<div class="content-inner"><div class="page-heading"><h1>Modo offline</h1></div>'+
   '<section class="surface-card"><p>Las cuentas offline pueden usar juegos instalados, sin identidad social.</p>'+
   '<button class="primary-btn" data-action="go-instances">Ver juegos instalados</button></section></div>';
 const username=db.user?.username||'',skinPath=db.user?.skin||'',localSkin=skinPath?preview(skinPath):'';
 const publicSkin=socialSkins.get(username),skins=(db.instances||[]).filter(i=>!i.source_owner);
 const hidden=db.hidden_shared_instances||[],connected=social.connected();
 const socialId=social.state()?.public_id||'';
 const socialLabel=connected?'VIS Social conectado':socialMode==='connecting'?'Conectando VIS Social':'VIS Social desconectado';
 const premium=microsoftGamertag?'Minecraft Java · '+microsoftGamertag:'Minecraft Java · Cuenta no vinculada en esta sesión';
 const banner=db.user?.profile_banner&&preview(db.user.profile_banner);
 const bannerStyle=banner?' style="background-image:linear-gradient(90deg,rgba(18,12,35,.89),rgba(20,12,38,.35)),url(\''+attr(banner)+'\');background-size:cover;background-position:center"':'';
 const hiddenRows=hidden.map(i=>'<div class="request-row"><span>'+esc(i.name)+' · '+esc(i.source_owner)+'</span>'+
   '<button type="button" class="outline-btn" data-action="show-shared-instance" data-id="'+attr(i.name)+
   '" data-project="'+attr(i.project_id)+'" data-source="'+attr(i.source_owner)+'">Restaurar</button></div>').join('');
 const gameRows=skins.slice(0,3).map(i=>'<div class="vis-profile-game"><span>'+I('game',17)+
   ' '+esc(i.name)+'</span><small>'+esc(i.engine==='horizon'?'Horizon Rust':'Java / '+(i.loader||'Vanilla'))+
   ' · '+esc(i.version)+'</small></div>').join('');
 return '<div class="content-inner profile-page profile-v21">'+
  '<header class="profile-page-head"><div><span class="page-eyebrow">CUENTA Y APARIENCIA</span>'+
  '<h1>Mi perfil</h1><p>Todo lo importante de tu identidad y tus juegos, en un solo lugar.</p></div>'+
  '<button class="primary-btn" data-action="edit-profile">'+I('edit',17)+' Editar perfil</button></header>'+
  '<section class="profile-banner portal-profile-banner"'+bannerStyle+'>'+
    '<div class="profile-orb" aria-hidden="true"></div>'+
    '<div class="profile-portrait">'+userAvatar(104)+
       '<button type="button" class="avatar-overlay-edit" data-action="edit-avatar" aria-label="Cambiar avatar">'+I('edit',18)+'</button></div>'+
    '<div class="profile-titles"><span class="page-eyebrow">IDENTIDAD VIS</span>'+
      '<h2>'+esc(socialDisplayName(username))+'</h2>'+
      '<div class="vis-handle">@'+esc(publicVisHandle())+' · VIS Ceibo</div>'+
      '<div class="vis-profile-chips"><span class="role-chip">'+humanRole(db.user?.role)+'</span>'+
        '<span class="role-chip ghost">'+esc(socialLabel)+'</span>'+
        '</div>'+
    '</div><button class="outline-btn profile-share" data-action="social-copy-handle">'+I('copy',15)+' Copiar usuario VIS</button>'+
  '</section>'+
  '<div class="profile-overview"><div><strong>'+skins.length+'</strong><span>Instancias propias</span></div>'+
   '<div><strong>'+db.friends.length+'</strong><span>Amigos VIS</span></div>'+
   '<div><strong>'+(publicSkin?.skin?'Publicada':localSkin?'Local':'Sin skin')+'</strong><span>Skin VIS</span></div></div>'+
  '<div class="profile-v21-grid">'+
   '<section class="surface-card profile-identity-card">'+
    '<div class="card-heading">'+I('users',20)+' Comunidad e identidad</div>'+
    '<p class="muted">Compartí tu @usuario VIS. Podés cambiarlo sin perder amigos ni chats. Tu ID permanente es distinta del nombre oficial de Minecraft.</p>'+
    '<div class="profile-status-rows">'+
      '<div><span>VIS Social</span><strong>'+esc(socialLabel)+'</strong></div>'+
      '<div><span>@usuario VIS</span><strong>@'+esc(publicVisHandle())+'</strong></div>'+
      '<div><span>ID permanente</span><strong>'+esc(socialId||'Disponible al conectar VIS Social')+'</strong></div>'+
      '<div><span>Minecraft Premium</span><strong>'+esc(premium)+'</strong></div>'+
      '<div><span>Foto pública</span><strong>'+esc(socialAvatars.get(username)?.url?'Sincronizada':'Sin foto sincronizada')+'</strong></div>'+
    '</div>'+
    '<div class="profile-quick-actions">'+
      '<button class="outline-btn" data-action="social-copy-handle">'+I('copy',15)+' Copiar usuario</button>'+
      (connected?'<button class="outline-btn" data-action="social-upload-avatar">'+I('image',15)+' Publicar foto</button>':
      '<button class="outline-btn" data-action="social-retry">'+I('cloud',15)+' Conectar VIS Social</button>')+
    '</div>'+
   '</section>'+
   '<section class="surface-card profile-skin-card">'+
    '<div class="card-heading">'+I('game',20)+' Mi skin en VIS</div>'+
    '<p class="muted">La skin se guarda en VIS Nexo. Con Microsoft Premium también podés publicarla en el perfil oficial de Minecraft Java; elegí el modelo antes de importar.</p>'+
    '<div class="profile-skin-visual">'+
      (localSkin?'<img class="profile-skin-sheet" src="'+attr(localSkin)+'" alt="Textura PNG local de Minecraft"/>':
       '<div class="profile-skin-placeholder">'+I('game',32)+'<span>Sin skin local</span></div>')+
      '<div class="profile-skin-public">'+
       (publicSkin?.head?'<img class="profile-skin-head" src="'+attr(publicSkin.head)+'" alt="Cabeza de la skin publicada"/>':
        '<span class="profile-skin-nohead">'+I('user',29)+'</span>')+
       '<strong>'+(publicSkin?.skin?'Visible en VIS Social':'No publicada')+'</strong>'+
       '<small>'+(publicSkin?.skin?'Otros usuarios pueden verla buscando @'+esc(username):
         'Importá una skin o publicá la que ya tenés.')+'</small>'+
      '</div></div>'+
    (microsoftGamertag?'<div class="profile-quick-actions"><label><input type="checkbox" id="premium-auto-skin" '+(premiumSkinSync?'checked':'')+'/> Subir también a Minecraft oficial ('+esc(microsoftGamertag)+')</label>'+
       '<label>Modelo <select id="premium-local-model"><option value="classic" '+(premiumSkinModel==='classic'?'selected':'')+'>Clásico · Steve</option><option value="slim" '+(premiumSkinModel==='slim'?'selected':'')+'>Delgado · Alex</option></select></label></div>':'')+
    '<div class="profile-quick-actions">'+
      '<button class="outline-btn" data-action="import-skin">'+I('upload',15)+' Importar PNG</button>'+
      '<button class="primary-btn" data-action="publish-vis-skin" '+(!skinPath||!connected||skinSharingBusy?'disabled':'')+'>'+
        I('cloud',15)+' '+(skinSharingBusy?'Publicando…':'Compartir skin VIS')+'</button>'+
      (publicSkin?.skin?'<button class="subtle-btn" data-action="remove-vis-skin">'+I('trash',15)+' Dejar de compartir</button>':'')+
    '</div>'+
   '</section>'+
   '<section class="surface-card profile-library-card">'+
    '<div class="card-heading">'+I('layers',20)+' Mis juegos</div>'+
    '<p class="muted">Tus instalaciones están separadas por perfil y los mundos se conservan al ocultar una instancia compartida.</p>'+
    (gameRows||'<p class="muted">Todavía no creaste instancias propias.</p>')+
    '<button class="outline-btn" data-action="go-instances">'+I('layers',16)+' Abrir biblioteca</button>'+
    (hidden.length?'<details class="profile-advanced"><summary>Compartidas ocultas ('+hidden.length+')</summary>'+
      '<div class="hidden-instance-list">'+hiddenRows+'</div></details>':'')+
   '</section>'+
   '<section class="surface-card profile-security-card">'+
    '<div class="card-heading">'+I('shield',20)+' Cuenta y privacidad</div>'+
    '<p class="muted">La cuenta VIS controla amigos, mensajes y apariencia del launcher. Microsoft se utiliza exclusivamente para autenticar Minecraft Java y Horizon.</p>'+
    '<div class="profile-status-rows"><div><span>Acceso</span><strong>'+
       esc(microsoftGamertag?'Microsoft Premium':db.mode==='offline'?'Offline':'VIS')+'</strong></div>'+
       '<div><span>Skin pública</span><strong>'+esc(publicSkin?.skin?'Visible para usuarios VIS':'No publicada')+'</strong></div></div>'+
    '<details class="profile-advanced"><summary>Identificadores técnicos de mi cuenta</summary><p class="muted">Estos códigos sirven para soporte y amistad; no son una contraseña ni el nombre que se muestra.</p><p class="muted">Usuario VIS: @'+esc(username)+'</p>'+(socialId?'<p class="muted">ID VIS: '+esc(socialId)+'</p>':'')+'</details>'+
   '<div class="profile-quick-actions"><button class="outline-btn" data-action="edit-profile">'+I('edit',15)+' Personalizar</button>'+
       '<button class="subtle-btn" data-action="logout">'+I('logout',15)+' Cerrar sesión</button></div>'+
   '</section>'+
  '</div>'+
  premiumCosmeticsPanel()+
 '</div>';
}
function editProfileDialog(){
 const user=db.user||{},connected=social.connected(),skin=socialSkins.get(user.username)?.skin;
 return '<div class="modal-backdrop" data-action="modal-backdrop"><div class="dialog modal-medium profile-edit-modal" role="dialog" aria-modal="true" aria-label="Editar perfil">'+
 '<header class="modal-head"><div><span class="page-eyebrow">CUENTA VIS</span><h2>Editar perfil</h2>'+
 '<p class="muted">Personalizá lo que ven los demás sin mezclar tu cuenta Microsoft.</p></div>'+
 '<button class="icon-btn" data-action="close-modal" aria-label="Cerrar">'+I('x',19)+'</button></header>'+
 '<div class="modal-body profile-edit-body">'+
 '<section><h3>'+I('user',18)+' Identidad visual</h3>'+
  '<div class="profile-edit-preview">'+userAvatar(64)+'<span><strong>'+esc(socialDisplayName(user.username))+
   '</strong><small>@'+esc(publicVisHandle())+'</small></span></div>'+
  '<label class="vis-display-name-label">Nombre visible en VIS Portals <input id="social-display-name" type="text" minlength="2" maxlength="32" value="'+attr(social.state()?.display_name&&social.state()?.display_name!==user.username?social.state().display_name:socialDisplayName(user.username))+'" placeholder="Nombre visible" autocomplete="off" '+(connected?'':'disabled')+'/></label>'+
  '<div class="profile-quick-actions"><button class="primary-btn" data-action="social-save-display-name" '+(connected?'':'disabled')+'>Guardar nombre visible</button></div>'+
  '<label class="vis-display-name-label">@usuario público (3-24 caracteres)<input id="social-public-handle" type="text" minlength="3" maxlength="24" pattern="[a-zA-Z0-9_]{3,24}" value="'+attr(publicVisHandle())+'" autocomplete="off" '+(connected?'':'disabled')+'/></label>'+
  '<p class="muted">Podés cambiarlo cada 7 días. La identidad permanente, tus amigos y mensajes cifrados no cambian.</p>'+
  '<div class="profile-quick-actions"><button class="outline-btn" data-action="social-save-public-handle" '+(connected?'':'disabled')+'>Actualizar @usuario VIS</button></div>'+
  '<div class="profile-quick-actions"><button class="outline-btn" data-action="edit-avatar">'+I('edit',15)+' Avatar y emblemas</button>'+
  '<button class="outline-btn" data-action="import-profile-banner">'+I('image',15)+' Cambiar portada</button></div>'+
  '<div class="profile-quick-actions">'+(connected?'<button class="primary-btn" data-action="social-upload-avatar">'+I('upload',15)+' Publicar foto en VIS Social</button>':
    '<span class="muted">Conectá VIS Social para publicar tu foto.</span>')+'</div>'+
  '<details class="profile-advanced"><summary>Más opciones visuales</summary><div class="profile-quick-actions">'+
  '<button class="subtle-btn" data-action="import-avatar-layer">Capa PNG del avatar</button>'+
  (user.profile_banner?'<button class="subtle-btn" data-action="clear-profile-asset" data-kind="profile_banner">Quitar portada</button>':'')+
  (user.avatar_layer?'<button class="subtle-btn" data-action="clear-profile-asset" data-kind="avatar_layer">Quitar capa del avatar</button>':'')+'</div></details>'+
 '</section>'+
 '<section><h3>'+I('game',18)+' Minecraft en VIS</h3>'+
  '<p class="muted">Importá una skin PNG 64×64 o 64×32. VIS Social y Minecraft oficial son publicaciones distintas; en una cuenta Premium podés activar ambas.</p>'+
  (microsoftGamertag?'<div class="profile-quick-actions"><label><input type="checkbox" id="premium-edit-auto-skin" '+(premiumSkinSync?'checked':'')+'/> Subir también a Minecraft oficial</label>'+
     '<label>Modelo <select id="premium-edit-model"><option value="classic" '+(premiumSkinModel==='classic'?'selected':'')+'>Clásico · Steve</option><option value="slim" '+(premiumSkinModel==='slim'?'selected':'')+'>Delgado · Alex</option></select></label></div>':'')+
   '<div class="profile-quick-actions"><button class="outline-btn" data-action="import-skin">Importar skin local</button>'+
   '<button class="primary-btn" data-action="publish-vis-skin" '+(!user.skin||!connected||skinSharingBusy?'disabled':'')+'>Publicar en VIS</button>'+
   (skin?'<button class="subtle-btn" data-action="remove-vis-skin">Quitar pública</button>':'')+'</div>'+
  '<details class="profile-advanced"><summary>Recursos locales y avanzados</summary><div class="profile-quick-actions">'+
    '<button class="outline-btn" data-action="import-cape">Importar capa local</button>'+
    (user.cape?'<button class="subtle-btn" data-action="clear-profile-asset" data-kind="cape">Quitar capa local</button>':'')+
    (user.skin?'<button class="subtle-btn" data-action="clear-profile-asset" data-kind="skin">Quitar skin local</button>':'')+
    '</div><small class="muted">Las capas importadas localmente no se agregan a tu cuenta oficial Mojang.</small></details>'+
 '</section>'+
 '<section><h3>'+I('users',18)+' Compartir identidad</h3>'+
  '<p class="muted">Compartí tu @usuario. El nombre Premium de Minecraft es independiente.</p>'+
  '<button class="outline-btn" data-action="social-copy-handle">'+I('copy',15)+' Copiar @'+esc(publicVisHandle())+'</button>'+
 '</section>'+
 '</div><footer class="modal-footer"><button class="primary-btn" data-action="close-modal">Listo</button></footer></div></div>';
}
function visSkinDialog(){
 const entry=publicSkinLookup||{};
 return '<div class="modal-backdrop" data-action="modal-backdrop"><div class="dialog modal-small vis-skin-dialog" role="dialog" aria-modal="true" aria-label="Skin pública VIS">'+
  '<header class="modal-head"><div><span class="page-eyebrow">SKINS DE VIS SOCIAL</span><h2>@'+esc(entry.username||'Usuario VIS')+'</h2></div>'+
  '<button class="icon-btn" data-action="close-modal" aria-label="Cerrar">'+I('x',18)+'</button></header>'+
  '<div class="modal-body"><p class="muted">Apariencia pública de VIS Nexo, no es una verificación de cuenta Microsoft.</p>'+
  (entry.loading?'<p class="muted">Consultando la skin pública…</p>':
   entry.error?'<p class="muted">'+esc(entry.error)+'</p>':
   entry.skin?'<div class="vis-skin-view">'+(entry.head?'<img class="profile-skin-head" src="'+attr(entry.head)+'" alt="Cabeza de Minecraft"/>':'')+
    '<img class="profile-skin-sheet" src="'+attr(entry.skin)+'" alt="Textura completa PNG de Minecraft"/></div>':
   '<p class="muted">Este usuario todavía no publicó una skin VIS.</p>')+
  '</div><footer class="modal-footer"><button class="primary-btn" data-action="close-modal">Cerrar</button></footer></div></div>';
}
function isExecutionEnabled(p){return p?.installable&&db.project_execution?.[p.id]!==false;}
function selectedMcInstance(){
 // Shared installs are read-only from a visiting profile; own resources have
 // their own folder and the shared engine does not make them writable here.
 return db.instances.find(i=>!i.source_owner&&i.project_id===mcSelected?.projectId&&i.name===mcSelected?.name)
     ||(libraryMode==='user'?personalInstances():officialInstances()).find(i=>!i.source_owner)||null;
}
function instanceLine(i){const p=db.projects.find(p=>p.id===i.project_id);const allow=i.project_id===PERSONAL_PROJECT_ID || isExecutionEnabled(p);
 return `<article class="instance-card">${bulkInstanceMode&&!isGuest()?`<label class="bulk-instance-choice"><input type="checkbox" data-action="bulk-instance-toggle" data-project="${attr(i.project_id)}" data-id="${attr(i.name)}" data-source="${attr(i.source_owner||'')}" ${bulkInstanceSelection.has(instanceSelectionKey(i))?'checked':''} aria-label="Seleccionar ${attr(i.name)} para quitar"/><span>Seleccionar</span></label>`:''}<div class="instance-visual">${I('game',27)}</div><div class="instance-descriptor"><h3>${esc(i.name)}</h3><p>${esc(p?.title||(i.project_id===PERSONAL_PROJECT_ID?'Biblioteca personal':i.project_id))} · ${esc(i.version||'Sin versión')} · ${esc(i.engine==='horizon'?'Horizon Rust':(i.loader||'vanilla'))} ${esc(i.loader_version||'')} · ${(i.ram_mb/1024).toFixed(1)} GB RAM</p>${i.source_owner?`<small>Instalada por ${esc(i.source_owner)} · ${i.share_game_data!==false?'mundos y servidores compartidos':'datos separados por cuenta'}</small>`:''}<span class="instance-notice ${i.installed?'mc-ok':''}">${i.installed?'Instalación preparada':'Sin instalar'}${allow?'':' · Bloqueado por el administrador'}</span></div>
 <div class="mc-instance-actions">${isGuest()||i.source_owner?'':`<button class="outline-btn" data-action="manage-instance" data-id="${attr(i.name)}" data-project="${attr(i.project_id)}">${I('settings',16)} Mods y archivos</button>
 <button class="outline-btn" data-action="install-minecraft" data-id="${attr(i.name)}" data-project="${attr(i.project_id)}" ${!allow||minecraftBusy?'disabled':''}>${I('upload',16)} ${i.installed?'Reparar':'Instalar'}</button>`}
 ${!isGuest()?`<button class="outline-btn" data-action="instance-data-tools" data-id="${attr(i.name)}" data-project="${attr(i.project_id)}" data-source="${attr(i.source_owner||'')}">${I('database',16)} Datos</button>`:''}
 <button class="icon-btn" data-action="open-instance-folder" data-id="${attr(i.name)}" data-project="${attr(i.project_id)}" data-source="${attr(i.source_owner||'')}" title="Abrir carpeta de juego de esta instancia" aria-label="Abrir carpeta de ${attr(i.name)}">${I('folder',17)}</button>
 <button class="icon-btn" data-action="open-instance-resource-folder" data-kind="resourcepacks" data-id="${attr(i.name)}" data-project="${attr(i.project_id)}" data-source="${attr(i.source_owner||'')}" title="Abrir resourcepacks de esta instancia" aria-label="Abrir resourcepacks de ${attr(i.name)}">${I('image',17)}</button>
 <button class="primary-btn" data-action="launch-minecraft" data-id="${attr(i.name)}" data-project="${attr(i.project_id)}" data-source="${attr(i.source_owner||'')}" ${!i.installed||!allow||minecraftBusy?'disabled':''}>${I('play',17)} Jugar</button>
 ${i.source_owner&&!isGuest()&&i.share_game_data!==false?`<button class="outline-btn" data-action="recover-legacy-instance" data-id="${attr(i.name)}" data-project="${attr(i.project_id)}" data-source="${attr(i.source_owner)}" title="Recuperar mundos y servidores guardados en antiguas carpetas separadas de tu perfil">${I('refresh',15)} Recuperar datos antiguos</button>`:''}
 ${i.source_owner&&!isGuest()?`<button class="outline-btn" data-action="hide-shared-instance" data-id="${attr(i.name)}" data-project="${attr(i.project_id)}" data-source="${attr(i.source_owner)}" title="Solo oculta de tu biblioteca, no borra los mundos">${I('x',15)} Ocultar</button><button class="outline-btn" data-action="shared-ram" data-id="${attr(i.name)}" data-project="${attr(i.project_id)}" data-source="${attr(i.source_owner)}">${I('settings',16)} RAM</button>`:''}
 ${isGuest()||i.source_owner?'':`<button class="icon-btn" data-action="export-worlds-instance" data-id="${attr(i.name)}" data-project="${attr(i.project_id)}" title="Exportar instancia completa a ZIP" aria-label="Exportar ${attr(i.name)}">${I('upload',16)}</button>`}
 ${isGuest()||i.source_owner?'':`<button class="icon-btn" data-action="duplicate-instance" data-id="${attr(i.name)}" data-project="${attr(i.project_id)}" title="Duplicar configuración sin copiar mundos" aria-label="Duplicar ${attr(i.name)}">${I('layers',16)}</button><button class="icon-btn" data-action="edit-instance" data-id="${attr(i.name)}" data-project="${attr(i.project_id)}" title="Ajustar instancia">${I('edit',16)}</button><button class="outline-btn danger" data-action="delete-instance" data-id="${attr(i.name)}" data-project="${attr(i.project_id)}" title="Quitar instancia; por defecto conserva mundos">${I('trash',16)} Quitar</button>`}</div></article>`;
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
function instancesPage(){const items=isGuest()?db.instances:(libraryMode==='user'?personalInstances():officialInstances());return `<div class="content-inner"><div class="page-heading"><div><span class="page-eyebrow">MINECRAFT / INSTANCIAS</span><h1>${libraryMode==='user'?'Mis instancias':'Instancias de Universe'}</h1><p>${isGuest()?'Instancias instaladas por los perfiles VIS de esta computadora. Todos los perfiles ven los mismos mundos y servidores de una instancia compartida, salvo que se configure lo contrario.':'Instalá Minecraft Java (Vanilla/Fabric) o prepará Horizon Rust Edition sin utilizar su launcher.'}</p></div><div class="vis-instance-toolbar">${!isGuest()&&items.length?`<button class="outline-btn ${bulkInstanceMode?'danger':''}" data-action="bulk-instance-mode">${I('trash',16)} ${bulkInstanceMode?'Cancelar selección':'Seleccionar para quitar'}</button>`:''}${isGuest()?'':`<button class="outline-btn" data-action="import-worlds-instance">${I('upload',18)} Importar ZIP VIS</button>`}<button class="primary-btn" data-action="open-instance" ${!isGuest()&&(libraryMode==='user'||db.projects.length)?'':'disabled'}>${I('plus',18)} Nueva instancia</button></div></div>
 ${bulkInstanceMode&&!isGuest()?bulkInstanceToolbar(items):''}
 ${minecraftBusy?`<div class="mc-progress" id="minecraft-progress">${I('upload',16)} ${esc(installProgress?.detail||'Preparando descarga...')}</div>`:''}
 <aside class="vis-smart-tip">${I('info',17)} <div><strong>VIS Smart Install</strong><span>Si ya tenés esta versión en Minecraft oficial, CurseForge, Prism o VIS Worlds, se intentarán copiar únicamente los archivos comprobados por SHA-1. El resto se descarga normalmente.</span></div></aside>
 ${minecraftExitNotice()}
 ${items.length?`<div class="instance-list">${items.map(instanceLine).join('')}</div>`:quietEmpty('Sin instancias configuradas',libraryMode==='user'?'Creá un Minecraft personal sin depender de un proyecto del administrador.':isGuest()?'Necesitás una instancia Java instalada en cualquiera de los perfiles locales de VIS.':'Elegí un proyecto habilitado, seleccioná la versión de Minecraft y creá tu primera instancia.')}</div>`;}
function bulkInstanceToolbar(available){
 const count=available.filter(i=>bulkInstanceSelection.has(instanceSelectionKey(i))).length;
 return '<div class="bulk-instance-toolbar" role="group" aria-label="Selección de instancias">'+
 '<strong>'+count+' seleccionada'+(count===1?'':'s')+'</strong>'+
 '<span class="muted">Las propias se quitan; las compartidas se ocultan solo para tu cuenta.</span>'+
 '<button type="button" class="outline-btn" data-action="bulk-instance-select-all">Seleccionar todas</button>'+
 '<button type="button" class="danger-btn" data-action="bulk-instance-confirm" '+(count?'':'disabled')+'>'+
 I('trash',16)+' Quitar '+count+'</button></div>';
}
function bulkInstanceDeleteDialog(){
 const keys=[...bulkInstanceSelection];
 const instances=(db.instances||[]).filter(i=>keys.includes(instanceSelectionKey(i)));
 const hasShared=instances.some(i=>!!i.source_owner);
 const rows=instances.map(i=>'<li><strong>'+esc(i.name)+'</strong><small> · '+esc(i.engine==='horizon'?'Horizon Rust':'Minecraft Java')+
   ' · '+esc(i.source_owner?'Compartida por '+i.source_owner:'Propia')+'</small></li>').join('');
 return '<div class="modal-backdrop" data-action="modal-backdrop"><div class="dialog modal-medium" role="alertdialog" aria-modal="true" aria-label="Confirmar eliminación múltiple">'+
 '<header class="modal-head"><div><span class="page-eyebrow">OPERACIÓN IRREVERSIBLE SI BORRÁS ARCHIVOS</span><h2>Quitar '+instances.length+
 ' instancia'+(instances.length===1?'':'s')+'</h2></div>'+
 '<button type="button" class="icon-btn" data-action="close-modal" aria-label="Cerrar">'+I('x',18)+'</button></header>'+
 '<div class="modal-body bulk-delete-body"><p>Revisá las instancias seleccionadas:</p>'+
 '<ul class="bulk-instance-summary">'+rows+'</ul>'+
 '<label class="toggle-line large"><span><b>Borrar también los mundos y archivos del disco</b>'+
 '<small>De forma predeterminada, los mundos se conservan. Si activás esta opción, el borrado es irreversible y solo se permite en Instancias/&lt;nombre&gt; administradas por VIS. Cerrá Minecraft antes.</small></span>'+
 '<input type="checkbox" id="bulk-delete-files" '+(hasShared?'disabled':'')+'/></label>'+
 '<label class="bulk-confirm-label">Escribí <strong>CONFIRMAR</strong> para continuar'+
 '<input id="bulk-delete-confirm-input" type="text" spellcheck="false" autocomplete="off" placeholder="CONFIRMAR" maxlength="20" aria-label="Escribir CONFIRMAR" autofocus/></label>'+
 '</div><footer class="modal-footer"><button type="button" class="subtle-btn" data-action="close-modal">Cancelar</button>'+
 '<button type="button" class="danger-btn" data-action="bulk-delete-execute" disabled>'+
 I('trash',16)+' Quitar instancias seleccionadas</button></footer></div></div>';
}
function minecraftPage(){if(isGuest())return `<div class="content-inner"><div class="page-heading"><h1>Minecraft offline</h1><p>Solo inicio de instancias ya instaladas, sin autenticación Microsoft.</p></div><button class="primary-btn" data-action="go-instances">Ver instancias disponibles</button></div>`;const i=selectedMcInstance();const p=db.projects.find(x=>x.id===i?.project_id);
 return `<div class="content-inner mc-manager"><div class="page-heading"><div><span class="page-eyebrow">VIS WORLDS · MOTORES</span><h1>Centro de Minecraft</h1><p>Buscá mods compatibles, importá tus JARs y administrá recursos sin abrir carpetas a mano.</p></div><button class="outline-btn" data-action="go-instances">${I('layers',16)} Instancias</button></div>
 ${!i?quietEmpty('Primero creá una instancia','Desde Instancias elegí un proyecto, la versión oficial de Minecraft y Fabric o Vanilla.'):
 `<section class="surface-card mc-profile-card"><div><span class="page-eyebrow">PERFIL ACTIVO</span><h2>${esc(i.name)}</h2><p>${esc(p?.title||(i.project_id===PERSONAL_PROJECT_ID?'Biblioteca personal':'Proyecto'))} · Minecraft ${esc(i.version)} · ${esc(i.engine==='horizon'?'Horizon Rust':i.loader==='fabric'?'Fabric '+(i.loader_version||''):'Vanilla')}</p></div><select id="mc-active-instance" aria-label="Seleccionar instancia">${db.instances.filter(x=>!x.source_owner).map(x=>`<option value="${attr(x.project_id+'|'+x.name)}" ${x===i?'selected':''}>${esc(x.name)} · ${esc(x.version)}</option>`).join('')}</select></section>
 ${i.engine==='horizon'?`<section class="surface-card vis-horizon-diagnostic"><div class="card-heading">${I('info',20)} Diagnóstico de Horizon</div><p>Este motor usa <strong>horizon-client</strong> directamente. Los mods .hmod/.hnmod no funcionan como JARs Fabric; su instalador especializado está pendiente.</p><button class="outline-btn" data-action="horizon-check" data-id="${attr(i.name)}" data-project="${attr(i.project_id)}">${I('check',17)} Comprobar requisitos y recursos</button>
 ${horizonChecks.length?`<ul class="vis-horizon-check-list">${horizonChecks.map(c=>`<li class="vis-horizon-check-item ${c.status==='ok'?'vis-horizon-success':c.status==='missing'?'vis-horizon-missing':'vis-horizon-manual'}"><strong>${esc(c.label)}</strong><small>${esc(c.detail)}</small></li>`).join('')}</ul>`:''}</section>`:''}
 ${i.engine==='horizon'?'':`<div class="mc-manager-grid"><section class="surface-card"><div class="card-heading">${I('search',20)} Explorar Modrinth</div>
 <form id="modrinth-search-form" class="mc-search-form"><div class="mc-filter-row"><select name="kind" id="mc-mod-kind"><option value="mod" ${modKind==='mod'?'selected':''} ${i.loader==='fabric'?'':'disabled'}>Mods Fabric</option><option value="resourcepack" ${modKind==='resourcepack'?'selected':''}>Resource packs</option><option value="shader" ${modKind==='shader'?'selected':''}>Shaders</option></select><span class="mc-version-chip">MC ${esc(i.version)}</span></div><div class="mc-search-box"><input name="query" maxlength="120" placeholder="Sodium, Fabric API, Iris..." value="${attr(modSearchQuery)}" aria-label="Buscar mods"/><button class="primary-btn" ${!native?'title="Requiere Tauri"':''}>${I('search',17)} Buscar</button></div></form>
 <div class="mc-results">${modResults.length?modResults.map(m=>`<article class="mc-result"><div class="mc-result-icon">${I('package',22)}</div><div><h3>${esc(m.title)}</h3><p>${esc(m.description)}</p><small>${Number(m.downloads||0).toLocaleString('es-AR')} descargas · compatible con MC ${esc(i.version)}</small></div><button data-action="install-modrinth" data-id="${attr(m.id)}" title="Instalar versión compatible">${I('plus',17)} Instalar</button></article>`).join(''):'<p class="muted">Resultados compatibles según versión y loader. Buscá para empezar.</p>'}</div></section>
 <section class="surface-card mc-files"><div class="card-heading">${I('folder',20)} Recursos instalados</div><p class="muted">Copias locales independientes por instancia; podés eliminar sin tocar el proyecto principal.</p><div class="mc-file-buttons"><button class="outline-btn" data-action="import-instance-resource" data-kind="mod" ${i.loader==='fabric'?'':'disabled'}>${I('upload',16)} Importar JAR</button><button class="outline-btn" data-action="import-instance-resource" data-kind="resourcepack">${I('upload',16)} Texture pack ZIP</button><button class="outline-btn" data-action="import-instance-resource" data-kind="shader">${I('upload',16)} Shader ZIP</button></div>
 <div class="mc-local-files">${installedFiles.length?installedFiles.map(f=>`<div class="mc-file-entry"><span>${I('package',15)} ${esc(f.file)} <small>${esc(f.kind)} · ${f.enabled===false?'Desactivado':'Activo'}</small></span><div class="mc-file-actions"><button data-action="toggle-instance-file" data-kind="${attr(f.kind)}" data-file="${attr(f.file)}" aria-label="${f.enabled===false?'Activar':'Desactivar'} ${attr(f.file)}" title="${f.enabled===false?'Activar':'Desactivar'} sin eliminar">${I(f.enabled===false?'play':'pause',16)}</button><button data-action="remove-instance-file" data-kind="${attr(f.kind)}" data-file="${attr(f.file)}" aria-label="Eliminar ${attr(f.file)}">${I('trash',16)}</button></div></div>`).join(''):'<p class="muted">Sin mods ni packs importados.</p>'}</div></section></div>`}
 <section class="surface-card mc-player-folders"><div class="card-heading">${I('folder',20)} Mis carpetas de juego</div>
 <p class="muted">Estas carpetas pertenecen a la instancia. Sus mundos, opciones, servidores y packs se comparten entre cuentas VIS, salvo que el propietario active el modo de datos separados.</p>
 <div class="mc-file-buttons">
 ${['resourcepacks','saves','shaderpacks','mods','screenshots','logs'].map(kind=>`<button class="outline-btn" type="button" data-action="open-instance-resource-folder" data-kind="${kind}" data-project="${attr(i.project_id)}" data-id="${attr(i.name)}" data-source="${attr(i.source_owner||'')}">${I('folder',15)} ${({resourcepacks:'Resource packs',saves:'Mundos',shaderpacks:'Shaders',mods:'Mods',screenshots:'Capturas',logs:'Logs'})[kind]}</button>`).join('')}
 </div></section>
 ${minecraftExitNotice()}
 <div class="mc-disclaimer">${I('info',17)} Las cuentas locales ejecutan Minecraft en modo sin autenticación oficial (pruebas/singleplayer). Para acceder a servidores online-mode, skins y capas oficiales se requiere Microsoft OAuth.</div>`}</div>`;}
function teamPublishSection(){
 const installed=(db.instances||[]).filter(i=>!i.source_owner&&i.project_id!==PERSONAL_PROJECT_ID
   &&db.projects.some(p=>p.id===i.project_id));
 return `<section class="surface-card wide vis-team-pack">
 <div class="card-heading">${I('folder',20)} VIS Team · Proyecto compartido</div>
 <p class="muted">Creá un ZIP con .bsconfig, mods Modrinth referenciados y carpetas comunes. No publica saves, contraseñas, sesiones ni preferencias del jugador.</p>
 <form id="team-publish-form" class="settings-form">
 <label class="field-label">Instancia del proyecto<select name="instance" required>
 ${installed.length?installed.map(i=>`<option value="${attr(JSON.stringify([i.project_id,i.name]))}">${esc(i.project_id)} · ${esc(i.name)} (${esc(i.version)})</option>`).join(''):
 '<option value="">Instalá una instancia propia de un proyecto</option>'}</select></label>
 <label class="toggle-line"><span><b>Resource packs, shaders y datapacks</b><small>Solo recursos redistribuibles, máximo 32 MiB por ZIP.</small></span><input type="checkbox" name="include_packs"/></label>
 <label class="toggle-line"><span><b>Servidores guardados</b><small>Incluirá IP/direcciones de servers.dat; desactivado inicialmente.</small></span><input type="checkbox" name="include_servers"/></label>
 <label class="toggle-line"><span><b>Waypoints y mapas</b><small>Puede revelar coordenadas privadas; desactivado inicialmente.</small></span><input type="checkbox" name="include_waypoints"/></label>
 <button class="outline-btn" type="submit" data-team-action="preview" ${!installed.length?'disabled':''}>Revisar archivos a compartir</button>
 <label class="field-label">Credencial VIS Universe (solo para publicar)<input type="password" name="token" minlength="32" autocomplete="off" placeholder="Token privado del Worker"/></label>
 <button class="primary-btn" type="submit" data-team-action="publish" ${!installed.length?'disabled':''}>Publicar paquete de equipo</button>
 </form><div id="vis-team-review" class="muted">Primero revisá qué archivos se compartirán con los jugadores.</div>
 <small>Solo el administrador local y quien posea la credencial de publicación puede subir el paquete.</small></section>`;
}
function settingsPage(){if(isGuest())return `<div class="content-inner"><h1>Modo offline</h1><p>Para personalizar la cuenta, cerrá el modo offline e iniciá sesión.</p></div>`;return `<div class="content-inner"><div class="page-heading"><div><span class="page-eyebrow">PREFERENCIAS</span><h1>Configuración</h1><p>Personalizá la experiencia del launcher.</p></div></div><div class="settings-grid">
 ${updateSection()}${downloadsHistorySection()}${isAdmin()?`<section class="surface-card cloud-settings"><div class="card-heading">${I('cloud',20)} Publicación de VIS Universe</div><p class="muted">URL HTTPS del JSON público en GitHub Pages o Cloudflare R2. Se configura localmente; para distribuirla a todos, incluí VIS_CATALOG_URL al compilar el launcher.</p><form id="cloud-catalog-form" class="settings-form"><label class="field-label">Dirección del catálogo<input type="url" name="url" placeholder="https://usuario.github.io/vis/catalog.json" value="${attr(cloudCatalog?.source||'')}"/></label><button class="outline-btn">Guardar catálogo</button></form><form id="universe-publish-form" class="settings-form"><label class="field-label">Credencial de publicación del servidor (no se guarda)<input type="password" name="token" minlength="32" autocomplete="off" required placeholder="Credencial Cloudflare Worker"/></label><button class="primary-btn">Publicar proyectos y novedades</button><small>Publica los proyectos locales de VIS STUDIOS en el catálogo central. Los usuarios recibirán los cambios cuando abran VIS.</small></form></section>`:''}${isAdmin()?teamPublishSection():''}<section class="surface-card"><div class="card-heading">${I('monitor',21)} Rendimiento</div><label class="toggle-line"><span><b>Reducir animaciones</b><small>Evita movimientos decorativos innecesarios.</small></span><input type="checkbox" id="reduced-motion" ${prefs.reducedMotion?'checked':''}/></label><label class="toggle-line"><span><b>Panel de amigos</b><small>Mostrar el panel social a la derecha.</small></span><input type="checkbox" id="social-visibility" ${socialVisible?'checked':''}/></label></section>
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
 <section class="surface-card maintenance-safe"><h3>${I('shield',19)} Referencias antiguas de VIS</h3>
 <p>Podés quitar accesos rápidos de cuentas inexistentes y ajustes de instancias compartidas que ya no existen. Esto no toca cuentas, skins, mundos, descargas instaladas ni proyectos.</p>
 <p class="muted">Referencias candidatas: ${legacyReport?((legacyReport.recent_accounts||0)+(legacyReport.hidden_shared||0)+(legacyReport.shared_ram||0)):'Sin analizar'}. Accesos rápidos: ${legacyReport?.recent_accounts||0}, instancias compartidas: ${legacyReport?.hidden_shared||0}, RAM antigua: ${legacyReport?.shared_ram||0}.</p>
 <div class="maintenance-controls"><button class="outline-btn" data-action="legacy-cleanup-preview" ${legacyLoading||!native?'disabled':''}>Analizar referencias</button><button class="danger-btn" data-action="legacy-cleanup-apply" ${legacyLoading||!legacyReport||!(legacyReport.recent_accounts+legacyReport.hidden_shared+legacyReport.shared_ram)?'disabled':''}>Quitar referencias obsoletas</button></div></section>
 <section class="surface-card maintenance-safe"><h3>${I('shield',19)} Archivos protegidos</h3><p>No se inspeccionan ni borran cuentas, chats, mundos, instancias, mods, texturas, bibliotecas Minecraft, proyectos o banners. Se ignoran enlaces simbólicos y archivos recientes.</p><p class="muted">Los historiales de chat de VIS Humile se depurarán solamente desde el servicio cloud, con respaldos y avisos a los usuarios. Esa función no está conectada todavía.</p>${!native?'<p class="muted">La vista previa de navegador no tiene acceso a archivos locales.</p>':''}</section></div>`;
}
async function loadLegacy(){
 if(!native)return;
 legacyLoading=true;render();
 try{legacyReport=await command('legacy_cleanup_preview');}
 catch(error){legacyReport=null;message('No se pudo analizar referencias: '+String(error),true);}
 finally{legacyLoading=false;render();}
}
async function cleanLegacy(){
 if(!native||!legacyReport)return;
 if(!window.confirm('¿Eliminar solo referencias huérfanas del launcher? No se borrarán cuentas, mundos, proyectos, skins ni instalaciones.'))return;
 legacyLoading=true;render();
 try{
   const result=await command('legacy_cleanup_apply',{confirmed:true});
   legacyReport=await command('legacy_cleanup_preview');
   db=await command('get_state');
   message('Limpieza completada: '+(result.recent_accounts+result.hidden_shared+result.shared_ram)+' referencias antiguas.');
 }catch(error){message(String(error),true);}
 finally{legacyLoading=false;render();}
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
 <div class="cloud-project-grid">${items.map(p=>`<article class="surface-card cloud-project"><div class="cloud-project-top">${I('layers',24)}<span>${esc(p.version||'Sin versión')}</span></div><h3>${esc(p.name)}</h3><p>${esc(p.description||'Proyecto de VIS Universe')}</p><div class="cloud-project-meta"><span>${I('game',14)} Minecraft ${esc(p.minecraft_version||'—')}</span><span>${esc(p.loader||'vanilla')}</span></div>${p.bundle_url?`
  <button class="outline-btn" data-action="download-cloud-bundle" data-id="${attr(p.id)}">${I('cloud',16)} Descargar ZIP verificado</button>
  ${(() => {const own=db.instances.filter(i=>!i.source_owner&&i.project_id===p.id);
    return own.length?`<div class="team-install">
     <label>Instancia destino<select data-team-destination="${attr(p.id)}">
       ${own.map(i=>`<option value="${attr(i.name)}">${esc(i.name)}</option>`).join('')}
     </select></label>
     <label class="toggle-line"><span>Importar servidores/IP publicados</span><input type="checkbox" data-team-servers/></label>
     <label class="toggle-line"><span>Importar waypoints del equipo</span><input type="checkbox" data-team-waypoints/></label>
     <button class="outline-btn" data-action="apply-team-project" data-id="${attr(p.id)}">${I('folder',15)} Aplicar archivos nuevos</button>
     <small>Conserva todos tus archivos existentes. Descarga el ZIP y comprueba sus hashes.</small>
    </div>`:'<small>Instalá primero una instancia propia para aplicar el paquete.</small>';
  })()}`:'<small>Sin archivo publicado</small>'}</article>`).join('')||'<div class="quiet-empty">'+I('cloud',25)+'<h3>No hay publicaciones todavía</h3><p>Conectá un catálogo público para mostrar proyectos disponibles.</p></div>'}</div>
 </div>`;
}
function updateSection(){return `<section class="surface-card update-card"><div class="card-heading">${I('cloud',20)} VIS Nexo · Actualizaciones</div><p class="muted">${updateInfo?.configured?`Versión instalada: ${esc(updateInfo.current_version)}. ${updateInfo.available?'Nueva versión '+esc(updateInfo.version)+' disponible.':'Sin actualizaciones detectadas.'}`:'Las actualizaciones firmadas se activan al configurar el repositorio y la clave pública de firma durante la compilación.'}</p>${updateInfo?.notes?`<p class="muted">${esc(updateInfo.notes)}</p>`:''}<div class="update-actions"><button class="outline-btn" data-action="check-update" ${updateBusy?'disabled':''}>${I('cloud',16)} ${updateBusy?'Comprobando…':'Buscar actualizaciones'}</button>${updateInfo?.available?`<button class="primary-btn" data-action="install-update" ${updateBusy?'disabled':''}>${I('cloud',17)} Instalar versión ${esc(updateInfo.version)}</button>`:''}</div><small>Se conserva la carpeta de datos y el identificador de aplicación anterior para preservar proyectos, mundos y perfiles.</small></section>`;}
async function checkAppUpdate(silent=false){if(!native)return;if(updateBusy)return;updateBusy=true;if(!silent)render();try{updateInfo=await command('check_app_update');if(updateInfo.available)message(`VIS Nexo ${updateInfo.version} disponible`);else if(!silent)message(updateInfo.configured?'Ya tenés la última versión.':'Las actualizaciones todavía no están configuradas.');}catch(e){if(!silent)message(String(e),true);}finally{updateBusy=false;if(!silent||page==='settings')render();}}
async function installAppUpdate(){if(!native)return;if(!updateInfo?.available)return;if(!confirm('¿Instalar la actualización firmada de VIS Nexo? Antes se guardará una copia de seguridad de tus preferencias. Los mundos y las instancias se conservan.'))return;updateBusy=true;render();try{await command('install_app_update',{confirmed:true});message('Actualización instalada. Reiniciá VIS Nexo si es necesario.');}catch(e){message(String(e),true);}finally{updateBusy=false;render();}}
async function refreshCloudCatalog(silent=false){
 if(!native||cloudCatalogBusy)return;
 const generation=accountGeneration;
 cloudCatalogBusy=true;if(!silent)render();
 try{
  const next=await command('sync_universe');
  if(generation!==accountGeneration)return;
  const catalog=await command('fetch_cloud_catalog');
  if(generation!==accountGeneration)return;
  db=next;cloudCatalog=catalog;
  await refreshAssets();
  if(generation===accountGeneration&&!silent)message(`Catálogo actualizado: ${catalog.projects?.length||0} proyectos`);
 }catch(e){if(generation===accountGeneration&&!silent)message(String(e),true);}
 finally{cloudCatalogBusy=false;if(generation===accountGeneration)render();}
}
async function downloadCloudBundle(id){const project=cloudCatalog?.projects?.find(p=>p.id===id);if(!project||!confirm(`¿Descargar el archivo de ${project.name}? Se guardará en VIS/descargas. El archivo no se ejecutará automáticamente.`))return;try{const path=await command('download_cloud_bundle',{projectId:id});message(`Paquete descargado: ${path}`);}catch(e){message(String(e),true);}}
function activeDownload(){
 return downloadJobs.find(j=>j.owner===db.user?.username&&['running','cancelling'].includes(j.status))||null;
}
function downloadStatusName(status){
 return ({running:'En curso',cancelling:'Cancelando',completed:'Completada',
  cancelled:'Cancelada',failed:'Con error'})[status]||'Desconocida';
}
function downloadsHistorySection(){
 const jobs=downloadJobs.filter(j=>j.owner===db.user?.username).slice(0,8);
 return '<section class="surface-card wide vis-download-history">'+
   '<div class="card-heading">'+I('download',20)+' VIS Download Manager</div>'+
   '<p class="muted">Instalaciones de Minecraft Java y Horizon de esta sesión. Una instalación a la vez. Cancelar detiene la próxima operación segura sin borrar archivos verificados.</p>'+
   '<button class="outline-btn" data-action="refresh-downloads">'+I('refresh',16)+' Actualizar estado</button>'+
   (jobs.length?jobs.map(job=>'<div class="detail-line"><span>'+esc(job.label)+
     ' · '+esc(job.stage)+'</span><strong>'+esc(downloadStatusName(job.status))+'</strong></div>').join(''):
     '<p class="muted">Todavía no hay instalaciones registradas en esta sesión.</p>')+
   '</section>';
}
async function refreshDownloadJobs(){
 if(!native||!db.user)return;
 try{downloadJobs=await command('download_jobs');}
 catch(error){message('No se pudo consultar Descargas: '+String(error),true);}
}
function downloadDock(){
 if(!minecraftBusy)return '';
 const job=activeDownload();
 const progress=job?.total?job:(installProgress||job||{stage:'init',completed:0,total:0,detail:'Preparando instalación'});
 const total=Math.max(0,Number(progress.total)||0);
 const completed=Math.max(0,Math.min(total,Number(progress.completed)||0));
 const pct=total?Math.min(100,Math.round(completed*100/total)):0;
 const stage={libraries:'Bibliotecas y versión',indexes:'Índice de recursos',assets:'Archivos de Minecraft',
  java:'Java',done:'Instalación completada',init:'Preparación'}[progress.stage]||progress.stage||'Preparación';
 const cancelling=job?.status==='cancelling';
 return '<aside class="vis-download-dock" id="vis-download-dock" role="status" aria-live="polite">'+
  '<div class="vis-download-head"><span>'+I('download',15)+' <b>'+
  esc(cancelling?'Cancelando instalación':job?.label||'Instalando Minecraft')+' · '+esc(stage)+'</b></span>'+
  '<strong id="vis-download-percent">'+(total?pct+'%':'…')+'</strong></div>'+
  '<div class="vis-download-track" role="progressbar" aria-label="Progreso de la etapa" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+pct+'">'+
   '<span id="vis-download-fill" style="width:'+pct+'%"></span></div>'+
  '<small id="vis-download-detail">'+esc(job?.detail||progress.detail||'Preparando archivos')+
     (total?' · '+completed+'/'+total+' en la etapa':'')+'</small>'+
  (job?'<button class="outline-btn" data-action="cancel-active-download" '+(cancelling?'disabled':'')+'>'+
      I('x',14)+' '+(cancelling?'Cancelación solicitada':'Cancelar instalación')+'</button>':'')+
  '</aside>';
}
function updateDownloadDock(){
 const dock=root.querySelector('#vis-download-dock');
 if(dock){const next=downloadDock();if(next)dock.outerHTML=next;}
}
function shell(){return `<div class="app-shell ${socialVisible&&!isGuest()?'has-social':''}">${sidebar()}<div class="main-column">${header()}<main class="main-scroll" id="main-scroll">${page==='home'?homePage():page==='project'?projectPage():page==='profile'?profilePage():page==='instances'?instancesPage():page==='minecraft'?minecraftPage():page==='settings'?settingsPage():page==='maintenance'?maintenancePage():page==='cloud'?cloudPage():assetsPage()}</main></div>${isGuest()?'':socialPanel()}</div>${downloadDock()}${contextMenu?contextMenuView():''}${dialog?dialogView():''}`;}
function contextMenuView(){const p=db.projects.find(p=>p.id===contextMenu.id);if(!p||!isAdmin())return '';return `<div class="context-menu" style="left:${Math.min(contextMenu.x,innerWidth-230)}px;top:${Math.min(contextMenu.y,innerHeight-170)}px"><div class="context-title">${esc(p.title)}</div><button data-action="edit-project" data-id="${attr(p.id)}">${I('edit',16)} Editar proyecto</button><button data-action="open-project" data-id="${attr(p.id)}">${I('external',16)} Abrir página</button><button data-action="toggle-project-execution" data-id="${attr(p.id)}">${I('shield',16)} ${db.project_execution?.[p.id]===false?'Habilitar Minecraft':'Bloquear Minecraft'}</button><button class="destructive" data-action="delete-project" data-id="${attr(p.id)}">${I('trash',16)} Eliminar proyecto</button></div>`;}
function newProject(){return {id:'',title:'',subtitle:'',description:'',versions:[],page_scene_id:null,mc_version:'',engine:'java',loader:'vanilla',loader_version:'',modrinth_mods:[],banner_path:'',logo_path:'',icon_path:'',notes:'',community_url:'',installable:true,visible_sections:{},posts:[],calendar:[]};}
function startProject(id=''){
 if(!isAdmin()){message('Solo el administrador puede gestionar proyectos.',true);return;}
 wizard=clone(db.projects.find(p=>p.id===id)||newProject());wizard.modrinth_mods ||= [];projectModResults=[];projectModQuery='';wizardStep=0;dialog={type:'project'};render();
}
function projectWizard(){
 const stepLabels=['Datos','Identidad visual','Novedades','Revisar'];
 const a=wizard||newProject();
 const curatedIds=a.modrinth_mods||[];
 const step0=`<div class="wiz-fields"><div class="form-pair"><label>Nombre del proyecto<input data-field="title" maxlength="80" value="${attr(a.title)}" placeholder="Nombre del proyecto" autofocus/></label><label>Versión de Minecraft<input list="mc-version-catalog" data-field="mc_version" value="${attr(a.mc_version)}" placeholder="1.21.4"/><datalist id="mc-version-catalog">${minecraftVersions.map(v=>`<option value="${attr(v.id)}">${esc(v.kind)}</option>`).join('')}</datalist></label></div><div class="form-pair"><label>Motor del proyecto<select data-field="engine" id="vis-project-engine"><option value="java" ${(a.engine||'java')==='java'?'selected':''}>Minecraft Java Edition</option><option value="horizon" ${a.engine==='horizon'?'selected':''}>Minecraft Rust Edition — Horizon</option></select></label><label>Modloader<select data-field="loader" id="vis-project-loader" ${a.engine==='horizon'?'disabled':''}><option value="vanilla" ${(a.loader||'vanilla')==='vanilla'?'selected':''}>Vanilla</option><option value="fabric" ${a.loader==='fabric'?'selected':''}>Fabric</option><option value="horizon" ${a.loader==='horizon'?'selected':''}>Horizon nativo</option></select></label></div><label id="vis-project-fabric" class="${a.loader==='fabric'&&a.engine!=='horizon'?'':'hidden'}">Fabric Loader<input data-field="loader_version" id="vis-project-loader-version" list="mc-fabric-catalog" value="${attr(a.loader_version||'')}" placeholder="Versión oficial de Fabric Loader"/><datalist id="mc-fabric-catalog">${fabricLoaders.map(v=>`<option value="${attr(v)}"></option>`).join('')}</datalist></label><div class="project-mod-set"><div class="manage-row-head"><h3>${I('package',17)} Mods del proyecto</h3><span>${curatedIds.length} / 32</span></div>
 <p class="muted">Los mods elegidos se descargan desde Modrinth dentro de cada instancia, con sus dependencias. Podés agregar o quitar mods al actualizar este proyecto; el launcher preserva los archivos personales.</p>
 ${a.engine==='java'&&a.loader==='fabric'? `<div class="project-mod-search"><input id="project-mod-query" value="${attr(projectModQuery)}" placeholder="Buscar mods compatibles en Modrinth" aria-label="Buscar mods"/><button type="button" class="outline-btn" data-action="project-search-mods">${I('search',15)} Buscar</button></div>
 <div class="project-mod-selected">${curatedIds.map(id=>`<div class="project-mod-item"><span>${I('package',14)} ${esc(projectModResults.find(x=>x.id===id)?.title||id)}</span><button type="button" data-action="project-remove-mod" data-id="${attr(id)}" title="Quitar mod del proyecto">${I('x',14)} Quitar</button></div>`).join('')||'<p class="muted">Todavía no elegiste mods.</p>'}</div>
 <div class="project-mod-results">${projectModResults.slice(0,15).map(mod=>`<div class="project-mod-item"><span><b>${esc(mod.title)}</b><small>${esc(mod.id)} · ${esc(mod.description||'').slice(0,115)}</small></span><button type="button" data-action="project-add-mod" data-id="${attr(mod.id)}" ${curatedIds.includes(mod.id)?'disabled':''}>${I('plus',14)} Añadir</button></div>`).join('')}</div>`:
 `<p class="muted">Para proyectos con mods seleccioná Java + Fabric. Horizon y Vanilla no cargan mods Fabric.</p>
 ${curatedIds.length?`<p class="muted">Hay ${curatedIds.length} mods guardados; quitá esos mods antes de cambiar el motor.</p>`:''}`}
 </div><p class="muted">Estos parámetros los configura VIS STUDIOS una sola vez. Los jugadores solo eligen una carpeta y la RAM.</p><label>Versiones o perfiles (separadas por coma)<input data-field="versions_csv" value="${attr((a.versions||[]).join(', '))}" placeholder="Ej. Survival, Optimizador, 26.3"/></label><label>Subtítulo<input data-field="subtitle" maxlength="180" value="${attr(a.subtitle)}" placeholder="Una frase breve sobre el proyecto"/></label><label>Descripción<textarea data-field="description" maxlength="2000" rows="4" placeholder="Descripción del proyecto">${esc(a.description)}</textarea></label><label class="toggle-line large"><span><b>Permitir configuración de instancias</b><small>Habilita la configuración, instalación y ejecución de Minecraft en este proyecto.</small></span><input type="checkbox" data-field="installable" ${a.installable?'checked':''}/></label></div>`;
 const assets=[['banner_path','banner','Banner del proyecto','Panorámico · 16:9 recomendado'],['logo_path','logo','Logo','PNG o WebP transparente'],['icon_path','icon','Icono de sidebar','Cuadrado · mínimo 128 × 128']];
 const step1=`<p class="wizard-hint">Importá tus imágenes; después podés moverlas, ampliarlas y recortarlas sin modificar el archivo original.</p><div class="asset-picker-grid">${assets.map(([field,kind,label,tip])=>`<div class="asset-tile"><div class="asset-picture ${field}" ${a[field]&&preview(a[field])?`style="background-image:url('${preview(a[field])}')"`:''}>${!preview(a[field])?I('image',27):''}</div><div class="asset-tile-bottom"><div><strong>${label}</strong><small>${tip}</small></div><div class="asset-tile-actions"><button data-action="pick-asset" data-kind="${kind}" data-field="${field}" class="outline-btn small">${I('upload',16)} Importar</button>${a[field]&&preview(a[field])?`<button data-action="crop-asset" data-kind="${kind}" data-field="${field}" class="outline-btn small" title="Mover, ampliar y recortar imagen">${I('crop',16)} Ajustar / recortar</button>`:''}${a[field]?`<button data-action="remove-project-image" data-field="${field}" class="subtle-btn small" title="Quitar esta imagen y mostrar el título si es el logo">${I('trash',15)} Quitar</button>`:''}</div></div></div>`).join('')}</div>`;
 const step2=`<div class="wiz-fields"><label>Notas del proyecto<textarea data-field="notes" rows="3" placeholder="Información general">${esc(a.notes)}</textarea></label><label>Enlace de comunidad<input data-field="community_url" value="${attr(a.community_url)}" placeholder="https://..."/></label>
 <div class="manage-row-head"><h3>Visibilidad de la página</h3></div><p class="muted">Ocultá secciones sin borrar sus noticias, parches o eventos.</p><div class="project-section-switches">${[['news','Noticias'],['patches','Notas de parche'],['updates','Actualizaciones'],['calendar','Eventos'],['community','Comunidad'],['notes','Acerca / Notas']].map(([key,label])=>`<label class="toggle-line section-visibility"><span>${label}</span><input type="checkbox" data-visible="${key}" ${visibleSection(a,key)?'checked':''}></label>`).join('')}</div>
 <div class="manage-row-head"><h3>Novedades y parches</h3><span>${a.posts?.length||0}</span></div><div class="wizard-post-list">${(a.posts||[]).map((p,index)=>`<div class="wizard-post"><b>${esc(p.title)}</b><small>${esc(p.kind)} · ${esc(p.date)}</small><button data-action="remove-post" data-index="${index}" aria-label="Eliminar publicación">${I('x',16)}</button></div>`).join('')}</div>
 <div class="small-form"><select id="post-kind"><option value="news">Novedad</option><option value="patch">Parche</option><option value="update">Actualización</option><option value="community">Comunidad</option></select><input id="post-title" placeholder="Título de la publicación"/><textarea id="post-body" rows="2" placeholder="Contenido"></textarea><button class="outline-btn" data-action="add-post">${I('plus',16)} Agregar publicación</button></div>
 <div class="manage-row-head"><h3>Calendario</h3><span>${a.calendar?.length||0}</span></div><div class="wizard-post-list">${(a.calendar||[]).map((e,index)=>`<div class="wizard-post"><b>${esc(e.title)}</b><small>${esc(e.date)}</small><button data-action="remove-event" data-index="${index}" aria-label="Eliminar evento">${I('x',16)}</button></div>`).join('')}</div>
 <div class="small-form"><input id="event-title" placeholder="Nombre del evento"/><input id="event-date" type="date"/><input id="event-description" placeholder="Descripción"/><button class="outline-btn" data-action="add-event">${I('plus',16)} Agregar evento</button></div></div>`;
 const step3=`<div class="wizard-summary"><div class="summary-banner" ${a.banner_path?bgPhoto(a.banner_path):''}><div>${a.logo_path&&preview(a.logo_path)?`<img class="summary-logo" src="${preview(a.logo_path)}" alt=""/>`:`<h2>${esc(a.title||'Nombre del proyecto')}</h2>`}<span>${esc(a.subtitle||'Sin subtítulo')}</span></div></div><div class="summary-columns"><div><span>Versión MC</span><strong>${esc(a.mc_version||'Sin definir')}</strong></div><div><span>Mods</span><strong>${curatedIds.length}</strong></div><div><span>Publicaciones</span><strong>${(a.posts||[]).length}</strong></div><div><span>Eventos</span><strong>${(a.calendar||[]).length}</strong></div><div><span>Estado</span><strong>${a.installable?'Disponible para instancias':'Próximamente'}</strong></div></div><p class="wizard-hint">Al guardar, el proyecto queda local. Desde Configuración → Publicación podés enviarlo al catálogo de VIS Universe.</p></div>`;
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
 return `<div class="modal-backdrop" data-action="modal-backdrop"><div class="dialog avatar-modal" role="dialog" aria-modal="true" aria-label="Personalizar avatar"><header class="modal-head"><div><span class="page-eyebrow">TU IDENTIDAD</span><h2>Personalizar avatar</h2></div><button class="icon-btn" data-action="close-modal" aria-label="Cerrar">${I('x',20)}</button></header><div class="avatar-dialog-body"><div class="avatar-stage"><span class="avatar-stage-ring">${userAvatar(130)}</span><strong>${esc(displayAccount(db.user?.username))}</strong><small>Vista previa de tu perfil</small></div><div class="avatar-options"><h3>Emblemas</h3><p class="muted">Elegí un estilo o importá tu propia imagen.</p><div class="avatar-preset-grid">${choices.map(([key,label])=>`<button class="avatar-preset-option ${selected===key?'active':''}" data-action="preset-avatar" data-id="${key}" aria-label="Avatar ${label}" aria-pressed="${selected===key}">${avatarVisual('preset:'+key,db.user?.username,64)}<span>${label}</span></button>`).join('')}</div><button class="outline-btn full" data-action="import-avatar">${I('upload',18)} Importar y ajustar foto local</button>${social.connected()?`<button class="primary-btn full" data-action="social-upload-avatar">${I('cloud',18)} Publicar foto en VIS Social</button>`:''}${db.user?.avatar&&preview(db.user.avatar)?`<button class="outline-btn full" data-action="crop-profile-existing" data-kind="avatar">${I('crop',17)} Ajustar foto actual</button><button class="subtle-btn full" data-action="clear-profile-asset" data-kind="avatar">${I('trash',16)} Quitar foto</button>`:''}<button class="outline-btn full" data-action="import-avatar-layer">${I('layers',18)} Agregar capa de avatar (PNG)</button>${db.user?.avatar_layer?`<button class="subtle-btn full" data-action="clear-profile-asset" data-kind="avatar_layer">${I('trash',16)} Quitar capa del avatar</button>`:''}<p class="tiny-disclaimer">La foto se ajusta antes de guardarse. Los emblemas no se sincronizan con Microsoft.</p></div></div><footer class="modal-footer"><button class="subtle-btn" data-action="close-modal">Cerrar</button></footer></div></div>`;
}
function instanceDialog(){const a=dialog?.data||{};const p=db.projects.find(p=>p.id===a.project_id);
 return `<div class="modal-backdrop" data-action="modal-backdrop"><div class="dialog modal-medium" role="dialog" aria-modal="true" aria-label="Configuración de instancia"><header class="modal-head"><div><span class="page-eyebrow">MINECRAFT / INSTANCIAS</span><h2>${a.name?'Ajustar instancia':'Nueva instancia'}</h2></div><button class="icon-btn" data-action="close-modal">${I('x',19)}</button></header>
 <form id="instance-form" class="modal-body wiz-fields"><label>Nombre de la instancia<input name="name" required maxlength="60" value="${attr(a.name||'')}" placeholder="Mi instancia"/></label><label>Biblioteca<select name="project_id" id="instance-project" required>
 <option value="${PERSONAL_PROJECT_ID}" ${a.project_id===PERSONAL_PROJECT_ID?'selected':''}>Mi biblioteca · Personal</option>
 ${isAdmin()?db.projects.map(x=>`<option value="${attr(x.id)}" ${a.project_id===x.id?'selected':''}>VIS Universe · ${esc(x.title)}</option>`).join(''):''}</select></label>
 <label>Motor de juego<select name="engine" id="mc-instance-engine"><option value="java" ${(a.engine||'java')==='java'?'selected':''}>Minecraft Java Edition</option><option value="horizon" ${a.engine==='horizon'?'selected':''}>Minecraft Rust Edition — Horizon</option></select></label>
 <div class="form-pair"><label>Versión de Minecraft<select id="mc-version-channel" aria-label="Canal del catálogo"><option value="release" ${minecraftVersionChannel==='release'?'selected':''}>Versiones estables (incluidas anteriores)</option><option value="snapshot" ${minecraftVersionChannel==='snapshot'?'selected':''}>Snapshots (últimas 60)</option></select><input list="mc-version-catalog" id="mc-instance-version" name="version" required value="${attr(a.version||p?.mc_version||'')}" placeholder="Seleccioná del catálogo oficial"/><datalist id="mc-version-catalog">${versionSuggestions(a.version||p?.mc_version||'').map(v=>`<option value="${attr(v.id)}">${esc(v.kind)}</option>`).join('')}</datalist></label><label>RAM (MB)<input name="ram_mb" type="number" min="1024" max="32768" step="256" value="${attr(a.ram_mb||4096)}"/><small>Memoria máxima de Minecraft, no del launcher.</small><span class="instance-ram-presets">${[2048,4096,6144,8192].map(mb=>`<button type="button" data-action="instance-ram-preset" data-size="${mb}" aria-label="${mb/1024} GB RAM">${mb/1024} GB</button>`).join('')}</span></label></div>
 <div class="form-pair"><label>Modloader<select name="loader" id="mc-instance-loader"><option value="horizon" ${a.loader==='horizon'?'selected':''}>Horizon (Rust)</option><option value="vanilla" ${(a.loader||'vanilla')==='vanilla'?'selected':''}>Minecraft Vanilla</option><option value="fabric" ${a.loader==='fabric'?'selected':''}>Fabric</option></select></label><label id="fabric-version-field" class="${a.loader==='fabric'?'':'hidden'}">Versión de Fabric Loader<input list="mc-fabric-catalog" id="fabric-loader-version" name="loader_version" value="${attr(a.loader_version||'')}" placeholder="Versión estable"/><datalist id="mc-fabric-catalog">${fabricLoaders.map(v=>`<option value="${attr(v)}"></option>`).join('')}</datalist></label></div>
 <section id="vis-horizon-fields" class="vis-horizon-fields ${a.engine==='horizon'?'':'hidden'}"><div class="vis-smart-tip">${I('info',17)} Elegí la carpeta de tu instancia. VIS descarga y prepara los recursos de Minecraft 26.3; después podés abrir el juego con <b>Jugar</b>. La primera preparación puede tardar varios minutos. Requiere una copia legítima de Minecraft Java.</div>
 <details><summary>Opciones avanzadas de Horizon</summary><label>Motor Horizon<div class="folder-row"><input id="horizon-build-dir" name="horizon_build_dir" value="${attr(a.horizon_build_dir||'vis:source')}" placeholder="vis:source (descargar desde el fork)"/><button type="button" data-action="use-horizon-source" title="Descarga automática cuando instales el proyecto">${I('check',18)}</button></div></label><div class="vis-horizon-download-options"><button type="button" class="primary-btn" data-action="use-horizon-source">${I('download',16)} Descargar Horizon al instalar</button><button type="button" class="outline-btn vis-horizon-find" data-action="detect-horizon-build">${I('search',16)} Builds anteriores (opcional)</button></div><div id="vis-horizon-library" class="vis-horizon-library" role="region" aria-label="Builds antiguos de Horizon" aria-live="polite" hidden></div><p class="vis-horizon-download-note">VIS descarga la versión portable del motor desde el fork horizon-VISNEXO para tu sistema. El motor se instala dentro de esta instancia, sin Horizon Launcher ni compiladores. Minecraft 26.3 y sus recursos oficiales se descargan por separado desde Mojang para una cuenta propietaria.</p>
 <label>Carpeta Minecraft Java 26.3 instalada<div class="folder-row"><input id="horizon-minecraft-dir" name="horizon_minecraft_dir" value="${attr(a.horizon_minecraft_dir||'')}" placeholder=".../.minecraft"/><button type="button" data-action="pick-horizon-minecraft">${I('folder',18)}</button></div></label>
 <label>Server JAR oficial 26.3<div class="folder-row"><input id="horizon-server-jar" name="horizon_server_jar" value="${attr(a.horizon_server_jar||'')}" placeholder=".../server.jar"/><button type="button" data-action="pick-horizon-server">${I('folder',18)}</button></div></label>
 </details><p class="form-notice">Instalar descarga el motor Rust del fork y prepara Minecraft 26.3 dentro de esta carpeta. Jugar abre Horizon directamente; con una sesión Microsoft válida puede utilizar la identidad premium.</p></section>
 <label>${a.game_dir?'Carpeta actual de esta instancia':'Carpeta biblioteca (VIS creará Instancias/nombre)'}<div class="folder-row"><input id="instance-folder-path" name="game_dir" required value="${attr(a.game_dir||'')}" placeholder="Seleccioná la carpeta base, por ejemplo SSD2/Juegos"/><button type="button" data-action="pick-folder" title="Elegir carpeta">${I('folder',20)}</button><button type="button" class="outline-btn" data-action="check-instance-destination" title="Comprobar que toda la instalación se guardará dentro de esta carpeta">${I('shield',15)} Verificar</button></div><div id="instance-destination-report" role="status" aria-live="polite" class="instance-destination-report"></div></label><details class="instance-layout-hint"><summary>${I('folder',15)} Ver carpetas que VIS instalará</summary><code>Mi instancia/.vis/runtime/versions/</code><code>Mi instancia/.vis/runtime/libraries/</code><code>Mi instancia/.vis/runtime/assets/</code><code>Mi instancia/.vis/java-runtimes/</code><code>Mi instancia/mods/ y saves/</code><small>Horizon también integra .vis/horizon-engine y .vis/minecraft-base. Nunca escribe en .minecraft global.</small></details><label>Instalación existente para reutilizar (opcional)<div class="folder-row"><input id="instance-reuse-path" name="reuse_source" value="${attr(a.reuse_source||'')}" placeholder="Detección automática si está vacío"/><button type="button" data-action="pick-reuse-folder" title="Elegir carpeta de origen sin modificarla">${I('folder',20)}</button></div><small class="muted">VIS examina carpetas conocidas de Minecraft y otras instancias. Esta ruta adicional solo se lee; nunca se sobrescribe.</small></label>
 <label>Nick dentro de Minecraft (máximo 16 caracteres)<input name="player_name" maxlength="16" pattern="[A-Za-z0-9_]{3,16}" value="${attr(a.player_name||'')}" placeholder="Por defecto, usuario local"/></label><input type="hidden" name="java_path" value="${attr(a.java_path||'')}"/><p class="muted">VIS instala un Java privado dentro de la instancia.</p>
 <p class="form-notice">${I('users',16)} Los archivos del motor se instalan una sola vez. Podés compartir los mundos y los servidores guardados de esta instancia con las distintas cuentas VIS, sin compartir sus sesiones Microsoft.</p>
 <label class="toggle-line large"><span><b>Compartir los datos de esta instancia entre cuentas</b><small>Recomendado: mismos mundos, servidores, presentación inicial, resource packs y ajustes al cambiar de usuario. Desmarcalo si querés datos de juego separados.</small></span><input type="checkbox" name="share_game_data" ${a.share_game_data!==false?'checked':''}/></label>
 <label class="toggle-line large"><span><b>Protección: copia automática al iniciar</b><small>Opcional. Si hay mundos o ajustes guardados, crea como máximo una copia cada 24 horas y conserva las últimas tres. Se realiza antes de iniciar Java/Horizon y puede tardar con mundos grandes. Nunca borra las copias manuales; si falla, VIS detiene ese inicio.</small></span><input type="checkbox" name="auto_backup" ${a.auto_backup?'checked':''}/></label>
 <label class="toggle-line large"><span><b>Pantalla completa</b><small>Se aplica al iniciar Minecraft Java.</small></span><input type="checkbox" name="fullscreen" ${a.fullscreen?'checked':''}/></label><p class="form-notice">${I('info',16)} VIS Smart Install busca copias locales verificadas (otras instancias y launchers conocidos), y solo descarga de Mojang/Fabric lo que falta. Minecraft, Java, el motor Rust, los recursos y los registros se guardan dentro de la carpeta de la instancia. Si falta Java, usamos Temurin verificado con SHA-256. Las cuentas locales solo permiten jugar sin autenticación oficial. Las cuentas Premium usan la sesión Microsoft verificada.</p></form>
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
 <label>Carpeta biblioteca (VIS creará Instancias/nombre)<div class="folder-row"><input name="game_dir" id="vis-project-install-folder" value="${attr(folder)}" placeholder="Elegí una carpeta base, por ejemplo SSD2/Juegos" required/><button type="button" data-action="pick-project-folder" title="Elegir carpeta">${I('folder',19)}</button></div></label>
 <label>Memoria RAM (MB)<input name="ram_mb" type="number" min="1024" max="32768" step="256" value="${Number(ram)||4096}" required/></label>
 <p class="muted">Las instalaciones compartidas aparecen en todos los perfiles locales compatibles. Los mundos se mantienen separados. Minecraft Rust funciona en modo local; se requiere una copia legítima de Minecraft Java. Microsoft Premium ya está integrado para Minecraft Java y Horizon.</p></form>
 <footer class="modal-footer"><button type="button" class="subtle-btn" data-action="close-modal">Cancelar</button><button type="button" class="primary-btn" data-action="confirm-project-install">${I('play',17)} Crear, instalar y jugar</button></footer></div></div>`;
}
async function projectPlay(projectId){
 const p=db.projects.find(p=>p.id===projectId);if(!p)return;
 if(projectCommunityId===projectId&&projectCommunity?.play_access==='members'&&!projectCommunity.can_play)
   return message('Este proyecto requiere una invitación o autorización para jugar.',true);
 if(!isExecutionEnabled(p))return message('VIS STUDIOS todavía no habilitó este proyecto.',true);
 const match=db.instances.find(i=>compatibleProjectInstance(i,p)&&(!isGuest()?!i.source_owner:true))||db.instances.find(i=>compatibleProjectInstance(i,p));
 if(match){await performLaunch(projectId,match.name,match.source_owner||'');return;}
 if(isGuest())return message('No hay una instalación compartida de este proyecto. Iniciá sesión para instalarla.',true);
 dialog={type:'project-install',projectId};render();
}
async function projectInstallAndPlay(){
 const form=document.querySelector('#vis-project-install-form');if(!(form instanceof HTMLFormElement)||!form.reportValidity())return;
 const data=new FormData(form);const projectId=dialog?.projectId;
 if(projectCommunityId===projectId&&projectCommunity?.play_access==='members'&&!projectCommunity.can_play)
   return message('Todavía no tenés autorización para jugar en este proyecto.',true);
 let gameDir=String(data.get('game_dir')||'').trim();const ramMb=Number(data.get('ram_mb'));
 try {
   const selectedProject=db.projects.find(p=>p.id===projectId);
   const already=db.instances.find(i=>selectedProject&&compatibleProjectInstance(i,selectedProject)&&!i.source_owner);
   if(!already)gameDir=await command('suggest_instance_directory',{library:gameDir,name:selectedProject?.title||projectId});
   db=await command('ensure_project_instance',{projectId,gameDir,ramMb});dialog=null;render();
   const ins=db.instances.find(i=>i.project_id===projectId&&!i.source_owner);
   if(!ins)throw Error('No se pudo registrar la instancia');
   if(!ins.installed)await performInstall(ins.project_id,ins.name);
   const ready=db.instances.find(i=>i.project_id===projectId&&i.name===ins.name&&!i.source_owner);
   if(ready?.installed)await performLaunch(projectId,ready.name);
 }catch(e){message('No se pudo instalar el proyecto: '+String(e),true)}
}
function sharedRamDialog(){const i=db.instances.find(i=>i.project_id===dialog?.projectId&&i.name===dialog?.name&&i.source_owner===dialog?.sourceOwner);return `<div class="modal-backdrop" data-action="modal-backdrop"><div class="dialog modal-small" role="dialog" aria-modal="true" aria-label="RAM de instancia compartida"><header class="modal-head"><h2>RAM de ${esc(i?.name||'Instancia')}</h2><button class="icon-btn" data-action="close-modal">${I('x',17)}</button></header><form id="shared-ram-form" class="modal-body"><label>Memoria RAM (MB)<input name="ram_mb" type="number" min="1024" max="32768" step="256" value="${Number(i?.ram_mb)||4096}" required/></label><p class="muted">Este ajuste de RAM es exclusivo de tu perfil VIS. Los mundos y servidores siguen la política compartida de esta instancia.</p></form><footer class="modal-footer"><button type="button" class="subtle-btn" data-action="close-modal">Cancelar</button><button type="button" class="primary-btn" data-action="save-shared-ram">Guardar RAM</button></footer></div></div>`;}
function confirmDialog(){return `<div class="modal-backdrop" data-action="modal-backdrop"><div class="dialog modal-small" role="alertdialog" aria-modal="true"><header class="modal-head"><h2>Confirmar eliminación</h2><button class="icon-btn" data-action="close-modal">${I('x',18)}</button></header><div class="modal-body"><p>¿Querés quitar <strong>${esc(dialog.label)}</strong> de VIS Nexo? Por defecto <b>se conservan todos los mundos y archivos del disco</b>.</p>
 ${dialog.kind==='instance'?`<label class="toggle-line large"><span><b>Borrar también los archivos del disco</b><small>Irreversible. Disponible solo para instalaciones administradas por VIS en Instancias/&lt;nombre&gt;. Cerrá el juego antes.</small></span><input type="checkbox" id="delete-instance-files"></label>`:''}</div><footer class="modal-footer"><button class="subtle-btn" data-action="close-modal">Cancelar</button><button class="danger-btn" data-action="confirm-delete">${I('trash',17)} Quitar de VIS</button></footer></div></div>`;}

function instanceWorldCloudSection(d){
 if(d.sourceOwner)return '<section><h3>'+I('cloud',17)+' Nube</h3><p class="muted">Las copias de nube se vinculan desde la cuenta propietaria de la instancia.</p></section>';
 const worlds=d.worldCloud||[];
 const labels={grey:'Sin vincular',green:'Guardada en carpeta',orange:'Actualización pendiente',red:'Error'};
 return '<section class="vis-cloud-worlds"><h3>'+I('cloud',17)+' Nube · mundos</h3>'+
 '<p class="muted">Elegí una carpeta de OneDrive, Google Drive, Dropbox o Nextcloud que ya sincronices con su aplicación oficial. VIS guarda copias ZIP por mundo; el verde comprueba la copia LOCAL, no que la nube haya confirmado la subida. No se guardan contraseñas ni tokens.</p>'+
 '<label>Carpeta gestionada por <select id="vis-world-provider"><option value="onedrive">OneDrive</option><option value="google_drive">Google Drive</option><option value="dropbox">Dropbox</option><option value="nextcloud">Nextcloud</option><option value="other">Otra carpeta sincronizada</option></select></label>'+
 (worlds.length?worlds.map(w=>
 '<div class="vis-cloud-world-row"><div class="vis-cloud-world-info"><b>'+esc(w.world)+'</b>'+
 '<span class="vis-world-cloud-state is-'+attr(w.status)+'"><i aria-hidden="true"></i>'+esc(labels[w.status]||'Error')+'</span>'+
 '<small>'+esc(w.detail||'')+'</small></div><div class="vis-data-actions">'+
 '<button class="outline-btn" type="button" data-action="world-cloud-link" data-world="'+attr(w.world)+'">'+I('folder',14)+' Vincular</button>'+
 (w.status!=='grey'?'<button class="outline-btn" type="button" data-action="world-cloud-save" data-world="'+attr(w.world)+'">'+I('cloud',14)+' Nube</button>':'')+
 (w.status!=='grey'?'<button class="outline-btn" type="button" data-action="world-cloud-unlink" data-world="'+attr(w.world)+'">Desvincular</button>':'')+
 (w.status==='green'||w.status==='orange'?'<button class="outline-btn" type="button" data-action="world-cloud-restore" data-world="'+attr(w.world)+'">Restaurar copia</button>':'')+
 '</div></div>').join(''):'<p class="muted">Todavía no se detectaron mundos con level.dat en esta instancia.</p>')+
 '</section>';
}

function instanceDataDialog(){
 const d=dialog||{},backups=d.backups||[],health=d.health;
 const foreign=!!d.sourceOwner;
 const canRestore=!foreign;
 const backupChoices=backups.map(b=>'<option value="'+attr(b.name)+'">'+
   esc(b.name)+' · '+fmtBytes(b.bytes)+'</option>').join('');
 const issues=(health?.issues||[]).map(it=>'<li class="vis-data-issue">'+
   '<strong>'+esc(it.code)+'</strong> '+esc(it.detail)+'</li>').join('');
 const merge=d.merge||null;
 return '<div class="modal-backdrop" data-action="modal-backdrop">'+
 '<div class="dialog modal-medium vis-data-dialog" role="dialog" aria-modal="true" aria-label="Datos de la instancia">'+
 '<header class="modal-head"><div><span class="page-eyebrow">VIS / CENTRO DE INSTANCIAS</span>'+
 '<h2>Datos de '+esc(d.name||'Minecraft')+'</h2>'+
 '<small>'+(foreign?'Instancia instalada por '+esc(d.sourceOwner):'Instancia propia')+'</small></div>'+
 '<button class="icon-btn" data-action="close-modal" aria-label="Cerrar">'+I('x',18)+'</button></header>'+
 '<div class="modal-body vis-data-grid">'+
 '<section><h3>'+I('database',17)+' Copias de seguridad</h3>'+
 '<p class="muted">Resguarda mundos, servidores, packs, mods y ajustes. No guarda tokens VIS/Microsoft, pero algunos mods podrían tener credenciales en config; mantené privadas las copias.</p>'+
 '<button class="outline-btn" data-action="instance-data-backup">'+I('save',15)+' Crear copia</button>'+
 '<p class="muted">Copias disponibles: '+backups.length+' (automáticas: '+backups.filter(b=>b.name?.startsWith('vis-data-auto-')).length+')</p>'+
 (canRestore?'<div class="profile-quick-actions"><span>Protección antes de jugar: <b>'+(d.autoBackup?'Activa':'Desactivada')+'</b></span>'+
    '<button class="outline-btn" data-action="instance-data-toggle-auto-backup">'+
      (d.autoBackup?'Desactivar copias diarias':'Activar copias diarias')+'</button></div>':
    '<p class="muted">La política de copias automáticas la administra el propietario.</p>')+
 (backups.length?
  '<label>Elegir copia<select id="instance-data-backup-select">'+backupChoices+'</select></label>':
  '<p class="muted">Todavía no hay copias de esta instancia.</p>')+
 (canRestore&&backups.length?
   '<label class="toggle-line"><span><b>Reemplazar archivos existentes</b><small>Los originales reemplazados quedan guardados para recuperación.</small></span>'+
   '<input type="checkbox" id="instance-data-replace"/></label>'+
   '<label>Escribí RESTAURAR<input id="instance-data-restore-word" type="text" autocomplete="off" placeholder="RESTAURAR"/></label>'+
   '<button class="outline-btn" data-action="instance-data-restore">'+I('refresh',15)+' Restaurar copia</button>':
   foreign?'<p class="muted">La restauración de esta instancia corresponde a su propietario.</p>':'')+
 '</section>'+instanceWorldCloudSection(d)+
 '<section><h3>'+I('shield',17)+' Diagnóstico</h3>'+
 (health?'<p>Mundos detectados: <strong>'+Number(health.worlds||0)+'</strong> · Mundos válidos: <strong>'+Number(health.valid_worlds||0)+'</strong></p>'+
 '<p>Servidores guardados: '+(health.servers_file?'Sí':'Sin lista')+
 ' · Resource packs: '+Number(health.resource_packs||0)+'</p>'+
 '<p class="muted">Problemas corregibles: '+Number(health.repairable||0)+'</p>'+
 '<p>Reportes de caída: '+Number(health.crash_reports||0)+'</p>'+
 (health.last_error_hint?'<p class="muted">'+esc(health.last_error_hint)+'</p>':'')+
 (issues?'<ul class="vis-data-issues">'+issues+'</ul>':'<p class="muted">No se detectaron problemas de estructura.</p>'):
 '<p class="muted">Sin analizar.</p>')+
 '<div class="vis-data-actions"><button class="outline-btn" data-action="instance-data-audit">'+I('search',15)+' Volver a analizar</button>'+
 (canRestore?'<button class="outline-btn" data-action="instance-data-repair">'+I('check',15)+' Crear carpetas faltantes</button>':'')+
 '<button class="outline-btn" data-action="instance-data-open-logs">'+I('folder',15)+' Abrir logs</button>'+
 '</div></section>'+
 (foreign?'<section><h3>'+I('users',17)+' Servidores de perfiles anteriores</h3>'+
 '<p class="muted">Fusiona las entradas de servidores.dat por dirección sin sobrescribir tus servidores existentes.</p>'+
 '<button class="outline-btn" data-action="instance-data-servers-preview">'+I('search',15)+' Buscar servidores anteriores</button>'+
 (merge?'<p>Servidores actuales: '+merge.current+' · Antiguos: '+merge.legacy+
 ' · Nuevos: <b>'+merge.additions+'</b> · Duplicados: '+merge.duplicates+'</p>'+
 (merge.additions?'<button class="outline-btn" data-action="instance-data-servers-merge">'+I('check',15)+' Incorporar '+merge.additions+' servidores</button>':''):'')+
 '</section>':'')+'</div>'+
 '<footer class="modal-footer"><button class="subtle-btn" data-action="close-modal">Cerrar</button></footer>'+
 '</div></div>';
}
async function openInstanceData(projectId,name,sourceOwner){
 if(!native||isGuest())return message('Iniciá sesión VIS para administrar datos de instancias.',true);
 const generation=accountGeneration;
 await onceOperation('instance-data-open:'+JSON.stringify([projectId,name,sourceOwner]),async()=>{
  try{
    const params={projectId,name,sourceOwner:sourceOwner||null};
    const [backups,health,worldCloud]=await Promise.all([
       command('instance_backups',params),command('inspect_instance_data',params),
       sourceOwner?Promise.resolve([]):command('world_cloud_status',{projectId,name})
    ]);
    if(generation!==accountGeneration)return;
    dialog={type:'instance-data',projectId,name,sourceOwner:sourceOwner||'',backups,health,worldCloud,merge:null,
      autoBackup:!sourceOwner&&!!db.instances.find(i=>!i.source_owner&&i.project_id===projectId&&i.name===name)?.auto_backup};
    render();
  }catch(error){if(generation===accountGeneration)message('No se pudieron consultar los datos: '+String(error),true);}
 });
}
async function runInstanceDataAction(kind){
 if(dialog?.type!=='instance-data')return;
 const d=dialog,generation=accountGeneration;
 const params={projectId:d.projectId,name:d.name,sourceOwner:d.sourceOwner||null};
 return onceOperation('instance-data-'+kind+':'+JSON.stringify(params),async()=>{
 try{
   if(kind==='backup'){
     const info=await command('backup_instance_data',params);
     message('Copia guardada: '+info.name+' ('+fmtBytes(info.bytes)+')');
   }else if(kind==='restore'){
     const backupName=document.querySelector('#instance-data-backup-select')?.value||'';
     const confirmation=document.querySelector('#instance-data-restore-word')?.value||'';
     const replace=document.querySelector('#instance-data-replace')?.checked===true;
     if(confirmation!=='RESTAURAR')return message('Escribí exactamente RESTAURAR para continuar.',true);
     if(replace&&!window.confirm('Se reemplazarán archivos existentes. VIS conservará una copia de los originales. ¿Continuar?'))return;
     const result=await command('restore_instance_data',{...params,backupName,replace,confirmation});
     message('Restaurados: '+result.restored+' · Conservados: '+result.preserved+
       (result.safety_copy?' · Resguardo: '+result.safety_copy:''));
   }else if(kind==='repair'){
     if(!window.confirm('Se crearán solamente carpetas faltantes. No se borrarán archivos. ¿Continuar?'))return;
     d.health=await command('repair_instance_data',params);
     message('Carpetas faltantes reparadas. No se modificaron mundos.');
   }else if(kind==='audit'){
     d.health=await command('inspect_instance_data',params);
   }else if(kind==='servers-preview'){
     d.merge=await command('merge_shared_servers',{projectId:d.projectId,name:d.name,
       sourceOwner:d.sourceOwner,apply:false});
   }else if(kind==='servers-merge'){
     if(!d.merge?.additions)return;
     if(!window.confirm('Incorporar '+d.merge.additions+' servidores y conservar una copia del servers.dat original?'))return;
     const result=await command('merge_shared_servers',{projectId:d.projectId,name:d.name,
       sourceOwner:d.sourceOwner,apply:true});
     message('Servidores incorporados: '+result.additions+
       (result.backup?' · Original preservado':''));
     d.merge=result;
   }
   if(generation!==accountGeneration||dialog!==d)return;
   if(['backup','restore'].includes(kind)){
      [d.backups,d.health]=await Promise.all([
       command('instance_backups',params),command('inspect_instance_data',params)]);
   }
   if(generation===accountGeneration&&dialog===d)render();
 }catch(error){if(generation===accountGeneration)message('Operación interrumpida: '+String(error),true);}
 });
}
function dialogView(){return dialog?.type==='instance-data'?instanceDataDialog():dialog?.type==='bulk-instance-delete'?bulkInstanceDeleteDialog():dialog?.type==='edit-profile'?editProfileDialog():dialog?.type==='vis-skin'?visSkinDialog():dialog?.type==='project'?projectWizard():dialog?.type==='quick-post'?quickPublishDialog():dialog?.type==='crop'?cropDialog():dialog?.type==='avatar'?avatarDialog():dialog?.type==='instance'?instanceDialog():dialog?.type==='project-install'?projectInstallDialog():dialog?.type==='shared-ram'?sharedRamDialog():confirmDialog();}
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
 const old=previousView;
 const next=viewSnapshot();
 const currentMain=root.querySelector('#main-scroll');
 const currentChat=root.querySelector('.chat-messages');
 const keepScroll=old&&old.screen===next.screen;
 const mainScrollTop=keepScroll?currentMain?.scrollTop:0;
 const chatScrollTop=currentChat?.scrollTop||0;
 const composeField=root.querySelector('#message-form [name="body"]');
 const composeDraft=composeField?.value;
 const restoreComposeFocus=document.activeElement===composeField;
 const composeCaret=restoreComposeFocus?composeField.selectionStart:null;
 const wasAtBottom=currentChat?currentChat.scrollHeight-currentChat.scrollTop-currentChat.clientHeight<30:true;
 document.title=`VIS Nexo${db.user?` · ${displayAccount(db.user.username)}`:''}`;
 document.body.classList.toggle('reduce-motion',!!prefs.reducedMotion);
 root.innerHTML=db.user?shell():loginView();
 if(composeDraft!=null&&next.chatWith===old?.chatWith){
   const input=root.querySelector('#message-form [name="body"]');
   if(input){
     input.value=composeDraft;
     if(restoreComposeFocus){
       input.focus({preventScroll:true});
       if(composeCaret!=null)input.setSelectionRange(composeCaret,composeCaret);
     }
   }
 }
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
 if(to==='profile'&&microsoftGamertag&&!premiumCosmetics)void loadPremiumCosmetics();
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
   if(to==='project'&&native&&db.user)void refreshAssets().catch(()=>{});
   if(to==='project'&&social.connected())void loadProjectCommunity(id||selectedId);
   root.querySelector('#main-scroll')?.scrollTo(0,0);
 },{reducedMotion:prefs.reducedMotion});
}
async function chooseAsset(kind,field='',projectId='',forceOfficialSkin=false) {
 try {
   if(native){
     const premiumSkin=kind==='skin'&&!!microsoftGamertag;
     const editor=dialog?.type==='edit-profile';
     const opt=document.getElementById(editor?'premium-edit-auto-skin':'premium-auto-skin');
     const selectedModel=document.getElementById(forceOfficialSkin?'premium-skin-model':editor?'premium-edit-model':'premium-local-model');
     const syncOfficial=premiumSkin&&(forceOfficialSkin||(opt?.checked??premiumSkinSync));
     const variant=(selectedModel?.value||premiumSkinModel)==='slim'?'slim':'classic';
     const generation=accountGeneration,owner=db.user?.username;
     const path=await T.dialog.open({multiple:false,directory:false,
       title:kind==='skin'?'Seleccionar skin PNG':'Seleccionar imagen',
       filters:kind==='skin'?[{name:'Skin PNG',extensions:['png']}]:
          [{name:'Imágenes (PNG, JPG, WebP)',extensions:['png','jpg','jpeg','webp']}]});
     if(!path)return;
     if(accountGeneration!==generation||db.user?.username!==owner)
       return message('Cambió la cuenta activa: seleccioná nuevamente el archivo.',true);
     const personal=['avatar','profile_banner'].includes(kind);
     const result=await command('import_asset',{path,kind,projectId:projectId||null,stageOnly:personal});
     assetCache[result.path]=result.data_url;
     if(wizard&&field)wizard[field]=result.path;
     if(personal){openPersonalCrop(kind,result.path);return;}
     if(['skin','cape','avatar_layer','home','login','launcher_logo'].includes(kind)) db=await command('get_state');
     render();
     if(kind==='skin'){
       if(syncOfficial){
         if(premiumCosmeticsBusy){
           message('La skin quedó guardada en VIS. Terminá la otra operación Premium y volvé a publicarla.',true);
         }else{
           premiumCosmeticsBusy=true;render();
           let uploaded=false;
           try{
             const next=await command('microsoft_upload_skin',{path,variant});
             if(accountGeneration===generation&&db.user?.username===owner){
               premiumCosmetics={...next,history:next.history||premiumCosmetics?.history||[]};
               uploaded=true;
               message('Skin guardada en VIS y publicada en tu Minecraft Java Premium.');
             }
           }catch(error){
             if(accountGeneration===generation)
               message('Skin guardada en VIS, pero Minecraft oficial rechazó la subida: '+String(error),true);
           }finally{
             premiumCosmeticsBusy=false;
             if(accountGeneration===generation){
               render();
               if(uploaded)void loadPremiumCosmetics();
             }
           }
         }
       }else{
         message('Skin PNG guardada en VIS Nexo sin modificar Minecraft oficial.');
       }
       if(accountGeneration===generation&&db.user?.username===owner){
         if(social.connected())void publishLocalSkin(result.data_url);
         else if(!syncOfficial)message('Conectá VIS Social y usá «Compartir skin VIS» para publicarla.');
       }
     }else message('Recurso importado correctamente.');
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
function acceptWizardInput(){if(!wizard)return;document.querySelectorAll('input[data-field],select[data-field],textarea[data-field]').forEach(el=>{const key=el.dataset.field;if(key==='versions_csv')wizard.versions=el.value.split(',').map(s=>s.trim()).filter(Boolean).slice(0,30);else wizard[key]=el.type==='checkbox'?el.checked:el.value;});document.querySelectorAll('[data-visible]').forEach(el=>{wizard.visible_sections ||= {};wizard.visible_sections[el.dataset.visible]=el.checked;});if(wizard.engine==='horizon'){wizard.mc_version='26.3';wizard.loader='horizon';wizard.loader_version='';}else if(wizard.loader==='vanilla'){wizard.loader_version='';}}
function validateStep(){
 if(wizardStep===0){
   if(!wizard.title?.trim()){message('Poné un nombre al proyecto.',true);return false;}
   if(wizard.title.length>80){message('El nombre es demasiado largo.',true);return false;}
   if(wizard.modrinth_mods?.length && !(wizard.engine==='java'&&wizard.loader==='fabric')){message('Los mods requieren Java con Fabric. Quitalos antes de cambiar a Vanilla/Horizon.',true);return false;}
 }
 return true;
}
root.addEventListener('input',event=>{
 const el=event.target;
 if(el?.id==='crop-zoom'&&cropState){cropState.zoom=Number(el.value);const output=document.querySelector('#crop-zoom-value');if(output)output.textContent=`${Math.round(cropState.zoom*100)}%`;paintCrop();return;}
 if(el?.id==='vis-project-engine'&&wizard){acceptWizardInput();wizard.engine=el.value;if(el.value==='horizon'){wizard.mc_version='26.3';wizard.loader='horizon';wizard.loader_version='';}else if(wizard.loader==='horizon'){wizard.loader='vanilla';}render();return;}
 if(el?.id==='vis-project-loader'&&wizard){acceptWizardInput();wizard.loader=el.value;render();if(el.value==='fabric')void loadFabricLoaders(wizard.mc_version);return;}
 if(el?.dataset?.field==='mc_version'&&wizard?.loader==='fabric')void loadFabricLoaders(el.value);
 if(el?.id==='mc-instance-version'){syncVersionSuggestions();return;}
 if(el?.id==='catalog-search'){query=el.value;document.querySelectorAll('.portal-game-card').forEach(card=>{const p=db.projects.find(p=>p.id===card.dataset.id);card.hidden=!p||!`${p.title} ${p.subtitle}`.toLowerCase().includes(query.toLowerCase());});return;}
 if(wizard&&el?.dataset?.field){const field=el.dataset.field;if(field==='title'){document.querySelectorAll('[data-live-title],[data-live-name]').forEach(n=>n.textContent=el.value||'Tu proyecto');}if(field==='subtitle'){document.querySelectorAll('[data-live-subtitle]').forEach(n=>n.textContent=el.value||'Tu descripción aparecerá aquí.');}if(field==='mc_version'){document.querySelectorAll('.wizard-live-kicker').forEach(n=>n.textContent=el.value||'MINECRAFT');}}if(wizard&&el instanceof HTMLElement&&el.matches('[data-field]')){
  if(el.dataset.field==='versions_csv')wizard.versions=el.value.split(',').map(s=>s.trim()).filter(Boolean).slice(0,30);else wizard[el.dataset.field]=el.type==='checkbox'?el.checked:el.value;
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
 if(el?.id==='social-presence'){
  const presence=el.value;
  await apply('update_presence',{presence});
  if(social.connected()){
    try{await social.setPresence(presence);stateEditorOpen=false;}
    catch(e){message(String(e),true);}
  }
 }
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
root.addEventListener('input',e=>{if(e.target?.id==='friend-filter'){friendFilter=e.target.value;document.querySelectorAll('.friend-item').forEach(item=>{item.hidden=!(item.dataset.id+' '+item.textContent).toLowerCase().includes(friendFilter.toLowerCase());});}});
root.addEventListener('submit',async event=>{
 const form=event.target;
 if(!(form instanceof HTMLFormElement))return;
 event.preventDefault();const formData=new FormData(form);
 if(form.id==='auth-form'){
  if(authBusy)return;
  const username=String(formData.get('username')||''),password=String(formData.get('password')||'');
  authBusy=true;
  try {
   const cloud=authMode!=='offline'&&authProvider==='cloud'&&native;
   if(cloud){
     if(authMode==='register')db=await command('social_cloud_register',{
       username,password,confirm:String(formData.get('confirm')||'')});
     else db=await command('social_cloud_login',{identifier:username,password});
   } else {
     db=authMode==='offline'?await command('login_offline',{nickname:String(formData.get('nickname')||'')}):
       await command(authMode==='register'?'register':'login',
         authMode==='register'?{username,password,confirm:String(formData.get('confirm')||'')}:{username,password});
   }
   resetAccountView();page='home';render();void refreshAssets().catch(()=>{});message(`Sesión iniciada · ${db.user?.username}`);
   if(native&&db.mode!=='offline')void connectSocial(cloud);
  }catch(e){message(String(e),true)}finally{authBusy=false;}
  return;
 }
 if(form.id==='modrinth-search-form'){await performModSearch(formData);return;}
 if(form.id==='quick-publish-form'){await saveQuickPublish(form);return;}
 if(form.id==='friend-form'){
  const username=String(formData.get('username')||'').trim().replace(/^@/,'').toLowerCase();
  if(!username)return;
  if(!social.connected()){message('VIS Social sin conexión: solicitud no enviada.',true);return;}
  try {await social.friendRequest(username);message('Solicitud enviada a '+username);}
  catch(e){message(String(e),true);}
  return;
 }
 if(form.id==='message-form'){
  const body=String(formData.get('body')||'');
  if(!body||!chatWith)return;
  if(!social.connected()){message('VIS Social sin conexión: mensaje no enviado.',true);return;}
  try {await social.sendMessage(chatWith,body);}
  catch(e){message(String(e),true);}
  return;
 }
 if(form.id==='cloud-catalog-form'){try{await command('configure_cloud_catalog',{url:String(formData.get('url')||'').trim()});message('Catálogo configurado');await refreshCloudCatalog();}catch(e){message(String(e),true);}return;}
 if(form.id==='team-publish-form'){
   if(!native||!isAdmin())return;
   const value=String(formData.get('instance')||'');
   let ids;try{ids=JSON.parse(value);}catch{ids=null;}
   if(!Array.isArray(ids)||ids.length!==2||ids.some(x=>typeof x!=='string'||!x))
     return message('Seleccioná una instancia del proyecto.',true);
   const [projectId,name]=ids;
   const options={include_packs:formData.has('include_packs'),
     include_servers:formData.has('include_servers'),include_waypoints:formData.has('include_waypoints')};
   const signature=JSON.stringify([projectId,name,options]);
   const action=event.submitter?.dataset.teamAction||'preview';
   await onceOperation('team:'+action+':'+signature,async()=>{
     try{
       if(action==='preview'){
         const report=await command('preview_team_project',{projectId,name,options});
         teamReview={signature,report};
         const panel=document.getElementById('vis-team-review');
         if(panel)panel.innerHTML='<p><b>'+report.files.length+' archivo(s), '+
           fmtBytes(report.total_bytes)+'</b></p>'+
           '<p>'+report.warnings.map(esc).join(' ')+'</p>'+
           (report.excluded?.length?'<p>Excluidos: '+report.excluded.slice(0,12).map(esc).join(', ')+'</p>':'')+
           '<details><summary>Revisar rutas del ZIP</summary>'+
           report.files.slice(0,100).map(f=>'<div>'+esc(f)+'</div>').join('')+
           (report.files.length>100?'<div>… y más archivos</div>':'')+'</details>';
         message('Vista previa disponible. Revisá la lista antes de publicar.');
         return;
       }
       if(action!=='publish')return;
       if(!teamReview||teamReview.signature!==signature)
         return message('Cambió la selección; primero revisá los archivos.',true);
       const token=String(formData.get('token')||'');
       if(token.length<32)return message('Ingresá la credencial de publicación VIS Universe.',true);
       if(!window.confirm('¿Publicar '+teamReview.report.files.length+
         ' archivos de '+projectId+' en R2? Quedarán disponibles para los usuarios del catálogo.'))return;
       const pack=await command('publish_team_project',{
         projectId,name,options,reviewSha256:teamReview.report.review_sha256,token});
       teamReview=null;form.reset();
       const panel=document.getElementById('vis-team-review');
       if(panel)panel.textContent='Publicado · '+pack.files+' archivos · '+
         fmtBytes(pack.size_bytes)+' · SHA-256 '+pack.sha256.slice(0,16)+'…';
       message('Paquete de equipo y catálogo publicados.');
       void refreshCloudCatalog(true);
     }catch(error){message('VIS Team: '+String(error),true);}
   });
   return;
 }
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
 const instance={name:String(data.get('name')||'').trim(),engine:String(data.get('engine')||'java'),share_offline:data.has('share_offline'),share_game_data:data.has('share_game_data'),auto_backup:data.has('auto_backup'),horizon_build_dir:String(data.get('horizon_build_dir')||''),horizon_minecraft_dir:String(data.get('horizon_minecraft_dir')||''),horizon_server_jar:String(data.get('horizon_server_jar')||''),loader:String(data.get('loader')||'vanilla'),loader_version:String(data.get('loader_version')||''),java_path:String(data.get('java_path')||''),player_name:String(data.get('player_name')||''),project_id:String(data.get('project_id')||''),version:String(data.get('version')||''),game_dir:String(data.get('game_dir')||''),reuse_source:String(data.get('reuse_source')||''),ram_mb:Number(data.get('ram_mb')||4096),fullscreen:data.has('fullscreen'),installed:false};
 if(instance.engine==='horizon'){instance.loader='horizon';instance.loader_version='';instance.version='26.3';instance.share_offline=false;}
 const isExisting=db.instances.some(i=>!i.source_owner&&i.project_id===instance.project_id&&i.name===instance.name);
 if(!isExisting){
   try{instance.game_dir=await command('suggest_instance_directory',{library:instance.game_dir,name:instance.name});}
   catch(error){message('No se pudo preparar la carpeta de instancia: '+String(error),true);return;}
 }
 const ok=await apply('save_instance',{instance},'Instancia guardada en '+instance.game_dir);if(ok){dialog=null;render();if(installAndPlay){await performInstall(instance.project_id,instance.name);const actual=db.instances.find(x=>x.project_id===instance.project_id&&x.name===instance.name);if(actual?.installed){await performLaunch(instance.project_id,instance.name);}}}
}
root.addEventListener('click',async event=>{
 if(!(event.target instanceof Element))return;
 const button=event.target.closest('[data-action]');
 if(!button){if(contextMenu){contextMenu=null;render();}return;}
 const act=button.dataset.action,id=button.dataset.id||'',projectId=button.dataset.project||'';
 if(['create-project','edit-project','edit-avatar','open-instance','edit-instance','delete-instance','delete-project'].includes(act))lastDialogTrigger=button;
 if(act==='modal-backdrop'){if(event.target===button)closeDialog();return;}
 if(act==='auth-microsoft'){void beginMicrosoftLogin();return;}
 if(act==='microsoft-copy-code'){if(microsoftTicket)await copyMicrosoftText(microsoftTicket.user_code,'Código Microsoft');return;}
 if(act==='microsoft-copy-url'){if(microsoftTicket)await copyMicrosoftText(microsoftTicket.verification_uri,'Enlace Microsoft');return;}
 if(act==='microsoft-open-verification'){
   if(!microsoftTicket)return;
   const uri=microsoftTicket.verification_uri;
   let parsed;
   try{parsed=new URL(uri);}catch{return message('Microsoft devolvió una URL inválida',true);}
   if(parsed.protocol!=='https:'||!['microsoft.com','www.microsoft.com','login.microsoftonline.com'].includes(parsed.hostname))
     return message('Microsoft devolvió un enlace no permitido',true);
   try {
     // On CachyOS + AppImage, the native host opener removes bundled
     // GTK/GIO library paths before launching Zen/Flatpak.
     await command('microsoft_open_verification');
   }catch {
     try{await T.opener.openUrl(uri);}
     catch {
       await copyMicrosoftText(uri,'Enlace Microsoft');
       message('Zen no se abrió automáticamente. Pegá el enlace y código en tu navegador. La autorización sigue activa.');
     }
   }
   return;
 }
 if(act==='microsoft-cancel'){void cancelMicrosoftLogin();authProvider='cloud';render();return;}
 if(act==='auth-offline'){void cancelMicrosoftLogin();authMode='offline';authProvider='local';showPassword=false;render();return;}
 if(act==='auth-online'){void cancelMicrosoftLogin();authProvider='cloud';authMode='login';showPassword=false;render();return;}
 if(act==='auth-local'){void cancelMicrosoftLogin();authProvider='local';authMode='login';showPassword=false;render();return;}
 if(act==='recent-account'){const recent=db.recent_accounts?.find(a=>a.username===id);if(recent?.provider==='microsoft'){void beginMicrosoftLogin();return;}authMode='login';authProvider=recent?.provider==='vis-social'?'cloud':'local';render();const name=root.querySelector('#auth-name');if(name){name.value=id;root.querySelector('#auth-password')?.focus();}return;}
 if(act==='switch-auth'){cancelPendingSectionChange();authMode=authMode==='login'?'register':'login';showPassword=false;render();return;}
 if(act==='toggle-password'){const input=document.querySelector('#auth-password'),repeat=document.querySelector('#auth-repeat');if(input){showPassword=!showPassword;input.type=showPassword?'text':'password';if(repeat)repeat.type=input.type;button.innerHTML=I(showPassword?'eyeoff':'eye',19);}return;}
 if(act==='close-modal'){closeDialog();return;}
 if(act==='go-home')navigate('home');
 else if(act==='mode-vs')setLibraryMode('vs');
 else if(act==='mode-user')setLibraryMode('user');
 else if(act==='import-worlds-instance')await importWorldsInstance();
 else if(act==='export-worlds-instance')await exportWorldsInstance(projectId,id);
 else if(act==='new-personal-instance'){if(isGuest())return message('Iniciá sesión para crear instancias.',true);dialog={type:'instance',data:{project_id:PERSONAL_PROJECT_ID,ram_mb:4096,loader:'vanilla'}};render();void loadMinecraftVersions();}
 else if(act==='sidebar-instance'){mcSelected={projectId:projectId||PERSONAL_PROJECT_ID,name:id};navigate('instances');}
 else if(act==='open-project')navigate('project',id);
 else if(act==='go-profile')navigate('profile');
 else if(act==='go-instances')navigate('instances');
 else if(act==='go-minecraft'){navigate('minecraft');void refreshInstalledFiles();}
 else if(act==='go-settings')navigate('settings');
 else if(act==='go-cloud'){navigate('cloud');void refreshCloudCatalog(true);}
 else if(act==='refresh-cloud')await refreshCloudCatalog();
 else if(act==='download-cloud-bundle')await downloadCloudBundle(id);
 else if(act==='apply-team-project'){
   if(!native||!db.user)return;
   const card=button.closest('.cloud-project');
   const name=card?.querySelector('[data-team-destination]')?.value||'';
   if(!name)return message('Elegí una instancia local de este proyecto.',true);
   const allowServers=!!card.querySelector('[data-team-servers]')?.checked;
   const allowWaypoints=!!card.querySelector('[data-team-waypoints]')?.checked;
   if(!window.confirm('¿Aplicar el paquete verificado de '+id+' a '+name+
     '? Solo agregará archivos que no existan. No reemplazará mundos ni ajustes personales.'))return;
   await onceOperation('apply-team:'+id+':'+name,async()=>{
     try{
       const report=await command('apply_team_project',{
         projectId:id,name,allowServers,allowWaypoints});
       message('VIS Team: '+report.installed+' archivos nuevos; '+
         report.preserved+' existentes o privados conservados. '+report.modrinth_mods+
         ' mods referenciados en Modrinth.');
     }catch(e){message('No se pudo aplicar el paquete: '+String(e),true);}
   });
 }
 else if(act==='check-update')await checkAppUpdate();
 else if(act==='refresh-downloads'){await refreshDownloadJobs();render();}
 else if(act==='cancel-active-download'){
   const job=activeDownload();
   if(!job||job.status!=='running')return;
   if(!window.confirm('¿Cancelar la instalación en curso? Los archivos completos y verificados se conservarán; la etapa actual puede tardar en detenerse.'))return;
   try{const status=await command('cancel_download',{id:job.id});
     downloadJobs=[status,...downloadJobs.filter(j=>j.id!==status.id)];
     updateDownloadDock();
     message('Cancelación solicitada. VIS detendrá la descarga en un punto seguro.');
   }catch(error){message('No se pudo cancelar la instalación: '+String(error),true);}
 }
 else if(act==='install-update')await installAppUpdate();
 else if(act==='go-maintenance'){navigate('maintenance');void loadMaintenance();}
 else if(act==='legacy-cleanup-preview')await loadLegacy();
 else if(act==='legacy-cleanup-apply')await cleanLegacy();
 else if(act==='maintenance-preview')await loadMaintenance();
 else if(act==='maintenance-clean')await cleanMaintenance();
 else if(act==='go-assets')navigate('assets');
 else if(act==='toggle-social'){if(socialVisible){beginSurfaceDismiss(root,'.social-pane',()=>{socialVisible=false;render();},{reducedMotion:prefs.reducedMotion});}else{socialVisible=true;render();}}
 else if(act==='social-global'){socialTab='global';render();}
 else if(act==='social-projects'){socialTab='projects';render();}
 else if(act==='open-chat'){chatWith=id;chatWindowSize=100;social.setChatActive(true);render();}
 else if(act==='chat-load-older'){chatWindowSize=Math.min(10000,chatWindowSize+100);render();}
 else if(act==='close-chat'){beginSurfaceDismiss(root,'.chat-drawer',()=>{chatWith='';social.setChatActive(false);render();},{reducedMotion:prefs.reducedMotion});}
 else if(act==='social-upload-avatar'){void selectAndUploadSocialAvatar();}
 else if(act==='social-enable-cloud'){void enableSocialCloudPassword();}
 else if(act==='social-developer-key'){
  try{
   const {account}=await social.accountInfo();
   if(!account?.cloud_credential_public_key)throw Error('Esta cuenta todavía no tiene credencial cloud.');
   const info='Usuario VIS: '+account.username+'\nID pública: '+account.public_id+
     '\nClave pública Ed25519: '+account.cloud_credential_public_key+
     '\nAbrí GitHub Actions → VIS Social - Super Developer, verificá la cuenta y solicitá grant.';
   try{await navigator.clipboard?.writeText(info);}catch{/* Clipboard unavailable. */}
   window.prompt('Datos públicos para la solicitud de desarrollador (sin contraseña):',info);
  }catch(error){message(String(error),true);}
 }
 else if(act==='social-superadmin-key'){
  try{
   const {account}=await social.accountInfo();
   if(!account?.cloud_credential_public_key)
     throw Error('Iniciá sesión con una cuenta VIS Cloud con contraseña.');
   const detail='Cuenta VIS: '+account.username+
      '\\nID pública: '+account.public_id+
      '\\nVerificador PÚBLICO Ed25519: '+account.cloud_credential_public_key+
      '\\nRol actual: '+account.role+
      '\\nGitHub Actions → VIS Social - Provision First Super Administrator'+
      '\\nNo compartas contraseña, PIN, sal ni clave privada.';
   try{await navigator.clipboard?.writeText(detail);}catch{}
   window.prompt('Solicitud de superadmin: primero verificá la propiedad de la cuenta y aprobá el workflow protegido.',detail);
  }catch(error){message(String(error),true);}
 }
 else if(act==='social-public-identity'){
  if(!native){message('La identidad se muestra desde VIS Nexo nativo.',true);return;}
  try{
    const info=await command('social_identity_info');
    const detail='Usuario: '+info.username+'\\nSHA-256: '+info.fingerprint_sha256+'\\nClave pública Ed25519: '+info.public_key;
    let copied=false;
    try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(detail);copied=true;}}
    catch { /* OS clipboard permissions vary; always offer the public key manually. */ }
    window.prompt(copied?'Identidad pública copiada. Nunca compartas la clave privada:':
      'Copiá esta identidad pública. Nunca compartas la clave privada:',detail);
  }catch(e){message(String(e),true);}
 }
 else if(act==='social-subscribe-project'){
  try{await social.subscribeProject(id,button.dataset.subscribed!=='true');}
  catch(e){message(String(e),true);}
 }
 else if(act==='social-register-project'){
  if(!social.state()?.developer){message('El permiso de desarrollador se habilita desde GitHub Actions.',true);return;}
  const projectId=window.prompt('ID público de proyecto (letras, números, _ y -):');
  if(!projectId)return;
  const title=window.prompt('Nombre del proyecto:');
  if(!title)return;
  const visibility=window.confirm('¿Publicar el proyecto para todos?')?'published':'draft';
  try{await social.manageProject({id:projectId,title,summary:'',visibility});message('Proyecto registrado en VIS Social');}
  catch(e){message(String(e),true);}
 }
 else if(act==='social-assign-staff'){
  if(!social.state()?.developer){message('El permiso de desarrollador es necesario.',true);return;}
  const projectId=window.prompt('ID del proyecto registrado:');
  if(!projectId)return;
  const username=window.prompt('Usuario al que querés asignar permisos:');
  if(!username)return;
  const staffRole=window.prompt('Permiso: editor, manager o none (quitar):','editor');
  if(!staffRole)return;
  try{await social.grantStaff(projectId,username,staffRole);message('Personal del proyecto actualizado.');}
  catch(error){message(String(error),true);}
 }
 else if(act==='social-manage-user'){
  if(social.state()?.role!=='super_admin'){message('Solo la supercuenta puede gestionar usuarios.',true);return;}
  const username=window.prompt('Usuario de VIS Social:');
  if(!username)return;
  const choice=window.prompt('Operación: user, moderator, project_manager, disable, enable');
  if(!choice)return;
  try{
   if(choice==='disable'||choice==='enable')await social.setAccountDisabled(username,choice==='disable');
   else await social.setAccountRole(username,choice);
   message('Permiso actualizado en el servidor');
  }catch(e){message(String(e),true);}
 }
 else if(act==='social-global-admin'){
   if(social.state()?.role!=='super_admin')return message('Se requiere la supercuenta.',true);
   const username=window.prompt('Nombre técnico de la cuenta VIS Cloud (no el @alias):');
   if(!username)return;
   const operation=window.prompt('grant (autorizar administrador global) o revoke (revocar)','grant');
   if(operation!=='grant'&&operation!=='revoke')return message('Operación inválida.',true);
   if(!window.confirm((operation==='grant'?'Otorgar':'Revocar')+' administración global a '+username+'?'))return;
   try{
     await social.globalAdmin(username,operation==='grant');
     message('Permiso global actualizado. No modifica el alias ni la identidad del usuario.');
   }catch(error){message('Administradores: '+String(error),true);}
 }
 else if(act==='social-edit-status'){stateEditorOpen=!stateEditorOpen;render();}
 else if(act==='premium-refresh'){await loadPremiumCosmetics();}
 else if(act==='premium-use-saved-skin'){
   if(!premiumCosmetics?.history?.some(item=>item.url===id))return;
   await changePremiumCosmetic('microsoft_use_saved_skin',{url:id});
 }
 else if(act==='premium-use-skin'){
   if(!premiumCosmetics?.skins?.some(item=>item.id===id))return;
   await changePremiumCosmetic('microsoft_use_skin',{skinId:id});
 }
 else if(act==='premium-use-cape'){
   if(!premiumCosmetics?.capes?.some(item=>item.id===id))return;
   await changePremiumCosmetic('microsoft_set_cape',{capeId:id});
 }
 else if(act==='premium-hide-cape'){await changePremiumCosmetic('microsoft_hide_cape');}
 else if(act==='premium-upload-skin'){
   if(!native||!T?.dialog?.open)return message('Necesitás VIS Nexo instalado para subir una skin.',true);
   if(premiumCosmeticsBusy)return message('Ya se está procesando un cosmético oficial.',true);
   await chooseAsset('skin','','',true);
 }
 else if(act==='social-save-display-name'){
   const text=document.getElementById('social-display-name')?.value?.trim()||'';
   if(!social.connected())return message('Conectá VIS Social para editar tu nombre visible.',true);
   try{await social.setDisplayName(text);message('Nombre público actualizado. No cambia tu usuario técnico ni tus amigos.');render();}
   catch(error){message(String(error),true);}
 }
 else if(act==='social-save-public-handle'){
   const requested=document.getElementById('social-public-handle')?.value?.trim().toLowerCase()||'';
   if(!social.connected())return message('Conectá VIS Social para elegir tu @usuario.',true);
   if(!/^[a-z0-9_]{3,24}$/.test(requested))return message('Usá de 3 a 24 letras, números o guion bajo.',true);
   try{
     const saved=await social.setPublicHandle(requested);
     message('Tu identidad pública es @'+saved.public_handle+'. Conservaste tus amigos y chats.');render();
   }catch(error){message(String(error),true);}
 }
 else if(act==='social-copy-handle'){
   if(!social.connected())return message('Conectá VIS Social para compartir tu identidad.',true);
   const handle='@'+publicVisHandle();
   try{await navigator.clipboard.writeText(handle);message('Usuario VIS copiado: '+handle);}
   catch{window.prompt('Compartí este @usuario VIS para recibir solicitudes:',handle);}
 }
 else if(act==='social-retry'){if(!social.connected())void connectSocial();}
 else if(act==='social-custom-status'){
  if(!social.connected()){message('Conectá VIS Social para usar estados personalizados.',true);return;}
  const current=social.state();
  const custom=window.prompt('Estado personalizado (máximo 160 caracteres):',current?.custom_status||'');
  if(custom!==null){
    try{await social.setPresence(db.user?.presence||'online',custom,current?.current_game||'');}
    catch(error){message(String(error),true);}
  }
 }
 else if(act==='accept-friend'){
  if(!social.connected()){message('VIS Social sin conexión: no se aceptó la solicitud.',true);}
  else try{await social.acceptFriend(id);message('Solicitud aceptada');}
  catch(e){message(String(e),true);}
 }
 else if(act==='logout'){resetAccountView();microsoftGamertag=null;premiumCosmetics=null;cancelPendingSectionChange();social.setChatActive(false);await social.stop();socialOverlay=null;socialAvatars.clear();socialSkins.clear();skinLoads.clear();publicSkinLookup=null;db=await command('logout');page='home';dialog=null;authMode='login';showPassword=false;render();}
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
 else if(act==='edit-profile'){dialog={type:'edit-profile'};render();}
 else if(act==='publish-vis-skin'){void publishLocalSkin();}
 else if(act==='remove-vis-skin'){void removePublicSkin();}
 else if(act==='skin-lookup'){
   const username=window.prompt('Usuario VIS cuya skin querés ver (no gamertag):','');
   if(username!==null&&username.trim())void lookupPublicSkin(username);
 }
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
 else if(act==='project-search-mods'){
   if(!wizard || wizardStep!==0)return;
   projectModQuery=document.querySelector('#project-mod-query')?.value.trim()||'';
   acceptWizardInput();
   if(wizard.engine!=='java'||wizard.loader!=='fabric'||!wizard.mc_version)return message('Elegí Java, Fabric y una versión Minecraft.',true);
   if(!projectModQuery)return message('Escribí el mod que querés buscar.',true);
   try{projectModResults=await command('search_modrinth',{query:projectModQuery,version:wizard.mc_version,kind:'mod'});render();}
   catch(e){message(String(e),true);}
 }
 else if(act==='project-add-mod'){
   if(!wizard || !projectModResults.some(m=>m.id===id))return;
   acceptWizardInput();
   wizard.modrinth_mods ||= [];
   if(wizard.modrinth_mods.length>=32)return message('Máximo 32 mods por proyecto.',true);
   if(!wizard.modrinth_mods.includes(id))wizard.modrinth_mods.push(id);
   render();
 }
 else if(act==='project-remove-mod'){
   if(!wizard)return;
   acceptWizardInput();
   wizard.modrinth_mods=(wizard.modrinth_mods||[]).filter(mod=>mod!==id);
   render();
 }
 else if(act==='sync-project-mods'){
   const proj=db.projects.find(p=>p.id===projectId),instance=db.instances.find(i=>i.project_id===projectId&&i.name===id&&!i.source_owner);
   if(!proj||!instance)return message('No se encontró tu instalación del proyecto.',true);
   if(minecraftBusy)return;
   minecraftBusy=true;installProgress={detail:'Verificando mods del proyecto',completed:0,total:1};render();
   try{const result=await command('sync_project_mods',{projectId,name:id});
     message(result.unchanged?'Los mods del proyecto ya están actualizados.':
       `Mods sincronizados: ${result.added} instalados, ${result.retired} archivados, ${result.protected} personales conservados.`);}
   catch(e){message(String(e),true);}finally{minecraftBusy=false;installProgress=null;render();}
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
 else if(act==='project-community-refresh'){await loadProjectCommunity(selectedId);}
 else if(act==='project-community-request'){
   try{
     const result=await social.requestProjectJoin(selectedId);
     message(result.status==='member'?'Ya participás en el proyecto.':'Solicitud enviada al equipo del proyecto.');
     await loadProjectCommunity(selectedId);
   }catch(error){message('Solicitud: '+String(error),true);}
 }
 else if(act==='project-community-policy'){
   if(!projectCommunity?.can_manage)return;
   const admission=window.prompt('Solicitudes: open, request, invite_only',projectCommunity.admission);
   if(admission===null)return;
   const access=window.prompt('Permisos para jugar: public o members',projectCommunity.play_access);
   if(access===null)return;
   try{await social.setProjectPolicy(selectedId,admission,access);await loadProjectCommunity(selectedId);message('Política actualizada.');}
   catch(error){message(String(error),true);}
 }
 else if(act==='project-community-member'||act==='project-community-remove-member'){
   if(!projectCommunity?.can_manage)return;
   const username=window.prompt('Usuario VIS Cloud al que asignar permisos:');
   if(!username)return;
   const remove=act==='project-community-remove-member';
   const role=remove?'participant':window.prompt('Rol: creator, helper, content_creator, participant, guest, collaborator, mention','participant');
   if(!role)return;
   const canPlay=!remove&&window.confirm('¿Autorizar a este usuario para jugar en proyectos con acceso restringido?');
   try{
     await social.projectMember(selectedId,username,role,canPlay,remove?'revoke':'grant');
     await loadProjectCommunity(selectedId);message(remove?'Miembro quitado':'Miembro y acceso actualizados.');
   }catch(error){message(String(error),true);}
 }
 else if(act==='project-community-review'){
   if(!projectCommunity?.can_manage)return;
   const username=button.dataset.user,mode=button.dataset.mode;
   try{await social.reviewProjectJoin(selectedId,username,mode);await loadProjectCommunity(selectedId);message('Solicitud revisada.');}
   catch(error){message(String(error),true);}
 }
 else if(act==='project-community-add-media'){
   const title=window.prompt('Título del directo o video:');if(!title)return;
   const url=window.prompt('URL pública de YouTube o Twitch:');if(!url)return;
   const kind=window.confirm('¿Es un stream/directo? (Cancelar = video)')?'stream':'video';
   try{await social.projectMedia(selectedId,'add',{title,url,kind});await loadProjectCommunity(selectedId);message('Contenido vinculado al proyecto.');}
   catch(error){message(String(error),true);}
 }
 else if(act==='project-community-delete-media'){
   const item=projectCommunity?.media?.find(x=>x.id===id);if(!item)return;
   if(!window.confirm('¿Quitar este contenido del proyecto?'))return;
   try{await social.projectMedia(selectedId,'delete',{id});await loadProjectCommunity(selectedId);}
   catch(error){message(String(error),true);}
 }
 else if(act==='project-community-open-media'){
   const item=projectCommunity?.media?.find(x=>x.id===id);
   if(!item)return;
   try{
     const url=new URL(item.url);
     if(url.protocol!=='https:'||!['www.youtube.com','youtu.be','www.twitch.tv','twitch.tv','clips.twitch.tv'].includes(url.hostname))
       throw Error('Origen de video no permitido');
     if(native)await T.opener.openUrl(url.toString());
     else window.open(url.toString(),'_blank','noopener,noreferrer');
   }catch(error){message('No se pudo abrir el contenido: '+String(error),true);}
 }
 else if(act==='project-play'){await projectPlay(id);}
 else if(act==='confirm-project-install'){await projectInstallAndPlay();}
 else if(act==='pick-project-folder'){
   if(!T?.dialog?.open)return message('Elegí una carpeta desde VIS Nexo instalado.',true);
   try{const folder=await T.dialog.open({directory:true,multiple:false,title:'Elegir carpeta para esta instancia'});if(folder){const el=document.getElementById('vis-project-install-folder');if(el)el.value=folder;}}catch(e){message(String(e),true)}
 }
 else if(act==='open-instance'){if(isGuest()){navigate('instances');return;}const target=id||(libraryMode==='user'||!db.projects.length?PERSONAL_PROJECT_ID:db.projects[0].id);if(target!==PERSONAL_PROJECT_ID){dialog={type:'project-install',projectId:target};render();return;}dialog={type:'instance',data:{project_id:id||(libraryMode==='user'||!db.projects.length?PERSONAL_PROJECT_ID:db.projects[0].id),ram_mb:4096,loader:'vanilla'}};render();void loadMinecraftVersions();}
 else if(act==='edit-instance'){if(!isAdmin()&&projectId!==PERSONAL_PROJECT_ID){dialog={type:'project-install',projectId};render();return;}const instance=db.instances.find(i=>i.name===id&&i.project_id===projectId);if(instance){dialog={type:'instance',data:clone(instance)};render();void loadMinecraftVersions();if(instance.loader==='fabric')void loadFabricLoaders(instance.version);}}
 else if(act==='duplicate-instance'){
   const original=db.instances.find(i=>i.project_id===projectId&&i.name===id);
   if(!original)return;
   const copy=clone(original);copy.installed=false;copy.game_dir='';copy.source_owner='';copy.reuse_source='';copy.share_offline=false;
   const existing=new Set(db.instances.filter(i=>i.project_id===projectId).map(i=>i.name));
   let candidate=original.name+' - copia',number=2;
   while(existing.has(candidate)&&number<100){candidate=`${original.name} - copia ${number++}`;}
   if(existing.has(candidate)||candidate.length>60)return message('No se puede generar un nombre único de instancia.',true);
   copy.name=candidate;
   // A duplicate must choose a new library before writing any instance record.
   dialog={type:'instance',data:copy};render();void loadMinecraftVersions();
   if(copy.loader==='fabric')void loadFabricLoaders(copy.version);
   message('Elegí una carpeta biblioteca para crear la copia sin tocar el mundo original.');
 }
 else if(act==='instance-ram-preset'){
   const input=document.querySelector('#instance-form [name="ram_mb"]');
   if(input)input.value=button.dataset.size;
 }
 else if(act==='check-instance-destination'){
   const report=document.getElementById('instance-destination-report');
   const name=document.querySelector('#instance-form [name="name"]')?.value.trim()||'';
   const projectId=document.querySelector('#instance-form [name="project_id"]')?.value||PERSONAL_PROJECT_ID;
   const gameDir=document.getElementById('instance-folder-path')?.value.trim()||'';
   if(!report)return;
   try{
     const existing=db.instances.some(i=>!i.source_owner&&i.project_id===projectId&&i.name===name);
     const destination=existing?gameDir:await command('suggest_instance_directory',{library:gameDir,name});
     const data=await command('preview_instance_destination',{projectId,name,gameDir:destination});
     report.classList.remove('invalid');
     report.textContent='Carpeta válida: '+data.root+
       (data.contains_existing_vis?' · Se detectó una instancia VIS existente.':
        data.has_worlds?' · Se detectaron mundos; no se borrarán.':' · Carpeta independiente.')+
       '\\nJuego: '+data.java_versions+' · Mods: '+data.mods+' · Mundos: '+data.saves;
   }catch(error){report.classList.add('invalid');report.textContent=String(error);}
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
 else if(act==='horizon-check'){
   try{horizonChecks=await command('horizon_diagnostics',{projectId,name:id});render();
     const problems=horizonChecks.filter(c=>c.status==='missing').length;
     message(problems?`${problems} requisito(s) pendientes. Revisá el diagnóstico de Horizon.`:'Diagnóstico Horizon completado. Ya podés jugar en modo local.',!!problems);
   }catch(e){message(String(e),true)}
 }
 else if(act==='use-horizon-source'){
   const input=document.getElementById('horizon-build-dir');
   if(input)input.value='vis:source';
   message('Horizon se descargará desde el fork VIS al pulsar Instalar. No se incluye en el launcher.');
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
 else if(act==='instance-data-tools'){
   await openInstanceData(projectId,id,button.dataset.source||'');
 }
 else if(['world-cloud-link','world-cloud-save','world-cloud-restore','world-cloud-unlink'].includes(act)){
   const d=dialog,world=button.dataset.world||'',generation=accountGeneration;
   if(!native||d?.type!=='instance-data'||d.sourceOwner||!world)return;
   await onceOperation('cloud-world:'+JSON.stringify([d.projectId,d.name,world]),async()=>{
     try{
       const params={projectId:d.projectId,name:d.name,world};
       if(act==='world-cloud-link'){
         if(!T?.dialog?.open)throw Error('Selector de carpetas no disponible');
         const provider=document.getElementById('vis-world-provider')?.value||'other';
         const folder=await T.dialog.open({directory:true,multiple:false,title:'Elegí tu carpeta de nube ya sincronizada'});
         if(typeof folder!=='string'||!folder)return;
         await command('link_world_cloud',{...params,folder,provider});
         message('Carpeta vinculada; guardá la primera copia del mundo con Nube.');
       }else if(act==='world-cloud-unlink'){
         if(!window.confirm('Desvincular Nube para '+world+'? Las copias guardadas no se eliminan.'))return;
         await command('unlink_world_cloud',params);
         message('Nube desvinculada del mundo; se conservaron los respaldos externos.');
       }else if(act==='world-cloud-save'){
         const backup=await command('backup_world_cloud',params);
         message('Mundo copiado a carpeta sincronizada: '+fmtBytes(backup.bytes));
       }else{
         if(!window.confirm('Se restaurará una COPIA con nombre nuevo; el mundo actual no se reemplazará. ¿Continuar?'))return;
         const restored=await command('restore_world_cloud',{...params,confirmation:'RESTAURAR'});
         message('Mundo restaurado como '+restored+'. Se conservó el original.');
       }
       if(generation!==accountGeneration||dialog!==d)return;
       d.worldCloud=await command('world_cloud_status',{projectId:d.projectId,name:d.name});
       if(generation===accountGeneration&&dialog===d)render();
     }catch(error){if(generation===accountGeneration)message('Nube: '+String(error),true);}
   });
 }
 else if(act==='instance-data-backup')await runInstanceDataAction('backup');
 else if(act==='instance-data-toggle-auto-backup'){
   const current=dialog,generation=accountGeneration;
   if(current?.type!=='instance-data'||current.sourceOwner)return;
   await onceOperation('instance-auto-backup:'+JSON.stringify([current.projectId,current.name]),async()=>{
     try{
       const enabled=!current.autoBackup;
       const next=await command('set_instance_auto_backup',{
         projectId:current.projectId,name:current.name,enabled
       });
       if(generation!==accountGeneration||dialog!==current)return;
       db=next;current.autoBackup=enabled;render();
       message(enabled?'Copias automáticas activadas. VIS guardará hasta tres respaldos diarios antes de jugar.':
         'Copias automáticas desactivadas. Las copias existentes se conservarán.');
     }catch(error){if(generation===accountGeneration)
       message('No se pudo cambiar la protección de la instancia: '+String(error),true);}
   });
 }
 else if(act==='instance-data-restore')await runInstanceDataAction('restore');
 else if(act==='instance-data-audit')await runInstanceDataAction('audit');
 else if(act==='instance-data-open-logs'){
   const current=dialog;
   if(current?.type!=='instance-data')return;
   try{await command('open_instance_location',{
     projectId:current.projectId,name:current.name,
     sourceOwner:current.sourceOwner||null,kind:'logs'
   });}
   catch(error){message('No se pudieron abrir los registros: '+String(error),true);}
 }
 else if(act==='instance-data-repair')await runInstanceDataAction('repair');
 else if(act==='instance-data-servers-preview')await runInstanceDataAction('servers-preview');
 else if(act==='instance-data-servers-merge')await runInstanceDataAction('servers-merge');
 else if(act==='open-instance-folder'||act==='open-instance-resource-folder'){
   if(!native)return message('Esta acción requiere VIS Nexo instalado.',true);
   const kind=act==='open-instance-folder'?'game':button.dataset.kind||'resourcepacks';
   const sourceOwner=button.dataset.source||null;
   await onceOperation('folder:'+JSON.stringify([projectId,id,sourceOwner,kind]),async()=>{
     try{
       await command('open_instance_location',{projectId,name:id,sourceOwner,kind});
     }catch(error){
       message('No se pudo abrir '+(kind==='game'?'la carpeta de la instancia':kind)+': '+String(error),true);
     }
   });
 }
 else if(act==='launch-minecraft'){await performLaunch(projectId,id,button.dataset.source||'');}
 else if(act==='manage-instance'){mcSelected={projectId,name:id};installedFiles=[];horizonChecks=[];navigate('minecraft');void refreshInstalledFiles();}
 else if(act==='install-modrinth'){await performModInstall(id);}
 else if(act==='import-instance-resource'){await importMcFile(button.dataset.kind);}
 else if(act==='remove-instance-file'){await removeMcFile(button.dataset.kind,button.dataset.file);}
 else if(act==='toggle-instance-file'){await toggleMcFile(button.dataset.kind,button.dataset.file);}
 else if(act==='submit-instance'){await saveInstanceForm();}
 else if(act==='submit-install-instance'){await saveInstanceForm(true);}
 else if(act==='recover-legacy-instance'){
   const sourceOwner=button.dataset.source||'';
   const key='restore:'+JSON.stringify([projectId,id,sourceOwner]);
   await onceOperation(key,async()=>{
     try{
       const old=await command('recover_shared_instance',{projectId,name:id,sourceOwner,apply:false});
       if(!old.source_count || (!old.worlds&&!old.other_files)){
         message('No se encontraron datos separados de versiones anteriores para esta cuenta.');
         return;
       }
       const confirmed=window.confirm(
         'Se encontraron '+old.worlds+' mundos y '+old.other_files+
         ' recursos/ajustes en '+old.source_count+' carpeta(s) antigua(s).\\n\\n'+
         'VIS copiará los archivos que todavía no existan en la carpeta compartida, sin reemplazar los existentes ni eliminar los originales. ¿Recuperar?'
       );
       if(!confirmed)return;
       const result=await command('recover_shared_instance',{projectId,name:id,sourceOwner,apply:true});
       message('Recuperación terminada: '+result.restored+' archivos/carpetas copiados; '+
           result.skipped+' ya existían y se conservaron. Las copias antiguas siguen intactas.');
     }catch(error){message('No se pudieron recuperar los datos anteriores: '+String(error),true);}
   });
 }
 else if(act==='hide-shared-instance'){
   if(!button.dataset.source)return;
   const ok=await apply('set_shared_hidden',{sourceOwner:button.dataset.source,projectId,name:id,hidden:true},'Instancia oculta solo para tu perfil');
   if(ok)message('Podés restaurarla desde Mi perfil → Instancias.');
 }
 else if(act==='show-shared-instance'){
   await apply('set_shared_hidden',{sourceOwner:button.dataset.source,projectId,name:id,hidden:false},'Instancia compartida restaurada');
 }
 else if(act==='bulk-instance-mode'){
   bulkInstanceMode=!bulkInstanceMode;bulkInstanceSelection.clear();render();
 }
 else if(act==='bulk-instance-toggle'){
   const sourceOwner=button.dataset.source||'';
   const key=JSON.stringify([sourceOwner,projectId,id]);
   const exists=db.instances.some(i=>(i.source_owner||'')===sourceOwner&&i.project_id===projectId&&i.name===id);
   if(!exists)return;
   if(button.checked)bulkInstanceSelection.add(key);else bulkInstanceSelection.delete(key);
   render();
 }
 else if(act==='bulk-instance-select-all'){
   const relevant=(page==='instances'?
     (libraryMode==='user'?personalInstances():officialInstances()):personalInstances());
   if(relevant.length>50)return message('Seleccioná hasta 50 instancias por tanda.',true);
   for(const i of relevant)bulkInstanceSelection.add(instanceSelectionKey(i));
   render();
 }
 else if(act==='bulk-instance-confirm'){
   if(!bulkInstanceSelection.size)return;
   dialog={type:'bulk-instance-delete'};render();
 }
 else if(act==='bulk-delete-execute'){
   if(document.getElementById('bulk-delete-confirm-input')?.value!=='CONFIRMAR')
     return message('Escribí exactamente CONFIRMAR para continuar.',true);
   const entries=db.instances.filter(i=>bulkInstanceSelection.has(instanceSelectionKey(i)))
     .map(i=>({project_id:i.project_id,name:i.name,source_owner:i.source_owner||''}));
   if(entries.length!==bulkInstanceSelection.size)return message('La selección cambió; revisá las instancias.',true);
   const eraseFiles=document.getElementById('bulk-delete-files')?.checked===true;
   if(eraseFiles&&entries.some(i=>i.source_owner))return message('No podés borrar archivos de otro perfil.',true);
   const ok=await apply('delete_instances_batch',{
       instances:entries,eraseFiles,confirmation:'CONFIRMAR'},
       eraseFiles?'Se eliminaron las instancias seleccionadas y sus archivos VIS':
         'Instancias propias quitadas y compartidas ocultas para tu cuenta; mundos conservados.');
   if(ok){bulkInstanceSelection.clear();bulkInstanceMode=false;dialog=null;mcSelected=null;render();}
 }
 else if(act==='delete-instance'){dialog={type:'confirm',kind:'instance',name:id,projectId,label:id};render();}
 else if(act==='delete-project'){dialog={type:'confirm',kind:'project',projectId:id,label:db.projects.find(p=>p.id===id)?.title||id};contextMenu=null;render();}
 else if(act==='confirm-delete'){
  if(dialog?.kind==='project'){const ok=await apply('delete_project',{projectId:dialog.projectId},'Proyecto eliminado');if(ok){dialog=null;selectedId='';page='home';render();}}
  else if(dialog?.kind==='instance'){
   const eraseFiles=document.getElementById('delete-instance-files')?.checked===true;
   const ok=await apply('delete_instance',{projectId:dialog.projectId,name:dialog.name,eraseFiles},
     eraseFiles?'Instancia y sus archivos VIS eliminados':'Instancia quitada de la biblioteca; los mundos siguen en el disco');
   if(ok){dialog=null;mcSelected=null;render();}
 }
 }
});
root.addEventListener('change',event=>{
 const control=event.target;
 if(!control)return;
 if(['premium-auto-skin','premium-edit-auto-skin'].includes(control.id))
   premiumSkinSync=control.checked===true;
 if(['premium-local-model','premium-edit-model','premium-skin-model'].includes(control.id))
   premiumSkinModel=control.value==='slim'?'slim':'classic';
});
root.addEventListener('input',event=>{
 if(event.target?.id==='bulk-delete-confirm-input'){
   const button=root.querySelector('[data-action="bulk-delete-execute"]');
   if(button)button.disabled=event.target.value!=='CONFIRMAR';
 }
});
root.addEventListener('contextmenu',async e=>{
 if(!(e.target instanceof Element))return;
 const friend=e.target.closest('.friend-item');
 if(friend&&social.connected()){
   e.preventDefault();
   const username=friend.dataset.id;
   const previous=db.friends.find(f=>f.username===username)?.alias||'';
   const alias=window.prompt('Apodo privado para '+username+' (vacío para quitarlo):',previous);
   if(alias!==null){
     try{await social.setAlias(username,alias);}
     catch(error){message(String(error),true);}
   }
   return;
 }
 if(!isAdmin())return;
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
 if(!native)return message('Para iniciar Minecraft abrí el cliente Tauri.',true);
 const generation=accountGeneration;
 return onceOperation('launch:'+JSON.stringify([projectId,name,sourceOwner]),async()=>{
 lastMinecraftExit=null;
 try{
  const instance=db.instances.find(i=>i.project_id===projectId&&i.name===name);
  let result;
  if(instance?.auto_backup&&!sourceOwner)
    message('Verificando el respaldo preventivo de la instancia antes de jugar…');
  if(instance?.engine==='horizon'){
    const sessionFile=''; // Supported local game mode; Microsoft integration remains separate.
    result=await command('launch_horizon',{projectId,name,sessionFile,sourceOwner:sourceOwner||null});
  }else{
    result=await command('launch_minecraft',{projectId,name,sourceOwner:sourceOwner||null});
  }
  if(generation===accountGeneration)message(`Minecraft iniciado · PID ${result.pid}. Logs en ${result.log_file}`);
 }catch(e){if(generation===accountGeneration)message(String(e),true)}
 });
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
  T.event.listen('vis-download-state',e=>{
     const job=e.payload;
     if(!job||!db.user||job.owner!==db.user.username)return;
     downloadJobs=[job,...downloadJobs.filter(j=>j.id!==job.id)].slice(0,9);
     if(page==='settings'&&['completed','cancelled','failed'].includes(job.status))render();
     else updateDownloadDock();
   }).catch(()=>{});
  T.event.listen('minecraft-process-exited',e=>{
    lastMinecraftExit=e.payload;
    if(!e.payload.success)message(`Minecraft finalizó con error (${e.payload.exit_code??'sin código'}). Revisá el log: ${e.payload.log_file}`,true);
    else message('Minecraft se cerró correctamente.');
    if(page==='minecraft'||page==='instances')render();
  }).catch(()=>{});
}
 try {db=await command('get_state');}
 catch(e){message(`No se pudo inicializar el cliente: ${String(e)}`,true);}
 render();
 if(db.user){
   void refreshAssets().catch(()=>{});
   void refreshDownloadJobs().then(()=>{if(page==='settings')scheduleSocialRender();}).catch(()=>{});
 }
 if(native){void checkAppUpdate(true);void refreshCloudCatalog(true);}
}
boot();
