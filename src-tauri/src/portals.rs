//! Restricted VIS Portals channel to games started by this launcher process.
//! Descriptors and authentication tokens never enter the WebView or Cloudflare.
use serde::Serialize;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::{Ipv4Addr, SocketAddr, TcpStream},
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::Duration,
};

#[derive(Clone, Serialize)]
pub(crate) struct Game {
    pub pid: u32,
    pub name: String,
    pub project_id: String,
    #[serde(skip)]
    owner: String,
    #[serde(skip)]
    endpoint: PathBuf,
}
static GAMES: OnceLock<Mutex<HashMap<u32, Game>>> = OnceLock::new();
fn games() -> &'static Mutex<HashMap<u32, Game>> {
    GAMES.get_or_init(Mutex::default)
}
pub(crate) fn register(
    owner: String,
    pid: u32,
    name: String,
    project_id: String,
    endpoint: PathBuf,
) {
    if let Ok(mut games) = games().lock() {
        games.insert(
            pid,
            Game {
                owner,
                pid,
                name,
                project_id,
                endpoint,
            },
        );
    }
}
pub(crate) fn remove(pid: u32) {
    if let Ok(mut games) = games().lock() {
        games.remove(&pid);
    }
}
pub(crate) fn list(owner: &str) -> Vec<Game> {
    games()
        .lock()
        .map(|g| g.values().filter(|g| g.owner == owner).cloned().collect())
        .unwrap_or_default()
}
fn line(reader: &mut BufReader<TcpStream>) -> Result<Value, String> {
    let mut bytes = Vec::new();
    reader
        .take(16 * 1024)
        .read_until(b'\n', &mut bytes)
        .map_err(|_| "El juego no respondió a VIS Portals")?;
    if bytes.last() != Some(&b'\n') {
        return Err("Respuesta incompleta del juego".into());
    }
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| "Respuesta incorrecta del juego")?;
    if let Some(error) = value.get("error").and_then(Value::as_str) {
        return Err(error.chars().take(180).collect());
    }
    Ok(value)
}
fn request(endpoint: &std::path::Path, command: &str) -> Result<Value, String> {
    let meta = fs::symlink_metadata(endpoint)
        .map_err(|_| "El juego aún está iniciando o necesita actualizarse para VIS Portals")?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > 4096 {
        return Err("Descriptor de juego inválido".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if meta.permissions().mode() & 0o077 != 0 {
            return Err("El descriptor de VIS Portals debe ser privado".into());
        }
    }
    let data: Value = serde_json::from_slice(&fs::read(endpoint).map_err(|e| e.to_string())?)
        .map_err(|_| "Descriptor de juego inválido")?;
    let port = data["port"]
        .as_u64()
        .and_then(|p| u16::try_from(p).ok())
        .filter(|p| *p > 0)
        .ok_or("Puerto de juego inválido")?;
    let token = data["token"]
        .as_str()
        .filter(|s| s.len() == 32 && s.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or("Token de juego inválido")?;
    let mut stream = TcpStream::connect_timeout(
        &SocketAddr::from((Ipv4Addr::LOCALHOST, port)),
        Duration::from_secs(2),
    )
    .map_err(|_| "El juego ya no está disponible")?;
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|e| e.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(2)))
        .map_err(|e| e.to_string())?;
    stream.set_nodelay(true).map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(stream.try_clone().map_err(|e| e.to_string())?);
    writeln!(stream, "auth {token}").map_err(|e| e.to_string())?;
    if line(&mut reader)?["ok"] != true {
        return Err("El juego rechazó la conexión".into());
    }
    writeln!(stream, "hello").map_err(|e| e.to_string())?;
    if line(&mut reader)?["vis_portals"] != 1 {
        return Err("Actualizá el juego para usar VIS Portals".into());
    }
    writeln!(stream, "{command}").map_err(|e| e.to_string())?;
    line(&mut reader)
}
pub(crate) fn command(
    owner: &str,
    pid: u32,
    action: &str,
    code: Option<&str>,
) -> Result<Value, String> {
    let game = games()
        .lock()
        .map_err(|_| "VIS Portals ocupado")?
        .get(&pid)
        .filter(|g| g.owner == owner)
        .cloned()
        .ok_or("La partida no pertenece a tu sesión actual")?;
    let command = match action {
        "host" | "stop" | "status" => action.to_owned(),
        "join" => {
            let code = code
                .filter(|s| {
                    (8..=1000).contains(&s.len())
                        && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
                })
                .ok_or("Código de invitación inválido")?;
            format!("join friend:{code}")
        }
        _ => return Err("Acción de VIS Portals no permitida".into()),
    };
    let value = request(&game.endpoint, &command)?;
    // Only expected game state reaches the UI. Never return endpoint credentials.
    Ok(
        json!({"ok": value["ok"], "sharing": value["sharing"], "code": value["code"], "summary": value["summary"], "can_join": value["can_join"], "sessions": value["sessions"]}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{net::TcpListener, thread};
    #[test]
    fn authenticates_and_only_exposes_allowed_state() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let path =
            std::env::temp_dir().join(format!("vis-portals-test-{}.json", std::process::id()));
        let token = "a".repeat(32);
        fs::write(
            &path,
            json!({"port":listener.local_addr().unwrap().port(),"token":token}).to_string(),
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        }
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            for (expected, response) in [
                (format!("auth {token}"), json!({"ok":true})),
                ("hello".into(), json!({"vis_portals":1})),
                (
                    "status".into(),
                    json!({"sharing":true,"code":"ABCDE-FGHIJ","can_join":false,"token":"never-return-this"}),
                ),
            ] {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                assert_eq!(line.trim(), expected);
                writeln!(stream, "{response}").unwrap();
            }
        });
        register(
            "alice".into(),
            42,
            "Mundo".into(),
            "project".into(),
            path.clone(),
        );
        assert!(command("bob", 42, "status", None).is_err());
        assert!(command("alice", 42, "quit", None).is_err());
        assert!(command("alice", 42, "join", Some("ABCDE-FGHIJ\nquit")).is_err());
        let status = command("alice", 42, "status", None).unwrap();
        assert_eq!(status["sharing"], true);
        assert!(status.get("token").is_none());
        server.join().unwrap();
        remove(42);
        let _ = fs::remove_file(path);
    }
}

pub(crate) fn exchange(owner: &str, pid: u32, snapshot: Value) -> Result<Value, String> {
    if !snapshot.is_object() || snapshot.to_string().len() > 12000 {
        return Err("Panel social demasiado grande".into());
    }
    let game = games()
        .lock()
        .map_err(|_| "VIS Portals ocupado")?
        .get(&pid)
        .filter(|game| game.owner == owner)
        .cloned()
        .ok_or("Partida de otra sesión")?;
    let reply = request(&game.endpoint, &format!("social {snapshot}"))?;
    Ok(json!({"events":reply["events"],"voice":reply["voice"]}))
}
