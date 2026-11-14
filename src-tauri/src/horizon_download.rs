//! VIS Worlds: download the signed Horizon GAME release, never Horizon Launcher.
//! Files are staged, verified against the publisher's pinned Ed25519 key,
//! unpacked with strict path/type/size bounds and atomically installed.
//! v2.16: indexed local builds and SHA-256 integrity stamps for game binaries.
use crate::minecraft::Progress;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use ed25519_dalek::{Signature,Verifier,VerifyingKey};
use flate2::read::GzDecoder;
use reqwest::blocking::Client;
use serde::{Deserialize,Serialize};
use sha2::{Digest,Sha256};
use std::{fs::{self,File,OpenOptions},io::{self,Read,Write},path::{Component,Path,PathBuf},sync::Mutex,time::{Duration,SystemTime,UNIX_EPOCH}};
use tauri::{AppHandle,Emitter};

const GITHUB_API: &str = "https://api.github.com/repos/horizon-rust/horizon/releases?per_page=100";
// Key from upstream crates/horizon-release-sign/release-keys.txt (2026-11-10).
// Never fetch trust keys from the same server as a release at install time.
const HORIZON_KEY: &str = "MU4oiIQcCxkZvbwSjjXs7SySCuM6ywRQ3nGaJYZG0gw=";
const MAX_ARCHIVE: u64 = 256 * 1024 * 1024;
const MAX_UNPACKED: u64 = 1024 * 1024 * 1024;
const MAX_ITEMS: usize = 16000;
static INSTALL_LOCK: Mutex<()> = Mutex::new(());

#[derive(Deserialize,Clone)]
struct Asset {name:String,browser_download_url:String,size:u64}
#[derive(Deserialize)]
struct Release {tag_name:String,name:String,draft:bool,assets:Vec<Asset>,published_at:Option<String>}
#[derive(Clone,Serialize)]
pub struct Latest {pub tag:String,pub archive:String,pub size:u64,pub published:String}
#[derive(Clone,Serialize)]
pub struct Installed {pub tag:String,pub build_dir:String,pub archive_sha256:String}
#[derive(Clone,Serialize)]
pub struct LibraryBuild {pub tag:String,pub build_dir:String,pub integrity:String,pub detail:String}
#[derive(Serialize,Deserialize)]
struct GameFiles {tag:String,client_sha256:String,prepare_sha256:String,lock_sha256:String}
const GAME_FILES_STAMP: &str = ".vis-game-files-sha256.json";


