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

#[derive(Clone)]
struct PendingMfaLogin { username:String, ticket:String }
#[derive(Default)]
pub(crate) struct SocialSession {
    username: Option<String>,
    bearer: Option<String>,
    pending_mfa: Option<PendingMfaLogin>,
}
fn valid_pending_mfa(data:&Value)->Result<PendingMfaLogin,String>{
    let username=data.get("username").and_then(Value::as_str)
        .ok_or("El usuario MFA no fue confirmado por VIS Ceibo")?;
    let ticket=data.get("mfa_ticket").and_then(Value::as_str)
        .ok_or("VIS Ceibo no devolvió un desafío MFA")?;
    if !(3..=24).contains(&username.len()) ||
       !username.bytes().all(|b|b.is_ascii_lowercase()||b.is_ascii_digit()||b==b'_') ||
       ticket.len()!=43 ||
       !ticket.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'_'||b==b'-'){
        return Err("El desafío de seguridad MFA recibido es inválido".into());
    }
    Ok(PendingMfaLogin{username:username.to_owned(),ticket:ticket.to_owned()})
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

fn connect(username: &str, root: &Path) -> Result<(Option<String>, Value), String> {
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
    if auth.get("mfa_required").and_then(Value::as_bool)==Some(true){
        return Ok((None,auth));
    }
    let token = auth.get("token").and_then(Value::as_str)
        .ok_or("VIS Social no entregó una sesión autenticada")?.to_owned();
    let snapshot = request(&client, &base, "/v1/state", "GET", None, Some(&token))?;
    Ok((Some(token), snapshot))
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
    active.pending_mfa=None;
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
) -> Result<Option<crate::Snapshot>,String> {
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
    if data.get("mfa_required").and_then(Value::as_bool)==Some(true){
        let pending=valid_pending_mfa(&data)?;
        let mut active=social.lock().map_err(|_|"Sesión MFA bloqueada")?;
        active.pending_mfa=Some(pending);
        active.bearer=None;
        active.username=None;
        return Ok(None);
    }
    activate_cloud_user(&backend,&social,data).map(Some)
}

#[tauri::command]
pub(crate) async fn social_cloud_mfa_finish(
    backend:State<'_,Mutex<Backend>>,social:State<'_,Mutex<SocialSession>>,
    code:String
)->Result<crate::Snapshot,String>{
    if code.len()>36||code.trim().is_empty(){
        return Err("Ingresá un código MFA válido".into());
    }
    let pending=social.lock().map_err(|_|"Sesión MFA bloqueada")?
        .pending_mfa.clone().ok_or("No hay un desafío MFA pendiente")?;
    // If there was a local account active while connecting VIS Social, MFA
    // must not change that account into somebody else's identity.
    {
        let current=backend.lock().map_err(|_|"Perfil local bloqueado")?;
        if let Some(active)=&current.active_user{
            if active!=&pending.username{
                return Err("El desafío MFA pertenece a otro usuario VIS".into());
            }
        }
    }
    let result=tauri::async_runtime::spawn_blocking(move||{
        let code=code.trim();
        let payload=if code.len()==6&&code.bytes().all(|b|b.is_ascii_digit()){
            json!({"mfa_ticket":pending.ticket,"code":code})
        }else{
            json!({"mfa_ticket":pending.ticket,"recovery_code":code})
        };
        let data=request(&client()?,&base_url()?,"/v1/accounts/login/mfa",
            "POST",Some(&payload),None)?;
        if data.get("username").and_then(Value::as_str)!=Some(pending.username.as_str()){
            return Err("El segundo factor no corresponde a la identidad VIS".into());
        }
        Ok::<Value,String>(data)
    }).await.map_err(|_|"La comprobación MFA fue interrumpida".to_string())??;
    activate_cloud_user(&backend,&social,result)
}
#[tauri::command]
pub(crate) fn social_cancel_pending_mfa(
    social:State<'_,Mutex<SocialSession>>
)->Result<(),String>{
    social.lock().map_err(|_|"Sesión MFA bloqueada")?.pending_mfa=None;
    Ok(())
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
    if token.is_none(){
        let pending=valid_pending_mfa(&snapshot)?;
        if pending.username!=username{
            return Err("La identidad MFA no coincide con la cuenta local".into());
        }
        active.pending_mfa=Some(pending);
        active.bearer=None;
        active.username=None;
        return Err("VIS_CEIBO_MFA_REQUIRED".into());
    }
    active.username = Some(username);
    active.bearer = token;
    active.pending_mfa=None;
    Ok(snapshot)
}


