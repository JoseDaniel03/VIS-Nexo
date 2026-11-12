//! VIS Worlds Horizon adapter. Executes the GAME client and preparer only,
//! never Horizon's separate launcher. Launch API 0.1 is experimental.
//! A selected build is untrusted native code: VIS requires an explicit directory.
use crate::{accounts::Instance, minecraft::{LaunchExit,LaunchResult,Progress}};
use serde::{Deserialize,Serialize};
use serde_json::Value;
use std::{env,fs::{self,File},io::{BufRead,BufReader,Read,Write},path::{Path,PathBuf},process::{Command,Stdio},sync::OnceLock,thread,time::{Duration,Instant}};
use sha2::{Digest, Sha256};
use tauri::{AppHandle,Emitter,Manager};

#[derive(Clone,Serialize)]
pub struct Probe {pub build:String,pub minecraft:String,pub api:String,pub java_major:u64,pub resources_ready:bool}
#[derive(Serialize,Deserialize)]
struct Installed {
    build:String,minecraft:String,build_dir:String,
    // Added in 2.14; old v2.13 manifests continue loading without deleting worlds.
    #[serde(default)] lock_sha256:String,
    #[serde(default)] launch_api:String,
    #[serde(default)] prepare_schema:u64,
    #[serde(default)] output_version:u64,
}
#[derive(Clone,Serialize)]
pub struct HorizonCheck {pub label:String,pub status:String,pub detail:String}
fn check(label:&str,status:&str,detail:impl Into<String>)->HorizonCheck{
    HorizonCheck{label:label.into(),status:status.into(),detail:detail.into()}
}
fn lock_hash(folder:&Path)->Result<String,String>{
    let mut f=File::open(folder.join("research-lock.json")).map_err(|e|e.to_string())?;
    let mut hash=Sha256::new();let mut buf=[0u8;65536];
    loop{let count=f.read(&mut buf).map_err(|e|e.to_string())?;if count==0{break}hash.update(&buf[..count]);}
    Ok(format!("{:x}",hash.finalize()))
}
fn supports(value:&Value, option:&str)->bool{
    value["options"].as_array().is_some_and(|options|
        options.iter().any(|item|item["name"].as_str()==Some(option)))
}
fn require_options(value:&Value,options:&[&str],exe:&str)->Result<(),String>{
    for option in options{
        if !supports(value,option){return Err(format!("{exe} no admite {option}. Elegí un build compatible de Horizon"));}
    }
    Ok(())
}
fn compatible(client:&Value,preparer:&Value,ins:&Instance)->Result<(),String>{
    if client["launch_api"]!=preparer["launch_api"] {return Err("Cliente y preparador tienen distintas versiones de Launch API".into());}
    if client["minecraft"]!=preparer["minecraft"] || client["minecraft"].as_str()!=Some(ins.version.as_str()){
        return Err(format!("Este build no corresponde a Minecraft {}",ins.version));
    }
    if client["horizon"]!=preparer["horizon"]{return Err("Cliente y preparador provienen de builds diferentes".into());}
    require_options(client,&["--resources","--game-dir","--home","--session-stdin"],"horizon-client")?;
    require_options(preparer,&["--prepare","--output","--complete","--progress","--check","--minecraft-dir","--server-jar"],"horizon-prepare")?;
    Ok(())
}

fn executable(folder:&Path,stem:&str)->PathBuf {
    folder.join(if cfg!(target_os="windows"){format!("{stem}.exe")}else{stem.to_owned()})
}
/// Source-compiled game is included in the VIS application resources at packaging.
/// This ID survives launcher updates without hard-coding a platform-specific path.
pub const SOURCE_BUILD_ID:&str="vis:source";
static BUNDLED_SOURCE:OnceLock<PathBuf>=OnceLock::new();

pub fn initialize_bundled_source(app:&AppHandle){
    let from_bundle=app.path().resource_dir().ok().map(|p|p.join("horizon"));
    // In tauri dev, Tauri may expose its resource directory under target/debug;
    // beforeDevCommand builds into this directory in the source tree.
    let from_development=Path::new(env!("CARGO_MANIFEST_DIR")).join("resources").join("horizon");
    let resolved=from_bundle.filter(|p|source_build_complete(p))
        .or_else(||if cfg!(debug_assertions)&&source_build_complete(&from_development){Some(from_development)}else{None});
    if let Some(folder)=resolved{let _=BUNDLED_SOURCE.set(folder);}
}

fn source_build_complete(folder:&Path)->bool{
    executable(folder,"horizon-client").is_file() &&
    executable(folder,"horizon-prepare").is_file() &&
    folder.join("research-lock.json").is_file() &&
    folder.join("vis-horizon-source.json").is_file()
}

pub fn bundled_source_path()->Result<String,String>{
    let folder=BUNDLED_SOURCE.get().ok_or("No se incluyó Horizon desde el repositorio. Compilá VIS con npm run build o npm run tauri dev")?;
    verify_source_build(folder)?;
    Ok(folder.to_string_lossy().to_string())
}

