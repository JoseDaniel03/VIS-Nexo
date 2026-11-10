//! VIS Nexo: optional, signed Tauri updater. Never installs unsigned downloads.
//! Keep app identifier and app-data path stable across releases.
use serde::Serialize;
use std::{fs, path::Path, time::{SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

#[derive(Serialize)]
pub struct UpdateInfo {
    pub configured: bool,
    pub current_version: String,
    pub available: bool,
    pub version: String,
    pub notes: String,
}
fn manifest_url()->Result<Option<url::Url>,String>{
    let (Some(key),Some(endpoint))=(option_env!("VIS_UPDATER_PUBKEY"),option_env!("VIS_UPDATE_MANIFEST_URL"))
        else{return Ok(None)};
    if key.trim().is_empty(){return Ok(None)}
    let url=url::Url::parse(endpoint).map_err(|e|e.to_string())?;
    if url.scheme()!="https" {return Err("El manifiesto de actualizaciones requiere HTTPS".into())}
    Ok(Some(url))
}
pub fn enabled()->bool{manifest_url().ok().flatten().is_some()}
pub async fn check(app:&AppHandle)->Result<UpdateInfo,String>{
    let version=app.package_info().version.to_string();
    let Some(endpoint)=manifest_url()? else{return Ok(UpdateInfo{configured:false,current_version:version,available:false,version:String::new(),notes:String::new()})};
    let updater=app.updater_builder().endpoints(vec![endpoint]).map_err(|e|e.to_string())?
        .timeout(std::time::Duration::from_secs(18)).build().map_err(|e|e.to_string())?;
    let available=updater.check().await.map_err(|e|format!("No se pudo comprobar la versión: {e}"))?;
    Ok(UpdateInfo{configured:true,current_version:version,available:available.is_some(),
        version:available.as_ref().map(|r|r.version.clone()).unwrap_or_default(),
        notes:available.as_ref().and_then(|r|r.body.clone()).unwrap_or_default()})
}
fn copy_if_exists(source:&Path,target:&Path)->Result<(),String>{
    if source.is_file(){
        if let Some(parent)=target.parent(){fs::create_dir_all(parent).map_err(|e|e.to_string())?;}
        fs::copy(source,target).map_err(|e|e.to_string())?;
    }
    Ok(())
}
/// Preferences backup only; world and downloaded game data are never overwritten by app updater.
fn backup_before_update(app:&AppHandle)->Result<(),String>{
    let root=app.path().app_data_dir().map_err(|e|e.to_string())?;
    let time=SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    let dest=root.join("vis-backups").join(format!("before-update-{time}"));
    fs::create_dir_all(&dest).map_err(|e|e.to_string())?;
    #[cfg(unix)] {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&dest,fs::Permissions::from_mode(0o700)).map_err(|e|e.to_string())?;
    }
    for name in ["launcher.vsui.json","launcher-branding.json","project-execution.json","recent-accounts.json","vis-cloud-config.json"] {
        copy_if_exists(&root.join(name),&dest.join(name))?;
    }
    // Local account profiles (including only their JSON preferences) are preserved by OS app-data path.
    // Sensitive accounts.json is not duplicated into an unencrypted update backup.
    Ok(())
}
pub async fn install(app:&AppHandle)->Result<(),String>{
    let Some(endpoint)=manifest_url()? else{return Err("El canal de actualizaciones no está configurado".into())};
    let updater=app.updater_builder().endpoints(vec![endpoint]).map_err(|e|e.to_string())?
        .timeout(std::time::Duration::from_secs(60)).build().map_err(|e|e.to_string())?;
    let Some(release)=updater.check().await.map_err(|e|e.to_string())? else{return Err("No hay actualizaciones nuevas".into())};
    backup_before_update(app)?;
    let progress_app=app.clone();
    release.download_and_install(move |done,total| {
        let _=progress_app.emit("vis-update-progress",serde_json::json!({"downloaded":done,"total":total}));
    }, || {}).await.map_err(|e|format!("No se pudo instalar la actualización firmada: {e}"))?;
    Ok(())
}
