//! VIS Nexo premium authentication.
//! Real Microsoft public-client OAuth device grant -> Xbox Live -> XSTS ->
//! Minecraft Services. No client secret and no mock account/profile.
//! OAuth and Minecraft tokens stay in Rust process memory, not the WebView,
//! console, files, process environment, VIS Social, logs or local profiles.
use crate::Backend;
use reqwest::blocking::Client;
use serde::Serialize;
use serde_json::{json, Value};
use std::{io::Read,sync::Mutex,time::{Duration,Instant}};
use tauri::State;

const MSA_APP_ID: &str = match option_env!("VIS_MSA_CLIENT_ID") {
    Some(value) => value,
    None => "35e5d19a-b607-43cf-b22c-a659847b8e44",
};
const OAUTH_DEVICE: &str =
    "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode";
const OAUTH_TOKEN: &str =
    "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const XBL_LOGIN: &str = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_LOGIN: &str = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MINECRAFT_LOGIN: &str =
    "https://api.minecraftservices.com/authentication/login_with_xbox";
const MINECRAFT_PROFILE: &str = "https://api.minecraftservices.com/minecraft/profile";
const MAX_REPLY: u64 = 64*1024;

#[derive(Clone)]
struct DevicePending {
    code:String, expires:Instant, next_poll:Instant, interval:u64
}
#[derive(Clone)]
pub(crate) struct MinecraftIdentity {
    pub name:String, pub uuid:String, pub access_token:String
}
struct Verified {
    profile:MinecraftIdentity,
    expires:Instant,
    owner:String
}
#[derive(Default)]
pub(crate) struct MicrosoftState {
    pending:Option<DevicePending>,
    verified:Option<Verified>
}
#[derive(Serialize)]
pub(crate) struct DeviceDisplay {
    pub user_code:String,
    pub verification_uri:String,
    pub expires_in:u64,
    pub interval:u64
}
enum TokenPoll{Waiting,SlowDown,Expired,Denied,Access(String)}