fn verify_source_build(folder:&Path)->Result<(),String>{
    let manifest=fs::read(folder.join("vis-horizon-source.json"))
        .map_err(|e|format!("Sin manifiesto de Horizon compilado: {e}"))?;
    let value:Value=serde_json::from_slice(&manifest).map_err(|e|format!("Manifiesto Horizon inválido: {e}"))?;
    if value["source_repo"].as_str()!=Some("https://github.com/horizon-rust/horizon.git"){
        return Err("El cliente incluido no proviene del repositorio de Horizon configurado".into())
    }
    for stem in ["horizon-client","horizon-prepare"]{
        let name=if cfg!(windows){format!("{stem}.exe")}else{stem.into()};
        let expected=value["sha256"][name.as_str()].as_str().ok_or("Manifiesto sin huella SHA-256 del ejecutable")?;
        if !expected.eq_ignore_ascii_case(&hash_file_sha256(&folder.join(&name))?){
            return Err(format!("El ejecutable de Horizon {name} cambió desde la compilación de VIS"));
        }
    }
    let expected=value["sha256"]["research-lock.json"].as_str().ok_or("Manifiesto sin research-lock")?;
    if !expected.eq_ignore_ascii_case(&hash_file_sha256(&folder.join("research-lock.json"))?){
        return Err("research-lock.json del juego Horizon se modificó".into())
    }
    Ok(())
}

fn hash_file_sha256(path:&Path)->Result<String,String>{
    let mut file=File::open(path).map_err(|e|e.to_string())?;
    let mut hasher=Sha256::new();let mut block=[0u8;65536];
    loop{let count=file.read(&mut block).map_err(|e|e.to_string())?;if count==0{break}hasher.update(&block[..count]);}
    Ok(format!("{:x}",hasher.finalize()))
}

