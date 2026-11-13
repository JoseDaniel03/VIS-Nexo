//! VIS Nexo — Tauri 2 host. The Tauri window is a view over the existing
//! local accounts and VSUI catalogue; the web view never authorizes admin work.
mod accounts;
mod minecraft;
mod microsoft;
mod instance_guard;
mod instance_lock;
mod instance_backup;
mod instance_health;
mod server_list;
mod project_mods;
mod maintenance;
mod cloud;
mod updates;
mod ombu;
mod horizon;
mod horizon_download;
mod download_manager;
mod social;

// Reserved namespace for player-owned instances; project editor slugs cannot create this ID.
const PERSONAL_PROJECT_ID: &str = "__personal__";

use accounts::{atomic_json, data_directory, Instance, LocalMessage, LocalStore, Role};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, path::{Path, PathBuf}, sync::Mutex, time::{SystemTime, UNIX_EPOCH}};
use tauri::{Manager, State};
use vsui_core::{DesignDocument, GameProject, Scene};

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
struct Branding {
    name: String,
    launcher_logo: String,
    login_image: String,
    home_image: String,
    login_video: String,
    home_video: String,
    project_videos: BTreeMap<String, String>,
}

#[derive(Serialize)]
struct SafeUser { username: String, role: Role, avatar: String, skin: String, cape: String, avatar_layer: String, profile_banner: String, presence: String }
#[derive(Serialize)]
struct FriendView { username: String, presence: String }
#[derive(Serialize)]
struct Snapshot {
    user: Option<SafeUser>,
    projects: Vec<GameProject>,
    instances: Vec<Instance>,
    friends: Vec<FriendView>,
    incoming_requests: Vec<String>,
    outgoing_requests: Vec<String>,
    messages: Vec<LocalMessage>,
    branding: Branding,
    project_execution: BTreeMap<String,bool>,
    recent_accounts: Vec<RecentIdentity>,
    mode: &'static str,
    catalog_source: String,
    hidden_shared_instances: Vec<HiddenShared>,
}
#[derive(Clone, Serialize)]
struct HiddenShared { source_owner:String,project_id:String,name:String }
#[derive(Serialize)]
struct AssetReply { path: String, data_url: String }
#[derive(Serialize)]
struct InstanceDestinationPreview {
    root: String,
    exists: bool,
    has_worlds: bool,
    contains_existing_vis: bool,
    java_runtime: String,
    java_versions: String,
    mods: String,
    saves: String,
}

/// Recent identities are labels only. Never persist passwords, sessions or OAuth tokens here.
#[derive(Clone, Serialize, Deserialize)]
struct RecentIdentity { username: String, provider: String }
#[derive(Default, Serialize, Deserialize)]
#[serde(default)]
struct RecentList { accounts: Vec<RecentIdentity> }

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
struct UniverseCache { source: String, projects: Vec<GameProject> }


struct Backend {
    storage: LocalStore,
    catalog: DesignDocument,
    catalog_path: PathBuf,
    branding: Branding,
    branding_path: PathBuf,
    project_execution: BTreeMap<String,bool>,
    remote_projects: Vec<GameProject>,
    execution_path: PathBuf,
    data_root: PathBuf,
    active_user: Option<String>,
    guest_name: Option<String>,
    recent_accounts: Vec<RecentIdentity>,
    recent_path: PathBuf,
    presence: String,
}

fn blank_catalog() -> DesignDocument {
    DesignDocument {
        format_version: 1, name: "VIS Nexo".into(), width: 1280.0, height: 720.0,
        projects: vec![],
        scenes: ["home", "library", "project", "login"]
            .into_iter().map(|name| Scene { id: name.into(), title: name.into(), elements: vec![] }).collect(),
        components: vec![], guides: BTreeMap::new(), blueprints: BTreeMap::new(),
    }
}
fn load_json<T: for<'a> Deserialize<'a> + Default>(path: &Path) -> Result<T, String> {
    if !path.exists() { return Ok(T::default()); }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    serde_json::from_slice(&bytes).map_err(|e| format!("{}: {}", path.display(), e))
}
fn init_backend(app: &tauri::AppHandle) -> Result<Backend, String> {
    let data_root = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&data_root).map_err(|e| e.to_string())?;
    // Preserve the old CachyOS local account database when migrating from egui.
    #[cfg(target_os = "linux")]
    let accounts_root = data_directory();
    #[cfg(not(target_os = "linux"))]
    let accounts_root = data_root.join("local-accounts");
    let storage = LocalStore::load(accounts_root);
    let catalog_path = data_root.join("launcher.vsui.json");
    let branding_path = data_root.join("launcher-branding.json");
    let execution_path = data_root.join("project-execution.json");
    let recent_path = data_root.join("recent-accounts.json");
    let recent_accounts: RecentList = load_json(&recent_path)?;
    let project_execution: BTreeMap<String,bool> = load_json(&execution_path)?;
    let old_catalog = PathBuf::from("workspace/launcher.vsui.json");
    let old_branding = PathBuf::from("workspace/launcher-branding.json");
    if !catalog_path.exists() && old_catalog.is_file() {
        fs::copy(&old_catalog, &catalog_path).map_err(|e| e.to_string())?;
    }
    if !branding_path.exists() && old_branding.is_file() {
        fs::copy(&old_branding, &branding_path).map_err(|e| e.to_string())?;
    }
    let catalog = if catalog_path.exists() {
        DesignDocument::load(&catalog_path)?
    } else {
        let doc = blank_catalog();
        doc.save(&catalog_path)?;
        doc
    };
    let mut branding: Branding = load_json(&branding_path)?;
    if branding.name.trim().is_empty() || ["VSLauncher", "Virgoland", "Vierola"].iter().any(|legacy| branding.name.eq_ignore_ascii_case(legacy)) { branding.name = "VIS Nexo".into(); }
    let saved_remote:UniverseCache=load_json(&data_root.join("vis-universe-cache.json"))?;
    let remote_projects=if cloud::catalog_url(&data_root).as_deref()==Some(saved_remote.source.as_str()) {
        saved_remote.projects
    }else{Vec::new()};
    Ok(Backend { storage, catalog, catalog_path, branding, branding_path,
        project_execution, remote_projects, execution_path, data_root, active_user: None,
        guest_name: None, recent_accounts: recent_accounts.accounts,
        recent_path, presence: "online".into() })
}
impl Backend {
    fn project(&self,id:&str)->Option<&GameProject>{
        let admin=self.active_user.as_deref()
            .and_then(|u|self.storage.get(u)).is_some_and(|a|a.role==Role::Admin);
        if admin { self.catalog.projects.iter().find(|p|p.id==id)
            .or_else(||self.remote_projects.iter().find(|p|p.id==id)) }
        else { self.remote_projects.iter().find(|p|p.id==id) }
    }
    fn add_recent(&mut self, username: &str, provider: &str) -> Result<(), String> {
        self.recent_accounts.retain(|entry| entry.username != username || entry.provider != provider);
        self.recent_accounts.insert(0, RecentIdentity {username: username.to_owned(), provider: provider.to_owned()});
        self.recent_accounts.truncate(3);
        atomic_json(&self.recent_path, &RecentList {accounts: self.recent_accounts.clone()})
    }
    /// Installed games are shared between VIS profiles on the SAME operating-system
    /// account. We never copy account credentials or expose uninstalled private drafts.
    /// Game binaries belong to the original installer. By default, all VIS
    /// profiles using the SAME instance see its same worlds, options, servers
    /// and resource packs. Account authentication remains independent.
    fn shared_key(owner:&str,project:&str,name:&str)->String{
        // Fully qualified keys avoid ambiguous names across VIS profiles.
        serde_json::to_string(&(owner,project,name)).unwrap_or_default()
    }
    fn machine_instances(&self, for_user: Option<&str>) -> Vec<Instance> {
        let mut available = Vec::new();
        let hidden=for_user.map(|user|self.storage.prefs(user).hidden_shared)
            .unwrap_or_default();
        for account in &self.storage.data.accounts {
            if for_user == Some(account.username.as_str()) {continue}
            for mut instance in self.storage.prefs(&account.username).instances {
                if hidden.contains(&Self::shared_key(&account.username,&instance.project_id,&instance.name)){continue;}
                // Offline users can start an installed engine, including Horizon.
                // They share the instance's data by default but never inherit
                // another user's Microsoft credentials or online-mode access.
                let allowed = instance.project_id == PERSONAL_PROJECT_ID ||
                    self.project(&instance.project_id).is_some();
                if !allowed {continue}
                if let Ok(dir)=minecraft::instance_dir(&self.data_root,&account.username,&instance) {
                    if minecraft::installed(&dir,&instance) {
                        instance.installed=true;
                        instance.source_owner=account.username.clone();
                        available.push(instance);
                    }
                }
            }
        }
        available.sort_by(|a,b|a.name.cmp(&b.name).then(a.source_owner.cmp(&b.source_owner)));
        available
    }
    fn guest_instances(&self) -> Vec<Instance> { self.machine_instances(None) }

