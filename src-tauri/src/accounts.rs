//! Local account and social prototype. This is NOT an Internet identity service.
//! Passwords use Argon2id; the first LOCAL registration bootstraps the administrator.
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString}, Argon2,
};
use rand_core::OsRng;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, path::{Path, PathBuf}};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role { User, Admin }

#[derive(Default, Clone, Serialize, Deserialize)]
#[serde(default)]
struct LoginThrottle { attempts: BTreeMap<String, LoginFailure> }
#[derive(Default, Clone, Serialize, Deserialize)]
#[serde(default)]
struct LoginFailure { count: u32, last_failed: u64, blocked_until: u64 }

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Account {
    pub username: String,
    pub password_hash: String,
    pub role: Role,
    #[serde(default)] pub avatar: String,
    #[serde(default)] pub skin: String,
    #[serde(default)] pub cape: String,
    #[serde(default)] pub avatar_layer: String,
    #[serde(default)] pub profile_banner: String,
    #[serde(default)] pub microsoft_linked: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Friendship {
    pub from: String,
    pub to: String,
    pub accepted: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LocalMessage {
    pub from: String,
    pub to: String,
    pub body: String,
    pub created: String,
}

#[derive(Default, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AccountsFile {
    pub accounts: Vec<Account>,
    pub friendships: Vec<Friendship>,
    pub messages: Vec<LocalMessage>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Instance {
    pub name: String,
    pub project_id: String,
    pub version: String,
    pub game_dir: String,
    pub ram_mb: u32,
    pub fullscreen: bool,
    pub installed: bool,
    #[serde(default="default_loader")] pub loader: String,
    #[serde(default)] pub loader_version: String,
    #[serde(default)] pub java_path: String,
    #[serde(default)] pub player_name: String,
    #[serde(default)] pub source_owner: String,
    #[serde(default)] pub reuse_source: String,
    #[serde(default)] pub share_offline: bool,
    #[serde(default="default_engine")] pub engine: String,
    #[serde(default)] pub horizon_build_dir: String,
    #[serde(default)] pub horizon_minecraft_dir: String,
    #[serde(default)] pub horizon_server_jar: String,
}
fn default_loader()->String{"vanilla".into()}
fn default_engine()->String{"java".into()}
impl Default for Instance {
    fn default() -> Self {
        Self { name: String::new(), project_id: String::new(), version: String::new(),
            game_dir: String::new(), ram_mb: 4096, fullscreen: false, installed: false, loader: default_loader(), loader_version: String::new(), java_path: String::new(), player_name: String::new(), source_owner: String::new(), reuse_source: String::new(), share_offline: false, engine: default_engine(), horizon_build_dir: String::new(), horizon_minecraft_dir: String::new(), horizon_server_jar: String::new() }
    }
}

#[derive(Default, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct PlayerPrefs {
    pub instances: Vec<Instance>,
    pub selected: BTreeMap<String, usize>,
    pub locale: String,
    /// RAM overrides for other VIS profiles' installations on this OS user.
    #[serde(default)] pub shared_ram: BTreeMap<String,u32>,
}

pub struct LocalStore {
    pub root: PathBuf,
    pub data: AccountsFile,
    pub load_error: Option<String>,
}

pub fn data_directory() -> PathBuf {
    if let Some(dir) = std::env::var_os("XDG_DATA_HOME") {
        return PathBuf::from(dir).join("vslauncher");
    }
    if let Some(home) = std::env::var_os("HOME") {
        return PathBuf::from(home).join(".local/share/vslauncher");
    }
    PathBuf::from("workspace/local-data")
}

pub fn atomic_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, bytes).map_err(|e| e.to_string())?;
    #[cfg(unix)] {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600))
            .map_err(|e| e.to_string())?;
    }
    fs::rename(&temporary, path).map_err(|e| e.to_string())
}

