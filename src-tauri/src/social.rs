//! VIS Social remote bridge. User PINs stay local, device signing keys never
//! enter the WebView. Bearer sessions exist in process memory only.
use crate::accounts::atomic_json;
use crate::Backend;
use argon2::Argon2;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use ed25519_dalek::{Signer, SigningKey};
use rand_core::{OsRng, RngCore};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs, path::Path, sync::{Mutex,OnceLock}, time::Duration};
use tauri::State;

const DEFAULT_URL: &str = "https://vis-social.defreitascarranza-845.workers.dev";

#[derive(Clone, Serialize, Deserialize)]
struct DeviceKey { signing_secret: String }

#[derive(Default)]
pub(crate) struct SocialSession {
    username: Option<String>,
    bearer: Option<String>,
}

fn base_url() -> Result<String, String> {
    let raw = option_env!("VIS_SOCIAL_URL").filter(|s| !s.trim().is_empty())
        .unwrap_or(DEFAULT_URL).trim_end_matches('/');
    let url = url::Url::parse(raw).map_err(|_| "VIS Social URL incorrecta".to_owned())?;
    if url.scheme() != "https" || url.host_str().is_none()
        || !url.username().is_empty() || url.password().is_some()
        || url.query().is_some() || url.fragment().is_some() || url.path() != "/" {
        return Err("VIS Social requiere una URL HTTPS de origen (sin ruta ni credenciales).".into());
    }
    Ok(raw.to_owned())
}

// reqwest::blocking::Client is internally Arc-backed: cheap cloning preserves
// TLS sessions, idle HTTP connections and DNS pooling across 2-9 s polls.
static SOCIAL_HTTP: OnceLock<Client> = OnceLock::new();
fn client() -> Result<Client, String> {
    if let Some(http)=SOCIAL_HTTP.get(){return Ok(http.clone())}
    let built=Client::builder()
        .timeout(Duration::from_secs(15))
        .connect_timeout(Duration::from_secs(7))
        .pool_idle_timeout(Duration::from_secs(90))
        .pool_max_idle_per_host(4)
        .tcp_keepalive(Duration::from_secs(45))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "No se pudo crear el cliente de VIS Social".to_owned())?;
    Ok(SOCIAL_HTTP.get_or_init(||built).clone())
}

fn request(
    client: &Client, base: &str, path: &str, method: &str,
    body: Option<&Value>, token: Option<&str>
) -> Result<Value, String> {
    let verb = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|_| "Método HTTP no permitido".to_owned())?;
    let mut builder = client.request(verb, format!("{base}{path}"));
    if let Some(token) = token {
        builder = builder.bearer_auth(token);
    }
    if let Some(json) = body {
        builder = builder.json(json);
    }
    let response = builder.send()
        .map_err(|_| "No hay conexión con el servicio VIS Social".to_owned())?;
    let status = response.status();
    let data: Value = response.json()
        .map_err(|_| "Respuesta inválida del servicio VIS Social".to_owned())?;
    if !status.is_success() {
        let server_error = data.get("error").and_then(Value::as_str)
            .unwrap_or("El servicio rechazó la solicitud");
        return Err(format!("VIS Social (HTTP {}): {}", status.as_u16(),
            server_error.chars().take(170).collect::<String>()));
    }
    Ok(data)
}

fn identity(username: &str, root: &Path) -> Result<SigningKey, String> {
    if !username.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
        || !(3..=24).contains(&username.len()) {
        return Err("Nombre de usuario local no válido para VIS Social".into());
    }
    let file = root.join("social-device-keys").join(format!("{username}.json"));
    if file.exists() {
        let encoded: DeviceKey = serde_json::from_slice(&fs::read(file)
            .map_err(|_| "No se pudo leer la identidad del dispositivo".to_owned())?)
            .map_err(|_| "Identidad de dispositivo dañada".to_owned())?;
        let decoded = STANDARD.decode(encoded.signing_secret)
            .map_err(|_| "Identidad de dispositivo dañada".to_owned())?;
        let seed: [u8; 32] = decoded.try_into()
            .map_err(|_| "Identidad de dispositivo dañada".to_owned())?;
        return Ok(SigningKey::from_bytes(&seed));
    }
    let mut seed = [0u8; 32];
    OsRng.fill_bytes(&mut seed);
    let key = SigningKey::from_bytes(&seed);
    atomic_json(&file, &DeviceKey { signing_secret: STANDARD.encode(seed) })?;
    seed.fill(0);
    Ok(key)
}

