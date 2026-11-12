//! Cross-process Minecraft directory locks. No external crates or generated assets.
//! The OS releases the advisory lock even when VIS/Minecraft crashes.
use std::{fs::{self,File,OpenOptions},path::Path};
#[cfg(unix)]
mod platform {
    use std::{fs::File,os::fd::AsRawFd};
    unsafe extern "C" { fn flock(fd:i32, operation:i32)->i32; }
    const LOCK_EX:i32=2;
    const LOCK_NB:i32=4;
    pub fn lock(file:&File)->Result<(),String>{
        // SAFETY: flock receives a valid descriptor borrowed from an open File.
        let ok=unsafe{flock(file.as_raw_fd(),LOCK_EX|LOCK_NB)}==0;
        if ok{Ok(())}else{Err("La instancia ya está en uso por otra ventana o proceso de VIS Nexo".into())}
    }
}
#[cfg(windows)]
mod platform {
    use std::{ffi::c_void,fs::File,os::windows::io::AsRawHandle};
    #[repr(C)]
    struct Overlapped {
        internal:usize,internal_high:usize,offset:u32,offset_high:u32,event:*mut c_void
    }
    #[link(name="kernel32")]
    unsafe extern "system" {
        fn LockFileEx(handle:*mut c_void,flags:u32,reserved:u32,
            bytes_low:u32,bytes_high:u32,overlapped:*mut Overlapped)->i32;
    }
    const EXCLUSIVE:u32=0x00000002;
    const NOWAIT:u32=0x00000001;
    pub fn lock(file:&File)->Result<(),String>{
        let mut overlap=Overlapped{
            internal:0,internal_high:0,offset:0,offset_high:0,
            event:std::ptr::null_mut()
        };
        // SAFETY: a synchronous lock on a 1-byte range of an open File.
        let ok=unsafe{LockFileEx(file.as_raw_handle(),EXCLUSIVE|NOWAIT,0,1,0,&mut overlap)}!=0;
        if ok{Ok(())}else{Err("La instancia ya está abierta en otra ejecución de VIS Nexo".into())}
    }
}
#[cfg(not(any(windows,unix)))]
mod platform {
    use std::fs::File;
    pub fn lock(_file:&File)->Result<(),String>{
        Err("Esta plataforma no ofrece bloqueo seguro entre procesos".into())
    }
}
pub struct InstanceLock{_file:File}
pub fn try_lock(dir:&Path)->Result<InstanceLock,String>{
    if !dir.is_dir(){return Err("La carpeta de juego todavía no existe".into());}
    crate::instance_guard::private_paths(dir,&[".vis",".vis/instance-running.lock"])?;
    let vis=dir.join(".vis");
    fs::create_dir_all(&vis).map_err(|e|e.to_string())?;
    let lock_path=vis.join("instance-running.lock");
    if let Ok(meta)=fs::symlink_metadata(&lock_path){
        if meta.file_type().is_symlink()||!meta.is_file(){
            return Err("El archivo de bloqueo es inseguro".into());
        }
    }
    let file=OpenOptions::new().create(true).read(true).write(true)
        .open(&lock_path).map_err(|e|format!("No se pudo abrir bloqueo de partida: {e}"))?;
    platform::lock(&file)?;
    Ok(InstanceLock{_file:file})
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn second_lock_fails_and_drop_releases_it(){
        let dir=std::env::temp_dir().join(format!("vis-instance-lock-{}",std::process::id()));
        let _=fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let a=try_lock(&dir).unwrap();
        assert!(try_lock(&dir).is_err());
        drop(a);
        let b=try_lock(&dir).unwrap();
        drop(b);
        fs::remove_dir_all(dir).unwrap();
    }
}