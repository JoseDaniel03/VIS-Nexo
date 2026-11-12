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
    fn rejects_global_and_nested_instance_dirs(){
        let home=std::env::temp_dir().join(format!("vis-dest-{}",std::process::id()));
        fs::create_dir_all(&home).unwrap();
        assert!(destination(&home.join("NewProject")).is_ok());
        assert!(destination(&home.join(".minecraft/versions/1.21")).is_err());
        assert!(independent(&home.join("Pack"),&home.join("Pack/save")).is_err());
        assert!(independent(&home.join("Pack"),&home.join("OtherPack")).is_ok());
        let _=fs::remove_dir_all(home);
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
