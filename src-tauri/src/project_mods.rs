//! Project-owned Modrinth set, independent from player-installed mods.
//! Mojang/Fabric runtime and saves remain in the instance, never AppData.
//! A project update only moves files previously placed by this updater.
use crate::{accounts::{atomic_json,Instance}, minecraft};
use serde::{Deserialize,Serialize};
use sha1::{Digest,Sha1};
use std::{
    collections::{BTreeMap,BTreeSet},
    fs::{self,File},
    io::Read,
    path::{Path,PathBuf},
    time::{SystemTime,UNIX_EPOCH},
};

#[derive(Debug,Clone,Serialize,Deserialize)]
struct ManagedFile { name:String, sha1:String, size:u64 }
#[derive(Debug,Default,Clone,Serialize,Deserialize)]
#[serde(default)]
struct ManagedState {
    project_id:String,
    mc_version:String,
    loader:String,
    selected_ids:Vec<String>,
    files:Vec<ManagedFile>,
}
#[derive(Debug,Clone,Serialize)]
pub struct SyncReport {
    pub added:usize,
    pub retired:usize,
    pub protected:usize,
    pub unchanged:bool,
}

fn manifest(dir:&Path)->PathBuf {dir.join(".vslauncher/project-mods.json")}
fn clean_name(s:&str)->bool {
    !s.is_empty() && s.len()<=200 && s.ends_with(".jar")
        && s!="." && s!=".." && !s.contains('/') && !s.contains('\\')
        && !s.contains('\0') && !s.ends_with(".disabled")
}
fn validate_ids(ids:&[String])->Result<(),String>{
    if ids.len()>32 {return Err("Máximo 32 mods por proyecto".into());}
    let mut unique=BTreeSet::new();
    for id in ids {
        if !(3..=64).contains(&id.len()) ||
            !id.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-'||b==b'_') ||
            !unique.insert(id.to_ascii_lowercase()) {
            return Err("ID Modrinth inválido o duplicado".into());
        }
    }
    Ok(())
}
fn normal_file(path:&Path)->Result<Option<u64>,String>{
    match fs::symlink_metadata(path){
        Ok(m) if !m.file_type().is_file() || m.file_type().is_symlink() =>
            Err("Un mod no puede ser enlace simbólico ni carpeta".into()),
        Ok(m)=>Ok(Some(m.len())),
        Err(e) if e.kind()==std::io::ErrorKind::NotFound=>Ok(None),
        Err(e)=>Err(e.to_string())
    }
}
fn fingerprint(path:&Path)->Result<(String,u64),String>{
    let mut file=File::open(path).map_err(|e|e.to_string())?;
    let mut buffer=[0u8;65536];let mut hash=Sha1::new();let mut size=0u64;
    loop {
        let n=file.read(&mut buffer).map_err(|e|e.to_string())?;
        if n==0 {break;}
        size=size.saturating_add(n as u64);
        if size>150*1024*1024 {return Err("Mod superior a 150 MB".into());}
        hash.update(&buffer[..n]);
    }
    Ok((format!("{:x}",hash.finalize()),size))
}
fn load(dir:&Path,project_id:&str)->Result<ManagedState,String>{
    let path=manifest(dir);
    if !path.exists() {return Ok(ManagedState::default());}
    let state:ManagedState=serde_json::from_slice(&fs::read(path).map_err(|e|e.to_string())?)
        .map_err(|_|"Manifiesto de mods dañado. Reparalo manualmente antes de continuar")?;
    if state.project_id!=project_id || state.files.len()>64 ||
       state.files.iter().any(|f| !clean_name(&f.name) ||
           f.sha1.len()!=40 || !f.sha1.bytes().all(|b|b.is_ascii_hexdigit())) {
        return Err("Manifiesto de mods no pertenece a esta instancia o está dañado".into());
    }
    Ok(state)
}
fn current(dir:&Path,ins:&Instance,ids:&[String],state:&ManagedState)->bool {
    state.project_id==ins.project_id &&
    state.mc_version==ins.version && state.loader==ins.loader &&
    state.selected_ids==ids &&
    state.files.iter().all(|file|{
        normal_file(&dir.join("mods").join(&file.name))
            .ok().flatten().is_some_and(|size|size==file.size)
    })
}
fn timestamp()->u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos()
}