fn client()->Result<Client,String>{
    Client::builder().timeout(Duration::from_secs(25)).build()
      .map_err(|_|"No se pudo preparar HTTPS para Microsoft".into())
}
fn app_id()->Result<&'static str,String>{
    let id=MSA_APP_ID.trim();
    if uuid::Uuid::parse_str(id).is_err() {
        return Err("VIS_MSA_CLIENT_ID inválido; debe ser la AppID de Mojang".into());
    }
    Ok(id)
}
fn safe_error(body:&Value)->String{
    body["error"].as_str().unwrap_or("oauth_error").chars()
      .filter(|c|c.is_ascii_alphanumeric()||*c=='_').take(55).collect()
}
fn checked_json(response:reqwest::blocking::Response,label:&str)->Result<Value,String>{
    let status=response.status();
    // Hard cap on all remote response bodies.
    let mut bytes=Vec::new();
    response.take(MAX_REPLY+1).read_to_end(&mut bytes)
        .map_err(|_|format!("{label}: fallo de conexión HTTPS"))?;
    if bytes.len() as u64>MAX_REPLY {return Err(format!("{label}: respuesta excesiva"))}
    let data:Value=serde_json::from_slice(&bytes)
        .map_err(|_|format!("{label}: respuesta inválida"))?;
    if !status.is_success(){
        if label=="Minecraft Services" && status.as_u16()==403 {
            return Err("Minecraft Services devolvió 403. Comprobá que Mojang autorizó exactamente la Application ID de VIS Nexo.".into());
        }
        return Err(format!("{label}: HTTP {} ({})",status.as_u16(),safe_error(&data)));
    }
    Ok(data)
}
fn extract_string<'a>(data:&'a Value,key:&str,label:&str)->Result<&'a str,String>{
    let s=data[key].as_str().filter(|x|!x.is_empty())
      .ok_or_else(||format!("{label}: falta {key}"))?;
    if s.len()>8192{return Err(format!("{label}: campo demasiado grande"))}
    Ok(s)
}
fn start_device(client:&Client)->Result<(DeviceDisplay,DevicePending),String>{
    let response=client.post(OAUTH_DEVICE)
      .form(&[("client_id",app_id()?),("scope","XboxLive.signin offline_access")])
      .send().map_err(|_|"Microsoft: no se pudo solicitar el código de acceso")?;
    let data=checked_json(response,"Microsoft OAuth")?;
    let user_code=extract_string(&data,"user_code","Microsoft OAuth")?.to_owned();
    let verification_uri=extract_string(&data,"verification_uri","Microsoft OAuth")?.to_owned();
    // Only permit the official Microsoft device login page.
    let parsed=url::Url::parse(&verification_uri)
       .map_err(|_|"Microsoft devolvió un enlace inválido")?;
    if parsed.scheme()!="https" || !matches!(parsed.host_str(),Some("microsoft.com"|"www.microsoft.com"|"login.microsoftonline.com")) {
        return Err("Microsoft devolvió un dominio de verificación inesperado".into());
    }
    let code=extract_string(&data,"device_code","Microsoft OAuth")?.to_owned();
    if code.len()>2048||user_code.len()>40 {return Err("Código Microsoft demasiado largo".into())}
    let expires_in=data["expires_in"].as_u64().unwrap_or(900).clamp(60,1800);
    let interval=data["interval"].as_u64().unwrap_or(5).clamp(3,30);
    let pending=DevicePending{code,expires:Instant::now()+Duration::from_secs(expires_in),
       next_poll:Instant::now()+Duration::from_secs(interval),interval};
    Ok((DeviceDisplay{user_code,verification_uri,expires_in,interval},pending))
}
fn poll_access(client:&Client,pending:&DevicePending)->Result<TokenPoll,String>{
    let response=client.post(OAUTH_TOKEN).form(&[
        ("client_id",app_id()?),
        ("grant_type","urn:ietf:params:oauth:grant-type:device_code"),
        ("device_code",pending.code.as_str())
    ]).send().map_err(|_|"Microsoft: no se pudo comprobar el inicio de sesión")?;
    let status=response.status();
    let mut bytes=Vec::new();
    response.take(MAX_REPLY+1).read_to_end(&mut bytes)
      .map_err(|_|"Microsoft: no se pudo leer la respuesta")?;
    if bytes.len() as u64>MAX_REPLY{return Err("Respuesta Microsoft demasiado grande".into())}
    let data:Value=serde_json::from_slice(&bytes)
      .map_err(|_|"Microsoft: respuesta OAuth inválida")?;
    if !status.is_success(){
        return match data["error"].as_str().unwrap_or_default(){
            "authorization_pending"=>Ok(TokenPoll::Waiting),
            "slow_down"=>Ok(TokenPoll::SlowDown),
            "authorization_declined"=>Ok(TokenPoll::Denied),
            "expired_token"|"bad_verification_code"=>Ok(TokenPoll::Expired),
            _=>Err(format!("Microsoft OAuth: {} (HTTP {})",
                  safe_error(&data),status.as_u16()))
        };
    }
    Ok(TokenPoll::Access(extract_string(&data,"access_token","Microsoft OAuth")?.into()))
}
fn exchange_xbox(client:&Client,ms_token:&str)->Result<MinecraftIdentity,String>{
    let r=client.post(XBL_LOGIN)
        .header("x-xbl-contract-version","1")
        .json(&json!({
          "Properties":{"AuthMethod":"RPS","SiteName":"user.auth.xboxlive.com",
            "RpsTicket":format!("d={ms_token}")},
          "RelyingParty":"http://auth.xboxlive.com","TokenType":"JWT"
        })).send().map_err(|_|"Xbox Live: no se pudo conectar")?;
    let xbl=checked_json(r,"Xbox Live")?;
    let xbox_token=extract_string(&xbl,"Token","Xbox Live")?;
    let r=client.post(XSTS_LOGIN)
        .header("x-xbl-contract-version","1")
        .json(&json!({"Properties":{"SandboxId":"RETAIL","UserTokens":[xbox_token]},
          "RelyingParty":"rp://api.minecraftservices.com/","TokenType":"JWT"}))
        .send().map_err(|_|"XSTS: no se pudo conectar")?;
    let xsts=checked_json(r,"XSTS")?;
    let hash=xsts["DisplayClaims"]["xui"][0]["uhs"].as_str()
        .filter(|h|!h.is_empty()&&h.len()<=128)
        .ok_or("XSTS: falta el identificador Xbox")?;
    let token=extract_string(&xsts,"Token","XSTS")?;
    let r=client.post(MINECRAFT_LOGIN)
        .json(&json!({"identityToken":format!("XBL3.0 x={hash};{token}")}))
        .send().map_err(|_|"Minecraft Services: no se pudo conectar")?;
    let minecraft=checked_json(r,"Minecraft Services")?;
    let access_token=extract_string(&minecraft,"access_token","Minecraft Services")?.to_owned();
    let r=client.get(MINECRAFT_PROFILE)
        .bearer_auth(&access_token)
        .send().map_err(|_|"Minecraft: no se pudo consultar el perfil")?;
    let profile=checked_json(r,"Minecraft Profile")?;
    let uuid=extract_string(&profile,"id","Minecraft Profile")?;
    if uuid.len()!=32 || !uuid.bytes().all(|b|b.is_ascii_hexdigit()){
        return Err("Minecraft devolvió un UUID de perfil inválido".into())
    }
    let name=extract_string(&profile,"name","Minecraft Profile")?;
    if !(3..=16).contains(&name.len()) ||
       !name.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'_'){
        return Err("Minecraft devolvió un nombre de jugador inválido".into())
    }
    Ok(MinecraftIdentity{name:name.into(),uuid:uuid.to_ascii_lowercase(),access_token})
}
#[tauri::command]
pub(crate) async fn microsoft_begin(
    state:State<'_,Mutex<MicrosoftState>>
)->Result<DeviceDisplay,String>{
    let (display,pending)=tauri::async_runtime::spawn_blocking(||start_device(&client()?))
       .await.map_err(|_|"La autorización Microsoft se interrumpió")??;
    let mut m=state.lock().map_err(|_|"Estado de Microsoft bloqueado")?;
    m.pending=Some(pending);
    m.verified=None;
    Ok(display)
}
#[tauri::command]
pub(crate) fn microsoft_cancel(state:State<'_,Mutex<MicrosoftState>>)->Result<(),String>{
    let mut m=state.lock().map_err(|_|"Estado de Microsoft bloqueado")?;
    m.pending=None;
    Ok(())
}
#[tauri::command]
pub(crate) async fn microsoft_poll(
    backend:State<'_,Mutex<Backend>>,
    state:State<'_,Mutex<MicrosoftState>>
)->Result<Value,String>{
    let pending={
      let mut m=state.lock().map_err(|_|"Estado de Microsoft bloqueado")?;
      let Some(p)=m.pending.as_mut() else{return Ok(json!({"status":"idle"}))};
      if Instant::now()>=p.expires {
          m.pending=None;return Ok(json!({"status":"expired"}));
      }
      if Instant::now()<p.next_poll{return Ok(json!({"status":"pending","interval":p.interval}))}
      p.next_poll=Instant::now()+Duration::from_secs(p.interval);
      p.clone()
    };
    let response=tauri::async_runtime::spawn_blocking(move||{
       let http=client()?;
       match poll_access(&http,&pending)? {
         TokenPoll::Access(ms_token)=>Ok((TokenPoll::Waiting,Some(exchange_xbox(&http,&ms_token)?))),
         other=>Ok((other,None))
       }
    }).await.map_err(|_|"La autorización de Microsoft se interrumpió")?;
    let (phase,verified): (TokenPoll,Option<MinecraftIdentity>)=match response {
      Ok(Ok(v))=>v,
      Ok(Err(e))=>{state.lock().map_err(|_|"Estado Microsoft bloqueado")?.pending=None;return Err(e);},
      Err(e)=>return Err(e),
    };
    if let Some(identity)=verified {
       let mut backend=backend.lock().map_err(|_|"Cuenta local bloqueada")?;
       let local=backend.storage.ensure_microsoft_profile(&identity.uuid)?;
       backend.active_user=Some(local.clone());
       backend.guest_name=None;
       backend.presence="online".into();
       backend.add_recent(&local,"microsoft")?;
       let snapshot=backend.snapshot();
       let profile_name=identity.name.clone();
       let mut state=state.lock().map_err(|_|"Estado de Microsoft bloqueado")?;
       state.pending=None;
       state.verified=Some(Verified{profile:identity,expires:Instant::now()+Duration::from_secs(20*3600),owner:local});
       return Ok(json!({"status":"connected","snapshot":snapshot,
          "minecraft_name":profile_name}))
    }
    let mut state=state.lock().map_err(|_|"Estado de Microsoft bloqueado")?;
    match phase{
      TokenPoll::Waiting=>Ok(json!({"status":"pending","interval":state.pending.as_ref().map_or(5,|p|p.interval)})),
      TokenPoll::SlowDown=>{
         if let Some(p)=state.pending.as_mut(){
           p.interval=(p.interval+5).min(60);
           p.next_poll=Instant::now()+Duration::from_secs(p.interval);
         }
         Ok(json!({"status":"pending","interval":state.pending.as_ref().map_or(10,|p|p.interval)}))
      }
      TokenPoll::Expired=>{state.pending=None;Ok(json!({"status":"expired"}))}
      TokenPoll::Denied=>{state.pending=None;Ok(json!({"status":"denied"}))}
      TokenPoll::Access(_)=>Err("Estado OAuth inesperado".into())
    }
}
/// Experimental Horizon Launch API 0.1 accepts the session via a one-time
/// local JSON file that horizon.rs sends to the game via stdin. Never persist
/// this file or expose the access token to JavaScript, console or game args.
pub(crate) fn temporary_horizon_session(
    dir:&std::path::Path,identity:&MinecraftIdentity
)->Result<std::path::PathBuf,String>{
    use std::fs::{self,OpenOptions};
    use std::io::Write;
    crate::instance_guard::private_paths(dir,&[".vis/tmp"])?;
    let tmp=dir.join(".vis/tmp");
    fs::create_dir_all(&tmp).map_err(|e|e.to_string())?;
    use rand_core::{OsRng,RngCore};
    let mut nonce=[0u8;16];
    OsRng.fill_bytes(&mut nonce);
    let path=tmp.join(format!("msa-{}.json",uuid::Uuid::from_bytes(nonce).simple()));
    nonce.fill(0);
    let mut opts=OpenOptions::new();
    opts.create_new(true).write(true);
    #[cfg(unix)]{
      use std::os::unix::fs::OpenOptionsExt;
      opts.mode(0o600);
    }
    let mut file=opts.open(&path).map_err(|e|e.to_string())?;
    let json=serde_json::to_vec(&json!({
      "name":identity.name,
      "uuid":identity.uuid,
      "access_token":identity.access_token,
      "user_type":"msa"
    })).map_err(|_|"No se pudo crear el ticket Horizon")?;
    if let Err(err)=file.write_all(&json){
       drop(file);let _=fs::remove_file(&path);
       return Err(format!("No se pudo preparar la sesión Horizon: {err}"))
    }
    Ok(path)
}

