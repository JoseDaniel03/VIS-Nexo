//! VIS Worlds: opt-in, per-world backups in a folder managed by a cloud-sync client.
//! No OAuth credentials are stored by VIS; a "saved" status means the ZIP exists
//! in the selected local sync folder, not that a provider has confirmed upload.
use serde::{Deserialize,Serialize};
use sha2::{Digest,Sha256};
use std::{collections::BTreeMap,fs::{self,File,OpenOptions},io::{self,Read,Write},
    path::{Component,Path,PathBuf},time::{SystemTime,UNIX_EPOCH}};
use zip::{ZipArchive,ZipWriter,write::FileOptions,CompressionMethod};

const MAX_FILES:usize=40_000;
const MAX_TOTAL:u64=16*1024*1024*1024;
const MAX_DEPTH:usize=28;
const PROVIDERS:&[&str]=&["onedrive","google_drive","dropbox","nextcloud","other"];

#[derive(Debug,Default,Clone,Serialize,Deserialize)]
#[serde(default)]
struct Link { provider:String,folder:String,archive:String,sha256:String,
    fingerprint:String,bytes:u64,saved_at:u64 }
#[derive(Default,Serialize,Deserialize)]
#[serde(default)]
struct Settings { worlds:BTreeMap<String,Link> }
#[derive(Serialize)]
pub struct WorldCloudStatus { pub world:String,pub status:String,pub detail:String,
    pub provider:String,pub saved_at:u64,pub bytes:u64 }
#[derive(Serialize)]
pub struct CloudBackup { pub world:String,pub archive:String,pub sha256:String,pub bytes:u64 }

