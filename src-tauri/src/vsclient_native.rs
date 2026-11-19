//! VSClient's source .hnmod is an activation marker for the reviewed,
//! PRECOMPILED VIS edition of Horizon. No native Rust from the archive is
//! dynamically linked, compiled or executed while launching Minecraft.
//! Other mods still need Horizon's normal, consent-based native build flow.
use serde_json::Value;
use sha2::{Digest,Sha256};
use std::{fs::{self,File,OpenOptions},io::{Read,Write},path::{Path,PathBuf},time::{SystemTime,UNIX_EPOCH}};
use zip::ZipArchive;

pub const VERSION:&str="0.4.1";
const MAX_ARCHIVE:u64=64*1024*1024;
const MAX_ITEMS:usize=512;
const NATIVE_FILE:&str="horizon-native-mods/vsclient.hnmod";
const MODS_LIST:&str="horizon-mods.txt";

fn regular_file(path:&Path)->Result<(),String>{
    let meta=fs::symlink_metadata(path).map_err(|e|format!("{}: {e}",path.display()))?;
    if !meta.file_type().is_file() || meta.file_type().is_symlink(){
        return Err(format!("VSClient: se esperaba un archivo normal, no un enlace: {}",path.display()));
    }
    Ok(())
}

fn sha(path:&Path)->Result<[u8;32],String>{
    regular_file(path)?;
    let mut file=File::open(path).map_err(|e|e.to_string())?;
    let mut hash=Sha256::new();
    let mut buf=[0;65536];
    loop{
        let n=file.read(&mut buf).map_err(|e|e.to_string())?;
        if n==0{break}
        hash.update(&buf[..n]);
    }
    Ok(hash.finalize().into())
}

fn check_hnmod(path:&Path)->Result<(),String>{
    regular_file(path)?;
    if fs::metadata(path).map_err(|e|e.to_string())?.len()>MAX_ARCHIVE {
        return Err("VSClient: el .hnmod excede el límite de 64 MiB".into());
    }
    let file=File::open(path).map_err(|e|e.to_string())?;
    let mut archive=ZipArchive::new(file)
        .map_err(|e|format!("VSClient: el archivo no es un .hnmod ZIP válido: {e}"))?;
    if archive.len()>MAX_ITEMS{return Err("VSClient: demasiados archivos".into())}
    let mut total=0_u64;
    for i in 0..archive.len(){
        let entry=archive.by_index(i).map_err(|e|e.to_string())?;
        total=total.saturating_add(entry.size());
        if total>MAX_ARCHIVE{return Err("VSClient: contenido descomprimido demasiado grande".into())}
        let name=entry.name();
        if name.starts_with('/') || name.contains('\\') ||
            name.split('/').any(|p|p==".." || p==".") {
            return Err("VSClient: ruta interna insegura en el paquete".into())
        }
    }
    // These sources are never executed by VIS: only the packaged game build
    // contains its own VSClient code and exposes its native hook dispatch.
    if archive.by_name("mixins/vsclient/api/src/lib.rs").is_err(){
        return Err("VSClient: falta el módulo Rust".into())
    }
    if archive.by_name("mixins/vsclient/horizon-mixin.toml").is_err(){
        return Err("VSClient: falta el manifiesto del mod".into())
    }
    let manifest:Value={
        let mut file=archive.by_name("horizon-native.json")
            .map_err(|_|"VSClient: falta horizon-native.json")?;
        let mut data=Vec::new();
        file.by_ref().take(16*1024).read_to_end(&mut data).map_err(|e|e.to_string())?;
        serde_json::from_slice(&data).map_err(|e|format!("VSClient: manifiesto JSON inválido: {e}"))?
    };
    let pin=manifest["horizon"].as_str().unwrap_or_default();
    if manifest["schema"].as_u64()!=Some(1) ||
        manifest["id"].as_str()!=Some("vsclient") ||
        manifest["version"].as_str()!=Some(VERSION) ||
        manifest["game"].as_str()!=Some("26.3") ||
        manifest["hooks"].as_u64().is_some() ||
        pin.len()!=40 || !pin.bytes().all(|c|c.is_ascii_digit()||(b'a'..=b'f').contains(&c)) {
        return Err(format!(
            "VSClient no coincide con el motor VIS integrado (requiere versión {VERSION}, juego 26.3 y revision fijada)"
        ));
    }
    Ok(())
}

fn source(instance:&Path,game_dir:&Path)->Result<Option<PathBuf>,String>{
    // Support copying just one .hnmod into the root of a portable instance.
    // The GitHub Actions outer ZIP is intentionally not accepted.
    for folder in [game_dir,instance] {
        for rel in [NATIVE_FILE,"VSClient-MCRust-0.4.1.hnmod","vsclient.hnmod"] {
            let path=folder.join(rel);
            if path.exists() {
                regular_file(&path)?;
                return Ok(Some(path));
            }
        }
    }
    Ok(None)
}

fn atomic_copy(source:&Path,target:&Path)->Result<(),String>{
    let parent=target.parent().ok_or("Instancia sin carpeta de mods nativos")?;
    if parent.is_symlink(){return Err("VSClient: la carpeta de mods es un enlace simbólico".into())}
    fs::create_dir_all(parent).map_err(|e|e.to_string())?;
    let stamp=SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    let tmp=parent.join(format!(".vsclient-{}-{stamp}.hnmod",std::process::id()));
    let copy=||->Result<(),String>{
        let mut file=OpenOptions::new().create_new(true).write(true).open(&tmp).map_err(|e|e.to_string())?;
        let mut from=File::open(source).map_err(|e|e.to_string())?;
        std::io::copy(&mut from,&mut file).map_err(|e|e.to_string())?;
        file.sync_all().map_err(|e|e.to_string())?;
        fs::rename(&tmp,target).map_err(|e|e.to_string())
    };
    let result=copy();
    if result.is_err(){let _=fs::remove_file(&tmp);}
    result
}

