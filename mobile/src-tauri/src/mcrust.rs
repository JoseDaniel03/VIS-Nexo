//! Nexo-managed installation of the same engine release used by PC.
use super::mcrust_catalog;
use std::sync::atomic::{AtomicBool, Ordering};
static BUSY: AtomicBool = AtomicBool::new(false);
struct DownloadGuard;
impl Drop for DownloadGuard { fn drop(&mut self) { BUSY.store(false, Ordering::Release); } }
use super::*;
#[cfg(target_os = "android")]
#[path = "mcrust_android.rs"]
mod android;

#[tauri::command]
pub(crate) async fn mobile_mcrust_launch(
    state: State<'_, Mutex<Session>>, app: AppHandle, id: String,
) -> Result<Value, String> {
    if BUSY.swap(true, Ordering::AcqRel) { return Err("Ya se está preparando McRust".into()); }
    let _busy = DownloadGuard;
    let (owner, generation) = {
        let session = state.lock().map_err(|_| "Sesión ocupada")?;
        (session.username.clone().filter(|_| session.bearer.is_some())
            .ok_or("Iniciá sesión en VIS Ceibo")?, session.epoch)
    };
    validate_username(&owner)?;
    if id.len() != 32 || !id.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err("Instancia Android inválida".into());
    }
    let instance = read_instances(&instances_file(&app, &owner)?)?
        .into_iter().find(|i| i.id == id).ok_or("La instancia no pertenece a esta cuenta")?;
    if instance.engine != "horizon" || instance.version != "26.3" || instance.loader != "vanilla" {
        return Err("McRust Android admite Horizon 26.3 Vanilla".into());
    }
    let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    let (contract, apk) = tauri::async_runtime::spawn_blocking(move || mcrust_catalog::obtain(&cache))
        .await.map_err(|_| "Descarga de McRust interrumpida")??;
    let target = contract.targets["android-arm64"].clone();
    let payload = json!({"schema":1,"owner":owner,"instance":id,
        "engine_commit":contract.engine_commit,"name":owner.chars().take(16).collect::<String>(),"server":""}).to_string();
    {
        let guard = state.lock().map_err(|_| "Sesión ocupada")?;
        nonce_guard(&guard, generation)?;
    }
    let status = start_game(&app, payload, generation, apk, target).await?;
    Ok(json!({"status":status,"package":mcrust_catalog::PACKAGE}))
}

#[cfg(not(target_os = "android"))]
async fn start_game(_app: &AppHandle, _payload: String, _generation: u64, _apk: std::path::PathBuf, _target: mcrust_catalog::Target) -> Result<String, String> {
    Err("Este inicio requiere un dispositivo Android".into())
}

#[cfg(target_os = "android")]
async fn start_game(app: &AppHandle, payload: String, generation: u64, apk: std::path::PathBuf, target: mcrust_catalog::Target) -> Result<String, String> {
    let (sender, receiver) = std::sync::mpsc::channel();
    let session_app = app.clone();
    let window = app.get_webview_window("main").ok_or("Ventana Android no disponible")?;
    window.with_webview(move |webview| {
        webview.jni_handle().exec(move |env, activity, _| {
            let result = (|| -> Result<String, String> {
                let state = session_app.state::<Mutex<Session>>();
                let session = state.lock().map_err(|_| "Sesión ocupada")?;
                nonce_guard(&session, generation)?;
                if session.bearer.is_none() { return Err("La sesión se cerró".into()); }
                let result = android::operate(env, activity, &payload, &apk, &target);
                if result.is_err() {
                    let _ = env.exception_clear();
                    return Err("Android no pudo instalar o abrir la versión compartida de McRust".into());
                }
                match result.map_err(|e| e.to_string())? { status if status == "signature_mismatch" => Err("La firma de McRust instalada no corresponde a este release".into()), status => Ok(status) }
            })();
            let _ = sender.send(result);
        });
    }).map_err(|_| "No se pudo acceder al contexto Android")?;
    tauri::async_runtime::spawn_blocking(move || receiver.recv_timeout(Duration::from_secs(20))
        .map_err(|_| "Android no confirmó el inicio del juego".to_string()))
        .await.map_err(|_| "Inicio Android interrumpido".to_string())??
}
