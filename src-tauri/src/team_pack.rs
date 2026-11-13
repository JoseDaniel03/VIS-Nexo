//! VIS Team Pack: curated project defaults, never a player's whole .minecraft.
//! Server addresses and waypoint coordinates require explicit separate opt-ins.
//! Mods are pinned by public Modrinth IDs; third-party JARs are not republished.
use serde::{Deserialize,Serialize};
use sha2::{Digest,Sha256};
use std::{collections::HashSet,fs::{self,File},io::{Read,Write},path::{Component,Path,PathBuf},time::{SystemTime,UNIX_EPOCH}};
use vsui_core::GameProject;
use zip::{ZipWriter,ZipArchive,write::FileOptions,CompressionMethod};

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
#[derive(Clone,Serialize,Deserialize)]
struct FileEntry { path:String,sha256:String,size_bytes:u64 }
#[derive(Deserialize)]
struct TeamManifest {
    format_version:u32,project_id:String,engine:String,
    minecraft_version:String,loader:String,loader_version:String,
    modrinth_project_ids:Vec<String>,files:Vec<FileEntry>,
    #[serde(default)]include_servers:bool,
    #[serde(default)]include_waypoints:bool,
}
#[derive(Serialize)]
pub struct TeamApplyReport {
    pub project_id:String,
    pub installed:usize,
    pub preserved:usize,
    pub modrinth_mods:usize,
}
fn version_now()->u64{SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()}
fn unique_stage()->String{
    let nanos=SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    format!("{}-{nanos}",std::process::id())
}
fn safe_pack_path(path:&str)->bool {
    !path.is_empty()&&path.len()<=360&&
    !path.contains('\\')&&!path.contains("//")&&
    !path.bytes().any(|b|b<32||b==b':'||b==b'<'||b==b'>'||
        b==b'"'||b==b'|'||b==b'*'||b==b'?')
    && path.split('/').all(|part|{
        let stem=part.split('.').next().unwrap_or("").to_ascii_lowercase();
        !part.is_empty()&&part!="."&&part!=".."&&
        !matches!(stem.as_str(),"con"|"prn"|"aux"|"nul"|"com1"|"com2"|"lpt1"|"lpt2")
    })
}
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
// Best-effort reject common credentials accidentally kept inside config files.
// Review by a human is still mandatory: arbitrary mods may store private fields.
fn inspect_config_secrets(path:&Path,filename:&str)->Result<(),String>{
    let ext=Path::new(filename).extension().and_then(|v|v.to_str())
        .unwrap_or("").to_ascii_lowercase();
    if !matches!(ext.as_str(),"json"|"json5"|"toml"|"yaml"|"yml"|"cfg"|"properties"|"ini"|"txt"|"js"){
        return Ok(());
    }
    let len=fs::metadata(path).map_err(|e|e.to_string())?.len();
    if len>2*1024*1024{
        return Err(format!("Revisá y dividí el archivo de configuración grande antes de publicar: {filename}"));
    }
    let raw=fs::read(path).map_err(|e|e.to_string())?;
    let source=String::from_utf8(raw).map_err(|_|format!("Configuración no textual: {filename}"))?;
    let labels=["token","password","secret","api_key","apikey","private_key","access_key",
        "sessionid","client_secret","authkey"];
    for line in source.lines(){
        let trimmed=line.trim();
        if trimmed.starts_with('#')||trimmed.starts_with("//"){continue;}
        let Some(index)=trimmed.find(|ch:char|ch=='='||ch==':') else {continue};
        let key=trimmed[..index].trim().trim_matches('"').to_ascii_lowercase();
        let value=trimmed[index+1..].trim().trim_end_matches(',').trim_matches('"').trim();
        if labels.iter().any(|word|key.contains(word))
            && !value.is_empty()&&!matches!(value,"null"|"false"|"0"|"''"|"{}"){
            return Err(format!("Configuración potencialmente privada ({filename}); quitá tokens o secretos antes de publicar"));
        }
    }
    Ok(())
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
        if !safe_pack_path(&display){return Err(format!("Ruta incompatibile con Windows/Linux: {display}"));}
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
            inspect_config_secrets(&path,&name)?;
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
    if json.len()>512*1024{return Err("El .bsconfig es demasiado grande".into());}
    let base=output_root.join("project-packages").join("teams").join(&project.id);
    crate::instance_guard::private_paths(output_root,&[
        "project-packages","project-packages/teams",
        &format!("project-packages/teams/{}",project.id)
    ])?;
    fs::create_dir_all(&base).map_err(|e|e.to_string())?;
    let stage=base.join(format!("pack-{}.tmp",unique_stage()));
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
// The first import is additive only. Existing user configs, options,
// worlds, servers and modified mods are never replaced by team defaults.
pub fn apply(game:&Path,archive:&Path,project:&GameProject,
             allow_servers:bool,allow_waypoints:bool)->Result<TeamApplyReport,String>{
    validate_game(game,project)?;
    let metadata=fs::symlink_metadata(archive).map_err(|e|e.to_string())?;
    if metadata.file_type().is_symlink()||!metadata.is_file()||metadata.len()>MAX_ZIP {
        return Err("Archivo ZIP externo, simbólico o demasiado grande".into());
    }
    let mut zip=ZipArchive::new(File::open(archive).map_err(|e|e.to_string())?)
        .map_err(|_|"Paquete VIS Team inválido")?;
    if zip.len()==0||zip.len()>MAX_FILES+1{return Err("Cantidad de entradas ZIP inválida".into());}
    let manifest:TeamManifest={
        let mut file=zip.by_name(".bsconfig").map_err(|_|"El paquete no contiene .bsconfig")?;
        if file.size()>512*1024{return Err("Manifiesto de proyecto demasiado grande".into());}
        serde_json::from_reader(file.by_ref().take(512*1024+1))
            .map_err(|_|".bsconfig tiene un formato inválido")?
    };
    if manifest.format_version!=1||manifest.project_id!=project.id
        ||manifest.engine!=project.engine||manifest.loader!=project.loader
        ||manifest.loader_version!=project.loader_version
        ||manifest.minecraft_version!=project.mc_version
        ||manifest.modrinth_project_ids!=project.modrinth_mods{
        return Err("Este paquete no corresponde a la versión/loader/mods del proyecto actual".into());
    }
    if manifest.files.len()+1!=zip.len()||manifest.files.len()>MAX_FILES{
        return Err("El manifiesto y el ZIP no coinciden".into());
    }
    let mut by_name=std::collections::HashMap::new();
    let mut seen=HashSet::new();let mut total=0u64;
    for file in &manifest.files{
        let path=Path::new(&file.path);
        let parts=path.components().collect::<Vec<_>>();
        if parts.is_empty()||parts.iter().any(|p|!matches!(p,Component::Normal(_)))
            ||!safe_pack_path(&file.path)
            ||file.sha256.len()!=64||!file.sha256.bytes().all(|b|b.is_ascii_hexdigit())
            ||file.size_bytes>MAX_FILE{
            return Err("Ruta o verificador ZIP inseguro".into());
        }
        let lower=file.path.to_ascii_lowercase();
        if !seen.insert(lower){return Err("Archivos repetidos en el ZIP".into());}
        let first=parts[0].as_os_str().to_str().ok_or("Carpeta inválida")?;
        if file.path=="servers.dat"{
            if !manifest.include_servers{return Err("Lista de servidores sin permiso en manifiesto".into());}
        }else if parts.len()<2||!allow_root(first,TeamOptions{include_packs:true,
            include_servers:manifest.include_servers,include_waypoints:manifest.include_waypoints}){
            return Err("El ZIP contiene una carpeta fuera del catálogo permitido".into());
        }
        if parts.iter().any(|p|match p{Component::Normal(n)=>
            n.to_str().is_none_or(|name|name.starts_with('.')||exclusions(name)),
            _=>true}){
            return Err("El ZIP contiene datos privados o rutas de sistema".into());
        }
        total=total.checked_add(file.size_bytes).ok_or("Paquete demasiado grande")?;
        if total>MAX_UNCOMPRESSED{return Err("ZIP expandido demasiado grande".into());}
        by_name.insert(file.path.clone(),file);
    }
    let stage_name=format!("team-stage-{}",unique_stage());
    let stage=game.join(".vslauncher").join(&stage_name);
    crate::instance_guard::private_paths(game,&[".vslauncher",
        &format!(".vslauncher/{stage_name}")])?;
    fs::create_dir_all(&stage).map_err(|e|e.to_string())?;
    let outcome=(||->Result<TeamApplyReport,String>{
        let mut eligible=Vec::new();
        let mut archive_paths=HashSet::new();
        let mut preserved=0usize;
        for index in 0..zip.len(){
            let mut file=zip.by_index(index).map_err(|e|e.to_string())?;
            let name=file.name().to_owned();
            if name==".bsconfig"{continue;}
            let expected=by_name.get(&name).ok_or("Entrada ZIP no declarada")?;
            if !archive_paths.insert(name.clone())||file.is_dir()
                ||file.size()!=expected.size_bytes||file.size()>MAX_FILE
                ||file.unix_mode().is_some_and(|mode|mode&0o170000==0o120000){
                return Err("Entrada ZIP no segura o distinta al manifiesto".into());
            }
            if name=="servers.dat"&&!allow_servers{preserved+=1;continue;}
            if (name.starts_with("XaeroWaypoints/")||name.starts_with("journeymap/"))
                &&!allow_waypoints{preserved+=1;continue;}
            let target=game.join(&name);
            crate::instance_guard::private_paths(game,&[&name])?;
            if target.exists(){preserved+=1;continue;}
            let extracted=stage.join(&name);
            if let Some(parent)=extracted.parent(){fs::create_dir_all(parent).map_err(|e|e.to_string())?;}
            let mut out=fs::OpenOptions::new().write(true).create_new(true)
                .open(&extracted).map_err(|e|e.to_string())?;
            let mut hash=Sha256::new();let mut read=0u64;let mut buffer=[0u8;65536];
            loop{
                let n=file.read(&mut buffer).map_err(|e|e.to_string())?;
                if n==0{break;}
                read+=n as u64;
                if read>expected.size_bytes||read>MAX_FILE{return Err("ZIP con contenido expandido inesperado".into());}
                hash.update(&buffer[..n]);out.write_all(&buffer[..n]).map_err(|e|e.to_string())?;
            }
            out.sync_all().map_err(|e|e.to_string())?;
            if read!=expected.size_bytes||format!("{:x}",hash.finalize())!=expected.sha256{
                return Err("Un archivo del ZIP no coincide con su SHA-256".into());
            }
            eligible.push((name,extracted));
        }
        if archive_paths.len()!=by_name.len(){return Err("Faltan archivos declarados en el ZIP".into());}
        let mut installed=0usize;
        for (relative,staged) in eligible{
            crate::instance_guard::private_paths(game,&[&relative])?;
            let destination=game.join(&relative);
            if destination.exists(){preserved+=1;continue;}
            if let Some(parent)=destination.parent(){fs::create_dir_all(parent).map_err(|e|e.to_string())?;}
            // No overwrite: a race with user edits fails instead of replacing
            // an existing configuration. Preserves worlds and player settings.
            let mut source=File::open(&staged).map_err(|e|e.to_string())?;
            let mut output=fs::OpenOptions::new().write(true).create_new(true)
                .open(&destination).map_err(|e|e.to_string())?;
            let copied=std::io::copy(&mut source,&mut output)
                .and_then(|_|output.sync_all());
            drop(output);
            if let Err(e)=copied{
                let _=fs::remove_file(&destination);
                return Err(format!("No se pudo instalar un archivo de equipo: {e}"));
            }
            installed+=1;
        }
        Ok(TeamApplyReport{project_id:project.id.clone(),installed,preserved,
            modrinth_mods:manifest.modrinth_project_ids.len()})
    })();
    let _=fs::remove_dir_all(stage);
    outcome
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test]fn detects_common_secrets_in_configuration(){
        let root=std::env::temp_dir().join(format!("team-secret-scan-{}",std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let example=root.join("test.json");
        fs::write(&example,r#"{"password":"do-not-publish"}"#).unwrap();
        assert!(inspect_config_secrets(&example,"test.json").is_err());
        fs::write(&example,r#"{"renderDistance":12}"#).unwrap();
        assert!(inspect_config_secrets(&example,"test.json").is_ok());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]fn round_trip_installs_only_missing_defaults(){
        let root=std::env::temp_dir().join(format!("vis-team-pack-test-{}",std::process::id()));
        let _=fs::remove_dir_all(&root);
        let game=root.join("Instancias").join("source");
        let dest=root.join("Instancias").join("target");
        fs::create_dir_all(game.join("config")).unwrap();
        fs::create_dir_all(game.join("saves/Private World")).unwrap();
        fs::create_dir_all(&dest).unwrap();
        fs::write(game.join("config/test.json"),br#"{"enabled":true}"#).unwrap();
        fs::write(game.join("saves/Private World/level.dat"),b"never upload").unwrap();
        fs::write(game.join("options.txt"),b"personal preference").unwrap();
        let project=GameProject{id:"teamtest".into(),title:"Team Test".into(),
            mc_version:"1.21.1".into(),engine:"java".into(),loader:"vanilla".into(),
            ..Default::default()};
        let list=preview(&game,&project,TeamOptions::default()).unwrap();
        assert_eq!(list.files,vec!["config/test.json"]);
        let package=build(&game,&root,&project,TeamOptions::default()).unwrap();
        assert!(package.size_bytes>0);
        let imported=apply(&dest,Path::new(&package.archive),&project,false,false).unwrap();
        assert_eq!(imported.installed,1);
        assert_eq!(fs::read(dest.join("config/test.json")).unwrap(),br#"{"enabled":true}"#);
        assert!(!dest.join("saves").exists());
        assert!(!dest.join("options.txt").exists());
        fs::write(dest.join("config/test.json"),b"user settings").unwrap();
        let again=apply(&dest,Path::new(&package.archive),&project,false,false).unwrap();
        assert_eq!(again.installed,0);
        assert_eq!(fs::read(dest.join("config/test.json")).unwrap(),b"user settings");
        let _=fs::remove_dir_all(root);
    }
    #[test]fn project_ids_and_secret_paths(){
        assert!(safe_id("virgoland"));
        assert!(!safe_id("../../secret"));
        assert!(exclusions("my-auth-token.json"));
        assert!(exclusions("private-key.pem"));
        assert!(exclusions("Minecraft-Server.jar"));
        assert!(!exclusions("sodium-client.toml"));
        assert!(safe_pack_path("config/sodium.json"));
        assert!(!safe_pack_path("config/../saves/world"));
        assert!(!safe_pack_path("config/session:stream"));
        assert!(!safe_pack_path("config/CON.txt"));
        let defaults=TeamOptions::default();
        assert!(allow_root("config",defaults));
        assert!(!allow_root("saves",defaults));
        assert!(!allow_root("screenshots",defaults));
        assert!(!allow_root("journeymap",defaults));
        assert!(!allow_root("resourcepacks",defaults));
        assert!(allow_root("XaeroWaypoints",TeamOptions{include_waypoints:true,..defaults}));
    }
}