    fn username(&self) -> Result<&str, String> {
        self.active_user.as_deref().ok_or_else(|| "Iniciá sesión para continuar.".into())
    }
    fn admin(&self) -> Result<&str, String> {
        let username = self.username()?;
        if self.storage.get(username).is_some_and(|a| a.role == Role::Admin) { Ok(username) }
        else { Err("Solo un administrador puede gestionar proyectos y recursos públicos.".into()) }
    }
    fn snapshot(&self) -> Snapshot {
        let username = self.active_user.as_deref();
        let is_guest = username.is_none() && self.guest_name.is_some();
        let user = if is_guest {
            self.guest_name.as_ref().map(|name| SafeUser {
                username: name.clone(), role: Role::User, avatar: String::new(), skin: String::new(),
                cape: String::new(), avatar_layer: String::new(), profile_banner: String::new(), presence: "offline".into(),
            })
        } else {
            username.and_then(|name| self.storage.get(name)).map(|a| SafeUser {
                username: a.username.clone(), role: a.role, avatar: a.avatar.clone(),
                skin: a.skin.clone(), cape: a.cape.clone(), avatar_layer: a.avatar_layer.clone(),
                profile_banner: a.profile_banner.clone(), presence: self.presence.clone(),
            })
        };
        let friends = username.map(|name| self.storage.friends(name).into_iter().map(|f| FriendView {
            username: f, presence: "offline".into(),
        }).collect()).unwrap_or_default();
        let incoming_requests = username.map(|name| self.storage.data.friendships.iter()
            .filter(|f| f.to == name && !f.accepted).map(|f|f.from.clone()).collect()).unwrap_or_default();
        let outgoing_requests = username.map(|name| self.storage.data.friendships.iter()
            .filter(|f| f.from == name && !f.accepted).map(|f|f.to.clone()).collect()).unwrap_or_default();
        let messages = username.map(|name| self.storage.data.messages.iter()
            .filter(|m| m.from == name || m.to == name).cloned().collect()).unwrap_or_default();
        let instances = if is_guest { self.guest_instances() }
            else {
                let current=username.map(|name|self.storage.prefs(name)).unwrap_or_default();
                let mut own=current.instances;
                if let Some(player)=username {
                    for instance in &mut own {
                        instance.installed=minecraft::instance_dir(&self.data_root,player,instance)
                            .is_ok_and(|folder|minecraft::installed(&folder,instance));
                    }
                }
                let mut other=self.machine_instances(username);
                for instance in &mut other {
                    if let Some(ram)=current.shared_ram.get(&Self::shared_key(&instance.source_owner,&instance.project_id,&instance.name)){
                        instance.ram_mb=*ram;
                    }
                }
                own.append(&mut other);
                own
            };
        let admin=user.as_ref().is_some_and(|u|u.role==Role::Admin);
        // Public Universe is always cloud-authoritative. Local catalogs are
        // drafts for the VIS administrator only: older offline demo projects
        // must never leak into a regular player's online library.
        let mut projects=if admin{self.catalog.projects.clone()}else{Vec::new()};
        for published in &self.remote_projects {
            if let Some(existing)=projects.iter_mut().find(|p|p.id==published.id){
                // New publication always wins over a locally cached draft.
                *existing=published.clone();
            } else {projects.push(published.clone());}
        }
        Snapshot { user, projects, instances,
            friends, incoming_requests, outgoing_requests, messages,
            branding: self.branding.clone(), project_execution: self.project_execution.clone(),
            recent_accounts: self.recent_accounts.clone(), mode: if is_guest {"offline"} else {"local"},
            catalog_source: cloud::catalog_url(&self.data_root).unwrap_or_default(),
            hidden_shared_instances: username.map(|user|self.storage.prefs(user).hidden_shared
                .iter().filter_map(|key|serde_json::from_str::<(String,String,String)>(key).ok())
                .map(|(source_owner,project_id,name)|HiddenShared{source_owner,project_id,name})
                .collect()).unwrap_or_default() }
    }
    fn save_catalog(&mut self, next: DesignDocument) -> Result<(), String> {
        next.save(&self.catalog_path)?;
        self.catalog = next;
        Ok(())
    }
}
fn locked<'a>(state: &'a State<'_, Mutex<Backend>>) -> Result<std::sync::MutexGuard<'a, Backend>, String> {
    state.lock().map_err(|_| "No se pudo acceder al estado interno del cliente.".into())
}
#[tauri::command]
fn get_state(state: State<'_, Mutex<Backend>>) -> Result<Snapshot, String> {
    Ok(locked(&state)?.snapshot())
}
#[derive(Serialize)]
struct LegacyCleanupReport {
    recent_accounts:usize,
    hidden_shared:usize,
    shared_ram:usize,
    cleaned:bool
}
fn legacy_keys_healthy(store:&LocalStore,key:&str)->bool{
    let Ok((owner,project,name))=serde_json::from_str::<(String,String,String)>(key) else {return false};
    store.get(&owner).is_some() &&
        store.prefs(&owner).instances.iter().any(|ins|
            ins.project_id==project && ins.name==name)
}
#[tauri::command]
fn legacy_cleanup_preview(state:State<'_,Mutex<Backend>>)->Result<LegacyCleanupReport,String>{
    let s=locked(&state)?;
    let user=s.username()?;
    let prefs=s.storage.prefs(user);
    Ok(LegacyCleanupReport{
        recent_accounts:s.recent_accounts.iter()
            .filter(|a|s.storage.get(&a.username).is_none()).count(),
        hidden_shared:prefs.hidden_shared.iter()
            .filter(|key|!legacy_keys_healthy(&s.storage,key)).count(),
        shared_ram:prefs.shared_ram.keys()
            .filter(|key|!legacy_keys_healthy(&s.storage,key)).count(),
        cleaned:false
    })
}
#[tauri::command]
fn legacy_cleanup_apply(state:State<'_,Mutex<Backend>>,confirmed:bool)->Result<LegacyCleanupReport,String>{
    if !confirmed{return Err("Confirmá la limpieza de referencias antiguas".into());}
    let mut s=locked(&state)?;
    let user=s.username()?.to_owned();
    let report=LegacyCleanupReport{
        recent_accounts:s.recent_accounts.iter()
            .filter(|a|s.storage.get(&a.username).is_none()).count(),
        hidden_shared:s.storage.prefs(&user).hidden_shared.iter()
            .filter(|key|!legacy_keys_healthy(&s.storage,key)).count(),
        shared_ram:s.storage.prefs(&user).shared_ram.keys()
            .filter(|key|!legacy_keys_healthy(&s.storage,key)).count(),
        cleaned:true
    };
    let known=s.storage.data.accounts.iter()
        .map(|a|a.username.clone()).collect::<std::collections::BTreeSet<_>>();
    s.recent_accounts.retain(|a|known.contains(&a.username));
    atomic_json(&s.recent_path,&RecentList{accounts:s.recent_accounts.clone()})?;
    let mut prefs=s.storage.prefs(&user);
    prefs.hidden_shared.retain(|key|legacy_keys_healthy(&s.storage,key));
    prefs.shared_ram.retain(|key,_|legacy_keys_healthy(&s.storage,key));
    s.storage.save_prefs(&user,&prefs)?;
    Ok(report)
}
#[tauri::command]
fn register(state: State<'_, Mutex<Backend>>, username: String, password: String, confirm: String) -> Result<Snapshot, String> {
    let mut s = locked(&state)?;
    let name = s.storage.register(&username, &password, &confirm)?;
    s.guest_name = None;
    s.active_user = Some(name.clone());
    s.presence = "online".into();
    s.add_recent(&name, "local")?;
    Ok(s.snapshot())
}
#[tauri::command]
fn login(state: State<'_, Mutex<Backend>>, username: String, password: String) -> Result<Snapshot, String> {
    let mut s = locked(&state)?;
    let name = s.storage.login(&username, &password)?;
    s.guest_name = None;
    s.active_user = Some(name.clone());
    s.presence = "online".into();
    s.add_recent(&name, "local")?;
    Ok(s.snapshot())
}
#[tauri::command]
fn logout(state: State<'_, Mutex<Backend>>,ms:State<'_,Mutex<microsoft::MicrosoftState>>) -> Result<Snapshot, String> {
    ms.lock().map_err(|_| "Sesión Microsoft bloqueada")?.clear();
    let mut s = locked(&state)?;
    s.active_user = None;
    s.guest_name = None;
    s.presence = "offline".into();
    Ok(s.snapshot())
}
/// A temporary local nickname is not a registered account and does not receive administrator permissions.
#[tauri::command]
fn login_offline(state: State<'_, Mutex<Backend>>, nickname: String) -> Result<Snapshot, String> {
    let nick = nickname.trim();
    if !(3..=16).contains(&nick.len()) || !nick.bytes().all(|b|b.is_ascii_alphanumeric() || b==b'_') {
        return Err("El nick offline debe tener 3–16 caracteres (letras, números y _).".into());
    }
    let mut s = locked(&state)?;
    s.active_user = None;
    s.guest_name = Some(nick.to_owned());
    s.presence = "offline".into();
    Ok(s.snapshot())
}
#[tauri::command]
fn set_avatar_preset(state: State<'_, Mutex<Backend>>, preset: String) -> Result<Snapshot, String> {
    if !["nova", "orbit", "eclipse", "nebula", "pulse"].contains(&preset.as_str()) {
        return Err("Emblema no permitido".into());
    }
    let mut s = locked(&state)?;
    let username = s.username()?.to_owned();
    if let Some(account) = s.storage.get_mut(&username) {
        account.avatar = format!("preset:{preset}");
    } else { return Err("Cuenta no encontrada".into()); }
    s.storage.save()?;
    Ok(s.snapshot())
}
#[tauri::command]
fn update_presence(state: State<'_, Mutex<Backend>>, presence: String) -> Result<Snapshot, String> {
    let mut s = locked(&state)?;
    s.username()?;
    if !["online", "away", "busy", "invisible"].contains(&presence.as_str()) {
        return Err("Estado no válido".into());
    }
    s.presence = presence;
    Ok(s.snapshot())
}
fn slug(text: &str) -> String {
    let mut out = String::new();
    for ch in text.trim().chars() {
        if ch.is_ascii_alphanumeric() { out.push(ch.to_ascii_lowercase()); }
        else if (ch == ' ' || ch == '-' || ch == '_') && !out.ends_with('-') { out.push('-'); }
    }
    out.trim_matches('-').chars().take(48).collect()
}
#[tauri::command]
fn save_project(state: State<'_, Mutex<Backend>>, mut project: GameProject) -> Result<Snapshot, String> {
    let mut s = locked(&state)?;
    s.admin()?;
    if project.title.trim().is_empty() || project.title.chars().count() > 80 { return Err("El nombre debe tener entre 1 y 80 caracteres".into()); }
    if project.description.chars().count() > 2000 || project.subtitle.chars().count() > 180 { return Err("La descripción es demasiado larga".into()); }
    if project.visible_sections.iter().any(|(key,_)| !["news","patches","updates","calendar","community","notes"].contains(&key.as_str())) {
        return Err("Sección de proyecto inválida".into());
    }
    if project.posts.len() > 100 || project.calendar.len() > 100 { return Err("Demasiadas publicaciones o eventos".into()); }
    if project.posts.iter().any(|p| p.title.chars().count()>120 || p.body.chars().count()>4000 || p.date.len()>32)
        || project.calendar.iter().any(|e|e.title.chars().count()>120 || e.description.chars().count()>4000 || e.date.len()>32) {
        return Err("Publicación demasiado larga".into());
    }
    if !["java", "horizon"].contains(&project.engine.as_str()) {return Err("Motor de proyecto desconocido".into());}
    if project.engine=="horizon" {
        project.loader="horizon".into();project.loader_version.clear();project.mc_version="26.3".into();
    } else {
        if !["vanilla","fabric"].contains(&project.loader.as_str()) {return Err("El proyecto admite por ahora Vanilla o Fabric".into());}
        if project.loader=="vanilla" {project.loader_version.clear();}
        if project.loader=="fabric" && project.loader_version.trim().is_empty(){return Err("Elegí una versión de Fabric Loader para el proyecto".into());}
    }
    // An official project owns its curated mod list; the client cannot inject
    // URLs or absolute paths into another player's install.
    if project.modrinth_mods.len()>32 {return Err("Máximo 32 mods Modrinth por proyecto".into());}
    let mut mod_ids=std::collections::BTreeSet::new();
    for id in &project.modrinth_mods {
        if !(3..=64).contains(&id.len()) ||
            !id.bytes().all(|byte|byte.is_ascii_alphanumeric() || byte==b'-' || byte==b'_') {
            return Err("ID de mod Modrinth inválido".into());
        }
        if !mod_ids.insert(id.to_ascii_lowercase()) {
            return Err("El proyecto incluye mods duplicados".into());
        }
    }
    if !project.modrinth_mods.is_empty() && !(project.engine=="java" && project.loader=="fabric") {
        return Err("Los mods de proyecto requieren Minecraft Java con Fabric; Horizon usa su propio motor".into());
    }
    if project.installable && project.mc_version.trim().is_empty(){return Err("Seleccioná la versión del juego antes de habilitar el proyecto".into());}
    if project.id.is_empty() { project.id = slug(&project.title); }
    if project.id.is_empty() || slug(&project.id) != project.id { return Err("ID de proyecto inválido".into()); }
    let mut next = s.catalog.clone();
    if let Some(index) = next.projects.iter().position(|p| p.id == project.id) {
        next.projects[index] = project;
    } else { next.projects.push(project); }
    s.save_catalog(next)?;
    Ok(s.snapshot())
}
#[tauri::command]
fn delete_project(state: State<'_, Mutex<Backend>>, project_id: String) -> Result<Snapshot, String> {
    let mut s = locked(&state)?;
    s.admin()?;
    let mut next = s.catalog.clone();
    let prev = next.projects.len();
    next.projects.retain(|p| p.id != project_id);
    if next.projects.len() == prev { return Err("Proyecto inexistente".into()); }
    s.save_catalog(next)?;
    Ok(s.snapshot())
}
/// Resolve a new instance's dedicated subdirectory without creating files.
/// Already installed instances keep their existing paths when edited.
#[tauri::command]
fn suggest_instance_directory(
    state:State<'_,Mutex<Backend>>,library:String,name:String
)->Result<String,String>{
    locked(&state)?.username()?;
    Ok(instance_guard::managed_child(Path::new(&library),&name)?
        .to_string_lossy().into_owned())
}