fn build_folder(ins:&Instance)->Result<PathBuf,String>{
    if ins.horizon_build_dir.is_empty() || ins.horizon_build_dir==SOURCE_BUILD_ID {
        let path=BUNDLED_SOURCE.get().ok_or("El juego Horizon no está compilado dentro de VIS Nexo. Volvé a generar el launcher con Horizon Source")?;
        verify_source_build(path)?;
        return Ok(path.clone());
    }
    // Existing v2.13-v2.17 instances may retain the old external path. Never
    // overwrite their worlds or silently substitute a different executable.
    let path=Path::new(&ins.horizon_build_dir);
    if !path.is_absolute(){return Err("Elegí una carpeta absoluta con horizon-client y horizon-prepare".into())}
    let folder=fs::canonicalize(path).map_err(|e|format!("No se encontró el build de Horizon: {e}"))?;
    if !folder.is_dir()||!executable(&folder,"horizon-client").is_file()
        ||!executable(&folder,"horizon-prepare").is_file()
        ||!folder.join("research-lock.json").is_file(){
        return Err("El build debe contener horizon-client, horizon-prepare y research-lock.json juntos".into());
    }
    crate::horizon_download::verify_managed_build(&folder)?;
    if folder.join("vis-horizon-source.json").is_file(){verify_source_build(&folder)?;}
    Ok(folder)
}
fn api(folder:&Path,exe:&str)->Result<Value,String>{
    // A broken, replaced or incompatible game binary must never freeze the UI
    // or cause unlimited allocation while answering the experimental Launch API.
    let mut child=Command::new(executable(folder,exe)).current_dir(folder).arg("--launch-api")
        .stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()
        .map_err(|e|format!("{exe} no pudo iniciarse: {e}"))?;
    let deadline=Instant::now()+Duration::from_secs(12);
    let status=loop {
        match child.try_wait(){
            Ok(Some(status))=>break status,
            Ok(None)=>{},
            Err(error)=>{let _=child.kill();let _=child.wait();return Err(format!("{exe} falló: {error}"))}
        }
        if Instant::now()>=deadline{
            let _=child.kill();let _=child.wait();
            return Err(format!("{exe} excedió 12 segundos al responder --launch-api"));
        }
        thread::sleep(Duration::from_millis(75));
    };
    let mut output=Vec::new();
    if let Some(stdout)=child.stdout.take(){
        stdout.take(1024*1024+1).read_to_end(&mut output).map_err(|e|e.to_string())?;
    }
    let mut error=Vec::new();
    if let Some(stderr)=child.stderr.take(){
        stderr.take(4096).read_to_end(&mut error).map_err(|e|e.to_string())?;
    }
    if !status.success(){return Err(format!("{exe} no reconoce la Launch API: {}",String::from_utf8_lossy(&error).chars().take(400).collect::<String>()))}
    if output.len()>1024*1024{return Err("Respuesta de Horizon demasiado grande".into())}
    let value:Value=serde_json::from_slice(&output).map_err(|e|format!("Launch API inválida: {e}"))?;
    if !value["launch_api"].as_str().is_some_and(|s|s.starts_with("0.1.")){
        return Err("VIS admite por ahora Horizon Launch API 0.1.x; actualizá el adaptador".into())
    }
    Ok(value)
}
fn resources(dir:&Path)->PathBuf{dir.join(".vis").join("horizon-resources")}
fn marker(dir:&Path)->PathBuf{dir.join(".vis").join("horizon.json")}
/// The Horizon game must not depend on an existing .minecraft elsewhere.
/// Cheap structural validation is performed on every "installed" check; the
/// checksummed Minecraft downloader handles full repair on demand.
pub(crate) fn private_mojang_ready(dir:&Path,ins:&Instance)->bool{
    let base=dir.join(".vis/minecraft-base");
    let runtime=base.join(".vis/runtime");
    let mc=Path::new(&ins.horizon_minecraft_dir);
    let server=Path::new(&ins.horizon_server_jar);
    let jdk=Path::new(&ins.java_path);
    if mc!=base || server!=base.join(".vis/minecraft-server.jar") ||
       !jdk.starts_with(base.join(".vis/java-runtimes/temurin-25")) {
        return false;
    }
    // Symlinks cannot redirect the apparent local game root to an external
    // installation. Compare canonical paths only after verifying existence.
    let Ok(actual_base)=fs::canonicalize(&base) else{return false};
    let Ok(actual_dir)=fs::canonicalize(dir) else{return false};
    if !actual_base.starts_with(&actual_dir){return false}
    let jar=runtime.join("versions").join(&ins.version).join(format!("{}.jar",ins.version));
    if !jar.is_file() || !server.is_file() || !runtime.join("libraries").is_dir() {
        return false
    }
    let Ok(raw)=fs::read(base.join(".vslauncher/version.json")) else{return false};
    let Ok(profile)=serde_json::from_slice::<Value>(&raw) else{return false};
    let Some(index)=profile["assetIndex"]["id"].as_str() else{return false};
    if index.is_empty() || index.len()>100 ||
       !index.bytes().all(|b|b.is_ascii_alphanumeric()||b"._-".contains(&b)) {
        return false
    }
    if !runtime.join("assets/indexes").join(format!("{index}.json")).is_file() {
        return false
    }
    let java=jdk.join("bin").join(if cfg!(target_os="windows"){"java.exe"}else{"java"});
    let javac=jdk.join("bin").join(if cfg!(target_os="windows"){"javac.exe"}else{"javac"});
    java.is_file()&&javac.is_file()
}
fn valid_marker(dir:&Path,ins:&Instance)->bool{
    if !private_mojang_ready(dir,ins){return false}

    let Ok(bytes)=fs::read(marker(dir)) else{return false};
    let Ok(record)=serde_json::from_slice::<Installed>(&bytes) else{return false};
    if record.build_dir!=ins.horizon_build_dir||record.minecraft!=ins.version||!resources(dir).is_dir(){return false}
    // A different research-lock.json needs a fresh preparation. v2.13
    // manifests lacked this field; inspect() still runs Horizon --check.
    if !record.lock_sha256.is_empty() && build_folder(ins).ok().and_then(|folder|lock_hash(&folder).ok()).as_deref()!=Some(record.lock_sha256.as_str()){
        return false
    }
    true
}
pub fn installed(dir:&Path,ins:&Instance)->bool{valid_marker(dir,ins)}
fn probe_apis(folder:&Path,ins:&Instance)->Result<(Value,Value),String>{
    let client=api(folder,"horizon-client")?;
    let preparer=api(folder,"horizon-prepare")?;
    compatible(&client,&preparer,ins)?;
    Ok((client,preparer))
}
pub fn inspect(dir:&Path,ins:&Instance)->Result<Probe,String>{
    let folder=build_folder(ins)?;
    let (client,preparer)=probe_apis(&folder,ins)?;
    let version=preparer["minecraft"].as_str().ok_or("Preparer sin versión Minecraft")?;
    let java=preparer["java_major"].as_u64().ok_or("Preparer no informa Java requerida")?;
    let ready=if valid_marker(dir,ins){
        // --check validates Horizon's own preparation stamp; a marker alone
        // never means the game is safe to launch.
        let output=Command::new(executable(&folder,"horizon-prepare"))
            .current_dir(&folder).arg("--check").arg("--output").arg(resources(dir)).output()
            .map_err(|e|format!("No se pudo verificar recursos: {e}"))?;
        let record=fs::read(marker(dir)).ok().and_then(|bytes|serde_json::from_slice::<Installed>(&bytes).ok());
        output.status.success() && record.as_ref().is_some_and(|r|
            r.build==client["horizon"].as_str().unwrap_or("") &&
            (r.launch_api.is_empty() || r.launch_api==client["launch_api"].as_str().unwrap_or("")) &&
            (r.output_version==0 || Some(r.output_version)==preparer["output_version"].as_u64()) &&
            (r.prepare_schema==0 || Some(r.prepare_schema)==preparer["schema"].as_u64()))
    }else{false};
    Ok(Probe{build:client["horizon"].as_str().unwrap_or("nightly").into(),minecraft:version.into(),
        api:client["launch_api"].as_str().unwrap_or("0.1.0").into(),java_major:java,resources_ready:ready})
}