impl LocalStore {
    pub fn load(root: PathBuf) -> Self {
        let path = root.join("accounts.json");
        let (data, load_error) = if !path.exists() {
            (AccountsFile::default(), None)
        } else {
            match fs::read(&path).map_err(|e|e.to_string())
                .and_then(|b|serde_json::from_slice(&b).map_err(|e|e.to_string())) {
                Ok(data)=>(data,None),
                Err(error)=>(AccountsFile::default(),Some(format!("No se pudo leer la base de cuentas: {error}"))),
            }
        };
        Self { root, data, load_error }
    }
    pub fn save(&self) -> Result<(), String> {
        if let Some(error)=&self.load_error {return Err(error.clone());}
        atomic_json(&self.root.join("accounts.json"), &self.data)
    }
    pub fn get(&self, username: &str) -> Option<&Account> {
        self.data.accounts.iter().find(|a| a.username == username)
    }
    pub fn get_mut(&mut self, username: &str) -> Option<&mut Account> {
        self.data.accounts.iter_mut().find(|a| a.username == username)
    }
    pub fn register(&mut self, name: &str, password: &str, repeat: &str) -> Result<String, String> {
        if let Some(error)=&self.load_error {return Err(error.clone());}
        let normalized = name.trim().to_ascii_lowercase();
        if !(3..=24).contains(&normalized.len()) ||
            !normalized.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_') {
            return Err("El usuario debe tener entre 3 y 24 caracteres (letras, números o _).".into());
        }
        if self.get(&normalized).is_some() { return Err("Ese nombre de usuario ya existe.".into()); }
        let four_digit_pin=password.len()==4 && password.bytes().all(|b|b.is_ascii_digit());
        if !four_digit_pin && !(8..=128).contains(&password.len()) {
            return Err("Usá un PIN local de 4 números o una contraseña de 8 a 128 caracteres.".into());
        }
        if password != repeat { return Err("Las contraseñas no coinciden.".into()); }
        let salt = SaltString::generate(&mut OsRng);
        let hash = Argon2::default().hash_password(password.as_bytes(), &salt)
            .map_err(|e| format!("Error al proteger contraseña: {e}"))?.to_string();
        let account = Account { username: normalized.clone(), password_hash: hash,
            role: if self.data.accounts.is_empty() { Role::Admin } else { Role::User },
            avatar: String::new(), skin: String::new(), cape: String::new(), avatar_layer: String::new(), profile_banner: String::new(), microsoft_linked: false };
        self.data.accounts.push(account);
        if let Err(error) = self.save() {
            self.data.accounts.pop();
            return Err(error);
        }
        Ok(normalized)
    }
    pub fn login(&self, name: &str, password: &str) -> Result<String, String> {
        if let Some(error)=&self.load_error {return Err(error.clone());}
        let normalized = name.trim().to_ascii_lowercase();
        if !(3..=24).contains(&normalized.len())
            || !normalized.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_') {
            return Err("Usuario o contraseña incorrectos.".into());
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).map_err(|e|e.to_string())?.as_secs();
        let throttle_path = self.root.join("login-throttle.json");
        let mut throttle: LoginThrottle = if throttle_path.is_file() {
            serde_json::from_slice(&fs::read(&throttle_path).map_err(|e|e.to_string())?)
                .map_err(|_| "No se pudo verificar la protección de acceso local.")?
        } else { LoginThrottle::default() };
        throttle.attempts.retain(|_, entry|
            now.saturating_sub(entry.last_failed) < 24*60*60);
        if throttle.attempts.get(&normalized).is_some_and(|entry|
            entry.blocked_until > now) {
            return Err("Demasiados intentos. Probá nuevamente más tarde.".into());
        }
        let verified = self.get(&normalized).and_then(|account|
            PasswordHash::new(&account.password_hash).ok().map(|hash|
                Argon2::default().verify_password(password.as_bytes(), &hash).is_ok()
            )).unwrap_or(false);
        if !verified {
            // Bound disk usage even if someone supplies many invented usernames.
            if throttle.attempts.len() >= 512 && !throttle.attempts.contains_key(&normalized) {
                if let Some(oldest) = throttle.attempts.iter()
                    .min_by_key(|(_,v)| v.last_failed).map(|(k,_)|k.clone()) {
                    throttle.attempts.remove(&oldest);
                }
            }
            let failed=throttle.attempts.entry(normalized).or_default();
            failed.count=failed.count.saturating_add(1);
            failed.last_failed=now;
            if failed.count >= 5 {
                let step=(failed.count-5).min(7);
                failed.blocked_until=now.saturating_add((30u64 << step).min(3600));
            }
            // The file is stored with 0600 on Unix and remains private to the
            // user's OS profile. Prevent unlimited login attempts with a 4-digit PIN.
            atomic_json(&throttle_path,&throttle)?;
            return Err("Usuario o contraseña incorrectos.".into());
        }
        throttle.attempts.remove(&normalized);
        atomic_json(&throttle_path,&throttle)?;
        Ok(normalized)
    }
    pub fn prefs(&self, name: &str) -> PlayerPrefs {
        let path = self.root.join("users").join(format!("{name}.json"));
        fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }
    pub fn save_prefs(&self, name: &str, prefs: &PlayerPrefs) -> Result<(), String> {
        if self.get(name).is_none() {return Err("Cuenta inexistente".into());}
        atomic_json(&self.root.join("users").join(format!("{name}.json")), prefs)
    }
    pub fn request_friend(&mut self, from: &str, to: &str) -> Result<(), String> {
        let to = to.trim().to_ascii_lowercase();
        if from == to || self.get(&to).is_none() {return Err("No se encontró ese usuario.".into());}
        if self.data.friendships.iter().any(|f| (f.from == from && f.to == to) || (f.from == to && f.to == from)) {
            return Err("Ya existe una solicitud o amistad.".into());
        }
        self.data.friendships.push(Friendship { from: from.into(), to, accepted: false });
        self.save()
    }
    pub fn accept_friend(&mut self, to: &str, from: &str) -> Result<(), String> {
        let Some(friend) = self.data.friendships.iter_mut().find(|f| f.from == from && f.to == to && !f.accepted) else {
            return Err("Solicitud no encontrada.".into());
        };
        friend.accepted = true;
        self.save()
    }
    pub fn friends(&self, username: &str) -> Vec<String> {
        self.data.friendships.iter().filter(|f| f.accepted).filter_map(|f| {
            if f.from == username { Some(f.to.clone()) }
            else if f.to == username { Some(f.from.clone()) }
            else { None }
        }).collect()
    }
    pub fn send_message(&mut self, from: &str, to: &str, text: &str) -> Result<(), String> {
        let body = text.trim();
        if body.is_empty() || body.chars().count() > 2000 {return Err("Mensaje vacío o demasiado largo.".into());}
        if !self.friends(from).iter().any(|friend| friend == to) {return Err("Ese usuario todavía no es tu amigo.".into());}
        self.data.messages.push(LocalMessage {from: from.into(), to: to.into(), body: body.into(),
            created: format!("{:?}", std::time::SystemTime::now())});
        self.save()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accounts_roles_password_and_chat() {
        let root = std::env::temp_dir().join(format!("vslauncher-account-{}-{}",std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let mut store=LocalStore::load(root.clone());
        assert_eq!(store.register("admin", "password-123", "password-123").unwrap(),"admin");
        assert_eq!(store.get("admin").unwrap().role,Role::Admin);
        store.register("player", "1234", "1234").unwrap();
        assert_eq!(store.get("player").unwrap().role,Role::User);
        assert!(store.login("admin", "bad-password").is_err());
        assert!(store.login("ADMIN", "password-123").is_ok());
        // Enforce a persistent cooldown after repeated incorrect PINs.
        for _ in 0..5 { assert!(store.login("player","0000").is_err()); }
        assert!(store.login("player","1234").is_err());
        assert!(root.join("login-throttle.json").is_file());
        store.request_friend("admin","player").unwrap();
        assert!(store.send_message("admin","player","Antes de aceptar").is_err());
        store.accept_friend("player","admin").unwrap();
        store.send_message("admin","player","Hola").unwrap();
        assert_eq!(LocalStore::load(root.clone()).data.messages.len(),1);
        let _=fs::remove_dir_all(root);
    }
}
