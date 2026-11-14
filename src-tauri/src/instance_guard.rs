//! Validate instance destinations before a download or game launch.
//! Every VIS edition must stay independent from the OS-level .minecraft.
//! Normalize missing directories through the nearest existing ancestor so
//! symlink aliases cannot make two instances silently overlap.
use std::{ffi::OsStr,fs,path::{Component,Path,PathBuf}};

pub fn destination(path:&Path)->Result<PathBuf,String>{
    if !path.is_absolute() {return Err("La carpeta de la instancia debe ser absoluta".into());}
    if path.to_string_lossy().len()>2048 {return Err("Ruta de instancia demasiado larga".into());}
    let mut count=0usize;
    for component in path.components(){
        match component {
            Component::Normal(seg)=>{
                count+=1;
                if seg.to_string_lossy().eq_ignore_ascii_case(".minecraft"){
                    return Err("No se puede instalar dentro de .minecraft global. Elegí otra carpeta.".into());
                }
            }
            Component::ParentDir|Component::CurDir=>
                return Err("Evitá componentes . o .. en la ruta de instalación".into()),
            Component::RootDir|Component::Prefix(_)=>{},
        }
    }
    if count<2 {return Err("Elegí una subcarpeta exclusiva, no la raíz del disco o del usuario".into());}
    // Check directory when it exists (never accept a file as an instance root).
    if path.exists() && !path.is_dir() {
        return Err("La ruta indicada pertenece a un archivo, no a una carpeta".into());
    }
    // Resolve symlinks even when the final folders are not created yet.
    let mut existing=path;
    let mut pending:Vec<&OsStr>=Vec::new();
    while !existing.exists(){
        let name=existing.file_name().ok_or("Ruta de instancia inválida")?;
        pending.push(name);
        existing=existing.parent().ok_or("Ruta sin directorio padre")?;
    }
    let mut resolved=fs::canonicalize(existing).map_err(|e|format!("No se pudo verificar la carpeta: {e}"))?;
    for name in pending.iter().rev(){resolved.push(name);}
    // Canonicalized links can enter ~/.minecraft even when the user selected
    // an innocuous-looking symlink as the destination.
    if resolved.components().any(|c|matches!(c,Component::Normal(s)
        if s.to_string_lossy().eq_ignore_ascii_case(".minecraft"))) {
        return Err("La ruta resuelta apunta a una carpeta global .minecraft".into());
    }
    Ok(resolved)
}

/// The player chooses a *library root*. VIS then creates
/// <root>/Instancias/<name> for new instances, without touching existing
/// instances whose absolute paths were already saved in older versions.
pub fn managed_child(library:&Path,name:&str)->Result<PathBuf,String>{
    let trimmed=name.trim();
    if trimmed.is_empty() || trimmed.chars().count()>60{
        return Err("Elegí un nombre de instancia de hasta 60 caracteres".into());
    }
    let mut slug=String::new();
    for character in trimmed.chars(){
        if character.is_alphanumeric(){
            slug.extend(character.to_lowercase());
        }else if (character.is_whitespace() || character=='-' || character=='_')
            && !slug.ends_with('-') && !slug.is_empty(){
            slug.push('-');
        }
        if slug.chars().count()>=48{break;}
    }
    let mut slug=slug.trim_matches('-').to_owned();
    if slug.is_empty(){return Err("El nombre no tiene letras ni números válidos".into());}
    if ["con","prn","aux","nul","com1","com2","lpt1","lpt2"].contains(&slug.as_str()){
        slug=format!("vis-{slug}");
    }
    let target=library.join("Instancias").join(slug);
    destination(&target)
}