/// Read-only preflight. Never reads Microsoft session tokens or changes a world.
pub fn diagnostics(dir:&Path,ins:&Instance)->Vec<HorizonCheck>{
    let mut results=Vec::new();
    let folder=match build_folder(ins){
        Ok(folder)=>{results.push(check("Build del juego","ok",folder.display().to_string()));folder},
        Err(err)=>{results.push(check("Build del juego","missing",err));return results;}
    };
    let prep=match probe_apis(&folder,ins){
        Ok((client,prep))=>{
            results.push(check("Launch API","ok",format!("Horizon {} · API {} · Minecraft {}",
                client["horizon"].as_str().unwrap_or("?"),client["launch_api"].as_str().unwrap_or("?"),ins.version)));
            prep
        },
        Err(err)=>{results.push(check("Launch API","missing",err));return results;}
    };
    let mc=Path::new(&ins.horizon_minecraft_dir);
    // VIS installs the verified Mojang base in .vis/runtime, never in the
    // global .minecraft directory. Legacy imports keep the old fallback.
    let runtime=mc.join(".vis/runtime");
    let (version,clientjar,assets)=if runtime.is_dir() {
        (mc.join(".vslauncher/version.json"),
         runtime.join("versions").join(&ins.version).join(format!("{}.jar",ins.version)),
         runtime.join("assets/indexes"))
    } else {
        (mc.join("versions").join(&ins.version).join(format!("{}.json",ins.version)),
         mc.join("versions").join(&ins.version).join(format!("{}.jar",ins.version)),
         mc.join("assets/indexes"))
    };
    let is_mc=mc.is_absolute() && version.is_file() && clientjar.is_file() && assets.is_dir();
    results.push(check("Minecraft Java del propietario",if is_mc{"ok"}else{"missing"},
        if is_mc{"Metadatos, JAR y assets encontrados".into()}else{format!("Falta Minecraft {} completo en {}",ins.version,mc.display())}));
    let jar=Path::new(&ins.horizon_server_jar);
    results.push(check("JAR del servidor oficial",if jar.is_absolute()&&jar.is_file(){"ok"}else{"missing"},
        if jar.is_file(){"Archivo presente (Horizon comprobará sus hashes)"}else{"Elegí el server.jar oficial fijado por research-lock.json"}));
    let java=prep["java_major"].as_u64().unwrap_or(25);
    if ins.java_path.is_empty(){
        results.push(check("Java para preparar","manual",format!("Horizon requiere JDK {java}. Se buscará JAVA_HOME/PATH o runtime oficial")));
    } else {
        let home=Path::new(&ins.java_path);
        let path=home.join("bin").join(if cfg!(target_os="windows"){"java.exe"}else{"java"});
        results.push(check("Java para preparar",if path.is_file(){"ok"}else{"missing"},
            if path.is_file(){format!("JDK configurado en {} (versión sin verificar)",home.display())}else{format!("No existe {}",path.display())}));
    }
    let ready=inspect(dir,ins).is_ok_and(|p|p.resources_ready);
    results.push(check("Recursos preparados",if ready{"ok"}else{"missing"},
        if ready{"Horizon --check aprobó el estado"}else{"Presioná Instalar/Reparar para preparar y verificar los recursos"}));
    results.push(check("Microsoft", "manual", "Requiere cuenta propietaria de Minecraft Java. El inicio de sesión en Ceibo aún está pendiente"));
    results
}

/// Find existing official game builds; no traversal of the user's disk.
/// User picks the build; VIS does not download or run an unsigned archive.
pub fn find_local_builds()->Vec<String>{
    let mut roots=Vec::new();
    if let Some(home)=env::var_os("HOME"){
        let home=PathBuf::from(home);
        roots.push(home.join(".local/share/horizon/releases"));
    }
    if let Some(local)=env::var_os("LOCALAPPDATA"){
        let root=PathBuf::from(local).join("Horizon");
        roots.push(root.join("releases"));
    }
    let mut found=Vec::new();
    for root in roots{
        if !root.is_dir(){continue}
        if let Ok(entries)=fs::read_dir(root){
            for entry in entries.take(60).flatten(){
                let path=entry.path();
                if entry.file_type().is_ok_and(|kind|kind.is_dir() && !kind.is_symlink())
                    && executable(&path,"horizon-client").is_file()
                    && executable(&path,"horizon-prepare").is_file()
                    && path.join("research-lock.json").is_file(){
                    found.push(path.to_string_lossy().into_owned());
                }
            }
        }
    }
    found.sort();found.dedup();found.reverse();found.truncate(20);found
}

pub(crate) fn copy_preparation_sources(source:&Path,target:&Path)->Result<(),String>{
    fs::create_dir_all(target).map_err(|e|e.to_string())?;
    for entry in fs::read_dir(source).map_err(|e|e.to_string())?{
        let entry=entry.map_err(|e|e.to_string())?;
        let kind=entry.file_type().map_err(|e|e.to_string())?;
        if kind.is_symlink(){return Err("Enlace inesperado en los exportadores de Horizon".into())}
        let dest=target.join(entry.file_name());
        if kind.is_dir(){copy_preparation_sources(&entry.path(),&dest)?;}
        else if kind.is_file(){fs::copy(entry.path(),dest).map_err(|e|e.to_string())?;}
    }
    Ok(())
}