impl MicrosoftState{
    pub(crate) fn game_identity(&self,owner:&str)->Result<Option<MinecraftIdentity>,String>{
        let Some(s)=self.verified.as_ref().filter(|s|s.owner==owner) else{return Ok(None)};
        if Instant::now()>=s.expires {
            return Err("La sesión premium expiró. Volvé a iniciar sesión con Microsoft.".into())
        }
        Ok(Some(s.profile.clone()))
    }
    pub(crate) fn clear(&mut self){self.pending=None;self.verified=None;}
    pub(crate) fn is_microsoft_profile(&self,owner:&str)->bool {
        self.verified.as_ref().is_some_and(|s|s.owner==owner)
    }
}
#[cfg(test)]
mod tests{
 use super::*;
 #[test]fn uses_allowlisted_public_client_id(){
    assert!(uuid::Uuid::parse_str(app_id().unwrap()).is_ok());
    assert!(OAUTH_DEVICE.starts_with("https://login.microsoftonline.com/consumers/"));
    assert!(MINECRAFT_PROFILE.starts_with("https://api.minecraftservices.com/"));
 }
 #[test]fn errors_never_include_oauth_token(){
    let payload=json!({"error":"invalid_grant","error_description":"secret"});
    assert_eq!(safe_error(&payload),"invalid_grant");
 }
}