fn enable(game_dir:&Path)->Result<(),String>{
    let path=game_dir.join(MODS_LIST);
    if path.is_symlink(){return Err("VSClient: horizon-mods.txt es un enlace".into())}
    let original=fs::read_to_string(&path).unwrap_or_default();
    let already=original.lines().any(|line|
        line.split_once(':').is_some_and(|(k,v)|k.trim()=="mod.vsclient"&&v.trim()=="true"));
    if already {return Ok(())}
    let mut lines:Vec<&str>=original.lines()
        .filter(|l|l.split_once(':').is_none_or(|(k,_)|k.trim()!="mod.vsclient"))
        .collect();
    lines.push("mod.vsclient:true");
    let stamp=SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    let tmp=game_dir.join(format!(".horizon-mods-{}-{stamp}.txt",std::process::id()));
    let result=(||->Result<(),String>{
        let mut f=OpenOptions::new().create_new(true).write(true).open(&tmp).map_err(|e|e.to_string())?;
        f.write_all(format!("{}\n",lines.join("\n")).as_bytes()).map_err(|e|e.to_string())?;
        f.sync_all().map_err(|e|e.to_string())?;
        fs::rename(&tmp,&path).map_err(|e|e.to_string())
    })();
    if result.is_err(){let _=fs::remove_file(&tmp)}
    result
}

/// Called just before launch. The archive only selects code that is ALREADY
/// in a signed/verified game binary; it cannot supply executable new code.
/// No .hnmod means the normal game starts unchanged.
pub fn prepare(instance:&Path,game_dir:&Path,build:&Path)->Result<bool,String>{
    let Some(file)=source(instance,game_dir)? else{return Ok(false)};
    check_hnmod(&file)?;
    let engine:Value=serde_json::from_slice(&fs::read(build.join("vis-horizon-source.json"))
        .map_err(|_|"No se pudo comprobar la procedencia del motor Rust")?)
        .map_err(|_|"Manifiesto del motor Rust inválido")?;
    if engine["vsclient_embedded"].as_str()!=Some(VERSION) {
        return Err(format!(
            "VSClient {VERSION} detectado, pero este motor McRust no lo trae compilado. \
             Actualizá el motor VIS con VSClient integrado; no se puede ejecutar Rust arbitrario desde un .hnmod."
        ));
    }
    if !game_dir.is_dir() || game_dir.is_symlink() {
        return Err("Carpeta de la instancia Horizon no válida".into())
    }
    let target=game_dir.join(NATIVE_FILE);
    if file!=target {
        if target.exists() {
            regular_file(&target)?;
            // Don't replace an unrelated or user-managed native mod silently.
            if sha(&file)? != sha(&target)? {
                return Err("VSClient: ya hay otro vsclient.hnmod en la instancia; resolvé el conflicto antes de jugar".into())
            }
        } else {
            atomic_copy(&file,&target)?;
        }
    }
    enable(game_dir)?;
    Ok(true)
}

#[cfg(test)]
mod tests{
    use super::*;
    use zip::write::FileOptions;
    #[test]
    fn a_single_file_activates_only_matching_embedded_code(){
        let root=std::env::temp_dir().join(format!("vis-vsclient-{}",std::process::id()));
        let _=fs::remove_dir_all(&root);
        let game=root.join("game");
        let engine=root.join("engine");
        fs::create_dir_all(&game).unwrap();
        fs::create_dir_all(&engine).unwrap();
        fs::write(engine.join("vis-horizon-source.json"),r#"{"vsclient_embedded":"0.4.1"}"#).unwrap();
        let path=root.join("VSClient-MCRust-0.4.1.hnmod");
        let mut zip=zip::ZipWriter::new(File::create(&path).unwrap());
        let options=FileOptions::default();
        zip.start_file("horizon-native.json",options).unwrap();
        zip.write_all(format!(
            r#"{{"schema":1,"id":"vsclient","version":"0.4.1","game":"26.3","horizon":"{}"}}"#,
            "a".repeat(40)).as_bytes()).unwrap();
        zip.start_file("mixins/vsclient/horizon-mixin.toml",options).unwrap();
        zip.write_all(b"[mod]\nid='vsclient'\n").unwrap();
        zip.start_file("mixins/vsclient/api/src/lib.rs",options).unwrap();
        zip.write_all(b"pub fn hooks() {}\n").unwrap();
        zip.finish().unwrap();
        assert!(prepare(&root,&game,&engine).unwrap());
        assert!(game.join(NATIVE_FILE).is_file());
        assert!(fs::read_to_string(game.join(MODS_LIST)).unwrap().contains("mod.vsclient:true"));
        assert!(prepare(&root,&game,&engine).unwrap());
        assert_eq!(fs::read_to_string(game.join(MODS_LIST)).unwrap()
            .lines().filter(|l|*l=="mod.vsclient:true").count(),1);
        fs::write(engine.join("vis-horizon-source.json"),r#"{}"#).unwrap();
        assert!(prepare(&root,&game,&engine).is_err());
        let _=fs::remove_dir_all(root);
    }
}