/// Each new source-built game is owned by its instance, not AppData or VIS.
pub fn install_instance_engine(dir:&Path,ins:&Instance)->Result<String,String>{
    let source=build_folder(ins)?;
    if !source.join("vis-horizon-source.json").is_file(){
        return Err("Para una instalación independiente, elegí el motor incluido en VIS".into());
    }
    verify_source_build(&source)?;
    let id=hash_file_sha256(&source.join("vis-horizon-source.json"))?;
    let target=dir.join(".vis/horizon-engine").join(id);
    if !target.exists(){
        let stage=target.with_extension(format!("stage-{}",std::process::id()));
        fs::create_dir_all(&stage).map_err(|e|e.to_string())?;
        for name in ["research-lock.json","vis-horizon-source.json","LICENSE","THIRD_PARTY_NOTICES.md"]{
            if source.join(name).is_file(){fs::copy(source.join(name),stage.join(name)).map_err(|e|e.to_string())?;}
        }
        for stem in ["horizon-client","horizon-prepare"]{
            fs::copy(executable(&source,stem),executable(&stage,stem)).map_err(|e|e.to_string())?;
        }
        copy_preparation_sources(&source.join("mods"),&stage.join("mods"))?;
        verify_source_build(&stage)?;
        fs::rename(stage,&target).map_err(|e|e.to_string())?;
    }
    verify_source_build(&target)?;
    Ok(target.to_string_lossy().into_owned())
}

fn find_local_jdk(dir:&Path,depth:usize)->Option<PathBuf>{
    if dir.join("bin").join(if cfg!(target_os="windows"){"java.exe"}else{"java"}).is_file() &&
       dir.join("bin").join(if cfg!(target_os="windows"){"javac.exe"}else{"javac"}).is_file() {
        return Some(dir.to_owned());
    }
    if depth==0{return None;}
    for entry in fs::read_dir(dir).ok()?.take(20).flatten(){
        if entry.file_type().ok().is_some_and(|t|t.is_dir()&&!t.is_symlink()){
            if let Some(home)=find_local_jdk(&entry.path(),depth-1){return Some(home);}
        }
    }
    None
}
/// A portable VIS Worlds ZIP contains every Horizon binary, JDK and Mojang
/// asset but its old absolute paths cannot be reused on a different computer.
/// Relocate only to verified resources under the *imported instance*.
pub fn relocate_imported(dir:&Path,ins:&mut Instance)->Result<(),String>{
    if ins.engine!="horizon"{return Ok(());}
    let root=dir.join(".vis/horizon-engine");
    let old:Installed=serde_json::from_slice(
        &fs::read(marker(dir)).map_err(|_|"Falta el manifiesto Horizon de la instancia")?
    ).map_err(|_|"Manifiesto Horizon inválido")?;
    if old.minecraft!=ins.version || old.lock_sha256.len()!=64 {
        return Err("No coincide el manifiesto Horizon de la instancia".into());
    }
    let mut matches=Vec::new();
    for entry in fs::read_dir(root).map_err(|e|e.to_string())?.take(16).flatten(){
        if !entry.file_type().ok().is_some_and(|t|t.is_dir()&&!t.is_symlink()){continue;}
        let candidate=entry.path();
        if verify_source_build(&candidate).is_ok() &&
           lock_hash(&candidate).ok().as_deref()==Some(old.lock_sha256.as_str()){
            matches.push(candidate);
        }
    }
    if matches.len()!=1{return Err("No se encontró un motor Horizon único y verificado dentro de la instancia".into());}
    let base=dir.join(".vis/minecraft-base");
    let client=base.join(".vis/runtime/versions").join(&ins.version)
        .join(format!("{}.jar",ins.version));
    let assets=base.join(".vis/runtime/assets/indexes");
    let version=base.join(".vslauncher/version.json");
    let jar=base.join(".vis/minecraft-server.jar");
    let jdk=find_local_jdk(&base.join(".vis/java-runtimes/temurin-25"),4)
        .ok_or("Falta JDK 25 dentro de la instancia portable; ejecutá Reparar")?;
    if !client.is_file() || !assets.is_dir() || !version.is_file() || !jar.is_file(){
        return Err("Falta la base Mojang dentro de esta instancia portable; ejecutá Reparar".into());
    }
    let engine=matches.remove(0);
    let mut updated=old;
    updated.build_dir=engine.to_string_lossy().into_owned();
    // Update only VIS metadata. No world, config, log or player file is touched.
    crate::accounts::atomic_json(&marker(dir),&updated)?;
    ins.horizon_build_dir=updated.build_dir;
    ins.horizon_minecraft_dir=base.to_string_lossy().into_owned();
    ins.horizon_server_jar=jar.to_string_lossy().into_owned();
    ins.java_path=jdk.to_string_lossy().into_owned();
    ins.installed=valid_marker(dir,ins);
    Ok(())
}

