//! Minecraft Java Edition installer for authenticated/local single-player.
//! Downloads only from Mojang/Fabric metadata and verifies SHA-1 hashes.
//! Local account launch is OFFLINE (no official server authentication or Mojang cosmetics).
use std::{collections::{BTreeSet,HashMap,VecDeque}, fs::{self,File}, io::{Read,Write}, path::{Path,PathBuf}, process::{Command,Stdio}, sync::{Mutex,OnceLock,atomic::{AtomicUsize,AtomicU64,Ordering}}, time::{Duration,Instant,SystemTime,UNIX_EPOCH}};
use serde::{Serialize,Deserialize};
use serde_json::{Value,json};
use reqwest::blocking::Client;
use sha1::{Sha1,Digest};
use sha2::Sha256;
use flate2::read::GzDecoder;
use rayon::prelude::*;
use tauri::{AppHandle,Emitter,Manager};
use crate::accounts::Instance;

static INSTALL_GUARD: Mutex<()> = Mutex::new(());
static SHARED_PLAYER_LAYOUT_GUARD: Mutex<()> = Mutex::new(());
/// One running game per writable game directory inside this launcher process.
/// Sharing the same saves with two live processes could corrupt a world.
static ACTIVE_GAME_DIRS:OnceLock<Mutex<BTreeSet<PathBuf>>>=OnceLock::new();
pub(crate) struct GameRunGuard{path:PathBuf,_os_lock:crate::instance_lock::InstanceLock}
impl Drop for GameRunGuard {
 fn drop(&mut self){
    if let Some(registry)=ACTIVE_GAME_DIRS.get(){
        if let Ok(mut active)=registry.lock(){active.remove(&self.path);}
    }
 }
}
pub(crate) fn acquire_game_run(dir:&Path)->Result<GameRunGuard,String>{
    let path=fs::canonicalize(dir).map_err(|e|format!("No se pudo verificar la carpeta del juego: {e}"))?;
    let registry=ACTIVE_GAME_DIRS.get_or_init(||Mutex::new(BTreeSet::new()));
    let mut active=registry.lock().map_err(|_|"Gestor de partidas ocupado")?;
    if !active.insert(path.clone()){
        return Err("Esta instancia ya está abierta. Cerrá Minecraft antes de iniciar la misma partida con otra cuenta.".into());
    }
    let os_lock=match crate::instance_lock::try_lock(&path){
        Ok(lock)=>lock,
        Err(error)=>{active.remove(&path);return Err(error);}
    };
    Ok(GameRunGuard{path,_os_lock:os_lock})
}

