//! VIS Worlds: opt-in, per-world backups in a folder managed by a cloud-sync client.
//! No OAuth credentials are stored by VIS; a "saved" status means the ZIP exists
//! in the selected local sync folder, not that a provider has confirmed upload.
use serde::{Deserialize,Serialize};
use rand_core::{OsRng,RngCore};
use sha2::{Digest,Sha256};
use std::{collections::{BTreeMap,BTreeSet},fs::{self,File,OpenOptions},io::{self,Read,Write},
    path::{Component,Path,PathBuf},time::{SystemTime,UNIX_EPOCH}};
use zip::{ZipArchive,ZipWriter,write::SimpleFileOptions,CompressionMethod};

const MAX_FILES:usize=40_000;
const MAX_TOTAL:u64=16*1024*1024*1024;
const MAX_DEPTH:usize=28;
const PROVIDERS:&[&str]=&["onedrive","google_drive","dropbox","nextcloud","other"];

#[derive(Debug,Default,Clone,Serialize,Deserialize)]
#[serde(default)]
struct Link { provider:String,folder:String,namespace:String,archive:String,sha256:String,
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
        &&!s.contains('/')&&!s.contains('\\')&&!s.contains(':')
        &&!s.ends_with('.')&&!s.ends_with(' ')&&!s.chars().any(|c|c.is_control())
        &&Path::new(s).components().count()==1
        &&matches!(Path::new(s).components().next(),Some(Component::Normal(_)))
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
fn location(game:&Path,world:&str,folder:&Path,namespace:&str)->Result<PathBuf,String>{
    if namespace.len()!=32||!namespace.bytes().all(|c|c.is_ascii_hexdigit()){
        return Err("Identificador del respaldo inválido".into());
    }
    let chosen=fs::canonicalize(folder).map_err(|_|"La carpeta de sincronización no está disponible".to_string())?;
    let kind=fs::symlink_metadata(&chosen).map_err(|e|e.to_string())?;
    if !kind.is_dir(){return Err("Elegí una carpeta de sincronización".into());}
    let game_root=fs::canonicalize(game).map_err(|e|e.to_string())?;
    if chosen.starts_with(&game_root)||game_root.starts_with(&chosen){
        return Err("No vincules una carpeta que contenga la instancia o esté dentro de ella".into());
    }
    // A stable random namespace travels with the portable instance. Moving the
    // instance no longer changes its destination within the provider folder.
    let world_id=format!("{:x}",Sha256::digest(world.as_bytes()));
    let target=chosen.join("VIS-Nexo-Worlds").join(namespace).join(&world_id[..24]);
    // Reject pre-existing links and non-directory entries at EVERY generated
    // level; a synced folder may contain data we did not create ourselves.
    let mut cursor=chosen.clone();
    for segment in target.strip_prefix(&chosen).map_err(|_|"Ruta Nube insegura")?.components(){
        cursor.push(segment.as_os_str());
        match fs::symlink_metadata(&cursor) {
            Ok(meta) if meta.file_type().is_symlink()||!meta.is_dir()=>
                return Err("La carpeta sincronizada contiene enlaces o archivos inesperados".into()),
            Ok(_)=>(),
            Err(err) if err.kind()==io::ErrorKind::NotFound=>(),
            Err(err)=>return Err(err.to_string()),
        }
    }
    Ok(target)
}
pub fn link(game:&Path,world:&str,folder:&str,provider:&str)->Result<(),String>{
    world_dir(game,world)?;
    if !PROVIDERS.contains(&provider){return Err("Proveedor de sincronización no admitido".into());}
    let root=Path::new(folder);
    if !root.is_absolute(){return Err("Elegí una carpeta absoluta desde el selector".into());}
    let canonical=fs::canonicalize(root).map_err(|_|"Carpeta de nube no disponible".to_string())?;
    let mut settings=load(game)?;
    let namespace=if let Some(old)=settings.worlds.get(world){
        if old.namespace.len()==32&&old.namespace.bytes().all(|c|c.is_ascii_hexdigit()){
            old.namespace.clone()
        }else{
            let mut bytes=[0u8;16];OsRng.fill_bytes(&mut bytes);
            bytes.iter().map(|b|format!("{b:02x}")).collect()
        }
    }else{
        let mut bytes=[0u8;16];OsRng.fill_bytes(&mut bytes);
        bytes.iter().map(|b|format!("{b:02x}")).collect()
    };
    let target=location(game,world,&canonical,&namespace)?;
    if !target.starts_with(&canonical){return Err("Carpeta de copia insegura".into());}
    settings.worlds.insert(world.to_owned(),Link{provider:provider.to_owned(),
        folder:canonical.to_string_lossy().into_owned(),namespace,..Link::default()});
    save(game,&settings)
}
pub fn unlink(game:&Path,world:&str)->Result<(),String>{
    if !valid_name(world){return Err("Mundo inválido".into());}
    let mut settings=load(game)?;
    settings.worlds.remove(world);
    // Desvincular no borra los respaldos del proveedor.
    save(game,&settings)
}
pub fn status(game:&Path)->Result<Vec<WorldCloudStatus>,String>{
    let settings=load(game)?;
    let mut out=Vec::new();
    // Include cloud-linked worlds even after the local world was deleted or
    // the instance was reinstalled. Otherwise the user cannot restore them.
    let mut names=list_world_dirs(game)?.into_iter().collect::<BTreeSet<_>>();
    names.extend(settings.worlds.keys().cloned());
    for world in names {
        let Some(link)=settings.worlds.get(&world) else {
            out.push(WorldCloudStatus{world,status:"grey".into(),
                detail:"Sin carpeta de nube vinculada".into(),provider:String::new(),saved_at:0,bytes:0});continue;
        };
        let state=(||->Result<(&str,String),String>{
            let base=location(game,&world,Path::new(&link.folder),&link.namespace)?;
            if link.archive.is_empty() {return Ok(("orange","Todavía no guardaste una copia".into()));}
            let dir=match world_dir(game,&world){
                Ok(path)=>path,
                Err(_)=>return Err("Mundo local ausente; usá Restaurar copia si tenés un respaldo".into())
            };
            let (_,fingerprint)=files_and_stamp(&dir)?;
            let archive=Path::new(&link.archive);
            if archive.parent()!=Some(base.as_path()){return Err("La ruta de la copia no es válida".into());}
            let meta=fs::symlink_metadata(archive).map_err(|_|"No se encontró la copia en la carpeta sincronizada".to_string())?;
            if !meta.is_file()||meta.file_type().is_symlink()||meta.len()!=link.bytes{
                return Err("La copia fue movida o alterada".into());
            }
            if link.sha256.len()!=64||!link.sha256.bytes().all(|b|b.is_ascii_hexdigit()) {
                return Err("Falta el comprobante SHA-256 del respaldo".into());
            }
            if fingerprint!=link.fingerprint {return Ok(("orange","El mundo cambió: necesita una copia nueva".into()));}
            // Small archives receive an immediate integrity check. Large ones
            // are verified on restore to avoid blocking the launcher by hashing
            // multi-gigabyte worlds every time the user opens the Nube panel.
            if link.bytes<=64*1024*1024&&digest_file(archive)?!=link.sha256{
                return Err("La copia local no coincide con su SHA-256".into());
            }
            Ok(("green","Copia local presente; revisá que el proveedor haya terminado de sincronizar".into()))
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
    let base=location(game,world,Path::new(&link.folder),&link.namespace)?;
    crate::instance_guard::private_paths(game,&["saves"])?;
    let (files,before)=files_and_stamp(&world_path)?;
    fs::create_dir_all(&base).map_err(|e|e.to_string())?;
    location(game,world,Path::new(&link.folder),&link.namespace)?; // reject symlink swap before writes
    let stamp=SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    let name=format!("world-{stamp}-{}.zip",std::process::id());
    let destination=base.join(&name);
    let stage=base.join(format!(".{name}.partial"));
    let result=(||->Result<(String,u64),String>{
        let output=OpenOptions::new().write(true).create_new(true).open(&stage).map_err(|e|e.to_string())?;
        let mut zip=ZipWriter::new(output);
        for (path,rel,size,_) in &files{
            zip.start_file(rel,SimpleFileOptions::default().compression_method(CompressionMethod::Deflated)
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
    let archive=link.archive.clone();
    save(game,&settings)?;
    Ok(CloudBackup{world:world.to_owned(),archive,sha256,bytes})
}
pub fn restore_as_copy(game:&Path,world:&str)->Result<String,String>{
    let _game_lock=crate::minecraft::acquire_game_run(game)?;
    let settings=load(game)?;
    let link=settings.worlds.get(world).ok_or("Este mundo no tiene nube vinculada")?;
    let base=location(game,world,Path::new(&link.folder),&link.namespace)?;
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
    let prefix=world.chars().take(58).collect::<String>();
    let new_name=format!("{}-restaurado-{}",prefix,now());
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
    #[test] fn stable_backup_folder_survives_instance_moves(){
        let nonce=format!("{}-{}",std::process::id(),now());
        let base=std::env::temp_dir().join(format!("vis-world-cloud-test-{nonce}"));
        let sync=base.join("sync");
        let a=base.join("a");let b=base.join("b");
        fs::create_dir_all(&sync).unwrap();
        fs::create_dir_all(&a).unwrap();
        fs::create_dir_all(&b).unwrap();
        let namespace="0123456789abcdef0123456789abcdef";
        let first=location(&a,"Mundo",&sync,namespace).unwrap();
        let second=location(&b,"Mundo",&sync,namespace).unwrap();
        assert_eq!(first,second,"Cloud backup location must follow the portable instance");
        fs::remove_dir_all(base).unwrap();
    }
    #[cfg(unix)]
    #[test] fn rejects_symlinked_destination(){
        use std::os::unix::fs::symlink;
        let nonce=format!("{}-{}",std::process::id(),now());
        let base=std::env::temp_dir().join(format!("vis-cloud-links-test-{nonce}"));
        let game=base.join("game");let sync=base.join("sync");
        let other=base.join("outside");
        fs::create_dir_all(&game).unwrap();
        fs::create_dir_all(&sync).unwrap();
        fs::create_dir_all(&other).unwrap();
        symlink(&other,sync.join("VIS-Nexo-Worlds")).unwrap();
        assert!(location(&game,"Mundo",&sync,"0123456789abcdef0123456789abcdef").is_err());
        fs::remove_dir_all(base).unwrap();
    }
    #[test] fn rejects_world_path_traversal(){
        assert!(!valid_name("../secrets"));
        assert!(!valid_name("folder\\..\\data"));
        assert!(!valid_name(".vis-restore-test"));
        assert!(valid_name("Mi mundo 1"));
    }
}