fn connect(username: &str, root: &Path) -> Result<(String, Value), String> {
    let base = base_url()?;
    let client = client()?;
    let signing = identity(username, root)?;
    let public = STANDARD.encode(signing.verifying_key().to_bytes());
    let proof = STANDARD.encode(signing.sign(
        format!("VIS-SOCIAL-REGISTER-V1\n{username}").as_bytes()).to_bytes());
    request(&client, &base, "/v1/auth/register", "POST",
        Some(&json!({"username": username, "public_key": public, "signature": proof})), None)?;
    let challenge = request(&client, &base, "/v1/auth/challenge", "POST",
        Some(&json!({"username": username})), None)?;
    let id = challenge.get("id").and_then(Value::as_str)
        .ok_or("VIS Social devolvió un desafío incorrecto")?;
    let nonce = challenge.get("nonce").and_then(Value::as_str)
        .ok_or("VIS Social devolvió un desafío incorrecto")?;
    let text = format!("VIS-SOCIAL-AUTH-V1\n{username}\n{id}\n{nonce}");
    let signature = STANDARD.encode(signing.sign(text.as_bytes()).to_bytes());
    let auth = request(&client, &base, "/v1/auth/session", "POST",
        Some(&json!({"username": username, "challenge_id": id, "signature": signature})), None)?;
    let token = auth.get("token").and_then(Value::as_str)
        .ok_or("VIS Social no entregó una sesión autenticada")?.to_owned();
    let snapshot = request(&client, &base, "/v1/state", "GET", None, Some(&token))?;
    Ok((token, snapshot))
}

/// Public identity for optional out-of-band super administrator provisioning.
/// The secret Ed25519 seed and local PIN are never returned to JavaScript.
#[tauri::command]
pub(crate) fn social_identity_info(
    backend: State<'_, Mutex<Backend>>
) -> Result<Value, String> {
    let (username, root) = {
        let current = backend.lock().map_err(|_| "Estado local bloqueado")?;
        (current.active_user.clone().ok_or("Entrá con una cuenta local")?,
         current.data_root.clone())
    };
    let signing = identity(&username, &root)?;
    let public = signing.verifying_key().to_bytes();
    let digest = Sha256::digest(public);
    let fingerprint: String = digest.iter().map(|byte| format!("{:02x}", byte)).collect();
    Ok(json!({
        "username": username,
        "public_key": STANDARD.encode(public),
        "fingerprint_sha256": fingerprint,
    }))
}

/// Password -> device-independent Argon2id-derived Ed25519 credential.
/// The derived private key is ephemeral; D1 stores only its public verifier.
fn cloud_signing_key(password: &str, salt: &[u8]) -> Result<SigningKey,String> {
    if !(10..=128).contains(&password.len()) || salt.len()!=16 {
        return Err("Contraseña online o salt inválidos".into());
    }
    let mut seed=[0u8;32];
    Argon2::default().hash_password_into(password.as_bytes(),salt,&mut seed)
        .map_err(|_| "No se pudo derivar la clave protegida de VIS Social")?;
    let result=SigningKey::from_bytes(&seed);
    seed.fill(0);
    Ok(result)
}
fn cloud_registration_payload(username: &str,password: &str) -> Result<Value,String> {
    let mut salt=[0u8;16];
    OsRng.fill_bytes(&mut salt);
    let signer=cloud_signing_key(password,&salt)?;
    let salt_base64=STANDARD.encode(salt);
    salt.fill(0);
    let message=format!("VIS-CLOUD-REGISTER-V2\n{username}\n{salt_base64}");
    Ok(json!({
        "username":username,"password_salt":salt_base64,
        "password_public_key":STANDARD.encode(signer.verifying_key().to_bytes()),
        "registration_signature":STANDARD.encode(signer.sign(message.as_bytes()).to_bytes())
    }))
}

