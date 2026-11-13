//! VIS Team Pack: curated project defaults, never a player's whole .minecraft.
//! Server addresses and waypoint coordinates require explicit separate opt-ins.
//! Mods are pinned by public Modrinth IDs; third-party JARs are not republished.
use serde::{Deserialize,Serialize};
use sha2::{Digest,Sha256};
use std::{fs::{self,File},io::{Read,Write},path::{Path,PathBuf},time::{SystemTime,UNIX_EPOCH}};
use vsui_core::GameProject;
use zip::{ZipWriter,write::FileOptions,CompressionMethod};

const MAX_FILES:usize=1500;
const MAX_FILE:u64=16*1024*1024;
const MAX_UNCOMPRESSED:u64=96*1024*1024;
const MAX_ZIP:u64=32*1024*1024;

#[derive(Clone,Copy,Default,Deserialize,Serialize)]
#[serde(default)]
pub struct TeamOptions {
    pub include_packs:bool,
    pub include_servers:bool,
    pub include_waypoints:bool,
}
#[derive(Clone,Serialize)]
pub struct TeamPreview {
    pub project_id:String,
    pub files:Vec<String>,
    pub total_bytes:u64,
    pub excluded:Vec<String>,
    pub warnings:Vec<String>,
}
#[derive(Clone,Serialize)]
pub struct TeamPack {
    pub project_id:String,
    pub archive:String,
    pub sha256:String,
    pub size_bytes:u64,
    pub files:usize,
}
#[derive(Serialize)]
struct FileEntry { path:String,sha256:String,size_bytes:u64 }
fn version_now()->u64{SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()}
fn safe_id(id:&str)->bool{
    !id.is_empty()&&id.len()<=100
        &&id.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'_'||b==b'-')
}
fn exclusions(filename:&str)->bool {
    let lower=filename.to_ascii_lowercase();
    [".env","token","password","secret","credential","account","session",
     "usercache","private","oauth","auth","keystore","apikey","api_key"].iter()
        .any(|marker|lower.contains(marker))
    || [".pem",".key",".p12",".pfx",".db",".sqlite",".log",".jar",".dll",".exe",".bat",".cmd",".sh"]
        .iter().any(|ending|lower.ends_with(ending))
}
fn allow_root(name:&str,options:TeamOptions)->bool {
    matches!(name,"config"|"defaultconfigs"|"kubejs"|"scripts"|"patchouli_books")
    || options.include_packs&&matches!(name,"resourcepacks"|"shaderpacks"|"datapacks")
    || options.include_waypoints&&matches!(name,"XaeroWaypoints"|"journeymap")
}
fn validate_game(game:&Path,project:&GameProject)->Result<(),String>{
    if !safe_id(&project.id){return Err("Identificador de proyecto inválido".into());}
    if !game.is_dir(){return Err("Instalá una instancia de este proyecto antes de publicar".into());}
    if game.symlink_metadata().map_err(|e|e.to_string())?.file_type().is_symlink(){
        return Err("La instancia no puede apuntar mediante un enlace simbólico".into());
    }
    crate::instance_backup::require_clean_restore_state(game)?;
    Ok(())
}
fn visit(game:&Path,root:&Path,options:TeamOptions,files:&mut Vec<PathBuf>,
         excluded:&mut Vec<String>,bytes:&mut u64)->Result<(),String> {
    crate::instance_guard::private_paths(game,&[root.strip_prefix(game)
        .map_err(|_|"Carpeta externa a la instancia")?.to_string_lossy().as_ref()])?;
    let mut children=fs::read_dir(root).map_err(|e|e.to_string())?
        .collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
    children.sort_by_key(|entry|entry.file_name());
    for entry in children {
        let path=entry.path();
        let relative=path.strip_prefix(game).map_err(|_|"Ruta fuera de la instancia")?;
        let name=entry.file_name().to_string_lossy().into_owned();
        let display=relative.to_string_lossy().replace('\\',"/");
        let metadata=fs::symlink_metadata(&path).map_err(|e|e.to_string())?;
        if metadata.file_type().is_symlink(){
            return Err(format!("No se permiten enlaces simbólicos dentro del paquete: {display}"));
        }
        if name.starts_with('.')||exclusions(&name){
            if excluded.len()<80{excluded.push(display);}
            continue;
        }
        if metadata.is_dir(){
            visit(game,&path,options,files,excluded,bytes)?;
        }else if metadata.is_file(){
            if metadata.len()>MAX_FILE {return Err(format!("Archivo demasiado grande para paquete de equipo: {display}"));}
            *bytes=bytes.checked_add(metadata.len()).ok_or("Paquete demasiado grande")?;
            if *bytes>MAX_UNCOMPRESSED {return Err("El paquete supera 96 MiB sin comprimir".into());}
            if files.len()>=MAX_FILES{return Err("El paquete supera 1500 archivos".into());}
            if matches!(relative.components().next(),Some(std::path::Component::Normal(_))){
                files.push(path);
            }else{return Err("Ruta interna insegura".into());}
        }
    }
    let _=options;
    Ok(())
}
fn gather(game:&Path,project:&GameProject,options:TeamOptions)
    ->Result<(Vec<PathBuf>,Vec<String>,u64),String>{
    validate_game(game,project)?;
    let mut files=Vec::new();let mut excluded=Vec::new();let mut bytes=0u64;
    let mut roots=vec!["config","defaultconfigs","kubejs","scripts","patchouli_books"];
    if options.include_packs {roots.extend(["resourcepacks","shaderpacks","datapacks"]);}
    if options.include_waypoints {roots.extend(["XaeroWaypoints","journeymap"]);}
    for name in roots {
        if !allow_root(name,options){continue;}
        let path=game.join(name);
        match fs::symlink_metadata(&path){
            Ok(metadata)=>{
                if metadata.file_type().is_symlink(){return Err(format!("La carpeta {name} es un enlace simbólico"));}
                if !metadata.is_dir(){return Err(format!("Se esperaba la carpeta {name}"));}
                visit(game,&path,options,&mut files,&mut excluded,&mut bytes)?;
            }
            Err(e) if e.kind()==std::io::ErrorKind::NotFound=>{},
            Err(e)=>return Err(e.to_string()),
        }
    }
    if options.include_servers{
        let path=game.join("servers.dat");
        match fs::symlink_metadata(&path){
            Ok(meta) if meta.is_file()&&!meta.file_type().is_symlink()=>{
                if meta.len()>1024*1024 {return Err("servers.dat supera 1 MiB".into());}
                files.push(path);bytes+=meta.len();
            }
            Ok(_)=>return Err("La lista de servidores no es un archivo normal".into()),
            Err(e) if e.kind()==std::io::ErrorKind::NotFound=>{},
            Err(e)=>return Err(e.to_string()),
        }
    }
    files.sort();
    Ok((files,excluded,bytes))
}
pub fn preview(game:&Path,project:&GameProject,options:TeamOptions)->Result<TeamPreview,String>{
    let (files,excluded,total_bytes)=gather(game,project,options)?;
    let mut warnings=vec!["Revisá cada configuración antes de publicar: algunos mods pueden guardar datos personales o claves en archivos de texto.".into()];
    if options.include_servers{warnings.push("Se compartirán las IP y direcciones guardadas en servers.dat.".into());}
    if options.include_waypoints{warnings.push("Se compartirán coordenadas y puntos de mapa privados.".into());}
    if options.include_packs{warnings.push("Publicá únicamente paquetes de recursos que tengas permiso de redistribuir.".into());}
    Ok(TeamPreview{project_id:project.id.clone(),
        files:files.iter().map(|p|p.strip_prefix(game).unwrap_or(p)
            .to_string_lossy().replace('\\',"/")).collect(),
        excluded,total_bytes,warnings})
}
fn fingerprint_file(path:&Path)->Result<(String,u64),String>{
    let mut input=File::open(path).map_err(|e|e.to_string())?;
    let mut hash=Sha256::new();let mut total=0u64;let mut buf=[0u8;65536];
    loop{
        let n=input.read(&mut buf).map_err(|e|e.to_string())?;
        if n==0{break;}
        total+=n as u64;
        if total>MAX_FILE{return Err("Archivo modificado o demasiado grande durante exportación".into());}
        hash.update(&buf[..n]);
    }
    Ok((format!("{:x}",hash.finalize()),total))
}
pub fn build(game:&Path,output_root:&Path,project:&GameProject,options:TeamOptions)->Result<TeamPack,String>{
    let (files,_,_)=gather(game,project,options)?;
    let entries=files.iter().map(|file|{
        let path=file.strip_prefix(game).map_err(|_|"Ruta fuera de la instancia")?
            .to_string_lossy().replace('\\',"/");
        let (sha256,size_bytes)=fingerprint_file(file)?;
        Ok(FileEntry{path,sha256,size_bytes})
    }).collect::<Result<Vec<_>,String>>()?;
    let manifest=serde_json::json!({
        "format_version":1,
        "project_id":&project.id,
        "name":&project.title,
        "engine":&project.engine,
        "minecraft_version":&project.mc_version,
        "loader":&project.loader,
        "loader_version":&project.loader_version,
        "modrinth_project_ids":&project.modrinth_mods,
        "version_created_at":version_now(),
        "files":&entries,
        "contents":"team-defaults",
        "include_servers":options.include_servers,
        "include_waypoints":options.include_waypoints
    });
    let json=serde_json::to_vec_pretty(&manifest).map_err(|e|e.to_string())?;
    let base=output_root.join("project-packages").join("teams").join(&project.id);
    crate::instance_guard::private_paths(output_root,&[
        "project-packages","project-packages/teams",
        &format!("project-packages/teams/{}",project.id)
    ])?;
    fs::create_dir_all(&base).map_err(|e|e.to_string())?;
    let stage=base.join(format!("pack-{}-{}.tmp",std::process::id(),version_now()));
    let outcome=(||->Result<TeamPack,String>{
        let file=File::create(&stage).map_err(|e|e.to_string())?;
        let mut writer=ZipWriter::new(file);
        let opts=FileOptions::default().compression_method(CompressionMethod::Deflated);
        writer.start_file(".bsconfig",opts).map_err(|e|e.to_string())?;
        writer.write_all(&json).map_err(|e|e.to_string())?;
        for (file,entry) in files.iter().zip(entries.iter()){
            writer.start_file(entry.path.as_str(),opts).map_err(|e|e.to_string())?;
            let mut input=File::open(file).map_err(|e|e.to_string())?;
            let mut buf=[0u8;65536];let mut digest=Sha256::new();let mut total=0u64;
            loop{
                let n=input.read(&mut buf).map_err(|e|e.to_string())?;if n==0{break;}
                total+=n as u64;
                if total>MAX_FILE{return Err("Un archivo creció durante la publicación".into());}
                digest.update(&buf[..n]);writer.write_all(&buf[..n]).map_err(|e|e.to_string())?;
            }
            if total!=entry.size_bytes||format!("{:x}",digest.finalize())!=entry.sha256 {
                return Err("La configuración cambió durante el empaquetado; volvé a intentar".into());
            }
        }
        let mut output=writer.finish().map_err(|e|e.to_string())?;
        output.flush().map_err(|e|e.to_string())?;
        output.sync_all().map_err(|e|e.to_string())?;
        let size_bytes=fs::metadata(&stage).map_err(|e|e.to_string())?.len();
        if size_bytes>MAX_ZIP{return Err("El ZIP de equipo supera 32 MiB; reducí los packs".into());}
        let (sha256,_)=fingerprint_archive(&stage)?;
        let destination=base.join(format!("{sha256}.zip"));
        if destination.exists(){
            if fingerprint_archive(&destination)?.0!=sha256{return Err("Archivo de equipo existente no verificable".into());}
            let _=fs::remove_file(&stage);
        }else{fs::rename(&stage,&destination).map_err(|e|e.to_string())?;}
        Ok(TeamPack{project_id:project.id.clone(),archive:destination.to_string_lossy().into_owned(),
            sha256,size_bytes,files:entries.len()})
    })();
    if outcome.is_err(){let _=fs::remove_file(stage);}
    outcome
}
fn fingerprint_archive(path:&Path)->Result<(String,u64),String>{
    let mut input=File::open(path).map_err(|e|e.to_string())?;
    let mut digest=Sha256::new();let mut total=0u64;let mut buffer=[0u8;65536];
    loop{
        let n=input.read(&mut buffer).map_err(|e|e.to_string())?;if n==0{break;}
        total+=n as u64;if total>MAX_ZIP{return Err("El ZIP supera 32 MiB".into());}
        digest.update(&buffer[..n]);
    }
    Ok((format!("{:x}",digest.finalize()),total))
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test]fn project_ids_and_secret_paths(){
        assert!(safe_id("virgoland"));
        assert!(!safe_id("../../secret"));
        assert!(exclusions("my-auth-token.json"));
        assert!(exclusions("private-key.pem"));
        assert!(exclusions("Minecraft-Server.jar"));
        assert!(!exclusions("sodium-client.toml"));
        let defaults=TeamOptions::default();
        assert!(allow_root("config",defaults));
        assert!(!allow_root("saves",defaults));
        assert!(!allow_root("screenshots",defaults));
        assert!(!allow_root("journeymap",defaults));
        assert!(!allow_root("resourcepacks",defaults));
        assert!(allow_root("XaeroWaypoints",TeamOptions{include_waypoints:true,..defaults}));
    }
}