/// Read-only preflight for the instance wizard; no folder is created.
#[tauri::command]
fn preview_instance_destination(
    state:State<'_,Mutex<Backend>>, project_id:String, name:String, game_dir:String
) -> Result<InstanceDestinationPreview,String> {
    if name.trim().is_empty() || name.len()>60 {
        return Err("Indicá un nombre válido para esta instancia".into());
    }
    let s=locked(&state)?;
    let username=s.username()?.to_owned();
    let target=instance_guard::destination(Path::new(&game_dir))?;
    for account in &s.storage.data.accounts {
        for previous in s.storage.prefs(&account.username).instances {
            if account.username==username && previous.project_id==project_id && previous.name==name {
                continue;
            }
            if let Ok(folder)=minecraft::instance_dir(&s.data_root,&account.username,&previous) {
                instance_guard::independent(&target,&folder)?;
            }
        }
    }
    let display=|rel:&str|target.join(rel).to_string_lossy().into_owned();
    Ok(InstanceDestinationPreview{
        root:target.to_string_lossy().into_owned(),
        exists:target.is_dir(),
        has_worlds:target.join("saves").is_dir(),
        contains_existing_vis:target.join(".vslauncher/install.json").is_file()
            || target.join(".vis/horizon.json").is_file(),
        java_runtime:display(".vis/runtime"),
        java_versions:display(".vis/runtime/versions"),
        mods:display("mods"),
        saves:display("saves"),
    })
}