/// Validate destructive deletion of an owned VIS instance. Legacy paths are
/// accepted only when a real installation marker exists; arbitrary user
/// folders (including the launcher data root) must NEVER be erased.
pub fn deletion_target(path:&Path, name:&str, project_id:&str, launcher_root:&Path)->Result<PathBuf,String>{
    let target=destination(path)?;
    let data_root=destination(launcher_root)?;
    if data_root.starts_with(&target) {
        return Err("La ruta abarca datos del launcher o carpetas superiores; no se eliminará".into());
    }
    match fs::symlink_metadata(&target) {
        Err(e) if e.kind()==std::io::ErrorKind::NotFound=>return Ok(target),
        Err(e)=>return Err(format!("No se pudo comprobar la instancia: {e}")),
        Ok(meta) if meta.file_type().is_symlink() || !meta.is_dir()=>
            return Err("La ruta de la instancia no es una carpeta real segura".into()),
        Ok(_)=>{}
    }
    let marker=target.join(".vis/instance.json");
    if marker.exists(){
        private_paths(&target,&[".vis/instance.json"])?;
        let raw=fs::read(&marker).map_err(|e|format!("No se pudo verificar la instalación VIS: {e}"))?;
        if raw.len()>64*1024{return Err("Marcador VIS demasiado grande".into());}
        let value:serde_json::Value=serde_json::from_slice(&raw)
            .map_err(|_|"Marcador VIS inválido; no se borrarán archivos".to_owned())?;
        if value["name"].as_str()!=Some(name)||value["project_id"].as_str()!=Some(project_id) {
            return Err("El marcador VIS pertenece a otra instancia; se conservaron los archivos".into());
        }
        if let Some(saved)=value["game_dir"].as_str().filter(|s|!s.is_empty()){
            if destination(Path::new(saved))?!=target {
                return Err("La carpeta no coincide con el marcador de instalación VIS".into());
            }
        }
        return Ok(target);
    }
    // Old pre-instance.json installations: still require a VIS-specific marker
    // and an explicitly saved instance in the authenticated user's library.
    for legacy in [".vslauncher/install.json",".vis/horizon.json"] {
        let mark=target.join(legacy);
        if mark.exists(){
            private_paths(&target,&[legacy])?;
            let meta=fs::symlink_metadata(&mark).map_err(|e|e.to_string())?;
            if meta.is_file()&&meta.len()>0&&meta.len()<=64*1024 {
                return Ok(target);
            }
        }
    }
    if fs::read_dir(&target).map_err(|e|e.to_string())?.next().is_none(){
        return Ok(target);
    }
    Err("No hay marcador VIS verificable. Podés quitar la instancia sin borrar archivos o reparar su instalación antes de reintentar.".into())
}

/// Protect every parent of a game-owned path from symlink redirection.
/// A symlink to the global .minecraft hidden inside .vis/runtime is still an
/// external dependency, even if the instance root itself was checked.
pub fn private_paths(root:&Path, relatives:&[&str])->Result<(),String>{
    for relative in relatives {
        let mut current=root.to_path_buf();
        for component in Path::new(relative).components(){
            let Component::Normal(segment)=component else {
                return Err("Ruta interna VIS inválida".into());
            };
            current.push(segment);
            match fs::symlink_metadata(&current){
                Ok(meta)=>{
                    if meta.file_type().is_symlink() {
                        return Err(format!("La carpeta interna {} es un enlace simbólico; usá una copia local",current.display()));
                    }
                    if !meta.is_dir() && current!=root.join(relative){
                        return Err("Un archivo ocupa una carpeta de sistema de la instancia".into());
                    }
                }
                Err(error) if error.kind()==std::io::ErrorKind::NotFound=>{},
                Err(error)=>return Err(format!("No se pudo comprobar la carpeta interna: {error}")),
            }
        }
    }
    Ok(())
}