fn activate_cloud_user(
    backend: &Mutex<Backend>, social: &Mutex<SocialSession>, authenticated: Value
) -> Result<crate::Snapshot,String> {
    let username = authenticated.get("username").and_then(Value::as_str)
        .ok_or("Respuesta de usuario de VIS Social inválida")?;
    let token = authenticated.get("token").and_then(Value::as_str)
        .ok_or("VIS Social no entregó una sesión válida")?;
    if token.len() < 40 || !username.bytes().all(|b|
        b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_') {
        return Err("Sesión VIS Social inválida".into());
    }
    let mut current = backend.lock().map_err(|_| "Cuenta local bloqueada")?;
    current.storage.ensure_cloud_profile(username)?;
    current.guest_name = None;
    current.active_user = Some(username.to_owned());
    current.presence = "online".into();
    current.add_recent(username,"vis-social")?;
    let snapshot = current.snapshot();
    let mut active = social.lock().map_err(|_| "Sesión VIS Social bloqueada")?;
    active.username = Some(username.to_owned());
    active.bearer = Some(token.to_owned());
    Ok(snapshot)
}

#[tauri::command]
pub(crate) async fn social_cloud_register(
    backend: State<'_,Mutex<Backend>>, social: State<'_,Mutex<SocialSession>>,
    username: String, password: String, confirm: String
) -> Result<crate::Snapshot,String> {
    if password!=confirm {return Err("Las contraseñas no coinciden".into());}
    if !(10..=128).contains(&password.len()) {
        return Err("Para VIS Social necesitás una contraseña de 10 a 128 caracteres".into());
    }
    let name = username.trim().to_ascii_lowercase();
    // Prevent unintentionally claiming an existing local profile.
    {
        let current=backend.lock().map_err(|_| "Cuenta local bloqueada")?;
        if current.storage.get(&name).is_some() {
            return Err("Este nombre ya existe como cuenta local en este dispositivo. Entrá por Cuenta local y vinculala.".into());
        }
    }
    let data = tauri::async_runtime::spawn_blocking(move || {
        let payload=cloud_registration_payload(&name,&password)?;
        request(&client()?,&base_url()?,"/v1/accounts/register","POST",
            Some(&payload),None)
    }).await.map_err(|_| "Registro online interrumpido")??;
    activate_cloud_user(&backend,&social,data)
}

#[tauri::command]
pub(crate) async fn social_cloud_login(
    backend: State<'_,Mutex<Backend>>, social: State<'_,Mutex<SocialSession>>,
    identifier: String, password: String
) -> Result<crate::Snapshot,String> {
    // @handle is a friendly login address. The server still authenticates
    // against the original immutable username bound to the Ed25519 proof.
    let identifier=identifier.trim().trim_start_matches('@').to_owned();
    // Legacy 24-char public IDs are case-sensitive base64url; do not fold
    // them. The Worker separately normalizes @handles and old usernames.
    if !(3..=24).contains(&identifier.len()) ||
        !identifier.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'_'||b==b'-') ||
        password.is_empty() {
        return Err("Ingresá tu @usuario o ID pública y contraseña".into());
    }
    let data = tauri::async_runtime::spawn_blocking(move || {
        let http=client()?;
        let base=base_url()?;
        let challenge=request(&http,&base,"/v1/accounts/login/challenge","POST",
            Some(&json!({"identifier":identifier})),None)?;
        let salt=challenge.get("salt").and_then(Value::as_str)
            .ok_or("Desafío de autenticación inválido")?;
        let username=challenge.get("username").and_then(Value::as_str)
            .ok_or("Usuario remoto inválido")?;
        let id=challenge.get("challenge_id").and_then(Value::as_str)
            .ok_or("Identificador de desafío inválido")?;
        let nonce=challenge.get("nonce").and_then(Value::as_str)
            .ok_or("Desafío de seguridad inválido")?;
        if challenge.get("kdf").and_then(Value::as_str)!=Some("argon2id-19m-t2") {
            return Err("Método de autenticación remoto incompatible".into());
        }
        let salt_bytes=STANDARD.decode(salt).map_err(|_|"Salt remoto inválido")?;
        let signer=cloud_signing_key(&password,&salt_bytes)?;
        let proof=format!("VIS-CLOUD-AUTH-V2\n{username}\n{id}\n{nonce}");
        let signature=STANDARD.encode(signer.sign(proof.as_bytes()).to_bytes());
        request(&http,&base,"/v1/accounts/login/verify","POST",
            Some(&json!({"identifier":identifier,"challenge_id":id,
                "signature":signature})),None)
    }).await.map_err(|_| "Inicio de sesión online interrumpido")??;
    activate_cloud_user(&backend,&social,data)
}