/// Keep an advisory game lock alive inside the spawned Minecraft process on
/// Unix, even if the launcher crashes. Only the lock descriptor is inherited;
/// the parent still releases its own handle after the game exits.
#[cfg(unix)]
pub(crate) fn inherit_game_lock(cmd:&mut Command,guard:&GameRunGuard){
    use std::os::unix::process::CommandExt;
    let fd=guard._os_lock.os_fd();
    // SAFETY: pre_exec performs only async-signal-safe fcntl calls.
    // F_GETFD=1, F_SETFD=2, FD_CLOEXEC=1 on supported Unix platforms.
    unsafe {
        cmd.pre_exec(move||{
            unsafe extern "C" { fn fcntl(fd:i32, operation:i32, ...)->i32; }
            let flags=fcntl(fd,1);
            if flags<0{return Err(std::io::Error::last_os_error());}
            if fcntl(fd,2,flags & !1)<0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
}
#[cfg(not(unix))]
pub(crate) fn inherit_game_lock(_cmd:&mut Command,_guard:&GameRunGuard){
    // Windows still needs a separate supervisor to survive launcher crashes.
}

const MANIFEST: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const FABRIC: &str = "https://meta.fabricmc.net/v2";
const MODRINTH: &str = "https://api.modrinth.com/v2";

#[derive(Clone,Serialize)]
pub struct Progress { pub stage:String,pub completed:usize,pub total:usize,pub detail:String }
#[derive(Clone,Serialize)]
pub struct VersionChoice { pub id:String,pub kind:String }
#[derive(Clone,Serialize,Deserialize)]
pub struct LocalInstallation {pub version:String,pub loader:String,pub loader_version:String,pub installed_at:u64, #[serde(default)] pub runtime_storage:String}
#[derive(Clone,Serialize)]
pub struct ModHit {pub id:String,pub title:String,pub description:String,pub icon_url:String,pub downloads:u64,pub slug:String}
#[derive(Clone,Serialize)]
pub struct InstalledFile {pub file:String,pub kind:String,pub bytes:u64,pub enabled:bool}
#[derive(Clone,Serialize)]
pub struct LaunchResult {pub pid:u32,pub log_file:String,pub offline:bool}
#[derive(Clone,Serialize)]
pub struct LaunchExit {pub pid:u32,pub success:bool,pub exit_code:Option<i32>,pub log_file:String,pub error:String}

pub fn configure_instance_environment(cmd:&mut Command,dir:&Path)->Result<(),String>{
    crate::instance_guard::private_paths(dir,&[
       ".vis/cache",".vis/config",".vis/data",".vis/tmp",".vis/cache/mesa"
    ])?;
    for (name,relative) in [("XDG_CACHE_HOME",".vis/cache"),("XDG_CONFIG_HOME",".vis/config"),
        ("XDG_DATA_HOME",".vis/data"),("MESA_SHADER_CACHE_DIR",".vis/cache/mesa"),
        ("APPDATA",".vis/config"),("LOCALAPPDATA",".vis/cache"),
        ("TMPDIR",".vis/tmp"),("TMP",".vis/tmp"),("TEMP",".vis/tmp")]{
        let path=dir.join(relative);fs::create_dir_all(&path).map_err(|e|e.to_string())?;
        cmd.env(name,path);
    }
    // Minecraft may invoke the desktop's Open Resource Pack Folder action.
    // An AppImage can inject GTK/GIO/Qt libraries and paths that make
    // xdg-open/gio fail even though Dolphin works from Konsole. Restore only
    // the host opener environment; all game saves remain in --gameDir.
    #[cfg(target_os="linux")]
    if std::env::var_os("APPDIR").is_some() || std::env::var_os("APPIMAGE").is_some() {
        let appdir=std::env::var("APPDIR").unwrap_or_default();
        let filtered=|value:String|{
            value.split(':').filter(|item|
                !item.is_empty() && !item.starts_with("/tmp/.mount_")
                && (appdir.is_empty() || !item.starts_with(&appdir))
            ).collect::<Vec<_>>().join(":")
        };
        for key in ["APPDIR","APPIMAGE","ARGV0","LD_LIBRARY_PATH","LD_PRELOAD",
            "LD_AUDIT","GIO_EXTRA_MODULES","GIO_MODULE_DIR","GTK_PATH",
            "GTK_EXE_PREFIX","GTK_DATA_PREFIX","QT_PLUGIN_PATH",
            "QT_QPA_PLATFORM_PLUGIN_PATH","GDK_PIXBUF_MODULE_FILE",
            "GDK_PIXBUF_MODULEDIR"]{
                cmd.env_remove(key);
        }
        let path=filtered(std::env::var("PATH").unwrap_or_default());
        cmd.env("PATH",if path.is_empty(){"/usr/local/bin:/usr/bin:/bin"}else{&path});
        if let Ok(xdg)=std::env::var("XDG_DATA_DIRS") {
            let clean=filtered(xdg);
            cmd.env("XDG_DATA_DIRS",if clean.is_empty(){"/usr/local/share:/usr/share"}else{&clean});
        }
    }
    Ok(())
}

fn client()->Result<Client,String>{Client::builder().user_agent("VIS-Nexo/2.12 (desktop Minecraft launcher)")
 .connect_timeout(Duration::from_secs(20))
 // A complete Minecraft installation may involve multi-hundred-MB transfers.
 // The old global 60s timeout interrupted legitimate downloads on slower connections.
 .timeout(Duration::from_secs(600)).build().map_err(|e|e.to_string())}
fn get_json(client:&Client,url:&str)->Result<Value,String>{client.get(url).send().and_then(|r|r.error_for_status()).map_err(|e|format!("Consulta de metadatos: {e}"))?
 .json().map_err(|e|format!("Metadatos JSON inválidos: {e}"))}
fn clean_segment(s:&str)->bool{!s.is_empty()&&s.len()<=128&&s.bytes().all(|b|b.is_ascii_alphanumeric()||b"._-+".contains(&b))&&s!="."&&s!=".."}
fn safe_file_name(s:&str)->Result<&str,String>{
 if s.is_empty()||s.len()>200||s=="."||s==".."||s.contains('/')||s.contains('\\')||s.ends_with('.')||s.ends_with(' ')||s.chars().any(|c|c.is_control()){
    return Err("Nombre de archivo inválido".into())
 }
 Ok(s)
}
// 64 KiB fixed buffer: hashing a cached 700 MB client JAR no longer allocates 700 MB.
fn sha1_reader(mut reader:impl Read)->Result<String,String>{
 let mut digest=Sha1::new();let mut buffer=[0u8;64*1024];
 loop {let n=reader.read(&mut buffer).map_err(|e|e.to_string())?;if n==0{break}
  digest.update(&buffer[..n]);
 }
 Ok(format!("{:x}",digest.finalize()))
}
fn cached_file_valid(target:&Path,expected_sha1:Option<&str>,max_bytes:u64)->bool{
 let Ok(meta)=fs::metadata(target) else{return false};
 if !meta.is_file()||meta.len()==0||meta.len()>max_bytes{return false}
 match expected_sha1{
  Some(hash) if hash.len()==40 && hash.bytes().all(|b|b.is_ascii_hexdigit())=>
   File::open(target).ok().and_then(|f|sha1_reader(f).ok()).is_some_and(|actual|actual.eq_ignore_ascii_case(hash)),
  Some(_)=>false,
  None=>true,
 }
}
// Paths are unique for simultaneous instance, mod and runtime operations.
// Never reuse the original extension, which could collide across .jar and .zip.
static DOWNLOAD_NONCE:AtomicU64=AtomicU64::new(0);
fn sibling_path(target:&Path,label:&str)->Result<PathBuf,String>{
 let name=target.file_name().and_then(|s|s.to_str()).ok_or("Destino inválido")?;
 let tick=SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
 let index=DOWNLOAD_NONCE.fetch_add(1,Ordering::Relaxed);
 Ok(target.with_file_name(format!(".{name}.vis-{}-{tick}-{index}.{label}",std::process::id())))
}
fn ensure_regular_or_absent(target:&Path)->Result<(),String>{
 match fs::symlink_metadata(target){
  Ok(metadata) if metadata.file_type().is_symlink()=>Err("La descarga no puede sobrescribir un enlace simbólico".into()),
  Ok(metadata) if !metadata.is_file()=>Err("El destino existe y no es un archivo normal".into()),
  Ok(_)=>Ok(()),
  Err(error) if error.kind()==std::io::ErrorKind::NotFound=>Ok(()),
  Err(error)=>Err(error.to_string()),
 }
}
fn promote_download(source:&Path,target:&Path)->Result<(),String>{
 ensure_regular_or_absent(target)?;
 if !target.exists(){return fs::rename(source,target).map_err(|e|e.to_string())}
 // POSIX rename replaces atomically; Windows requires a recoverable backup.
 #[cfg(not(target_os="windows"))]
 {fs::rename(source,target).map_err(|e|e.to_string())}
 #[cfg(target_os="windows")]
 {
  let backup=sibling_path(target,"backup")?;
  fs::rename(target,&backup).map_err(|e|e.to_string())?;
  match fs::rename(source,target){
   Ok(())=>{let _=fs::remove_file(backup);Ok(())},
   Err(e)=>{let restored=fs::rename(&backup,target);
    Err(format!("Reemplazo fallido: {e}; recuperación: {restored:?}"))},
  }
 }
}
// A failed promotion of any resource restores all already promoted resources.
fn promote_mod_batch(folder:&Path,stage:&Path,names:&[String])->Result<(),String>{
 let mut promoted:Vec<(PathBuf,Option<PathBuf>)>=Vec::new();
 for name in names{
  safe_file_name(name)?;
  let dest=folder.join(name);let source=stage.join(name);
  let action=(||->Result<(),String>{
   ensure_regular_or_absent(&dest)?;
   let backup=if dest.exists(){let backup=sibling_path(&dest,"backup")?;
    fs::rename(&dest,&backup).map_err(|e|e.to_string())?;Some(backup)
   }else{None};
   match fs::rename(&source,&dest){
    Ok(())=>{promoted.push((dest,backup));Ok(())},
    Err(e)=>{
     if let Some(previous)=backup{let _=fs::rename(previous,&dest);}
     Err(format!("No se pudo activar el mod {name}: {e}"))
    }
   }
  })();
  if let Err(problem)=action{
   for (file,backup) in promoted.into_iter().rev(){let _=fs::remove_file(&file);
    if let Some(old)=backup{let _=fs::rename(old,&file);}
   }
   return Err(problem)
  }
 }
 for (_,backup) in promoted{if let Some(old)=backup{let _=fs::remove_file(old);}}
 Ok(())
}
fn official_url(url:&str)->bool{
 const HOSTS:&[&str]=&["piston-meta.mojang.com","piston-data.mojang.com","launcher.mojang.com","libraries.minecraft.net","resources.download.minecraft.net","maven.fabricmc.net","meta.fabricmc.net","repo.maven.apache.org","repo1.maven.org","api.modrinth.com","cdn.modrinth.com"];
 if let Ok(parsed)=reqwest::Url::parse(url){parsed.scheme()=="https"&&parsed.host_str().is_some_and(|host|HOSTS.contains(&host))}else{false}
}
fn obtain_file(c:&Client,url:&str,target:&Path,expected_sha1:Option<&str>,max_bytes:u64)->Result<(),String>{
 if !official_url(url){return Err(format!("Descarga bloqueada: origen no autorizado ({url})"));}
 ensure_regular_or_absent(target)?;
 if cached_file_valid(target,expected_sha1,max_bytes){return Ok(())}
 if let Some(hash)=expected_sha1{
  if hash.len()!=40 || !hash.bytes().all(|b|b.is_ascii_hexdigit()){
   return Err("SHA-1 esperado inválido".into());
  }
 }
 let parent=target.parent().ok_or("Destino sin carpeta")?;
 fs::create_dir_all(parent).map_err(|e|e.to_string())?;
 let temp=sibling_path(target,"part")?;
 let result=(||->Result<(),String>{
  let mut response=c.get(url).send().and_then(|r|r.error_for_status()).map_err(|e|format!("No se pudo descargar {url}: {e}"))?;
  if response.content_length().is_some_and(|n|n>max_bytes){return Err("Archivo supera el límite permitido".into())}
  let mut file=File::create(&temp).map_err(|e|e.to_string())?;
  let mut size=0u64;let mut buf=[0u8;65536];let mut hasher=Sha1::new();
  loop {let n=response.read(&mut buf).map_err(|e|e.to_string())?;if n==0{break}size+=n as u64;
   if size>max_bytes{return Err("Archivo supera el límite permitido".into())}hasher.update(&buf[..n]);file.write_all(&buf[..n]).map_err(|e|e.to_string())?;}
  file.flush().map_err(|e|e.to_string())?;drop(file);
  if let Some(expected)=expected_sha1{let actual=format!("{:x}",hasher.finalize());if !actual.eq_ignore_ascii_case(expected){return Err(format!("Checksum SHA1 inválido para {}",target.display()))}}
  // Windows cannot rename over an existing corrupted target. The verified partial
  // is retained until the replacement is ready; other instances use shared runtime.
  promote_download(&temp,target)?;Ok(())
 })(); if result.is_err(){let _=fs::remove_file(&temp);}result
}
// VIS Smart Install. Copy-on-verify allows a portable private runtime without
// downloading identical objects repeatedly. SHA-1 comes from Mojang/Fabric's
// manifest, never from filenames alone. Unverified entries fall back to HTTPS.
fn copy_verified_candidate(source:&Path,target:&Path,sha1:&str,max_bytes:u64)->Result<bool,String>{
 if source==target {return Ok(false)}
 let Ok(meta)=fs::metadata(source) else{return Ok(false)};
 if !meta.is_file() || meta.len()==0 || meta.len()>max_bytes {return Ok(false)}
 ensure_regular_or_absent(target)?;
 let parent=target.parent().ok_or("Ruta de destino inválida")?;
 fs::create_dir_all(parent).map_err(|e|e.to_string())?;
 let partial=sibling_path(target,"reuse")?;
 let outcome=(||->Result<bool,String>{
  let mut input=File::open(source).map_err(|e|e.to_string())?;
  let mut output=File::create(&partial).map_err(|e|e.to_string())?;
  let mut buf=[0u8;64*1024];let mut copied=0u64;let mut hash=Sha1::new();
  loop {
   let read=input.read(&mut buf).map_err(|e|e.to_string())?;
   if read==0 {break}
   copied=copied.checked_add(read as u64).ok_or("Archivo de origen inválido")?;
   if copied>max_bytes {return Ok(false)}
   hash.update(&buf[..read]);output.write_all(&buf[..read]).map_err(|e|e.to_string())?;
  }
  output.flush().map_err(|e|e.to_string())?;drop(output);
  if !format!("{:x}",hash.finalize()).eq_ignore_ascii_case(sha1) {return Ok(false)}
  promote_download(&partial,target)?;
  Ok(true)
 })();
 if partial.exists(){let _=fs::remove_file(&partial);}
 outcome
}
fn obtain_or_reuse(c:&Client,task:&Task,destination_root:&Path,sources:&[PathBuf])->Result<bool,String>{
 // Untrusted libraries and asset indexes may contain arbitrary nested paths.
 // Never follow an existing symlink in their destination ancestry.
 let mut parent=task.path.parent().ok_or("Descarga sin carpeta destino")?;
 if !parent.starts_with(destination_root){return Err("Recurso fuera de la instancia".into())}
 loop{
   if fs::symlink_metadata(parent).ok().is_some_and(|meta|meta.file_type().is_symlink()){
     return Err("Ruta interna con enlace simbólico: descarga rechazada".into())
   }
   if parent==destination_root {break}
   parent=parent.parent().ok_or("Descarga fuera de la instancia")?;
 }
 if fs::symlink_metadata(&task.path).ok().is_some_and(|meta|meta.file_type().is_symlink()){
     return Err("Un recurso Minecraft no puede ser enlace simbólico".into())
 }
 if cached_file_valid(&task.path,task.sha1.as_deref(),task.max){return Ok(true)}
 if let Some(hash)=task.sha1.as_deref(){
  if hash.len()==40 && hash.bytes().all(|b|b.is_ascii_hexdigit()) {
   let relative=task.path.strip_prefix(destination_root).map_err(|_|"Recurso fuera del runtime de la instancia")?;
   for root in sources {
    let candidate=root.join(relative);
    // Bad copies or inaccessible caches should not make the installation fail.
    if copy_verified_candidate(&candidate,&task.path,hash,task.max).unwrap_or(false) {
     return Ok(true)
    }
   }
  }
 }
 obtain_file(c,&task.url,&task.path,task.sha1.as_deref(),task.max)?;
 Ok(false)
}
fn java_home_instance(data_root:&Path,username:&str,ins:&Instance)->Result<PathBuf,String>{
 if !ins.game_dir.trim().is_empty() {
   return crate::instance_guard::destination(Path::new(&ins.game_dir));
 }
 if !clean_segment(username)||!clean_segment(&ins.project_id)||!clean_segment(&ins.name.replace(' ',"-")) {
   return Err("Nombre de instancia o proyecto inválido".into())
 }
 crate::instance_guard::destination(&data_root.join("minecraft-instances")
   .join(username).join(&ins.project_id).join(ins.name.replace(' ',"-")))
}
/// Resolve a stable offline nickname. Premium identity is handled separately.
pub fn offline_player_name(account:&str,configured:&str)->Result<String,String>{
 let name=if configured.trim().is_empty(){account.trim()}else{configured.trim()};
 if !(3..=16).contains(&name.len()) ||
    !name.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'_'){
   return Err("El nombre offline debe tener 3 a 16 caracteres (A-Z, 0-9 o _)".into());
 }
 Ok(name.to_owned())
}
pub fn instance_dir(data_root:&Path,username:&str,ins:&Instance)->Result<PathBuf,String>{java_home_instance(data_root,username,ins)}
/// Create Minecraft's complete writable layout before the first world or
/// resource-pack action. Runtime binaries can be shared, but all of these
/// folders belong to the selected VIS player, not to the installer owner.
pub fn prepare_player_directory(game_dir:&Path)->Result<(),String>{
 let dir=crate::instance_guard::destination(game_dir)?;
 const FOLDERS:&[&str]=&[
     "saves","resourcepacks","shaderpacks","screenshots","logs","config","mods",
     ".vis/cache",".vis/config",".vis/data",".vis/tmp",".vis/cache/mesa"
 ];
 crate::instance_guard::private_paths(&dir,FOLDERS)?;
 fs::create_dir_all(&dir).map_err(|e|format!("No se pudo crear la carpeta de juego: {e}"))?;
 for item in FOLDERS {
     fs::create_dir_all(dir.join(item))
         .map_err(|e|format!("No se pudo crear la carpeta {item}: {e}"))?;
 }
 Ok(())
}

fn installation_path(dir:&Path)->PathBuf{dir.join(".vslauncher").join("install.json")}
// All new and repaired instances resolve binaries inside the game folder.
// Legacy shared-runtime installations are marked for non-destructive repair.
fn installed_runtime(_data_root:&Path,dir:&Path)->PathBuf {dir.join(".vis/runtime")}
fn new_runtime(dir:&Path)->PathBuf{dir.join(".vis").join("runtime")}

// Only predictable launcher cache locations are examined. No recursive disk
// scan, no writes into other launchers. Extra known VIS instance locations are
// supplied from the authenticated user's own saved profiles.
fn public_cache_roots()->Vec<PathBuf> {
 let mut roots=Vec::new();
 if let Some(appdata)=std::env::var_os("APPDATA") {roots.push(PathBuf::from(appdata).join(".minecraft"));}
 if let Some(local)=std::env::var_os("LOCALAPPDATA") {roots.push(PathBuf::from(local).join(".minecraft"));}
 if let Some(home)=std::env::var_os("USERPROFILE").or_else(||std::env::var_os("HOME")) {
  let h=PathBuf::from(home);
  roots.push(h.join(".minecraft"));
  roots.push(h.join("Library/Application Support/minecraft"));
  roots.push(h.join(".local/share/PrismLauncher"));
  roots.push(h.join(".var/app/org.prismlauncher.PrismLauncher/data/PrismLauncher"));
  roots.push(h.join(".local/share/multimc"));
  roots.push(h.join("AppData/Roaming/.minecraft"));
  // CurseForge/Modrinth/Prism each retain per-profile game directories. Only
  // enumerate their immediate instance children (bounded and read-only).
  let instance_roots=[h.join(".local/share/PrismLauncher/instances"),
    h.join(".var/app/org.prismlauncher.PrismLauncher/data/PrismLauncher/instances"),
    h.join(".local/share/ModrinthApp/profiles"),
    h.join("curseforge/minecraft/Instances"),
    h.join("Documents/Curse/Minecraft/Instances"),
    h.join("AppData/Roaming/PrismLauncher/instances"),
    h.join("AppData/Roaming/ModrinthApp/profiles")];
  for container in &instance_roots {
   if let Ok(entries)=fs::read_dir(container) {
    for entry in entries.take(32).flatten() {
     let candidate=entry.path().join(".minecraft");
     if candidate.is_dir(){roots.push(candidate);}
    }
   }
  }
 }
 roots
}
fn candidate_roots(data_root:&Path,known_instances:&[PathBuf],destination:&Path)->Vec<PathBuf>{
 let mut roots=vec![data_root.join("minecraft-runtime")];
 roots.extend(public_cache_roots());
 for dir in known_instances.iter().take(24) {
  roots.push(dir.join(".vis/runtime"));
  // If a user explicitly selected an existing Minecraft directory, treat it
  // as a possible read-only source, not as a directory to mutate.
  roots.push(dir.clone());
 }
 roots.retain(|root|root!=destination&&root.is_dir());
 roots.sort();roots.dedup();roots
}

// Cache-path filtering is done once per installation stage rather than doing
// thousands of directory probes for every asset. Bound the candidate count to
// protect slow disks when many profiles are configured.
fn sources_for_category(sources:&[PathBuf],category:&str)->Vec<PathBuf>{
 sources.iter().filter(|root|root.join(category).is_dir()).take(24).cloned().collect()
}
pub fn installed(dir:&Path,ins:&Instance)->bool{
 if ins.engine=="horizon" {return crate::horizon::installed(dir,ins)}
 if crate::instance_guard::private_paths(dir,&[
     ".vslauncher",".vis/runtime/versions",".vis/runtime/libraries",
     ".vis/runtime/assets/indexes",".vis/runtime/assets/objects",
     ".vis/java-runtimes",".vslauncher/natives","mods"
 ]).is_err(){return false}
 let Ok(data)=fs::read(installation_path(dir)) else {return false};
 let Ok(marker)=serde_json::from_slice::<LocalInstallation>(&data) else {return false};
 if marker.version!=ins.version || marker.loader!=ins.loader || marker.loader_version!=ins.loader_version {return false}
 if marker.runtime_storage!="instance-v1" {return false}
 let runtime=dir.join(".vis/runtime");
 // Old global .minecraft or shared VIS cache never qualifies as installed.
 let profile_path=dir.join(".vslauncher/version.json");
 let Ok(raw)=fs::read(&profile_path) else{return false};
 let Ok(profile)=serde_json::from_slice::<Value>(&raw) else{return false};
 let Some(index)=profile["assetIndex"]["id"].as_str() else{return false};
 if !clean_segment(index) {return false}
 let java=profile["javaVersion"]["majorVersion"].as_u64().unwrap_or(8);
 runtime.join("versions").join(&ins.version).join(format!("{}.jar",ins.version)).is_file()
   && runtime.join("libraries").is_dir()
   && runtime.join("assets/indexes").join(format!("{index}.json")).is_file()
   && look_for_java(&dir.join(".vis/java-runtimes").join(format!("temurin-{java}")),4).is_some()
}
// Cache the official version selector in-process for ten minutes. Downloading the
// manifest on each wizard opening adds latency and increases provider requests.
static VERSION_CACHE: OnceLock<Mutex<Option<(Instant,Vec<VersionChoice>)>>> = OnceLock::new();
fn select_versions(manifest:&Value)->Result<Vec<VersionChoice>,String>{
 let list=manifest["versions"].as_array().ok_or("Manifest incompleto")?;
 let mut releases=Vec::new();let mut snapshots=Vec::new();
 for item in list {
  let (Some(id),Some(kind))=(item["id"].as_str(),item["type"].as_str()) else {continue};
  if !clean_segment(id){continue}
  match kind {
   // All releases, including older stable versions, not only the first 130 entries.
   "release"=>releases.push(VersionChoice{id:id.into(),kind:kind.into()}),
   "snapshot" if snapshots.len()<60=>snapshots.push(VersionChoice{id:id.into(),kind:kind.into()}),
   _=>{},
  }
 }
 releases.extend(snapshots);Ok(releases)
}
pub fn get_versions()->Result<Vec<VersionChoice>,String>{
 let cache=VERSION_CACHE.get_or_init(||Mutex::new(None));
 if let Ok(guard)=cache.lock(){if let Some((at,versions))=&*guard{
  if at.elapsed()<Duration::from_secs(600){return Ok(versions.clone())}
 }}
 let c=client()?;let result=select_versions(&get_json(&c,MANIFEST)?)?;
 if let Ok(mut guard)=cache.lock(){*guard=Some((Instant::now(),result.clone()));}
 Ok(result)
}
static FABRIC_CACHE: OnceLock<Mutex<std::collections::BTreeMap<String,(Instant,Vec<String>)>>> = OnceLock::new();
pub fn get_fabric_loaders(version:&str)->Result<Vec<String>,String>{
 if !clean_segment(version){return Err("Versión inválida".into())}
 let cache=FABRIC_CACHE.get_or_init(||Mutex::new(std::collections::BTreeMap::new()));
 if let Ok(guard)=cache.lock(){if let Some((at,loaders))=guard.get(version){
  if at.elapsed()<Duration::from_secs(600){return Ok(loaders.clone())}
 }}
 let c=client()?;let j=get_json(&c,&format!("{FABRIC}/versions/loader/{}",urlencoding::encode(version)))?;
 let loaders:Vec<String>=j.as_array().ok_or("Fabric devolvió una respuesta inválida")?.iter()
  .filter(|v|v["loader"]["stable"].as_bool().unwrap_or(false))
  .filter_map(|v|v["loader"]["version"].as_str().map(ToOwned::to_owned)).take(25).collect();
 if let Ok(mut guard)=cache.lock(){
  if guard.len()>=24 {guard.retain(|_,(at,_)|at.elapsed()<Duration::from_secs(600));}
  if guard.len()>=24 {guard.clear();}
  guard.insert(version.to_owned(),(Instant::now(),loaders.clone()));
 }
 Ok(loaders)
}
fn version_metadata(c:&Client,version:&str)->Result<Value,String>{
 let manifest=get_json(c,MANIFEST)?;
 let entry=manifest["versions"].as_array().ok_or("Manifest sin versiones")?.iter().find(|v|v["id"].as_str()==Some(version)).ok_or("La versión no existe en Mojang")?;
 let url=entry["url"].as_str().ok_or("Manifest sin URL")?;
 if !official_url(url){return Err("URL de versión no confiable".into())}
 get_json(c,url)
}
#[derive(Clone)]struct Task{url:String,path:PathBuf,sha1:Option<String>,max:u64}
// Bounded parallelism: O(min(n, CPUs, 4)) network connections, 64 KiB per
// transfer buffer. Avoid launching eight concurrent large downloads on 2-core PCs.
fn download_parallelism(task_count:usize,available_cpus:usize)->usize{
 if task_count==0{return 0}
 task_count.min(available_cpus.max(2).min(4))
}
fn download_tasks(c:&Client,app:&AppHandle,stage:&str,tasks:&[Task],destination_root:&Path,sources:&[PathBuf])->Result<(),String>{
 let completed=AtomicUsize::new(0);let total=tasks.len();
 if total==0{return Ok(())}
 let cpus=std::thread::available_parallelism().map_or(2,|n|n.get());
 let pool=rayon::ThreadPoolBuilder::new().num_threads(download_parallelism(total,cpus)).build().map_err(|e|e.to_string())?;
 pool.install(||tasks.par_iter().try_for_each(|task|{
  let reused=obtain_or_reuse(c,task,destination_root,sources)?;
  let count=completed.fetch_add(1,Ordering::Relaxed)+1;
  if count==total||count%15==0 || (reused && count==1) {let _=app.emit("minecraft-progress",Progress{stage:stage.into(),completed:count,total,detail:format!("{} · {}",if reused {"Copia local verificada"}else{"Descargado"},task.path.file_name().unwrap_or_default().to_string_lossy())});}
  Ok::<_,String>(())
 }))
}
// Two remote metadata entries may point to one Maven filename. Don't silently
// discard a conflicting checksum or pick an arbitrary variant.
fn normalize_download_plan(tasks:&mut Vec<Task>)->Result<(),String>{
 tasks.sort_by(|a,b|a.path.cmp(&b.path));
 let mut deduplicated:Vec<Task>=Vec::with_capacity(tasks.len());
 for task in tasks.drain(..){
  if let Some(prev)=deduplicated.last_mut(){if prev.path==task.path{
   if let (Some(left),Some(right))=(&prev.sha1,&task.sha1){
    if !left.eq_ignore_ascii_case(right){return Err(format!("Conflicto de SHA-1 de biblioteca: {}",task.path.display()))}
   }
   if prev.url!=task.url && prev.sha1.is_none() && task.sha1.is_none(){
    return Err(format!("Biblioteca ambigua sin checksum: {}",task.path.display()));
   }
   if prev.sha1.is_none() && task.sha1.is_some(){prev.sha1=task.sha1;prev.url=task.url;}
   prev.max=prev.max.min(task.max);
   continue
  }}
  deduplicated.push(task);
 }
 *tasks=deduplicated;
 Ok(())
}
fn matches_rules(rules:Option<&Value>)->bool{
 let Some(rules)=rules.and_then(Value::as_array) else{return true};
 let current_os=if cfg!(target_os="windows"){"windows"}else if cfg!(target_os="macos"){"osx"}else{"linux"};
 let mut allowed=false;
 for rule in rules {let mut matching=true;
  if let Some(os)=rule.get("os") {if os.get("name").and_then(Value::as_str).is_some_and(|v|v!=current_os){matching=false;}
   if os.get("arch").and_then(Value::as_str).is_some_and(|v|v=="x86"&&cfg!(target_pointer_width="64")){matching=false;}}
  // Feature-flagged variants (demo/quick-play) are not enabled by VSLauncher.
  if rule.get("features").and_then(Value::as_object).is_some_and(|m|m.values().any(|v|v.as_bool()==Some(true))){matching=false;}
  if matching{allowed=rule["action"].as_str()==Some("allow");}
 }allowed
}
fn maven_relative(name:&str)->Result<String,String>{
 let parts:Vec<_>=name.split(':').collect();if parts.len()<3||parts.len()>4||!parts.iter().all(|p|p.split('.').all(clean_segment)){return Err("Coordenada Maven inválida".into())}
 let group=parts[0].replace('.',"/");let (artifact,version)=(parts[1],parts[2]);
 let classifier=parts.get(3).map(|s|format!("-{s}")).unwrap_or_default();
 Ok(format!("{group}/{artifact}/{version}/{artifact}-{version}{classifier}.jar"))
}
fn task_for_library(lib:&Value,lib_root:&Path,base_url:&str)->Result<Option<Task>,String>{
 if !matches_rules(lib.get("rules")){return Ok(None)}
 let Some(name)=lib["name"].as_str() else{return Ok(None)};
 // Native-only libraries do not have a regular classpath artifact.
 if lib.get("downloads").is_some() && lib["downloads"].get("artifact").is_none(){return Ok(None)}
 let rel=maven_relative(name)?;
 let artifact=&lib["downloads"]["artifact"];
 let (url,sha)=if let Some(url)=artifact["url"].as_str(){(url.to_owned(),artifact["sha1"].as_str().map(str::to_owned))}
 else {let root=lib["url"].as_str().unwrap_or(base_url);(format!("{}/{}",root.trim_end_matches('/'),rel),None)};
 if !official_url(&url){return Err("Repositorio de biblioteca no autorizado".into())}
 Ok(Some(Task{url,path:lib_root.join(rel),sha1:sha,max:200*1024*1024}))
}
fn native_task(lib:&Value,lib_root:&Path)->Result<Option<Task>,String>{
 if !matches_rules(lib.get("rules")){return Ok(None)}
 let key=if cfg!(target_os="windows"){"windows"}else if cfg!(target_os="macos"){"osx"}else{"linux"};
 let Some(classifier)=lib["natives"][key].as_str() else{return Ok(None)};
 let classifier=classifier.replace("${arch}",if cfg!(target_pointer_width="64"){"64"}else{"32"});
 let v=&lib["downloads"]["classifiers"][classifier.as_str()];let Some(url)=v["url"].as_str() else{return Ok(None)};
 if !official_url(url){return Err("URL de nativos no autorizada".into())}
 let name=lib["name"].as_str().ok_or("Biblioteca sin coordenada")?;
 let rel=maven_relative(&format!("{name}:{classifier}"))?;
 Ok(Some(Task{url:url.into(),path:lib_root.join(rel),sha1:v["sha1"].as_str().map(ToOwned::to_owned),max:150*1024*1024}))
}
fn extract_natives(tasks:&[Task],dir:&Path)->Result<(),String>{
 fs::create_dir_all(dir).map_err(|e|e.to_string())?;
 for t in tasks {let f=File::open(&t.path).map_err(|e|e.to_string())?;
  let mut zip=zip::ZipArchive::new(f).map_err(|e|e.to_string())?;
  for i in 0..zip.len(){let mut entry=zip.by_index(i).map_err(|e|e.to_string())?;
   if entry.is_dir()||entry.size()>100*1024*1024 {continue}
   let Some(name)=entry.name().split('/').last() else{continue};
   if !name.ends_with(".so")&&!name.ends_with(".dll")&&!name.ends_with(".dylib")&&!name.ends_with(".jnilib"){continue}
   let name=safe_file_name(name)?;let mut out=File::create(dir.join(name)).map_err(|e|e.to_string())?;
   std::io::copy(&mut entry,&mut out).map_err(|e|e.to_string())?;
  }
 }Ok(())
}
// VIS Worlds · managed Java runtime via Eclipse Temurin public checksummed releases.
// No system-wide Java installation or administrator privileges are needed.
fn java_major(executable:&std::ffi::OsStr)->Option<u64>{
    let output=Command::new(executable).arg("-version").output().ok()?;
    if !output.status.success(){return None}
    let text=format!("{}{}",String::from_utf8_lossy(&output.stderr),String::from_utf8_lossy(&output.stdout));
    let first=text.split('"').nth(1)?;
    if first.starts_with("1."){first.split('.').nth(1)?.parse().ok()}
    else{first.split(|c:char|!c.is_ascii_digit()).next()?.parse().ok()}
}
fn look_for_java(base:&Path,depth:usize)->Option<PathBuf>{
    if depth==0 || !base.is_dir(){return None}
    let file=if cfg!(target_os="windows"){base.join("bin/java.exe")}else{base.join("bin/java")};
    if file.is_file(){return Some(file)}
    for entry in fs::read_dir(base).ok()?.flatten(){
        if entry.file_type().ok()?.is_dir(){if let Some(found)=look_for_java(&entry.path(),depth-1){return Some(found)}}
    }
    None
}
fn find_java(data_root:&Path,ins:&Instance,required:u64)->Option<PathBuf>{
    if !ins.java_path.trim().is_empty(){
        let custom=PathBuf::from(&ins.java_path);
        return java_major(custom.as_os_str()).filter(|v|*v>=required).map(|_|custom);
    }
    let managed=data_root.join("java-runtimes").join(format!("temurin-{required}"));
    if let Some(java)=look_for_java(&managed,4){
        if java_major(java.as_os_str()).is_some_and(|v|v>=required){return Some(java)}
    }
    if java_major(std::ffi::OsStr::new("java")).is_some_and(|v|v>=required){return Some(PathBuf::from("java"))}
    None
}
fn safe_java_link(member:&Path,link:&Path)->bool{
    use std::path::Component;
    if link.is_absolute(){return false}
    let Some(parent)=member.parent() else{return false};
    let mut resolved=Vec::new();
    for part in parent.components().chain(link.components()){
        match part {
            Component::Normal(name)=>resolved.push(name),
            Component::CurDir=>{},
            Component::ParentDir=>{if resolved.len()<=1{return false}resolved.pop();},
            _=>return false,
        }
    }
    !resolved.is_empty()
}
fn install_java_runtime(c:&Client,app:&AppHandle,data_root:&Path,required:u64)->Result<PathBuf,String>{
    let existing=data_root.join("java-runtimes").join(format!("temurin-{required}"));
    if let Some(java)=look_for_java(&existing,4){
        if java_major(java.as_os_str())==Some(required){return Ok(java)}
    }
    if ![8,11,17,21,25].contains(&required){return Err(format!("Java {required}: no hay descarga automática configurada; seleccioná la ruta de un Java compatible."))}
    let os=if cfg!(target_os="windows"){"windows"}else if cfg!(target_os="linux"){"linux"}else{return Err("Instalación automática de Java solo disponible para Linux/Windows".into())};
    let arch=if cfg!(target_arch="x86_64"){"x64"}else if cfg!(target_arch="aarch64"){"aarch64"}else{return Err("Arquitectura no soportada por el instalador Java automático".into())};
    let mut choices=vec![];
    let kinds: Vec<&str> = if required==25 {vec!["jdk"]} else {vec!["jre","jdk"]};
    for kind in kinds {
        let endpoint=format!("https://api.adoptium.net/v3/assets/latest/{required}/hotspot?architecture={arch}&image_type={kind}&os={os}&vendor=eclipse");
        if let Ok(metadata)=get_json(c,&endpoint) {
            if let Some(assets)=metadata.as_array(){
                if let Some(asset)=assets.first(){choices.push(asset.clone());break;}
            }
        }
    }
    let asset=choices.first().ok_or("Eclipse Temurin no ofrece Java para este sistema")?;
    let package=&asset["binary"]["package"];
    let uri=package["link"].as_str().ok_or("Java sin URL")?;
    let url=reqwest::Url::parse(uri).map_err(|e|e.to_string())?;
    if url.scheme()!="https" || url.host_str()!=Some("github.com") || !url.path().starts_with("/adoptium/"){
        return Err("La descarga de Java no corresponde al repositorio oficial de Adoptium".into())
    }
    let sha256=package["checksum"].as_str().ok_or("Java sin SHA-256")?;
    if sha256.len()!=64 || !sha256.bytes().all(|b|b.is_ascii_hexdigit()){return Err("Checksum Java inválido".into())}
    let target=data_root.join("java-runtimes").join(format!("temurin-{required}"));
    let staging=target.with_extension("staging");
    let archive=data_root.join("java-runtimes").join(format!("temurin-{required}.{}",if cfg!(target_os="windows"){"zip"}else{"tar.gz"}));
    fs::create_dir_all(archive.parent().ok_or("Ruta Java inválida")?).map_err(|e|e.to_string())?;
    let _=app.emit("minecraft-progress",Progress{stage:"java".into(),completed:0,total:1,detail:format!("Preparando Temurin Java {required}")});
    let mut response=c.get(uri).send().and_then(|r|r.error_for_status()).map_err(|e|format!("Descarga de Java: {e}"))?;
    if response.content_length().is_some_and(|n|n>350*1024*1024){return Err("Archivo Java mayor que 350 MB".into())}
    let partial=archive.with_extension("partial");
    let outcome=(||->Result<(),String>{
        let mut out=File::create(&partial).map_err(|e|e.to_string())?;
        let mut digest=Sha256::new();let mut total=0u64;let mut buf=[0u8;65536];
        loop {let n=response.read(&mut buf).map_err(|e|e.to_string())?;if n==0{break}
            total+=n as u64;if total>350*1024*1024{return Err("Java excede 350 MB".into())}
            sha1::Digest::update(&mut digest,&buf[..n]);out.write_all(&buf[..n]).map_err(|e|e.to_string())?;
        }
        out.flush().map_err(|e|e.to_string())?;drop(out);
        if format!("{:x}",digest.finalize())!=sha256.to_ascii_lowercase(){return Err("Verificación SHA-256 de Java fallida".into())}
        fs::rename(&partial,&archive).map_err(|e|e.to_string())?;
        if staging.exists(){fs::remove_dir_all(&staging).map_err(|e|e.to_string())?}
        fs::create_dir_all(&staging).map_err(|e|e.to_string())?;
        if cfg!(target_os="windows"){
            let mut zipped=zip::ZipArchive::new(File::open(&archive).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
            if zipped.len()>30000{return Err("Java contiene demasiados archivos".into())}
            let mut extracted=0u64;
            for index in 0..zipped.len(){
                let mut entry=zipped.by_index(index).map_err(|e|e.to_string())?;
                let relative=entry.enclosed_name().ok_or("Ruta inválida dentro de Java ZIP")?;
                let destination=staging.join(relative);
                if entry.is_dir(){fs::create_dir_all(destination).map_err(|e|e.to_string())?;continue}
                extracted+=entry.size();if extracted>1200*1024*1024{return Err("Java supera el tamaño descomprimido".into())}
                if let Some(parent)=destination.parent(){fs::create_dir_all(parent).map_err(|e|e.to_string())?}
                std::io::copy(&mut entry,&mut File::create(destination).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
            }
        }else{
            let gz=GzDecoder::new(File::open(&archive).map_err(|e|e.to_string())?);
            let mut tar=tar::Archive::new(gz);let mut extracted=0u64;let mut count=0u64;
            for item in tar.entries().map_err(|e|e.to_string())? {
                let mut item=item.map_err(|e|e.to_string())?;count+=1;
                if count>30000{return Err("Java contiene demasiados archivos".into())}
                extracted+=item.size();if extracted>1200*1024*1024{return Err("Java supera el tamaño descomprimido".into())}
                if item.header().entry_type().is_symlink(){
                    let link=item.link_name().map_err(|e|e.to_string())?.ok_or("Enlace Java sin destino")?;
                    if !safe_java_link(&item.path().map_err(|e|e.to_string())?,&link){
                        return Err("Enlace Java inseguro".into())
                    }
                }
                if !item.unpack_in(&staging).map_err(|e|e.to_string())? {return Err("Ruta Java insegura en archivo".into())}
            }
        }
        let java=look_for_java(&staging,4).ok_or("Archivo Temurin sin ejecutable java")?;
        #[cfg(unix)]{use std::os::unix::fs::PermissionsExt;
            let mut perms=fs::metadata(&java).map_err(|e|e.to_string())?.permissions();
            perms.set_mode(perms.mode()|0o111);fs::set_permissions(&java,perms).map_err(|e|e.to_string())?;
        }
        if target.exists(){fs::remove_dir_all(&target).map_err(|e|e.to_string())?}
        fs::rename(&staging,&target).map_err(|e|e.to_string())?;
        Ok(())
    })();
    if outcome.is_err(){let _=fs::remove_file(&partial);let _=fs::remove_dir_all(&staging);}
    outcome?;
    let java=look_for_java(&target,4).ok_or("Temurin incompleto después de instalar")?;
    if java_major(java.as_os_str())!=Some(required){return Err("Java descargado no inicia; verificá permisos o librerías del sistema".into())}
    let _=app.emit("minecraft-progress",Progress{stage:"java".into(),completed:1,total:1,detail:format!("Java {required} instalado")});
    Ok(java)
}
/// One-click prerequisites for the GAME Horizon (not Horizon Launcher).
/// Mojang assets are fetched from official endpoints for the player's own
/// Minecraft Java installation; the game still needs an entitled Microsoft
/// session to launch online. No external Java/Horizon setup command is needed.
pub fn horizon_prerequisites(app:&AppHandle,data_root:&Path,username:&str,ins:&Instance,known_instances:&[PathBuf])->Result<(String,String,String),String>{
    let dir=instance_dir(data_root,username,ins)?;
    let base=dir.join(".vis").join("minecraft-base");
    let mut vanilla=Instance::default();
    vanilla.name="VIS-Horizon-Base".into();vanilla.project_id=ins.project_id.clone();
    vanilla.version=ins.version.clone();vanilla.loader="vanilla".into();
    vanilla.engine="java".into();vanilla.game_dir=base.to_string_lossy().into_owned();
    // Smart Install first reuses existing Mojang files and libraries.
    install(app,data_root,username,&vanilla,known_instances)?;
    let http=client()?;
    // Horizon checks Mojang's exact manifest bytes, not an equivalent reserialized JSON.
    let build=if ins.horizon_build_dir.is_empty() || ins.horizon_build_dir==crate::horizon::SOURCE_BUILD_ID {
        crate::horizon::bundled_source_path()?
    } else {ins.horizon_build_dir.clone()};
    let lock:Value=serde_json::from_slice(&fs::read(Path::new(&build).join("research-lock.json")).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    let manifest_sha=lock["minecraft"]["manifest_sha1"].as_str().ok_or("Horizon sin huella del manifiesto")?;
    if lock["minecraft"]["version"].as_str()!=Some(ins.version.as_str()) || manifest_sha.len()!=40 || !manifest_sha.bytes().all(|b|b.is_ascii_hexdigit()){
        return Err("El manifiesto fijado por Horizon no corresponde a la instancia".into());
    }
    let manifest_url=format!("https://piston-meta.mojang.com/v1/packages/{manifest_sha}/{}.json",ins.version);
    let manifest_path=base.join(".vslauncher/version.json");
    obtain_file(&http,&manifest_url,&manifest_path,Some(manifest_sha),20*1024*1024)?;
    let profile:Value=serde_json::from_slice(&fs::read(manifest_path).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    // The pinned release can use an older asset index than Mojang's current one.
    let runtime=base.join(".vis/runtime");
    let index=&profile["assetIndex"];
    let index_id=index["id"].as_str().ok_or("Índice sin ID")?;
    if !clean_segment(index_id){return Err("Índice inválido".into())}
    let index_path=runtime.join("assets/indexes").join(format!("{index_id}.json"));
    obtain_file(&http,index["url"].as_str().ok_or("Índice sin URL")?,&index_path,Some(index["sha1"].as_str().ok_or("Índice sin huella")?),20*1024*1024)?;
    let assets:Value=serde_json::from_slice(&fs::read(index_path).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    let mut tasks=Vec::new();
    let objects=assets["objects"].as_object().ok_or("Índice sin objetos")?;
    if objects.len()>30000{return Err("Índice de recursos anormalmente grande".into())}
    for asset in objects.values(){
        let hash=asset["hash"].as_str().ok_or("Recurso sin huella")?;
        if hash.len()!=40 || !hash.bytes().all(|b|b.is_ascii_hexdigit()){return Err("Huella inválida".into())}
        tasks.push(Task{url:format!("https://resources.download.minecraft.net/{}/{hash}",&hash[..2]),path:runtime.join("assets/objects").join(&hash[..2]).join(hash),sha1:Some(hash.into()),max:128*1024*1024});
    }
    normalize_download_plan(&mut tasks)?;
    download_tasks(&http,app,"Horizon pinned assets",&tasks,&runtime,&[])?;
    let server=&profile["downloads"]["server"];
    let server_url=server["url"].as_str().ok_or("Mojang no ofrece el server.jar de esta versión")?;
    let server_sha=server["sha1"].as_str().ok_or("Mojang no publicó SHA-1 del server.jar")?;
    let server_jar=base.join(".vis").join("minecraft-server.jar");
    if let Some(parent)=server_jar.parent(){fs::create_dir_all(parent).map_err(|e|e.to_string())?;}
    obtain_file(&http,server_url,&server_jar,Some(server_sha),700*1024*1024)?;
    // A JDK, not merely a JRE: Horizon's one-time preparation invokes exporters.
    let jdk_root=base.join(".vis/java-runtimes/temurin-25");
    let installed=look_for_java(&jdk_root,4).and_then(|java|{
        let home=java.parent()?.parent()?;
        let javac=home.join("bin").join(if cfg!(target_os="windows"){"javac.exe"}else{"javac"});
        (javac.is_file() && java_major(java.as_os_str())==Some(25)).then(||home.to_path_buf())
    });
    let java_home=if let Some(home)=installed{home}else{
        let java=install_java_runtime(&http,app,&base.join(".vis"),25)?;
        let home=java.parent().and_then(Path::parent).ok_or("Temurin JDK sin directorio principal")?;
        let javac=home.join("bin").join(if cfg!(target_os="windows"){"javac.exe"}else{"javac"});
        if !javac.is_file(){return Err("Se necesita un JDK 25 completo; el runtime descargado no incluye javac".into());}
        home.to_path_buf()
    };
    Ok((base.to_string_lossy().into_owned(),server_jar.to_string_lossy().into_owned(),java_home.to_string_lossy().into_owned()))
}

pub fn install(app:&AppHandle,data_root:&Path,username:&str,ins:&Instance,known_instances:&[PathBuf])->Result<LocalInstallation,String>{
 let _installation_lock=INSTALL_GUARD.lock().map_err(|_|"Otra instalación dejó bloqueado el gestor".to_string())?;
 if !clean_segment(&ins.version) || (ins.loader=="fabric" && !clean_segment(&ins.loader_version)) {
     return Err("Versión de Minecraft o Fabric con caracteres inválidos".into());
 }
 if ins.version.trim().is_empty(){return Err("Elegí una versión de Minecraft".into())}
 if !["vanilla","fabric"].contains(&ins.loader.as_str()){return Err("Elegí Vanilla o Fabric".into())}
 let c=client()?;let dir=instance_dir(data_root,username,ins)?;
 crate::instance_guard::private_paths(&dir,&[
     ".vslauncher",".vis/runtime/versions",".vis/runtime/libraries",
     ".vis/runtime/assets/indexes",".vis/runtime/assets/objects",
     ".vis/java-runtimes",".vslauncher/natives","mods"
 ])?;
 prepare_player_directory(&dir)?;
 let runtime=new_runtime(&dir);let lib_root=runtime.join("libraries");
 let source_roots=candidate_roots(data_root,known_instances,&runtime);
 let library_sources=sources_for_category(&source_roots,"libraries");
 let asset_sources=sources_for_category(&source_roots,"assets");
 let version_sources=sources_for_category(&source_roots,"versions");
 let mut library_and_version_sources=library_sources;
 library_and_version_sources.extend(version_sources);
 library_and_version_sources.sort();library_and_version_sources.dedup();
 let profile=version_metadata(&c,&ins.version)?;
 let client_obj=&profile["downloads"]["client"];
 let client_url=client_obj["url"].as_str().ok_or("Mojang no ofrece el JAR cliente")?;
 let client_task=Task{url:client_url.into(),sha1:client_obj["sha1"].as_str().map(ToOwned::to_owned),path:runtime.join("versions").join(&ins.version).join(format!("{}.jar",ins.version)),max:700*1024*1024};
 let mut tasks=vec![client_task];let mut natives=vec![];
 // Preserve the official Log4j configuration for this specific Minecraft version.
 if let (Some(id),Some(url))=(profile["logging"]["client"]["file"]["id"].as_str(),profile["logging"]["client"]["file"]["url"].as_str()){
   if !clean_segment(id){return Err("Archivo de logging inválido".into())}
   tasks.push(Task{url:url.to_owned(),path:runtime.join("assets/log_configs").join(id),sha1:profile["logging"]["client"]["file"]["sha1"].as_str().map(ToOwned::to_owned),max:3*1024*1024});
 }
 for lib in profile["libraries"].as_array().ok_or("Manifest sin bibliotecas")?{
  if let Some(t)=task_for_library(lib,&lib_root,"https://libraries.minecraft.net")?{tasks.push(t)}
  if let Some(t)=native_task(lib,&lib_root)?{natives.push(t.clone());tasks.push(t)}
 }
 let mut fabric_profile=Value::Null;
 if ins.loader=="fabric"{
  if ins.loader_version.is_empty(){return Err("Seleccioná una versión de Fabric Loader".into())}
  let profile_url=format!("{FABRIC}/versions/loader/{}/{}/profile/json",urlencoding::encode(&ins.version),urlencoding::encode(&ins.loader_version));
  fabric_profile=get_json(&c,&profile_url)?;
  for lib in fabric_profile["libraries"].as_array().ok_or("Perfil Fabric sin bibliotecas")?{
   if let Some(t)=task_for_library(lib,&lib_root,"https://maven.fabricmc.net")?{tasks.push(t)}
  }
 }
 normalize_download_plan(&mut tasks)?;
 download_tasks(&c,app,"libraries",&tasks,&runtime,&library_and_version_sources)?;
 let native_dir=dir.join(".vslauncher").join("natives");extract_natives(&natives,&native_dir)?;
 let asset_index=&profile["assetIndex"];
 let index_id=asset_index["id"].as_str().ok_or("Índice de recursos sin nombre")?;
 if !clean_segment(index_id){return Err("Índice de recursos inválido".into())}
 let index_task=Task{url:asset_index["url"].as_str().ok_or("Índice sin URL")?.into(),sha1:asset_index["sha1"].as_str().map(ToOwned::to_owned),path:runtime.join("assets/indexes").join(format!("{index_id}.json")),max:20*1024*1024};
 let reused_index=obtain_or_reuse(&c,&index_task,&runtime,&asset_sources)?;
 let _=app.emit("minecraft-progress",Progress{stage:"indexes".into(),completed:1,total:1,detail:if reused_index {"Índice reutilizado de una instalación existente".into()}else{"Índice descargado".into()}});
 let index:Value=serde_json::from_slice(&fs::read(index_task.path).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
 let mut asset_tasks=vec![];
 if let Some(entries)=index["objects"].as_object(){
  if entries.len()>30000 {return Err("Índice de recursos anormalmente grande".into())}
  let mut hashes=BTreeSet::new();
  for value in entries.values(){
    let hash=value["hash"].as_str().ok_or("Recurso Minecraft sin SHA-1")?;
    if hash.len()!=40 || !hash.bytes().all(|b|b.is_ascii_hexdigit()){
        return Err("Índice Minecraft contiene un SHA-1 incorrecto".into());
    }
    hashes.insert(hash.to_ascii_lowercase());
  }
  for hash in hashes{let prefix=&hash[..2];asset_tasks.push(Task{url:format!("https://resources.download.minecraft.net/{prefix}/{hash}"),sha1:Some(hash.clone()),path:runtime.join("assets/objects").join(prefix).join(hash),max:128*1024*1024});}
 }
 download_tasks(&c,app,"assets",&asset_tasks,&runtime,&asset_sources)?;
 let meta_dir=dir.join(".vslauncher");fs::create_dir_all(&meta_dir).map_err(|e|e.to_string())?;
 crate::accounts::atomic_json(&meta_dir.join("version.json"),&profile)?;
 if ins.loader=="fabric" {crate::accounts::atomic_json(&meta_dir.join("fabric.json"),&fabric_profile)?;}
 let required=profile["javaVersion"]["majorVersion"].as_u64().unwrap_or(8);
 install_java_runtime(&c,app,&dir.join(".vis"),required)?;
 let stamp=SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
 let result=LocalInstallation{version:ins.version.clone(),loader:ins.loader.clone(),loader_version:ins.loader_version.clone(),installed_at:stamp,runtime_storage:"instance-v1".into()};
 crate::accounts::atomic_json(&installation_path(&dir),&result)?;
 let _=app.emit("minecraft-progress",Progress{stage:"done".into(),completed:1,total:1,detail:ins.name.clone()});
 Ok(result)
}
fn argument_text(value:&Value,placeholders:&[(&str,String)])->Vec<String>{
 let mut out=vec![];let list=if let Some(a)=value.as_array(){a.clone()}else{vec![]};
 for item in list{if item.is_string(){if let Some(s)=item.as_str(){out.push(s.to_owned())}}else if matches_rules(item.get("rules")){
  if let Some(s)=item["value"].as_str(){out.push(s.to_owned())}
  else if let Some(a)=item["value"].as_array(){for s in a{if let Some(t)=s.as_str(){out.push(t.to_owned())}}}
 }}
 out.into_iter().map(|mut s|{for(k,v) in placeholders{s=s.replace(*k,v.as_str())}s}).collect()
}
/// Verified premium profile. The token is held in the Rust process and is
/// never persisted or returned to JavaScript.
#[derive(Clone)]
pub(crate) struct PremiumIdentity {
    pub name:String,
    pub uuid:String,
    pub access_token:String
}
pub fn launch(app:&AppHandle,data_root:&Path,username:&str,ins:&Instance)->Result<LaunchResult,String>{
 launch_with_game_directory(app,data_root,username,ins,None,None)
}
/// Launch a verified owned Minecraft profile. Token stays in native memory;
/// the Minecraft Java main class requires its access token as an argument.
pub fn launch_premium(app:&AppHandle,data_root:&Path,owner:&str,ins:&Instance,
    auth:&PremiumIdentity)->Result<LaunchResult,String>{
    launch_with_game_directory(app,data_root,owner,ins,None,Some(auth))
}
pub fn launch_guest(app:&AppHandle,data_root:&Path,owner:&str,ins:&Instance,guest:&str)->Result<LaunchResult,String>{
 if !clean_segment(guest) {return Err("Nombre offline inválido".into())}
 // Guest players retain their own offline UUID/name, but opening the same
 // installed instance uses the same worlds and server list by default.
 let folder=shared_game_directory(data_root,owner,ins,guest)?;
 let mut offline=ins.clone();
 offline.player_name=guest.to_owned();
 launch_with_game_directory(app,data_root,owner,&offline,Some(&folder),None)
}
/// The Minecraft identity changes between VIS accounts; the installed
/// instance's saves, servers.dat, options, packs and first-run state do not.
/// Profiles can explicitly opt into separate game data in instance settings.
pub fn launch_shared(app:&AppHandle,data_root:&Path,owner:&str,ins:&Instance,visitor:&str)->Result<LaunchResult,String>{
    if !clean_segment(visitor){return Err("Perfil VIS inválido".into());}
    let folder=shared_game_directory(data_root,owner,ins,visitor)?;
    let mut isolated=ins.clone();isolated.player_name=visitor.to_owned();
    launch_with_game_directory(app,data_root,owner,&isolated,Some(&folder),None)
}
/// Shared instance content, verified Premium UUID remains account-specific.
pub fn launch_shared_premium(app:&AppHandle,data_root:&Path,owner:&str,
    ins:&Instance,visitor:&str,auth:&PremiumIdentity)->Result<LaunchResult,String>{
    if !clean_segment(visitor){return Err("Perfil de jugador VIS inválido".into());}
    let folder=shared_game_directory(data_root,owner,ins,visitor)?;
    launch_with_game_directory(app,data_root,owner,ins,Some(&folder),Some(auth))
}
/// Shared game data is the default: switching VIS profiles should never
/// reset the worlds list, multiplayer server list or first-run presentation.
/// Previously isolated profile folders remain untouched for recovery.
pub fn shared_game_directory(data_root:&Path,owner:&str,ins:&Instance,visitor:&str)->Result<PathBuf,String>{
    if !clean_segment(visitor) {
        return Err("Perfil VIS inválido".into());
    }
    if ins.share_game_data {
        let root=instance_dir(data_root,owner,ins)?;
        prepare_player_directory(&root)?;
        return Ok(root);
    }
    private_shared_game_directory(data_root,owner,ins,visitor)
}
/// Opt-in private profile layout and historical location for data recovery.
pub fn private_shared_game_directory(data_root:&Path,owner:&str,ins:&Instance,visitor:&str)->Result<PathBuf,String>{
    // Two UI operations (e.g. Abrir carpeta + Jugar) must never race to
    // migrate the same old world. Serializing also prevents overwrites.
    let _layout_guard=SHARED_PLAYER_LAYOUT_GUARD.lock()
        .map_err(|_|"No se pudo proteger la carpeta compartida".to_string())?;
    if !clean_segment(visitor)||!clean_segment(owner)||!clean_segment(&ins.project_id){
        return Err("La identidad o proyecto de la instancia compartida es inválida".into());
    }
    // Historical names stay stable where safe. Hash unusual Unicode or
    // separator-containing titles instead of allowing path traversal.
    let human_name=ins.name.replace(' ',"-");
    let folder_name=if clean_segment(&human_name){human_name}else{
        let digest=Sha256::digest(ins.name.as_bytes());
        format!("instance-{}",digest[..12].iter().map(|b|format!("{b:02x}")).collect::<String>())
    };
    let relative=PathBuf::from(visitor).join(owner).join(&ins.project_id).join(folder_name);
    let root=instance_dir(data_root,owner,ins)?;
    let target=root.join(".vis/players").join(&relative);
    // Do not let a symlink in the owner .vis hierarchy escape the game.
    let internal=format!(".vis/players/{}",relative.to_string_lossy().replace('\\',"/"));
    crate::instance_guard::private_paths(&root,&[&internal])?;
    let parent=target.parent().ok_or("Directorio compartido inválido")?;
    fs::create_dir_all(parent).map_err(|e|format!("No se pudo preparar el espacio del otro perfil: {e}"))?;
    let old=data_root.join("shared-player-data").join(&relative);
    if !target.exists() && old.is_dir(){
        let stage=sibling_path(&target,"migration")?;
        let result=crate::horizon::copy_preparation_sources(&old,&stage)
            .and_then(|_|fs::rename(&stage,&target).map_err(|e|e.to_string()));
        if result.is_err(){let _=fs::remove_dir_all(&stage);}
        result?;
    }
    prepare_player_directory(&target)?;
    Ok(target)
}
/// Recover data created when older VIS versions isolated each account.
/// Nothing is ever deleted from the historical directories and existing
/// shared saves/settings are never overwritten.
#[derive(Clone,Serialize)]
pub struct SharedRecovery {
 pub source_count:usize,
 pub worlds:usize,
 pub other_files:usize,
 pub restored:usize,
 pub skipped:usize,
}
fn historical_shared_dirs(data_root:&Path,owner:&str,ins:&Instance,visitor:&str)->Result<Vec<PathBuf>,String>{
 if !clean_segment(owner)||!clean_segment(visitor)||!clean_segment(&ins.project_id){
    return Err("Perfil o proyecto inválido".into());
 }
 let human=ins.name.replace(' ',"-");
 let folder=if clean_segment(&human){human}else{
    let digest=Sha256::digest(ins.name.as_bytes());
    format!("instance-{}",digest[..12].iter().map(|b|format!("{b:02x}")).collect::<String>())
 };
 let rel=PathBuf::from(visitor).join(owner).join(&ins.project_id).join(folder);
 let root=instance_dir(data_root,owner,ins)?;
 let internal=PathBuf::from(".vis/players").join(&rel);
 Ok(vec![root.join(internal),data_root.join("shared-player-data").join(rel)])
}
pub(crate) fn recovery_sources(data_root:&Path,owner:&str,ins:&Instance,visitor:&str)->Result<Vec<PathBuf>,String>{
 let root=instance_dir(data_root,owner,ins)?;
 let mut safe=Vec::new();
 for candidate in historical_shared_dirs(data_root,owner,ins,visitor)? {
    if !candidate.exists(){continue;}
    let metadata=fs::symlink_metadata(&candidate).map_err(|e|e.to_string())?;
    if !metadata.is_dir()||metadata.file_type().is_symlink(){
        return Err("Carpeta antigua inválida o con enlace simbólico".into());
    }
    if candidate.starts_with(root.join(".vis/players")) {
        let relative=candidate.strip_prefix(&root).map_err(|e|e.to_string())?;
        crate::instance_guard::private_paths(&root,&[relative.to_string_lossy().as_ref()])?;
    }else {
        let relative=candidate.strip_prefix(data_root).map_err(|_|"Carpeta antigua fuera de VIS")?;
        crate::instance_guard::private_paths(data_root,&[relative.to_string_lossy().as_ref()])?;
    }
    safe.push(candidate);
 }
 Ok(safe)
}
const SHARED_RESTORE_CATEGORIES:&[&str]=&["saves","resourcepacks","shaderpacks"];
const SHARED_RESTORE_FILES:&[&str]=&["servers.dat","options.txt","optionsof.txt"];
pub fn shared_recovery(
 data_root:&Path,owner:&str,ins:&Instance,visitor:&str,apply:bool
)->Result<SharedRecovery,String>{
 if !ins.share_game_data{return Err("Activá compartir datos de la instancia antes de recuperar partidas".into());}
 if owner==visitor{return Err("Esta cuenta es propietaria de la instancia; sus mundos ya están en la carpeta principal".into());}
 let root=instance_dir(data_root,owner,ins)?;
 let sources=recovery_sources(data_root,owner,ins,visitor)?;
 let mut summary=SharedRecovery{
    source_count:sources.len(),worlds:0,other_files:0,restored:0,skipped:0
 };
 if apply {
    prepare_player_directory(&root)?;
 }
 // A running world must never be copied over while Minecraft is writing.
 // Hold the same per-instance guard as Java/Horizon launch until recovery ends.
 let _exclusive_recovery=if apply{Some(acquire_game_run(&root)?)}else{None};
 // The mutex serializes repeated recovery clicks and concurrent legacy
 // migrations, but preview remains a read-only operation.
 let _guard=SHARED_PLAYER_LAYOUT_GUARD.lock()
    .map_err(|_|"Hay otra operación de recuperación en curso".to_string())?;
 for source in sources {
    for category in SHARED_RESTORE_CATEGORIES {
        let folder=source.join(category);
        if !folder.is_dir(){continue;}
        if fs::symlink_metadata(&folder).map_err(|e|e.to_string())?.file_type().is_symlink(){
            return Err("Los datos antiguos contienen un enlace simbólico".into());
        }
        for entry in fs::read_dir(&folder).map_err(|e|e.to_string())?.take(512){
            let entry=entry.map_err(|e|e.to_string())?;
            let kind=entry.file_type().map_err(|e|e.to_string())?;
            if kind.is_symlink(){return Err("El recurso antiguo contiene un enlace simbólico".into());}
            if !kind.is_dir()&&!kind.is_file(){continue;}
            if *category=="saves"{summary.worlds+=1}else{summary.other_files+=1}
            let dest=root.join(category).join(entry.file_name());
            if dest.exists() {
                summary.skipped+=1;
                continue; // Never replace an existing world, pack or setting.
            }
            if !apply{continue;}
            let stage=sibling_path(&dest,"restore")?;
            let outcome=(||{
                if kind.is_dir(){
                    crate::horizon::copy_preparation_sources(&entry.path(),&stage)?;
                }else {
                    fs::copy(entry.path(),&stage).map_err(|e|e.to_string())?;
                }
                if dest.exists(){return Err("El destino cambió mientras se copiaba".into());}
                fs::rename(&stage,&dest).map_err(|e|e.to_string())
            })();
            if outcome.is_err(){
                if stage.is_dir(){let _=fs::remove_dir_all(&stage);}
                else{let _=fs::remove_file(&stage);}
            }
            outcome?;
            summary.restored+=1;
        }
    }
    for setting in SHARED_RESTORE_FILES {
        let from=source.join(setting);
        if !from.exists(){continue;}
        let metadata=fs::symlink_metadata(&from).map_err(|e|e.to_string())?;
        if metadata.file_type().is_symlink()||!metadata.is_file(){
            return Err("El archivo de configuración antiguo no es seguro".into());
        }
        summary.other_files+=1;
        let dest=root.join(setting);
        if dest.exists(){summary.skipped+=1;continue;}
        if !apply{continue;}
        // Stage the entire settings file before promotion, never exposing
        // half-copied servers.dat or options.txt to another account.
        let stage=sibling_path(&dest,"restore-settings")?;
        let copied=(||{
            let mut reader=File::open(&from).map_err(|e|e.to_string())?;
            let mut output=fs::OpenOptions::new().write(true).create_new(true)
                .open(&stage).map_err(|e|e.to_string())?;
            std::io::copy(&mut reader,&mut output).map_err(|e|e.to_string())?;
            output.sync_all().map_err(|e|e.to_string())?;
            if dest.exists(){return Err("El ajuste ya existe en la instancia compartida".into());}
            fs::rename(&stage,&dest).map_err(|e|e.to_string())
        })();
        if copied.is_err(){let _=fs::remove_file(&stage);}
        copied?;
        summary.restored+=1;
    }
 }
 Ok(summary)
}

fn launch_with_game_directory(app:&AppHandle,data_root:&Path,username:&str,ins:&Instance,game_override:Option<&Path>,premium:Option<&PremiumIdentity>)->Result<LaunchResult,String>{
 let dir=instance_dir(data_root,username,ins)?;
 let game_dir=game_override.unwrap_or(&dir);
 if !installed(&dir,ins){return Err("Primero instalá la instancia".into())}
 prepare_player_directory(game_dir)?;
 let game_run=acquire_game_run(game_dir)?;
 let meta_dir=dir.join(".vslauncher");
 let profile:Value=serde_json::from_slice(&fs::read(meta_dir.join("version.json")).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
 let fabric:Value=if ins.loader=="fabric"{serde_json::from_slice(&fs::read(meta_dir.join("fabric.json")).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?}else{Value::Null};
 let runtime=installed_runtime(data_root,&dir);let lib_root=runtime.join("libraries");
 let mut cp=vec![];
 // Fabric libraries first, so their launcher's class loader receives its required versions.
 if let Some(libs)=fabric["libraries"].as_array(){for lib in libs{if let Some(name)=lib["name"].as_str(){if matches_rules(lib.get("rules"))&&(lib["downloads"].get("artifact").is_some()||lib.get("downloads").is_none()){cp.push(lib_root.join(maven_relative(name)?));}}}}
 for lib in profile["libraries"].as_array().ok_or("Bibliotecas incompletas")?{if let Some(name)=lib["name"].as_str(){if matches_rules(lib.get("rules"))&&(lib["downloads"].get("artifact").is_some()||lib.get("downloads").is_none()){cp.push(lib_root.join(maven_relative(name)?));}}}
 cp.push(runtime.join("versions").join(&ins.version).join(format!("{}.jar",ins.version)));
 if cp.iter().any(|p|!p.is_file()){return Err("Faltan bibliotecas. Reinstalá la instancia.".into())}
 let classpath=std::env::join_paths(&cp).map_err(|e|e.to_string())?;
 let main_class=if ins.loader=="fabric"{fabric["mainClass"].as_str().unwrap_or("net.fabricmc.loader.impl.launch.knot.KnotClient")}
 else{profile["mainClass"].as_str().ok_or("Falta mainClass")?};
 let asset_index=profile["assetIndex"]["id"].as_str().ok_or("Falta índice de assets")?;
 let player_name=if let Some(auth)=premium{auth.name.as_str()}else if ins.player_name.trim().is_empty(){username}else{ins.player_name.trim()};
 if player_name.len()>16 || player_name.len()<3 || !player_name.bytes().all(|b|b.is_ascii_alphanumeric() || b==b'_'){
     return Err("El nick local de Minecraft debe tener 3–16 letras, números o guión bajo. Cambialo en Instancias.".into());
 }
 let mut offline_bytes=md5::compute(format!("OfflinePlayer:{player_name}").as_bytes()).0;
 offline_bytes[6]=(offline_bytes[6]&0x0f)|0x30;offline_bytes[8]=(offline_bytes[8]&0x3f)|0x80;
 let uuid=premium.map(|a|a.uuid.clone()).unwrap_or_else(||uuid::Uuid::from_bytes(offline_bytes).simple().to_string());
 let placeholders=[("${auth_player_name}",player_name.to_owned()),("${version_name}",ins.version.clone()),("${game_directory}",game_dir.to_string_lossy().into_owned()),("${assets_root}",runtime.join("assets").to_string_lossy().into_owned()),("${assets_index_name}",asset_index.into()),("${auth_uuid}",uuid),
  ("${auth_access_token}",premium.map(|a|a.access_token.clone()).unwrap_or_else(||"0".into())),("${clientid}","".into()),("${auth_xuid}","".into()),("${user_type}",if premium.is_some(){"msa".into()}else{"legacy".into()}),("${version_type}","VIS-Nexo".into()),("${user_properties}","{}".into())];
 let required_java=profile["javaVersion"]["majorVersion"].as_u64().unwrap_or(8);
 // No fallback to PATH, AppData or other installations: game is self-contained.
 // Explicit custom Java is retained as a user opt-in, never selected automatically.
 let managed=dir.join(".vis/java-runtimes").join(format!("temurin-{required_java}"));
 let java=if !ins.java_path.trim().is_empty() {
     find_java(&dir.join(".vis"),ins,required_java)
 } else {
     look_for_java(&managed,4).filter(|p|java_major(p.as_os_str())==Some(required_java))
 }.ok_or_else(||format!("Falta Temurin Java {required_java} dentro de la instancia. Ejecutá Instalar/Reparar para descargarlo sin usar .minecraft global."))?;
 let mut cmd=Command::new(java);
 configure_instance_environment(&mut cmd,game_dir)?;
 cmd.arg(format!("-Djava.io.tmpdir={}",game_dir.join(".vis/tmp").display()));
 if let (Some(id),Some(argument))=(profile["logging"]["client"]["file"]["id"].as_str(),profile["logging"]["client"]["argument"].as_str()){
   if !clean_segment(id){return Err("Archivo de logging inválido".into())}
   let path=runtime.join("assets/log_configs").join(id);
   if path.is_file(){cmd.arg(argument.replace("${path}",&path.to_string_lossy()));}
 }
 if cfg!(target_os="macos"){cmd.arg("-XstartOnFirstThread");}
 cmd.arg(format!("-Xmx{}M",ins.ram_mb)).arg("-Xms512M");
 // Modern releases provide their own JVM flags (native paths, module opens and classpath).
 // Use those official flags instead of accidentally omitting Java 17/21 requirements.
 if profile["arguments"]["jvm"].is_array(){
   let jvm_vars=[
    ("${natives_directory}",meta_dir.join("natives").to_string_lossy().into_owned()),
    ("${launcher_name}","VIS-Nexo".to_owned()),
    ("${launcher_version}","2.13.0".to_owned()),
    ("${classpath}",classpath.to_string_lossy().into_owned()),
    ("${classpath_separator}",if cfg!(target_os="windows"){";".to_owned()}else{":".to_owned()}),
    ("${library_directory}",lib_root.to_string_lossy().into_owned()),
   ];
   for arg in argument_text(&profile["arguments"]["jvm"],&jvm_vars){cmd.arg(arg);}
 }else{
   // Legacy versions (before the structured JVM argument manifest).
   cmd.arg(format!("-Djava.library.path={}",meta_dir.join("natives").display()))
    .arg("-cp").arg(classpath);
 }
 cmd.arg("-Dminecraft.launcher.brand=VIS-Nexo")
    .arg("-Dminecraft.launcher.version=2.13.0")
    .arg(main_class);
 let game_args=if profile["arguments"]["game"].is_array(){argument_text(&profile["arguments"]["game"],&placeholders)}
 else{profile["minecraftArguments"].as_str().unwrap_or("").split_whitespace().map(str::to_owned).map(|mut a|{for(k,v) in &placeholders{a=a.replace(*k,v.as_str())}a}).collect()};
 for arg in game_args { cmd.arg(arg); }
 if ins.fullscreen{cmd.arg("--fullscreen");}
 fs::create_dir_all(game_dir.join("logs")).map_err(|e|e.to_string())?;
 let stamp=SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
 let log_path=game_dir.join("logs").join(format!("vslauncher-{stamp}.log"));
 let logfile=File::create(&log_path).map_err(|e|e.to_string())?;
 cmd.current_dir(game_dir).stdout(Stdio::from(logfile.try_clone().map_err(|e|e.to_string())?)).stderr(Stdio::from(logfile));
 inherit_game_lock(&mut cmd,&game_run);
 let mut child=cmd.spawn().map_err(|e|format!("Java no pudo iniciar Minecraft: {e}"))?;
 let pid=child.id();let log_file=log_path.to_string_lossy().into_owned();
 // Do not report a successful game just because java.exe/spawn returned a PID.
 // Wait outside the UI thread and publish an actionable exit/crash event.
 let emitter=app.clone();let exit_log=log_file.clone();
 std::thread::spawn(move||{
    let _active_instance=game_run;
    let outcome=child.wait();
    let event=match outcome {
        Ok(status)=>LaunchExit{pid,success:status.success(),exit_code:status.code(),log_file:exit_log,error:String::new()},
        Err(error)=>LaunchExit{pid,success:false,exit_code:None,log_file:exit_log,error:error.to_string()},
    };
    // Restore the launcher on game exit so diagnostics can actually be read.
    if let Some(window)=emitter.get_webview_window("main") {let _=window.unminimize();}
    let _=emitter.emit("minecraft-process-exited",event);
 });
 Ok(LaunchResult{pid,log_file,offline:premium.is_none()})
}

pub fn search_modrinth(query:&str,version:&str,kind:&str)->Result<Vec<ModHit>,String>{
 if query.len()>120 || !["mod","resourcepack","shader"].contains(&kind){return Err("Búsqueda inválida".into())}
 if !clean_segment(version){return Err("Seleccioná una versión válida".into())}
 let c=client()?;let facets=if kind=="mod"{json!([["project_type:mod"],["categories:fabric"],[format!("versions:{version}")]])}
 else{json!([[format!("project_type:{kind}")],[format!("versions:{version}")]])};
 let facet_text=facets.to_string();
 let response=c.get(format!("{MODRINTH}/search")).query(&[("query",query),("facets",facet_text.as_str()),("limit","30")])
  .send().and_then(|r|r.error_for_status()).map_err(|e|e.to_string())?.json::<Value>().map_err(|e|e.to_string())?;
 let mut results=vec![];for item in response["hits"].as_array().ok_or("Modrinth no devolvió resultados")?{
  results.push(ModHit{id:item["project_id"].as_str().unwrap_or("").into(),slug:item["slug"].as_str().unwrap_or("").into(),
   title:item["title"].as_str().unwrap_or("").into(),description:item["description"].as_str().unwrap_or("").into(),
   icon_url:item["icon_url"].as_str().unwrap_or("").into(),downloads:item["downloads"].as_u64().unwrap_or(0)});
 }Ok(results)
}
fn project_versions(c:&Client,project_id:&str,version:&str,kind:&str)->Result<Vec<Value>,String>{
 if !project_id.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-'||b==b'_'){return Err("ID Modrinth inválido".into())}
 let mut request=c.get(format!("{MODRINTH}/project/{project_id}/version"));
 let versions=json!([version]).to_string();request=request.query(&[("game_versions",versions)]);
 if kind=="mod"{request=request.query(&[("loaders",json!(["fabric"]).to_string())]);}
 let value=request.send().and_then(|r|r.error_for_status()).map_err(|e|e.to_string())?.json::<Value>().map_err(|e|e.to_string())?;
 value.as_array().cloned().ok_or("No se encontraron versiones compatibles".into())
}
// Kahn's topological sort: download required dependencies before their consumers.
// Complexity O(V+E) for at most 32 selected Modrinth projects; detect cycles.
fn mod_install_order(versions:&[Value])->Result<Vec<usize>,String>{
 let mut by_project=HashMap::new();let mut by_version=HashMap::new();
 for (index,v) in versions.iter().enumerate(){
  let pid=v["project_id"].as_str().ok_or("Modrinth sin ID de proyecto")?;
  let vid=v["id"].as_str().ok_or("Modrinth sin ID de versión")?;
  by_project.insert(pid,index);by_version.insert(vid,index);
 }
 let mut degree=vec![0usize;versions.len()];let mut dependents=vec![Vec::new();versions.len()];
 for (index,v) in versions.iter().enumerate(){
  if let Some(deps)=v["dependencies"].as_array(){for dep in deps{
   if dep["dependency_type"].as_str()!=Some("required"){continue}
   let target=dep["project_id"].as_str().and_then(|id|by_project.get(id))
       .or_else(||dep["version_id"].as_str().and_then(|id|by_version.get(id)))
       .ok_or("Una dependencia requerida no pudo resolverse")?;
   dependents[*target].push(index);degree[index]+=1;
  }}
 }
 let mut ready:VecDeque<usize>=degree.iter().enumerate().filter(|(_,d)|**d==0).map(|(i,_)|i).collect();
 let mut sorted=Vec::with_capacity(versions.len());
 while let Some(next)=ready.pop_front(){
  sorted.push(next);
  for &consumer in &dependents[next]{
   degree[consumer]-=1;
   if degree[consumer]==0{ready.push_back(consumer)}
  }
 }
 if sorted.len()!=versions.len(){return Err("Dependencias cíclicas: no se pueden instalar los mods".into())}
 Ok(sorted)
}

pub fn install_modrinth(data_root:&Path,username:&str,ins:&Instance,project_id:&str,kind:&str)->Result<Vec<String>,String>{
 if !["mod","resourcepack","shader"].contains(&kind){return Err("Tipo de contenido inválido".into())}
 if kind=="mod"&&ins.loader!="fabric"{return Err("Esta instalación de mods requiere Fabric".into())}
 let c=client()?;let dir=instance_dir(data_root,username,ins)?;
 crate::instance_guard::private_paths(&dir,&["mods","resourcepacks","shaderpacks",".vslauncher"])?;
 let folder=match kind{"mod"=>"mods","resourcepack"=>"resourcepacks",_=>"shaderpacks"};
 let mut queue=vec![(project_id.to_owned(),None::<String>,0usize)];
 let mut chosen:HashMap<String,String>=HashMap::new();let mut resolved=Vec::new();
 while let Some((id,pinned_version,depth))=queue.pop(){
  if depth>6||resolved.len()>=32{return Err("Demasiadas dependencias requeridas".into())}
  let pinned=if let Some(version_id)=pinned_version.as_ref(){
    if !clean_segment(version_id){return Err("Dependencia Modrinth inválida".into())}
    get_json(&c,&format!("{MODRINTH}/version/{version_id}"))?
  }else{
    let versions=project_versions(&c,&id,&ins.version,kind)?;
    versions.iter().find(|v|v["version_type"].as_str()==Some("release"))
      .or_else(||versions.first()).cloned()
      .ok_or_else(||format!("Sin versión compatible para {id} en {}",ins.version))?
  };
  let v=&pinned;
  let canonical=v["project_id"].as_str().ok_or("Modrinth sin ID de proyecto")?;
  let version_id=v["id"].as_str().ok_or("Modrinth sin ID de versión")?;
  if let Some(previous)=chosen.get(canonical){
    if pinned_version.is_some() && previous!=version_id{
      return Err(format!("Dependencias incompatibles para el mod {canonical}"))
    }
    continue
  }
  if !v["game_versions"].as_array().is_some_and(|a|a.iter().any(|x|x.as_str()==Some(ins.version.as_str()))){
      return Err("Una dependencia no es compatible con esta versión Minecraft".into())
  }
  if kind=="mod" && !v["loaders"].as_array().is_some_and(|a|a.iter().any(|x|x.as_str()==Some("fabric"))){
      return Err("El mod requerido no es compatible con Fabric".into())
  }
  // Resolve the complete graph first; do not leave the parent mod installed
  // if a required dependency cannot be found.
  if kind=="mod"{if let Some(deps)=v["dependencies"].as_array(){for dep in deps{
    if dep["dependency_type"].as_str()==Some("required"){
      let id=dep["project_id"].as_str().or_else(||dep["version_id"].as_str())
        .ok_or("Dependencia requerida sin identificador")?;
      queue.push((id.to_owned(),dep["version_id"].as_str().map(str::to_owned),depth+1));
    }
  }}}
  chosen.insert(canonical.to_owned(),version_id.to_owned());
  resolved.push(pinned);
 }
 let order=mod_install_order(&resolved)?;
 // PREPARE: validate all filenames/checksums before changing the installed set.
 let mut planned:Vec<(String,String,String)>=Vec::new();
 let mut filenames:HashMap<String,String>=HashMap::new();
 for index in order{
  let v=&resolved[index];
  let file=v["files"].as_array().and_then(|a|a.iter().find(|f|f["primary"].as_bool()==Some(true)).or_else(||a.first())).ok_or("Versión sin archivo")?;
  let url=file["url"].as_str().ok_or("Descarga sin URL")?;
  if !official_url(url){return Err("Archivo fuera de CDN confiable Modrinth".into())}
  let name=file["filename"].as_str().ok_or("Archivo sin nombre")?;safe_file_name(name)?;
  let good_ext=if kind=="mod"{name.ends_with(".jar")}else{name.ends_with(".zip")};
  if !good_ext{return Err("Extensión incompatible con este tipo de recurso".into())}
  let sha=file["hashes"]["sha1"].as_str().ok_or("Modrinth no suministró SHA-1")?;
  if sha.len()!=40||!sha.bytes().all(|b|b.is_ascii_hexdigit()){return Err("SHA-1 de mod inválido".into())}
  if let Some(old)=filenames.insert(name.to_owned(),sha.to_owned()){
   if !old.eq_ignore_ascii_case(sha){return Err(format!("Dos mods intentan usar el archivo {name}"))}
   continue
  }
  planned.push((name.to_owned(),url.to_owned(),sha.to_owned()));
 }
 let directory=dir.join(folder);fs::create_dir_all(&directory).map_err(|e|e.to_string())?;
 let stage=sibling_path(&directory.join("pending-mods"),"staging")?;
 fs::create_dir(&stage).map_err(|e|e.to_string())?;
 // TRANSFER: download to a staging directory. A network/checksum failure leaves
 // the previously installed files untouched.
 let result=(||->Result<(),String>{
  let mut changed:Vec<String>=Vec::new();
  for (name,url,sha) in &planned{
   let dest=directory.join(name);
   ensure_regular_or_absent(&dest)?;
   if cached_file_valid(&dest,Some(sha),150*1024*1024){continue}
   obtain_file(&c,url,&stage.join(name),Some(sha),150*1024*1024)?;
   changed.push(name.clone());
  }
  promote_mod_batch(&directory,&stage,&changed)
 })();
 let _=fs::remove_dir_all(&stage);
 result?;
 Ok(planned.into_iter().map(|(name,_,_)|name).collect())
}
pub fn import_local(data_root:&Path,username:&str,ins:&Instance,source:&Path,kind:&str)->Result<InstalledFile,String>{
 let folder=match kind{"mod" if ins.loader=="fabric"=>"mods","resourcepack"=>"resourcepacks","shader"=>"shaderpacks",_=>return Err("Tipo de recurso no compatible con esta instancia".into())};
 let name=source.file_name().and_then(|s|s.to_str()).ok_or("Archivo sin nombre")?;safe_file_name(name)?;
 if !(if kind=="mod"{name.ends_with(".jar")}else{name.ends_with(".zip")}){return Err("Formato de archivo incompatible".into())}
 let metadata=fs::metadata(source).map_err(|e|e.to_string())?;if metadata.len()>150*1024*1024{return Err("Archivo mayor a 150 MB".into())}
 let destination=instance_dir(data_root,username,ins)?.join(folder);fs::create_dir_all(&destination).map_err(|e|e.to_string())?;
 fs::copy(source,destination.join(name)).map_err(|e|e.to_string())?;
 Ok(InstalledFile{file:name.into(),kind:kind.into(),bytes:metadata.len(),enabled:true})
}
pub fn list_local(data_root:&Path,username:&str,ins:&Instance)->Result<Vec<InstalledFile>,String>{let root=instance_dir(data_root,username,ins)?;
 let mut result=vec![];for (folder,kind) in [("mods","mod"),("resourcepacks","resourcepack"),("shaderpacks","shader")]{
  if let Ok(rd)=fs::read_dir(root.join(folder)){for entry in rd.flatten(){let Ok(metadata)=entry.metadata() else{continue};if metadata.is_file(){
   let name=entry.file_name().to_string_lossy().into_owned();let extension=if kind=="mod"{".jar"}else{".zip"};
   let enabled=name.ends_with(extension);
   let disabled=name.ends_with(&format!("{extension}.disabled"));
   if (enabled||disabled) && safe_file_name(&name).is_ok(){result.push(InstalledFile{file:name,kind:kind.into(),bytes:metadata.len(),enabled})}
  }}}
 }result.sort_by(|a,b|a.kind.cmp(&b.kind).then_with(||a.file.cmp(&b.file)));
 Ok(result)
}
// Fabric and Minecraft ignore *.jar.disabled / *.zip.disabled; no bytes are erased.
// Check both paths so enabling cannot overwrite a newly imported resource.
pub fn toggle_local(data_root:&Path,username:&str,ins:&Instance,kind:&str,name:&str)->Result<String,String>{
 safe_file_name(name)?;
 let (folder,extension)=match kind{
  "mod" if ins.loader=="fabric"=>("mods",".jar"),
  "resourcepack"=>("resourcepacks",".zip"),
  "shader"=>("shaderpacks",".zip"),
  _=>return Err("Este recurso no se puede activar en esta instancia".into()),
 };
 let next=if name.ends_with(&format!("{extension}.disabled")){
   name.strip_suffix(".disabled").ok_or("Nombre de recurso inválido")?.to_owned()
 }else if name.ends_with(extension){format!("{name}.disabled")}
 else{return Err("Extensión no compatible".into())};
 let root=instance_dir(data_root,username,ins)?.join(folder);
 let source=root.join(name);let target=root.join(&next);
 let original=fs::symlink_metadata(&source).map_err(|e|e.to_string())?;
 if !original.is_file()||original.file_type().is_symlink(){return Err("Solo se pueden cambiar archivos normales".into())}
 if target.exists()||fs::symlink_metadata(&target).is_ok(){return Err("Ya existe un recurso con ese nombre de destino".into())}
 fs::rename(source,target).map_err(|e|e.to_string())?;
 Ok(next)
}
pub fn remove_local(data_root:&Path,username:&str,ins:&Instance,kind:&str,name:&str)->Result<(),String>{safe_file_name(name)?;
 let folder=match kind{"mod"=>"mods","resourcepack"=>"resourcepacks","shader"=>"shaderpacks",_=>return Err("Tipo inválido".into())};
 let target=instance_dir(data_root,username,ins)?.join(folder).join(name);
 fs::remove_file(target).map_err(|e|e.to_string())
}
#[cfg(test)]mod tests{use super::*;
 #[test]fn shared_saves_are_copied_into_instance_without_deleting_original(){
  let root=std::env::temp_dir().join(format!("vis-player-migration-{}-{}",std::process::id(),DOWNLOAD_NONCE.fetch_add(1,Ordering::Relaxed)));
  let ins=Instance{name:"Test".into(),project_id:"personal".into(),game_dir:root.join("instance").to_string_lossy().into_owned(),share_game_data:false,..Default::default()};
  let old=root.join("shared-player-data/visitor/owner/personal/Test/saves");
  fs::create_dir_all(&old).unwrap();fs::write(old.join("world.dat"),b"saved world").unwrap();
  let local=shared_game_directory(&root,"owner",&ins,"visitor").unwrap();
  // Windows canonicalize() may return the extended \\?\\ path prefix.
  // Compare both paths after the same private-instance normalization.
  let resolved=instance_dir(&root,"owner",&ins).unwrap();
  assert!(local.starts_with(resolved.join(".vis/players")));
  assert_eq!(fs::read(local.join("saves/world.dat")).unwrap(),b"saved world");
  assert!(old.join("world.dat").is_file());
  fs::remove_dir_all(root).unwrap();
 }
 #[test]fn shared_install_has_independent_save_folders_before_first_world(){
  let root=std::env::temp_dir().join(format!("vis-isolation-{}-{}",
      std::process::id(),DOWNLOAD_NONCE.fetch_add(1,Ordering::Relaxed)));
  let ins=Instance{name:"Coop Test".into(),project_id:"__personal__".into(),
      game_dir:root.join("Instancias/coop").to_string_lossy().into_owned(),
      share_game_data:false,..Default::default()};
  let owner=instance_dir(&root,"owner",&ins).unwrap();
  prepare_player_directory(&owner).unwrap();
  let alice=shared_game_directory(&root,"owner",&ins,"alice").unwrap();
  let bob=shared_game_directory(&root,"owner",&ins,"bob").unwrap();
  for folder in [&owner,&alice,&bob]{
    for kind in ["resourcepacks","saves","shaderpacks","config","mods","logs","screenshots"] {
      assert!(folder.join(kind).is_dir(),"{kind}: {}",folder.display());
    }
  }
  assert_ne!(alice,bob);
  assert_ne!(alice,owner);
  assert_ne!(bob,owner);
  fs::create_dir_all(alice.join("saves/Private World")).unwrap();
  fs::write(alice.join("saves/Private World/level.dat"),b"Alice's world").unwrap();
  assert!(!bob.join("saves/Private World/level.dat").exists());
  assert!(!owner.join("saves/Private World/level.dat").exists());
  assert_eq!(shared_game_directory(&root,"owner",&ins,"alice").unwrap(),alice);
  assert_eq!(fs::read(alice.join("saves/Private World/level.dat")).unwrap(),b"Alice's world");
  let _=fs::remove_dir_all(root);
 }
 #[test]fn switching_vis_accounts_preserves_the_same_worlds_servers_and_first_launch(){
  let root=std::env::temp_dir().join(format!("vis-shared-content-{}-{}",
      std::process::id(),DOWNLOAD_NONCE.fetch_add(1,Ordering::Relaxed)));
  let ins=Instance{name:"Servidor de amigos".into(),project_id:"__personal__".into(),
      game_dir:root.join("Instancias/servidor-amigos").to_string_lossy().into_owned(),
      ..Default::default()};
  let owner=instance_dir(&root,"owner",&ins).unwrap();
  prepare_player_directory(&owner).unwrap();
  fs::create_dir_all(owner.join("saves/Mi Mundo")).unwrap();
  fs::write(owner.join("saves/Mi Mundo/level.dat"),b"World 1").unwrap();
  fs::write(owner.join("servers.dat"),b"Fake-NBT-for-path-test").unwrap();
  fs::write(owner.join("options.txt"),b"joinedFirstServer:true").unwrap();
  let profile_b=shared_game_directory(&root,"owner",&ins,"other").unwrap();
  let profile_c=shared_game_directory(&root,"owner",&ins,"third").unwrap();
  assert_eq!(profile_b,owner);
  assert_eq!(profile_c,owner);
  assert_eq!(fs::read(profile_b.join("saves/Mi Mundo/level.dat")).unwrap(),b"World 1");
  assert_eq!(fs::read(profile_c.join("servers.dat")).unwrap(),b"Fake-NBT-for-path-test");
  assert_eq!(fs::read(profile_c.join("options.txt")).unwrap(),b"joinedFirstServer:true");
  let _=fs::remove_dir_all(root);
 }
 #[test]fn old_instance_without_shared_flag_defaults_to_shared_data(){
  let legacy=serde_json::json!({"name":"Legacy","project_id":"__personal__"});
  let ins:Instance=serde_json::from_value(legacy).unwrap();
  assert!(ins.share_game_data);
  let mut private=ins.clone();private.share_game_data=false;
  assert!(!private.share_game_data);
 }
 #[test]fn legacy_profile_recovery_keeps_original_and_never_replaces_worlds(){
  let base=std::env::temp_dir().join(format!("vis-legacy-restore-{}-{}",
      std::process::id(),DOWNLOAD_NONCE.fetch_add(1,Ordering::Relaxed)));
  let ins=Instance{name:"Shared".into(),project_id:"__personal__".into(),
      game_dir:base.join("Instancias/shared").to_string_lossy().into_owned(),..Default::default()};
  let root=instance_dir(&base,"owner",&ins).unwrap();
  let sources=historical_shared_dirs(&base,"owner",&ins,"visitor").unwrap();
  fs::create_dir_all(sources[0].join("saves/Antiguo")).unwrap();
  fs::write(sources[0].join("saves/Antiguo/level.dat"),b"original").unwrap();
  fs::write(sources[0].join("servers.dat"),b"old servers").unwrap();
  let preview=shared_recovery(&base,"owner",&ins,"visitor",false).unwrap();
  assert_eq!(preview.worlds,1);
  assert_eq!(preview.restored,0);
  let restored=shared_recovery(&base,"owner",&ins,"visitor",true).unwrap();
  assert_eq!(restored.restored,2);
  assert_eq!(fs::read(root.join("saves/Antiguo/level.dat")).unwrap(),b"original");
  assert_eq!(fs::read(root.join("servers.dat")).unwrap(),b"old servers");
  assert_eq!(fs::read(sources[0].join("saves/Antiguo/level.dat")).unwrap(),b"original");
  fs::write(root.join("servers.dat"),b"owner's preferred servers").unwrap();
  let again=shared_recovery(&base,"owner",&ins,"visitor",true).unwrap();
  assert_eq!(again.restored,0);
  assert!(again.skipped>=2);
  assert_eq!(fs::read(root.join("servers.dat")).unwrap(),b"owner's preferred servers");
  let _=fs::remove_dir_all(base);
 }
 #[test]fn only_one_game_can_write_to_the_same_shared_world_at_a_time(){
  let dir=std::env::temp_dir().join(format!("vis-guard-{}-{}",
      std::process::id(),DOWNLOAD_NONCE.fetch_add(1,Ordering::Relaxed)));
  prepare_player_directory(&dir).unwrap();
  let running=acquire_game_run(&dir).unwrap();
  assert!(acquire_game_run(&dir).is_err());
  drop(running);
  assert!(acquire_game_run(&dir).is_ok());
  let _=fs::remove_dir_all(dir);
 }
 #[cfg(unix)]
 #[test]fn resourcepacks_cannot_redirect_to_another_users_files(){
  use std::os::unix::fs::symlink;
  let root=std::env::temp_dir().join(format!("vis-unsafe-packs-{}-{}",
      std::process::id(),DOWNLOAD_NONCE.fetch_add(1,Ordering::Relaxed)));
  let game=root.join("Instancias/safe");
  let other=root.join("foreign");
  fs::create_dir_all(&game).unwrap();fs::create_dir_all(&other).unwrap();
  symlink(&other,game.join("resourcepacks")).unwrap();
  assert!(prepare_player_directory(&game).is_err());
  assert!(fs::read_dir(&other).unwrap().next().is_none());
  let _=fs::remove_dir_all(root);
 }
 #[test]fn child_caches_and_temporary_files_are_instance_local(){
  let root=std::env::temp_dir().join(format!("vis-child-env-{}-{}",std::process::id(),DOWNLOAD_NONCE.fetch_add(1,Ordering::Relaxed)));
  let mut cmd=Command::new("unused-test-command");
  configure_instance_environment(&mut cmd,&root).unwrap();
  for (_,value) in cmd.get_envs(){assert!(Path::new(value.unwrap()).starts_with(&root));}
  fs::remove_dir_all(root).unwrap();
 }
 #[test]fn java_legal_links_stay_inside_archive_root(){
  let member=Path::new("jdk-25/legal/java.logging/LICENSE");
  assert!(safe_java_link(member,Path::new("../java.base/LICENSE")));
  assert!(!safe_java_link(member,Path::new("../../../outside")));
  assert!(!safe_java_link(member,Path::new("/etc/passwd")));
 }
 #[test]fn maven_guard(){assert_eq!(maven_relative("net.fabricmc:fabric-loader:0.18.4").unwrap(),"net/fabricmc/fabric-loader/0.18.4/fabric-loader-0.18.4.jar");assert!(maven_relative("../../evil:art:1").is_err());}
 #[test]fn allowlist(){assert!(official_url("https://libraries.minecraft.net/x.jar"));assert!(!official_url("http://libraries.minecraft.net/x.jar"));assert!(!official_url("https://malware.example/x.jar"));}
 #[test]fn versions_and_paths_are_sanitized(){
     assert!(clean_segment("1.21.11"));assert!(clean_segment("0.18.4"));
     assert!(!clean_segment("../evil"));assert!(!clean_segment("evil/../x"));
     assert!(!clean_segment(""));
 }
 #[test]fn id_and_library_paths_never_escape(){
     assert!(maven_relative("test:artifact:../../escape").is_err());
     assert!(safe_file_name("../saves/world.dat").is_err());
 }
 #[test]fn streaming_hash_matches_reference(){
     let bytes=b"VIS Worlds cached Minecraft assets";
     assert_eq!(sha1_reader(&bytes[..]).unwrap(),format!("{:x}",Sha1::digest(bytes)));
 }
 #[test]fn topological_dependency_order_and_cycle(){
     let child=json!({"id":"v-child","project_id":"p-child","dependencies":[]});
     let parent=json!({"id":"v-parent","project_id":"p-parent","dependencies":[{"dependency_type":"required","project_id":"p-child"}]});
     assert_eq!(mod_install_order(&[parent.clone(),child.clone()]).unwrap(),vec![1,0]);
     let cycle=json!({"id":"v-child","project_id":"p-child","dependencies":[{"dependency_type":"required","project_id":"p-parent"}]});
     assert!(mod_install_order(&[parent,cycle]).is_err());
 }
 #[test]fn bounded_parallelism(){
     assert_eq!(download_parallelism(0,8),0);
     assert_eq!(download_parallelism(1,16),1);
     assert_eq!(download_parallelism(80,2),2);
     assert_eq!(download_parallelism(8000,32),4);
 }
 #[test]fn releases_are_not_truncated_by_snapshots(){
     let mut versions=vec![];
     for n in 0..140 {versions.push(json!({"id":format!("26.x-snapshot-{n}"),"type":"snapshot"}));}
     versions.push(json!({"id":"1.12.2","type":"release"}));
     versions.push(json!({"id":"1.8.9","type":"release"}));
     let chosen=select_versions(&json!({"versions":versions})).unwrap();
     assert_eq!(chosen[0].id,"1.12.2");assert_eq!(chosen[1].id,"1.8.9");
     assert_eq!(chosen.len(),62);
 }
 #[test]fn unique_temp_names_and_atomic_promotion(){
  let root=std::env::temp_dir().join(format!("vis211-{}-{}",std::process::id(),DOWNLOAD_NONCE.fetch_add(1,Ordering::Relaxed)));
  fs::create_dir_all(&root).unwrap();let target=root.join("mc.jar");
  let a=sibling_path(&target,"part").unwrap();let b=sibling_path(&target,"part").unwrap();
  assert_ne!(a,b);fs::write(&target,b"previous").unwrap();fs::write(&a,b"verified").unwrap();
  promote_download(&a,&target).unwrap();assert_eq!(fs::read(target).unwrap(),b"verified");
  let _=fs::remove_dir_all(root);
 }
 #[test]fn task_plan_rejects_conflicting_hashes(){
  let mut plan=vec![Task{url:"https://libraries.minecraft.net/a".into(),path:PathBuf::from("lib.jar"),sha1:Some("a".repeat(40)),max:100},
    Task{url:"https://maven.fabricmc.net/a".into(),path:PathBuf::from("lib.jar"),sha1:Some("b".repeat(40)),max:100}];
  assert!(normalize_download_plan(&mut plan).is_err());
 }
 #[test]fn smart_install_copies_only_matching_sha1(){
  let root=std::env::temp_dir().join(format!("vis212-reuse-{}-{}",std::process::id(),DOWNLOAD_NONCE.fetch_add(1,Ordering::Relaxed)));
  fs::create_dir_all(&root).unwrap();
  let old=root.join("old.jar");let target=root.join("new.jar");
  let valid=b"Minecraft tested library data";
  fs::write(&old,valid).unwrap();
  let digest=format!("{:x}",Sha1::digest(valid));
  assert!(copy_verified_candidate(&old,&target,&digest,1024).unwrap());
  assert_eq!(fs::read(&target).unwrap(),valid);
  fs::remove_file(&target).unwrap();
  assert!(!copy_verified_candidate(&old,&target,&"0".repeat(40),1024).unwrap());
  assert!(!target.exists());
  assert_eq!(fs::read(&old).unwrap(),valid);
  let _=fs::remove_dir_all(root);
 }
 #[test]fn old_installation_requires_private_runtime_repair(){
  let root=std::env::temp_dir().join(format!("vis212-compat-{}-{}",std::process::id(),DOWNLOAD_NONCE.fetch_add(1,Ordering::Relaxed)));
  fs::create_dir_all(root.join("inst/.vslauncher")).unwrap();
  fs::write(root.join("inst/.vslauncher/install.json"),r#"{"version":"1.20.1","loader":"vanilla","loader_version":"","installed_at":0}"#).unwrap();
  assert_eq!(installed_runtime(&root,&root.join("inst")),root.join("inst/.vis/runtime"));
  let instance=Instance{version:"1.20.1".into(),..Default::default()};
  assert!(!installed(&root.join("inst"),&instance));
  let _=fs::remove_dir_all(root);
 }
 #[test]fn staged_batch_preserves_prior_files_on_bad_source(){
  let root=std::env::temp_dir().join(format!("vis211-stage-{}-{}",std::process::id(),DOWNLOAD_NONCE.fetch_add(1,Ordering::Relaxed)));
  let dest=root.join("mods");let stage=root.join("stage");fs::create_dir_all(&dest).unwrap();fs::create_dir_all(&stage).unwrap();
  fs::write(dest.join("a.jar"),b"old").unwrap();fs::write(stage.join("a.jar"),b"new").unwrap();
  assert!(promote_mod_batch(&dest,&stage,&["a.jar".into(),"missing.jar".into()]).is_err());
  assert_eq!(fs::read(dest.join("a.jar")).unwrap(),b"old");
  let _=fs::remove_dir_all(root);
 }

}
