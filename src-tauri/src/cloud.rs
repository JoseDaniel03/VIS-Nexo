//! VIS Ombú / Universe: public, read-only catalog and verified project archives.
//! This is distribution, not identity, and it never overwrites personal game data.
use reqwest::{blocking::Client, Url};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, fs::{self, File}, io::{Read, Write}, path::{Path, PathBuf}, time::Duration};

const MAX_MANIFEST_BYTES: usize = 2 * 1024 * 1024;
const MAX_BUNDLE_BYTES: u64 = 1024 * 1024 * 1024;
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct CloudConfig { pub catalog_url: String }

#[derive(Clone, Serialize, Deserialize)]
pub struct PublishedProject {
    pub id: String,
    pub name: String,
    #[serde(default)] pub description: String,
    pub version: String,
    #[serde(default)] pub minecraft_version: String,
    #[serde(default)] pub loader: String,
    #[serde(default)] pub bundle_url: String,
    #[serde(default)] pub sha256: String,
    #[serde(default)] pub size_bytes: u64,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct CloudCatalog {
    pub source: String,
    pub projects: Vec<PublishedProject>,
}
#[derive(Deserialize)]
struct Manifest { format_version: u32, projects: Vec<PublishedProject> }
fn client() -> Result<Client,String> {
    Client::builder().timeout(Duration::from_secs(40))
      .redirect(reqwest::redirect::Policy::custom(|attempt|{
          if attempt.previous().len()>=5 || !approved_url(attempt.url().as_str()){attempt.stop()}else{attempt.follow()}
      }))
      .user_agent("VIS-Nexo/2.9 (public project catalog)")
      .build().map_err(|e| e.to_string())
}
fn clean_id(s:&str) -> bool {
    !s.is_empty() && s.len() <= 100 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b))
}
/// Only public HTTPS endpoints known to support static, authenticated-by-hash distribution.
/// No localhost, cloud metadata or private-network SSRF destinations.
pub fn approved_url(uri: &str) -> bool {
    let Ok(url) = Url::parse(uri) else {return false};
    if url.scheme() != "https" || url.username() != "" || url.password().is_some() || url.port().is_some() {return false}
    let Some(host) = url.host_str() else {return false};
    host == "raw.githubusercontent.com" || host == "github.com" || host == "objects.githubusercontent.com"
    || host == "release-assets.githubusercontent.com"
    || (host.ends_with(".github.io") && host.len()>".github.io".len())
    || (host.ends_with(".pages.dev") && host.len()>".pages.dev".len())
    || (host.ends_with(".r2.dev") && host.len()>".r2.dev".len())
}
fn config_path(data_root: &Path) -> PathBuf {data_root.join("vis-cloud-config.json")}
pub fn catalog_url(data_root:&Path) -> Option<String> {
    let from_local = fs::read(config_path(data_root)).ok()
      .and_then(|bytes| serde_json::from_slice::<CloudConfig>(&bytes).ok())
      .map(|config| config.catalog_url).filter(|url|approved_url(url));
    from_local.or_else(||option_env!("VIS_CATALOG_URL").map(str::to_owned).filter(|url|approved_url(url)))
}
pub fn save_catalog_url(data_root:&Path,url:&str) -> Result<(),String> {
    if !url.is_empty() && !approved_url(url){return Err("Catálogo: solo HTTPS desde GitHub Pages, GitHub Releases o R2 público".into())}
    crate::accounts::atomic_json(&config_path(data_root),&CloudConfig{catalog_url:url.into()})
}
pub fn fetch(data_root:&Path) -> Result<CloudCatalog,String> {
    let Some(url)=catalog_url(data_root) else{return Ok(CloudCatalog{source:String::new(),projects:vec![]})};
    let response=client()?.get(&url).send().and_then(|res|res.error_for_status()).map_err(|e|format!("Catálogo remoto: {e}"))?;
    if response.content_length().is_some_and(|n|n>MAX_MANIFEST_BYTES as u64){return Err("El catálogo supera el tamaño máximo".into())}
    let mut limited=vec![];
    response.take(MAX_MANIFEST_BYTES as u64+1).read_to_end(&mut limited).map_err(|e|e.to_string())?;
    if limited.len()>MAX_MANIFEST_BYTES{return Err("Catálogo demasiado grande".into())}
    let manifest:Manifest=serde_json::from_slice(&limited).map_err(|e|format!("Formato de catálogo inválido: {e}"))?;
    if manifest.format_version!=1||manifest.projects.len()>200{return Err("Versión de catálogo no soportada o demasiados proyectos".into())}
    let mut ids=HashSet::new();
    for project in &manifest.projects {
        if !clean_id(&project.id) || !ids.insert(&project.id)
            || project.name.trim().is_empty() || project.name.len()>100
            || project.version.is_empty() || project.version.len()>55 || project.description.len()>2000
            || !project.version.bytes().all(|b|b.is_ascii_alphanumeric() || b"._-".contains(&b))
            || project.version=="." || project.version==".." {
                return Err("Proyecto remoto duplicado o inválido".into());
            }
        if !project.bundle_url.is_empty() {
            if !approved_url(&project.bundle_url) || project.sha256.len()!=64 || !project.sha256.bytes().all(|c|c.is_ascii_hexdigit())
                || project.size_bytes==0 || project.size_bytes>MAX_BUNDLE_BYTES {return Err("Archivo de proyecto no verificable".into())}
        }
    }
    Ok(CloudCatalog { source:url,projects:manifest.projects })
}
pub fn download(data_root:&Path,id:&str)->Result<String,String>{
    if !clean_id(id){return Err("Identificador de proyecto inválido".into())}
    // Recheck public manifest rather than trust any URL supplied by the webview.
    let catalog=fetch(data_root)?;
    let p=catalog.projects.iter().find(|p|p.id==id).ok_or("Proyecto no publicado")?;
    if p.bundle_url.is_empty(){return Err("Este proyecto no tiene un paquete publicado".into())}
    let expected=p.sha256.to_lowercase();
    let directory=data_root.join("project-packages").join(id);
    fs::create_dir_all(&directory).map_err(|e|e.to_string())?;
    let file_name=format!("{}.zip",p.version);
    let destination=directory.join(file_name);
    if destination.is_file() && fs::metadata(&destination).is_ok_and(|m|m.len()==p.size_bytes) {
        let mut stream=File::open(&destination).map_err(|e|e.to_string())?;
        let mut digest=Sha256::new();let mut buf=[0u8;65536];
        loop {let n=stream.read(&mut buf).map_err(|e|e.to_string())?;if n==0{break}digest.update(&buf[..n]);}
        if format!("{:x}",digest.finalize())==expected{return Ok(destination.to_string_lossy().into_owned())}
    }
    let partial=destination.with_extension("part");
    let outcome=(||->Result<(),String>{
        let mut response=client()?.get(&p.bundle_url).send().and_then(|res|res.error_for_status()).map_err(|e|format!("Archivo remoto: {e}"))?;
        if response.content_length().is_some_and(|n|n>MAX_BUNDLE_BYTES){return Err("Paquete demasiado grande".into())}
        let mut out=File::create(&partial).map_err(|e|e.to_string())?;
        let mut hasher=Sha256::new();let mut total=0;let mut buffer=[0u8;65536];
        loop {let read=response.read(&mut buffer).map_err(|e|e.to_string())?;if read==0{break}
            total+=read as u64;if total>MAX_BUNDLE_BYTES || total>p.size_bytes {return Err("Tamaño de descarga no coincide con el manifiesto".into())}
            hasher.update(&buffer[..read]);out.write_all(&buffer[..read]).map_err(|e|e.to_string())?;
        }
        out.flush().map_err(|e|e.to_string())?;drop(out);
        if total!=p.size_bytes || format!("{:x}",hasher.finalize())!=expected{return Err("SHA-256 o tamaño incorrecto: no se aceptó el archivo".into())}
        fs::rename(&partial,&destination).map_err(|e|e.to_string())?;Ok(())
    })();
    if outcome.is_err(){let _=fs::remove_file(&partial);}
    outcome?;Ok(destination.to_string_lossy().into_owned())
}
#[cfg(test)] mod tests {
 use super::*;
 #[test] fn url_rules(){
   assert!(approved_url("https://raw.githubusercontent.com/owner/repo/main/vis.json"));
   assert!(approved_url("https://example.pages.dev/vis.json"));
   assert!(!approved_url("https://localhost/path"));
   assert!(!approved_url("http://example.pages.dev/vis.json"));
   assert!(!approved_url("https://evil.githubusercontent.com.attacker.test/path"));
 }
}