#[tauri::command]
pub(crate) async fn social_enable_cloud_password(
    backend: State<'_,Mutex<Backend>>, social: State<'_,Mutex<SocialSession>>,
    password: String, confirm: String
) -> Result<Value,String> {
    if password != confirm || !(10..=128).contains(&password.len()) {
        return Err("Las contraseñas deben coincidir y tener entre 10 y 128 caracteres".into());
    }
    let username=backend.lock().map_err(|_| "Cuenta local bloqueada")?
        .active_user.clone().ok_or("Iniciá sesión primero")?;
    let token={
        let active=social.lock().map_err(|_| "Sesión social bloqueada")?;
        if active.username.as_deref()!=Some(username.as_str()) {
            return Err("Conectá VIS Social antes de vincular la cuenta".into());
        }
        active.bearer.clone().ok_or("Sesión social vencida")?
    };
    tauri::async_runtime::spawn_blocking(move || {
        let payload=cloud_registration_payload(&username,&password)?;
        request(&client()?,&base_url()?,"/v1/accounts/upgrade","POST",
            Some(&payload),Some(&token))
    }).await.map_err(|_| "Vinculación de cuenta interrumpida")?
}

#[tauri::command]
pub(crate) async fn social_connect(
    backend: State<'_, Mutex<Backend>>, social: State<'_, Mutex<SocialSession>>
) -> Result<Value, String> {
    let (username, root) = {
        let current = backend.lock().map_err(|_| "Estado local bloqueado")?;
        (current.active_user.clone().ok_or("Entrá primero con una cuenta local")?,
         current.data_root.clone())
    };
    let username_for_thread = username.clone();
    let (token, snapshot) = tauri::async_runtime::spawn_blocking(move || {
        connect(&username_for_thread, &root)
    }).await.map_err(|_| "VIS Social interrumpido")??;
    {
        let current = backend.lock().map_err(|_| "Estado local bloqueado")?;
        if current.active_user.as_deref() != Some(username.as_str()) {
            return Err("La cuenta cambió durante la conexión a VIS Social".into());
        }
    }
    let mut active = social.lock().map_err(|_| "Estado social bloqueado")?;
    active.username = Some(username);
    active.bearer = Some(token);
    Ok(snapshot)
}

