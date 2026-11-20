//! Android Keystore bridge. No generic native/credential operation enters IPC.
use super::*;
pub(crate) fn auth_gate() -> &'static tauri::async_runtime::Mutex<()> {
    static GATE: OnceLock<tauri::async_runtime::Mutex<()>> = OnceLock::new();
    GATE.get_or_init(|| tauri::async_runtime::Mutex::new(()))
}
#[cfg(target_os = "android")]
pub(crate) async fn call(
    app: &AppHandle,
    operation: &str,
    payload: String,
) -> Result<String, String> {
    use jni::objects::{JClass, JObject, JString, JValue};
    let operation = operation.to_owned();
    let (tx, rx) = std::sync::mpsc::channel();
    app.get_webview_window("main").ok_or("Ventana Android no disponible")?
      .with_webview(move|webview|{webview.jni_handle().exec(move|env,activity,_|{
        let result=(||->jni::errors::Result<String>{
          let loader=env.call_method(activity,"getClassLoader","()Ljava/lang/ClassLoader;",&[])?.l()?;
          let name=JObject::from(env.new_string("com.visstudios.nexo.mobile.NexoDevice")?);
          let class=JClass::from(env.call_method(loader,"loadClass","(Ljava/lang/String;)Ljava/lang/Class;",&[JValue::Object(&name)])?.l()?);
          let op=JObject::from(env.new_string(operation)?);
          let data=JObject::from(env.new_string(payload)?);
          let value=env.call_static_method(class,"call","(Landroid/app/Activity;Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;",
            &[JValue::Object(activity),JValue::Object(&op),JValue::Object(&data)])?.l()?;
          Ok(env.get_string(&JString::from(value))?.into())
        })().map_err(|_|{let _=env.exception_clear();"No se pudo completar la operación segura de Android".to_string()});
        let _=tx.send(result);
      });}).map_err(|_|"No se pudo acceder a Android")?;
    tauri::async_runtime::spawn_blocking(move || {
        rx.recv_timeout(Duration::from_secs(20))
            .map_err(|_| "Android no respondió".to_string())
    })
    .await
    .map_err(|_| "Operación Android interrumpida")??
}
#[cfg(not(target_os = "android"))]
pub(crate) async fn call(
    _app: &AppHandle,
    _operation: &str,
    _payload: String,
) -> Result<String, String> {
    Err("Esta función requiere Android".into())
}
#[tauri::command]
pub(crate) async fn mobile_device(app: AppHandle, operation: String) -> Result<Value, String> {
    if !matches!(
        operation.as_str(),
        "status" | "onboarding" | "installer" | "settings" | "updates" | "diagnostics" | "microsoft-link"
    ) {
        return Err("Operación de dispositivo no permitida".into());
    }
    serde_json::from_str(&call(&app, &operation, String::new()).await?)
        .map_err(|_| "Respuesta Android inválida".into())
}
pub(crate) async fn persist(app: &AppHandle, state: &Mutex<Session>) -> Result<(), String> {
    let payload = {
        let s = state.lock().map_err(|_| "Sesión ocupada")?;
        if s.remember && s.bearer.is_some() {
            Some(json!({"username":s.username,"bearer":s.bearer,"microsoft_refresh":s.microsoft_refresh}).to_string())
        } else {
            None
        }
    };
    match payload {
        Some(v) => {
            call(app, "save", v).await?;
        }
        None => {
            call(app, "clear", String::new()).await?;
        }
    }
    Ok(())
}
// Do not leave a newly authenticated native account behind when saving failed:
// the WebView would otherwise still display the previous account/login form.
pub(crate) async fn finish_auth(
    app: &AppHandle,
    state: &Mutex<Session>,
    view: AuthView,
) -> Result<AuthView, String> {
    if persist(app, state).await.is_err() {
        {
            let mut s = state.lock().map_err(|_| "Sesión ocupada")?;
            let epoch = s.epoch.wrapping_add(1);
            *s = Session {
                epoch,
                ..Session::default()
            };
        }
        let _ = call(app, "clear", String::new()).await;
        return Err("No se pudo confirmar el almacenamiento seguro de la sesión. Reintentá el acceso; podés dejar Mantener sesión desmarcado.".into());
    }
    Ok(view)
}
#[tauri::command]
pub(crate) async fn mobile_restore(
    app: AppHandle,
    state: State<'_, Mutex<Session>>,
) -> Result<AuthView, String> {
    let _auth = auth_gate().lock().await;
    let generation = state.lock().map_err(|_| "Sesión ocupada")?.epoch;
    let raw = call(&app, "load", String::new()).await?;
    let value: Value = serde_json::from_str(&raw).map_err(|_| "Sesión guardada inválida")?;
    let Some(user) = value["username"].as_str() else {
        return super::mobile_status(state);
    };
    let token = value["bearer"]
        .as_str()
        .filter(|t| (40..=8192).contains(&t.len()))
        .ok_or("Sesión guardada inválida")?
        .to_owned();
    validate_username(user)?;
    let username = user.to_owned();
    let verify = tauri::async_runtime::spawn_blocking(move || {
        request("/v1/account", "GET", None, Some(&token)).map(|v| (v, token))
    })
    .await
    .map_err(|_| "Verificación de sesión interrumpida")?;
    let (account, token) = match verify {
        Ok(v) => v,
        Err(e) => {
            if e.starts_with("VIS Ceibo HTTP 401:") || e.starts_with("VIS Ceibo HTTP 403:") {
                call(&app, "clear", String::new()).await?;
            }
            return Err(e);
        }
    };
    if account["account"]["username"].as_str() != Some(username.as_str()) {
        call(&app, "clear", String::new()).await?;
        return Err("La sesión guardada pertenece a otra identidad".into());
    }
    let mut s = state.lock().map_err(|_| "Sesión ocupada")?;
    nonce_guard(&s, generation)?;
    s.epoch = s.epoch.wrapping_add(1);
    s.username = Some(username);
    s.bearer = Some(token);
    s.remember = true;
    s.microsoft_refresh = value["microsoft_refresh"]
        .as_str()
        .filter(|t| !t.is_empty() && t.len() <= 8192)
        .map(str::to_owned);
    Ok(auth_view(&s))
}
