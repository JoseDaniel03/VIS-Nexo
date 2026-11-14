//! Explicit handoff to the isolated VIS McRust test APK. No shell or bearer transfer.
use super::*;

#[tauri::command]
pub(crate) async fn mobile_mcrust_launch(
    state: State<'_, Mutex<Session>>, app: AppHandle, id: String,
) -> Result<Value, String> {
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
        return Err("La prueba McRust Android admite Horizon 26.3 Vanilla".into());
    }
    let payload = json!({"schema":1,"owner":owner,"instance":id,
        "name":owner.chars().take(16).collect::<String>(),"server":""}).to_string();
    {
        let guard = state.lock().map_err(|_| "Sesión ocupada")?;
        nonce_guard(&guard, generation)?;
    }
    start_game(&app, payload, generation).await?;
    Ok(json!({"started":true,"package":"com.visstudios.mcrust.preview"}))
}

#[cfg(not(target_os = "android"))]
async fn start_game(_app: &AppHandle, _payload: String, _generation: u64) -> Result<(), String> {
    Err("Este inicio requiere un dispositivo Android".into())
}

#[cfg(target_os = "android")]
async fn start_game(app: &AppHandle, payload: String, generation: u64) -> Result<(), String> {
    use jni::objects::{JObject, JValue};
    let (sender, receiver) = std::sync::mpsc::channel();
    let session_app = app.clone();
    let window = app.get_webview_window("main").ok_or("Ventana Android no disponible")?;
    window.with_webview(move |webview| {
        webview.jni_handle().exec(move |env, activity, _| {
            let result = (|| -> Result<(), String> {
                let state = session_app.state::<Mutex<Session>>();
                let session = state.lock().map_err(|_| "Sesión ocupada")?;
                nonce_guard(&session, generation)?;
                if session.bearer.is_none() { return Err("La sesión se cerró".into()); }
                let result = (|| -> jni::errors::Result<()> {
                    let intent = env.new_object("android/content/Intent", "()V", &[])?;
                    let package = JObject::from(env.new_string("com.visstudios.mcrust.preview")?);
                    let class = JObject::from(env.new_string("dev.horizon.android.HorizonActivity")?);
                    env.call_method(&intent, "setClassName", "(Ljava/lang/String;Ljava/lang/String;)Landroid/content/Intent;", &[JValue::Object(&package), JValue::Object(&class)])?;
                    let key = JObject::from(env.new_string("vis_nexo_launch")?);
                    let value = JObject::from(env.new_string(&payload)?);
                    env.call_method(&intent, "putExtra", "(Ljava/lang/String;Ljava/lang/String;)Landroid/content/Intent;", &[JValue::Object(&key), JValue::Object(&value)])?;
                    env.call_method(activity, "startActivity", "(Landroid/content/Intent;)V", &[JValue::Object(&intent)])?;
                    Ok(())
                })();
                if result.is_err() {
                    let _ = env.exception_clear();
                    return Err("No se pudo abrir McRust. Instalá primero el APK VIS McRust Preview ARM64 de esta tanda".into());
                }
                Ok(())
            })();
            let _ = sender.send(result);
        });
    }).map_err(|_| "No se pudo acceder al contexto Android")?;
    tauri::async_runtime::spawn_blocking(move || receiver.recv_timeout(Duration::from_secs(20))
        .map_err(|_| "Android no confirmó el inicio del juego".to_string()))
        .await.map_err(|_| "Inicio Android interrumpido".to_string())??
}