fn now()->u64 {SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()}
fn valid_name(s:&str)->bool {
    !s.is_empty()&&s.len()<=96&&s!="."&&s!=".."&&!s.starts_with(".vis-")
        &&!s.contains('/')&&!s.contains('\\')&&!s.chars().any(|c|c.is_control())
}
fn settings_path(game:&Path)->Result<PathBuf,String> {
    crate::instance_guard::private_paths(game,&[".vis/world-cloud.json"])?;
    Ok(game.join(".vis/world-cloud.json"))
}
fn load(game:&Path)->Result<Settings,String>{
    let path=settings_path(game)?;
    if !path.exists(){return Ok(Settings::default());}
    let metadata=fs::symlink_metadata(&path).map_err(|e|e.to_string())?;
    if !metadata.is_file()||metadata.len()>512*1024{return Err("Configuración Nube inválida".into());}
    serde_json::from_slice(&fs::read(path).map_err(|e|e.to_string())?)
        .map_err(|_|"Configuración Nube dañada".into())
}
fn save(game:&Path,s:&Settings)->Result<(),String>{
    crate::accounts::atomic_json(&settings_path(game)?,s)
}
fn world_dir(game:&Path,world:&str)->Result<PathBuf,String>{
    if !valid_name(world){return Err("Nombre del mundo inválido".into());}
    crate::instance_guard::private_paths(game,&["saves"])?;
    let saves=game.join("saves");
    let parent=fs::symlink_metadata(&saves).map_err(|_|"La instancia no tiene carpeta saves".to_string())?;
    if !parent.is_dir()||parent.file_type().is_symlink(){return Err("Carpeta saves insegura".into());}
    let path=saves.join(world);
    let meta=fs::symlink_metadata(&path).map_err(|_|"El mundo no existe".to_string())?;
    if !meta.is_dir()||meta.file_type().is_symlink(){return Err("Mundo no válido o enlace simbólico".into());}
    if !path.join("level.dat").is_file(){return Err("El mundo no contiene level.dat".into());}
    Ok(path)
}
fn list_world_dirs(game:&Path)->Result<Vec<String>,String>{
    crate::instance_guard::private_paths(game,&["saves"])?;
    let saves=game.join("saves");
    if !saves.exists(){return Ok(Vec::new());}
    let mut result=Vec::new();
    for entry in fs::read_dir(saves).map_err(|e|e.to_string())?.take(1500){
        let entry=entry.map_err(|e|e.to_string())?;
        let Some(name)=entry.file_name().to_str().map(str::to_owned) else{continue};
        if !valid_name(&name) {continue;}
        let meta=fs::symlink_metadata(entry.path()).map_err(|e|e.to_string())?;
        if meta.is_dir()&&!meta.file_type().is_symlink(){result.push(name);}
    }
    result.sort();
    Ok(result)
}
fn walk(root:&Path,dir:&Path,depth:usize,files:&mut Vec<(PathBuf,String,u64,u128)>,
    total:&mut u64)->Result<(),String>{
    if depth>MAX_DEPTH{return Err("Mundo con demasiadas carpetas anidadas".into());}
    for entry in fs::read_dir(dir).map_err(|e|e.to_string())?{
        let entry=entry.map_err(|e|e.to_string())?;
        let path=entry.path();
        let meta=fs::symlink_metadata(&path).map_err(|e|e.to_string())?;
        if meta.file_type().is_symlink(){return Err("El mundo contiene enlaces simbólicos".into());}
        if meta.is_dir(){walk(root,&path,depth+1,files,total)?;continue;}
        if !meta.is_file(){return Err("El mundo contiene un archivo especial".into());}
        *total=total.checked_add(meta.len()).ok_or("Mundo demasiado grande")?;
        if *total>MAX_TOTAL||files.len()>=MAX_FILES{return Err("Mundo supera los límites de seguridad".into());}
        let rel=path.strip_prefix(root).map_err(|e|e.to_string())?.to_string_lossy().replace('\\',"/");
        if rel.is_empty()||rel.split('/').any(|part|part=="."||part=="..")
            ||rel.chars().any(|c|c.is_control()){return Err("Nombre de archivo inseguro".into());}
        let modified=meta.modified().ok().and_then(|m|m.duration_since(UNIX_EPOCH).ok())
            .map(|v|v.as_nanos()).unwrap_or(0);
        files.push((path,rel,meta.len(),modified));
    }
    Ok(())
}
fn files_and_stamp(world:&Path)->Result<(Vec<(PathBuf,String,u64,u128)>,String),String>{
    let mut files=Vec::new();let mut total=0;
    walk(world,world,0,&mut files,&mut total)?;
    files.sort_by(|a,b|a.1.cmp(&b.1));
    let mut sha=Sha256::new();
    for (_,rel,size,modified) in &files{
        sha.update(rel.as_bytes());sha.update([0]);
        sha.update(size.to_be_bytes());sha.update(modified.to_be_bytes());
    }
    Ok((files,format!("{:x}",sha.finalize())))
}
fn digest_file(path:&Path)->Result<String,String>{
    let mut input=File::open(path).map_err(|e|e.to_string())?;
    let mut hasher=Sha256::new();let mut buf=[0;64*1024];
    loop {let n=input.read(&mut buf).map_err(|e|e.to_string())?;if n==0{break;}hasher.update(&buf[..n]);}
    Ok(format!("{:x}",hasher.finalize()))
}
fn location(game:&Path,world:&str,folder:&Path)->Result<PathBuf,String>{
    let chosen=fs::canonicalize(folder).map_err(|_|"La carpeta de sincronización no está disponible".to_string())?;
    let kind=fs::symlink_metadata(&chosen).map_err(|e|e.to_string())?;
    if !kind.is_dir(){return Err("Elegí una carpeta de sincronización".into());}
    let game_root=fs::canonicalize(game).map_err(|e|e.to_string())?;
    if chosen.starts_with(&game_root)||game_root.starts_with(&chosen){
        return Err("No vincules una carpeta que contenga la instancia o esté dentro de ella".into());
    }
    let instance_id=format!("{:x}",Sha256::digest(game_root.to_string_lossy().as_bytes()));
    let world_id=format!("{:x}",Sha256::digest(world.as_bytes()));
    Ok(chosen.join("VIS-Nexo-Worlds").join(&instance_id[..24]).join(&world_id[..24]))
}
pub fn link(game:&Path,world:&str,folder:&str,provider:&str)->Result<(),String>{
    world_dir(game,world)?;
    if !PROVIDERS.contains(&provider){return Err("Proveedor de sincronización no admitido".into());}
    let root=Path::new(folder);
    if !root.is_absolute(){return Err("Elegí una carpeta absoluta desde el selector".into());}
    let canonical=fs::canonicalize(root).map_err(|_|"Carpeta de nube no disponible".to_string())?;
    let target=location(game,world,&canonical)?;
    if !target.starts_with(&canonical){return Err("Carpeta de copia insegura".into());}
    let mut settings=load(game)?;
    settings.worlds.insert(world.to_owned(),Link{provider:provider.to_owned(),
        folder:canonical.to_string_lossy().into_owned(),..Link::default()});
    save(game,&settings)
}
pub fn status(game:&Path)->Result<Vec<WorldCloudStatus>,String>{
    let settings=load(game)?;
    let mut out=Vec::new();
    for world in list_world_dirs(game)? {
        let Some(link)=settings.worlds.get(&world) else {
            out.push(WorldCloudStatus{world,status:"grey".into(),
                detail:"Sin carpeta de nube vinculada".into(),provider:String::new(),saved_at:0,bytes:0});continue;
        };
        let state=(||->Result<(&str,String),String>{
            let dir=world_dir(game,&world)?;
            let (_,fingerprint)=files_and_stamp(&dir)?;
            let base=location(game,&world,Path::new(&link.folder))?;
            if link.archive.is_empty() {return Ok(("orange","Todavía no guardaste una copia".into()));}
            let archive=Path::new(&link.archive);
            if archive.parent()!=Some(base.as_path()){return Err("La ruta de la copia no es válida".into());}
            let meta=fs::symlink_metadata(archive).map_err(|_|"No se encontró la copia en la carpeta sincronizada".to_string())?;
            if !meta.is_file()||meta.file_type().is_symlink()||meta.len()!=link.bytes{
                return Err("La copia fue movida o alterada".into());
            }
            if fingerprint!=link.fingerprint {return Ok(("orange","El mundo cambió: necesita una copia nueva".into()));}
            Ok(("green","Copia local creada; comprobá la sincronización en tu proveedor".into()))
        })();
        let (status,detail)=match state {Ok((s,d))=>(s.to_owned(),d),Err(error)=>("red".into(),error)};
        out.push(WorldCloudStatus{world,status,detail,provider:link.provider.clone(),
            saved_at:link.saved_at,bytes:link.bytes});
    }
    Ok(out)
}
pub fn backup(game:&Path,world:&str)->Result<CloudBackup,String>{
    let _game_lock=crate::minecraft::acquire_game_run(game)?;
    let world_path=world_dir(game,world)?;
    let mut settings=load(game)?;
    let link=settings.worlds.get_mut(world).ok_or("Primero vinculá una carpeta de nube")?;
    let base=location(game,world,Path::new(&link.folder))?;
    crate::instance_guard::private_paths(game,&["saves"])?;
    let (files,before)=files_and_stamp(&world_path)?;
    fs::create_dir_all(&base).map_err(|e|e.to_string())?;
    let name=format!("world-{}-{}.zip",now(),std::process::id());
    let destination=base.join(&name);
    let stage=base.join(format!(".{name}.partial"));
    let result=(||->Result<(String,u64),String>{
        let output=OpenOptions::new().write(true).create_new(true).open(&stage).map_err(|e|e.to_string())?;
        let mut zip=ZipWriter::new(output);
        for (path,rel,size,_) in &files{
            zip.start_file(rel,FileOptions::default().compression_method(CompressionMethod::Deflated)
                .unix_permissions(0o600)).map_err(|e|e.to_string())?;
            let mut input=File::open(path).map_err(|e|e.to_string())?;
            let copied=io::copy(&mut input,&mut zip).map_err(|e|e.to_string())?;
            if copied!=*size{return Err("El mundo cambió durante la copia".into());}
        }
        zip.finish().map_err(|e|e.to_string())?.sync_all().map_err(|e|e.to_string())?;
        let after=files_and_stamp(&world_path)?.1;
        if before!=after{return Err("El mundo cambió mientras se guardaba; repetí la operación".into());}
        let bytes=fs::metadata(&stage).map_err(|e|e.to_string())?.len();
        let digest=digest_file(&stage)?;
        fs::rename(&stage,&destination).map_err(|e|e.to_string())?;
        Ok((digest,bytes))
    })();
    if result.is_err(){let _=fs::remove_file(&stage);}
    let (sha256,bytes)=result?;
    link.archive=destination.to_string_lossy().into_owned();
    link.sha256=sha256.clone();link.bytes=bytes;link.fingerprint=before;link.saved_at=now();
    save(game,&settings)?;
    Ok(CloudBackup{world:world.to_owned(),archive:link.archive.clone(),sha256,bytes})
}
pub fn restore_as_copy(game:&Path,world:&str)->Result<String,String>{
    let _game_lock=crate::minecraft::acquire_game_run(game)?;
    let settings=load(game)?;
    let link=settings.worlds.get(world).ok_or("Este mundo no tiene nube vinculada")?;
    let base=location(game,world,Path::new(&link.folder))?;
    let archive=Path::new(&link.archive);
    if archive.parent()!=Some(base.as_path())||link.sha256.len()!=64{
        return Err("Referencia de respaldo inválida".into());
    }
    let meta=fs::symlink_metadata(archive).map_err(|e|e.to_string())?;
    if !meta.is_file()||meta.file_type().is_symlink()||meta.len()!=link.bytes
        ||digest_file(archive)?!=link.sha256{return Err("La copia no supera la verificación SHA-256".into());}
    let saves=game.join("saves");
    crate::instance_guard::private_paths(game,&["saves"])?;
    fs::create_dir_all(&saves).map_err(|e|e.to_string())?;
    let new_name=format!("{}-restaurado-{}",world,now());
    if !valid_name(&new_name){return Err("Nombre de restauración demasiado largo".into());}
    let target=saves.join(&new_name);
    if target.exists(){return Err("Ya existe una restauración con ese nombre".into());}
    let stage=saves.join(format!(".vis-restore-{}-{}",now(),std::process::id()));
    fs::create_dir(&stage).map_err(|e|e.to_string())?;
    let outcome=(||->Result<(),String>{
        let mut zip=ZipArchive::new(File::open(archive).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
        if zip.len()>MAX_FILES {return Err("Demasiados archivos en la copia".into());}
        let mut total=0u64;
        for i in 0..zip.len(){
            let mut item=zip.by_index(i).map_err(|e|e.to_string())?;
            if item.is_dir() {continue;}
            if item.unix_mode().is_some_and(|m|m&0o170000==0o120000){return Err("Copia contiene enlaces simbólicos".into());}
            let name=item.name();
            if name.contains('\\')||name.starts_with('/')||name.len()>2048{return Err("Ruta de copia insegura".into());}
            let rel=Path::new(name);
            if rel.components().count()>MAX_DEPTH||rel.components().any(|c|!matches!(c,Component::Normal(_))){
                return Err("Ruta de copia insegura".into());
            }
            total=total.checked_add(item.size()).ok_or("Copia demasiado grande")?;
            if total>MAX_TOTAL {return Err("La copia supera 16 GiB".into());}
            let output=stage.join(rel);
            if let Some(parent)=output.parent(){fs::create_dir_all(parent).map_err(|e|e.to_string())?;}
            let mut file=OpenOptions::new().create_new(true).write(true).open(&output).map_err(|e|e.to_string())?;
            let copied=io::copy(&mut item,&mut file).map_err(|e|e.to_string())?;
            if copied!=item.size(){return Err("Archivo incompleto en copia".into());}
        }
        if !stage.join("level.dat").is_file(){return Err("La copia no contiene un mundo válido".into());}
        fs::rename(&stage,&target).map_err(|e|e.to_string())?;
        Ok(())
    })();
    if outcome.is_err(){let _=fs::remove_dir_all(stage);}
    outcome?;
    Ok(new_name)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn rejects_world_path_traversal(){
        assert!(!valid_name("../secrets"));
        assert!(!valid_name("folder\\..\\data"));
        assert!(!valid_name(".vis-restore-test"));
        assert!(valid_name("Mi mundo 1"));
    }
}
