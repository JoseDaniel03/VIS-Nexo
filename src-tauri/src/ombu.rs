//! VIS Ombú — portable VIS Worlds bundles. No user accounts, tokens or shared
//! launcher configuration are included in an instance export.
use crate::accounts::Instance;
use serde::{Deserialize, Serialize};
use std::{fs::{self, File}, io::{Read, Write}, path::{Component, Path, PathBuf}, time::{SystemTime, UNIX_EPOCH}};
use zip::{write::FileOptions, ZipArchive, ZipWriter};

const MANIFEST: &str = "VIS-INSTANCE.json";
const MAX_FILES: usize = 100_000;
const MAX_BYTES: u64 = 24 * 1024 * 1024 * 1024;
const MAX_SINGLE: u64 = 3 * 1024 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
struct BundleManifest { format: String, schema: u32, instance: Instance }

fn safe_name(name: &str) -> Result<String, String> {
    if name.is_empty() || name.chars().count() > 60 { return Err("Nombre de instancia inválido".into()); }
    let slug: String = name.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' {c} else {'-'}).collect();
    let slug = slug.trim_matches('-');
    if slug.is_empty() { return Err("Elegí un nombre de instancia válido".into()); }
    Ok(slug.to_owned())
}
fn check_manifest(m: &BundleManifest) -> Result<(),String> {
    if m.format != "vis-worlds" || m.schema != 1 { return Err("Formato de instancia VIS no compatible".into()); }
    safe_name(&m.instance.name)?;
    if m.instance.version.is_empty() || m.instance.version.len() > 128 ||
        !m.instance.version.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-+".contains(&b)) {return Err("Versión de Minecraft inválida en el paquete".into());}
    if !["vanilla","fabric"].contains(&m.instance.loader.as_str()) {return Err("Motor no compatible en esta versión".into());}
    Ok(())
}
fn should_skip(relative: &Path) -> bool {
    relative.components().next().is_some_and(|c| matches!(c,Component::Normal(v) if v == "logs" || v == "crash-reports")) ||
    relative.file_name().is_some_and(|v| v == "VIS-INSTANCE.json" || v.to_string_lossy().ends_with(".partial"))
}
fn collect(root: &Path, current: &Path, files: &mut Vec<PathBuf>, bytes: &mut u64) -> Result<(),String> {
    for item in fs::read_dir(current).map_err(|e|e.to_string())? {
        let path=item.map_err(|e|e.to_string())?.path();
        let relative=path.strip_prefix(root).map_err(|e|e.to_string())?;
        if should_skip(relative) {continue;}
        let metadata=fs::symlink_metadata(&path).map_err(|e|e.to_string())?;
        if metadata.file_type().is_symlink() {return Err(format!("La instancia contiene un enlace simbólico: {}",relative.display()));}
        if metadata.is_dir() {collect(root,&path,files,bytes)?;}
        else if metadata.is_file() {
            if metadata.len() > MAX_SINGLE {return Err("Archivo demasiado grande para exportar".into());}
            *bytes=bytes.checked_add(metadata.len()).ok_or("Tamaño de instancia inválido")?;
            if *bytes>MAX_BYTES || files.len() >= MAX_FILES {return Err("La instancia excede los límites de exportación".into());}
            files.push(path);
        }
    }
    Ok(())
}
pub fn export_instance(dir: &Path, instance: &Instance, destination: &Path) -> Result<String,String> {
    if !dir.is_dir() {return Err("La carpeta de la instancia todavía no existe".into());}
    if destination.extension().and_then(|e|e.to_str()) != Some("zip") {return Err("Exportá con extensión .zip".into());}
    if destination.exists() {return Err("El archivo destino ya existe. Elegí otro nombre".into());}
    let mut sanitized=instance.clone();
    sanitized.game_dir.clear();sanitized.java_path.clear();sanitized.source_owner.clear();sanitized.reuse_source.clear();sanitized.project_id="__personal__".into();sanitized.installed=false;
    let manifest=BundleManifest{format:"vis-worlds".into(),schema:1,instance:sanitized};
    check_manifest(&manifest)?;
    let mut files=Vec::new();let mut total=0;
    collect(dir,dir,&mut files,&mut total)?;
    let parent=destination.parent().ok_or("Destino inválido")?;
    fs::create_dir_all(parent).map_err(|e|e.to_string())?;
    let stamp=SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    let temp=parent.join(format!(".vis-export-{}-{stamp}.part",std::process::id()));
    let outcome=(||->Result<(),String>{
        let f=File::create(&temp).map_err(|e|e.to_string())?;
        let mut zip=ZipWriter::new(f);
        let opts=FileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        zip.start_file(MANIFEST,opts).map_err(|e|e.to_string())?;
        zip.write_all(&serde_json::to_vec_pretty(&manifest).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
        for file in &files {
            let relative=file.strip_prefix(dir).map_err(|e|e.to_string())?;
            let path=relative.to_string_lossy().replace('\\',"/");
            zip.start_file(path,opts).map_err(|e|e.to_string())?;
            std::io::copy(&mut File::open(file).map_err(|e|e.to_string())?,&mut zip).map_err(|e|e.to_string())?;
        }
        zip.finish().map_err(|e|e.to_string())?;
        fs::rename(&temp,destination).map_err(|e|format!("No se pudo guardar el paquete: {e}"))?;
        Ok(())
    })();
    if outcome.is_err(){let _=fs::remove_file(&temp);}
    outcome?;
    Ok(format!("{} archivos · {} MB · {}",files.len(),total/1_048_576,destination.display()))
}

pub fn import_instance(archive: &Path, library: &Path, taken_names: &[String]) -> Result<Instance,String> {
    if !library.is_absolute() {return Err("Elegí una carpeta de biblioteca absoluta".into());}
    let mut zip=ZipArchive::new(File::open(archive).map_err(|e|e.to_string())?).map_err(|e|format!("Paquete ZIP inválido: {e}"))?;
    if zip.len() > MAX_FILES {return Err("Demasiados archivos en el paquete".into());}
    let manifest: BundleManifest={
        let mut entry=zip.by_name(MANIFEST).map_err(|_|"No es un paquete VIS Worlds (falta VIS-INSTANCE.json)")?;
        if entry.size()>65_536 {return Err("Manifiesto demasiado grande".into());}
        let mut bytes=Vec::new();entry.read_to_end(&mut bytes).map_err(|e|e.to_string())?;
        serde_json::from_slice(&bytes).map_err(|e|format!("Manifiesto inválido: {e}"))?
    };
    check_manifest(&manifest)?;
    let mut name=manifest.instance.name.clone();
    let mut slug=safe_name(&name)?;
    let mut destination=library.join(&slug);
    let mut suffix=2;
    while destination.exists() || taken_names.iter().any(|n|n.eq_ignore_ascii_case(&name)) {
        name=format!("{}-{suffix}",manifest.instance.name);
        slug=safe_name(&name)?;
        destination=library.join(&slug);
        suffix+=1;
        if suffix>999 {return Err("Demasiadas instancias con ese nombre".into());}
    }
    fs::create_dir_all(library).map_err(|e|e.to_string())?;
    let stamp=SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    let staging=library.join(format!(".vis-import-{}-{stamp}",std::process::id()));
    fs::create_dir(&staging).map_err(|e|e.to_string())?;
    let outcome=(||->Result<(),String>{
        let mut total=0u64;
        for index in 0..zip.len(){
            let mut entry=zip.by_index(index).map_err(|e|e.to_string())?;
            if entry.name()==MANIFEST {continue;}
            if entry.unix_mode().is_some_and(|mode| (mode & 0o170000) == 0o120000){return Err("El ZIP contiene un enlace simbólico".into());}
            let relative=entry.enclosed_name().ok_or("Ruta peligrosa dentro del ZIP")?.to_owned();
            if relative.components().any(|part| !matches!(part,Component::Normal(_))) {return Err("Ruta no válida dentro del paquete".into());}
            if entry.size()>MAX_SINGLE {return Err("Archivo demasiado grande en el paquete".into());}
            total=total.checked_add(entry.size()).ok_or("Tamaño de ZIP inválido")?;
            if total>MAX_BYTES {return Err("Paquete excesivamente grande".into());}
            let out_path=staging.join(relative);
            if entry.is_dir() {fs::create_dir_all(&out_path).map_err(|e|e.to_string())?;continue;}
            if let Some(parent)=out_path.parent(){fs::create_dir_all(parent).map_err(|e|e.to_string())?;}
            let mut out=File::create(&out_path).map_err(|e|e.to_string())?;
            let copied=std::io::copy(&mut entry,&mut out).map_err(|e|e.to_string())?;
            if copied!=entry.size(){return Err("Archivo incompleto durante la importación".into());}
        }
        // Never merge files into an existing instance: promotion is all-or-nothing.
        fs::rename(&staging,&destination).map_err(|e|format!("No se pudo mover la instancia importada: {e}"))?;
        Ok(())
    })();
    if outcome.is_err(){let _=fs::remove_dir_all(&staging);}
    outcome?;
    let mut instance=manifest.instance;
    instance.name=name;instance.project_id="__personal__".into();instance.game_dir=destination.to_string_lossy().into_owned();
    instance.java_path.clear();instance.source_owner.clear();instance.reuse_source.clear();
    if instance.engine=="horizon" {
        // A copied ZIP cannot reuse the exporting computer's absolute paths.
        // Unverified/incomplete imports remain recoverable through Repair.
        instance.installed=crate::horizon::relocate_imported(&destination,&mut instance).is_ok()
            && crate::horizon::installed(&destination,&instance);
    } else {
        instance.installed=crate::minecraft::installed(&destination,&instance);
    }
    Ok(instance)
}

#[cfg(test)]
mod tests {
 use super::*;
 #[test]
 fn portable_bundle_preserves_world_but_not_local_paths() {
  let temp=std::env::temp_dir().join(format!("vis212-ombu-{}-{}",std::process::id(),
      SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos()));
  let source=temp.join("source");fs::create_dir_all(source.join("saves/world-1")).unwrap();
  fs::write(source.join("saves/world-1/level.dat"),b"world content").unwrap();
  let mut instance=Instance::default();
  instance.name="Mi Mundo".into();instance.version="1.21.1".into();
  instance.game_dir=source.to_string_lossy().into_owned();
  instance.java_path="/private/java".into();
  instance.reuse_source="/private/minecraft".into();
  instance.source_owner="owner".into();
  let archive=temp.join("export.zip");
  export_instance(&source,&instance,&archive).unwrap();
  let imported=import_instance(&archive,&temp.join("library"),&[]).unwrap();
  assert!(Path::new(&imported.game_dir).join("saves/world-1/level.dat").is_file());
  assert!(imported.java_path.is_empty() && imported.source_owner.is_empty() && imported.reuse_source.is_empty());
  assert!(!imported.installed);
  let _=fs::remove_dir_all(temp);
 }
}