pub fn prepare(app:&AppHandle,dir:&Path,ins:&Instance)->Result<Probe,String>{
    let folder=build_folder(ins)?;
    // Verify both executables agree before running the expensive preparer.
    let (_,prep)=probe_apis(&folder,ins)?;
    let mc=Path::new(&ins.horizon_minecraft_dir);
    let jar=Path::new(&ins.horizon_server_jar);
    if !mc.is_absolute()||!mc.is_dir(){return Err("Elegí la carpeta del Minecraft Java que poseés".into())}
    if !jar.is_absolute()||!jar.is_file(){return Err("Elegí el server.jar oficial de la misma versión de Minecraft".into())}
    fs::create_dir_all(resources(dir)).map_err(|e|e.to_string())?;
    // The installed application can be read-only. Keep imported Mojang files and
    // exporter caches inside the instance, never in the packaged game resources.
    let preparation=dir.join(".vis/horizon-preparation");
    fs::create_dir_all(&preparation).map_err(|e|e.to_string())?;
    fs::copy(folder.join("research-lock.json"),preparation.join("research-lock.json")).map_err(|e|e.to_string())?;
    let parity=Path::new("mods/horizon/src/test/java/dev/horizonlab/parity");
    copy_preparation_sources(&folder.join(parity),&preparation.join(parity))?;
    let mut cmd=Command::new(executable(&folder,"horizon-prepare"));
    crate::minecraft::configure_instance_environment(&mut cmd,dir)?;
    cmd.current_dir(&preparation).arg("--root").arg(&preparation).args(["--prepare","--server-jar"]).arg(jar);
    // VIS's managed Minecraft has its runtime nested inside each instance.
    // Horizon accepts explicit verified version, library and asset paths.
    let runtime=mc.join(".vis").join("runtime");
    if runtime.is_dir(){
        require_options(&prep,&["--version-json","--client-jar","--libraries-dir","--assets-dir"],"horizon-prepare")?;
        cmd.arg("--version-json").arg(mc.join(".vslauncher/version.json"))
            .arg("--client-jar").arg(runtime.join("versions").join(&ins.version).join(format!("{}.jar",ins.version)))
            .arg("--libraries-dir").arg(runtime.join("libraries"))
            .arg("--assets-dir").arg(runtime.join("assets"));
    }else{cmd.arg("--minecraft-dir").arg(mc);}
    cmd.arg("--output").arg(resources(dir)).args(["--complete","--progress","json"]);
    // Optional JDK 25 path selected by the user, not the Java runtime in-game.
    if !ins.java_path.is_empty(){
        let home=Path::new(&ins.java_path);
        if !home.is_absolute()||!home.is_dir(){return Err("Para Horizon, Ruta Java debe ser el directorio JDK 25".into())}
        cmd.arg("--java-home").arg(home);
    }
    let log_path=dir.join(".vis").join("horizon-prepare.log");
    let log=File::create(&log_path).map_err(|e|e.to_string())?;
    let mut child=cmd.stdout(Stdio::piped()).stderr(Stdio::from(log)).spawn()
        .map_err(|e|format!("No se pudo iniciar horizon-prepare: {e}"))?;
    let mut completed=0usize;
    let mut last_error=String::new();
    let mut read_error=None;
    if let Some(stdout)=child.stdout.take(){
        for line in BufReader::new(stdout).lines(){
            match line{
                Ok(line)=>{
                    // Never allow an arbitrary message to reset a known percentage.
                    if let Ok(v)=serde_json::from_str::<Value>(&line){
                        if let Some(pct)=v["fraction"].as_f64().filter(|n|n.is_finite()){
                            completed=completed.max((pct.clamp(0.0,1.0)*100.0) as usize);
                        }
                        if let Some(error)=v["error"].as_str(){last_error=error.chars().take(240).collect();}
                        let detail=v["message"].as_str().or_else(||v["error"].as_str())
                            .unwrap_or("Preparando recursos Horizon").chars().take(180).collect();
                        let _=app.emit("minecraft-progress",Progress{stage:"Horizon Rust Edition".into(),completed,total:100,detail});
                    }
                },
                Err(error)=>{read_error=Some(error.to_string());break;}
            }
        }
    }
    if read_error.is_some(){let _=child.kill();}
    let status=child.wait().map_err(|e|e.to_string())?;
    if let Some(error)=read_error{return Err(format!("No se pudo leer progreso Horizon: {error}"));}
    if !status.success(){return Err(format!("Horizon no pudo preparar recursos: {last_error}. Log: {}",log_path.display()))}
    let verify=Command::new(executable(&folder,"horizon-prepare"))
        .current_dir(&folder).arg("--check").arg("--output").arg(resources(dir)).status()
        .map_err(|e|e.to_string())?;
    if !verify.success(){return Err("Horizon no verificó sus recursos preparados".into())}
    let record=Installed{build:prep["horizon"].as_str().unwrap_or("unknown").into(),minecraft:ins.version.clone(),
        build_dir:ins.horizon_build_dir.clone(),lock_sha256:lock_hash(&folder)?,
        launch_api:prep["launch_api"].as_str().unwrap_or("").into(),
        prepare_schema:prep["schema"].as_u64().unwrap_or(0),output_version:prep["output_version"].as_u64().unwrap_or(0)};
    let bytes=serde_json::to_vec_pretty(&record).map_err(|e|e.to_string())?;
    let dest=marker(dir);let temp=dir.join(".vis").join("horizon.json.tmp");
    fs::write(&temp,bytes).map_err(|e|e.to_string())?;
    fs::rename(temp,dest).map_err(|e|e.to_string())?;
    inspect(dir,ins)
}