#[tauri::command]
fn save_instance(state: State<'_, Mutex<Backend>>, mut instance: Instance) -> Result<Snapshot, String> {
    let s = locked(&state)?;
    let username = s.username()?.to_string();
    if instance.name.trim().is_empty() || instance.name.chars().count() > 60 { return Err("Nombre de instancia inválido".into()); }
    if !(1024..=32768).contains(&instance.ram_mb) { return Err("La RAM debe estar entre 1024 y 32768 MB".into()); }
    if instance.project_id != PERSONAL_PROJECT_ID {
        let project=s.catalog.projects.iter().find(|p|p.id==instance.project_id).ok_or("Seleccioná un proyecto existente")?;
        if s.storage.get(&username).is_some_and(|a|a.role!=Role::Admin) {
            // Ordinary players can only register a published project through
            // ensure_project_instance (folder+RAM). Never trust a crafted UI payload.
            return Err(format!("{}: usá Instalar y jugar; la configuración del juego la define VIS Studios",project.title));
        }
    }
    if !["java", "horizon"].contains(&instance.engine.as_str()) { return Err("Motor inválido".into()); }
    if !["vanilla", "fabric", "horizon"].contains(&instance.loader.as_str()) { return Err("Loader inválido".into()); }
    if instance.share_offline && !instance.game_dir.trim().is_empty(){
        return Err("Las instancias compartidas offline deben usar una carpeta administrada por VIS".into());
    }
    if instance.engine=="horizon" {
        if instance.loader!="horizon" || instance.version!="26.3" {return Err("Horizon requiere Minecraft 26.3 y el loader Horizon".into());}
        // "vis:source" identifies the source-compiled client packed with VIS.
        if instance.horizon_build_dir.len()>2048 ||
           (!instance.horizon_build_dir.is_empty() &&
            instance.horizon_build_dir!=horizon::SOURCE_BUILD_ID &&
            !Path::new(&instance.horizon_build_dir).is_absolute()){
            return Err("La ruta del cliente Horizon debe ser absoluta o vis:source".into());
        }
        for path in [&instance.horizon_minecraft_dir,&instance.horizon_server_jar]{
            if path.len()>2048 || (!path.is_empty() && !Path::new(path).is_absolute()) {
                return Err("Las rutas Horizon deben ser absolutas".into());
            }
        }
        instance.share_offline=false; // Horizon requiere sesión Microsoft del propietario.
    } else if instance.loader=="horizon" {return Err("Seleccioná el motor Horizon".into());}
    if instance.loader=="vanilla" { instance.loader_version.clear(); }
    if instance.loader=="fabric" && instance.loader_version.trim().is_empty() {return Err("Elegí la versión de Fabric Loader".into());}
    if instance.version.is_empty() {return Err("Elegí una versión de Minecraft".into());}
    if !instance.java_path.trim().is_empty() && instance.java_path.len()>512 {return Err("Ruta Java demasiado larga".into());}
    if !instance.reuse_source.trim().is_empty() {
        let path=Path::new(&instance.reuse_source);
        if instance.reuse_source.len()>1024 || !path.is_absolute() {return Err("La ruta opcional de reutilización debe ser absoluta".into());}
    }
    if !instance.player_name.is_empty() && (instance.player_name.len()>16 || instance.player_name.len()<3 || !instance.player_name.bytes().all(|b|b.is_ascii_alphanumeric() || b==b'_')) {return Err("El nick de Minecraft debe tener de 3 a 16 caracteres (letras, números y _).".into());}
    instance.source_owner.clear();
    instance.share_offline = instance.engine == "java" && instance.game_dir.trim().is_empty();
    let dir=minecraft::instance_dir(&s.data_root,&username,&instance)?;
    instance.installed=minecraft::installed(&dir,&instance);
    let mut prefs = s.storage.prefs(&username);
    if let Some(previous)=prefs.instances.iter().find(|i|i.project_id==instance.project_id&&i.name==instance.name) {
        if previous.engine!=instance.engine && previous.installed {
            return Err("No podés cambiar el motor de una instancia ya instalada. Creá otra instancia para proteger sus mundos.".into());
        }
    }
    if instance.game_dir.trim().is_empty() && !prefs.instances.iter().any(|i|i.project_id==instance.project_id&&i.name==instance.name){
        return Err("Elegí una carpeta para instalar todos los archivos de la instancia".into());
    }
    // An instance may never share or nest a game folder with another profile,
    // including symlink aliases. Preserve installed worlds on conflict.
    for account in &s.storage.data.accounts {
        for previous in s.storage.prefs(&account.username).instances {
            if account.username==username && previous.name==instance.name
                && previous.project_id==instance.project_id {continue;}
            let previous_dir=minecraft::instance_dir(&s.data_root,&account.username,&previous)?;
            instance_guard::independent(&dir,&previous_dir)?;
        }
    }
    // Create every per-player data folder when the instance is saved, not
    // only when a world is first opened in Java/Horizon.
    minecraft::prepare_player_directory(&dir)?;
    if let Some(i) = prefs.instances.iter().position(|p| p.name == instance.name && p.project_id == instance.project_id) {
        prefs.instances[i] = instance;
    } else { prefs.instances.push(instance); }
    s.storage.save_prefs(&username, &prefs)?;
    Ok(s.snapshot())
}
/// The only mutable options in a published project for ordinary players are
/// the installation directory and RAM. All game specs come from the admin catalog.
#[tauri::command]
fn ensure_project_instance(state:State<'_,Mutex<Backend>>,project_id:String,game_dir:String,ram_mb:u32)->Result<Snapshot,String>{
    if game_dir.trim().is_empty(){return Err("Elegí una carpeta para esta instancia".into());}
    let s=locked(&state)?;
    let username=s.username()?.to_owned();
    let project=s.project(&project_id).ok_or("Proyecto inexistente")?;
    if !project.installable || s.project_execution.get(&project_id)==Some(&false){
        return Err("VIS Studios todavía no habilitó este proyecto".into());
    }
    if !(1024..=32768).contains(&ram_mb){return Err("Elegí entre 1 y 32 GB de RAM".into());}
    if game_dir.trim().is_empty(){return Err("Elegí una carpeta donde instalar este proyecto".into());}
    if game_dir.len()>2048{return Err("La ruta elegida es demasiado larga".into());}
    let install_dir=Path::new(&game_dir);
    if !install_dir.is_absolute(){return Err("La carpeta debe ser una ruta absoluta".into());}
    // Do not place game files at a drive/filesystem root.
    if install_dir.parent().is_none_or(|parent|parent.parent().is_none()){
        return Err("Elegí una subcarpeta exclusiva de VIS Worlds, no la raíz del disco".into());
    }
    let mut prefs=s.storage.prefs(&username);
    // Never reuse an old world's folder when VIS Studios changes the required game version.
    let build_key=format!("{}-{}-{}",project_id,project.mc_version,project.loader);
    let name=format!("VIS {}",slug(&build_key).chars().take(55).collect::<String>());
    let already=prefs.instances.iter().position(|i|i.project_id==project_id && i.name==name);
    if let Some(index)=already {
        let previous=&prefs.instances[index];
        let installed=minecraft::instance_dir(&s.data_root,&username,previous)
            .is_ok_and(|folder|minecraft::installed(&folder,previous));
        if installed && previous.game_dir!=game_dir {
            return Err("Para mover una instalación existente, exportala y volvé a importarla en otra carpeta; VIS no borra sus mundos".into());
        }
    }
    let mut ins=already.map(|index|prefs.instances[index].clone()).unwrap_or_default();
    ins.name=name;ins.project_id=project_id.clone();
    ins.engine=project.engine.clone();ins.version=project.mc_version.clone();
    ins.loader=project.loader.clone();ins.loader_version=project.loader_version.clone();
    ins.ram_mb=ram_mb;ins.game_dir=game_dir;ins.source_owner.clear();
    ins.share_offline=ins.engine=="java" && ins.game_dir.is_empty();
    let dir=minecraft::instance_dir(&s.data_root,&username,&ins)?;
    let canonical_dir=fs::canonicalize(&dir).unwrap_or_else(|_|dir.clone());
    for account in &s.storage.data.accounts {
        for previous in s.storage.prefs(&account.username).instances {
            if account.username==username && previous.project_id==project_id && previous.name==ins.name{continue;}
            if let Ok(existing)=minecraft::instance_dir(&s.data_root,&account.username,&previous){
                let canonical_existing=fs::canonicalize(&existing).unwrap_or(existing);
                if canonical_dir==canonical_existing || canonical_dir.starts_with(&canonical_existing) || canonical_existing.starts_with(&canonical_dir){
                    return Err("La carpeta elegida se superpone con otra instancia VIS. Elegí una carpeta independiente".into());
                }
            }
        }
    }
    ins.installed=minecraft::installed(&dir,&ins);
    minecraft::prepare_player_directory(&dir)?;
    if let Some(index)=already {prefs.instances[index]=ins;} else {prefs.instances.push(ins);}
    s.storage.save_prefs(&username,&prefs)?;
    Ok(s.snapshot())
}
#[tauri::command]
fn configure_shared_ram(state:State<'_,Mutex<Backend>>,source_owner:String,project_id:String,name:String,ram_mb:u32)->Result<Snapshot,String>{
    let s=locked(&state)?;
    let username=s.username()?.to_owned();
    if source_owner==username{return Err("Para modificar tu instancia propia usá su configuración".into());}
    if !(1024..=32768).contains(&ram_mb){return Err("La RAM debe estar entre 1024 y 32768 MB".into());}
    let found=s.machine_instances(Some(&username)).iter().any(|i|
        i.source_owner==source_owner && i.project_id==project_id && i.name==name);
    if !found{return Err("La instancia compartida no está disponible en esta computadora".into());}
    let mut prefs=s.storage.prefs(&username);
    prefs.shared_ram.insert(Backend::shared_key(&source_owner,&project_id,&name),ram_mb);
    s.storage.save_prefs(&username,&prefs)?;
    Ok(s.snapshot())
}
/// Hide another VIS profile's installation in the current user's library.
/// No deletion or relocation of the owner's files or Minecraft worlds.
#[tauri::command]
fn set_shared_hidden(
    state:State<'_,Mutex<Backend>>,source_owner:String,project_id:String,name:String,hidden:bool
)->Result<Snapshot,String>{
    let s=locked(&state)?;
    let viewer=s.username()?.to_string();
    if source_owner==viewer{return Err("Las instancias propias se quitan desde su configuración".into());}
    let owner=s.storage.get(&source_owner).ok_or("El propietario ya no existe")?;
    let exists=s.storage.prefs(&owner.username).instances.iter().any(|i|
        i.project_id==project_id&&i.name==name);
    if !exists{return Err("La instalación compartida ya no existe".into());}
    let key=Backend::shared_key(&source_owner,&project_id,&name);
    let mut prefs=s.storage.prefs(&viewer);
    if hidden{prefs.hidden_shared.insert(key);}else{prefs.hidden_shared.remove(&key);}
    s.storage.save_prefs(&viewer,&prefs)?;
    Ok(s.snapshot())
}
/// Resolve the actual per-player game directory from an authorized instance.
/// A shared engine's owner folder is NEVER returned to the visiting player.
fn resolve_player_game_dir(
    s:&Backend, project_id:&str, name:&str, source_owner:Option<&str>
)->Result<PathBuf,String>{
 let (owner,instance,visitor)=if let Some(guest)=s.guest_name.as_ref(){
   let from=source_owner.filter(|v|!v.is_empty())
       .ok_or("Elegí la instalación compartida")?;
   let ins=s.guest_instances().into_iter().find(|i|
     i.source_owner==from&&i.project_id==project_id&&i.name==name)
     .ok_or("La instancia ya no está disponible")?;
   (from.to_owned(),ins,Some(guest.clone()))
 }else{
   let user=s.username()?.to_owned();
   if let Some(from)=source_owner.filter(|v|*v!=user){
     let ins=s.machine_instances(Some(&user)).into_iter().find(|i|
       i.source_owner==from&&i.project_id==project_id&&i.name==name)
       .ok_or("La instancia compartida no está disponible")?;
     (from.to_owned(),ins,Some(user))
   }else{
     let (owner,ins)=checked_instance(s,project_id,name,false)?;
     (owner,ins,None)
   }
 };
 if let Some(visitor)=visitor {
   minecraft::shared_game_directory(&s.data_root,&owner,&instance,&visitor)
 }else {
   minecraft::instance_dir(&s.data_root,&owner,&instance)
 }
}
/// Return the precise save/resource directory for the current player, not the
/// installation owner's location. Useful for copy-path and file import flows.
/// Opt-in recovery of worlds/settings created by older per-profile game
/// directories. Only the currently signed-in VIS profile may recover its own
/// historic files; owner data is never replaced or removed.
#[tauri::command]
async fn recover_shared_instance(
    state:State<'_,Mutex<Backend>>,
    project_id:String,name:String,source_owner:String,apply:bool
)->Result<minecraft::SharedRecovery,String>{
    let (root,owner,instance,visitor)={
        let s=locked(&state)?;
        let visitor=s.username()?.to_owned();
        if source_owner.is_empty()||source_owner==visitor{
            return Err("Elegí una instancia compartida de otro perfil".into());
        }
        let instance=s.machine_instances(Some(&visitor)).into_iter()
            .find(|ins|ins.source_owner==source_owner
                &&ins.project_id==project_id&&ins.name==name)
            .ok_or("Esta instalación compartida no está disponible para tu perfil")?;
        (s.data_root.clone(),source_owner,instance,visitor)
    };
    tauri::async_runtime::spawn_blocking(move||{
        minecraft::shared_recovery(&root,&owner,&instance,&visitor,apply)
    }).await.map_err(|_|"Recuperación de partidas interrumpida".to_string())?
}
// All user-facing backup and repair actions derive the location from an
// authorized installed instance, never an arbitrary filesystem path in JS.
fn game_location_for_operation(
 s:&Backend,project_id:&str,name:&str,source_owner:Option<&str>,owner_only:bool
)->Result<PathBuf,String>{
 let active=s.username()?;
 if owner_only&&source_owner.is_some_and(|owner|!owner.is_empty()&&owner!=active){
    return Err("Solo el propietario puede restaurar o reparar esta instancia".into());
 }
 resolve_player_game_dir(s,project_id,name,source_owner)
}
#[tauri::command]
async fn instance_backups(
 state:State<'_,Mutex<Backend>>,project_id:String,name:String,source_owner:Option<String>
)->Result<Vec<instance_backup::BackupInfo>,String>{
 let dir={
   let s=locked(&state)?;
   game_location_for_operation(&s,&project_id,&name,source_owner.as_deref(),false)?
 };
 tauri::async_runtime::spawn_blocking(move||instance_backup::list(&dir))
    .await.map_err(|_|"No se pudieron consultar las copias".to_string())?
}
/// Owner-only VIS Worlds setting, available even to ordinary players whose
/// installed project specification is otherwise managed by VIS STUDIOS.
#[tauri::command]
fn set_instance_auto_backup(
 state:State<'_,Mutex<Backend>>,project_id:String,name:String,enabled:bool
)->Result<Snapshot,String>{
 let s=locked(&state)?;
 let username=s.username()?.to_owned();
 let mut prefs=s.storage.prefs(&username);
 let instance=prefs.instances.iter_mut()
     .find(|i|i.project_id==project_id&&i.name==name&&i.source_owner.is_empty())
     .ok_or("Solo el propietario puede configurar las copias de esta instancia")?;
 instance.auto_backup=enabled;
 s.storage.save_prefs(&username,&prefs)?;
 Ok(s.snapshot())
}
#[tauri::command]
async fn backup_instance_data(
 state:State<'_,Mutex<Backend>>,project_id:String,name:String,source_owner:Option<String>
)->Result<instance_backup::BackupInfo,String>{
 let dir={
   let s=locked(&state)?;
   game_location_for_operation(&s,&project_id,&name,source_owner.as_deref(),false)?
 };
 tauri::async_runtime::spawn_blocking(move||instance_backup::create(&dir))
    .await.map_err(|_|"La copia se interrumpió".to_string())?
}
#[tauri::command]
async fn restore_instance_data(
 state:State<'_,Mutex<Backend>>,project_id:String,name:String,source_owner:Option<String>,
 backup_name:String,replace:bool,confirmation:String
)->Result<instance_backup::RestoreInfo,String>{
 if confirmation!="RESTAURAR"{return Err("Escribí RESTAURAR para continuar".into());}
 let dir={
   let s=locked(&state)?;
   game_location_for_operation(&s,&project_id,&name,source_owner.as_deref(),true)?
 };
 tauri::async_runtime::spawn_blocking(move||instance_backup::restore(&dir,&backup_name,replace))
    .await.map_err(|_|"La restauración se interrumpió".to_string())?
}
#[tauri::command]
async fn inspect_instance_data(
 state:State<'_,Mutex<Backend>>,project_id:String,name:String,source_owner:Option<String>
)->Result<instance_health::HealthReport,String>{
 let dir={
   let s=locked(&state)?;
   game_location_for_operation(&s,&project_id,&name,source_owner.as_deref(),false)?
 };
 tauri::async_runtime::spawn_blocking(move||instance_health::inspect(&dir))
    .await.map_err(|_|"La revisión se interrumpió".to_string())?
}
#[tauri::command]
async fn repair_instance_data(
 state:State<'_,Mutex<Backend>>,project_id:String,name:String,source_owner:Option<String>
)->Result<instance_health::HealthReport,String>{
 let dir={
   let s=locked(&state)?;
   game_location_for_operation(&s,&project_id,&name,source_owner.as_deref(),true)?
 };
 tauri::async_runtime::spawn_blocking(move||instance_health::repair_missing(&dir))
    .await.map_err(|_|"La reparación se interrumpió".to_string())?
}
#[tauri::command]
async fn merge_shared_servers(
 state:State<'_,Mutex<Backend>>,project_id:String,name:String,source_owner:String,apply:bool
)->Result<server_list::MergeReport,String>{
 let (dir,legacy)={
   let s=locked(&state)?;
   let active=s.username()?.to_owned();
   if source_owner.is_empty()||source_owner==active{
       return Err("Elegí una instancia instalada por otro perfil".into());
   }
   let ins=s.machine_instances(Some(&active)).into_iter().find(|ins|
       ins.source_owner==source_owner&&ins.project_id==project_id&&ins.name==name)
       .ok_or("La instancia compartida no pertenece a esta biblioteca")?;
   if !ins.share_game_data{return Err("Los datos de esta instancia son privados por perfil".into());}
   let dir=minecraft::instance_dir(&s.data_root,&source_owner,&ins)?;
   let legacy=minecraft::recovery_sources(&s.data_root,&source_owner,&ins,&active)?;
   (dir,legacy)
 };
 tauri::async_runtime::spawn_blocking(move||server_list::merge_from_old(&dir,&legacy,apply))
    .await.map_err(|_|"La fusión de servidores se interrumpió".to_string())?
}
#[tauri::command]
fn instance_folder(
    state:State<'_,Mutex<Backend>>,project_id:String,name:String,source_owner:Option<String>
)->Result<String,String>{
 let dir={
   let backend=locked(&state)?;
   resolve_player_game_dir(&backend,&project_id,&name,source_owner.as_deref())?
 };
 minecraft::prepare_player_directory(&dir)?;
 Ok(dir.to_string_lossy().into_owned())
}
/// AppImage libraries can poison gio/xdg-open, so the system file manager is
/// started using the host binaries and a sanitized desktop environment.
/// Never use a shell or arbitrary frontend path: the caller picks only a
/// verified game instance and an explicit folder kind.
fn open_host_folder(target:&Path)->Result<(),String>{
 if !target.is_dir(){return Err("La carpeta de Minecraft no existe".into());}
 #[cfg(target_os="windows")] {
   std::process::Command::new("explorer.exe").arg(target)
       .spawn().map_err(|e|format!("No se pudo iniciar Explorer: {e}"))?;
   return Ok(());
 }
 #[cfg(target_os="macos")] {
   std::process::Command::new("/usr/bin/open").arg(target)
       .spawn().map_err(|e|format!("No se pudo iniciar Finder: {e}"))?;
   return Ok(());
 }
 #[cfg(target_os="linux")] {
   use std::{process::{Command,Stdio},thread,time::{Duration,Instant}};
   let appdir=std::env::var("APPDIR").unwrap_or_default();
   let clean_list=|value:String|{
      value.split(':').filter(|segment|
          !segment.is_empty() && !segment.starts_with("/tmp/.mount_")
          && (appdir.is_empty() || !segment.starts_with(&appdir))
      ).collect::<Vec<_>>().join(":")
   };
   let mut failure="No hay un gestor de archivos disponible".to_owned();
   for (binary,gio) in [("/usr/bin/gio",true),("/usr/bin/xdg-open",false)]{
      if !Path::new(binary).is_file(){continue;}
      let mut command=Command::new(binary);
      if gio{command.arg("open");}
      command.arg(target).stdin(Stdio::null())
          .stdout(Stdio::null()).stderr(Stdio::null());
      for key in ["APPDIR","APPIMAGE","ARGV0","LD_LIBRARY_PATH","LD_PRELOAD",
          "LD_AUDIT","GIO_EXTRA_MODULES","GIO_MODULE_DIR","GTK_PATH",
          "GTK_EXE_PREFIX","GTK_DATA_PREFIX","QT_PLUGIN_PATH",
          "QT_QPA_PLATFORM_PLUGIN_PATH","GDK_PIXBUF_MODULE_FILE","GDK_PIXBUF_MODULEDIR"]{
           command.env_remove(key);
      }
      let path=clean_list(std::env::var("PATH").unwrap_or_default());
      command.env("PATH",if path.is_empty(){"/usr/local/bin:/usr/bin:/bin"}else{&path});
      if let Ok(dirs)=std::env::var("XDG_DATA_DIRS"){
          let clean=clean_list(dirs);
          command.env("XDG_DATA_DIRS",if clean.is_empty(){"/usr/local/share:/usr/share"}else{&clean});
      }
      match command.spawn(){
       Ok(mut child)=>{
         let deadline=Instant::now()+Duration::from_secs(3);
         loop {
           match child.try_wait(){
             Ok(Some(status)) if status.success()=>return Ok(()),
             Ok(Some(status))=>{
                failure=format!("El gestor de archivos salió con estado {}",status.code().unwrap_or(-1));
                break;
             },
             Ok(None) if Instant::now()>=deadline=>return Ok(()),
             Ok(None)=>thread::sleep(Duration::from_millis(75)),
             Err(error)=>{failure=error.to_string();break;}
           }
         }
       },
       Err(error)=>failure=error.to_string()
      }
   }
   Err(format!("{failure}. Podés abrir manualmente: {}",target.display()))
 }
 #[cfg(not(any(target_os="windows",target_os="linux",target_os="macos")))]
 {
    Err("Este sistema no tiene un gestor de archivos compatible".into())
 }
}
#[tauri::command]
async fn open_instance_location(
    state:State<'_,Mutex<Backend>>,project_id:String,name:String,
    source_owner:Option<String>,kind:String
)->Result<String,String>{
 let target_dir={
   let s=locked(&state)?;
   resolve_player_game_dir(&s,&project_id,&name,source_owner.as_deref())?
 };
 let sub=match kind.as_str(){
   "game"=>"",
   "resourcepacks"=>"resourcepacks",
   "shaderpacks"=>"shaderpacks",
   "saves"=>"saves",
   "screenshots"=>"screenshots",
   "logs"=>"logs",
   "mods"=>"mods",
   "config"=>"config",
   _=>return Err("Tipo de carpeta no permitido".into())
 };
 tauri::async_runtime::spawn_blocking(move||{
     minecraft::prepare_player_directory(&target_dir)?;
     let target=if sub.is_empty(){target_dir}else{target_dir.join(sub)};
     open_host_folder(&target)?;
     Ok(target.to_string_lossy().into_owned())
 }).await.map_err(|_|"El explorador de archivos se interrumpió".to_string())?
}