#[tauri::command]
pub(crate) async fn social_recovery_start(
    kind:String,identity:String
)->Result<Value,String>{
    if !["password","username"].contains(&kind.as_str()) ||identity.len()>254{
        return Err("Tipo o identificador de recuperación inválido".into());
    }
    tauri::async_runtime::spawn_blocking(move||{
        request(&client()?,&base_url()?,"/v1/recovery/start","POST",
            Some(&json!({"kind":kind,"identity":identity})),None)
    }).await.map_err(|_|"La solicitud de recuperación se interrumpió".to_string())?
}
#[tauri::command]
pub(crate) async fn social_recovery_verify_email(code:String)->Result<Value,String>{
    if code.len()!=43{return Err("Código de correo inválido".into());}
    tauri::async_runtime::spawn_blocking(move||{
        request(&client()?,&base_url()?,"/v1/recovery/email/verify","POST",
            Some(&json!({"code":code})),None)
    }).await.map_err(|_|"Verificación de correo interrumpida".to_string())?
}
#[tauri::command]
pub(crate) async fn social_recovery_reset(
    code:String,password:String,confirm:String,recovery_code:Option<String>
)->Result<Value,String>{
    if password!=confirm||!(10..=128).contains(&password.len()){
        return Err("Las contraseñas deben coincidir y tener entre 10 y 128 caracteres".into());
    }
    if code.len()!=43{return Err("Código de recuperación inválido".into());}
    tauri::async_runtime::spawn_blocking(move||{
        let http=client()?;let base=base_url()?;
        let user=request(&http,&base,"/v1/recovery/introspect","POST",
            Some(&json!({"code":code})),None)?;
        let username=user.get("username").and_then(Value::as_str)
            .ok_or("Identidad de recuperación incorrecta")?;
        let mut payload=cloud_registration_payload(username,&password)?;
        let data=payload.as_object_mut().ok_or("Credencial de recuperación inválida")?;
        data.insert("code".to_owned(),json!(code));
        data.insert("recovery_code".to_owned(),json!(recovery_code.unwrap_or_default()));
        request(&http,&base,"/v1/recovery/reset","POST",Some(&payload),None)
    }).await.map_err(|_|"Restablecimiento de contraseña interrumpido".to_string())?
}
#[tauri::command]
pub(crate) async fn social_change_cloud_password(
    backend:State<'_,Mutex<Backend>>,social:State<'_,Mutex<SocialSession>>,
    current_password:String,password:String,confirm:String,mfa_code:Option<String>
)->Result<Value,String>{
    if password!=confirm||!(10..=128).contains(&password.len())||
       !(10..=128).contains(&current_password.len()){
        return Err("Las contraseñas deben tener entre 10 y 128 caracteres y coincidir".into());
    }
    let username=backend.lock().map_err(|_|"Cuenta local bloqueada")?
        .active_user.clone().ok_or("Iniciá sesión en VIS Ceibo")?;
    {
        let session=social.lock().map_err(|_|"Sesión Social bloqueada")?;
        if session.username.as_deref()!=Some(username.as_str())||session.bearer.is_none(){
            return Err("La cuenta VIS Cloud no está autenticada".into());
        }
    }
    let result=tauri::async_runtime::spawn_blocking(move||{
        let http=client()?;let base=base_url()?;
        // Reauthenticate with the CURRENT password using the same device-free
        // Argon2id/Ed25519 challenge protocol as login. Never transmit it.
        let challenge=request(&http,&base,"/v1/accounts/login/challenge","POST",
            Some(&json!({"identifier":username})),None)?;
        let salt=challenge.get("salt").and_then(Value::as_str)
            .ok_or("Desafío de contraseña inválido")?;
        let signed_user=challenge.get("username").and_then(Value::as_str)
            .ok_or("Identidad de autenticación inválida")?;
        if signed_user!=username{return Err("La identidad VIS no coincide".into());}
        if challenge.get("kdf").and_then(Value::as_str)!=Some("argon2id-19m-t2"){
            return Err("Método criptográfico no compatible".into());
        }
        let challenge_id=challenge.get("challenge_id").and_then(Value::as_str)
            .ok_or("Identificador de desafío inválido")?;
        let nonce=challenge.get("nonce").and_then(Value::as_str)
            .ok_or("Desafío inválido")?;
        let salt_bytes=STANDARD.decode(salt).map_err(|_|"Salt inválido")?;
        let signer=cloud_signing_key(&current_password,&salt_bytes)?;
        let proof=format!("VIS-CLOUD-AUTH-V2\n{username}\n{challenge_id}\n{nonce}");
        let signature=STANDARD.encode(signer.sign(proof.as_bytes()).to_bytes());
        let fresh=request(&http,&base,"/v1/accounts/login/verify","POST",
            Some(&json!({"identifier":username,"challenge_id":challenge_id,
                "signature":signature})),None)?;
        if fresh.get("username").and_then(Value::as_str)!=Some(username.as_str()){
            return Err("Autenticación VIS inconsistente".into());
        }
        let token=fresh.get("token").and_then(Value::as_str)
            .ok_or("No se obtuvo una sesión reciente")?;
        if let Some(code)=mfa_code.filter(|v|!v.trim().is_empty()){
            let payload=if code.chars().all(|c|c.is_ascii_digit())&&code.len()==6 {
                json!({"code":code})
            }else{json!({"recovery_code":code.trim()})};
            request(&http,&base,"/v1/account/mfa/verify","POST",
                Some(&payload),Some(token))?;
        }
        let payload=cloud_registration_payload(&username,&password)?;
        request(&http,&base,"/v1/account/password/change","POST",
            Some(&payload),Some(token))
    }).await.map_err(|_|"Cambio de contraseña interrumpido".to_string())??;
    let mut active=social.lock().map_err(|_|"Sesión Social bloqueada")?;
    active.bearer=None;
    Ok(result)
}

