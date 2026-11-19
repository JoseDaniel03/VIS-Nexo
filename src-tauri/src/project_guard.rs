//! Políticas de contenido VIS: validación nativa, sin borrar datos del usuario.
//! No es un bloqueo del sistema operativo; cambios externos se detectan si hay sello.
use sha2::{Digest,Sha256};
use std::{collections::BTreeMap,fs,io::Read,path::Path};
use vsui_core::{GameProject,ProjectProtection};
const MAX_FILES:usize=1500;
const MAX_BYTES:u64=512*1024*1024;
const ROOTS:[&str;6]=["mods","resourcepacks","shaderpacks","datapacks","config","defaultconfigs"];
pub fn locked(p:&ProjectProtection,kind:&str)->bool{
    match kind{
        "mod"=>p.lock_mods,"resourcepack"=>p.lock_resourcepacks,
        "shader"=>p.lock_shaderpacks,"datapack"=>p.lock_datapacks,
        "config"=>p.lock_config,_=>false,
    }
}
fn root_locked(p:&ProjectProtection,root:&str)->bool{
    match root{
        "mods"=>p.lock_mods,"resourcepacks"=>p.lock_resourcepacks,
        "shaderpacks"=>p.lock_shaderpacks,"datapacks"=>p.lock_datapacks,
        "config"|"defaultconfigs"=>p.lock_config,_=>false,
    }
}
pub fn has_locked_files(p:&ProjectProtection)->bool{
    ROOTS.iter().any(|name|root_locked(p,name))
}
pub fn validate(p:&ProjectProtection)->Result<(),String>{
    if !p.release_version.is_empty() &&
       (p.release_version=="." || p.release_version==".." ||
         p.release_version.len()>40 || !p.release_version.bytes().all(|b|
           b.is_ascii_alphanumeric()||b"._-".contains(&b))){
        return Err("Versión del proyecto inválida (máximo 40 caracteres, letras, números, . _ -)".into());
    }
    if p.file_hashes.len()>MAX_FILES{return Err("Demasiados archivos protegidos".into());}
    for (path,digest) in &p.file_hashes{
        let parts=path.split('/').collect::<Vec<_>>();
        if parts.len()<2 || parts.iter().any(|x|x.is_empty()||*x=="."||*x==".."||x.len()>255)
           ||path.contains('\\')||path.len()>1024 ||
           path.chars().any(|ch|ch.is_control()||ch==':')
           ||!ROOTS.contains(&parts[0])||!root_locked(p,parts[0])
           ||digest.len()!=64||!digest.bytes().all(|b|b.is_ascii_hexdigit()){
            return Err("Huella SHA-256 o ruta de proyecto inválida".into());
        }
    }
    Ok(())
}
fn scan(base:&Path,current:&Path,hashes:&mut BTreeMap<String,String>,total:&mut u64)->Result<(),String>{
    let metadata=fs::symlink_metadata(current).map_err(|e|e.to_string())?;
    if metadata.file_type().is_symlink(){return Err("Enlace simbólico dentro de recurso protegido".into());}
    if metadata.is_dir(){
        for entry in fs::read_dir(current).map_err(|e|e.to_string())? {
            scan(base,&entry.map_err(|e|e.to_string())?.path(),hashes,total)?;
        }
    }else if metadata.is_file(){
        if metadata.len()>150*1024*1024{return Err("Archivo protegido demasiado grande".into());}
        *total=total.checked_add(metadata.len()).ok_or("Tamaño no válido")?;
        if *total>MAX_BYTES || hashes.len()>=MAX_FILES {return Err("Superado límite de verificación".into());}
        let relative=current.strip_prefix(base).map_err(|_|"Ruta externa a la instancia")?;
        let path=relative.to_str().ok_or("Ruta no UTF-8")?.replace('\\',"/");
        let mut input=fs::File::open(current).map_err(|e|e.to_string())?;
        let mut hash=Sha256::new();let mut buf=[0u8;65536];
        loop{let read=input.read(&mut buf).map_err(|e|e.to_string())?;if read==0{break;}hash.update(&buf[..read]);}
        hashes.insert(path,format!("{:x}",hash.finalize()));
    }else{return Err("Tipo de archivo protegido no permitido".into());}
    Ok(())
}
pub fn snapshot(dir:&Path,p:&ProjectProtection)->Result<BTreeMap<String,String>,String>{
    if !dir.is_dir(){return Err("Primero instalá el proyecto para sellarlo".into());}
    let mut hashes=BTreeMap::new();let mut total=0u64;
    for root in ROOTS{
        if !root_locked(p,root){continue;}
        let path=dir.join(root);
        match fs::symlink_metadata(&path){
            Ok(meta)=>{
                if meta.file_type().is_symlink()||!meta.is_dir(){return Err(format!("Carpeta {root} no segura"));}
                scan(dir,&path,&mut hashes,&mut total)?;
            }
            Err(e) if e.kind()==std::io::ErrorKind::NotFound=>{},
            Err(e)=>return Err(e.to_string()),
        }
    }
    let draft=ProjectProtection{file_hashes:hashes.clone(),..p.clone()};
    validate(&draft)?;
    Ok(hashes)
}
pub fn verify(dir:&Path,project:&GameProject,engine:&str,version:&str,
    loader:&str,loader_version:&str)->Result<usize,String>{
    let p=&project.protection;
    validate(p)?;
    if p.lock_version &&
       (project.engine!=engine||project.mc_version!=version
        ||project.loader!=loader||project.loader_version!=loader_version){
        return Err("La instancia no coincide con el motor, Minecraft o loader fijado por el proyecto".into());
    }
    if !p.verify_on_launch || !has_locked_files(p){return Ok(0);}
    if !p.sealed{
        return Err("El proyecto protegido todavía no tiene sello oficial. VIS Studios debe sellar su instancia".into());
    }
    let actual=snapshot(dir,p)?;
    if actual!=p.file_hashes{
        return Err("Integridad fallida: se agregaron, quitaron o modificaron archivos protegidos. VIS no borró nada; instalá la versión oficial".into());
    }
    Ok(actual.len())
}
#[cfg(test)]mod tests{
 use super::*;
 #[test]fn path_and_policy(){
   let mut p=ProjectProtection::default();p.lock_mods=true;
   p.file_hashes.insert("mods/../saves/a".into(),"a".repeat(64));
   assert!(validate(&p).is_err());
   p.file_hashes.clear();
   p.release_version="..".into();
   assert!(validate(&p).is_err(),"No se permite una release llamada ..");
 }
 #[test]fn detects_tampering(){
   let dir=std::env::temp_dir().join(format!("vis-policy-test-{}",std::process::id()));
   let _=fs::remove_dir_all(&dir);
   fs::create_dir_all(dir.join("mods")).unwrap();
   fs::write(dir.join("mods/a.jar"),b"allowed").unwrap();
   let mut project=GameProject::default();
   project.protection.lock_mods=true;
   project.protection.verify_on_launch=true;
   project.protection.file_hashes=snapshot(&dir,&project.protection).unwrap();
   project.protection.sealed=true;
   assert_eq!(verify(&dir,&project,"java","","vanilla","").unwrap(),1);
   fs::write(dir.join("mods/a.jar"),b"tampered").unwrap();
   assert!(verify(&dir,&project,"java","","vanilla","").is_err());
   let _=fs::remove_dir_all(&dir);
 }
}