#[tauri::command]
pub(crate) async fn social_request(
    backend: State<'_, Mutex<Backend>>,
    social: State<'_, Mutex<SocialSession>>,
    path: String, method: String, body: Option<Value>
) -> Result<Value, String> {
    const GET: &[&str] = &["/v1/state", "/v1/account", "/v1/projects", "/v1/worlds/inbox"];
    const POST: &[&str] = &[
        "/v1/keys", "/v1/presence", "/v1/avatar/upload", "/v1/avatar/get",
        "/v1/skins/upload", "/v1/skins/get", "/v1/skins/delete", "/v1/account/display", "/v1/account/handle",
        "/v1/accounts/upgrade", "/v1/projects/subscribe",
        "/v1/projects/unsubscribe", "/v1/admin/projects/upsert",
        "/v1/admin/projects/staff", "/v1/admin/accounts/role",
        "/v1/admin/accounts/disable", "/v1/friends/request",
        "/v1/friends/accept", "/v1/friends/alias",
        "/v1/messages/send", "/v1/messages/ack",
        "/v1/worlds/host", "/v1/worlds/close", "/v1/worlds/invite", "/v1/worlds/accept", "/v1/worlds/decline"
    ];
    if !(method == "GET" && GET.contains(&path.as_str())
        || method == "POST" && POST.contains(&path.as_str())) {
        return Err("Operación VIS Social no autorizada".into());
    }
    let username = backend.lock().map_err(|_| "Estado local bloqueado")?
        .active_user.clone().ok_or("No hay cuenta local activa")?;
    let token = {
        let active = social.lock().map_err(|_| "Estado social bloqueado")?;
        if active.username.as_deref() != Some(username.as_str()) {
            return Err("La sesión social no pertenece a la cuenta actual".into());
        }
        active.bearer.clone().ok_or("Conectá VIS Social nuevamente")?
    };
    tauri::async_runtime::spawn_blocking(move || {
        let base = base_url()?;
        request(&client()?, &base, &path, &method, body.as_ref(), Some(&token))
    }).await.map_err(|_| "Solicitud VIS Social interrumpida")?
}

// This is NOT a social bearer token. Only a 20-second, single-use,
 // read-only WS upgrade ticket is returned to the WebView.
#[tauri::command]
pub(crate) async fn social_realtime_ticket(
    backend: State<'_, Mutex<Backend>>,
    social: State<'_, Mutex<SocialSession>>
) -> Result<Value,String>{
    let username=backend.lock().map_err(|_|"Estado local bloqueado")?
        .active_user.clone().ok_or("No hay cuenta activa")?;
    let token={
        let active=social.lock().map_err(|_|"Estado social bloqueado")?;
        if active.username.as_deref()!=Some(username.as_str()){
            return Err("La conexión social no pertenece a la cuenta activa".into());
        }
        active.bearer.clone().ok_or("Conectá VIS Social primero")?
    };
    tauri::async_runtime::spawn_blocking(move||{
        let base=base_url()?;
        let result=request(&client()?,&base,"/v1/realtime/ticket","POST",
            Some(&json!({})),Some(&token))?;
        let ticket=result.get("ticket").and_then(Value::as_str)
            .ok_or("Permiso temporal de conexión inválido")?;
        if ticket.len()!=43 || !ticket.bytes().all(|b|
            b.is_ascii_alphanumeric() || b==b'-' || b==b'_'){
            return Err("Permiso de conexión inválido".into());
        }
        // The WebView cannot choose or redirect the endpoint. TLS hostname
        // comes exclusively from validated VIS_SOCIAL_URL/DEFAULT_URL.
        let ws_url=format!("{}/v1/realtime/connect?ticket={}",
            base.replacen("https:","wss:",1),ticket);
        Ok(json!({"ws_url":ws_url,"expires_in":20}))
    }).await.map_err(|_|"Conexión de avisos interrumpida")?
}
#[tauri::command]
pub(crate) async fn social_disconnect(
    social: State<'_, Mutex<SocialSession>>
) -> Result<(), String> {
    let token = {
        let mut active = social.lock().map_err(|_| "Estado social bloqueado")?;
        active.username = None;
        active.bearer.take()
    };
    if let Some(token) = token {
        let _ = tauri::async_runtime::spawn_blocking(move || {
            if let (Ok(base), Ok(http)) = (base_url(), client()) {
                let _ = request(&http, &base, "/v1/presence", "POST",
                    Some(&json!({"presence":"offline","custom_status":"","current_game":""})),
                    Some(&token));
                let _ = request(&http, &base, "/v1/auth/logout", "POST",
                    Some(&json!({})), Some(&token));
            }
        }).await;
    }
    Ok(())
}