/// Compare a desired project mod set against exactly one user-owned instance.
/// If a manually imported file collides, stop instead of overwriting it.
/// Replaced/removed managed mods are archived under .vslauncher/retired-mods.
pub fn sync(root:&Path,username:&str,ins:&Instance,ids:&[String])
    -> Result<SyncReport,String>
{
    validate_ids(ids)?;
    if ins.engine!="java" || (ins.loader!="fabric" && !ids.is_empty()) {
        return if ids.is_empty() {Ok(SyncReport{added:0,retired:0,protected:0,unchanged:true})}
            else {Err("Los mods de proyecto requieren Java con Fabric".into())};
    }
    let dir=minecraft::instance_dir(root,username,ins)?;
    if !minecraft::installed(&dir,ins) {
        return Err("Instalá/Repará primero la base completa de Minecraft".into());
    }
    let previous=load(&dir,&ins.project_id)?;
    if current(&dir,ins,ids,&previous) {
        return Ok(SyncReport{added:0,retired:0,protected:0,unchanged:true});
    }
    let metadata=dir.join(".vslauncher");
    fs::create_dir_all(&metadata).map_err(|e|e.to_string())?;
    let stage=metadata.join(format!("project-mods-stage-{}-{}",std::process::id(),timestamp()));
    fs::create_dir(&stage).map_err(|e|e.to_string())?;

    let result=(||->Result<SyncReport,String>{
        // All Modrinth downloads and transitive dependencies happen in an
        // isolated staging game directory. No live mods are touched yet.
        let mut staged=ins.clone();
        staged.game_dir=stage.to_string_lossy().into_owned();
        let mut staged_seen=BTreeMap::new();
        for id in ids {
            let filenames=minecraft::install_modrinth(root,username,&staged,id,"mod")?;
            for name in filenames {
                if !clean_name(&name){return Err("Archivo de Modrinth inválido".into());}
                let (hash,_) = fingerprint(&stage.join("mods").join(&name))?;
                if let Some(earlier)=staged_seen.insert(name.clone(),hash.clone()){
                    if earlier!=hash {return Err(format!("Mods incompatibles intentan sustituir {name}"));}
                }
            }
        }
        let mut desired=BTreeMap::new();
        for name in staged_seen.keys(){
            let path=stage.join("mods").join(name);
            let (sha1,size)=fingerprint(&path)?;
            desired.insert(name.clone(),ManagedFile{name:name.clone(),sha1,size});
        }
        let old:BTreeMap<String,ManagedFile>=previous.files.iter()
            .map(|f|(f.name.clone(),f.clone())).collect();
        let live=dir.join("mods");
        fs::create_dir_all(&live).map_err(|e|e.to_string())?;
        let mut user_owned=BTreeSet::new();
        let mut edited=BTreeSet::new();
        let mut retire=BTreeSet::new();

        // Preflight *every* destination before applying anything.
        for (name,wanted) in &desired {
            let dst=live.join(name);
            if normal_file(&dst)?.is_none(){continue;}
            let (hash,_) = fingerprint(&dst)?;
            if let Some(managed)=old.get(name){
                if hash!=managed.sha1{
                    return Err(format!("El mod administrado {name} fue editado. No lo sobrescribimos."));
                }
                if hash!=wanted.sha1{retire.insert(name.clone());}
            }else if hash==wanted.sha1 {
                // Player owned identical mod: keep it player-owned.
                user_owned.insert(name.clone());
            }else{
                return Err(format!("Conflicto con tu mod personal {name}. Cambiá ese archivo antes de actualizar."));
            }
        }
        for (name,managed) in &old {
            if desired.get(name).is_some_and(|f|f.sha1==managed.sha1){continue;}
            let dst=live.join(name);
            if normal_file(&dst)?.is_some(){
                let (hash,_) = fingerprint(&dst)?;
                if hash==managed.sha1 {retire.insert(name.clone());}
                else {edited.insert(name.clone());}
            }
        }
        let archive=metadata.join("retired-mods").join(format!("{}-{}",std::process::id(),timestamp()));
        fs::create_dir_all(&archive).map_err(|e|e.to_string())?;
        let mut moved:Vec<(PathBuf,PathBuf)>=Vec::new();
        let mut added:Vec<PathBuf>=Vec::new();
        let apply=(||->Result<ManagedState,String>{
            for name in &retire {
                let src=live.join(name);
                if normal_file(&src)?.is_none(){continue;}
                let dst=archive.join(name);
                fs::rename(&src,&dst).map_err(|e|e.to_string())?;
                moved.push((src,dst));
            }
            let mut tracked=Vec::new();
            for (name,wanted) in &desired {
                let destination=live.join(name);
                if user_owned.contains(name){continue;}
                if normal_file(&destination)?.is_none(){
                    let source=stage.join("mods").join(name);
                    fs::rename(source,&destination).map_err(|e|e.to_string())?;
                    added.push(destination);
                }
                tracked.push(wanted.clone());
            }
            let state=ManagedState{
                project_id:ins.project_id.clone(),mc_version:ins.version.clone(),
                loader:ins.loader.clone(),selected_ids:ids.to_vec(),files:tracked
            };
            atomic_json(&manifest(&dir),&state)?;
            Ok(state)
        })();
        if let Err(error)=apply {
            for file in added.into_iter().rev(){let _=fs::remove_file(file);}
            for (src,dst) in moved.into_iter().rev(){let _=fs::rename(dst,src);}
            return Err(error);
        }
        Ok(SyncReport{
            added:desired.len().saturating_sub(user_owned.len()),
            retired:retire.len(),protected:edited.len()+user_owned.len(),
            unchanged:false
        })
    })();
    // Stage only contains files downloaded for this attempt, never player data.
    let _=fs::remove_dir_all(&stage);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]fn validates_project_mod_ids_and_filenames(){
        assert!(validate_ids(&["P7dR8mSH".into(),"fabric-api".into()]).is_ok());
        assert!(validate_ids(&["../../mod".into()]).is_err());
        assert!(validate_ids(&["abc".into(),"ABC".into()]).is_err());
        assert!(!clean_name("../mod.jar"));
        assert!(!clean_name("evil.jar.disabled"));
        assert!(clean_name("fabric-api-1.0.jar"));
    }
    #[test]fn refuses_to_lose_ownership_metadata(){
        let root=std::env::temp_dir().join(format!("vis-project-metadata-{}-{}",std::process::id(),timestamp()));
        fs::create_dir_all(root.join(".vslauncher")).unwrap();
        fs::write(manifest(&root),b"{broken json").unwrap();
        assert!(load(&root,"project").is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
