//! Federated discovery and non-executing compatibility inspection. No translator is bundled.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::BTreeSet, fs, io::Read, path::Path, time::Duration};
const HORIZON_INDEX: &str = "https://horizon-rust.github.io/horizon-mods/index.json";
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Target {
    pub engine: String,
    pub loader: String,
    pub minecraft: String,
    pub platform: String,
}
impl Target {
    pub fn validate(&self) -> Result<(), String> {
        if !["java", "horizon"].contains(&self.engine.as_str())
            || !["windows-x64", "linux-x86_64", "android-arm64"].contains(&self.platform.as_str())
            || self.minecraft.is_empty()
            || self.minecraft.len() > 40
            || !self
                .minecraft
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b".-_".contains(&b))
        {
            return Err("Destino de mods inválido".into());
        }
        if self.engine == "horizon" && self.minecraft != "26.3" {
            return Err("McRust implementa Minecraft 26.3".into());
        }
        if self.engine == "java" && !["vanilla", "fabric"].contains(&self.loader.as_str()) {
            return Err("Loader no disponible en Nexo".into());
        }
        Ok(())
    }
}
fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent("VIS-Nexo/2.22 mods catalog (github.com/JoseDaniel03/VIS-Nexo)")
        .timeout(Duration::from_secs(25))
        .connect_timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())
}
fn bounded_json(response: reqwest::blocking::Response, max: u64) -> Result<Value, String> {
    let response = response.error_for_status().map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    response
        .take(max + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > max {
        return Err("Catálogo fuera de límites".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "Catálogo inválido".into())
}
pub fn search(provider: &str, query: &str, target: &Target) -> Result<Value, String> {
    target.validate()?;
    if query.len() > 120 {
        return Err("Búsqueda demasiado larga".into());
    }
    let c = client()?;
    match provider{
  "modrinth"=>{
   let facets=json!([["project_type:mod"],[format!("versions:{}",target.minecraft)],["categories:fabric"]]).to_string();
   let data=bounded_json(c.get("https://api.modrinth.com/v2/search").query(&[("query",query),("facets",facets.as_str()),("limit","30")]).send().map_err(|_|"No se pudo consultar Modrinth")?,2*1024*1024)?;
   let items:Vec<Value>=data["hits"].as_array().ok_or("Resultados Modrinth inválidos")?.iter().take(30).map(|p|json!({"provider":"modrinth","id":p["project_id"],"title":p["title"],"summary":p["description"],"project_url":format!("https://modrinth.com/mod/{}",p["slug"].as_str().unwrap_or("")),"compatibility":if target.engine=="horizon"{"requires_port"}else{"requires_file_check"},"installable":false})).collect();
   Ok(json!({"schema":1,"provider":"modrinth","target":target,"items":items,"checked":"metadata_only"}))
  },
  "horizon"=>{
   let index=bounded_json(c.get(HORIZON_INDEX).send().map_err(|_|"Registro Horizon no disponible")?,8*1024*1024)?;
   if index["schema"]!=1{return Err("Actualizá Nexo: formato del registro Horizon desconocido".into());}
   let query=query.to_lowercase();let items:Vec<Value>=index["projects"].as_array().ok_or("Registro Horizon sin proyectos")?.iter().filter(|p|p["kind"]=="mod"||p["kind"]=="native-mod").filter(|p|format!("{} {}",p["name"].as_str().unwrap_or(""),p["summary"].as_str().unwrap_or("")).to_lowercase().contains(&query)).take(30).map(|p|{
    let native=p["kind"]=="native-mod";
    json!({"provider":"horizon","id":p["id"],"title":p["name"],"summary":p["summary"],"license":p["license"],"project_url":p["source"],"versions":p["versions"],"compatibility":if target.engine!="horizon"{"wrong_engine"}else if native&&target.platform=="android-arm64"{"android_build_required"}else if native{"native_build_required"}else{"requires_file_check"},"installable":false})
   }).collect();Ok(json!({"schema":1,"provider":"horizon","target":target,"items":items,"checked":"metadata_only"}))
  },
  "curseforge"=>Err("Consultá CurseForge mediante VIS Social /v1/mods/search; la clave se guarda sólo en el servidor".into()),
  _=>Err("Proveedor de mods desconocido".into())
 }
}
#[derive(Debug, Serialize)]
pub struct Assessment {
    pub schema: u8,
    pub sha256: String,
    pub format: String,
    pub verdict: String,
    pub target: Target,
    pub classes: usize,
    pub data_files: usize,
    pub mixins: bool,
    pub native_libraries: usize,
    pub fabric: Option<Value>,
    pub dependencies: Vec<String>,
    pub reasons: Vec<String>,
    pub installable: bool,
}
pub fn inspect(path: &Path, target: Target) -> Result<Assessment, String> {
    target.validate()?;
    let meta = fs::symlink_metadata(path).map_err(|_| "No se pudo leer el mod")?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > 150 * 1024 * 1024 {
        return Err("El mod debe ser un archivo de hasta 150 MiB".into());
    }
    let mut hash = Sha256::new();
    let mut input = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut block = [0; 65536];
    loop {
        let n = input.read(&mut block).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hash.update(&block[..n]);
    }
    let sha256 = format!("{:x}", hash.finalize());
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|_| "El archivo no es un JAR/ZIP válido")?;
    if zip.len() > 20000 {
        return Err("Demasiados archivos en el mod".into());
    }
    let mut report = Assessment {
        schema: 1,
        sha256,
        format: "unknown".into(),
        verdict: "blocked".into(),
        target,
        classes: 0,
        data_files: 0,
        mixins: false,
        native_libraries: 0,
        fabric: None,
        dependencies: Vec::new(),
        reasons: Vec::new(),
        installable: false,
    };
    let mut names = BTreeSet::new();
    let mut expanded = 0u64;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|_| "ZIP ilegible")?;
        let name = entry.name().map_err(|_|"Nombre ZIP no válido")?.into_owned();
        if name.contains('\\')
            || entry.enclosed_name().is_none()
            || !names.insert(name.clone())
            || entry.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000)
        {
            return Err("Archivo con rutas inseguras o duplicadas".into());
        }
        expanded = expanded
            .checked_add(entry.size())
            .ok_or("ZIP demasiado grande")?;
        if expanded > 512 * 1024 * 1024 || entry.size() > 128 * 1024 * 1024 {
            return Err("Mod descomprimido fuera de límites".into());
        }
        if name.ends_with(".class") {
            report.classes += 1;
        }
        if name.starts_with("assets/") || name.starts_with("data/") {
            report.data_files += 1;
        }
        if name.ends_with(".so") || name.ends_with(".dll") || name.ends_with(".dylib") {
            report.native_libraries += 1;
        }
        if name.ends_with("mixins.json") || name.contains(".mixins.") {
            report.mixins = true;
        }
        if name == "horizon-mod.toml" {
            report.format = "hmod".into();
        }
        if name == "horizon-native.json" {
            report.format = "hnmod".into();
        }
        if name == "fabric.mod.json" {
            if entry.size() > 256 * 1024 {
                return Err("Metadatos Fabric demasiado grandes".into());
            }
            let mut raw = Vec::new();
            entry
                .take(256 * 1024 + 1)
                .read_to_end(&mut raw)
                .map_err(|_| "Metadatos ilegibles")?;
            if raw.len() > 256 * 1024 {
                return Err("Metadatos fuera de límites".into());
            }
            let fabric: Value =
                serde_json::from_slice(&raw).map_err(|_| "fabric.mod.json inválido")?;
            if !fabric["id"]
                .as_str()
                .is_some_and(|s| !s.is_empty() && s.len() <= 64)
            {
                return Err("Mod Fabric sin identificador".into());
            }
            report.mixins |= fabric.get("mixins").is_some();
            if let Some(deps) = fabric["depends"].as_object() {
                report.dependencies = deps.keys().cloned().collect();
            }
            report.fabric = Some(
                json!({"id":fabric["id"],"name":fabric["name"],"version":fabric["version"],"license":fabric["license"],"depends":fabric["depends"]}),
            );
            if report.format == "unknown" {
                report.format = "fabric".into();
            }
        }
    }
    if report.target.engine == "java" {
        report.verdict = if report.format == "fabric" && report.target.loader == "fabric" {
            "java_dependency_check_required"
        } else {
            "wrong_loader"
        }
        .into();
        report.reasons.push(
            "La versión de Minecraft y todas las dependencias deben resolverse antes de instalar"
                .into(),
        );
    } else if report.format == "hnmod" {
        report.verdict = "native_build_required".into();
        report.reasons.push(
            "Requiere revisar código, revisión/API del motor y compilar para la plataforma destino"
                .into(),
        );
    } else if report.format == "hmod" && report.classes == 0 && report.native_libraries == 0 {
        report.verdict = "horizon_validation_required".into();
        report.reasons.push(
            "Validar manifiesto, firmas y dependencias con el cargador nativo antes de activar"
                .into(),
        );
    } else if report.data_files > 0 && report.native_libraries == 0 {
        report.verdict = "content_port_candidate".into();
        report.reasons.push("horizon-port-pack puede evaluar datos y recursos; no convierte automáticamente toda la lógica Java".into());
    } else {
        report.verdict = "manual_port_required".into();
        report
            .reasons
            .push("El código Fabric no se ejecuta directamente en Horizon".into());
    }
    if report.mixins {
        report
            .reasons
            .push("Los mixins requieren port y comprobación contra el motor exacto".into());
    }
    if report.native_libraries > 0 {
        report
            .reasons
            .push("Bibliotecas nativas: falta verificar arquitectura y sistema operativo".into());
    }
    if report.target.platform == "android-arm64" && report.target.engine == "java" {
        report.verdict = "blocked".into();
        report
            .reasons
            .push("El runtime Java Android no está implementado en Nexo".into());
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
 use super::*;
 use std::io::Write;
 fn target()->Target{Target{engine:"horizon".into(),loader:"horizon".into(),minecraft:"26.3".into(),platform:"android-arm64".into()}}
 fn fixture(label:&str,files:&[(&str,&str)])->std::path::PathBuf{
  let path=std::env::temp_dir().join(format!("vis-mod-{label}-{}.jar",std::process::id()));
  let mut zip=zip::ZipWriter::new(fs::File::create(&path).unwrap());
  for(name,text)in files{zip.start_file(*name,zip::write::SimpleFileOptions::default()).unwrap();zip.write_all(text.as_bytes()).unwrap();}zip.finish().unwrap();path
 }
 #[test]fn fabric_code_is_never_native_compatible(){let p=fixture("code",&[("fabric.mod.json",r#"{"id":"test","version":"1","depends":{"fabric-api":"*"},"mixins":["test.json"]}"#),("Main.class","bytecode")]);let r=inspect(&p,target()).unwrap();fs::remove_file(p).unwrap();assert_eq!(r.verdict,"manual_port_required");assert!(!r.installable);assert!(r.mixins);assert_eq!(r.dependencies,vec!["fabric-api"]);}
 #[test]fn data_is_a_candidate_not_a_finished_port(){let p=fixture("data",&[("fabric.mod.json",r#"{"id":"test","license":"MIT"}"#),("data/test/recipe.json","{}")]);let r=inspect(&p,target()).unwrap();fs::remove_file(p).unwrap();assert_eq!(r.verdict,"content_port_candidate");assert!(!r.installable);}
 #[test]fn archive_traversal_is_rejected(){let p=fixture("path",&[("../outside","secret")]);let r=inspect(&p,target());fs::remove_file(p).unwrap();assert!(r.is_err());}
 #[test]fn native_bundle_requires_platform_build(){let p=fixture("native",&[("horizon-native.json","{}")]);let r=inspect(&p,target()).unwrap();fs::remove_file(p).unwrap();assert_eq!(r.verdict,"native_build_required");assert!(!r.installable);}
 #[test]fn android_java_is_blocked(){let p=fixture("java",&[("fabric.mod.json",r#"{"id":"test"}"#)]);let mut t=target();t.engine="java".into();t.loader="fabric".into();let r=inspect(&p,t).unwrap();fs::remove_file(p).unwrap();assert_eq!(r.verdict,"blocked");}
}
