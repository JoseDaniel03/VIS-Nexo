//! VIS Nexo Android — intentionally small, connection-first native shell.
//! Desktop game launch/install, filesystem edits and Horizon are not exposed.
//! Password derivation and Cloudflare bearer tokens never enter the WebView.
use argon2::Argon2;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use ed25519_dalek::{Signer, SigningKey};
use rand_core::{OsRng, RngCore};
use reqwest::blocking::Client;
use serde::Serialize;
use serde_json::{json, Value};
use std::{sync::{Mutex, OnceLock}, time::Duration};
use tauri::State;

const SERVER: &str = "https://vis-social.defreitascarranza-845.workers.dev";

#[derive(Default)]
struct Session {
    username: Option<String>,
    bearer: Option<String>,
    pending: Option<PendingMfa>,
    epoch: u64,
}
#[derive(Clone)]
struct PendingMfa { username: String, ticket: String }

#[derive(Serialize)]
struct AuthView {
    signed_in: bool,
    mfa_required: bool,
    username: Option<String>,
    message: &'static str,
}
fn auth_view(s:&Session)->AuthView{
    AuthView {
        signed_in:s.bearer.is_some(),
        mfa_required:s.pending.is_some(),
        username:s.username.clone().or_else(||s.pending.as_ref().map(|p|p.username.clone())),
        message:if s.bearer.is_some(){"Sesión VIS Ceibo activa"}else if s.pending.is_some(){
            "Ingresá tu código MFA para completar el acceso"
        }else{"No hay sesión activa"},
    }
}
static HTTP:OnceLock<Client>=OnceLock::new();
fn http()->Result<Client,String>{
    if let Some(c)=HTTP.get(){return Ok(c.clone());}
    let c=Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(18))
        .redirect(reqwest::redirect::Policy::none())
        .pool_max_idle_per_host(3)
        .build().map_err(|_|"No se pudo iniciar el cliente HTTPS")?;
    Ok(HTTP.get_or_init(||c).clone())
}
fn request(path:&str,method:&str,body:Option<&Value>,token:Option<&str>)->Result<Value,String>{
    if !path.starts_with('/')||path.contains("..")||path.contains('?')||path.contains('#'){
        return Err("Ruta del servicio no permitida".into());
    }
    let verb=reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|_|"Método HTTP inválido")?;
    let client=http()?;
    let mut builder=client.request(verb,format!("{SERVER}{path}"));
    if let Some(token)=token{builder=builder.bearer_auth(token)}
    if let Some(body)=body{builder=builder.json(body)}
    let response=builder.send().map_err(|_|"Sin conexión HTTPS con VIS Ceibo")?;
    let status=response.status();
    let value=response.json::<Value>().map_err(|_|"Respuesta inválida de VIS Ceibo")?;
    if !status.is_success(){
        let detail=value.get("error").and_then(Value::as_str)
            .unwrap_or("El servicio rechazó la operación");
        return Err(format!("VIS Ceibo HTTP {}: {}",status.as_u16(),
            detail.chars().take(150).collect::<String>()));
    }
    Ok(value)
}
fn validate_username(raw:&str)->Result<&str,String>{
    if !(3..=24).contains(&raw.len())||
       !raw.bytes().all(|b|b.is_ascii_lowercase()||b.is_ascii_digit()||b==b'_'){
        return Err("Usuario técnico VIS inválido".into());
    }
    Ok(raw)
}
fn validate_identifier(raw:&str)->Result<String,String>{
    let id=raw.trim().trim_start_matches('@');
    if !(3..=24).contains(&id.len())||
       !id.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'_'||b==b'-'){
        return Err("Usá el @usuario o la ID pública de tu cuenta VIS".into());
    }
    Ok(id.to_owned())
}
fn derive(password:&str,salt_b64:&str)->Result<SigningKey,String>{
    if !(10..=128).contains(&password.len()){return Err("La clave VIS necesita entre 10 y 128 caracteres".into())}
    let salt=STANDARD.decode(salt_b64).map_err(|_|"Salt VIS inválido")?;
    if salt.len()!=16{return Err("Salt VIS no compatible".into());}
    let mut seed=[0u8;32];
    Argon2::default().hash_password_into(password.as_bytes(),&salt,&mut seed)
        .map_err(|_|"No se pudo derivar la identidad VIS")?;
    let key=SigningKey::from_bytes(&seed);
    seed.fill(0);
    Ok(key)
}
fn registration(username:&str,password:&str)->Result<Value,String>{
    validate_username(username)?;
    let mut salt=[0u8;16];OsRng.fill_bytes(&mut salt);
    let salt64=STANDARD.encode(salt);
    let private=derive(password,&salt64)?;
    salt.fill(0);
    let text=format!("VIS-CLOUD-REGISTER-V2\n{username}\n{salt64}");
    Ok(json!({
        "username":username,
        "password_salt":salt64,
        "password_public_key":STANDARD.encode(private.verifying_key().to_bytes()),
        "registration_signature":STANDARD.encode(private.sign(text.as_bytes()).to_bytes())
    }))
}
fn password_login(identifier:&str,password:&str)->Result<Value,String>{
    let identifier=validate_identifier(identifier)?;
    let first=request("/v1/accounts/login/challenge","POST",
        Some(&json!({"identifier":identifier})),None)?;
    if first.get("kdf").and_then(Value::as_str)!=Some("argon2id-19m-t2"){
        return Err("El servidor requiere un método criptográfico no compatible".into());
    }
    let username=first.get("username").and_then(Value::as_str)
        .ok_or("Desafío VIS sin usuario")?;
    validate_username(username)?;
    let salt=first.get("salt").and_then(Value::as_str)
        .ok_or("Desafío VIS sin salt")?;
    let challenge=first.get("challenge_id").and_then(Value::as_str)
        .ok_or("Desafío VIS sin identificador")?;
    let nonce=first.get("nonce").and_then(Value::as_str)
        .ok_or("Desafío VIS sin nonce")?;
    let signer=derive(password,salt)?;
    let text=format!("VIS-CLOUD-AUTH-V2\n{username}\n{challenge}\n{nonce}");
    request("/v1/accounts/login/verify","POST",Some(&json!({
        "identifier":identifier,
        "challenge_id":challenge,
        "signature":STANDARD.encode(signer.sign(text.as_bytes()).to_bytes())
    })),None)
}
fn login_response(session:&mut Session,value:Value)->Result<AuthView,String>{
    session.username=None;session.bearer=None;session.pending=None;
    session.epoch=session.epoch.wrapping_add(1);
    let username=value.get("username").and_then(Value::as_str)
        .ok_or("El servidor no devolvió el usuario autenticado")?;
    validate_username(username)?;
    if value.get("mfa_required").and_then(Value::as_bool)==Some(true){
        let ticket=value.get("mfa_ticket").and_then(Value::as_str)
            .ok_or("Falta el desafío MFA")?;
        if ticket.len()!=43||
           !ticket.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-'||b==b'_'){
            return Err("El ticket MFA es inválido".into());
        }
        session.pending=Some(PendingMfa{username:username.into(),ticket:ticket.into()});
    }else{
        let token=value.get("token").and_then(Value::as_str)
            .ok_or("El servidor no devolvió sesión VIS")?;
        if token.len()<40{return Err("Token del servidor inválido".into());}
        session.username=Some(username.into());
        session.bearer=Some(token.into());
    }
    Ok(auth_view(session))
}
fn nonce_guard(s:&Session,expected:u64)->Result<(),String>{
    if s.epoch!=expected{return Err("La cuenta cambió durante la petición: repetí la operación".into())}
    Ok(())
}
#[tauri::command]
fn mobile_status(state:State<'_,Mutex<Session>>)->Result<AuthView,String>{
    Ok(auth_view(&state.lock().map_err(|_|"Sesión ocupada")?))
}
#[tauri::command]
async fn mobile_health()->Result<Value,String>{
    tauri::async_runtime::spawn_blocking(||{
        let health=request("/health","GET",None,None)?;
        let ready=health.get("ok").and_then(Value::as_bool).unwrap_or(false);
        Ok(json!({"reachable":true,"ready":ready,
            "schema":health.get("schema").and_then(Value::as_i64).unwrap_or(0)}))
    }).await.map_err(|_|"No se pudo verificar la conexión")?
}
#[tauri::command]
async fn mobile_login(
    state:State<'_,Mutex<Session>>,identifier:String,password:String
)->Result<AuthView,String>{
    let generation=state.lock().map_err(|_|"Sesión ocupada")?.epoch;
    let value=tauri::async_runtime::spawn_blocking(move||password_login(&identifier,&password))
        .await.map_err(|_|"Se interrumpió el inicio de sesión")??;
    let mut session=state.lock().map_err(|_|"Sesión ocupada")?;
    nonce_guard(&session,generation)?;
    login_response(&mut session,value)
}
#[tauri::command]
async fn mobile_register(
    state:State<'_,Mutex<Session>>,username:String,password:String,confirm:String
)->Result<AuthView,String>{
    if password!=confirm{return Err("Las contraseñas no coinciden".into())}
    let generation=state.lock().map_err(|_|"Sesión ocupada")?.epoch;
    let value=tauri::async_runtime::spawn_blocking(move||{
        let username=username.trim().to_ascii_lowercase();
        let payload=registration(&username,&password)?;
        request("/v1/accounts/register","POST",Some(&payload),None)
    }).await.map_err(|_|"Registro interrumpido")??;
    let mut session=state.lock().map_err(|_|"Sesión ocupada")?;
    nonce_guard(&session,generation)?;
    login_response(&mut session,value)
}
#[tauri::command]
async fn mobile_mfa(state:State<'_,Mutex<Session>>,code:String)->Result<AuthView,String>{
    if code.is_empty()||code.len()>36{return Err("Código MFA inválido".into());}
    let (pending,generation)={
        let s=state.lock().map_err(|_|"Sesión ocupada")?;
        (s.pending.clone().ok_or("No hay MFA pendiente")?,s.epoch)
    };
    let value=tauri::async_runtime::spawn_blocking(move||{
        let trimmed=code.trim();
        let payload=if trimmed.len()==6&&trimmed.bytes().all(|x|x.is_ascii_digit()){
            json!({"mfa_ticket":pending.ticket,"code":trimmed})
        }else{
            json!({"mfa_ticket":pending.ticket,"recovery_code":trimmed})
        };
        let value=request("/v1/accounts/login/mfa","POST",Some(&payload),None)?;
        if value.get("username").and_then(Value::as_str)!=Some(pending.username.as_str()){
            return Err("El segundo factor pertenece a otra identidad VIS".into());
        }
        Ok::<Value,String>(value)
    }).await.map_err(|_|"Verificación MFA interrumpida")??;
    let mut s=state.lock().map_err(|_|"Sesión ocupada")?;
    nonce_guard(&s,generation)?;
    login_response(&mut s,value)
}
#[tauri::command]
fn mobile_cancel_mfa(state:State<'_,Mutex<Session>>)->Result<AuthView,String>{
    let mut s=state.lock().map_err(|_|"Sesión ocupada")?;
    s.pending=None;s.epoch=s.epoch.wrapping_add(1);
    Ok(auth_view(&s))
}
#[tauri::command]
async fn mobile_read(state:State<'_,Mutex<Session>>,kind:String)->Result<Value,String>{
    let path=match kind.as_str(){
        "account"=>"/v1/account","social"=>"/v1/state","projects"=>"/v1/projects",
        _=>return Err("Solo se permiten consultas VIS Social de lectura".into()),
    };
    let (token,generation)={
        let s=state.lock().map_err(|_|"Sesión ocupada")?;
        (s.bearer.clone().ok_or("Iniciá sesión en VIS Ceibo")?,s.epoch)
    };
    let result=tauri::async_runtime::spawn_blocking(move||
        request(path,"GET",None,Some(&token))
    ).await.map_err(|_|"Consulta VIS interrumpida")??;
    nonce_guard(&state.lock().map_err(|_|"Sesión ocupada")?,generation)?;
    Ok(result)
}
#[tauri::command]
async fn mobile_community(
    state:State<'_,Mutex<Session>>,project_id:String
)->Result<Value,String>{
    if !(1..=64).contains(&project_id.len())||
        !project_id.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-'||b==b'_'){
        return Err("Proyecto VIS inválido".into());
    }
    let (token,generation)={
        let s=state.lock().map_err(|_|"Sesión ocupada")?;
        (s.bearer.clone().ok_or("Iniciá sesión")?,s.epoch)
    };
    let data=tauri::async_runtime::spawn_blocking(move||
        request("/v1/projects/community","POST",
            Some(&json!({"project_id":project_id})),Some(&token))
    ).await.map_err(|_|"Consulta del proyecto interrumpida")??;
    nonce_guard(&state.lock().map_err(|_|"Sesión ocupada")?,generation)?;
    Ok(data)
}
#[tauri::command]
async fn mobile_recovery_start(kind:String,identity:String)->Result<Value,String>{
    if !["password","username"].contains(&kind.as_str())||identity.len()>254{
        return Err("Solicitud de recuperación inválida".into());
    }
    tauri::async_runtime::spawn_blocking(move||
        request("/v1/recovery/start","POST",Some(&json!({
            "kind":kind,"identity":identity
        })),None)
    ).await.map_err(|_|"No se pudo iniciar la recuperación")?
}
#[tauri::command]
async fn mobile_recovery_reset(
    code:String,password:String,confirm:String,recovery_code:Option<String>
)->Result<Value,String>{
    if code.len()!=43||password!=confirm||!(10..=128).contains(&password.len()){
        return Err("Código o nueva contraseña inválidos".into());
    }
    tauri::async_runtime::spawn_blocking(move||{
        let user=request("/v1/recovery/introspect","POST",Some(&json!({"code":code})),None)?;
        let username=user.get("username").and_then(Value::as_str)
            .ok_or("Código no asociado a una cuenta válida")?;
        validate_username(username)?;
        let mut payload=registration(username,&password)?;
        let object=payload.as_object_mut().ok_or("Credencial nueva inválida")?;
        object.insert("code".into(),json!(code));
        object.insert("recovery_code".into(),json!(recovery_code.unwrap_or_default()));
        request("/v1/recovery/reset","POST",Some(&payload),None)
    }).await.map_err(|_|"Restablecimiento interrumpido")?
}
#[tauri::command]
async fn mobile_logout(state:State<'_,Mutex<Session>>)->Result<AuthView,String>{
    let bearer={
        let mut s=state.lock().map_err(|_|"Sesión ocupada")?;
        s.epoch=s.epoch.wrapping_add(1);
        s.username=None;s.pending=None;
        s.bearer.take()
    };
    if let Some(token)=bearer{
        let _=tauri::async_runtime::spawn_blocking(move||
            request("/v1/auth/logout","POST",Some(&json!({})),Some(&token))
        ).await;
    }
    mobile_status(state)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run(){
    tauri::Builder::default()
        .manage(Mutex::new(Session::default()))
        .invoke_handler(tauri::generate_handler![
            mobile_status,mobile_health,mobile_login,mobile_register,
            mobile_mfa,mobile_cancel_mfa,mobile_read,mobile_community,
            mobile_recovery_start,mobile_recovery_reset,mobile_logout
        ])
        .run(tauri::generate_context!())
        .expect("VIS Nexo Android no pudo iniciar");
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn identifiers_reject_paths_and_remote_login_overrides(){
        assert!(validate_identifier("../.env").is_err());
        assert!(validate_identifier("https://example.com").is_err());
        assert!(validate_username("Administrator").is_err());
        assert_eq!(validate_identifier("@usuario_1").unwrap(),"usuario_1");
    }
    #[test]
    fn session_never_exposes_bearer_or_ticket(){
        let s=Session{username:None,bearer:None,pending:Some(PendingMfa{
            username:"prueba".into(),ticket:"secret".into()}),epoch:2};
        let wire=serde_json::to_string(&auth_view(&s)).unwrap();
        assert!(wire.contains("mfa_required"));
        assert!(!wire.contains("secret"));
    }
}