#[tauri::command]
fn delete_instance(
    state: State<'_, Mutex<Backend>>, project_id: String, name: String,
    erase_files: Option<bool>
) -> Result<Snapshot, String> {
    let s=locked(&state)?;
    let username=s.username()?.to_string();
    let mut prefs=s.storage.prefs(&username);
    let current=prefs.instances.iter()
        .find(|p|p.project_id==project_id&&p.name==name)
        .ok_or("No se encontró la instancia en tu biblioteca")?.clone();
    if erase_files.unwrap_or(false){
        // Destructive deletion is only possible for directories created by
        // VIS's new Instancias/<name> layout. Legacy arbitrary paths are
        // deliberately restricted to unlinking the library entry.
        let dir=minecraft::instance_dir(&s.data_root,&username,&current)?;
        let parent=dir.parent().ok_or("La instancia no tiene carpeta padre")?;
        if parent.file_name().and_then(|p|p.to_str())!=Some("Instancias"){
            return Err("Por seguridad, los archivos de las instalaciones antiguas solo pueden eliminarse manualmente. Podés quitar la instancia de VIS conservando los mundos.".into());
        }
        let library=parent.parent().ok_or("Biblioteca de instancia inválida")?;
        if instance_guard::managed_child(library,&name)?!=dir{
            return Err("La carpeta no coincide con la instancia administrada por VIS".into());
        }
        for account in &s.storage.data.accounts{
            for other in s.storage.prefs(&account.username).instances{
                if account.username==username && other.project_id==project_id && other.name==name {continue;}
                if let Ok(folder)=minecraft::instance_dir(&s.data_root,&account.username,&other){
                    instance_guard::independent(&dir,&folder)?;
                }
            }
        }
        if dir.exists(){
            let meta=fs::symlink_metadata(&dir).map_err(|e|e.to_string())?;
            if meta.file_type().is_symlink()||!meta.is_dir(){
                return Err("La carpeta de la instancia no es un directorio seguro".into());
            }
            let has_marker=dir.join(".vis/instance.json").is_file()
                ||dir.join(".vslauncher/install.json").is_file()
                ||dir.join(".vis/horizon.json").is_file();
            if !has_marker && fs::read_dir(&dir).map_err(|e|e.to_string())?.next().is_some(){
                return Err("La carpeta contiene datos sin marca de instalación VIS. Solo puede quitarse de la biblioteca; no se borrarán archivos desconocidos.".into());
            }
            // Use the same per-game guard as Java/Horizon and backup/restore.
            // Never delete a directory that another VIS process is writing to.
            let _deletion_guard=minecraft::acquire_game_run(&dir)?;
            fs::remove_dir_all(&dir).map_err(|e|format!("No se pudieron borrar los archivos: {e}"))?;
        }
    }
    prefs.instances.retain(|p|p.project_id!=project_id||p.name!=name);
    s.storage.save_prefs(&username,&prefs)?;
    Ok(s.snapshot())
}
/// Explicit two-step bulk removal. Unlinking never touches Minecraft files.
/// Physical removal is separately opted-in and allowed only for safely
/// recognized VIS-managed Instancias/<name> directories after full preflight.
#[derive(Deserialize)]
struct InstanceDeleteKey { project_id:String, name:String, #[serde(default)] source_owner:String }
#[tauri::command]
fn delete_instances_batch(
    state: State<'_,Mutex<Backend>>, instances:Vec<InstanceDeleteKey>,
    erase_files:bool, confirmation:String
)->Result<Snapshot,String>{
    if confirmation!="CONFIRMAR" {
        return Err("Escribí exactamente CONFIRMAR antes de eliminar instancias".into());
    }
    if instances.is_empty() || instances.len()>50 {
        return Err("Seleccioná entre 1 y 50 instancias".into());
    }
    let s=locked(&state)?;
    let owner=s.username()?.to_owned();
    let mut prefs=s.storage.prefs(&owner);
    let mut seen=std::collections::BTreeSet::<(String,String,String)>::new();
    let mut chosen=Vec::new();
    for key in &instances {
        if key.name.is_empty() || key.name.len()>80 || key.project_id.len()>130 {
            return Err("Identificador de instancia inválido".into());
        }
        if !seen.insert((key.source_owner.clone(),key.project_id.clone(),key.name.clone())) {
            return Err("Hay instancias seleccionadas repetidas".into());
        }
        if !key.source_owner.is_empty() {
            if erase_files {
                return Err("Las instancias de otros perfiles solo pueden ocultarse; desactivá borrar archivos".into());
            }
            let exists=s.machine_instances(Some(&owner)).iter().any(|p|
                p.source_owner==key.source_owner&&p.project_id==key.project_id&&p.name==key.name);
            if !exists {
                return Err("La instancia compartida ya no existe o está oculta".into());
            }
            prefs.hidden_shared.insert(Backend::shared_key(
                &key.source_owner,&key.project_id,&key.name));
            continue;
        }
        let item=prefs.instances.iter()
            .find(|p|p.project_id==key.project_id&&p.name==key.name)
            .ok_or("Una instancia seleccionada ya no pertenece a este perfil")?;
        if !item.source_owner.is_empty() {
            return Err("No podés borrar las instancias de otro usuario".into());
        }
        chosen.push(item.clone());
    }
    let mut folders=Vec::new();
    if erase_files {
        for instance in &chosen {
            let dir=minecraft::instance_dir(&s.data_root,&owner,instance)?;
            let parent=dir.parent().ok_or("Carpeta de instancia inválida")?;
            if parent.file_name().and_then(|p|p.to_str())!=Some("Instancias"){
                return Err("La eliminación física solo permite instancias nuevas de VIS bajo Instancias/<nombre>. Desmarcá borrar archivos para conservar las instalaciones antiguas.".into());
            }
            let library=parent.parent().ok_or("Biblioteca inválida")?;
            if instance_guard::managed_child(library,&instance.name)?!=dir {
                return Err("La carpeta seleccionada no corresponde con una instancia VIS administrada".into());
            }
            // A saved game may be owned/referenced by another local account.
            for account in &s.storage.data.accounts {
                for other in s.storage.prefs(&account.username).instances {
                    if account.username==owner && other.project_id==instance.project_id
                        && other.name==instance.name {continue;}
                    let other_dir=minecraft::instance_dir(&s.data_root,&account.username,&other)?;
                    instance_guard::independent(&dir,&other_dir)?;
                }
            }
            if dir.exists() {
                let meta=fs::symlink_metadata(&dir).map_err(|e|e.to_string())?;
                if meta.file_type().is_symlink()||!meta.is_dir(){
                    return Err("La carpeta no es un directorio seguro".into());
                }
                let marked=dir.join(".vis/instance.json").is_file()
                    ||dir.join(".vslauncher/install.json").is_file()
                    ||dir.join(".vis/horizon.json").is_file();
                if !marked && fs::read_dir(&dir).map_err(|e|e.to_string())?.next().is_some(){
                    return Err("Una carpeta contiene archivos sin marca VIS. No se eliminarán; usá quitar de la biblioteca.".into());
                }
            }
            folders.push(dir);
        }
    }
    // Lock EVERY writable game folder before deleting ANY selected folder.
    // Holding all locks until the operation ends avoids a race between
    // preflight and Minecraft launching from another VIS process.
    let mut deletion_guards=Vec::new();
    for folder in &folders {
        if folder.exists(){
            deletion_guards.push(minecraft::acquire_game_run(folder)?);
        }
    }
    for folder in &folders {
        if folder.exists(){
            fs::remove_dir_all(folder)
                .map_err(|e|format!("No se pudo eliminar {}: {e}. Revisá el estado antes de reintentar.",folder.display()))?;
        }
    }
    drop(deletion_guards);
    prefs.instances.retain(|item|!seen.contains(&(String::new(),item.project_id.clone(),item.name.clone())));
    s.storage.save_prefs(&owner,&prefs)?;
    Ok(s.snapshot())
}

#[tauri::command]
fn request_friend(state: State<'_, Mutex<Backend>>, username: String) -> Result<Snapshot, String> {
    let mut s = locked(&state)?;
    let from = s.username()?.to_string();
    s.storage.request_friend(&from, &username)?;
    Ok(s.snapshot())
}
#[tauri::command]
fn accept_friend(state: State<'_, Mutex<Backend>>, username: String) -> Result<Snapshot, String> {
    let mut s = locked(&state)?;
    let to = s.username()?.to_string();
    s.storage.accept_friend(&to, &username)?;
    Ok(s.snapshot())
}
#[tauri::command]
fn send_message(state: State<'_, Mutex<Backend>>, to: String, body: String) -> Result<Snapshot, String> {
    let mut s = locked(&state)?;
    let from = s.username()?.to_string();
    s.storage.send_message(&from, &to, &body)?;
    Ok(s.snapshot())
}
fn mime_from(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"), "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"), _ => None,
    }
}
fn image_magic_ok(mime: &str, bytes: &[u8]) -> bool {
    match mime {
        "image/png" => bytes.starts_with(&[137,80,78,71,13,10,26,10]),
        "image/jpeg" => bytes.starts_with(&[0xff,0xd8,0xff]),
        "image/webp" => bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
        _ => false,
    }
}
fn asset_data_url(path: &Path) -> Result<String, String> {
    let mime = mime_from(path).ok_or("Formato de imagen no permitido")?;
    let meta = fs::metadata(path).map_err(|e|e.to_string())?;
    if meta.len() > 12 * 1024 * 1024 { return Err("Imagen demasiado grande (máximo 12 MB)".into()); }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    if !image_magic_ok(mime, &bytes) { return Err("La imagen no tiene un formato válido".into()); }
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(&bytes)))
}
fn asset_dir(s: &Backend) -> PathBuf { s.data_root.join("assets") }
#[tauri::command]
fn import_asset(state: State<'_, Mutex<Backend>>, path: String, kind: String, project_id: Option<String>, stage_only: Option<bool>) -> Result<AssetReply, String> {
    let mut s = locked(&state)?;
    let username = s.username()?.to_string();
    if !["avatar", "skin", "cape", "avatar_layer", "profile_banner"].contains(&kind.as_str()) { s.admin()?; }
    if !["avatar", "skin", "cape", "avatar_layer", "profile_banner", "banner", "logo", "icon", "home", "login", "launcher_logo"].contains(&kind.as_str()) {
        return Err("Tipo de recurso no permitido".into());
    }
    if project_id.is_some() && !["banner", "logo", "icon"].contains(&kind.as_str()) {return Err("Tipo de recurso incompatible".into());}
    if let Some(ref id) = project_id { if slug(id) != *id { return Err("ID inválido".into()); } }
    if stage_only.unwrap_or(false) && !["avatar", "profile_banner"].contains(&kind.as_str()) {
        return Err("Solo se permite previsualizar avatares y banners de perfil".into());
    }
    let source = PathBuf::from(path);
    let mime = mime_from(&source).ok_or("Seleccioná PNG, JPG o WebP")?;
    let bytes = fs::read(&source).map_err(|e| e.to_string())?;
    if bytes.len() > 12 * 1024 * 1024 || bytes.is_empty() { return Err("Imagen vacía o mayor a 12 MB".into()); }
    if !image_magic_ok(mime, &bytes) { return Err("Formato de imagen incorrecto".into()); }
    if ["skin","cape"].contains(&kind.as_str()) && mime != "image/png" { return Err("Las skins y capas locales deben ser PNG".into()); }
    if kind=="skin" {
        if bytes.len()<24 {return Err("PNG inválido".into())}
        let w=u32::from_be_bytes(bytes[16..20].try_into().unwrap());
        let h=u32::from_be_bytes(bytes[20..24].try_into().unwrap());
        if w!=64 || (h!=64 && h!=32) {return Err("La skin debe medir 64×64 o 64×32 píxeles".into());}
    }
    let directory = asset_dir(&s);
    fs::create_dir_all(&directory).map_err(|e|e.to_string())?;
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e|e.to_string())?.as_nanos();
    let ext = source.extension().and_then(|e| e.to_str()).unwrap_or("png").to_ascii_lowercase();
    let owner = project_id.as_deref().unwrap_or(&username);
    let target = directory.join(format!("{}-{}-{}.{}", slug(owner), kind, stamp, ext));
    fs::write(&target, &bytes).map_err(|e|e.to_string())?;
    let target_str = target.to_string_lossy().into_owned();
    if stage_only.unwrap_or(false) { return Ok(AssetReply { path:target_str, data_url:format!("data:{mime};base64,{}",STANDARD.encode(bytes)) }); }
    match kind.as_str() {
        "avatar" => {
            if let Some(user) = s.storage.get_mut(&username) {user.avatar = target_str.clone();}
            s.storage.save()?;
        }
        "skin" => {
            if let Some(user) = s.storage.get_mut(&username) {user.skin = target_str.clone();}
            s.storage.save()?;
        }
        "cape" => {
            if let Some(user) = s.storage.get_mut(&username) {user.cape = target_str.clone();}
            s.storage.save()?;
        }
        "profile_banner" => {
            if let Some(user) = s.storage.get_mut(&username) {user.profile_banner = target_str.clone();}
            s.storage.save()?;
        }
        "avatar_layer" => {
            if mime != "image/png" {return Err("La capa de avatar debe ser PNG transparente".into())}
            if let Some(user) = s.storage.get_mut(&username) {user.avatar_layer = target_str.clone();}
            s.storage.save()?;
        }
        "home" => {s.branding.home_image=target_str.clone();atomic_json(&s.branding_path,&s.branding)?;}
        "login" => {s.branding.login_image=target_str.clone();atomic_json(&s.branding_path,&s.branding)?;}
        "launcher_logo" => {s.branding.launcher_logo=target_str.clone();atomic_json(&s.branding_path,&s.branding)?;}
        _ => {} // Project images are assigned when the admin saves the project draft.
    }
    Ok(AssetReply { path:target_str, data_url:format!("data:{mime};base64,{}",STANDARD.encode(bytes)) })
}
#[tauri::command]
fn save_cropped_asset(state: State<'_, Mutex<Backend>>, data_url: String, kind: String, project_id: Option<String>) -> Result<AssetReply, String> {
    let mut s = locked(&state)?;
    let username = s.username()?.to_owned();
    let personal = ["avatar", "profile_banner"].contains(&kind.as_str());
    if !personal {s.admin()?;}
    if !personal && !["banner", "logo", "icon"].contains(&kind.as_str()) {
        return Err("Tipo de recorte no permitido".into());
    }
    if personal && project_id.is_some() {return Err("No se permite asociar recursos personales a proyectos".into());}
    if let Some(ref id) = project_id {
        if slug(id) != *id { return Err("ID de proyecto inválido".into()); }
    }
    let payload = data_url.strip_prefix("data:image/png;base64,")
        .ok_or_else(|| "El recorte debe ser PNG".to_string())?;
    if payload.is_empty() || payload.len() > 16 * 1024 * 1024 { return Err("Recorte demasiado grande".into()); }
    let bytes = STANDARD.decode(payload).map_err(|_| "PNG no válido".to_string())?;
    if bytes.len() > 12 * 1024 * 1024 || !image_magic_ok("image/png", &bytes) {
        return Err("Recorte PNG incorrecto o demasiado grande".into());
    }
    let directory = asset_dir(&s);
    fs::create_dir_all(&directory).map_err(|e|e.to_string())?;
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e|e.to_string())?.as_nanos();
    let owner = project_id.as_deref().unwrap_or(&username);
    let target = directory.join(format!("{}-{}-crop-{}.png",slug(owner),kind,stamp));
    fs::write(&target,&bytes).map_err(|e|e.to_string())?;
    let target_string = target.to_string_lossy().into_owned();
    if personal {
        if let Some(account) = s.storage.get_mut(&username) {
            if kind=="avatar" {account.avatar=target_string.clone();}
            else {account.profile_banner=target_string.clone();}
        }
        s.storage.save()?;
    }
    Ok(AssetReply {path:target_string,data_url:format!("data:image/png;base64,{}",STANDARD.encode(&bytes))})
}
/// Removes an image assignment, not the original imported file. Existing files remain reusable.
#[tauri::command]
fn clear_asset(state: State<'_, Mutex<Backend>>, kind: String) -> Result<Snapshot, String> {
    let mut s=locked(&state)?;
    match kind.as_str() {
        "avatar" | "skin" | "cape" | "avatar_layer" | "profile_banner" => {
            let username=s.username()?.to_owned();
            let user=s.storage.get_mut(&username).ok_or("Cuenta inexistente")?;
            match kind.as_str() {
                "avatar" => user.avatar.clear(), "skin"=>user.skin.clear(), "cape"=>user.cape.clear(),
                "avatar_layer"=>user.avatar_layer.clear(), "profile_banner"=>user.profile_banner.clear(), _=>{}
            }
            s.storage.save()?;
        }
        "launcher_logo" | "home" => {
            s.admin()?;
            if kind=="launcher_logo" {s.branding.launcher_logo.clear();}
            else {s.branding.home_image.clear();}
            atomic_json(&s.branding_path,&s.branding)?;
        }
        _ => return Err("Recurso no removible".into()),
    }
    Ok(s.snapshot())
}
#[tauri::command]
fn commit_profile_asset(state:State<'_,Mutex<Backend>>,path:String,kind:String)->Result<Snapshot,String>{
    let mut s=locked(&state)?;
    let username=s.username()?.to_owned();
    if !["avatar","profile_banner"].contains(&kind.as_str()) {return Err("Recurso personal no válido".into())}
    let file=PathBuf::from(path).canonicalize().map_err(|e|e.to_string())?;
    let root=asset_dir(&s).canonicalize().map_err(|e|e.to_string())?;
    if !file.starts_with(root) {return Err("Recurso fuera de biblioteca".into())}
    asset_data_url(&file)?;
    let account=s.storage.get_mut(&username).ok_or("Cuenta no encontrada")?;
    if kind=="avatar" {account.avatar=file.to_string_lossy().into_owned();}
    else {account.profile_banner=file.to_string_lossy().into_owned();}
    s.storage.save()?;
    Ok(s.snapshot())
}
#[tauri::command]
fn preview_asset(state: State<'_, Mutex<Backend>>, path: String) -> Result<String, String> {
    let s = locked(&state)?;
    if s.guest_name.is_none() {s.username()?;}
    let requested = PathBuf::from(path).canonicalize().map_err(|e|e.to_string())?;
    let directory = asset_dir(&s).canonicalize().map_err(|e|e.to_string())?;
    if !requested.starts_with(&directory) {return Err("Recurso fuera del directorio autorizado".into());}
    asset_data_url(&requested)
}
#[tauri::command]
fn save_brand_name(state: State<'_, Mutex<Backend>>, name: String) -> Result<Snapshot,String> {
    let mut s = locked(&state)?;
    s.admin()?;
    if name.trim().is_empty() || name.chars().count() > 40 {return Err("Nombre no válido".into());}
    s.branding.name = name.trim().into();
    atomic_json(&s.branding_path, &s.branding)?;
    Ok(s.snapshot())
}

