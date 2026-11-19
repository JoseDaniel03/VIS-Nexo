//! VIS Nexo Android — intentionally small, connection-first native shell.
//! Desktop game launch/install, filesystem edits and Horizon are not exposed.
//! Password derivation and Cloudflare bearer tokens never enter the WebView.
use argon2::Argon2;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use ed25519_dalek::{Signer, SigningKey};
use rand_core::{OsRng, RngCore};
use reqwest::blocking::Client;
use serde::{Serialize, Deserialize};
use serde_json::{json, Value};
use std::{sync::{Mutex, OnceLock}, time::Duration, path::{Path,PathBuf}, fs};
use tauri::{State, Manager, AppHandle};

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
    let guard=state.lock().map_err(|_|"Sesión ocupada")?;
    Ok(auth_view(&guard))
}
#[tauri::command]
async fn mobile_health()->Result<Value,String>{
    tauri::async_runtime::spawn_blocking(||{
        // A live Worker returns 503 when D1 migrations are missing. Report
        // this as a reachable service requiring setup, not a network outage.
        let response=http()?.get(format!("{SERVER}/health")).send()
            .map_err(|_|"No hay conexión HTTPS con VIS Ceibo")?;
        let code=response.status().as_u16();
        let health:Value=response.json()
            .map_err(|_|"Respuesta de salud VIS no compatible")?;
        let status=health.get("status").and_then(Value::as_str).unwrap_or("unknown");
        let schema=health.get("schema").and_then(Value::as_i64).unwrap_or(0);
        Ok(json!({"reachable":true,"ready":code==200&&status=="ready"&&schema>=13,
            "http_status":code,"status":status,"schema":schema}))
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
    let guard=state.lock().map_err(|_|"Sesión ocupada")?;
    nonce_guard(&guard,generation)?;
    drop(guard);
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
    let guard=state.lock().map_err(|_|"Sesión ocupada")?;
    nonce_guard(&guard,generation)?;
    drop(guard);
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
/// Narrow allowlist of VIS actions. The WebView never chooses arbitrary URLs,
/// HTTP methods or authentication headers. Server always checks authorization.
fn action_route(action:&str)->Result<(&'static str,&'static str,usize),String>{
    let route=match action{
        // VIS Portals contacts, presence and account state
        "friends.request"=>("POST","/v1/friends/request",1024),
        "friends.accept"=>("POST","/v1/friends/accept",1024),
        "friends.alias"=>("POST","/v1/friends/alias",1024),
        "presence.set"=>("POST","/v1/presence",1024),
        "account.display"=>("POST","/v1/account/display",512),
        "account.handle"=>("POST","/v1/account/handle",512),
        "account.email.request"=>("POST","/v1/account/email/request",1024),
        "account.mfa.status"=>("GET","/v1/account/mfa/status",0),
        "account.mfa.setup"=>("POST","/v1/account/mfa/setup",512),
        "account.mfa.confirm"=>("POST","/v1/account/mfa/confirm",512),
        "account.mfa.verify"=>("POST","/v1/account/mfa/verify",512),
        "account.mfa.rotate"=>("POST","/v1/account/mfa/rotate-codes",512),
        "account.sessions"=>("GET","/v1/account/sessions",0),
        "account.sessions.revoke"=>("POST","/v1/account/sessions/revoke",512),
        "avatar.get"=>("POST","/v1/avatar/get",1024),
        "avatar.upload"=>("POST","/v1/avatar/upload",34000),
        "skin.get"=>("POST","/v1/skins/get",1024),
        "skin.upload"=>("POST","/v1/skins/upload",90000),
        "skin.delete"=>("POST","/v1/skins/delete",512),
        // VIS Universe and community membership; staff/admin checked by D1
        "projects.subscribe"=>("POST","/v1/projects/subscribe",512),
        "projects.unsubscribe"=>("POST","/v1/projects/unsubscribe",512),
        "projects.community"=>("POST","/v1/projects/community",512),
        "projects.request_join"=>("POST","/v1/projects/request-join",1024),
        "projects.manage"=>("POST","/v1/admin/projects/upsert",1024),
        "projects.staff"=>("POST","/v1/admin/projects/staff",1024),
        "community.members"=>("POST","/v1/admin/projects/community-members",1024),
        "community.review"=>("POST","/v1/admin/projects/review-join",1024),
        "community.policy"=>("POST","/v1/admin/projects/community-policy",1024),
        "community.media"=>("POST","/v1/admin/projects/community-media",2048),
        "accounts.global_admin"=>("POST","/v1/admin/accounts/global-admin",512),
        "accounts.role"=>("POST","/v1/admin/accounts/role",512),
        "accounts.disable"=>("POST","/v1/admin/accounts/disable",512),
        _=>return Err("Esta operación no está habilitada en VIS Nexo Android".into())
    };
    Ok(route)
}
#[tauri::command]
async fn mobile_action(
    state:State<'_,Mutex<Session>>,
    action:String,body:Option<Value>
)->Result<Value,String>{
    let (method,path,max_bytes)=action_route(&action)?;
    let encoded=body.as_ref().map(|v|serde_json::to_vec(v)).transpose()
        .map_err(|_|"Datos VIS inválidos")?;
    if method=="GET" && body.is_some(){
        return Err("Esta lectura no permite enviar datos".into());
    }
    if method=="POST" && !body.as_ref().is_some_and(Value::is_object){
        return Err("Faltan datos JSON válidos".into());
    }
    if encoded.as_ref().is_some_and(|v|v.len()>max_bytes){
        return Err("Solicitud demasiado grande para VIS Nexo Android".into());
    }
    let (token,generation)={
        let s=state.lock().map_err(|_|"Sesión VIS ocupada")?;
        (s.bearer.clone().ok_or("Iniciá sesión VIS Ceibo")?,s.epoch)
    };
    let reply=tauri::async_runtime::spawn_blocking(move||{
        request(path,method,body.as_ref(),Some(&token))
    }).await.map_err(|_|"Se interrumpió la operación VIS")??;
    let guard=state.lock().map_err(|_|"Sesión VIS ocupada")?;
    nonce_guard(&guard,generation)?;
    drop(guard);
    Ok(reply)
}
#[tauri::command]
async fn mobile_email_verify(code:String)->Result<Value,String>{
    if code.len()!=43||!code.bytes().all(|b|
        b.is_ascii_alphanumeric()||b==b'_'||b==b'-'){
        return Err("Código de correo inválido".into());
    }
    tauri::async_runtime::spawn_blocking(move||
        request("/v1/recovery/email/verify","POST",Some(&json!({"code":code})),None)
    ).await.map_err(|_|"Verificación de correo interrumpida")?
}
/// Password change requires a fresh proof of the CURRENT password. Reuses
/// the exact VIS Ceibo Argon2id challenge, with optional MFA completion.
#[tauri::command]
async fn mobile_password_change(
    state:State<'_,Mutex<Session>>,
    current_password:String,password:String,confirm:String,mfa_code:Option<String>
)->Result<AuthView,String>{
    if password!=confirm || !(10..=128).contains(&password.len())||
       !(10..=128).contains(&current_password.len()){
        return Err("Revisá tu contraseña anterior y la nueva (10–128 caracteres)".into());
    }
    let (username,generation)={
        let s=state.lock().map_err(|_|"Sesión ocupada")?;
        (s.username.clone().filter(|_|s.bearer.is_some())
            .ok_or("Iniciá sesión en VIS Ceibo")?,s.epoch)
    };
    let result=tauri::async_runtime::spawn_blocking(move||{
        let mut auth=password_login(&username,&current_password)?;
        if auth.get("username").and_then(Value::as_str)!=Some(username.as_str()){
            return Err("La contraseña no corresponde a tu cuenta VIS".into());
        }
        let token=if auth.get("mfa_required").and_then(Value::as_bool)==Some(true){
            let ticket=auth.get("mfa_ticket").and_then(Value::as_str)
                .ok_or("Falta el desafío MFA")?;
            let code=mfa_code.as_deref().unwrap_or("").trim();
            if code.is_empty(){return Err("Ingresá el código MFA para cambiar tu contraseña".into());}
            let payload=if code.len()==6&&code.bytes().all(|b|b.is_ascii_digit()){
                json!({"mfa_ticket":ticket,"code":code})
            }else{
                json!({"mfa_ticket":ticket,"recovery_code":code})
            };
            auth=request("/v1/accounts/login/mfa","POST",Some(&payload),None)?;
            if auth.get("username").and_then(Value::as_str)!=Some(username.as_str()){
                return Err("El segundo factor no corresponde a la cuenta VIS".into());
            }
            auth.get("token").and_then(Value::as_str)
                .ok_or("No se completó el segundo factor")?.to_owned()
        }else{
            auth.get("token").and_then(Value::as_str)
                .ok_or("No se pudo autenticar nuevamente")?.to_owned()
        };
        let payload=registration(&username,&password)?;
        request("/v1/account/password/change","POST",Some(&payload),Some(&token))
    }).await.map_err(|_|"Cambio de contraseña interrumpido")??;
    let _=result;
    let mut s=state.lock().map_err(|_|"Sesión ocupada")?;
    nonce_guard(&s,generation)?;
    s.epoch=s.epoch.wrapping_add(1);s.username=None;s.bearer=None;s.pending=None;
    Ok(auth_view(&s))
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

// Phone-local instance manifests. The runtime is deliberately unavailable:
// creating an instance prepares metadata/folders, not an installed game.
#[derive(Clone,Serialize,Deserialize)]
struct MobileInstance {
    id:String,
    name:String,
    engine:String,
    version:String,
    loader:String,
    project_id:String,
    created_at:u64
}
fn instance_root(app:&AppHandle,user:&str)->Result<PathBuf,String>{
    validate_username(user)?;
    let root=app.path().app_data_dir()
        .map_err(|_|"No se pudo abrir el almacenamiento Android")?
        .join("mobile-worlds").join(user);
    fs::create_dir_all(&root).map_err(|_|"Sin acceso al directorio de instancias")?;
    Ok(root)
}
fn instances_file(app:&AppHandle,user:&str)->Result<PathBuf,String>{
    Ok(instance_root(app,user)?.join("instances.json"))
}
fn read_instances(path:&Path)->Result<Vec<MobileInstance>,String>{
    if !path.is_file(){return Ok(Vec::new());}
    let data=fs::read(path).map_err(|_|"No se pudo leer la lista de instancias")?;
    if data.len()>1024*1024{return Err("El manifiesto local de instancias es demasiado grande".into());}
    serde_json::from_slice(&data)
        .map_err(|_|"El archivo de instancias está dañado; no se sobrescribirá".into())
}
fn persist_instances(path:&Path,items:&[MobileInstance])->Result<(),String>{
    let bytes=serde_json::to_vec_pretty(items)
        .map_err(|_|"No se pudieron serializar las instancias")?;
    if bytes.len()>1024*1024{return Err("Demasiadas instancias locales".into());}
    let mut rand=[0u8;12];OsRng.fill_bytes(&mut rand);
    let suffix=rand.iter().map(|v|format!("{v:02x}")).collect::<String>();
    let tmp=path.with_extension(format!("tmp.{suffix}"));
    let result=(||{
        use std::io::Write;
        let mut out=fs::OpenOptions::new().write(true).create_new(true).open(&tmp)
            .map_err(|_|"No se pudo preparar el manifiesto Android")?;
        out.write_all(&bytes).map_err(|_|"No se pudo escribir el manifiesto")?;
        out.sync_all().map_err(|_|"No se pudo guardar el manifiesto")?;
        fs::rename(&tmp,path).map_err(|_|"No se pudo confirmar el manifiesto Android")
    })();
    if result.is_err(){let _=fs::remove_file(tmp);}
    Ok(result?)
}
fn current_android_user(state:&Mutex<Session>)->Result<String,String>{
    let s=state.lock().map_err(|_|"La cuenta está ocupada")?;
    if s.bearer.is_none(){return Err("Iniciá sesión en VIS Ceibo para gestionar instancias".into());}
    let username=s.username.clone().ok_or("No hay un usuario activo")?;
    validate_username(&username)?;
    Ok(username)
}
fn game_metadata_ok(name:&str,engine:&str,version:&str,loader:&str,project:&str)->Result<(),String>{
    if name.trim().is_empty()||name.chars().count()>64||
       name.chars().any(|c|c.is_control()||c=='/'||c=='\\'){
        return Err("Nombre de instancia inválido".into());
    }
    if !["java","horizon"].contains(&engine){
        return Err("Seleccioná Java o Rust Horizon".into());
    }
    if !(1..=48).contains(&version.len())||!version.bytes().all(|c|
        c.is_ascii_alphanumeric()||c==b'.'||c==b'-'||c==b'_'){
        return Err("La versión de juego no es válida".into());
    }
    if !["vanilla","fabric","quilt","neoforge","forge"].contains(&loader){
        return Err("Loader no compatible".into());
    }
    if engine=="horizon"&&loader!="vanilla"{
        return Err("Los loaders de Java no son compatibles con Horizon Rust".into());
    }
    if !project.is_empty()&&(project.len()>48||!project.bytes().all(|c|
        c.is_ascii_lowercase()||c.is_ascii_digit()||c==b'-'||c==b'_')){
        return Err("Proyecto VIS Universe inválido".into());
    }
    Ok(())
}
#[tauri::command]
fn mobile_instances(state:State<'_,Mutex<Session>>,app:AppHandle)->Result<Vec<MobileInstance>,String>{
    let user=current_android_user(&state)?;
    read_instances(&instances_file(&app,&user)?)
}
#[tauri::command]
fn mobile_instance_create(
    state:State<'_,Mutex<Session>>,app:AppHandle,
    name:String,engine:String,version:String,loader:String,project_id:Option<String>
)->Result<MobileInstance,String>{
    let user=current_android_user(&state)?;
    let project=project_id.unwrap_or_default();
    game_metadata_ok(&name,&engine,&version,&loader,&project)?;
    let path=instances_file(&app,&user)?;
    let mut items=read_instances(&path)?;
    if items.len()>=128{return Err("El máximo es 128 instancias Android".into());}
    if items.iter().any(|i|i.name.eq_ignore_ascii_case(name.trim())){
        return Err("Ya tenés una instancia con ese nombre".into());
    }
    let mut random=[0u8;16];OsRng.fill_bytes(&mut random);
    let id=random.iter().map(|v|format!("{v:02x}")).collect::<String>();
    let created_at=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default().as_secs();
    let instance=MobileInstance{
        id:id.clone(),name:name.trim().into(),engine,version,loader,
        project_id:project,created_at
    };
    let root=instance_root(&app,&user)?.join(&id);
    for component in ["worlds","mods","config","resourcepacks","backups"]{
        fs::create_dir_all(root.join(component))
            .map_err(|_|"No se pudieron preparar las carpetas Android")?;
    }
    items.push(instance.clone());
    persist_instances(&path,&items)?;
    Ok(instance)
}
#[tauri::command]
fn mobile_instance_remove(
    state:State<'_,Mutex<Session>>,app:AppHandle,id:String
)->Result<usize,String>{
    if id.len()!=32||!id.bytes().all(|b|b.is_ascii_hexdigit()){
        return Err("Identificador de instancia incorrecto".into());
    }
    let user=current_android_user(&state)?;
    let path=instances_file(&app,&user)?;
    let mut items=read_instances(&path)?;
    let initial=items.len();
    items.retain(|i|i.id!=id);
    if items.len()==initial{return Err("Instancia inexistente".into());}
    // Deliberately keep instance folders: worlds/backups must NOT be removed
    // just because a launcher metadata entry was unlinked.
    persist_instances(&path,&items)?;
    Ok(items.len())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run(){
    tauri::Builder::default()
        .manage(Mutex::new(Session::default()))
        .invoke_handler(tauri::generate_handler![
            mobile_status,mobile_health,mobile_login,mobile_register,
            mobile_mfa,mobile_cancel_mfa,mobile_read,mobile_community,
            mobile_recovery_start,mobile_recovery_reset,mobile_logout,
            mobile_action,mobile_email_verify,mobile_password_change,
            mobile_instances,mobile_instance_create,mobile_instance_remove
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
    fn mobile_instance_metadata_is_sandboxed(){
        assert!(game_metadata_ok("Survival","java","26.3","fabric","virgoland").is_ok());
        assert!(game_metadata_ok("Horizon","horizon","26.3","vanilla","").is_ok());
        assert!(game_metadata_ok("../escape","java","26.3","fabric","").is_err());
        assert!(game_metadata_ok("Bad","horizon","26.3","fabric","").is_err());
        assert!(game_metadata_ok("Bad","java","../../secret","vanilla","").is_err());
        assert!(game_metadata_ok("Good","java","26.3","fabric","../escape").is_err());
        assert!(game_metadata_ok("Bad\nName","java","26.3","vanilla","").is_err());
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
