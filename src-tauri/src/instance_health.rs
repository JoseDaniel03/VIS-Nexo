//! Read-only instance integrity checks and explicit, non-destructive repairs.
use std::{fs,path::Path};
use serde::Serialize;
#[derive(Serialize)]
pub struct HealthIssue{pub code:String,pub detail:String,pub level:String,pub repairable:bool}
#[derive(Serialize)]
pub struct HealthReport{
    pub exists:bool,pub worlds:usize,pub valid_worlds:usize,
    pub servers_file:bool,pub resource_packs:usize,pub repairable:usize,
    pub issues:Vec<HealthIssue>,
}
const REQUIRED:&[&str]=&["saves","resourcepacks","shaderpacks","mods","config",
    "logs","screenshots",".vis",".vis/cache",".vis/tmp"];
fn issue(report:&mut HealthReport,code:&str,detail:&str,level:&str,repairable:bool){
    if repairable{report.repairable+=1;}
    report.issues.push(HealthIssue{
        code:code.to_owned(),detail:detail.to_owned(),
        level:level.to_owned(),repairable
    });
}
pub fn inspect(game:&Path)->Result<HealthReport,String>{
 let mut result=HealthReport{
    exists:game.exists(),worlds:0,valid_worlds:0,servers_file:false,
    resource_packs:0,repairable:0,issues:Vec::new()
 };
 if !result.exists{
    issue(&mut result,"game-missing","No existe la carpeta de datos de la instancia","warning",true);
    return Ok(result);
 }
 let base=fs::symlink_metadata(game).map_err(|e|e.to_string())?;
 if base.file_type().is_symlink()||!base.is_dir(){
    return Err("La carpeta del juego no es un directorio normal y seguro".into());
 }
 for part in REQUIRED{
    let path=game.join(part);
    match fs::symlink_metadata(&path){
        Ok(meta) if meta.file_type().is_symlink()=>
            issue(&mut result,&format!("unsafe:{part}"),
                "Hay un enlace simbólico. No se modificará automáticamente","danger",false),
        Ok(meta) if !meta.is_dir()=>
            issue(&mut result,&format!("wrong-type:{part}"),
                "Una ruta esperada como carpeta contiene un archivo","danger",false),
        Ok(_)=>{},
        Err(e) if e.kind()==std::io::ErrorKind::NotFound=>
            issue(&mut result,&format!("missing:{part}"),
                &format!("Falta {part}; se puede crear sin borrar datos"),"warning",true),
        Err(e)=>issue(&mut result,&format!("unreadable:{part}"),&e.to_string(),"danger",false),
    }
 }
 // Preserve evidence of a crashed restore. Inspection never modifies data.
 let backups=game.join(".vis/backups");
 match fs::symlink_metadata(&backups){
   Ok(meta) if meta.file_type().is_symlink()||!meta.is_dir()=>{
     issue(&mut result,"unsafe-backup-directory",
         "La carpeta de respaldos no es un directorio seguro","danger",false);
   },
   Ok(_)=>{
     for entry in fs::read_dir(&backups).map_err(|e|e.to_string())?.take(5_000){
       let entry=entry.map_err(|e|e.to_string())?;
       let name=entry.file_name().to_string_lossy().into_owned();
       if name.starts_with(".restore-"){
         issue(&mut result,"interrupted-restore",
             "Existe una restauración pendiente o interrumpida. Revisá .vis/backups y los archivos .rollback-* antes de jugar; VIS no eliminará la evidencia.",
             "danger",false);
         break;
       }
     }
   },
   Err(e) if e.kind()==std::io::ErrorKind::NotFound=>{},
   Err(e)=>issue(&mut result,"unreadable-backups",&e.to_string(),"danger",false),
 }
 let worlds=game.join("saves");
 if fs::symlink_metadata(&worlds).is_ok_and(|m|m.is_dir()&&!m.file_type().is_symlink()){
   for item in fs::read_dir(&worlds).map_err(|e|e.to_string())?.take(2000){
     let item=item.map_err(|e|e.to_string())?;
     let meta=fs::symlink_metadata(item.path()).map_err(|e|e.to_string())?;
     if meta.file_type().is_symlink(){issue(&mut result,"world-link","Un mundo contiene un enlace simbólico","danger",false);continue;}
     if meta.is_dir(){
       result.worlds+=1;
       if item.path().join("level.dat").is_file(){result.valid_worlds+=1;}
       else{issue(&mut result,"world-incomplete",
            &format!("{} no tiene level.dat",item.file_name().to_string_lossy()),"warning",false);}
     }
   }
 }
 let server=game.join("servers.dat");
 if server.exists(){
    let meta=fs::symlink_metadata(server).map_err(|e|e.to_string())?;
    if meta.is_file()&&!meta.file_type().is_symlink(){result.servers_file=true;}
    else {issue(&mut result,"unsafe-servers","servers.dat no es un archivo normal","danger",false);}
 }
 let packs=game.join("resourcepacks");
 if fs::symlink_metadata(&packs).is_ok_and(|m|m.is_dir()&&!m.file_type().is_symlink()){
    for item in fs::read_dir(packs).map_err(|e|e.to_string())?.take(2000){
       let item=item.map_err(|e|e.to_string())?;
       let ty=item.file_type().map_err(|e|e.to_string())?;
       if ty.is_file()||ty.is_dir(){result.resource_packs+=1;}
    }
 }
 Ok(result)
}
pub fn repair_missing(game:&Path)->Result<HealthReport,String>{
 // Never touch/replace a broken or symlinked folder. Only create missing
 // defaults. A running Minecraft game must not be repaired concurrently.
 if !game.exists(){
    crate::instance_guard::destination(game)?;
    fs::create_dir_all(game).map_err(|e|e.to_string())?;
 }
 let _guard=crate::minecraft::acquire_game_run(game)?;
 let before=inspect(game)?;
 if before.issues.iter().any(|i|i.level=="danger"){
    return Err("Hay rutas inseguras: repará manualmente antes de usar reparación automática".into());
 }
 crate::minecraft::prepare_player_directory(game)?;
 inspect(game)
}
#[cfg(test)]
mod tests{
 use super::*;
 #[test]fn detects_incomplete_restore_and_refuses_repair(){
     let dir=std::env::temp_dir().join(format!("vis-health-staged-{}",std::process::id()));
     let _=fs::remove_dir_all(&dir);
     fs::create_dir_all(dir.join(".vis/backups/.restore-crash")).unwrap();
     let report=inspect(&dir).unwrap();
     assert!(report.issues.iter().any(|i|i.code=="interrupted-restore"&&i.level=="danger"));
     assert!(repair_missing(&dir).is_err());
     let _=fs::remove_dir_all(dir);
 }
 #[test]fn audit_and_repair_create_only_missing_default_folders(){
    let dir=std::env::temp_dir().join(format!("vis-health-{}",std::process::id()));
    let _=fs::remove_dir_all(&dir);
    let before=inspect(&dir).unwrap();
    assert!(!before.exists);
    assert!(before.repairable>0);
    let after=repair_missing(&dir).unwrap();
    assert!(after.exists);
    assert!(dir.join("resourcepacks").is_dir());
    assert!(dir.join("saves").is_dir());
    let _=fs::remove_dir_all(dir);
 }
}