// Minecraft Java / Fabric / Modrinth: direct service layer over the existing account and project state.
// Admin policy is ALWAYS validated by Rust before a game process is spawned.
fn checked_instance(s:&Backend,project_id:&str,name:&str,require_enabled:bool)->Result<(String,Instance),String>{
    let username=s.username()?.to_owned();
    // Personal profiles belong to the authenticated local account and are not
    // governed by publication flags of administrator-owned Virgoland projects.
    if project_id != PERSONAL_PROJECT_ID {
        let project=s.project(project_id).ok_or("Proyecto inexistente")?;
        if require_enabled && (!project.installable || s.project_execution.get(project_id)==Some(&false)) {
            return Err("El administrador deshabilitó la ejecución de este proyecto".into());
        }
    }
    let instance=s.storage.prefs(&username).instances.into_iter()
        .find(|i|i.project_id==project_id&&i.name==name).ok_or("Instancia inexistente")?;
    Ok((username,instance))
}
#[tauri::command]
fn set_project_execution(state:State<'_,Mutex<Backend>>,project_id:String,enabled:bool)->Result<Snapshot,String>{
    let mut s=locked(&state)?;s.admin()?;
    if !s.catalog.projects.iter().any(|p|p.id==project_id){return Err("Proyecto inexistente".into())}
    s.project_execution.insert(project_id,enabled);
    atomic_json(&s.execution_path,&s.project_execution)?;
    Ok(s.snapshot())
}
#[tauri::command]
async fn minecraft_versions()->Result<Vec<minecraft::VersionChoice>,String>{
    tauri::async_runtime::spawn_blocking(minecraft::get_versions).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn fabric_loaders(version:String)->Result<Vec<String>,String>{
    tauri::async_runtime::spawn_blocking(move||minecraft::get_fabric_loaders(&version)).await.map_err(|e|e.to_string())?
}
#[tauri::command]
fn horizon_source_build()->Result<String,String>{
    horizon::bundled_source_path()
}
#[tauri::command]
async fn horizon_diagnostics(state:State<'_,Mutex<Backend>>,project_id:String,name:String)->Result<Vec<horizon::HorizonCheck>,String>{
    let (owner,instance,root)={let s=locked(&state)?;let(u,i)=checked_instance(&s,&project_id,&name,false)?;(u,i,s.data_root.clone())};
    if instance.engine!="horizon"{return Err("No es una instancia Horizon".into())}
    tauri::async_runtime::spawn_blocking(move||{
        let dir=minecraft::instance_dir(&root,&owner,&instance)?;
        Ok::<Vec<horizon::HorizonCheck>,String>(horizon::diagnostics(&dir,&instance))
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn horizon_installed_builds(state:State<'_,Mutex<Backend>>)->Result<Vec<horizon_download::LibraryBuild>,String>{
    let root={let s=locked(&state)?;s.username()?;s.data_root.clone()};
    tauri::async_runtime::spawn_blocking(move||horizon_download::installed_library(&root))
        .await.map_err(|e|e.to_string())
}
#[tauri::command]
async fn horizon_local_builds()->Result<Vec<String>,String>{
    tauri::async_runtime::spawn_blocking(horizon::find_local_builds).await.map_err(|e|e.to_string())
}
#[tauri::command]
async fn horizon_probe(state:State<'_,Mutex<Backend>>,project_id:String,name:String)->Result<horizon::Probe,String>{
    let (owner,instance,root)={let s=locked(&state)?;let(u,i)=checked_instance(&s,&project_id,&name,false)?;(u,i,s.data_root.clone())};
    if instance.engine!="horizon" {return Err("No es una instancia Horizon".into())}
    tauri::async_runtime::spawn_blocking(move||{
        let dir=minecraft::instance_dir(&root,&owner,&instance)?;
        horizon::inspect(&dir,&instance)
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn launch_horizon(
    app:tauri::AppHandle,state:State<'_,Mutex<Backend>>,
    ms:State<'_,Mutex<microsoft::MicrosoftState>>,
    project_id:String,name:String,session_file:String,source_owner:Option<String>
)->Result<minecraft::LaunchResult,String>{
    let (owner,mut instance,root,visitor,active,is_ms_profile,guest) = {
        let s=locked(&state)?;
        if let Some(nick)=s.guest_name.as_ref(){
            // Guest mode may use installed game resources, but cannot consume a
            // Microsoft session. Every guest has separate saves and settings.
            if !session_file.is_empty(){
                return Err("El modo offline no admite sesiones Microsoft manuales".into());
            }
            let source=source_owner.as_deref().filter(|v|!v.is_empty())
                .ok_or("Elegí la instancia Horizon instalada para jugar offline")?;
            let ins=s.guest_instances().into_iter()
                .find(|i|i.engine=="horizon"&&i.source_owner==source
                    && i.name==name && i.project_id==project_id)
                .ok_or("La instancia Horizon no está disponible para modo offline")?;
            (source.to_owned(),ins,s.data_root.clone(),Some(nick.clone()),
                String::new(),false,Some(nick.clone()))
        }else{
            let active=s.username()?.to_owned();
            let is_ms_profile=s.storage.get(&active).is_some_and(|a|a.microsoft_linked);
            let from=source_owner.as_deref().filter(|o|*o!=active);
            let (owner,instance)=if let Some(other)=from {
                let ins=s.machine_instances(Some(&active)).into_iter()
                    .find(|i|i.engine=="horizon"&&i.project_id==project_id
                        && i.name==name&&i.source_owner==other)
                    .ok_or("Horizon compartido no está instalado")?;
                (other.to_owned(),ins)
            }else{checked_instance(&s,&project_id,&name,true)?};
            (owner,instance,s.data_root.clone(),from.map(|_|active.clone()),
                active,is_ms_profile,None)
        }
    };
    if instance.engine!="horizon"{return Err("No es una instancia Horizon".into());}
    let credential=if guest.is_some() {
        None
    } else if session_file.is_empty() {
        let identity=ms.lock().map_err(|_|"Sesión Microsoft bloqueada")?
            .game_identity(&active)?;
        if is_ms_profile&&identity.is_none(){
            return Err("Volvé a conectar Microsoft para ejecutar Horizon en modo premium".into());
        }
        identity
    }else{None};
    // The game supports --name but VIS previously omitted it when no per-
    // instance override was configured; Horizon then generated Player000xx.
    // Never overwrite the verified name from a Premium session.
    if credential.is_none() && session_file.is_empty() {
        let suggested=guest.as_deref().unwrap_or(&active);
        instance.player_name=minecraft::offline_player_name(suggested,&instance.player_name)?;
        if guest.is_some(){instance.player_name=suggested.to_owned();}
    }
    tauri::async_runtime::spawn_blocking(move||{
        let dir=minecraft::instance_dir(&root,&owner,&instance)?;
        // Only the owner opts into backups. Visitors and guests cannot write
        // snapshots of somebody else's shared game without permission.
        if instance.auto_backup && instance.installed && visitor.is_none(){
            instance_backup::create_if_due(&dir)?;
        }
        let session_path=if let Some(ref auth)=credential {
            Some(microsoft::temporary_horizon_session(&root,auth)?)
        }else{None};
        let effective=session_path.as_ref()
            .map(|p|p.to_string_lossy().into_owned())
            .unwrap_or(session_file);
        let outcome=if let Some(player)=visitor {
            let game_dir=minecraft::shared_game_directory(&root,&owner,&instance,&player)?;
            horizon::launch_shared(&app,&dir,&instance,&effective,&game_dir)
        }else{horizon::launch(&app,&dir,&instance,&effective)};
        if let Some(path)=session_path{let _=fs::remove_file(path);}
        outcome
    }).await.map_err(|e|e.to_string())?
}

#[tauri::command]
fn download_jobs(state:State<'_,Mutex<Backend>>)->Result<Vec<download_manager::DownloadJob>,String>{
    let s=locked(&state)?;
    download_manager::list(s.username()?)
}
#[tauri::command]
fn cancel_download(app:tauri::AppHandle,state:State<'_,Mutex<Backend>>,id:u64)
    ->Result<download_manager::DownloadJob,String>{
    let s=locked(&state)?;
    download_manager::cancel(&app,s.username()?,id)
}
#[tauri::command]
async fn install_minecraft(app:tauri::AppHandle,state:State<'_,Mutex<Backend>>,project_id:String,name:String)->Result<Snapshot,String>{
    let (username,instance,data_root,other_instances,curated_mods)={
        let s=locked(&state)?;
        let (u,i)=checked_instance(&s,&project_id,&name,true)?;
        let curated_mods=s.project(&project_id).filter(|p|p.engine=="java")
            .map(|p|p.modrinth_mods.clone());
        let other=s.storage.prefs(&u).instances.into_iter()
            .filter(|item|item.name!=i.name || item.project_id!=i.project_id)
            .filter_map(|item|minecraft::instance_dir(&s.data_root,&u,&item).ok())
            .collect::<Vec<_>>();
        let mut other=other;
        if !i.reuse_source.trim().is_empty(){other.push(PathBuf::from(&i.reuse_source));}
        (u,i,s.data_root.clone(),other,curated_mods)
    };
    let cloned_app=app.clone();let chosen=instance.clone();let user=username.clone();
    let prepared=tauri::async_runtime::spawn_blocking(move||->Result<Instance,String>{
        let mut job=download_manager::begin(&cloned_app,&user,&format!("{} · {}",chosen.name,
            if chosen.engine=="horizon"{"Horizon Rust"}else{"Minecraft Java"}))?;
        let result=(||->Result<Instance,String>{
        let mut chosen=chosen;
        download_manager::checkpoint()?;
        if chosen.engine=="horizon" {
            let dir=minecraft::instance_dir(&data_root,&user,&chosen)?;
            // Lite launcher: no Horizon game in AppImage or Windows installer.
            // Fetch only when a player installs the Rust instance; the fork
            // publishes both platform binaries and does not contain Mojang IP.
            // A prior VIS release may refer to a removed build directory.
            // Reinstall the immutable fork engine if the old *path* vanished,
            // while preserving this instance's saves/configuration untouched.
            // Existing files with invalid hashes are never silently trusted.
            if chosen.horizon_build_dir.is_empty()
                || chosen.horizon_build_dir==horizon::SOURCE_BUILD_ID
                || !Path::new(&chosen.horizon_build_dir).is_dir() {
                let game=horizon_download::install_fork(&cloned_app,&dir,&chosen.version)?;
                download_manager::checkpoint()?;
                chosen.horizon_build_dir=game.build_dir;
            }
            chosen.horizon_build_dir=horizon::install_instance_engine(&dir,&chosen)?;
            download_manager::checkpoint()?;
            if !horizon::private_mojang_ready(&dir,&chosen){
                let (mc,server,jdk)=minecraft::horizon_prerequisites(&cloned_app,&data_root,&user,&chosen,&other_instances)?;
                chosen.horizon_minecraft_dir=mc;
                chosen.horizon_server_jar=server;
                chosen.java_path=jdk;
            }
            download_manager::checkpoint()?;
            let dir=minecraft::instance_dir(&data_root,&user,&chosen)?;
            horizon::prepare(&cloned_app,&dir,&chosen)?;
            download_manager::checkpoint()?;
        } else {
            chosen.java_path.clear();
            minecraft::install(&cloned_app,&data_root,&user,&chosen,&other_instances)?;
            download_manager::checkpoint()?;
            if let Some(mod_ids)=curated_mods.as_ref() {
                project_mods::sync(&data_root,&user,&chosen,mod_ids)?;
            }
        }
        download_manager::checkpoint()?;
        Ok(chosen)
        })();
        job.finish(&result);
        result
    }).await.map_err(|e|e.to_string())??;
    let s=locked(&state)?;
    let mut prefs=s.storage.prefs(&username);
    if let Some(i)=prefs.instances.iter_mut().find(|i|i.project_id==project_id&&i.name==name){
        i.horizon_build_dir=prepared.horizon_build_dir;
        i.horizon_minecraft_dir=prepared.horizon_minecraft_dir;
        i.horizon_server_jar=prepared.horizon_server_jar;
        i.java_path=prepared.java_path;
        i.installed=minecraft::installed(&minecraft::instance_dir(&s.data_root,&username,i)?,i);
        let dir=minecraft::instance_dir(&s.data_root,&username,i)?;
        atomic_json(&dir.join(".vis/instance.json"),i)?;
    }
    s.storage.save_prefs(&username,&prefs)?;
    Ok(s.snapshot())
}
/// Apply the published project's exact Modrinth set. No custom URLs or
/// arbitrary mod IDs are accepted from the frontend at update time.
#[tauri::command]
async fn sync_project_mods(
    state:State<'_,Mutex<Backend>>,project_id:String,name:String
) -> Result<project_mods::SyncReport,String> {
    let (username,ins,root,mods)={
        let s=locked(&state)?;
        let (username,ins)=checked_instance(&s,&project_id,&name,true)?;
        let project=s.project(&project_id).ok_or("Proyecto inexistente")?;
        if project.engine!="java" || project.mc_version!=ins.version ||
           project.loader!=ins.loader || project.loader_version!=ins.loader_version {
            return Err("La versión/motor del proyecto cambió: prepará una instancia nueva sin borrar la anterior".into());
        }
        (username,ins,s.data_root.clone(),project.modrinth_mods.clone())
    };
    tauri::async_runtime::spawn_blocking(move||
        project_mods::sync(&root,&username,&ins,&mods))
        .await.map_err(|e|e.to_string())?
}

// Portable VIS Worlds exports contain the instance folder but no launcher
// account database or administrator credentials. All heavy ZIP work is off the
// UI thread, and imported names cannot replace existing instances.
#[tauri::command]
async fn export_worlds_instance(state:State<'_,Mutex<Backend>>,project_id:String,name:String,destination:String)->Result<String,String>{
    let (dir,instance)={let s=locked(&state)?;
        let (username,instance)=checked_instance(&s,&project_id,&name,false)?;
        (minecraft::instance_dir(&s.data_root,&username,&instance)?,instance)
    };
    tauri::async_runtime::spawn_blocking(move||ombu::export_instance(&dir,&instance,Path::new(&destination)))
        .await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn import_worlds_instance(state:State<'_,Mutex<Backend>>,archive:String,library:String)->Result<Snapshot,String>{
    let (username,taken)={let s=locked(&state)?;
        let username=s.username()?.to_owned();
        let taken=s.storage.prefs(&username).instances.into_iter().map(|i|i.name).collect::<Vec<_>>();
        (username,taken)
    };
    let imported=tauri::async_runtime::spawn_blocking(move||ombu::import_instance(Path::new(&archive),Path::new(&library),&taken))
        .await.map_err(|e|e.to_string())??;
    let s=locked(&state)?;
    let mut prefs=s.storage.prefs(&username);
    if prefs.instances.iter().any(|i|i.name.eq_ignore_ascii_case(&imported.name)) {
       return Err("La instancia ya existe. Volvé a importar con otro nombre.".into());
    }
    prefs.instances.push(imported);
    s.storage.save_prefs(&username,&prefs)?;
    Ok(s.snapshot())
}

#[tauri::command]
async fn launch_minecraft(app:tauri::AppHandle,state:State<'_,Mutex<Backend>>,ms:State<'_,Mutex<microsoft::MicrosoftState>>,project_id:String,name:String,source_owner:Option<String>)->Result<minecraft::LaunchResult,String>{
    // Release the global account/project mutex BEFORE Java discovery, file I/O
    // and process spawning. A slow disk cannot freeze other launcher commands.
    let (owner,ins,data_root,guest_name,project_mod_list)={
        let s=locked(&state)?;
        let guest_name=s.guest_name.clone();
        let project_mod_list=if s.guest_name.is_none() &&
            source_owner.as_deref().is_none_or(|owner|owner==s.username().unwrap_or("")) {
            let owned=s.storage.prefs(s.username().unwrap_or("")).instances.into_iter()
                .find(|i|i.project_id==project_id&&i.name==name);
            owned.as_ref().and_then(|instance|s.project(&project_id).filter(|p|
                p.engine=="java" && p.mc_version==instance.version &&
                p.loader==instance.loader && p.loader_version==instance.loader_version
            )).map(|p|p.modrinth_mods.clone())
        } else {None};
        let (owner,ins)=if let Some(guest)=s.guest_name.as_deref() {
            let source=source_owner.ok_or("Elegí una instancia instalada")?;
            let mut ins=s.guest_instances().into_iter()
                .find(|i|i.project_id==project_id && i.name==name && i.source_owner==source)
                .ok_or("Instancia instalada no disponible en esta computadora")?;
            ins.java_path.clear();
            ins.player_name=guest.to_owned();
            (source,ins)
        }else if source_owner.as_deref().is_some_and(|owner|owner!=s.username().unwrap_or("")) {
            let source=source_owner.as_deref().unwrap_or("");
            let mut ins=s.machine_instances(Some(s.username()?)).into_iter()
                .find(|i|i.project_id==project_id && i.name==name && i.source_owner==source)
                .ok_or("Instancia compartida no disponible")?;
            let visiting_prefs=s.storage.prefs(s.username()?);
            if let Some(ram)=visiting_prefs.shared_ram.get(&Backend::shared_key(source,&project_id,&name)){
                ins.ram_mb=*ram;
            }
            ins.player_name=s.username()?.to_owned();
            (source.to_owned(),ins)
        }else{
            checked_instance(&s,&project_id,&name,true)?
        };
        (owner,ins,s.data_root.clone(),guest_name,project_mod_list)
    };
    if ins.engine=="horizon" {return Err("Las instancias Horizon requieren cuenta Microsoft; usá el motor Horizon en VIS Worlds".into())}
    let launch_app=app.clone();
    let active={let s=locked(&state)?;s.active_user.clone()};
    // A Microsoft profile must never silently launch in offline mode.
    let credential=if let Some(ref user)=active {
        let is_premium={let b=locked(&state)?;
            b.storage.get(user).is_some_and(|account|account.microsoft_linked)};
        let session=ms.lock().map_err(|_|"Sesión Microsoft bloqueada")?;
        let found=session.game_identity(user)?;
        if is_premium && found.is_none(){
            return Err("Iniciá sesión nuevamente con Microsoft para jugar en modo premium".into());
        }
        found
    }else{None};
    let shared=ins.source_owner.len()>0;
    let result=tauri::async_runtime::spawn_blocking(move||{
        if !shared && guest_name.is_none() && ins.auto_backup && ins.installed {
            let dir=minecraft::instance_dir(&data_root,&owner,&ins)?;
            instance_backup::create_if_due(&dir)?;
        }
        if shared || guest_name.is_some() {
            let player=guest_name.or(active).ok_or("Falta el perfil que ejecuta la instancia")?;
            if let Some(ref premium)=credential{
                minecraft::launch_shared_premium(&launch_app,&data_root,&owner,&ins,&player,premium)
            }else{
                minecraft::launch_shared(&launch_app,&data_root,&owner,&ins,&player)
            }
        } else {
            if let Some(mods)=project_mod_list.as_ref() {
                project_mods::sync(&data_root,&owner,&ins,mods)?;
            }
            if let Some(ref premium)=credential{
                minecraft::launch_premium(&launch_app,&data_root,&owner,&ins,premium)
            }else{minecraft::launch(&launch_app,&data_root,&owner,&ins)}
        }
    })
        .await.map_err(|e|e.to_string())??;
    if let Some(window)=app.get_webview_window("main"){let _=window.minimize();}
    Ok(result)
}
#[tauri::command]
async fn search_modrinth(state:State<'_,Mutex<Backend>>,query:String,version:String,kind:String)->Result<Vec<minecraft::ModHit>,String>{
    {locked(&state)?.username()?;}
    tauri::async_runtime::spawn_blocking(move||minecraft::search_modrinth(&query,&version,&kind))
      .await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn install_modrinth(state:State<'_,Mutex<Backend>>,project_id:String,name:String,mod_id:String,kind:String)->Result<Vec<String>,String>{
    let (user,ins,root)={let s=locked(&state)?;let(u,i)=checked_instance(&s,&project_id,&name,false)?;(u,i,s.data_root.clone())};
    tauri::async_runtime::spawn_blocking(move||minecraft::install_modrinth(&root,&user,&ins,&mod_id,&kind))
      .await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn import_instance_file(state:State<'_,Mutex<Backend>>,project_id:String,name:String,path:String,kind:String)->Result<minecraft::InstalledFile,String>{
    let (u,i,root)={let s=locked(&state)?;let (u,i)=checked_instance(&s,&project_id,&name,false)?;(u,i,s.data_root.clone())};
    tauri::async_runtime::spawn_blocking(move||minecraft::import_local(&root,&u,&i,Path::new(&path),&kind))
        .await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn list_instance_files(state:State<'_,Mutex<Backend>>,project_id:String,name:String)->Result<Vec<minecraft::InstalledFile>,String>{
    let (u,i,root)={let s=locked(&state)?;let(u,i)=checked_instance(&s,&project_id,&name,false)?;(u,i,s.data_root.clone())};
    tauri::async_runtime::spawn_blocking(move||minecraft::list_local(&root,&u,&i))
        .await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn toggle_instance_file(state:State<'_,Mutex<Backend>>,project_id:String,name:String,kind:String,file:String)->Result<String,String>{
    let (u,i,root)={let s=locked(&state)?;let(u,i)=checked_instance(&s,&project_id,&name,false)?;(u,i,s.data_root.clone())};
    tauri::async_runtime::spawn_blocking(move||minecraft::toggle_local(&root,&u,&i,&kind,&file))
        .await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn remove_instance_file(state:State<'_,Mutex<Backend>>,project_id:String,name:String,kind:String,file:String)->Result<(),String>{
    let (u,i,root)={let s=locked(&state)?;let(u,i)=checked_instance(&s,&project_id,&name,false)?;(u,i,s.data_root.clone())};
    tauri::async_runtime::spawn_blocking(move||minecraft::remove_local(&root,&u,&i,&kind,&file))
        .await.map_err(|e|e.to_string())?
}

#[tauri::command]
async fn maintenance_preview(state: State<'_, Mutex<Backend>>) -> Result<maintenance::MaintenanceReport, String> {
    let root={let s=locked(&state)?;s.username()?;s.data_root.clone()};
    tauri::async_runtime::spawn_blocking(move||maintenance::report(&root,false))
        .await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn maintenance_clean(state: State<'_, Mutex<Backend>>, confirmed: bool) -> Result<maintenance::MaintenanceReport, String> {
    if !confirmed { return Err("Confirmá la limpieza antes de continuar.".into()); }
    let root={let s=locked(&state)?;s.username()?;s.data_root.clone()};
    tauri::async_runtime::spawn_blocking(move||maintenance::report(&root,true))
        .await.map_err(|e|e.to_string())?
}

#[tauri::command]
async fn check_app_update(app:tauri::AppHandle)->Result<updates::UpdateInfo,String>{
    updates::check(&app).await
}
#[tauri::command]
async fn install_app_update(app:tauri::AppHandle,confirmed:bool)->Result<(),String>{
    if !confirmed{return Err("Debés confirmar la actualización".into())}
    updates::install(&app).await
}
#[tauri::command]
async fn sync_universe(state:State<'_,Mutex<Backend>>)->Result<Snapshot,String>{
    let root={locked(&state)?.data_root.clone()};
    let catalog=tauri::async_runtime::spawn_blocking({let root=root.clone();move||cloud::fetch(&root)})
        .await.map_err(|e|e.to_string())??;
    let projects=catalog.projects.into_iter().filter_map(|p|p.project).collect::<Vec<_>>();
    let cache=UniverseCache{source:catalog.source,projects:projects.clone()};
    atomic_json(&root.join("vis-universe-cache.json"),&cache)?;
    let mut s=locked(&state)?;
    s.remote_projects=projects;
    Ok(s.snapshot())
}
#[tauri::command]
async fn publish_universe(state:State<'_,Mutex<Backend>>,token:String)->Result<Snapshot,String>{
    let (root,projects)={let s=locked(&state)?;s.admin()?;(s.data_root.clone(),s.catalog.projects.clone())};
    tauri::async_runtime::spawn_blocking(move||cloud::publish(&root,&projects,&token))
        .await.map_err(|e|e.to_string())??;
    Ok(locked(&state)?.snapshot())
}
#[tauri::command]
async fn fetch_cloud_catalog(state:State<'_,Mutex<Backend>>)->Result<cloud::CloudCatalog,String>{
    let root={locked(&state)?.data_root.clone()};
    tauri::async_runtime::spawn_blocking(move||cloud::fetch(&root)).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn download_cloud_bundle(state:State<'_,Mutex<Backend>>,project_id:String)->Result<String,String>{
    let root={let s=locked(&state)?;s.username()?;s.data_root.clone()};
    tauri::async_runtime::spawn_blocking(move||cloud::download(&root,&project_id)).await.map_err(|e|e.to_string())?
}
#[tauri::command]
fn configure_cloud_catalog(state:State<'_,Mutex<Backend>>,url:String)->Result<(),String>{
    let s=locked(&state)?;s.admin()?;cloud::save_catalog_url(&s.data_root,&url)
}

fn main() {
    let mut builder=tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init());
    if updates::enabled() {
        if let Some(key)=option_env!("VIS_UPDATER_PUBKEY") {
            builder=builder.plugin(tauri_plugin_updater::Builder::new().pubkey(key).build());
        }
    }
    builder
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            horizon::initialize_bundled_source(&app.handle());
            let backend = init_backend(&app.handle()).map_err(std::io::Error::other)?;
            app.manage(Mutex::new(backend));
            app.manage(Mutex::new(social::SocialSession::default()));
            app.manage(Mutex::new(microsoft::MicrosoftState::default()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_state, legacy_cleanup_preview, legacy_cleanup_apply, register, login, login_offline, logout, update_presence, set_avatar_preset,
            save_project, delete_project, save_instance, suggest_instance_directory, preview_instance_destination, ensure_project_instance, configure_shared_ram, instance_folder, open_instance_location, recover_shared_instance, instance_backups, set_instance_auto_backup, backup_instance_data, restore_instance_data, inspect_instance_data, repair_instance_data, merge_shared_servers, delete_instance, delete_instances_batch, set_shared_hidden, sync_project_mods,
            request_friend, accept_friend, send_message,
            social::social_connect, social::social_request, social::social_disconnect,
            microsoft::microsoft_begin, microsoft::microsoft_poll,
            microsoft::microsoft_cancel, microsoft::microsoft_open_verification,
            microsoft::microsoft_cosmetics,
            microsoft::microsoft_set_cape, microsoft::microsoft_hide_cape,
            microsoft::microsoft_use_skin, microsoft::microsoft_use_saved_skin,
            microsoft::microsoft_upload_skin,
            social::social_identity_info,
            social::social_cloud_register, social::social_cloud_login,
            social::social_enable_cloud_password,
            import_asset, save_cropped_asset, clear_asset, commit_profile_asset, preview_asset, save_brand_name,
            set_project_execution, minecraft_versions, fabric_loaders, horizon_probe, horizon_diagnostics, horizon_source_build, horizon_local_builds, horizon_installed_builds, launch_horizon, install_minecraft, download_jobs, cancel_download,
            export_worlds_instance, import_worlds_instance, launch_minecraft, search_modrinth, install_modrinth, import_instance_file,
            list_instance_files, toggle_instance_file, remove_instance_file, maintenance_preview, maintenance_clean, check_app_update, install_app_update,
            fetch_cloud_catalog, download_cloud_bundle, configure_cloud_catalog, sync_universe, publish_universe
        ])
        .run(tauri::generate_context!())
        .expect("No se pudo abrir VIS Nexo");
}