pub fn independent(a:&Path,b:&Path)->Result<(),String>{
    let a=destination(a)?;
    let b=destination(b)?;
    if a==b||a.starts_with(&b)||b.starts_with(&a){
        Err("Esta carpeta se superpone con otra instancia. Elegí carpetas independientes.".into())
    }else{Ok(())}
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn deletes_legacy_owned_folder_but_never_unknown_data(){
        let base=std::env::temp_dir().join(format!("vis-delete-{}-{}",std::process::id(),"safe"));
        let _=fs::remove_dir_all(&base);
        let launcher=base.join("launcher-data");
        let old=base.join("old-games").join("Horizon");
        fs::create_dir_all(old.join(".vslauncher")).unwrap();
        fs::create_dir_all(&launcher).unwrap();
        fs::write(old.join(".vslauncher/install.json"),b"{\"version\":\"26.3\"}").unwrap();
        assert_eq!(deletion_target(&old,"Horizon","project",&launcher).unwrap(),old);
        let unknown=base.join("Downloads/data");
        fs::create_dir_all(&unknown).unwrap();
        fs::write(unknown.join("personal.txt"),b"keep me").unwrap();
        assert!(deletion_target(&unknown,"Data","other",&launcher).is_err());
        assert!(deletion_target(&base,"Root","other",&launcher).is_err());
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn validates_new_marker_identity_before_erasing(){
        let base=std::env::temp_dir().join(format!("vis-delete-marker-{}",std::process::id()));
        let _=fs::remove_dir_all(&base);
        let target=base.join("games/my-world");
        let launcher=base.join("app-data");
        fs::create_dir_all(target.join(".vis")).unwrap();
        fs::create_dir_all(&launcher).unwrap();
        fs::write(target.join(".vis/instance.json"),
            br#"{"name":"My World","project_id":"my-project"}"#).unwrap();
        assert!(deletion_target(&target,"My World","my-project",&launcher).is_ok());
        assert!(deletion_target(&target,"Different","my-project",&launcher).is_err());
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn rejects_global_and_nested_instance_dirs(){
        let home=std::env::temp_dir().join(format!("vis-dest-{}",std::process::id()));
        fs::create_dir_all(&home).unwrap();
        assert!(destination(&home.join("NewProject")).is_ok());
        assert!(destination(&home.join(".minecraft/versions/1.21")).is_err());
        assert!(independent(&home.join("Pack"),&home.join("Pack/save")).is_err());
        assert!(independent(&home.join("Pack"),&home.join("OtherPack")).is_ok());
        let _=fs::remove_dir_all(home);
    }
    #[test]
    fn new_instances_get_independent_named_children(){
        let root=std::env::temp_dir().join(format!("vis-library-test-{}",std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let one=managed_child(&root,"Rust desde VIS").unwrap();
        let two=managed_child(&root,"Minecraft Java").unwrap();
        assert!(one.ends_with("Instancias/rust-desde-vis"));
        assert!(two.ends_with("Instancias/minecraft-java"));
        assert!(independent(&one,&two).is_ok());
        assert!(managed_child(&root,"../").is_err());
        assert!(managed_child(&root,"A/B").is_ok()); // path separators become safe characters
        let _=fs::remove_dir_all(&root);
    }
    #[cfg(unix)]
    #[test]
    fn blocks_symlinked_internal_runtime(){
        use std::os::unix::fs::symlink;
        let root=std::env::temp_dir().join(format!("vis-internal-{}",std::process::id()));
        let _=fs::remove_dir_all(&root);
        fs::create_dir_all(root.join(".vis")).unwrap();
        let outside=root.join("external");
        fs::create_dir_all(&outside).unwrap();
        symlink(&outside,root.join(".vis/runtime")).unwrap();
        assert!(private_paths(&root,&[".vis/runtime/assets"]).is_err());
        fs::remove_dir_all(&root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn blocks_symlink_into_global_minecraft(){
        use std::os::unix::fs::symlink;
        let dir=std::env::temp_dir().join(format!("vis-guard-links-{}",std::process::id()));
        fs::create_dir_all(dir.join(".minecraft")).unwrap();
        symlink(dir.join(".minecraft"),dir.join("hidden")).unwrap();
        assert!(destination(&dir.join("hidden/Client")).is_err());
        let _=fs::remove_dir_all(dir);
    }
}