fn platform_archive() -> Result<&'static str,String> {
    #[cfg(all(target_os="linux",target_arch="x86_64"))] {return Ok("horizon-linux-x86_64.tar.gz");}
    #[cfg(all(target_os="windows",target_arch="x86_64"))] {return Ok("horizon-windows-x64.zip");}
    #[cfg(all(target_os="windows",target_arch="aarch64"))] {return Ok("horizon-windows-arm64.zip");}
    #[allow(unreachable_code)] Err("Horizon no ofrece un paquete automático para esta plataforma de VIS".into())
}
fn client()->Result<Client,String>{
    Client::builder().user_agent("VIS-Nexo-Horizon-Integration/2.15 (+https://github.com/horizon-rust/horizon)")
        .connect_timeout(Duration::from_secs(15)).timeout(Duration::from_secs(90))
        .build().map_err(|e|e.to_string())
}
fn asset<'a>(release:&'a Release,name:&str)->Result<&'a Asset,String>{
    release.assets.iter().find(|a|a.name==name).ok_or_else(||format!("El release {} no publica {name}",release.tag_name))
}
// The GitHub release tag is "nightly" for the current build (or
// "nightly-YYYY-MM-DD" for older builds). The signed v2 identifier has
// an additional commit hash, parsed from the official release title.
fn signed_version(release:&Release)->Option<String>{
    let text=release.name.strip_prefix("Nightly ")?;
    let (date,commit)=text.split_once(" · ")?;
    let db=date.as_bytes();
    if db.len()!=10||db[4]!=b'-'||db[7]!=b'-'
        || !db.iter().enumerate().all(|(i,b)|i==4||i==7||b.is_ascii_digit()){
        return None
    }
    if commit.len()<7||commit.len()>40||!commit.bytes().all(|b|b.is_ascii_hexdigit()){
        return None
    }
    if release.tag_name!="nightly"&&release.tag_name!=format!("nightly-{date}"){
        return None
    }
    Some(format!("nightly-{date}-{commit}"))
}
fn trustworthy_url(url:&str,release:&Release,asset_name:&str)->bool{
    url==format!("https://github.com/horizon-rust/horizon/releases/download/{}/{}",release.tag_name,asset_name)
}
fn release_candidate(release:&Release,archive:&str)->bool{
    !release.draft && signed_version(release).is_some() &&
    [archive,"SHA256SUMS","SHA256SUMS.v2.sig"].iter().all(|name|
        release.assets.iter().any(|a|a.name==*name && trustworthy_url(&a.browser_download_url,release,name)))
}
fn choose_release<'a>(releases:&'a [Release],archive:&str)->Result<&'a Release,String>{
    releases.iter().find(|r|r.tag_name=="nightly"&&release_candidate(r,archive))
        .or_else(||releases.iter().find(|r|release_candidate(r,archive)))
        .ok_or_else(||"No se encontró una Nightly de Horizon con el cliente del juego y firma v2 para tu sistema".into())
}
fn list(client:&Client)->Result<Vec<Release>,String>{
    let response=client.get(GITHUB_API).send().and_then(|r|r.error_for_status())
        .map_err(|e|format!("No se pudo consultar GitHub Releases: {e}"))?;
    response.json().map_err(|e|format!("GitHub devolvió un catálogo de releases inválido: {e}"))
}
pub fn latest()->Result<Latest,String>{
    let archive=platform_archive()?;
    let releases=list(&client()?)?;
    let release=choose_release(&releases,archive)?;
    let a=asset(release,archive)?;
    Ok(Latest{tag:signed_version(release).ok_or("Nightly sin identificador firmado")?,archive:a.name.clone(),size:a.size,published:release.published_at.clone().unwrap_or_default()})
}
fn small_file(http:&Client,a:&Asset,release:&Release,limit:u64)->Result<Vec<u8>,String>{
    if !trustworthy_url(&a.browser_download_url,release,&a.name)||a.size>limit{
        return Err(format!("Metadatos inválidos para {}",a.name));
    }
    let response=http.get(&a.browser_download_url).send().and_then(|r|r.error_for_status())
        .map_err(|e|format!("No se pudo descargar {}: {e}",a.name))?;
    let mut data=Vec::new();
    response.take(limit+1).read_to_end(&mut data).map_err(|e|e.to_string())?;
    if data.len() as u64>limit{return Err(format!("{} excede el límite de seguridad",a.name))}
    Ok(data)
}
fn signature_is_valid(tag:&str,sums:&[u8],signature_file:&[u8])->Result<(),String>{
    let key_bytes=STANDARD.decode(HORIZON_KEY).map_err(|e|e.to_string())?;
    let key:[u8;32]=key_bytes.try_into().map_err(|_|"Clave oficial Horizon inválida")?;
    let verifying_key=VerifyingKey::from_bytes(&key).map_err(|e|e.to_string())?;
    let content=std::str::from_utf8(signature_file).map_err(|_|"Firma v2 no es UTF-8")?;
    let mut msg=format!("horizon release {tag}\n").into_bytes();
    msg.extend_from_slice(sums);
    for line in content.lines().map(str::trim).filter(|s|!s.is_empty()) {
        let Ok(decoded)=STANDARD.decode(line) else{continue};
        let Ok(sig)=Signature::from_slice(&decoded) else{continue};
        if verifying_key.verify(&msg,&sig).is_ok(){return Ok(())}
    }
    Err("Horizon: firma Ed25519 v2 inválida o no reconocida. No se instaló ningún ejecutable".into())
}
fn checksum_of(sums:&[u8],archive:&str)->Result<String,String>{
    let manifest=std::str::from_utf8(sums).map_err(|_|"SHA256SUMS no es UTF-8")?;
    let mut matches=manifest.lines().filter_map(|line|{
        if line.len()<67{return None}
        let hex=&line[..64];
        if !hex.bytes().all(|c|c.is_ascii_hexdigit()) {return None}
        let name=line[64..].trim().trim_start_matches('*');
        (name==archive).then(||hex.to_ascii_lowercase())
    });
    let first=matches.next().ok_or_else(||format!("SHA256SUMS no contiene {archive}"))?;
    if matches.next().is_some(){return Err("SHA256SUMS repite el nombre del archivo".into())}
    Ok(first)
}
fn emit(app:&AppHandle,stage:&str,completed:usize,detail:&str){
    crate::download_manager::progress(app,stage,completed,100,detail);
    let _=app.emit("minecraft-progress",Progress{stage:stage.into(),completed,total:100,detail:detail.chars().take(180).collect()});
}
fn stream_archive(app:&AppHandle,http:&Client,a:&Asset,release:&Release,dest:&Path,expected:&str)->Result<(),String>{
    if a.size==0||a.size>MAX_ARCHIVE||!trustworthy_url(&a.browser_download_url,release,&a.name){
        return Err("Archivo Horizon demasiado grande o URL inesperada".into());
    }
    let response=http.get(&a.browser_download_url).send().and_then(|r|r.error_for_status())
        .map_err(|e|format!("No se pudo descargar el juego: {e}"))?;
    download_stream(app,response,dest,expected,a.size)
}
fn download_stream<R:Read>(app:&AppHandle,mut reader:R,dest:&Path,expected:&str,reported_size:u64)->Result<(),String>{
    let mut file=OpenOptions::new().write(true).create_new(true).open(dest).map_err(|e|e.to_string())?;
    let mut hasher=Sha256::new();
    let mut buffer=[0u8;64*1024];let mut downloaded=0u64;let mut last_percent=usize::MAX;
    loop {
        crate::download_manager::checkpoint()?;
        let n=reader.read(&mut buffer).map_err(|e|e.to_string())?;
        if n==0{break}
        downloaded+=n as u64;
        if downloaded>MAX_ARCHIVE {return Err("Horizon superó el límite de descarga".into())}
        file.write_all(&buffer[..n]).map_err(|e|e.to_string())?;
        hasher.update(&buffer[..n]);
        let percent=(downloaded.saturating_mul(80)/reported_size.max(1)).min(80) as usize;
        if percent!=last_percent {emit(app,"Descargando Horizon",percent,&format!("{} MiB descargados",downloaded/1048576));last_percent=percent;}
    }
    file.sync_all().map_err(|e|e.to_string())?;
    crate::download_manager::checkpoint()?;
    if format!("{:x}",hasher.finalize())!=expected{return Err("SHA-256 del juego no coincide con el manifiesto firmado".into())}
    Ok(())
}
fn safe_rel(path:&Path)->Result<PathBuf,String>{
    let mut clean=PathBuf::new();let mut depth=0;
    for part in path.components(){
        match part {
            Component::Normal(name)=>{depth+=1;if depth>16{return Err("Ruta Horizon demasiado profunda".into())}clean.push(name);}
            Component::CurDir=>{},
            _=>return Err("Un archivo Horizon intentó escapar de su carpeta".into())
        }
    }
    if clean.as_os_str().is_empty(){return Err("Ruta vacía en el paquete Horizon".into())}
    Ok(clean)
}
fn extraction_limit(total:&mut u64,count:&mut usize,size:u64)->Result<(),String>{
    *count+=1;*total=total.saturating_add(size);
    if *count>MAX_ITEMS||*total>MAX_UNPACKED||size>MAX_ARCHIVE{
        return Err("Paquete Horizon supera límites de extracción".into())
    }
    Ok(())
}
fn write_member<R:Read>(mut src:R,root:&Path,rel:&Path,size:u64)->Result<PathBuf,String>{
    let dest=root.join(safe_rel(rel)?);
    if let Some(parent)=dest.parent(){fs::create_dir_all(parent).map_err(|e|e.to_string())?;}
    let mut file=OpenOptions::new().write(true).create_new(true).open(&dest).map_err(|e|e.to_string())?;
    let copied=io::copy(&mut src,&mut file).map_err(|e|e.to_string())?;
    if copied!=size{return Err("Tamaño inconsistente en el paquete Horizon".into())}
    Ok(dest)
}
fn unpack_tar(archive_path:&Path,target:&Path)->Result<(),String>{
    let input=File::open(archive_path).map_err(|e|e.to_string())?;
    let mut archive=tar::Archive::new(GzDecoder::new(input));
    let mut size=0u64;let mut count=0usize;
    for item in archive.entries().map_err(|e|e.to_string())?{
        let mut item=item.map_err(|e|e.to_string())?;
        let kind=item.header().entry_type();
        if !kind.is_file()&&!kind.is_dir(){return Err("Paquete Horizon contiene enlaces u objetos no permitidos".into())}
        let path=item.path().map_err(|e|e.to_string())?.to_path_buf();
        if path == Path::new(".") && kind.is_dir(){continue}
        let relative=safe_rel(&path)?;
        let bytes=if kind.is_file(){item.size()}else{0};
        extraction_limit(&mut size,&mut count,bytes)?;
        let dest=target.join(relative);
        if kind.is_dir(){fs::create_dir_all(&dest).map_err(|e|e.to_string())?;}
        else {write_member(&mut item,target,&path,bytes)?;}
    }
    Ok(())
}
fn unpack_zip(archive_path:&Path,target:&Path)->Result<(),String>{
    let input=File::open(archive_path).map_err(|e|e.to_string())?;
    let mut archive=zip::ZipArchive::new(input).map_err(|e|e.to_string())?;
    if archive.len()>MAX_ITEMS{return Err("ZIP Horizon tiene demasiados elementos".into())}
    let mut size=0u64;let mut count=0usize;
    for n in 0..archive.len(){
        let mut item=archive.by_index(n).map_err(|e|e.to_string())?;
        if item.unix_mode().is_some_and(|mode|mode & 0o170000 == 0o120000){
            return Err("ZIP Horizon contiene un enlace simbólico".into())
        }
        let member_name=item.name().map_err(|e|e.to_string())?.into_owned();
        let path=Path::new(&member_name);let relative=safe_rel(path)?;
        let bytes=if item.is_dir(){0}else{item.size()};
        extraction_limit(&mut size,&mut count,bytes)?;
        let dest=target.join(relative);
        if item.is_dir(){fs::create_dir_all(&dest).map_err(|e|e.to_string())?;}
        else {write_member(&mut item,target,path,bytes)?;}
    }
    Ok(())
}
/// Streaming SHA-256: memory overhead remains O(1) even for large game binaries.
fn sha256_file(path:&Path)->Result<String,String>{
    let meta=fs::symlink_metadata(path).map_err(|e|e.to_string())?;
    if !meta.file_type().is_file() || meta.len()==0 || meta.len()>MAX_UNPACKED{
        return Err("Archivo Horizon ausente, enlazado o de tamaño inválido".into());
    }
    let mut file=File::open(path).map_err(|e|format!("No se puede leer {}: {e}",path.display()))?;
    let mut digest=Sha256::new();let mut buf=[0u8;64*1024];
    loop {let size=file.read(&mut buf).map_err(|e|e.to_string())?;if size==0{break;}digest.update(&buf[..size]);}
    Ok(format!("{:x}",digest.finalize()))
}
fn game_stamp(build:&Path,tag:&str)->Result<GameFiles,String>{
    Ok(GameFiles{tag:tag.to_owned(),client_sha256:sha256_file(&binary(build,"horizon-client"))?,
        prepare_sha256:sha256_file(&binary(build,"horizon-prepare"))?,
        lock_sha256:sha256_file(&build.join("research-lock.json"))?})
}
fn save_game_stamp(build:&Path,tag:&str)->Result<(),String>{
    let stamp=game_stamp(build,tag)?;
    let serialized=serde_json::to_vec_pretty(&stamp).map_err(|e|e.to_string())?;
    let temp=build.join(format!("{GAME_FILES_STAMP}.tmp"));
    fs::write(&temp,serialized).map_err(|e|e.to_string())?;
    fs::rename(temp,build.join(GAME_FILES_STAMP)).map_err(|e|e.to_string())?;
    Ok(())
}
/// A local import or old v2.15 release may not have a stamp; never label it verified.
/// If the stamp exists, a changed executable or preparation lock fails closed.
pub fn verify_managed_build(build:&Path)->Result<bool,String>{
    let path=build.join(GAME_FILES_STAMP);
    if !path.exists(){return Ok(false)}
    let bytes=fs::read(&path).map_err(|e|e.to_string())?;
    let saved:GameFiles=serde_json::from_slice(&bytes)
        .map_err(|_|"El comprobante de Horizon es inválido; volvé a instalar el build")?;
    let actual=game_stamp(build,&saved.tag)?;
    if saved.client_sha256!=actual.client_sha256 || saved.prepare_sha256!=actual.prepare_sha256
        || saved.lock_sha256!=actual.lock_sha256{
        return Err("Los binarios o research-lock.json de Horizon cambiaron desde su instalación firmada. Elegí otra Nightly o reinstalá el build sin tocar tus mundos".into())
    }
    Ok(true)
}
/// Enumerate only VIS-managed releases. No disk-wide crawling, no downloads,
/// and no execution of untrusted binaries. User data and worlds are untouched.
pub fn installed_library(data_root:&Path)->Vec<LibraryBuild>{
    let root=data_root.join("horizon-builds");
    let Ok(entries)=fs::read_dir(root) else{return Vec::new()};
    let mut found=Vec::new();
    for entry in entries.take(100).flatten(){
        if !entry.file_type().is_ok_and(|t|t.is_dir() && !t.is_symlink()){continue}
        let tag=entry.file_name().to_string_lossy().into_owned();
        if !tag.starts_with("nightly-") || tag.len()>80{continue}
        let folder=entry.path();
        let (path,status,detail)=match find_build(&folder){
            Ok(build)=>{
                let stamp=build.join(GAME_FILES_STAMP);
                if !stamp.is_file(){(build,"legacy","Build anterior: sin huellas de archivos; comprobá su procedencia")}
                else{match verify_managed_build(&build){
                    Ok(true)=>(build,"verified","Ejecutables y research-lock.json coinciden con la instalación"),
                    _=>(build,"modified","Archivos modificados o comprobante dañado: no ejecutar")
                }}
            }
            Err(_)=>(folder,"incomplete","No se encuentran los ejecutables y la investigación del build")
        };
        found.push(LibraryBuild{tag,build_dir:path.to_string_lossy().into_owned(),integrity:status.into(),detail:detail.into()});
    }
    found.sort_by(|a,b|b.tag.cmp(&a.tag));found
}
fn binary(folder:&Path,name:&str)->PathBuf{
    folder.join(if cfg!(target_os="windows"){format!("{name}.exe")}else{name.to_owned()})
}
fn find_build(root:&Path)->Result<PathBuf,String>{
    let mut dirs=vec![(root.to_owned(),0)];
    while let Some((dir,depth))=dirs.pop(){
        if binary(&dir,"horizon-client").is_file()&&binary(&dir,"horizon-prepare").is_file()&&dir.join("research-lock.json").is_file(){return Ok(dir)}
        if depth>=3{continue}
        let rd=fs::read_dir(&dir).map_err(|e|e.to_string())?;
        for e in rd.take(40).flatten(){
            if e.file_type().is_ok_and(|x|x.is_dir()&&!x.is_symlink()){dirs.push((e.path(),depth+1));}
        }
    }
    Err("El paquete firmado no contiene horizon-client, horizon-prepare y research-lock.json en una misma carpeta".into())
}
fn executable_permissions(build:&Path)->Result<(),String>{
    #[cfg(unix)] {
        use std::os::unix::fs::PermissionsExt;
        for name in ["horizon-client","horizon-prepare"]{
            fs::set_permissions(binary(build,name),fs::Permissions::from_mode(0o755)).map_err(|e|e.to_string())?;
        }
    }
    Ok(())
}
struct TempGuard(PathBuf);
impl Drop for TempGuard{fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
/// Never overwrites an installed build. All existing worlds live elsewhere.
pub fn install(app:&AppHandle,data_root:&Path,expected_tag:&str)->Result<Installed,String>{
    let _guard=INSTALL_LOCK.lock().map_err(|_|"El instalador Horizon está bloqueado")?;
    let http=client()?;let archive=platform_archive()?;let releases=list(&http)?;
    let release=choose_release(&releases,archive)?;
    let version=signed_version(release).ok_or("Versión Nightly inválida")?;
    if version!=expected_tag{return Err("La Nightly de Horizon cambió desde la confirmación. Volvé a comprobar la versión".into())}
    let release_asset=asset(release,archive)?;
    let manifest=small_file(&http,asset(release,"SHA256SUMS")?,release,64*1024)?;
    let signed=small_file(&http,asset(release,"SHA256SUMS.v2.sig")?,release,4096)?;
    signature_is_valid(&version,&manifest,&signed)?;
    let hash=checksum_of(&manifest,archive)?;
    let root=data_root.join("horizon-builds");fs::create_dir_all(&root).map_err(|e|e.to_string())?;
    let destination=root.join(&version);
    if destination.exists(){
        let meta=fs::symlink_metadata(&destination).map_err(|e|e.to_string())?;
        if meta.file_type().is_symlink()||!meta.is_dir(){return Err("La carpeta del build Horizon existente no es segura".into())}
        let pinned=fs::read_to_string(destination.join(".vis-release-sha256"))
            .map_err(|_|"Existe un build Horizon sin comprobante de instalación. No se sobrescribe automáticamente")?;
        if pinned.trim()!=hash {return Err("Existe un build Horizon con una huella diferente. Revisá la carpeta manualmente".into())}
        let build=find_build(&destination)?;
        verify_managed_build(&build)?;
        return Ok(Installed{tag:version.clone(),build_dir:build.to_string_lossy().into(),archive_sha256:hash});
    }
    let nonce=SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e|e.to_string())?.as_nanos();
    let scratch=root.join(format!(".vis-download-{}-{nonce}",std::process::id()));
    fs::create_dir(&scratch).map_err(|e|e.to_string())?;
    let _cleanup=TempGuard(scratch.clone());
    emit(app,"Horizon Rust Edition",1,"Verificando firma del release oficial");
    let archive_path=scratch.join(archive);
    stream_archive(app,&http,release_asset,release,&archive_path,&hash)?;
    let unpacked=scratch.join("unpacked");fs::create_dir(&unpacked).map_err(|e|e.to_string())?;
    emit(app,"Instalando Horizon",83,"Descomprimiendo el juego (sin su launcher)");
    if archive.ends_with(".zip"){unpack_zip(&archive_path,&unpacked)?}
    else{unpack_tar(&archive_path,&unpacked)?}
    let build=find_build(&unpacked)?;
    executable_permissions(&build)?;
    save_game_stamp(&build,&version)?;
    fs::write(unpacked.join(".vis-release-sha256"),&hash).map_err(|e|e.to_string())?;
    let relative=build.strip_prefix(&unpacked).map_err(|e|e.to_string())?.to_path_buf();
    // Keep one immutable release directory; adding a new Nightly never alters old worlds.
    fs::rename(&unpacked,&destination).map_err(|e|format!("No se pudo guardar el build de Horizon: {e}"))?;
    let saved=destination.join(relative);
    emit(app,"Horizon instalado",100,"Build firmado y verificado. Configurá tu instancia para preparar Minecraft.");
    Ok(Installed{tag:version.clone(),build_dir:saved.to_string_lossy().into_owned(),archive_sha256:hash})
}


