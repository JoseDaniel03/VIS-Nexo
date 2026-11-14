//! Nexo-managed installation of the same engine release used by PC.
use super::mcrust_catalog;
use sha2::{Digest,Sha256};
/// VIS account is the stable owner; public VIS handle is just the cosmetic
/// offline player label. Premium Microsoft identity is separately verified.
fn minecraft_label(name:&str)->bool{
    (3..=16).contains(&name.len())
      && name.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'_')
}
fn fallback_label(user:&str)->String{
    if minecraft_label(user){return user.to_owned();}
    let hash=Sha256::digest(user.as_bytes());
    // Deterministic, case-preserving 16-byte nickname. No cross-account
    // collisions from naive 16-character truncation.
    format!("{}_{:02x}{:02x}",user.chars().take(11).collect::<String>(),hash[0],hash[1])
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn names_are_bounded_and_do_not_truncate_into_same_identity(){
        assert!(minecraft_label("Jose_Daniel"));
        assert!(!minecraft_label("name with spaces"));
        let a=fallback_label("verylongusernameaaaa");
        let b=fallback_label("verylongusernameaaab");
        assert_ne!(a,b);assert!(minecraft_label(&a));assert!(minecraft_label(&b));
    }
}
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
    ms:State<'_,Mutex<super::microsoft::MicrosoftState>>
) -> Result<Value, String> {
    if BUSY.swap(true, Ordering::AcqRel) { return Err("Ya se está preparando McRust".into()); }
    let _busy = DownloadGuard;
    let (owner, generation, bearer) = {
        let session = state.lock().map_err(|_| "Sesión ocupada")?;
        (session.username.clone().filter(|_| session.bearer.is_some())
            .ok_or("Iniciá sesión en VIS Ceibo")?, session.epoch,
          session.bearer.clone().ok_or("Sesión VIS Ceibo incompleta")?)
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
    // Microsoft name is only used after verification against official Minecraft
    // Services. VIS handles are cosmetic offline names, not premium proof.
    let verified=ms.lock().map_err(|_|"Microsoft ocupado")?
      .verified_name(&owner,generation).map(str::to_owned);
    let player_name=if let Some(name)=verified{
        name
    }else{
        let fallback=fallback_label(&owner);
        let bearer_for_request=bearer.clone();
        let identity=tauri::async_runtime::spawn_blocking(move||
          super::request("/v1/account","GET",None,Some(&bearer_for_request))
        ).await.ok().and_then(Result::ok);
        identity.as_ref().and_then(|a|a["account"]["public_handle"].as_str())
          .filter(|handle|minecraft_label(handle)).map(str::to_owned)
          .unwrap_or(fallback)
    };
    let payload = json!({"schema":1,"owner":owner,"instance":id,
        "engine_commit":contract.engine_commit,"name":player_name,"server":""}).to_string();
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
                // Native Android returns a safe failure stage without logging
                // JNI exception contents or the VIS launch payload.
                let status = android::operate(env, activity, &payload, &apk, &target)?;
                match status.as_str() {
                    "signature_mismatch" => Err("La firma de McRust instalado es distinta de la publicación. Respaldá sus mundos antes de reemplazarlo.".into()),
                    _ => Ok(status)
                }
            })();
            let _ = sender.send(result);
        });
    }).map_err(|_| "No se pudo acceder al contexto Android")?;
    tauri::async_runtime::spawn_blocking(move || receiver.recv_timeout(Duration::from_secs(20))
        .map_err(|_| "Android no confirmó el inicio del juego".to_string()))
        .await.map_err(|_| "Inicio Android interrumpido".to_string())??
}
