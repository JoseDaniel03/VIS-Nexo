//! User-triggered instance backups. Never back up authentication material,
//! game binaries, logs, caches or credentials. No backups are auto-generated.
use std::{fs::{self,File,OpenOptions},io::{self,Read,Write},path::{Component,Path,PathBuf},
    time::{SystemTime,UNIX_EPOCH}};
use serde::Serialize;
use zip::{ZipArchive,ZipWriter,write::FileOptions,CompressionMethod};
const PARTS:&[&str]=&["saves","resourcepacks","shaderpacks","config","mods",
    "servers.dat","options.txt","optionsof.txt"];
const MAX_FILES:usize=40_000;
const MAX_BYTES:u64=16*1024*1024*1024;
const MAX_DEPTH:usize=26;
#[derive(Serialize,Clone)]
pub struct BackupInfo{pub name:String,pub bytes:u64,pub created:u64}
#[derive(Serialize)]
pub struct RestoreInfo{pub restored:usize,pub preserved:usize,pub replaced:usize,pub safety_copy:String}

fn root_dir(game:&Path)->Result<PathBuf,String>{
    if !game.is_dir(){return Err("La instancia no tiene carpeta de datos".into());}
    crate::instance_guard::private_paths(game,&[".vis/backups"])?;
    let folder=game.join(".vis/backups");
    fs::create_dir_all(&folder).map_err(|e|e.to_string())?;
    Ok(folder)
}
fn validate_id(id:&str)->Result<(),String>{
    if !id.starts_with("vis-data-")||!id.ends_with(".zip")||id.len()>85||
        !id.bytes().all(|v|v.is_ascii_alphanumeric()||v==b'-'||v==b'.'){
        return Err("Nombre de copia inválido".into())
    }
    Ok(())
}
fn secs()->u64{SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()}
pub fn list(game:&Path)->Result<Vec<BackupInfo>,String>{
    let dir=root_dir(game)?;
    let mut out=Vec::new();
    for item in fs::read_dir(dir).map_err(|e|e.to_string())?.take(300){
        let item=item.map_err(|e|e.to_string())?;
        let name=item.file_name().to_string_lossy().to_string();
        if validate_id(&name).is_err(){continue;}
        let meta=fs::symlink_metadata(item.path()).map_err(|e|e.to_string())?;
        if meta.file_type().is_symlink()||!meta.is_file(){continue;}
        out.push(BackupInfo{name,bytes:meta.len(),
            created:meta.modified().ok().and_then(|t|t.duration_since(UNIX_EPOCH).ok())
                .map(|v|v.as_secs()).unwrap_or(0)});
    }
    out.sort_by(|a,b|b.created.cmp(&a.created).then(b.name.cmp(&a.name)));
    Ok(out)
}
fn add_tree(writer:&mut ZipWriter<File>,base:&Path,current:&Path,
 count:&mut usize,total:&mut u64,depth:usize)->Result<(),String>{
    if depth>MAX_DEPTH{return Err("Carpetas demasiado anidadas".into());}
    for item in fs::read_dir(current).map_err(|e|e.to_string())?{
        let item=item.map_err(|e|e.to_string())?;
        let meta=fs::symlink_metadata(item.path()).map_err(|e|e.to_string())?;
        if meta.file_type().is_symlink(){return Err("No se respaldan enlaces simbólicos".into());}
        let rel=item.path().strip_prefix(base).map_err(|e|e.to_string())?.to_path_buf();
        let name=rel.to_string_lossy().replace('\\',"/");
        if meta.is_dir(){
            add_tree(writer,base,&item.path(),count,total,depth+1)?;
        }else if meta.is_file(){
            *count+=1;*total=total.checked_add(meta.len())
                .ok_or("El tamaño de copia excede el límite")?;
            if *count>MAX_FILES||*total>MAX_BYTES{
                return Err("Copia demasiado grande: máximo 40.000 archivos / 16 GiB".into());
            }
            let options=FileOptions::default().compression_method(CompressionMethod::Deflated)
                .unix_permissions(0o600);
            writer.start_file(name,options).map_err(|e|e.to_string())?;
            let mut reader=File::open(item.path()).map_err(|e|e.to_string())?;
            io::copy(&mut reader,writer).map_err(|e|e.to_string())?;
        }
    }
    Ok(())
}
pub fn create(game:&Path)->Result<BackupInfo,String>{
    crate::minecraft::prepare_player_directory(game)?;
    let _locked=crate::minecraft::acquire_game_run(game)?;
    let backups=root_dir(game)?;
    let stamp=secs();
    let id=format!("vis-data-{stamp}-{}.zip",std::process::id());
    validate_id(&id)?;
    let target=backups.join(&id);
    if target.exists(){return Err("Ya existe una copia con este identificador".into());}
    let partial=backups.join(format!("{id}.partial"));
    let result=(||{
        let file=OpenOptions::new().write(true).create_new(true).open(&partial)
            .map_err(|e|e.to_string())?;
        let mut zip=ZipWriter::new(file);
        let mut count=0;let mut total=0;
        for part in PARTS{
            let path=game.join(part);
            if !path.exists(){continue;}
            let kind=fs::symlink_metadata(&path).map_err(|e|e.to_string())?;
            if kind.file_type().is_symlink(){return Err("La instancia contiene enlaces simbólicos".into());}
            if kind.is_dir(){add_tree(&mut zip,game,&path,&mut count,&mut total,0)?;}
            else if kind.is_file(){
                count+=1;total+=kind.len();
                if count>MAX_FILES||total>MAX_BYTES{return Err("Copia demasiado grande".into())}
                zip.start_file(*part,FileOptions::default().compression_method(CompressionMethod::Deflated))
                    .map_err(|e|e.to_string())?;
                io::copy(&mut File::open(path).map_err(|e|e.to_string())?,&mut zip)
                    .map_err(|e|e.to_string())?;
            }
        }
        let end=zip.finish().map_err(|e|e.to_string())?;
        end.sync_all().map_err(|e|e.to_string())?;
        fs::rename(&partial,&target).map_err(|e|e.to_string())?;
        let meta=fs::metadata(target).map_err(|e|e.to_string())?;
        Ok(BackupInfo{name:id,bytes:meta.len(),created:stamp})
    })();
    if result.is_err(){let _=fs::remove_file(partial);}
    result
}
fn valid_member(name:&str)->Result<PathBuf,String>{
    if name.contains('\\')||name.starts_with('/')||name.len()>4096{
        return Err("Archivo de copia con ruta inválida".into());
    }
    let path=Path::new(name);
    let first=path.components().next();
    if !matches!(first,Some(Component::Normal(_)))||
        path.components().any(|c|!matches!(c,Component::Normal(_))){
        return Err("Ruta insegura dentro de la copia".into());
    }
    let section=path.components().next()
        .and_then(|c|c.as_os_str().to_str()).unwrap_or("");
    if !PARTS.contains(&section){return Err("La copia contiene archivos no permitidos".into());}
    if ["servers.dat","options.txt","optionsof.txt"].contains(&section)
        &&path.components().count()!=1 {
        return Err("Ruta de ajuste inválida".into());
    }
    if path.components().count()>MAX_DEPTH+2{return Err("Ruta de copia demasiado profunda".into())}
    Ok(path.to_path_buf())
}
fn merge_restored_files(
    stage:&Path,game:&Path,rollback:&Path,current:&Path,replace:bool,
    restored:&mut usize,preserved:&mut usize,replaced:&mut usize,depth:usize,
    applied:&mut Vec<(PathBuf,Option<PathBuf>)>
)->Result<(),String>{
    if depth>MAX_DEPTH{return Err("Restauración con carpetas demasiado profundas".into());}
    for entry in fs::read_dir(current).map_err(|e|e.to_string())?{
        let entry=entry.map_err(|e|e.to_string())?;
        let relative=entry.path().strip_prefix(stage).map_err(|e|e.to_string())?.to_path_buf();
        let target=game.join(&relative);
        let kind=entry.file_type().map_err(|e|e.to_string())?;
        if kind.is_dir(){
            crate::instance_guard::private_paths(game,&[relative.to_string_lossy().as_ref()])?;
            fs::create_dir_all(&target).map_err(|e|e.to_string())?;
            merge_restored_files(stage,game,rollback,&entry.path(),replace,
                restored,preserved,replaced,depth+1,applied)?;
        } else if kind.is_file(){
            crate::instance_guard::private_paths(game,&[relative.to_string_lossy().as_ref()])?;
            if let Some(parent)=target.parent(){fs::create_dir_all(parent).map_err(|e|e.to_string())?;}
            if target.exists(){
                if !replace{*preserved+=1;continue;}
                let prev=rollback.join(&relative);
                if let Some(parent)=prev.parent(){fs::create_dir_all(parent).map_err(|e|e.to_string())?;}
                fs::rename(&target,&prev).map_err(|e|e.to_string())?;
                *replaced+=1;
                if let Err(e)=fs::rename(entry.path(),&target){
                    let _=fs::rename(&prev,&target);
                    return Err(format!("No se pudo restaurar archivo: {e}"));
                }
                applied.push((target,Some(prev)));
            }else{
                fs::rename(entry.path(),&target).map_err(|e|e.to_string())?;
                applied.push((target,None));
            }
            *restored+=1;
        }else{
            return Err("Archivo de respaldo inesperado".into());
        }
    }
    Ok(())
}
// Reverse the files successfully installed before any I/O error. Originals
// are moved back from rollback; if that fails we preserve the rollback folder
// and expose a path for manual recovery instead of deleting evidence.
fn revert_applied(applied:&[(PathBuf,Option<PathBuf>)])->Result<(),String>{
    let mut errors=Vec::new();
    for (target,original) in applied.iter().rev(){
        match fs::symlink_metadata(target) {
            Ok(meta) if meta.is_file()||meta.file_type().is_symlink()=>{
                if let Err(e)=fs::remove_file(target){
                    errors.push(format!("{}: {e}",target.display()));
                    continue;
                }
            }
            Ok(_)=>{
                errors.push(format!("{} no es un archivo seguro",target.display()));
                continue;
            }
            Err(e) if e.kind()==std::io::ErrorKind::NotFound=>{}
            Err(e)=>{
                errors.push(format!("{}: {e}",target.display()));
                continue;
            }
        }
        if let Some(previous)=original {
            if let Err(e)=fs::rename(previous,target){
                errors.push(format!("{}: {e}",previous.display()));
            }
        }
    }
    if errors.is_empty(){Ok(())}else{Err(errors.join("; "))}
}
/// Preview and extraction support archives created by VIS only. Restore never
/// deletes a world. In replace mode old data is moved into a rollback directory.
pub fn restore(game:&Path,id:&str,replace:bool)->Result<RestoreInfo,String>{
    validate_id(id)?;
    crate::minecraft::prepare_player_directory(game)?;
    let _locked=crate::minecraft::acquire_game_run(game)?;
    let backups=root_dir(game)?;
    let archive_path=backups.join(id);
    let meta=fs::symlink_metadata(&archive_path).map_err(|_|"No existe esta copia".to_string())?;
    if meta.file_type().is_symlink()||!meta.is_file()||meta.len()>MAX_BYTES{
        return Err("Copia inexistente o insegura".into());
    }
    let mut archive=ZipArchive::new(File::open(&archive_path).map_err(|e|e.to_string())?)
        .map_err(|_|"ZIP de respaldo inválido".to_string())?;
    if archive.len()>MAX_FILES{return Err("Copia con demasiados archivos".into());}
    // Validate the entire archive before writing any world files.
    let mut total=0u64;
    let mut seen=std::collections::BTreeSet::new();
    for i in 0..archive.len(){
        let entry=archive.by_index(i).map_err(|e|e.to_string())?;
        let rel=valid_member(entry.name())?;
        total=total.checked_add(entry.size()).ok_or("Tamaño inválido")?;
        if total>MAX_BYTES{return Err("Copia ZIP excede 16 GiB descomprimida".into());}
        if let Some(mode)=entry.unix_mode(){
            if mode&0o170000==0o120000{return Err("ZIP contiene enlace simbólico".into());}
        }
        if !seen.insert(rel){return Err("ZIP contiene una ruta repetida".into());}
    }
    let stage=backups.join(format!(".restore-{}-{}",secs(),std::process::id()));
    let rollback=backups.join(format!(".rollback-{}-{}",secs(),std::process::id()));
    if stage.exists()||rollback.exists(){return Err("Ya hay una restauración pendiente".into());}
    fs::create_dir(&stage).map_err(|e|e.to_string())?;
    let mut restored=0;let mut preserved=0;let mut replaced=0;
    let mut applied=Vec::new();
    let result=(||{
        for i in 0..archive.len(){
            let mut entry=archive.by_index(i).map_err(|e|e.to_string())?;
            let rel=valid_member(entry.name())?;
            let path=stage.join(rel);
            if entry.is_dir(){
                fs::create_dir_all(path).map_err(|e|e.to_string())?;
            }else {
                if let Some(parent)=path.parent(){
                    fs::create_dir_all(parent).map_err(|e|e.to_string())?;
                }
                let mut file=OpenOptions::new().write(true).create_new(true).open(path)
                    .map_err(|e|e.to_string())?;
                io::copy(&mut entry,&mut file).map_err(|e|e.to_string())?;
            }
        }
        // Merge each file, not the directory: prepare_player_directory already
        // created saves/ and resourcepacks/, so directory-level skipping would
        // incorrectly restore nothing on a fresh instance.
        merge_restored_files(&stage,game,&rollback,&stage,replace,
            &mut restored,&mut preserved,&mut replaced,0,&mut applied)?;
        Ok(RestoreInfo{restored,preserved,replaced,
            safety_copy:if replaced>0{rollback.to_string_lossy().to_string()}else{String::new()}})
    })();
    if let Err(ref cause)=result {
        let recovery=revert_applied(&applied);
        let _=fs::remove_dir_all(&stage);
        return match recovery {
            Ok(())=>Err(format!("Restauración interrumpida: {cause}. Los archivos modificados se revirtieron.")),
            Err(err)=>Err(format!(
                "Restauración interrumpida: {cause}. Recuperación incompleta: {err}. Originales en {}",
                rollback.display()
            ))
        };
    }
    let _=fs::remove_dir_all(&stage);
    result
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test] fn backup_restore_keeps_files_and_original_rollback(){
        let root=std::env::temp_dir().join(format!("vis-backup-roundtrip-{}",std::process::id()));
        let _=fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("saves/My World")).unwrap();
        fs::write(root.join("saves/My World/level.dat"),b"first world").unwrap();
        fs::write(root.join("servers.dat"),b"old servers").unwrap();
        let backup=create(&root).unwrap();
        assert_eq!(list(&root).unwrap().len(),1);
        fs::write(root.join("saves/My World/level.dat"),b"later world").unwrap();
        let nonreplace=restore(&root,&backup.name,false).unwrap();
        assert_eq!(nonreplace.restored,0);
        assert!(nonreplace.preserved>0);
        assert_eq!(fs::read(root.join("saves/My World/level.dat")).unwrap(),b"later world");
        let replace=restore(&root,&backup.name,true).unwrap();
        assert!(replace.replaced>0);
        assert_eq!(fs::read(root.join("saves/My World/level.dat")).unwrap(),b"first world");
        assert!(Path::new(&replace.safety_copy).join("saves/My World/level.dat").is_file());
        assert_eq!(fs::read(Path::new(&replace.safety_copy).join("saves/My World/level.dat")).unwrap(),b"later world");
        let _=fs::remove_dir_all(root);
    }
    #[test] fn reverts_completed_file_replacements_on_failure(){
        let root=std::env::temp_dir().join(format!("vis-rollback-revert-{}",std::process::id()));
        let _=fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("original")).unwrap();
        fs::create_dir_all(root.join("live")).unwrap();
        let previous=root.join("original/world.dat");
        let live=root.join("live/world.dat");
        let added=root.join("live/new.dat");
        fs::write(&previous,b"saved").unwrap();
        fs::write(&live,b"new").unwrap();
        fs::write(&added,b"extra").unwrap();
        revert_applied(&[(live.clone(),Some(previous.clone())),(added.clone(),None)]).unwrap();
        assert_eq!(fs::read(&live).unwrap(),b"saved");
        assert!(!added.exists());
        assert!(!previous.exists());
        fs::remove_dir_all(root).unwrap();
    }
    #[test] fn rejects_zip_slip_and_unsafe_categories(){
        assert!(valid_member("../passwd").is_err());
        assert!(valid_member("/etc/passwd").is_err());
        assert!(valid_member("saves/../secrets").is_err());
        assert!(valid_member("saves/world/level.dat").is_ok());
        assert!(valid_member("auth/token").is_err());
        assert!(valid_member("servers.dat/other").is_err());
    }
}