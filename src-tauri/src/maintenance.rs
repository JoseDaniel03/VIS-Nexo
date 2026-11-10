//! VIS Maintenance: only disposable application-owned files may be purged.
//! Worlds, Minecraft assets, installed mods, profiles and account databases are NEVER scanned.
use serde::Serialize;
use std::{fs, path::{Path, PathBuf}, time::{Duration, SystemTime}};

const MAX_SCAN_FILES: usize = 20_000;
#[derive(Clone, Serialize)]
pub struct MaintenanceArea {
    pub label: &'static str,
    pub folder: &'static str,
    pub retained_days: u64,
    pub candidate_files: u64,
    pub candidate_bytes: u64,
    pub deleted_files: u64,
    pub freed_bytes: u64,
}
#[derive(Serialize)]
pub struct MaintenanceReport {
    pub mode: &'static str,
    pub areas: Vec<MaintenanceArea>,
    pub total_files: u64,
    pub total_bytes: u64,
    pub deleted_files: u64,
    pub freed_bytes: u64,
    pub protected: Vec<&'static str>,
}

// Explicit allow-list; no broad "clear cache" of Minecraft assets or Java dependencies.
const AREAS: [(&str, &str, u64); 4] = [
    ("Temporales VIS", "runtime-temp", 3),
    ("Descargas incompletas", "downloads-tmp", 7),
    ("Diagnósticos antiguos", "diagnostics", 90),
    ("Logs del launcher", "logs", 30),
];
fn permitted_file(folder: &str, path: &Path) -> bool {
    let ext = path.extension().and_then(|v| v.to_str()).unwrap_or("").to_ascii_lowercase();
    match folder {
        "runtime-temp" => ["tmp", "temp", "part"].contains(&ext.as_str()),
        "downloads-tmp" => ["part", "tmp", "download"].contains(&ext.as_str()),
        "diagnostics" => ["log", "txt", "json"].contains(&ext.as_str()),
        "logs" => ["log", "txt"].contains(&ext.as_str()),
        _ => false,
    }
}
fn collect_candidates(root: &Path, folder: &str, age_days: u64, now: SystemTime) -> Result<Vec<(PathBuf, u64)>, String> {
    let directory = root.join(folder);
    let metadata = match fs::symlink_metadata(&directory) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(error) => return Err(format!("No se pudo consultar {folder}: {error}")),
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(format!("La carpeta {folder} no es un directorio seguro."));
    }
    let mut candidates = Vec::new();
    let mut checked = 0usize;
    let mut stack = vec![(directory, 0usize)];
    while let Some((dir, depth)) = stack.pop() {
        for entry in fs::read_dir(&dir).map_err(|e| format!("{folder}: {e}"))? {
            let entry = entry.map_err(|e| e.to_string())?;
            checked += 1;
            if checked > MAX_SCAN_FILES {return Err(format!("Límite de {MAX_SCAN_FILES} archivos alcanzado en {folder}; no se ejecutó una limpieza parcial."));}
            let path = entry.path();
            let meta = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
            // Never follow directory or file symlinks; bound recursion depth.
            if meta.file_type().is_symlink() {continue;}
            if meta.is_dir() { if depth < 5 {stack.push((path, depth + 1));} continue; }
            if !meta.is_file() || !permitted_file(folder, &path) {continue;}
            let modified = match meta.modified() {Ok(v) => v, Err(_) => continue};
            let elapsed = match now.duration_since(modified) {Ok(v) => v, Err(_) => continue};
            if elapsed >= Duration::from_secs(age_days * 24 * 60 * 60) {
                candidates.push((path, meta.len()));
            }
        }
    }
    Ok(candidates)
}
pub fn report(root: &Path, delete: bool) -> Result<MaintenanceReport, String> {
    let now = SystemTime::now();
    // Collect every candidate before deleting anything. No scanning outside explicit roots.
    let entries = AREAS.iter().map(|(label, folder, days)| {
        let candidates = collect_candidates(root, folder, *days, now)?;
        Ok((*label, *folder, *days, candidates))
    }).collect::<Result<Vec<_>, String>>()?;
    let mut result = MaintenanceReport {
        mode: if delete {"cleaned"} else {"preview"},
        areas: Vec::new(), total_files: 0, total_bytes: 0, deleted_files: 0, freed_bytes: 0,
        protected: vec!["Cuentas y mensajes", "Mundos y partidas", "Mods y resource packs", "Instancias y bibliotecas Minecraft", "Proyectos y banners"],
    };
    for (label, folder, days, candidates) in entries {
        let mut area = MaintenanceArea {label, folder, retained_days: days,
            candidate_files: candidates.len() as u64,
            candidate_bytes: candidates.iter().map(|(_, size)| size).sum(),
            deleted_files: 0, freed_bytes: 0};
        result.total_files += area.candidate_files;
        result.total_bytes += area.candidate_bytes;
        if delete {
            for (path, size) in candidates {
                // Reject symlink swaps that occurred after the dry-run scan.
                match fs::symlink_metadata(&path) {
                    Ok(meta) if meta.is_file() && !meta.file_type().is_symlink() => {
                        fs::remove_file(&path).map_err(|e| format!("No se pudo borrar {}: {e}", path.display()))?;
                        area.deleted_files += 1;
                        area.freed_bytes += size;
                    }
                    Ok(_) => {},
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
                    Err(error) => return Err(format!("{}: {error}", path.display())),
                }
            }
            result.deleted_files += area.deleted_files;
            result.freed_bytes += area.freed_bytes;
        }
        result.areas.push(area);
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preview_does_not_delete_and_cleanup_respects_protection() {
        let root = std::env::temp_dir().join(format!("vis-maintenance-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("runtime-temp")).unwrap();
        fs::create_dir_all(root.join("minecraft-instances/world/saves")).unwrap();
        fs::write(root.join("minecraft-instances/world/saves/game.dat"), b"world").unwrap();
        fs::write(root.join("runtime-temp/keep.tmp"), b"recent").unwrap();
        fs::write(root.join("runtime-temp/keep.json"), b"permanent").unwrap();
        let preview = report(&root, false).unwrap();
        assert_eq!(preview.total_files, 0); // Recent temporary files are protected.
        let result = report(&root, true).unwrap();
        assert_eq!(result.deleted_files, 0);
        assert!(root.join("minecraft-instances/world/saves/game.dat").exists());
        assert!(root.join("runtime-temp/keep.json").exists());
        let _ = fs::remove_dir_all(root);
    }
    #[test]
    fn stale_temporary_file_is_purged_but_worlds_are_not() {
        use std::fs::FileTimes;
        let root = std::env::temp_dir().join(format!("vis-maintenance-age-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("runtime-temp")).unwrap();
        fs::create_dir_all(root.join("minecraft-instances/saves")).unwrap();
        let stale = root.join("runtime-temp/stale.tmp");
        fs::write(&stale, b"garbage").unwrap();
        fs::write(root.join("minecraft-instances/saves/world.dat"), b"save").unwrap();
        let past = SystemTime::now() - Duration::from_secs(5 * 24 * 60 * 60);
        fs::File::options().write(true).open(&stale).unwrap()
            .set_times(FileTimes::new().set_modified(past)).unwrap();
        let preview = report(&root, false).unwrap();
        assert_eq!(preview.total_files, 1);
        assert!(stale.exists());
        let clean = report(&root, true).unwrap();
        assert_eq!(clean.deleted_files, 1);
        assert_eq!(clean.freed_bytes, 7);
        assert!(!stale.exists());
        assert!(root.join("minecraft-instances/saves/world.dat").exists());
        let _ = fs::remove_dir_all(root);
    }
    #[cfg(unix)]
    #[test]
    fn refuses_symlink_directory() {
        use std::os::unix::fs::symlink;
        let root = std::env::temp_dir().join(format!("vis-maintenance-link-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        symlink("/tmp", root.join("logs")).unwrap();
        assert!(report(&root, true).is_err());
        let _ = fs::remove_dir_all(root);
    }
}
