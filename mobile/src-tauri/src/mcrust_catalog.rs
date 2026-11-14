//! One release contract for PC and Android. Never fall back to the old external Android port.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap,fs,io::{Read,Write},path::{Path,PathBuf},time::Duration};
const REPO:&str="JoseDaniel03/horizon-VISNEXO";
pub const PACKAGE:&str="com.visstudios.mcrust";
const APK:&str="vis-horizon-android-arm64.apk";
#[derive(Clone,Deserialize,Serialize)]
pub struct Target {pub asset:String,pub sha256:String,pub size:u64,#[serde(default)]pub package:String,#[serde(default)]pub version_code:i64,#[serde(default)]pub certificate_sha256:String}
#[derive(Clone,Deserialize,Serialize)]
pub struct Contract {pub schema:u32,pub source_repo:String,pub engine_commit:String,pub minecraft:String,pub protocol:i32,pub data_version:i32,pub resource_pack:[i32;2],pub data_pack:[i32;2],pub targets:BTreeMap<String,Target>}
#[derive(Deserialize)]
struct Release {tag_name:String,draft:bool,#[serde(default)]prerelease:bool,assets:Vec<Asset>}
#[derive(Deserialize)]
struct Asset{name:String,size:u64,digest:Option<String>,browser_download_url:String}
fn hash_ok(s:&str,n:usize)->bool{s.len()==n&&s.bytes().all(|b|b.is_ascii_hexdigit())}
impl Contract {
 pub fn validate(&self,tag:&str)->Result<&Target,String>{
  if self.schema!=1||self.source_repo!=format!("https://github.com/{REPO}.git")||!hash_ok(&self.engine_commit,40)||tag!=format!("visgame-{}",&self.engine_commit[..12])||self.minecraft!="26.3"||self.protocol!=777||self.data_version!=5023||self.resource_pack!=[97,1]||self.data_pack!=[121,0]{return Err("El motor publicado no corresponde a la versión compartida con PC".into());}
  for (platform,asset) in [("linux-x86_64","vis-horizon-linux-x86_64.tar.gz"),("windows-x64","vis-horizon-windows-x64.zip"),("android-arm64",APK)]{
   let target=self.targets.get(platform).ok_or("El release no contiene las tres plataformas del mismo motor")?;
   if target.asset!=asset||!hash_ok(&target.sha256,64)||target.size==0||target.size>256*1024*1024{return Err("Artefacto del motor inválido".into());}
  }
  let target=&self.targets["android-arm64"];
  if target.package!=PACKAGE||target.version_code<=0||!hash_ok(&target.certificate_sha256,64){return Err("APK sin identidad de firma válida del motor unificado".into());}
  Ok(target)
 }
}
fn client()->Result<reqwest::blocking::Client,String>{reqwest::blocking::Client::builder().user_agent("VIS-Nexo-McRust/1").connect_timeout(Duration::from_secs(15)).timeout(Duration::from_secs(180)).redirect(reqwest::redirect::Policy::custom(|a|{
 if a.previous().len()<5&&a.url().scheme()=="https"&&matches!(a.url().host_str(),Some("github.com"|"release-assets.githubusercontent.com"|"objects.githubusercontent.com"|"github-releases.githubusercontent.com")){a.follow()}else{a.stop()}
})).build().map_err(|e|e.to_string())}
fn url(tag:&str,name:&str)->String{format!("https://github.com/{REPO}/releases/download/{tag}/{name}")}
fn verify_asset(asset:&Asset,tag:&str,name:&str)->Result<String,String>{
 let digest=asset.digest.as_deref().and_then(|v|v.strip_prefix("sha256:")).filter(|v|hash_ok(v,64)).ok_or("GitHub no publicó SHA-256 del artefacto")?;
 if asset.name!=name||asset.browser_download_url!=url(tag,name){return Err("Origen no permitido para McRust".into());}
 Ok(digest.to_ascii_lowercase())
}
fn verified_bytes(http:&reqwest::blocking::Client,asset:&Asset,tag:&str,name:&str,max:u64)->Result<Vec<u8>,String>{
 let digest=verify_asset(asset,tag,name)?;
 if asset.size==0||asset.size>max{return Err("Manifiesto fuera de tamaño".into());}
 let response=http.get(url(tag,name)).send().and_then(|r|r.error_for_status()).map_err(|e|e.to_string())?;
 let mut bytes=Vec::new();response.take(max+1).read_to_end(&mut bytes).map_err(|e|e.to_string())?;
 if bytes.len()as u64!=asset.size||format!("{:x}",Sha256::digest(&bytes))!=digest{return Err("La integridad del manifiesto no coincide".into());}Ok(bytes)
}
pub fn obtain(cache:&Path)->Result<(Contract,PathBuf),String>{
 let http=client()?;
 let response=http.get(format!("https://api.github.com/repos/{REPO}/releases?per_page=15")).send().and_then(|r|r.error_for_status()).map_err(|_|"No se pudo consultar la versión de McRust".to_string())?;
 let mut bytes=Vec::new();response.take(2*1024*1024+1).read_to_end(&mut bytes).map_err(|e|e.to_string())?;
 if bytes.len()>2*1024*1024{return Err("Catálogo demasiado grande".into());}
 let releases:Vec<Release>=serde_json::from_slice(&bytes).map_err(|_|"Catálogo del motor inválido")?;
 for release in releases {
  if release.draft||release.prerelease||!release.tag_name.starts_with("visgame-"){continue;}
  let Some(manifest)=release.assets.iter().find(|a|a.name=="vis-mcrust-release.json")else{continue};
  let raw=verified_bytes(&http,manifest,&release.tag_name,"vis-mcrust-release.json",128*1024)?;
  let contract:Contract=serde_json::from_slice(&raw).map_err(|_|"Manifiesto compartido inválido")?;
  let target=contract.validate(&release.tag_name)?;
  let apk=release.assets.iter().find(|a|a.name==APK).ok_or("Falta el APK de este release")?;
  if verify_asset(apk,&release.tag_name,APK)?!=target.sha256||apk.size!=target.size{return Err("El APK no coincide con el manifiesto del motor de PC".into());}
  let folder=cache.join("mcrust").join(&contract.engine_commit);fs::create_dir_all(&folder).map_err(|e|e.to_string())?;
  let path=folder.join(APK);
  if valid_file(&path,target)?{return Ok((contract,path));}
  let temp=folder.join(format!("download-{}.part",std::process::id()));
  let result=(||->Result<(),String>{
   let mut response=http.get(url(&release.tag_name,APK)).send().and_then(|r|r.error_for_status()).map_err(|e|e.to_string())?;
   let mut out=fs::File::create(&temp).map_err(|e|e.to_string())?;
   let mut hash=Sha256::new();let mut size=0u64;let mut chunk=[0u8;65536];
   loop{let n=response.read(&mut chunk).map_err(|e|e.to_string())?;if n==0{break;}size+=n as u64;if size>target.size{return Err("Descarga de APK demasiado grande".into());}hash.update(&chunk[..n]);out.write_all(&chunk[..n]).map_err(|e|e.to_string())?;}
   out.sync_all().map_err(|e|e.to_string())?;drop(out);
   if size!=target.size||format!("{:x}",hash.finalize())!=target.sha256{return Err("El SHA-256 del APK no coincide".into());}
   if path.exists(){fs::remove_file(&path).map_err(|e|e.to_string())?;}fs::rename(&temp,&path).map_err(|e|e.to_string())?;Ok(())
  })();if result.is_err(){let _=fs::remove_file(&temp);}result?;
  return Ok((contract,path));
 }
 Err("Todavía no se publicó una versión Android del mismo motor que PC. Nexo no instalará el port experimental anterior".into())
}
fn valid_file(path:&Path,target:&Target)->Result<bool,String>{
 let metadata=match fs::symlink_metadata(path){Ok(v)=>v,Err(e)if e.kind()==std::io::ErrorKind::NotFound=>return Ok(false),Err(e)=>return Err(e.to_string())};
 if !metadata.is_file()||metadata.file_type().is_symlink()||metadata.len()!=target.size{return Ok(false);}
 let mut f=fs::File::open(path).map_err(|e|e.to_string())?;let mut hash=Sha256::new();let mut chunk=[0u8;65536];loop{let n=f.read(&mut chunk).map_err(|e|e.to_string())?;if n==0{break;}hash.update(&chunk[..n]);}Ok(format!("{:x}",hash.finalize())==target.sha256)
}

#[cfg(test)]
mod tests {
 use super::*;
 fn release()->Contract {let mut targets=BTreeMap::new();for (platform,name) in [("linux-x86_64","vis-horizon-linux-x86_64.tar.gz"),("windows-x64","vis-horizon-windows-x64.zip"),("android-arm64",APK)] {targets.insert(platform.into(),Target{asset:name.into(),sha256:"a".repeat(64),size:123,package:PACKAGE.into(),version_code:123,certificate_sha256:"b".repeat(64)});}Contract{schema:1,source_repo:format!("https://github.com/{REPO}.git"),engine_commit:"c".repeat(40),minecraft:"26.3".into(),protocol:777,data_version:5023,resource_pack:[97,1],data_pack:[121,0],targets}}
 #[test] fn all_platforms_share_exact_revision(){let c=release();assert!(c.validate("visgame-cccccccccccc").is_ok());assert!(c.validate("visgame-dddddddddddd").is_err());}
 #[test] fn same_version_different_protocol_rejected(){let mut c=release();c.protocol+=1;assert!(c.validate("visgame-cccccccccccc").is_err());}
 #[test] fn preview_and_incomplete_release_rejected(){let mut c=release();c.targets.get_mut("android-arm64").unwrap().package.push_str(".preview");assert!(c.validate("visgame-cccccccccccc").is_err());let mut c=release();c.targets.remove("windows-x64");assert!(c.validate("visgame-cccccccccccc").is_err());}
 #[test] fn malformed_short_commit_does_not_panic(){let mut c=release();c.engine_commit="x".into();assert!(c.validate("visgame-x").is_err());}
 #[test] fn corrupted_cached_apk_is_rejected(){let target=release().targets["android-arm64"].clone();let path=std::env::temp_dir().join(format!("vis-apk-test-{}",std::process::id()));fs::write(&path,[0;123]).unwrap();assert!(!valid_file(&path,&target).unwrap());fs::remove_file(path).unwrap();}
}
