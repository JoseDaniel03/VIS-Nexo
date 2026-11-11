//! Optional source-built VIS Rust Edition runtime, not the Horizon Launcher.
//! The launcher remains usable without the game. A pinned, SHA-256 verified
//! engine is fetched only when the player chooses to install/play Rust Edition.
use flate2::read::GzDecoder;
use reqwest::blocking::Client;
use serde::Deserialize;
use sha2::{Digest,Sha256};
use std::{collections::{BTreeMap,BTreeSet},fs::{self,File},io::{Read,Write},
    path::{Component,Path,PathBuf},time::{Duration,SystemTime,UNIX_EPOCH}};
use tauri::{AppHandle,Manager};

const OFFICIAL:&str="https://github.com/horizon-rust/horizon.git";
const MAX_ARCHIVE:u64=256*1024*1024;
const MAX_UNPACKED:u64=512*1024*1024;

#[derive(Debug,Deserialize)]
pub struct Descriptor {
    format:u64,
    source_repo:String,
    source_commit:String,
    os:String,
    arch:String,
    archive:String,
    archive_sha256:String,
    archive_size:u64,
    download_url:String,
    files_sha256:BTreeMap<String,String>,
}
fn sha256_file(file:&Path)->Result<String,String>{
    let mut reader=File::open(file).map_err(|e|e.to_string())?;
    let mut hash=Sha256::new();let mut buf=[0u8;65536];
    loop{let n=reader.read(&mut buf).map_err(|e|e.to_string())?;if n==0{break}hash.update(&buf[..n]);}
    Ok(format!("{:x}",hash.finalize()))
}
fn hex_sha(value:&str)->bool{value.len()==64&&value.bytes().all(|b|b.is_ascii_hexdigit())}
fn safe_relative(value:&str)->Result<PathBuf,String>{
    let path=Path::new(value);
    if value.is_empty()||value.len()>240||value.contains('\\')||value.contains(':')||path.is_absolute(){
        return Err("Ruta insegura en VIS Rust Edition".into());
    }
    let mut count=0;
    for part in path.components(){
        match part{Component::Normal(_)=>{count+=1;if count>16{return Err("Ruta demasiado profunda".into())}},
            _=>return Err("Directorio padre o ruta especial no permitida".into())}
    }
    if count==0{return Err("Ruta vacía del motor".into())}
    Ok(path.to_path_buf())
}
impl Descriptor {
    fn validate(&self)->Result<(),String>{
        if self.format!=1||self.source_repo!=OFFICIAL||self.arch!="x86_64"{
            return Err("El manifiesto Rust Edition no corresponde a este cliente".into());
        }
        if self.source_commit.len()!=40||!self.source_commit.bytes().all(|b|b.is_ascii_hexdigit()){
            return Err("Commit oficial del motor inválido".into());
        }
        let platform=if cfg!(windows){"windows"}else if cfg!(target_os="linux"){"linux"}else{"unsupported"};
        if self.os!=platform{return Err("El módulo Rust Edition corresponde a otro sistema".into())}
        let expected=match platform{
            "windows"=>"VIS-Rust-Edition-Windows-x64-Engine.zip",
            "linux"=>"VIS-Rust-Edition-Linux-x86_64-Engine.tar.gz",
            _=>return Err("Sistema no compatible con el motor Rust Edition".into()),
        };
        if self.archive!=expected||!hex_sha(&self.archive_sha256)||self.archive_size==0||self.archive_size>MAX_ARCHIVE{
            return Err("Paquete opcional Rust Edition inválido".into());
        }
        if self.files_sha256.len()<4||self.files_sha256.len()>16384{
            return Err("Manifiesto de archivos del juego incompleto".into());
        }
        for (name,hash) in &self.files_sha256{
            safe_relative(name)?;
            if !hex_sha(hash){return Err("SHA-256 inválido en recursos Rust Edition".into())}
        }
        for name in [format!("horizon-client{}",if cfg!(windows){".exe"}else{""}),
            format!("horizon-prepare{}",if cfg!(windows){".exe"}else{""}),
            "research-lock.json".to_owned(),"vis-horizon-source.json".to_owned()]{
            if !self.files_sha256.contains_key(&name){return Err(format!("Componente del juego ausente: {name}"))}
        }
        if !self.download_url.is_empty() {
            let parsed=url::Url::parse(&self.download_url).map_err(|e|e.to_string())?;
            let parts=parsed.path_segments().ok_or("URL de descarga inválida")?.collect::<Vec<_>>();
            if parsed.scheme()!="https"||parsed.host_str()!=Some("github.com")||
                parsed.query().is_some()||parsed.fragment().is_some()||parsed.username()!=""||
                !parsed.password().unwrap_or_default().is_empty()||
                parts.len()!=6||parts[0]!="JoseDaniel03"||parts[1]!="VIS-Nexo"||
                parts[2]!="releases"||parts[3]!="download"||
                !parts[4].starts_with("nexo-v")||parts[5]!=self.archive {
                return Err("Descarga del juego fuera de GitHub Releases oficial".into());
            }
        }
        Ok(())
    }
}
fn manifest(app:&AppHandle)->Result<Descriptor,String>{
    let path=app.path().resource_dir().map_err(|e|e.to_string())?.join("vis-rust-runtime.json");
    let json=fs::read(&path).map_err(|_|"No hay manifiesto VIS Rust Edition en esta compilación".to_owned())?;
    if json.len()>1024*1024{return Err("Manifiesto del motor demasiado grande".into())}
    let manifest:Descriptor=serde_json::from_slice(&json).map_err(|e|e.to_string())?;
    manifest.validate()?;
    Ok(manifest)
}
fn target(app:&AppHandle,info:&Descriptor)->Result<PathBuf,String>{
    Ok(app.path().app_data_dir().map_err(|e|e.to_string())?
        .join("vis-rust-runtime").join(&info.source_commit))
}
fn verify_files(root:&Path,info:&Descriptor)->Result<(),String>{
    for (name,hash) in &info.files_sha256{
        let path=root.join(safe_relative(name)?);
        let meta=fs::symlink_metadata(&path).map_err(|e|e.to_string())?;
        if !meta.file_type().is_file() || sha256_file(&path)?.to_lowercase()!=hash.to_lowercase(){
            return Err(format!("Integridad inválida del motor Rust Edition: {name}"));
        }
    }
    let source:serde_json::Value=serde_json::from_slice(
        &fs::read(root.join("vis-horizon-source.json")).map_err(|e|e.to_string())?)
        .map_err(|e|e.to_string())?;
    if source["source_repo"].as_str()!=Some(OFFICIAL)||
        source["source_commit"].as_str()!=Some(info.source_commit.as_str()){
        return Err("Origen o commit del juego no coincide con la versión firmada".into());
    }
    Ok(())
}
pub fn installed_path(app:&AppHandle)->Option<PathBuf>{
    let info=manifest(app).ok()?;
    let root=target(app,&info).ok()?;
    // Avoid hashing all files on VIS startup; game installation and launch
    // re-check integrity before actually executing anything.
    if root.join("vis-horizon-source.json").is_file(){Some(root)}else{None}
}
fn write_file<R:Read>(mut reader:R,root:&Path,name:&str,expected:u64)->Result<(),String>{
    if expected>MAX_UNPACKED{return Err("Archivo demasiado grande".into())}
    let dest=root.join(safe_relative(name)?);
    if let Some(parent)=dest.parent(){fs::create_dir_all(parent).map_err(|e|e.to_string())?}
    let mut writer=File::create(&dest).map_err(|e|e.to_string())?;
    let copied=std::io::copy(&mut reader.take(expected+1),&mut writer).map_err(|e|e.to_string())?;
    if copied!=expected{return Err("Tamaño de recurso del juego inconsistente".into())}
    writer.flush().map_err(|e|e.to_string())
}
fn extract(path:&Path,root:&Path,info:&Descriptor)->Result<(),String>{
    let mut seen=BTreeSet::new();let mut unpacked=0u64;
    if cfg!(windows){
        let file=File::open(path).map_err(|e|e.to_string())?;
        let mut zip=zip::ZipArchive::new(file).map_err(|e|e.to_string())?;
        if zip.len()!=info.files_sha256.len(){return Err("Archivos inesperados en el ZIP del juego".into())}
        for index in 0..zip.len(){
            let mut member=zip.by_index(index).map_err(|e|e.to_string())?;
            let name=member.name().to_owned();
            if !info.files_sha256.contains_key(&name)||member.is_dir()||
                member.unix_mode().is_some_and(|mode|mode&0o170000==0o120000)||
                !seen.insert(name.clone()) {
                return Err("Archivo de juego desconocido, repetido o enlazado".into());
            }
            unpacked=unpacked.checked_add(member.size()).ok_or("Desborde de tamaño")?;
            if unpacked>MAX_UNPACKED{return Err("El motor supera el espacio permitido".into())}
            let size=member.size();
            write_file(&mut member,root,&name,size)?;
        }
    }else{
        let file=File::open(path).map_err(|e|e.to_string())?;
        let mut archive=tar::Archive::new(GzDecoder::new(file));
        for entry in archive.entries().map_err(|e|e.to_string())?{
            let mut member=entry.map_err(|e|e.to_string())?;
            if !member.header().entry_type().is_file(){return Err("El TAR del motor incluye un elemento no regular".into())}
            let name=member.path().map_err(|e|e.to_string())?.to_str().ok_or("Nombre no UTF-8")?.to_owned();
            if !info.files_sha256.contains_key(&name)||!seen.insert(name.clone()){
                return Err("Ruta de motor desconocida o duplicada".into());
            }
            let size=member.size();unpacked=unpacked.checked_add(size).ok_or("Desborde de tamaño")?;
            if unpacked>MAX_UNPACKED{return Err("Motor Rust Edition demasiado grande".into())}
            write_file(&mut member,root,&name,size)?;
            #[cfg(unix)]{
                use std::os::unix::fs::PermissionsExt;
                if name=="horizon-client"||name=="horizon-prepare" {
                    fs::set_permissions(root.join(&name),fs::Permissions::from_mode(0o700))
                        .map_err(|e|e.to_string())?;
                }
            }
        }
        if seen.len()!=info.files_sha256.len(){return Err("El TAR del motor está incompleto".into())}
    }
    Ok(())
}
pub fn ensure(app:&AppHandle)->Result<PathBuf,String>{
    if let Ok(exists)=crate::horizon::bundled_source_path(){
        return Ok(PathBuf::from(exists)); // Full legacy releases still work.
    }
    let info=manifest(app)?;
    let destination=target(app,&info)?;
    if destination.is_dir(){
        verify_files(&destination,&info)?;
        crate::horizon::activate_source(&destination)?;
        return Ok(destination);
    }
    if info.download_url.is_empty(){
        return Err("El módulo de VIS Rust Edition todavía no está publicado. Usá una Release oficial o importá un build de juego existente.".into());
    }
    let parent=destination.parent().ok_or("Ruta de juego no válida")?;
    fs::create_dir_all(parent).map_err(|e|e.to_string())?;
    let stamp=SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e|e.to_string())?.as_nanos();
    let temp=parent.join(format!(".rust-download-{}-{stamp}",std::process::id()));
    fs::create_dir_all(&temp).map_err(|e|e.to_string())?;
    let outcome=(||->Result<(),String>{
        let downloaded=temp.join("payload.download");
        let client=Client::builder().timeout(Duration::from_secs(300))
            .user_agent("VIS-Nexo-Rust-Edition/2.20").build().map_err(|e|e.to_string())?;
        let mut response=client.get(&info.download_url).send()
            .and_then(|r|r.error_for_status()).map_err(|e|format!("No se pudo descargar VIS Rust Edition: {e}"))?;
        let mut output=File::create(&downloaded).map_err(|e|e.to_string())?;
        let bytes=std::io::copy(&mut response.take(MAX_ARCHIVE+1),&mut output).map_err(|e|e.to_string())?;
        drop(output);
        if bytes!=info.archive_size||bytes>MAX_ARCHIVE||
            !sha256_file(&downloaded)?.eq_ignore_ascii_case(&info.archive_sha256){
            return Err("Descarga del juego incompleta o diferente de la versión verificada".into());
        }
        let stage=temp.join("engine");
        fs::create_dir_all(&stage).map_err(|e|e.to_string())?;
        extract(&downloaded,&stage,&info)?;
        verify_files(&stage,&info)?;
        fs::rename(&stage,&destination).map_err(|e|e.to_string())?;
        Ok(())
    })();
    let _=fs::remove_dir_all(&temp);
    outcome?;
    crate::horizon::activate_source(&destination)?;
    Ok(destination)
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test]fn safe_paths_reject_traversal(){
        assert!(safe_relative("mods/horizon/src/test.java").is_ok());
        for value in ["../accounts.json","/etc/passwd","C:\\secret","a/../b","./b",""]{
            assert!(safe_relative(value).is_err(),"{value}");
        }
    }
    #[test]fn pinned_runtime_cannot_use_untrusted_host(){
        let info=Descriptor{format:1,source_repo:OFFICIAL.into(),source_commit:"a".repeat(40),
            os:if cfg!(windows){"windows"}else{"linux"}.into(),arch:"x86_64".into(),
            archive:if cfg!(windows){"VIS-Rust-Edition-Windows-x64-Engine.zip"}else{"VIS-Rust-Edition-Linux-x86_64-Engine.tar.gz"}.into(),
            archive_sha256:"b".repeat(64),archive_size:1024,
            download_url:"https://example.com/evil.zip".into(),
            files_sha256:BTreeMap::new()};
        assert!(info.validate().is_err());
    }
}