#[tauri::command]
pub(crate) async fn social_rebind_device(
    backend:State<'_,Mutex<Backend>>,social:State<'_,Mutex<SocialSession>>
)->Result<Value,String>{
    let (username,root)={
        let s=backend.lock().map_err(|_|"Cuenta local bloqueada")?;
        (s.active_user.clone().ok_or("No hay cuenta activa")?,s.data_root.clone())
    };
    let token={
        let s=social.lock().map_err(|_|"Sesión Social bloqueada")?;
        if s.username.as_deref()!=Some(username.as_str()){
            return Err("La sesión no pertenece a la cuenta actual".into());
        }
        s.bearer.clone().ok_or("Iniciá sesión con la contraseña VIS")?
    };
    tauri::async_runtime::spawn_blocking(move||{
        let key=identity(&username,&root)?;
        let public=STANDARD.encode(key.verifying_key().to_bytes());
        let message=format!("VIS-CEIBO-DEVICE-REBIND-V1\n{username}\n{public}");
        let signature=STANDARD.encode(key.sign(message.as_bytes()).to_bytes());
        request(&client()?,&base_url()?,"/v1/account/devices/rebind","POST",
            Some(&json!({"public_key":public,"signature":signature})),Some(&token))
    }).await.map_err(|_|"Vinculación de dispositivo interrumpida".to_string())?
}

#[tauri::command]
pub(crate) async fn social_request(
    backend: State<'_, Mutex<Backend>>,
    social: State<'_, Mutex<SocialSession>>,
    path: String, method: String, body: Option<Value>
) -> Result<Value, String> {
    const GET: &[&str] = &["/v1/state", "/v1/account", "/v1/projects",
        "/v1/account/mfa/status", "/v1/account/sessions"];
    const POST: &[&str] = &[
        "/v1/keys", "/v1/presence", "/v1/avatar/upload", "/v1/avatar/get",
        "/v1/skins/upload", "/v1/skins/get", "/v1/skins/delete", "/v1/account/display", "/v1/account/handle",
        "/v1/accounts/upgrade", "/v1/account/email/request",
        "/v1/account/mfa/setup", "/v1/account/mfa/confirm",
        "/v1/account/mfa/verify", "/v1/account/mfa/rotate-codes",
        "/v1/account/sessions/revoke", "/v1/projects/subscribe",
        "/v1/projects/unsubscribe", "/v1/projects/community", "/v1/projects/request-join",
        "/v1/admin/projects/community-members", "/v1/admin/projects/review-join",
        "/v1/admin/projects/community-policy", "/v1/admin/projects/community-media",
        "/v1/admin/accounts/global-admin", "/v1/admin/projects/upsert",
        "/v1/admin/projects/staff", "/v1/admin/accounts/role",
        "/v1/admin/accounts/disable", "/v1/friends/request",
        "/v1/friends/accept", "/v1/friends/alias",
        "/v1/messages/send", "/v1/messages/ack"
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
        active.pending_mfa=None;
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