struct SensitiveBytes(Vec<u8>);
impl Drop for SensitiveBytes {
    fn drop(&mut self){self.0.fill(0);}
}

/// The account session is supplied by the owner as a temporary JSON file.
/// It is never kept in VIS profiles, arguments or logs. Horizon reads it once
/// from stdin. Production OAuth is still pending in Ceibo.
pub fn launch(app:&AppHandle,dir:&Path,ins:&Instance,session_file:&str)->Result<LaunchResult,String>{
    launch_in_directory(app,dir,ins,session_file,dir)
}
/// Share the Horizon game build/resources, never Microsoft credentials or worlds.
pub fn launch_shared(app:&AppHandle,dir:&Path,ins:&Instance,session_file:&str,visitor_dir:&Path)->Result<LaunchResult,String>{
    launch_in_directory(app,dir,ins,session_file,visitor_dir)
}
fn launch_in_directory(app:&AppHandle,dir:&Path,ins:&Instance,session_file:&str,game_dir:&Path)->Result<LaunchResult,String>{
    let probe=inspect(dir,ins)?;
    if !probe.resources_ready{return Err("Prepará y verificá los recursos de Horizon antes de jugar".into())}
    if session_file.is_empty(){
        fs::create_dir_all(game_dir.join(".vis")).map_err(|e|e.to_string())?;
        let folder=build_folder(ins)?;
        let log_path=game_dir.join(".vis/horizon-launch.log");
        let log=File::create(&log_path).map_err(|e|e.to_string())?;
        let mut cmd=Command::new(executable(&folder,"horizon-client"));
        crate::minecraft::configure_instance_environment(&mut cmd,game_dir)?;
        cmd.current_dir(game_dir).arg("--resources").arg(resources(dir))
            .arg("--game-dir").arg(game_dir).arg("--home").arg(game_dir);
        if !ins.player_name.is_empty(){cmd.arg("--name").arg(&ins.player_name);}
        if ins.fullscreen{cmd.arg("--fullscreen");}
        let mut child=cmd.stdin(Stdio::null()).stdout(log.try_clone().map_err(|e|e.to_string())?)
            .stderr(log).spawn().map_err(|e|format!("Horizon no pudo iniciar: {e}"))?;
        let pid=child.id();let log_file=log_path.to_string_lossy().into_owned();
        let emitter=app.clone();let exit_log=log_file.clone();
        thread::spawn(move||{
            let event=match child.wait(){
                Ok(status)=>LaunchExit{pid,success:status.success(),exit_code:status.code(),log_file:exit_log,error:String::new()},
                Err(error)=>LaunchExit{pid,success:false,exit_code:None,log_file:exit_log,error:error.to_string()}
            };
            if let Some(window)=emitter.get_webview_window("main"){let _=window.unminimize();}
            let _=emitter.emit("minecraft-process-exited",event);
        });
        return Ok(LaunchResult{pid,log_file,offline:true});
    }
    let path=Path::new(session_file);
    if !path.is_absolute(){return Err("Seleccioná una sesión temporal Microsoft válida".into())}
    let metadata=fs::symlink_metadata(path).map_err(|e|e.to_string())?;
    if !metadata.is_file()||metadata.file_type().is_symlink()||metadata.len()>16*1024{
        return Err("El archivo de sesión no es un JSON normal de hasta 16 KiB".into())
    }
    #[cfg(unix)] {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode()&0o077 != 0 {return Err("Protegé el archivo de sesión con chmod 600 antes de usarlo".into())}
    }
    // Protect the raw token buffer on every exit path, including invalid JSON
    // and failures while starting or writing to the game process.
    let mut secret=SensitiveBytes(Vec::new());
    File::open(path).map_err(|e|e.to_string())?.take(16*1024).read_to_end(&mut secret.0).map_err(|e|e.to_string())?;
    let session:Value=serde_json::from_slice(&secret.0).map_err(|_|"Sesión Microsoft JSON inválida")?;
    if !session["name"].as_str().is_some_and(|s|!s.is_empty()) ||
       !session["uuid"].as_str().is_some_and(|s|!s.is_empty()) ||
       !session["access_token"].as_str().is_some_and(|s|!s.is_empty()) ||
       session["user_type"].as_str().is_some_and(|s|s!="msa") {
        return Err("La sesión debe incluir name, uuid y access_token de Microsoft".into())
    }
    // The user is responsible for supplying a temporary session for their own
    // licensed account. We do not delete the file if process creation fails.
    drop(session);
    let folder=build_folder(ins)?;
    fs::create_dir_all(game_dir.join(".vis")).map_err(|e|e.to_string())?;
    let log_path=game_dir.join(".vis").join("horizon-launch.log");
    let log=File::create(&log_path).map_err(|e|e.to_string())?;
    let mut cmd=Command::new(executable(&folder,"horizon-client"));
    crate::minecraft::configure_instance_environment(&mut cmd,game_dir)?;
    cmd.current_dir(&folder).arg("--resources").arg(resources(dir))
        .arg("--game-dir").arg(game_dir).arg("--home").arg(game_dir).arg("--session-stdin");
    if ins.fullscreen{cmd.arg("--fullscreen");}
    let mut child=cmd.stdin(Stdio::piped()).stdout(Stdio::from(log.try_clone().map_err(|e|e.to_string())?))
        .stderr(Stdio::from(log)).spawn().map_err(|e|format!("Horizon no pudo iniciar: {e}"))?;
    if let Some(mut stdin)=child.stdin.take(){
        if let Err(err)=stdin.write_all(&secret.0){
            secret.0.fill(0);
            let _=child.kill();let _=child.wait();
            return Err(format!("Sesión Horizon no se pudo entregar: {err}"));
        }
    }
    secret.0.fill(0);
    let _=fs::remove_file(path); // single-use session, after successful delivery
    let pid=child.id();let log_file=log_path.to_string_lossy().to_string();
    let emitter=app.clone();let exit_log=log_file.clone();
    std::thread::spawn(move||{
        let event=match child.wait(){
            Ok(status)=>LaunchExit{pid,success:status.success(),exit_code:status.code(),log_file:exit_log,error:String::new()},
            Err(error)=>LaunchExit{pid,success:false,exit_code:None,log_file:exit_log,error:error.to_string()}
        };
        if let Some(window)=emitter.get_webview_window("main"){let _=window.unminimize();}
        let _=emitter.emit("minecraft-process-exited",event);
    });
    Ok(LaunchResult{pid,log_file,offline:false})
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::time::{SystemTime,UNIX_EPOCH};
    #[test]
    fn instance_engine_is_copied_and_verified_locally(){
        let root=std::env::temp_dir().join(format!("vis-engine-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        let source=root.join("source");fs::create_dir_all(source.join("mods")).unwrap();
        let mut hashes=serde_json::Map::new();
        for name in [executable(&source,"horizon-client"),executable(&source,"horizon-prepare"),source.join("research-lock.json")]{
            fs::write(&name,b"test fixture").unwrap();
            hashes.insert(name.file_name().unwrap().to_string_lossy().into_owned(),json!(hash_file_sha256(&name).unwrap()));
        }
        fs::write(source.join("vis-horizon-source.json"),serde_json::to_vec(&json!({"source_repo":"https://github.com/horizon-rust/horizon.git","sha256":hashes})).unwrap()).unwrap();
        let instance=Instance{horizon_build_dir:source.to_string_lossy().into_owned(),..Default::default()};
        let dir=root.join("instance");
        let installed=PathBuf::from(install_instance_engine(&dir,&instance).unwrap());
        assert!(installed.starts_with(dir.join(".vis/horizon-engine")));
        assert_ne!(installed,source);
        assert_eq!(install_instance_engine(&dir,&instance).unwrap(),installed.to_string_lossy());
        fs::write(executable(&installed,"horizon-client"),b"modified").unwrap();
        assert!(install_instance_engine(&dir,&instance).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn cli_capabilities_are_checked_before_launch() {
        let client=json!({"options":[{"name":"--resources"},{"name":"--game-dir"}]});
        assert!(require_options(&client,&["--resources","--game-dir"],"client").is_ok());
        assert!(require_options(&client,&["--session-stdin"],"client").is_err());
    }
    #[test]
    fn old_install_markers_deserialize_without_new_hash_fields() {
        let old=r#"{"build":"nightly-test","minecraft":"26.3","build_dir":"/tmp/horizon"}"#;
        let saved:Installed=serde_json::from_str(old).unwrap();
        assert_eq!(saved.minecraft,"26.3");
        assert!(saved.lock_sha256.is_empty());
        assert_eq!(saved.output_version,0);
    }
    #[test]
    fn mismatched_client_and_preparer_are_rejected() {
        let options=|names:&[&str]|names.iter().map(|x|json!({"name":x})).collect::<Vec<Value>>();
        let client=json!({"launch_api":"0.1.0","horizon":"nightly-A","minecraft":"26.3",
            "options":options(&["--resources","--game-dir","--home","--session-stdin"])});
        let prepare=json!({"launch_api":"0.1.0","horizon":"nightly-B","minecraft":"26.3",
            "options":options(&["--prepare","--output","--complete","--progress","--check","--minecraft-dir","--server-jar"])});
        let instance=Instance{version:"26.3".into(),..Default::default()};
        assert!(compatible(&client,&prepare,&instance).is_err());
    }
}
