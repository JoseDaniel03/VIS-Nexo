//! Conservative Minecraft Java servers.dat merge. Preserves unknown NBT tags
//! and existing entries; imports only servers whose address is not present.
//! Deliberately does not parse or modify Minecraft world level.dat.
use std::{collections::BTreeSet,fs::{self,File},io::Write,path::{Path,PathBuf},
    time::{SystemTime,UNIX_EPOCH}};
use serde::Serialize;
const MAX_DATA:usize=6*1024*1024;
const MAX_SERVERS:usize=3000;
struct Reader<'a>{buf:&'a[u8],pos:usize}
impl<'a> Reader<'a>{
 fn new(buf:&'a[u8])->Self{Self{buf,pos:0}}
 fn bytes(&mut self,n:usize)->Result<&'a[u8],String>{
    let end=self.pos.checked_add(n).ok_or("NBT corrupto")?;
    if end>self.buf.len(){return Err("NBT incompleto".into());}
    let out=&self.buf[self.pos..end];self.pos=end;Ok(out)
 }
 fn u8(&mut self)->Result<u8,String>{Ok(self.bytes(1)?[0])}
 fn u16(&mut self)->Result<usize,String>{
    let raw=self.bytes(2)?;Ok(u16::from_be_bytes([raw[0],raw[1]]) as usize)
 }
 fn i32(&mut self)->Result<usize,String>{
    let b=self.bytes(4)?;let n=i32::from_be_bytes([b[0],b[1],b[2],b[3]]);
    if n<0||n as usize>10_000_000{return Err("Longitud NBT inválida".into());}Ok(n as usize)
 }
 fn string(&mut self)->Result<String,String>{
    let len=self.u16()?;
    if len>32768{return Err("Texto NBT excesivamente largo".into());}
    Ok(String::from_utf8_lossy(self.bytes(len)?).to_string())
 }
}
fn skip(c:&mut Reader<'_>,tag:u8,depth:usize)->Result<(),String>{
    if depth>32{return Err("NBT demasiado anidado".into());}
    match tag{
      0=>Ok(()),1=>{c.bytes(1)?;Ok(())},2=>{c.bytes(2)?;Ok(())},
      3|5=>{c.bytes(4)?;Ok(())},4|6=>{c.bytes(8)?;Ok(())},
      7|11|12=>{let n=c.i32()?;let mult=if tag==7{1}else if tag==11{4}else{8};
        c.bytes(n.checked_mul(mult).ok_or("Tamaño NBT inválido")?)?;Ok(())},
      8=>{c.string()?;Ok(())},
      9=>{let kind=c.u8()?;let n=c.i32()?;
        if n>MAX_SERVERS||kind==0&&n>0{return Err("Lista NBT inválida".into());}
        for _ in 0..n{skip(c,kind,depth+1)?;}Ok(())},
      10=>{loop{
        let kind=c.u8()?;if kind==0{break;}
        c.string()?;skip(c,kind,depth+1)?;
      }Ok(())},
      _=>Err("Tipo NBT no reconocido".into())
    }
}
fn entry_key(raw:&[u8])->Result<String,String>{
    let mut c=Reader::new(raw);let mut key=String::new();
    loop{
        let tag=c.u8()?;if tag==0{break;}
        let name=c.string()?;
        if name=="ip" &&tag==8{key=c.string()?.trim().to_ascii_lowercase();}
        else{skip(&mut c,tag,0)?;}
    }
    if c.pos!=raw.len(){return Err("Entrada NBT contiene bytes extra".into());}
    Ok(key)
}
struct Parsed {
  prefix:Vec<u8>,suffix:Vec<u8>,entries:Vec<Vec<u8>>
}
fn decode(bytes:&[u8])->Result<Parsed,String>{
    if bytes.len()>MAX_DATA{return Err("servers.dat excede el tamaño de seguridad".into());}
    let mut c=Reader::new(bytes);
    if c.u8()?!=10{return Err("servers.dat no tiene raíz Compound NBT".into());}
    c.string()?;
    let mut prefix=Vec::new();let mut suffix=Vec::new();
    let mut entries=Vec::new();let mut seen=false;
    loop {
        let tag_start=c.pos;let tag=c.u8()?;
        if tag==0{
            if !seen{prefix=bytes[..tag_start].to_vec();suffix=bytes[tag_start..].to_vec();}
            break;
        }
        let name=c.string()?;
        if tag==9 && name=="servers"{
            if seen{return Err("La lista NBT de servidores está duplicada".into());}
            seen=true;
            let list_tag=c.u8()?;
            if list_tag!=10{return Err("La lista servers no contiene compuestos".into());}
            let n=c.i32()?;
            if n>MAX_SERVERS{return Err("Demasiados servidores".into());}
            for _ in 0..n{
                let start=c.pos;
                skip(&mut c,10,0)?;
                let raw=c.buf[start..c.pos].to_vec();
                entry_key(&raw)?;
                entries.push(raw);
            }
            prefix=bytes[..tag_start].to_vec();
            suffix=bytes[c.pos..].to_vec();
        }else{skip(&mut c,tag,0)?;}
    }
    if c.pos!=bytes.len(){return Err("NBT contiene datos sobrantes".into());}
    Ok(Parsed{prefix,suffix,entries})
}
fn encode(parsed:Parsed)->Result<Vec<u8>,String>{
    if parsed.entries.len()>MAX_SERVERS{return Err("Demasiados servidores".into());}
    let mut result=parsed.prefix;
    result.push(9);result.extend_from_slice(&(7u16).to_be_bytes());
    result.extend_from_slice(b"servers");result.push(10);
    result.extend_from_slice(&(parsed.entries.len() as i32).to_be_bytes());
    for entry in parsed.entries{result.extend_from_slice(&entry);}
    result.extend_from_slice(&parsed.suffix);
    if result.len()>MAX_DATA{return Err("La lista fusionada excede 6 MiB".into());}
    Ok(result)
}
#[derive(Serialize)]
pub struct MergeReport{
 pub current:usize,pub legacy:usize,pub additions:usize,
 pub duplicates:usize,pub backup:String,pub updated:bool
}
pub fn merge_from_old(game:&Path,legacy:&[PathBuf],apply:bool)->Result<MergeReport,String>{
    // Serialize parsing and replacement with Java/Horizon launches, not
    // only the final write, so the source cannot change between the two.
    let _guard=if apply{Some(crate::minecraft::acquire_game_run(game)?)}else{None};
    let target=game.join("servers.dat");
    let existing=if target.is_file(){
        let meta=fs::symlink_metadata(&target).map_err(|e|e.to_string())?;
        if meta.file_type().is_symlink()||meta.len()>MAX_DATA as u64{
            return Err("servers.dat principal es inseguro".into());
        }
        fs::read(&target).map_err(|e|e.to_string())?
    }else{vec![10,0,0,0]}; // unnamed root Compound with TAG_End.
    let mut parsed=decode(&existing)?;
    let current=parsed.entries.len();let mut known=BTreeSet::new();
    for entry in &parsed.entries{
        let key=entry_key(entry)?;
        if !key.is_empty(){known.insert(key);}
    }
    let mut report=MergeReport{current,legacy:0,additions:0,duplicates:0,backup:String::new(),updated:false};
    for folder in legacy{
        let file=folder.join("servers.dat");
        if !file.exists(){continue;}
        let meta=fs::symlink_metadata(&file).map_err(|e|e.to_string())?;
        if !meta.is_file()||meta.file_type().is_symlink()||meta.len()>MAX_DATA as u64{
            return Err("servers.dat antiguo no es un archivo normal".into());
        }
        let older=decode(&fs::read(file).map_err(|e|e.to_string())?)?;
        for entry in older.entries {
            report.legacy+=1;
            let key=entry_key(&entry)?;
            if key.is_empty()||!known.insert(key){
                report.duplicates+=1;continue;
            }
            report.additions+=1;parsed.entries.push(entry);
        }
    }
    if !apply||report.additions==0{return Ok(report);}
    let output=encode(parsed)?;
    crate::instance_guard::private_paths(game,&[".vis/server-list-backups","servers.dat"])?;
    let backups=game.join(".vis/server-list-backups");
    fs::create_dir_all(&backups).map_err(|e|e.to_string())?;
    let stamp=SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    let backup=backups.join(format!("servers-{stamp}-{}.dat",std::process::id()));
    if target.exists(){fs::copy(&target,&backup).map_err(|e|e.to_string())?;report.backup=backup.display().to_string();}
    let stage=backups.join(format!(".servers-stage-{stamp}"));
    let write=(||{
        let mut out=fs::OpenOptions::new().write(true).create_new(true).open(&stage)
            .map_err(|e|e.to_string())?;
        out.write_all(&output).map_err(|e|e.to_string())?;
        out.sync_all().map_err(|e|e.to_string())?;
        drop(out); // Windows may reject renaming a file that is still open.
        // fs::rename replaces the existing regular file without the unsafe
        // remove-then-rename window (Windows and Unix).
        if let Err(err)=fs::rename(&stage,&target){
            if backup.exists(){let _=fs::copy(&backup,&target);}
            return Err(err.to_string());
        }
        Ok(())
    })();
    if write.is_err(){let _=fs::remove_file(&stage);}
    write?;
    report.updated=true;
    Ok(report)
}
#[cfg(test)] mod tests{
 use super::*;
 #[test]fn empty_nbt_merge_stays_well_formed(){
    let data=vec![10,0,0,0];
    let encoded=encode(decode(&data).unwrap()).unwrap();
    let parsed=decode(&encoded).unwrap();
    assert!(parsed.entries.is_empty());
 }
 fn entry(name:&str,address:&str)->Vec<u8>{
    let mut out=Vec::new();
    for (key,value) in [("name",name),("ip",address)]{
      out.push(8);
      out.extend_from_slice(&(key.len() as u16).to_be_bytes());
      out.extend_from_slice(key.as_bytes());
      out.extend_from_slice(&(value.len() as u16).to_be_bytes());
      out.extend_from_slice(value.as_bytes());
    }
    out.push(0);out
 }
 fn file(servers:Vec<Vec<u8>>)->Vec<u8>{
    encode(Parsed{prefix:vec![10,0,0],suffix:vec![0],entries:servers}).unwrap()
 }
 #[test]fn preview_merge_deduplicates_servers_and_preserves_the_original(){
    let root=std::env::temp_dir().join(format!("vis-servers-merge-{}",std::process::id()));
    let _=fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();
    let old=root.join("legacy");
    fs::create_dir_all(&old).unwrap();
    let current=file(vec![entry("First","example.org:25565")]);
    fs::write(root.join("servers.dat"),&current).unwrap();
    fs::write(old.join("servers.dat"),file(vec![
       entry("Duplicate","EXAMPLE.ORG:25565"),entry("Second","second.example:25565")
    ])).unwrap();
    let preview=merge_from_old(&root,&[old.clone()],false).unwrap();
    assert_eq!(preview.additions,1);
    assert_eq!(preview.duplicates,1);
    assert_eq!(fs::read(root.join("servers.dat")).unwrap(),current);
    let merged=merge_from_old(&root,&[old],true).unwrap();
    assert!(merged.updated);
    assert_eq!(decode(&fs::read(root.join("servers.dat")).unwrap()).unwrap().entries.len(),2);
    assert_eq!(fs::read(&merged.backup).unwrap(),current);
    let _=fs::remove_dir_all(root);
 }
 #[test]fn refuses_pathological_nbt_lengths(){
    assert!(decode(&[10,0,0,9,0,7,b's',b'e',b'r',b'v',b'e',b'r',b's',10,127,255,255,255,0]).is_err());
 }
}