//! Microsoft account linking for VIS Nexo Android. Device-code public OAuth;
//! tokens stay exclusively in Rust memory and NEVER enter the WebView, VIS Ceibo,
//! intent extras, crash reports, or local profiles. Optional to VIS login.
use super::{Session,nonce_guard,validate_username};
use reqwest::{blocking::Client,blocking::Response,Url};
use serde::Serialize;
use serde_json::{json,Value};
use std::{io::Read,sync::Mutex,time::{Duration,Instant}};
use tauri::State;
const MSA_APP_ID: &str = match option_env!("VIS_MSA_CLIENT_ID") {
    Some(value) => value,
    None => "35e5d19a-b607-43cf-b22c-a659847b8e44",
};
const OAUTH_DEVICE:&str="https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode";
const OAUTH_TOKEN:&str="https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const XBL_LOGIN:&str="https://user.auth.xboxlive.com/user/authenticate";
const XSTS_LOGIN:&str="https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_LOGIN:&str="https://api.minecraftservices.com/authentication/login_with_xbox";
const MC_PROFILE:&str="https://api.minecraftservices.com/minecraft/profile";
const MAX_REPLY:u64=64*1024;
#[derive(Clone)]
struct Pending{
    owner:String, epoch:u64, code:String, expires:Instant,
    next_poll:Instant, interval:u64,
}
struct Verified{
    owner:String,epoch:u64,name:String,uuid:String,
    // Official Minecraft access token, not VIS Ceibo bearer.
    // Only native account functionality may ever read this.
    _minecraft_token:String,expires:Instant,
}
#[derive(Default)]
pub(crate) struct MicrosoftState{pending:Option<Pending>,verified:Option<Verified>}
impl MicrosoftState {pub(crate) fn clear(&mut self){self.pending=None;self.verified=None;}}
#[derive(Serialize)]
pub(crate) struct DeviceDisplay{
    user_code:String,verification_uri:String,expires_in:u64,interval:u64,
}
enum TokenPoll{Pending,SlowDown,Expired,Denied,Access(String)}
fn client()->Result<Client,String>{
    Client::builder().timeout(Duration::from_secs(25))
      .connect_timeout(Duration::from_secs(8))
      .redirect(reqwest::redirect::Policy::none())
      .build().map_err(|_|"No se pudo preparar la conexión HTTPS con Microsoft".into())
}
fn valid_client_id(id:&str)->bool{
    let b=id.as_bytes();
    b.len()==36 && [8,13,18,23].iter().all(|&i|b[i]==b'-')
      && b.iter().enumerate().all(|(i,c)|[8,13,18,23].contains(&i)||c.is_ascii_hexdigit())
}
fn app_id()->Result<&'static str,String>{
    if !valid_client_id(MSA_APP_ID){return Err("VIS_MSA_CLIENT_ID inválida".into());}
    Ok(MSA_APP_ID)
}
fn checked(response:Response,label:&str)->Result<Value,String>{
    let status=response.status();
    let mut buf=Vec::new();
    response.take(MAX_REPLY+1).read_to_end(&mut buf).map_err(|_|format!("{label}: respuesta incompleta"))?;
    if buf.len() as u64>MAX_REPLY{return Err(format!("{label}: respuesta demasiado grande"));}
    let body:Value=serde_json::from_slice(&buf).map_err(|_|format!("{label}: JSON inválido"))?;
    if !status.is_success(){
        if label=="Minecraft Services" && status.as_u16()==403 {
            return Err("Minecraft Services rechazó la aplicación VIS. Comprobá la autorización de la App ID por Mojang.".into());
        }
        let category=body["error"].as_str().unwrap_or("http_error");
        let safe=category.chars().filter(|c|c.is_ascii_alphanumeric()||*c=='_').take(48).collect::<String>();
        return Err(format!("{label}: HTTP {} ({safe})",status.as_u16()));
    }
    Ok(body)
}
fn field<'a>(v:&'a Value,key:&str)->Result<&'a str,String>{
    v[key].as_str().filter(|s|!s.is_empty()&&s.len()<=8192)
      .ok_or_else(||format!("Respuesta de autenticación sin {key}"))
}
fn begin_device()->Result<(DeviceDisplay,String,u64),String>{
    let h=client()?;
    let r=h.post(OAUTH_DEVICE).form(&[
        ("client_id",app_id()?),("scope","XboxLive.signin offline_access")
    ]).send().map_err(|_|"No se pudo solicitar el código Microsoft")?;
    let v=checked(r,"Microsoft OAuth")?;
    let user_code=field(&v,"user_code")?.to_string();
    let verification_uri=field(&v,"verification_uri")?.to_string();
    let u=Url::parse(&verification_uri).map_err(|_|"URL Microsoft inválida")?;
    if u.scheme()!="https" || !matches!(u.host_str(),Some("microsoft.com"|"www.microsoft.com"|"login.microsoftonline.com"))
       || u.port().is_some() || !u.username().is_empty() || u.password().is_some(){
        return Err("Microsoft devolvió un dominio de verificación no permitido".into());
    }
    let code=field(&v,"device_code")?.to_string();
    if code.len()>2048||user_code.len()>40{return Err("Código Microsoft fuera de límites".into());}
    let expires=v["expires_in"].as_u64().unwrap_or(900).clamp(60,1800);
    let interval=v["interval"].as_u64().unwrap_or(5).clamp(3,30);
    Ok((DeviceDisplay{user_code,verification_uri,expires_in:expires,interval},code,expires))
}
fn poll_access(p:&Pending)->Result<TokenPoll,String>{
    let http=client()?;
    let response=http.post(OAUTH_TOKEN).form(&[
      ("client_id",app_id()?),
      ("grant_type","urn:ietf:params:oauth:grant-type:device_code"),
      ("device_code",&p.code),
    ]).send().map_err(|_|"No se pudo consultar el estado Microsoft")?;
    if !response.status().is_success(){
        let status=response.status();
        let mut bytes=Vec::new();
        response.take(MAX_REPLY+1).read_to_end(&mut bytes).map_err(|_|"Respuesta Microsoft incompleta")?;
        if bytes.len() as u64>MAX_REPLY{return Err("Respuesta Microsoft demasiado grande".into());}
        let body:Value=serde_json::from_slice(&bytes).map_err(|_|"OAuth devolvió datos inválidos")?;
        return match body["error"].as_str().unwrap_or(""){
          "authorization_pending"=>Ok(TokenPoll::Pending),
          "slow_down"=>Ok(TokenPoll::SlowDown),
          "authorization_declined"=>Ok(TokenPoll::Denied),
          "expired_token"|"bad_verification_code"=>Ok(TokenPoll::Expired),
          _=>Err(format!("Microsoft no autorizó la sesión (HTTP {})",status.as_u16()))
        };
    }
    let body=checked(response,"Microsoft OAuth")?;
    Ok(TokenPoll::Access(field(&body,"access_token")?.to_string()))
}
fn exchange_minecraft(token:&str)->Result<(String,String,String,u64),String>{
    let h=client()?;
    let xbl=checked(h.post(XBL_LOGIN).header("x-xbl-contract-version","1").json(&json!({
      "Properties":{"AuthMethod":"RPS","SiteName":"user.auth.xboxlive.com","RpsTicket":format!("d={token}")},
      "RelyingParty":"http://auth.xboxlive.com","TokenType":"JWT"
    })).send().map_err(|_|"Xbox Live sin conexión")?,"Xbox Live")?;
    let xbl_token=field(&xbl,"Token")?;
    let xsts=checked(h.post(XSTS_LOGIN).header("x-xbl-contract-version","1").json(&json!({
      "Properties":{"SandboxId":"RETAIL","UserTokens":[xbl_token]},
      "RelyingParty":"rp://api.minecraftservices.com/","TokenType":"JWT"
    })).send().map_err(|_|"XSTS sin conexión")?,"XSTS")?;
    let uhs=xsts["DisplayClaims"]["xui"][0]["uhs"].as_str().filter(|s|!s.is_empty()&&s.len()<=128)
      .ok_or("XSTS sin identificador de usuario")?;
    let xsts_token=field(&xsts,"Token")?;
    let mc=checked(h.post(MC_LOGIN).json(&json!({
      "identityToken":format!("XBL3.0 x={uhs};{xsts_token}")
    })).send().map_err(|_|"Minecraft Services sin conexión")?,"Minecraft Services")?;
    let access=field(&mc,"access_token")?.to_string();
    let ttl=mc["expires_in"].as_u64().unwrap_or(3600).clamp(60,86400);
    let profile=checked(h.get(MC_PROFILE).bearer_auth(&access).send()
      .map_err(|_|"No se pudo consultar el perfil de Minecraft")?,"Minecraft Profile")?;
    let uuid=field(&profile,"id")?;
    if uuid.len()!=32||!uuid.bytes().all(|b|b.is_ascii_hexdigit()){
        return Err("Minecraft devolvió UUID inválido".into());
    }
    let name=field(&profile,"name")?;
    if !(3..=16).contains(&name.len())||
       !name.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'_'){
        return Err("Minecraft devolvió nombre de jugador inválido".into());
    }
    Ok((name.to_string(),uuid.to_ascii_lowercase(),access,ttl))
}
fn owner(s:&Session)->Result<(String,u64),String>{
    let name=s.username.as_ref().filter(|_|s.bearer.is_some())
      .ok_or("Iniciá sesión VIS Ceibo para vincular Microsoft")?;
    validate_username(name)?;
    Ok((name.to_owned(),s.epoch))
}
#[tauri::command]
pub(crate) async fn mobile_ms_begin(
    session:State<'_,Mutex<Session>>,ms:State<'_,Mutex<MicrosoftState>>
)->Result<DeviceDisplay,String>{
    let (name,epoch)=owner(&session.lock().map_err(|_|"Cuenta VIS ocupada")?)?;
    let (display,code,ttl)=tauri::async_runtime::spawn_blocking(begin_device)
      .await.map_err(|_|"Autorización Microsoft interrumpida")??;
    let (current,generation)=owner(&session.lock().map_err(|_|"Cuenta VIS ocupada")?)?;
    if current!=name||generation!=epoch{return Err("La cuenta VIS cambió durante la vinculación".into());}
    let mut m=ms.lock().map_err(|_|"Microsoft ocupado")?;
    m.clear();
    m.pending=Some(Pending{owner:name,epoch,code,expires:Instant::now()+Duration::from_secs(ttl),
      next_poll:Instant::now()+Duration::from_secs(display.interval),interval:display.interval});
    Ok(display)
}
#[tauri::command]
pub(crate) fn mobile_ms_status(
    session:State<'_,Mutex<Session>>,ms:State<'_,Mutex<MicrosoftState>>
)->Result<Value,String>{
    let (name,epoch)=owner(&session.lock().map_err(|_|"Cuenta VIS ocupada")?)?;
    let m=ms.lock().map_err(|_|"Microsoft ocupado")?;
    if let Some(v)=m.verified.as_ref().filter(|v|v.owner==name&&v.epoch==epoch&&Instant::now()<v.expires){
        return Ok(json!({"status":"connected","name":v.name,"uuid":v.uuid}));
    }
    if m.pending.as_ref().is_some_and(|p|p.owner==name&&p.epoch==epoch&&Instant::now()<p.expires){
        return Ok(json!({"status":"pending"}));
    }
    Ok(json!({"status":"idle"}))
}
#[tauri::command]
pub(crate) fn mobile_ms_disconnect(ms:State<'_,Mutex<MicrosoftState>>)->Result<Value,String>{
    ms.lock().map_err(|_|"Microsoft ocupado")?.clear();
    Ok(json!({"status":"idle"}))
}
#[tauri::command]
pub(crate) async fn mobile_ms_poll(
    session:State<'_,Mutex<Session>>,ms:State<'_,Mutex<MicrosoftState>>
)->Result<Value,String>{
    let (name,epoch)=owner(&session.lock().map_err(|_|"Cuenta VIS ocupada")?)?;
    let pending={
        let mut m=ms.lock().map_err(|_|"Microsoft ocupado")?;
        let Some(p)=m.pending.as_mut() else {return Ok(json!({"status":"idle"}));};
        if p.owner!=name||p.epoch!=epoch{return Ok(json!({"status":"idle"}));}
        if Instant::now()>=p.expires{m.pending=None;return Ok(json!({"status":"expired"}));}
        if Instant::now()<p.next_poll{
            return Ok(json!({"status":"pending","interval":p.interval}));
        }
        p.next_poll=Instant::now()+Duration::from_secs(p.interval);
        p.clone()
    };
    let key=pending.code.clone();
    let result=tauri::async_runtime::spawn_blocking(move||{
       match poll_access(&pending)?{
          TokenPoll::Access(access)=>Ok((TokenPoll::Pending,Some(exchange_minecraft(&access)?))),
          other=>Ok((other,None))
       }
    }).await.map_err(|_|"Consulta Microsoft interrumpida")?;
    let (cur,cur_epoch)=owner(&session.lock().map_err(|_|"Cuenta VIS ocupada")?)?;
    let mut m=ms.lock().map_err(|_|"Microsoft ocupado")?;
    if cur!=name||cur_epoch!=epoch||
      m.pending.as_ref().map(|p|p.code.as_str())!=Some(key.as_str()){
        return Ok(json!({"status":"idle"}));
    }
    let (state,verified)=match result{
        Ok(v)=>v,
        Err(e)=>{m.pending=None;return Err(e);}
    };
    if let Some((profile_name,uuid,access,ttl))=verified{
        m.pending=None;
        m.verified=Some(Verified{
          owner:name,epoch,name:profile_name.clone(),uuid:uuid.clone(),
          _minecraft_token:access,
          expires:Instant::now()+Duration::from_secs(ttl.saturating_sub(120).max(30))
        });
        return Ok(json!({"status":"connected","name":profile_name,"uuid":uuid}));
    }
    match state{
      TokenPoll::Pending=>Ok(json!({"status":"pending","interval":m.pending.as_ref().map_or(5,|p|p.interval)})),
      TokenPoll::SlowDown=>{
        if let Some(p)=m.pending.as_mut(){
          p.interval=(p.interval+5).min(60);
          p.next_poll=Instant::now()+Duration::from_secs(p.interval);
        }
        Ok(json!({"status":"pending","interval":m.pending.as_ref().map_or(10,|p|p.interval)}))
      }
      TokenPoll::Denied=>{m.pending=None;Ok(json!({"status":"denied"}))}
      TokenPoll::Expired=>{m.pending=None;Ok(json!({"status":"expired"}))}
      TokenPoll::Access(_)=>Err("Estado OAuth inválido".into())
    }
}
#[cfg(test)]
mod tests{
   use super::*;
   #[test] fn client_app_id_is_public_uuid(){assert!(valid_client_id(MSA_APP_ID));}
   #[test] fn verified_tokens_are_never_exposed_in_ui(){
     let v=Verified{owner:"user".into(),epoch:1,name:"MinecraftUser".into(),
       uuid:"a".repeat(32),_minecraft_token:"SECRET_DO_NOT_PRINT".into(),
       expires:Instant::now()+Duration::from_secs(100)};
     let public=json!({"status":"connected","name":v.name,"uuid":v.uuid});
     assert!(!public.to_string().contains("SECRET_DO_NOT_PRINT"));
   }
}