// VIS Nexo game distribution from the owner's own Horizon fork. Unlike the
// upstream Nightly channel above, our GitHub fork does not have the upstream
// Ed25519 release signing key. Trust is explicitly GitHub HTTPS + GitHub's
// SHA-256 asset digest + SHA256SUMS, and is NOT claimed to be an upstream
// cryptographic signature. A later VIS release should pin a dedicated key.
const VIS_FORK: &str = "JoseDaniel03/horizon-VISNEXO";
const VIS_FORK_API: &str =
    "https://api.github.com/repos/JoseDaniel03/horizon-VISNEXO/releases?per_page=15";
#[derive(Deserialize,Clone)]
struct ForkAsset {
    name:String,
    browser_download_url:String,
    size:u64,
    digest:Option<String>,
}
#[derive(Deserialize)]
struct ForkRelease {
    tag_name:String,
    draft:bool,
    #[serde(default)]
    prerelease:bool,
    assets:Vec<ForkAsset>,
}
fn fork_asset_name()->Result<&'static str,String>{
    #[cfg(all(target_os="linux",target_arch="x86_64"))]
    {return Ok("vis-horizon-linux-x86_64.tar.gz");}
    #[cfg(all(target_os="windows",target_arch="x86_64"))]
    {return Ok("vis-horizon-windows-x64.zip");}
    #[allow(unreachable_code)]
    Err("VIS Horizon portable se publica por ahora para Linux/Windows x64".into())
}
fn fork_tag_valid(tag:&str)->bool{
    tag.strip_prefix("visgame-").is_some_and(|sha|
        sha.len()==12 && sha.bytes().all(|b|b.is_ascii_hexdigit()))
}
fn fork_asset<'a>(release:&'a ForkRelease,name:&str)->Result<&'a ForkAsset,String>{
    release.assets.iter().find(|a|a.name==name)
        .ok_or_else(||format!("Build del fork {} sin {name}",release.tag_name))
}
fn fork_digest(asset:&ForkAsset)->Result<String,String>{
    let sha=asset.digest.as_deref()
        .and_then(|d|d.strip_prefix("sha256:"))
        .ok_or("GitHub no informa digest SHA-256 verificable para este release")?;
    if sha.len()!=64 || !sha.bytes().all(|b|b.is_ascii_hexdigit()){
        return Err("Digest SHA-256 inválido para el juego Rust".into());
    }
    Ok(sha.to_ascii_lowercase())
}
// Shared contract parser: desktop and mobile apply exactly the same compatibility checks.
#[path = "../../mobile/src-tauri/src/mcrust_catalog.rs"]
mod shared_mcrust_catalog;
fn shared_contract(http:&Client,release:&ForkRelease,archive:&str,archive_sha:&str)->Result<(),String>{
    let manifest=fork_asset(release,"vis-mcrust-release.json")?;
    if manifest.size==0 || manifest.size>128*1024 || manifest.browser_download_url!=format!("https://github.com/{VIS_FORK}/releases/download/{}/vis-mcrust-release.json",release.tag_name){return Err("Manifiesto compartido inválido".into());}
    let expected=fork_digest(manifest)?;
    let response=http.get(&manifest.browser_download_url).send().and_then(|r|r.error_for_status()).map_err(|e|e.to_string())?;
    let mut raw=Vec::new();response.take(128*1024+1).read_to_end(&mut raw).map_err(|e|e.to_string())?;
    if raw.len()as u64!=manifest.size || format!("{:x}",Sha256::digest(&raw))!=expected {return Err("La integridad del manifiesto compartido no coincide".into());}
    let contract:shared_mcrust_catalog::Contract=serde_json::from_slice(&raw).map_err(|_|"Contrato del motor inválido")?;
    contract.validate(&release.tag_name)?;
    fork_assets_match_contract(release,&contract)?;
    let target=contract.targets.values().find(|t|t.asset==archive)
        .ok_or("Falta esta plataforma en el motor compartido")?;
    if target.sha256!=archive_sha {
        return Err("El build de PC no coincide con el motor Android".into());
    }
    Ok(())
}
// A release must contain exactly the three artifacts declared by the shared
// manifest. Checking only the desktop archive would allow a broken/mismatched
// Android APK to be advertised as the same engine.
fn fork_assets_match_contract(
    release:&ForkRelease,contract:&shared_mcrust_catalog::Contract
)->Result<(),String>{
    for target in contract.targets.values(){
        let matches=release.assets.iter().filter(|a|a.name==target.asset).collect::<Vec<_>>();
        if matches.len()!=1{
            return Err(format!("El release no contiene exactamente un artefacto {}",target.asset));
        }
        let asset=matches[0];
        let expected_url=format!(
            "https://github.com/{VIS_FORK}/releases/download/{}/{}",
            release.tag_name,target.asset);
        if asset.browser_download_url!=expected_url ||
            asset.size!=target.size || fork_digest(asset)?!=target.sha256.to_ascii_lowercase(){
            return Err(format!("El artefacto {} difiere del motor compartido",target.asset));
        }
    }
    Ok(())
}
fn fork_release<'a>(releases:&'a [ForkRelease],asset_name:&str)->Result<&'a ForkRelease,String>{
    releases.iter().find(|r| !r.draft && !r.prerelease && fork_tag_valid(&r.tag_name) &&
        r.assets.iter().any(|a|a.name=="vis-mcrust-release.json") &&
        r.assets.iter().any(|a|a.name==asset_name &&
            a.browser_download_url==format!(
                "https://github.com/{VIS_FORK}/releases/download/{}/{}",
                r.tag_name,asset_name) &&
            a.size>0 && a.size<=MAX_ARCHIVE && fork_digest(a).is_ok()))
        .ok_or_else(||"El fork todavía no publicó el motor compartido de PC y Android. Comprobá GitHub Actions del fork.".to_string())
}
fn fork_metadata(build:&Path,tag:&str)->Result<(),String>{
    let raw=fs::read(build.join("vis-horizon-source.json"))
        .map_err(|_|"Falta el manifiesto del build compilado en el fork")?;
    if raw.len()>256*1024 {return Err("Manifiesto Horizon demasiado grande".into());}
    let data:serde_json::Value=serde_json::from_slice(&raw)
        .map_err(|_|"Manifiesto VIS Horizon ilegible")?;
    if data["source_repo"].as_str()!=Some("https://github.com/JoseDaniel03/horizon-VISNEXO.git") ||
       data["game_binary"].as_str()!=Some("horizon-official") ||
       data["minecraft_assets_included"]!=false {
        return Err("Build Horizon no pertenece al fork VIS o incluye activos prohibidos".into());
    }
    let commit=data["source_commit"].as_str().ok_or("Falta commit del build")?;
    if commit.len()!=40 || !commit.bytes().all(|b|b.is_ascii_hexdigit()) ||
       !commit.starts_with(tag.strip_prefix("visgame-").unwrap_or("!")){
        return Err("El commit Horizon no coincide con la versión publicada".into());
    }
    let hashes=data["sha256"].as_object().ok_or("El manifiesto no contiene SHA-256 de los archivos")?;
    if hashes.len()<5 || hashes.len()>12000 {return Err("Manifiesto Horizon fuera de límites".into());}
    for required in [
        "research-lock.json",
        if cfg!(target_os="windows"){"horizon-client.exe"}else{"horizon-client"},
        if cfg!(target_os="windows"){"horizon-prepare.exe"}else{"horizon-prepare"},
    ]{
        if !hashes.contains_key(required){return Err(format!("Falta hash de {required}"))}
    }
    for (name,digest) in hashes{
        let rel=safe_rel(Path::new(name))?;
        // Releases contain only the compiled game, licences, and the open
        // Java source exporters. Never accept arbitrary DLLs or game assets.
        let client=if cfg!(target_os="windows"){"horizon-client.exe"}else{"horizon-client"};
        let preparer=if cfg!(target_os="windows"){"horizon-prepare.exe"}else{"horizon-prepare"};
        let base=matches!(name.as_str(),"LICENSE"|"THIRD_PARTY_NOTICES.md"|"research-lock.json")
            || name==client || name==preparer;
        let dxc=cfg!(target_os="windows") && matches!(name.as_str(),
            "dxcompiler.dll"|"DXC-LICENSE-MS.txt"|"DXC-LICENSE-LLVM.txt"|"DXC-NOTICE.txt");
        let exporter=name.starts_with("mods/horizon/src/test/java/dev/horizonlab/parity/")
            && name.ends_with(".java");
        if !base && !dxc && !exporter{
            return Err(format!("Archivo inesperado en el paquete Horizon: {name}"));
        }
        let expected=digest.as_str().ok_or("Huella inválida de archivo Horizon")?;
        if expected.len()!=64 || !expected.bytes().all(|b|b.is_ascii_hexdigit()) ||
           sha256_file(&build.join(rel))?!=expected.to_ascii_lowercase(){
            return Err(format!("Archivo del motor Horizon no coincide: {name}"));
        }
    }
    // Also reject extra files omitted from the manifest. The only permitted
    // addition after installation is VIS's own integrity stamp.
    let mut found=std::collections::BTreeSet::new();
    let mut pending=vec![build.to_path_buf()];
    let mut count=0usize;
    while let Some(folder)=pending.pop(){
        for item in fs::read_dir(&folder).map_err(|e|e.to_string())?{
            let item=item.map_err(|e|e.to_string())?;
            count+=1;
            if count>MAX_ITEMS{return Err("Paquete Horizon tiene demasiados archivos".into());}
            let path=item.path();
            let typ=fs::symlink_metadata(&path).map_err(|e|e.to_string())?.file_type();
            if typ.is_symlink(){return Err("El juego Horizon contiene un enlace simbólico".into());}
            if typ.is_dir(){pending.push(path);continue;}
            if !typ.is_file(){return Err("El juego Horizon contiene un objeto no permitido".into());}
            let relative=path.strip_prefix(build).map_err(|e|e.to_string())?
                .to_str().ok_or("Ruta no UTF-8 en Horizon")?
                .replace(std::path::MAIN_SEPARATOR,"/");
            if relative=="vis-horizon-source.json" || relative==GAME_FILES_STAMP{continue;}
            if !hashes.contains_key(&relative){
                return Err(format!("Archivo Horizon sin huella declarada: {relative}"));
            }
            found.insert(relative);
        }
    }
    if found.len()!=hashes.len(){return Err("Manifiesto Horizon incompleto".into());}
    Ok(())
}
/// Download Horizon only after the user selects an instance. All binaries live
/// inside the instance, not inside the AppImage, AppData or ~/.minecraft.
/// The new build is staged and verified before atomic publication.
pub fn install_fork(app:&AppHandle,dir:&Path,minecraft_version:&str)->Result<Installed,String>{
    crate::download_manager::checkpoint()?;
    if minecraft_version!="26.3" {
        return Err("El fork Horizon disponible implementa exclusivamente Minecraft 26.3".into())
    }
    let _guard=INSTALL_LOCK.lock().map_err(|_|"Ya hay una instalación Horizon en curso")?;
    crate::instance_guard::private_paths(dir,&[".vis",".vis/horizon-engine"])?;
    let archive=fork_asset_name()?;
    let http=client()?;
    let releases:Vec<ForkRelease>=http.get(VIS_FORK_API).send()
        .and_then(|r|r.error_for_status()).map_err(|e|format!("No se pudo consultar el fork: {e}"))?
        .json().map_err(|_|"El fork devolvió releases inválidos")?;
    let release=fork_release(&releases,archive)?;
    let tag=release.tag_name.clone();
    let asset=fork_asset(release,archive)?;
    let sha=fork_digest(asset)?;
    shared_contract(&http,release,archive,&sha)?;
    let expected_url=format!(
        "https://github.com/{VIS_FORK}/releases/download/{tag}/{archive}"
    );
    if asset.browser_download_url!=expected_url || asset.size==0 || asset.size>MAX_ARCHIVE {
        return Err("Metadatos Horizon inesperados".into());
    }
    let root=dir.join(".vis/horizon-engine");
    fs::create_dir_all(&root).map_err(|e|e.to_string())?;
    let final_dir=root.join(&tag);
    if final_dir.exists(){
        let record=fs::symlink_metadata(&final_dir).map_err(|e|e.to_string())?;
        if !record.is_dir() || record.file_type().is_symlink(){
            return Err("Un archivo ocupa la carpeta de la versión Horizon".into());
        }
        let pinned=fs::read_to_string(final_dir.join(".vis-release-sha256"))
            .map_err(|_|"Build previo de Horizon sin procedencia comprobable; revisión manual necesaria")?;
        if pinned.trim()!=sha {return Err("La publicación del fork cambió sin cambiar de versión".into());}
        let existing=find_build(&final_dir)?;
        fork_metadata(&existing,&tag)?;
        if verify_managed_build(&existing)?!=true{
            return Err("Build Horizon previamente instalado no tiene huellas verificadas".into());
        }
        return Ok(Installed{tag,build_dir:existing.to_string_lossy().into_owned(),archive_sha256:sha});
    }
    let stamp=SystemTime::now().duration_since(UNIX_EPOCH)
        .unwrap_or_default().as_nanos();
    let scratch=root.join(format!(".download-{}-{stamp}",std::process::id()));
    fs::create_dir(&scratch).map_err(|e|e.to_string())?;
    let _cleanup=TempGuard(scratch.clone());
    let archive_path=scratch.join(archive);
    emit(app,"Motor Rust",0,"Descargando Horizon desde el fork VIS (no incluye Minecraft ni su launcher)");
    let response=http.get(&expected_url).send().and_then(|r|r.error_for_status())
        .map_err(|e|format!("No se pudo descargar Horizon portable: {e}"))?;
    download_stream(app,response,&archive_path,&sha,asset.size)?;
    crate::download_manager::checkpoint()?;
    if fs::metadata(&archive_path).map_err(|e|e.to_string())?.len()!=asset.size {
        return Err("La descarga del motor Rust tiene tamaño incorrecto".into());
    }
    let unpacked=scratch.join("unpacked");
    fs::create_dir(&unpacked).map_err(|e|e.to_string())?;
    emit(app,"Motor Rust",85,"Comprobando archivos y desempaquetando");
    if archive.ends_with(".zip"){unpack_zip(&archive_path,&unpacked)?}
    else{unpack_tar(&archive_path,&unpacked)?}
    crate::download_manager::checkpoint()?;
    let built=find_build(&unpacked)?;
    fork_metadata(&built,&tag)?;
    executable_permissions(&built)?;
    save_game_stamp(&built,&tag)?;
    fs::write(unpacked.join(".vis-release-sha256"),&sha).map_err(|e|e.to_string())?;
    crate::download_manager::checkpoint()?;
    let nested=built.strip_prefix(&unpacked).map_err(|e|e.to_string())?.to_path_buf();
    fs::rename(&unpacked,&final_dir).map_err(|e|e.to_string())?;
    let installed=final_dir.join(nested);
    emit(app,"Motor Rust",100,"Horizon instalado dentro de la instancia. Preparando recursos oficiales.");
    Ok(Installed{tag,build_dir:installed.to_string_lossy().into_owned(),archive_sha256:sha})
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test] fn fork_release_requires_exact_repo_and_github_digest(){
        let name=fork_asset_name().unwrap();
        let good=ForkAsset{
            name:name.into(),
            browser_download_url:format!("https://github.com/{VIS_FORK}/releases/download/visgame-123456789abc/{name}"),
            size:25_000_000,
            digest:Some(format!("sha256:{}", "b".repeat(64)))
        };
        let release=ForkRelease{tag_name:"visgame-123456789abc".into(),draft:false,prerelease:false,assets:vec![good]};
        assert!(fork_release(&[release],"missing").is_err());
        assert!(fork_tag_valid("visgame-123456789abc"));
        assert!(!fork_tag_valid("visgame-../../bad"));
        let mut bad=ForkAsset{name:name.into(),browser_download_url:
            "https://attacker.invalid/game.tar.gz".into(),size:25000,
            digest:Some(format!("sha256:{}", "b".repeat(64)))};
        assert!(fork_release(&[ForkRelease{
            tag_name:"visgame-123456789abc".into(),draft:false,prerelease:false,assets:vec![bad.clone()]
        }],name).is_err());
        bad.browser_download_url=format!(
            "https://github.com/{VIS_FORK}/releases/download/visgame-123456789abc/{name}"
        );
        bad.digest=None;
        assert!(fork_release(&[ForkRelease{
            tag_name:"visgame-123456789abc".into(),draft:false,prerelease:false,assets:vec![bad]
        }],name).is_err());
    }
    #[test] fn shared_release_requires_three_matching_assets(){
        let tag="visgame-123456789abc";
        let mut targets=std::collections::BTreeMap::new();
        let mut assets=Vec::new();
        for (platform,name) in [
            ("linux-x86_64","vis-horizon-linux-x86_64.tar.gz"),
            ("windows-x64","vis-horizon-windows-x64.zip"),
            ("android-arm64","vis-horizon-android-arm64.apk")
        ] {
            targets.insert(platform.into(),shared_mcrust_catalog::Target{
                asset:name.into(),sha256:"a".repeat(64),size:5000,
                package:"com.visstudios.mcrust".into(),version_code:1001,
                certificate_sha256:"b".repeat(64)
            });
            assets.push(ForkAsset{name:name.into(),size:5000,digest:Some(format!("sha256:{}", "a".repeat(64))),
                browser_download_url:format!("https://github.com/{VIS_FORK}/releases/download/{tag}/{name}")});
        }
        let contract=shared_mcrust_catalog::Contract{
            schema:1,source_repo:format!("https://github.com/{VIS_FORK}.git"),
            engine_commit:"123456789abc0000000000000000000000000000".into(),
            minecraft:"26.3".into(),protocol:777,data_version:5023,
            resource_pack:[97,1],data_pack:[121,0],targets
        };
        let mut release=ForkRelease{tag_name:tag.into(),draft:false,prerelease:false,assets};
        contract.validate(tag).unwrap();
        assert!(fork_assets_match_contract(&release,&contract).is_ok());
        release.assets.pop();
        assert!(fork_assets_match_contract(&release,&contract).is_err());
        release.assets.push(ForkAsset{
            name:"vis-horizon-android-arm64.apk".into(),size:5000,
            digest:Some(format!("sha256:{}", "c".repeat(64))),
            browser_download_url:format!("https://github.com/{VIS_FORK}/releases/download/{tag}/vis-horizon-android-arm64.apk")
        });
        assert!(fork_assets_match_contract(&release,&contract).is_err());
        release.assets.last_mut().unwrap().digest=Some(format!("sha256:{}", "a".repeat(64)));
        release.assets.push(release.assets.last().unwrap().clone());
        assert!(fork_assets_match_contract(&release,&contract).is_err());
        release.prerelease=true;
        assert!(fork_release(&[release],"vis-horizon-android-arm64.apk").is_err());
    }
    #[test] fn fork_metadata_rejects_tampering_and_wrong_commit(){
        let stamp=SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir=std::env::temp_dir().join(format!("vis-fork-tests-{}-{stamp}",std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let entries=[
            binary(&dir,"horizon-client"),binary(&dir,"horizon-prepare"),
            dir.join("research-lock.json"),dir.join("LICENSE"),
            dir.join("THIRD_PARTY_NOTICES.md")
        ];
        let mut hashes=serde_json::Map::new();
        for path in entries{
            fs::write(&path,b"test-bytes").unwrap();
            hashes.insert(path.file_name().unwrap().to_string_lossy().into_owned(),
                serde_json::Value::String(sha256_file(&path).unwrap()));
        }
        let tag="visgame-123456789abc";
        let data=serde_json::json!({
            "source_repo":"https://github.com/JoseDaniel03/horizon-VISNEXO.git",
            "source_commit":"123456789abc0000000000000000000000000000",
            "minecraft_assets_included":false,"game_binary":"horizon-official","sha256":hashes
        });
        fs::write(dir.join("vis-horizon-source.json"),serde_json::to_vec(&data).unwrap()).unwrap();
        assert!(fork_metadata(&dir,tag).is_ok());
        // Extra files must be rejected even when declared checksums match.
        fs::write(dir.join("unexpected.dll"),b"not in manifest").unwrap();
        assert!(fork_metadata(&dir,tag).is_err());
        fs::remove_file(dir.join("unexpected.dll")).unwrap();
        assert!(fork_metadata(&dir,tag).is_ok());
        fs::write(binary(&dir,"horizon-client"),b"tampered").unwrap();
        assert!(fork_metadata(&dir,tag).is_err());
        assert!(fork_metadata(&dir,"visgame-abcdef123456").is_err());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test] fn nightly_title_is_bound_to_tag_and_commit(){
        let base=Release{tag_name:"nightly".into(),name:"Nightly 2026-11-10 · a1b2c3d".into(),
            draft:false,prerelease:false,assets:vec![],published_at:None};
        assert_eq!(signed_version(&base).unwrap(),"nightly-2026-11-10-a1b2c3d");
        let previous=Release{tag_name:"nightly-2026-11-09".into(),name:"Nightly 2026-11-10 · a1b2c3d".into(),
            draft:false,prerelease:false,assets:vec![],published_at:None};
        assert!(signed_version(&previous).is_none());
    }
    #[test] fn signed_manifest_must_name_exact_asset(){
        let sums=b"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  horizon-linux-x86_64.tar.gz\n";
        assert_eq!(checksum_of(sums,"horizon-linux-x86_64.tar.gz").unwrap().len(),64);
        assert!(checksum_of(sums,"horizon-launcher-linux-x86_64.tar.gz").is_err());
    }
    #[test] fn no_path_traversal(){
        assert!(safe_rel(Path::new("../accounts.json")).is_err());
        assert!(safe_rel(Path::new("/etc/passwd")).is_err());
        assert!(safe_rel(Path::new("versions/client")).is_ok());
    }
    #[test] fn reject_unsigned_release(){
        assert!(signature_is_valid("nightly-2026-11-10-abcd",b"test",b"invalid").is_err());
    }
    #[test] fn stored_binary_fingerprints_detect_changes(){
        let staging=std::env::temp_dir().join(format!("vis-horizon-stamp-test-{}-{}",std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir(&staging).unwrap();
        for name in ["horizon-client","horizon-prepare"]{
            fs::write(binary(&staging,name),b"genuine").unwrap();
        }
        fs::write(staging.join("research-lock.json"),b"genuine").unwrap();
        save_game_stamp(&staging,"nightly-2026-11-10-abcdef0").unwrap();
        assert_eq!(verify_managed_build(&staging).unwrap(),true);
        fs::write(binary(&staging,"horizon-client"),b"changed").unwrap();
        assert!(verify_managed_build(&staging).is_err());
        fs::remove_dir_all(staging).unwrap();
    }
    #[test] fn older_builds_without_stamp_are_not_falsely_verified(){
        let staging=std::env::temp_dir().join(format!("vis-horizon-legacy-test-{}",std::process::id()));
        assert_eq!(verify_managed_build(&staging).unwrap(),false);
    }
}
