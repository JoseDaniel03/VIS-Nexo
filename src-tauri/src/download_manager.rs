//! VIS Download Manager: one bounded native installation at a time.
//! No background worker, credential persistence or unverified partial reuse.
//! The actual verified file writers remain Minecraft/Temurin/Horizon.
use serde::Serialize;
use std::{sync::{Mutex,OnceLock},time::{SystemTime,UNIX_EPOCH}};
use tauri::{AppHandle,Emitter};

const HISTORY_LIMIT:usize=8;
const CANCEL_MESSAGE:&str="Instalación cancelada desde VIS Nexo";

#[derive(Clone,Debug,Serialize)]
pub struct DownloadJob {
    pub id:u64,
    pub owner:String,
    pub label:String,
    pub stage:String,
    pub detail:String,
    pub completed:u64,
    pub total:u64,
    pub status:String,
    pub cancel_requested:bool,
    pub started_at:u64,
    pub finished_at:Option<u64>,
}
#[derive(Default)]
struct Registry {
    next_id:u64,
    active:Option<DownloadJob>,
    history:Vec<DownloadJob>,
}
static REGISTRY:OnceLock<Mutex<Registry>>=OnceLock::new();
fn registry()->&'static Mutex<Registry>{REGISTRY.get_or_init(||Mutex::new(Registry::default()))}
fn now()->u64{SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()}

pub struct DownloadGuard {
    app:AppHandle,
    id:u64,
    finished:bool,
}
pub fn begin(app:&AppHandle,owner:&str,label:&str)->Result<DownloadGuard,String>{
    if owner.is_empty(){return Err("Iniciá sesión antes de instalar Minecraft".into());}
    let mut state=registry().lock().map_err(|_|"Gestor de descargas bloqueado".to_string())?;
    if state.active.is_some(){
        return Err("Ya hay una instalación en curso. Esperá a que termine o cancelala desde Descargas.".into());
    }
    state.next_id=state.next_id.saturating_add(1);
    let id=state.next_id;
    let job=DownloadJob{
        id,owner:owner.to_owned(),label:label.chars().take(90).collect(),
        stage:"init".into(),detail:"Preparando instalación".into(),
        completed:0,total:0,status:"running".into(),cancel_requested:false,
        started_at:now(),finished_at:None,
    };
    state.active=Some(job.clone());
    drop(state);
    let _=app.emit("vis-download-state",job);
    Ok(DownloadGuard{app:app.clone(),id,finished:false})
}
fn end(app:&AppHandle,id:u64,failed:bool){
    let Ok(mut state)=registry().lock() else{return};
    let Some(mut job)=state.active.take() else{return};
    if job.id!=id {state.active=Some(job);return;}
    let cancelled=job.cancel_requested;
    job.status=if failed&&cancelled{"cancelled"}else if failed{"failed"}else{"completed"}.into();
    job.finished_at=Some(now());
    job.detail=if failed&&cancelled{"Cancelada. Podés reintentar: los archivos verificados existentes se conservan."}
               else if failed{"La instalación terminó con un error. Revisá el aviso del launcher."}
               else{"Instalación completada y archivos verificados."}.into();
    state.history.insert(0,job.clone());
    state.history.truncate(HISTORY_LIMIT);
    drop(state);
    let _=app.emit("vis-download-state",job);
}
impl DownloadGuard {
    pub fn finish<T>(&mut self,result:&Result<T,String>){
        if self.finished{return;}
        self.finished=true;
        end(&self.app,self.id,result.is_err());
    }
}
impl Drop for DownloadGuard {
    fn drop(&mut self){
        if !self.finished{end(&self.app,self.id,true);}
    }
}
pub fn list(owner:&str)->Result<Vec<DownloadJob>,String>{
    let state=registry().lock().map_err(|_|"Gestor de descargas bloqueado".to_string())?;
    let mut results=Vec::new();
    if let Some(active)=state.active.as_ref().filter(|job|job.owner==owner){
        results.push(active.clone());
    }
    results.extend(state.history.iter().filter(|job|job.owner==owner).cloned());
    Ok(results)
}
pub fn cancel(app:&AppHandle,owner:&str,id:u64)->Result<DownloadJob,String>{
    let mut state=registry().lock().map_err(|_|"Gestor de descargas bloqueado".to_string())?;
    let job=state.active.as_mut().filter(|job|job.id==id && job.owner==owner)
        .ok_or("No existe una instalación activa con ese identificador para tu cuenta")?;
    job.cancel_requested=true;
    job.status="cancelling".into();
    job.detail="Cancelando cuando la operación actual alcance un punto seguro…".into();
    let event=job.clone();
    drop(state);
    let _=app.emit("vis-download-state",event.clone());
    Ok(event)
}
pub fn checkpoint()->Result<(),String>{
    let state=registry().lock().map_err(|_|"Gestor de descargas bloqueado".to_string())?;
    if state.active.as_ref().is_some_and(|job|job.cancel_requested){
        Err(CANCEL_MESSAGE.into())
    }else{Ok(())}
}
pub fn progress(app:&AppHandle,stage:&str,completed:usize,total:usize,detail:&str){
    let Ok(mut state)=registry().lock() else{return};
    let Some(job)=state.active.as_mut() else{return};
    job.stage=stage.chars().take(64).collect();
    job.detail=detail.chars().take(180).collect();
    job.completed=completed as u64;
    job.total=total as u64;
    let event=job.clone();
    drop(state);
    let _=app.emit("vis-download-state",event);
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn registry_default_has_no_active_job(){
        let store=Registry::default();
        assert!(store.active.is_none());
        assert!(store.history.is_empty());
    }
    #[test]
    fn history_limit_does_not_capture_external_credentials(){
        assert_eq!(HISTORY_LIMIT,8);
        assert!(!CANCEL_MESSAGE.contains("token"));
    }
}
