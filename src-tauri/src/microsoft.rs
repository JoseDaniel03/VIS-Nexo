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
use crate::minecraft::PremiumIdentity as MinecraftIdentity;
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
fn exchange_xbox(client:&Client,ms_token:&str)->Result<(MinecraftIdentity,u64),String>{
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
    let ttl=minecraft["expires_in"].as_u64().unwrap_or(3600).clamp(60,86400);
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
    Ok((MinecraftIdentity{name:name.into(),uuid:uuid.to_ascii_lowercase(),access_token},ttl))
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
    let challenge_key=pending.code.clone();
    let response=tauri::async_runtime::spawn_blocking(move||{
       let http=client()?;
       match poll_access(&http,&pending)? {
         TokenPoll::Access(ms_token)=>Ok((TokenPoll::Waiting,Some(exchange_xbox(&http,&ms_token)?))),
         other=>Ok((other,None))
       }
    }).await.map_err(|_|"La autorización de Microsoft se interrumpió")?;
    let (phase,verified): (TokenPoll,Option<(MinecraftIdentity,u64)>)=match response {
      Ok(value)=>value,
      Err(e)=>{state.lock().map_err(|_|"Estado Microsoft bloqueado")?.pending=None;return Err(e);},
    };
    // A user can cancel or replace the code while the HTTP exchange is in
    // flight. The old exchange must not log them in after that cancellation.
    // Lock order: Microsoft session first, then local profile, as at logout.
    let mut state=state.lock().map_err(|_|"Estado de Microsoft bloqueado")?;
    if state.pending.as_ref().map(|p|p.code.as_str())!=Some(challenge_key.as_str()){
        return Ok(json!({"status":"idle"}));
    }
    if let Some((identity,ttl))=verified {
       let mut backend=backend.lock().map_err(|_|"Cuenta local bloqueada")?;
       let local=backend.storage.ensure_microsoft_profile(&identity.uuid)?;
       backend.active_user=Some(local.clone());
       backend.guest_name=None;
       backend.presence="online".into();
       backend.add_recent(&local,"microsoft")?;
       let snapshot=backend.snapshot();
       let profile_name=identity.name.clone();
       state.pending=None;
       state.verified=Some(Verified{profile:identity,expires:Instant::now()+Duration::from_secs(ttl.saturating_sub(120).max(30)),owner:local});
       return Ok(json!({"status":"connected","snapshot":snapshot,
          "minecraft_name":profile_name}))
    }
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
// Official Minecraft Java profile management. Unlike VIS Social avatars,
// these operations change only skins/capes that the Microsoft account owns.
// Credentials never leave Rust; the frontend receives cosmetic metadata only.
// Keep the token in memory and never include it in serialized responses.
fn premium_identity(
    backend:&State<'_,Mutex<Backend>>,ms:&State<'_,Mutex<MicrosoftState>>
)->Result<MinecraftIdentity,String>{
    let user=backend.lock().map_err(|_|"Perfil VIS ocupado")?
        .active_user.clone().ok_or("Iniciá sesión con Microsoft")?;
    let session=ms.lock().map_err(|_|"Sesión Premium bloqueada")?;
    session.game_identity(&user)?
        .ok_or_else(||"Iniciá sesión con Microsoft Premium para editar tu skin o capa".into())
}
fn owned_profile(http:&Client,identity:&MinecraftIdentity)->Result<Value,String>{
    let reply=http.get(MINECRAFT_PROFILE).bearer_auth(&identity.access_token)
        .send().map_err(|_|"No se pudo consultar Minecraft Services")?;
    let profile=checked_json(reply,"Perfil Minecraft")?;
    if !profile["id"].as_str().is_some_and(|id|id.eq_ignore_ascii_case(&identity.uuid)){
        return Err("El perfil Minecraft cambió durante la sesión; volvé a iniciar sesión".into());
    }
    Ok(profile)
}
fn safe_texture(value:&str)->String{
    let Ok(url)=url::Url::parse(value) else{return String::new()};
    let path=url.path();
    if !["http","https"].contains(&url.scheme())
        || url.host_str()!=Some("textures.minecraft.net")
        || url.port().is_some() || !url.username().is_empty()
        || url.password().is_some() || url.query().is_some()
        || !path.starts_with("/texture/") {
        return String::new();
    }
    let token=&path["/texture/".len()..];
    if token.is_empty() || token.len()>128 || !token.bytes().all(|c|c.is_ascii_hexdigit()){
        return String::new();
    }
    format!("https://textures.minecraft.net{path}")
}
fn public_cosmetics(profile:&Value)->Value{
    let list=|key:&str|{
        profile[key].as_array().map(|arr|arr.iter().take(100).map(|item|{
            json!({
                "id":item["id"].as_str().unwrap_or(""),
                "state":item["state"].as_str().unwrap_or("INACTIVE"),
                "variant":item["variant"].as_str().unwrap_or("CLASSIC"),
                "alias":item["alias"].as_str().unwrap_or(""),
                "url":safe_texture(item["url"].as_str().unwrap_or(""))
            })
        }).collect::<Vec<_>>()).unwrap_or_default()
    };
    json!({"name":profile["name"],"uuid":profile["id"],
        "skins":list("skins"),"capes":list("capes")})
}
/// This is a private local *texture history*, not an invented Mojang
/// inventory. Minecraft Services may expose only the currently equipped skin.
fn minecraft_skin_history(
    private_root:&std::path::Path,uuid:&str,official:&Value
)->Result<Vec<Value>,String>{
    if uuid.len()!=32||!uuid.bytes().all(|b|b.is_ascii_hexdigit()){
        return Err("UUID Premium inválido para el historial de skins".into());
    }
    let dir=private_root.join("minecraft-skin-history");
    crate::instance_guard::private_paths(private_root,&["minecraft-skin-history"])?;
    let path=dir.join(format!("{}.json",uuid.to_ascii_lowercase()));
    let mut entries:Vec<Value>=if path.exists(){
        serde_json::from_slice(&std::fs::read(&path).map_err(|e|e.to_string())?)
            .map_err(|_|"El historial de skins tiene datos inválidos; no se modificó".to_string())?
    }else{Vec::new()};
    entries.retain(|entry|entry["url"].as_str().is_some_and(|u|!safe_texture(u).is_empty()));
    let mut changed=false;
    if let Some(skins)=official["skins"].as_array(){
        for skin in skins {
            let raw=skin["url"].as_str().unwrap_or("");
            let url=safe_texture(raw);
            if url.is_empty(){continue;}
            let variant=if skin["variant"]=="SLIM"{"SLIM"}else{"CLASSIC"};
            if let Some(position)=entries.iter().position(|e|e["url"]==url) {
                if entries[position]["variant"]!=variant {
                    entries[position]["variant"]=json!(variant);changed=true;
                }
            }else{
                entries.push(json!({"url":url,"variant":variant}));changed=true;
            }
        }
    }
    if entries.len()>32{entries.drain(..entries.len()-32);changed=true;}
    if changed{
        crate::accounts::atomic_json(&path,&entries)?;
    }
    entries.reverse();
    Ok(entries)
}

#[tauri::command]
pub(crate) async fn microsoft_cosmetics(
    backend:State<'_,Mutex<Backend>>,ms:State<'_,Mutex<MicrosoftState>>
)->Result<Value,String>{
    let identity=premium_identity(&backend,&ms)?;
    let private_root=backend.lock().map_err(|_|"Perfil VIS ocupado")?.data_root.clone();
    tauri::async_runtime::spawn_blocking(move||{
        let http=client()?;
        let profile=owned_profile(&http,&identity)?;
        let history=minecraft_skin_history(&private_root,&identity.uuid,&profile)?;
        let mut output=public_cosmetics(&profile);
        output["history"]=json!(history);
        Ok(output)
    }).await.map_err(|_|"La consulta de cosméticos se interrumpió".to_string())?
}
#[tauri::command]
pub(crate) async fn microsoft_set_cape(
    backend:State<'_,Mutex<Backend>>,ms:State<'_,Mutex<MicrosoftState>>,cape_id:String
)->Result<Value,String>{
    let identity=premium_identity(&backend,&ms)?;
    tauri::async_runtime::spawn_blocking(move||{
        let http=client()?;
        let owned=owned_profile(&http,&identity)?;
        if !owned["capes"].as_array().is_some_and(|list|
            list.iter().any(|cape|cape["id"].as_str()==Some(cape_id.as_str()))){
            return Err("La capa no pertenece a esta cuenta Minecraft".into());
        }
        let r=http.put("https://api.minecraftservices.com/minecraft/profile/capes/active")
            .bearer_auth(&identity.access_token).json(&json!({"capeId":cape_id}))
            .send().map_err(|_|"No se pudo conectar con Minecraft Services")?;
        if !r.status().is_success(){return Err(format!("Minecraft rechazó la capa (HTTP {})",r.status()));}
        Ok(public_cosmetics(&owned_profile(&http,&identity)?))
    }).await.map_err(|_|"Cambio de capa interrumpido".to_string())?
}
#[tauri::command]
pub(crate) async fn microsoft_hide_cape(
    backend:State<'_,Mutex<Backend>>,ms:State<'_,Mutex<MicrosoftState>>
)->Result<Value,String>{
    let identity=premium_identity(&backend,&ms)?;
    tauri::async_runtime::spawn_blocking(move||{
        let http=client()?;
        let r=http.delete("https://api.minecraftservices.com/minecraft/profile/capes/active")
            .bearer_auth(&identity.access_token)
            .send().map_err(|_|"No se pudo conectar con Minecraft Services")?;
        if !r.status().is_success(){return Err(format!("Minecraft rechazó el cambio (HTTP {})",r.status()));}
        Ok(public_cosmetics(&owned_profile(&http,&identity)?))
    }).await.map_err(|_|"Cambio de capa interrumpido".to_string())?
}
#[tauri::command]
pub(crate) async fn microsoft_use_skin(
    backend:State<'_,Mutex<Backend>>,ms:State<'_,Mutex<MicrosoftState>>,skin_id:String
)->Result<Value,String>{
    let identity=premium_identity(&backend,&ms)?;
    tauri::async_runtime::spawn_blocking(move||{
        let http=client()?;
        let owned=owned_profile(&http,&identity)?;
        let item=owned["skins"].as_array().and_then(|skins|
            skins.iter().find(|skin|skin["id"].as_str()==Some(skin_id.as_str())))
            .ok_or("La skin no pertenece a esta cuenta Minecraft")?;
        let url=safe_texture(item["url"].as_str().unwrap_or(""));
        if url.is_empty(){return Err("La skin histórica no tiene una textura oficial válida".into());}
        let variant=if item["variant"].as_str()==Some("SLIM"){"slim"}else{"classic"};
        let r=http.post("https://api.minecraftservices.com/minecraft/profile/skins")
            .bearer_auth(&identity.access_token).json(&json!({"url":url,"variant":variant}))
            .send().map_err(|_|"No se pudo conectar con Minecraft Services")?;
        if !r.status().is_success(){return Err(format!("Minecraft rechazó la skin (HTTP {})",r.status()));}
        Ok(public_cosmetics(&owned_profile(&http,&identity)?))
    }).await.map_err(|_|"Cambio de skin interrumpido".to_string())?
}
#[tauri::command]
pub(crate) async fn microsoft_use_saved_skin(
    backend:State<'_,Mutex<Backend>>,ms:State<'_,Mutex<MicrosoftState>>,url:String
)->Result<Value,String>{
    let identity=premium_identity(&backend,&ms)?;
    let private_root=backend.lock().map_err(|_|"Perfil VIS ocupado")?.data_root.clone();
    tauri::async_runtime::spawn_blocking(move||{
        let http=client()?;
        let profile=owned_profile(&http,&identity)?;
        let history=minecraft_skin_history(&private_root,&identity.uuid,&profile)?;
        let saved=history.iter().find(|entry|
            entry["url"].as_str()==Some(url.as_str())&&safe_texture(&url)==url)
            .ok_or("La skin no pertenece al historial local de esta cuenta Premium")?;
        let variant=if saved["variant"]=="SLIM"{"slim"}else{"classic"};
        let r=http.post("https://api.minecraftservices.com/minecraft/profile/skins")
            .bearer_auth(&identity.access_token).json(&json!({"url":url,"variant":variant}))
            .send().map_err(|_|"No se pudo conectar con Minecraft Services")?;
        if !r.status().is_success(){return Err(format!("Minecraft rechazó la textura histórica (HTTP {})",r.status()));}
        let next=owned_profile(&http,&identity)?;
        let history=minecraft_skin_history(&private_root,&identity.uuid,&next)?;
        let mut output=public_cosmetics(&next);
        output["history"]=json!(history);
        Ok(output)
    }).await.map_err(|_|"Cambio de skin interrumpido".to_string())?
}

#[tauri::command]
pub(crate) async fn microsoft_upload_skin(
    backend:State<'_,Mutex<Backend>>,ms:State<'_,Mutex<MicrosoftState>>,
    path:String,variant:String
)->Result<Value,String>{
    let identity=premium_identity(&backend,&ms)?;
    if variant!="classic"&&variant!="slim" {
        return Err("Elegí modelo clásico o delgado".into());
    }
    tauri::async_runtime::spawn_blocking(move||{
        use std::{fs,io::Write};
        use rand_core::{OsRng,RngCore};
        let selected=std::path::Path::new(&path);
        if !selected.is_absolute() || selected.extension().and_then(|x|x.to_str())
            .is_none_or(|ext|!ext.eq_ignore_ascii_case("png")){
            return Err("Seleccioná un PNG local de skin Minecraft".into());
        }
        let metadata=fs::metadata(selected).map_err(|_|"No se encontró el PNG seleccionado")?;
        if !metadata.is_file()||metadata.len()>1024*1024||metadata.len()<24{
            return Err("La skin supera 1 MB o no es un PNG válido".into());
        }
        let bytes=fs::read(selected).map_err(|_|"No se pudo leer la skin PNG")?;
        if !bytes.starts_with(&[137,80,78,71,13,10,26,10])
            || &bytes[12..16]!=b"IHDR"{
            return Err("El archivo no es una skin PNG válida".into());
        }
        let width=u32::from_be_bytes([bytes[16],bytes[17],bytes[18],bytes[19]]);
        let height=u32::from_be_bytes([bytes[20],bytes[21],bytes[22],bytes[23]]);
        if width!=64 || ![32,64].contains(&height){
            return Err("La skin debe ser PNG 64×64 o 64×32".into());
        }
        let mut nonce=[0u8;16];OsRng.fill_bytes(&mut nonce);
        let boundary=format!("VISNexo{}",uuid::Uuid::from_bytes(nonce).simple());
        nonce.fill(0);
        let mut form=Vec::with_capacity(bytes.len()+512);
        write!(&mut form,
            "--{boundary}\r\nContent-Disposition: form-data; name=\"variant\"\r\n\r\n{variant}\r\n\
             --{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"skin.png\"\r\n\
             Content-Type: image/png\r\n\r\n"
        ).map_err(|_|"No se pudo preparar el formulario")?;
        form.extend_from_slice(&bytes);
        write!(&mut form,"\r\n--{boundary}--\r\n").map_err(|_|"No se pudo cerrar el formulario")?;
        let http=client()?;
        let r=http.post("https://api.minecraftservices.com/minecraft/profile/skins")
            .bearer_auth(&identity.access_token)
            .header(reqwest::header::CONTENT_TYPE,format!("multipart/form-data; boundary={boundary}"))
            .body(form).send().map_err(|_|"No se pudo enviar la skin a Minecraft Services")?;
        if !r.status().is_success(){return Err(format!("Minecraft rechazó la skin (HTTP {})",r.status()));}
        Ok(public_cosmetics(&owned_profile(&http,&identity)?))
    }).await.map_err(|_|"Carga de skin interrumpida".to_string())?
}

/// Open only the fixed Microsoft device login URL. On Linux/AppImage the
/// bundled xdg-open and inherited library paths can break Flatpak browsers
/// (including Zen), even though xdg-open succeeds from a terminal.
///
/// Keep the OAuth polling independent of this optional convenience action.
#[cfg(target_os="linux")]
fn open_microsoft_on_host()->Result<bool,String>{
    use std::{env,process::{Command,Stdio},time::{Duration,Instant},thread};
    let appdir=env::var("APPDIR").unwrap_or_default();
    let host_path=|value:String|{
        value.split(':').filter(|part|
            !part.is_empty() && !part.starts_with("/tmp/.mount_")
            && (appdir.is_empty() || !part.starts_with(&appdir))
        ).collect::<Vec<_>>().join(":")
    };
    let mut reason=String::new();
    // System gio is preferable for desktop/Flatpak handlers. If absent or
    // unsuccessful, use host xdg-open with the same scrubbed environment.
    for (bin,args) in [("/usr/bin/gio",vec!["open","https://www.microsoft.com/link"]),
                       ("/usr/bin/xdg-open",vec!["https://www.microsoft.com/link"])]{
        if !std::path::Path::new(bin).is_file(){continue;}
        let mut command=Command::new(bin);
        command.args(args)
            .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        for key in ["LD_LIBRARY_PATH","LD_PRELOAD","LD_AUDIT",
                    "GIO_EXTRA_MODULES","GIO_MODULE_DIR",
                    "GTK_PATH","GTK_EXE_PREFIX","GTK_DATA_PREFIX",
                    "QT_PLUGIN_PATH","QT_QPA_PLATFORM_PLUGIN_PATH",
                    "GDK_PIXBUF_MODULE_FILE","GDK_PIXBUF_MODULEDIR",
                    "APPDIR","APPIMAGE","ARGV0"]{
            command.env_remove(key);
        }
        let path=host_path(env::var("PATH").unwrap_or_default());
        command.env("PATH",if path.is_empty(){"/usr/local/bin:/usr/bin:/bin"}else{&path});
        if let Ok(dirs)=env::var("XDG_DATA_DIRS"){
            let filtered=host_path(dirs);
            command.env("XDG_DATA_DIRS",if filtered.is_empty(){"/usr/local/share:/usr/share"}else{&filtered});
        }
        match command.spawn(){
            Ok(mut child)=>{
                let until=Instant::now()+Duration::from_secs(3);
                loop {
                    match child.try_wait(){
                        Ok(Some(status)) if status.success()=>return Ok(true),
                        Ok(Some(status))=>{
                            reason=format!("El navegador devolvió estado {}",status.code().unwrap_or(-1));
                            break;
                        },
                        Ok(None) if Instant::now()>=until=>{
                            // xdg-open may intentionally remain attached to the
                            // desktop browser process; do not block OAuth.
                            return Ok(true);
                        },
                        Ok(None)=>thread::sleep(Duration::from_millis(100)),
                        Err(_)=>{reason="No se pudo verificar el navegador".into();break;}
                    }
                }
            }
            Err(_)=>{reason="No se pudo iniciar el abridor del sistema".into();}
        }
    }
    if reason.is_empty(){reason="No se encontraron abridores de enlaces en Linux".into();}
    Err(format!("{reason}. Abrí https://www.microsoft.com/link manualmente."))
}
#[tauri::command]
pub(crate) async fn microsoft_open_verification()->Result<bool,String>{
    #[cfg(target_os="linux")]
    {
        return tauri::async_runtime::spawn_blocking(open_microsoft_on_host)
            .await.map_err(|_|"No se pudo iniciar el navegador".to_string())?;
    }
    #[cfg(not(target_os="linux"))]
    {
        Err("Apertura del navegador del sistema no disponible".into())
    }
}

/// Experimental Horizon Launch API 0.1 accepts the session via a one-time
/// local JSON file that horizon.rs sends to the game via stdin. Never persist
/// this file or expose the access token to JavaScript, console or game args.
pub(crate) fn temporary_horizon_session(
    private_root:&std::path::Path,identity:&MinecraftIdentity
)->Result<std::path::PathBuf,String>{
    use std::fs::{self,OpenOptions};
    use std::io::Write;
    // Never put an access token into the user-selected Minecraft directory.
    // Games may be on NTFS/FAT/external storage where chmod 0600 is impossible
    // or permissions are shared across OS users. Native app data is separate.
    crate::instance_guard::private_paths(private_root,&["private-ms-sessions"])?;
    let tmp=private_root.join("private-ms-sessions");
    fs::create_dir_all(&tmp).map_err(|e|e.to_string())?;
    #[cfg(unix)] {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&tmp,fs::Permissions::from_mode(0o700))
            .map_err(|_|"El almacenamiento local de credenciales no admite permisos privados (0700)".to_string())?;
        let mode=fs::metadata(&tmp).map_err(|e|e.to_string())?.permissions().mode();
        if mode&0o077!=0 {
            return Err("Guardá los datos privados de VIS en un disco Linux con permisos POSIX; las sesiones Microsoft nunca se escriben en NTFS".into());
        }
    }
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
    #[cfg(unix)]{
        use std::os::unix::fs::PermissionsExt;
        let mode=file.metadata().map_err(|e|e.to_string())?.permissions().mode();
        if mode&0o077!=0 {
            drop(file);let _=fs::remove_file(&path);
            return Err("No se pudieron proteger los permisos de la sesión Microsoft".into());
        }
    }
    let json=serde_json::to_vec(&json!({
      "name":identity.name,
      "uuid":identity.uuid,
      "access_token":identity.access_token,
      "user_type":"msa"
    })).map_err(|_|"No se pudo crear el ticket Horizon")?;
    if let Err(err)=file.write_all(&json).and_then(|_|file.sync_all()){
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
 #[test]fn cosmetics_only_exposes_owned_metadata(){
    assert!(safe_texture("http://textures.minecraft.net/texture/abcdef123").starts_with("https://"));
    assert_eq!(safe_texture("https://evil.example/texture/abcdef"),"");
    assert_eq!(safe_texture("https://textures.minecraft.net/texture/../../secret"),"");
    let raw=json!({"id":"0011","name":"TestPremium","skins":[
        {"id":"skin","url":"https://textures.minecraft.net/texture/abcdef123","state":"ACTIVE","variant":"SLIM"}
    ],"capes":[{"id":"cape","alias":"Founder","state":"INACTIVE"}],"access_token":"untrusted-secret"});
    let output=public_cosmetics(&raw).to_string();
    assert!(!output.contains("untrusted-secret"));
    assert!(output.contains("TestPremium"));
 }
 #[cfg(unix)]
 #[test]fn premium_ticket_is_private_and_not_inside_minecraft(){
    use std::os::unix::fs::PermissionsExt;
    let library=std::env::temp_dir().join(format!("vis-auth-unit-{}",std::process::id()));
    std::fs::create_dir_all(&library).unwrap();
    let identity=MinecraftIdentity{name:"Tester".into(),uuid:"0123456789abcdef0123456789abcdef".into(),access_token:"local-secret".into()};
    let path=temporary_horizon_session(&library,&identity).unwrap();
    assert!(path.starts_with(library.join("private-ms-sessions")));
    assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode()&0o777,0o600);
    assert_eq!(std::fs::metadata(path.parent().unwrap()).unwrap().permissions().mode()&0o777,0o700);
    std::fs::remove_dir_all(library).unwrap();
 }
}
