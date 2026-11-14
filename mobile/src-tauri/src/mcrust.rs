//! Nexo-managed installation of the same engine release used by PC.
use super::mcrust_catalog;
use std::sync::atomic::{AtomicBool, Ordering};
static BUSY: AtomicBool = AtomicBool::new(false);
struct DownloadGuard;
impl Drop for DownloadGuard { fn drop(&mut self) { BUSY.store(false, Ordering::Release); } }
use super::*;

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
    use jni::objects::{JObject, JValue};
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
                let result = (|| -> jni::errors::Result<String> {
                    use sha2::{Digest, Sha256};
                    let package = JObject::from(env.new_string(mcrust_catalog::PACKAGE)?);
                    let pm = env.call_method(activity, "getPackageManager", "()Landroid/content/pm/PackageManager;", &[])?.l()?;
                    let info = env.call_method(&pm, "getPackageInfo", "(Ljava/lang/String;I)Landroid/content/pm/PackageInfo;", &[JValue::Object(&package), JValue::Int(0x08000000)]);
                    let installed = match info { Ok(v) => Some(v.l()?), Err(_) => { env.exception_clear()?; None } };
                    let mut ready = false;
                    if let Some(info) = installed {
                        let version = env.call_method(&info, "getLongVersionCode", "()J", &[])?.j()?;
                        let signing = env.get_field(&info, "signingInfo", "Landroid/content/pm/SigningInfo;")?.l()?;
                        let signatures = env.call_method(signing, "getApkContentsSigners", "()[Landroid/content/pm/Signature;", &[])?.l()?;
                        let array = jni::objects::JObjectArray::from(signatures);
                        if env.get_array_length(&array)? != 1 { return Ok("signature_mismatch".into()); }
                        let signature = env.get_object_array_element(&array, 0)?;
                        let bytes = env.call_method(signature, "toByteArray", "()[B", &[])?.l()?;
                        let bytes = env.convert_byte_array(jni::objects::JByteArray::from(bytes))?;
                        if format!("{:x}", Sha256::digest(bytes)) != target.certificate_sha256 { return Ok("signature_mismatch".into()); }
                        ready = version == target.version_code;
                    }
                    if !ready {
                        let allowed = env.call_method(&pm, "canRequestPackageInstalls", "()Z", &[])?.z()?;
                        let own = env.call_method(activity, "getPackageName", "()Ljava/lang/String;", &[])?.l()?;
                        let own_text: String = env.get_string(&jni::objects::JString::from(own))?.into();
                        let intent;
                        if !allowed {
                            let action = JObject::from(env.new_string("android.settings.MANAGE_UNKNOWN_APP_SOURCES")?);
                            intent = env.new_object("android/content/Intent", "(Ljava/lang/String;)V", &[JValue::Object(&action)])?;
                            let uri_text = JObject::from(env.new_string(format!("package:{own_text}"))?);
                            let uri = env.call_static_method("android/net/Uri", "parse", "(Ljava/lang/String;)Landroid/net/Uri;", &[JValue::Object(&uri_text)])?.l()?;
                            env.call_method(&intent, "setData", "(Landroid/net/Uri;)Landroid/content/Intent;", &[JValue::Object(&uri)])?;
                        } else {
                            let file_path = JObject::from(env.new_string(apk.to_string_lossy())?);
                            let file = env.new_object("java/io/File", "(Ljava/lang/String;)V", &[JValue::Object(&file_path)])?;
                            let authority = JObject::from(env.new_string(format!("{own_text}.mcrust.files"))?);
                            let uri = env.call_static_method("androidx/core/content/FileProvider", "getUriForFile", "(Landroid/content/Context;Ljava/lang/String;Ljava/io/File;)Landroid/net/Uri;", &[JValue::Object(activity), JValue::Object(&authority), JValue::Object(&file)])?.l()?;
                            let action = JObject::from(env.new_string("android.intent.action.VIEW")?);
                            intent = env.new_object("android/content/Intent", "(Ljava/lang/String;)V", &[JValue::Object(&action)])?;
                            let mime = JObject::from(env.new_string("application/vnd.android.package-archive")?);
                            env.call_method(&intent, "setDataAndType", "(Landroid/net/Uri;Ljava/lang/String;)Landroid/content/Intent;", &[JValue::Object(&uri), JValue::Object(&mime)])?;
                            env.call_method(&intent, "addFlags", "(I)Landroid/content/Intent;", &[JValue::Int(1)])?;
                        }
                        env.call_method(activity, "startActivity", "(Landroid/content/Intent;)V", &[JValue::Object(&intent)])?;
                        return Ok(if allowed { "install_requested" } else { "permission_required" }.into());
                    }
                    let intent = env.new_object("android/content/Intent", "()V", &[])?;
                    let package = JObject::from(env.new_string(mcrust_catalog::PACKAGE)?);
                    let class = JObject::from(env.new_string("android.app.NativeActivity")?);
                    env.call_method(&intent, "setClassName", "(Ljava/lang/String;Ljava/lang/String;)Landroid/content/Intent;", &[JValue::Object(&package), JValue::Object(&class)])?;
                    let key = JObject::from(env.new_string("vis_nexo_launch")?);
                    let value = JObject::from(env.new_string(&payload)?);
                    env.call_method(&intent, "putExtra", "(Ljava/lang/String;Ljava/lang/String;)Landroid/content/Intent;", &[JValue::Object(&key), JValue::Object(&value)])?;
                    env.call_method(activity, "startActivity", "(Landroid/content/Intent;)V", &[JValue::Object(&intent)])?;
                    Ok("started".into())
                })();
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
