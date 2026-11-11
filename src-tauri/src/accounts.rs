//! Local account and social prototype. This is NOT an Internet identity service.
//! Passwords use Argon2id; the first LOCAL registration bootstraps the administrator.
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString}, Argon2,
};
use rand_core::OsRng;
use serde::{Deserialize, Serialize};
use std::{collections::{BTreeMap, BTreeSet}, fs, path::{Path, PathBuf}};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role { User, Admin }

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

pub const LOCAL_CHAT_RETENTION_MS: u64 = 30 * 24 * 60 * 60 * 1000;
pub const LOCAL_CHAT_MAX_BYTES: usize = 2048;
const LOCAL_MESSAGE_MAX_BYTES: usize = 1536;
fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default().as_millis().min(u64::MAX as u128) as u64
}
fn message_time_ms(raw: &str) -> Option<u64> {
    if let Ok(ms) = raw.parse::<u64>() { return Some(ms); }
    // Backwards compatibility for the original LocalMessage created format.
    let sec = raw.split("tv_sec: ").nth(1)?.split(',').next()?.trim().parse::<u64>().ok()?;
    let nanos = raw.split("tv_nsec: ").nth(1)?.split('}').next()?.trim().parse::<u64>().ok()?;
    Some(sec.saturating_mul(1000).saturating_add(nanos / 1_000_000))
}
pub fn recent_local_message(message: &LocalMessage, now: u64) -> bool {
    message_time_ms(&message.created).is_some_and(|time|
        time > now.saturating_sub(LOCAL_CHAT_RETENTION_MS) &&
        time <= now.saturating_add(60_000))
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
    #[serde(default)] pub icon_path: String,
    #[serde(default)] pub source_owner: String,
    #[serde(default)] pub reuse_source: String,
    #[serde(default)] pub share_offline: bool,
    #[serde(default="default_engine")] pub engine: String,
    #[serde(default)] pub horizon_build_dir: String,
    #[serde(default)] pub horizon_minecraft_dir: String,
    #[serde(default)] pub horizon_server_jar: String,
}
/// Separate guest profiles from registered accounts. The '-' delimiter cannot
/// appear in local account names, so an offline guest cannot impersonate one.
pub fn offline_pref_owner(nickname:&str)->Result<String,String>{
    let nick=nickname.trim();
    if !(3..=16).contains(&nick.len()) ||
       !nick.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'_'){
        return Err("El nick offline debe tener 3–16 caracteres (letras, números y _).".into());
    }
    Ok(format!("offline--{}",nick.to_ascii_lowercase()))
}
fn valid_offline_owner(owner:&str)->bool{
    owner.strip_prefix("offline--")
      .and_then(|nick|offline_pref_owner(nick).ok())
      .is_some_and(|expected|expected==owner)
}
fn default_loader()->String{"vanilla".into()}
fn default_engine()->String{"java".into()}
impl Default for Instance {
    fn default() -> Self {
        Self { name: String::new(), project_id: String::new(), version: String::new(),
            game_dir: String::new(), ram_mb: 4096, fullscreen: false, installed: false, loader: default_loader(), loader_version: String::new(), java_path: String::new(), player_name: String::new(), icon_path: String::new(), source_owner: String::new(), reuse_source: String::new(), share_offline: false, engine: default_engine(), horizon_build_dir: String::new(), horizon_minecraft_dir: String::new(), horizon_server_jar: String::new() }
    }
}

#[derive(Default, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct PlayerPrefs {
    pub instances: Vec<Instance>,
    pub selected: BTreeMap<String, usize>,
    pub locale: String,
    /// Per-account pauses. These don't delete projects, installations, mods or worlds.
    #[serde(default)] pub disabled_projects: BTreeSet<String>,
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
        let mut store = Self { root, data, load_error };
        if store.load_error.is_none() && store.prune_local_chat_messages() {
            // Expiration and size cleanup also happens when VIS starts, even
            // if nobody opens the old local chat.
            if let Err(error) = store.save() {
                store.load_error = Some(format!("No se pudo limpiar el historial local: {error}"));
            }
        }
        store
    }
    /// Prune offline-prototype chat without touching friendships/accounts.
    /// 2048 bytes is the complete serialized JSON array for each conversation.
    pub fn prune_local_chat_messages(&mut self) -> bool {
        let before = self.data.messages.clone();
        let now = now_ms();
        self.data.messages.retain(|m| recent_local_message(m, now) && !m.body.trim().is_empty());
        self.data.messages.sort_by_key(|m| message_time_ms(&m.created).unwrap_or_default());
        let mut usage = BTreeMap::<(String, String), usize>::new();
        self.data.messages = self.data.messages.drain(..).rev().filter(|m| {
            let pair = if m.from <= m.to {
                (m.from.clone(), m.to.clone())
            } else {
                (m.to.clone(), m.from.clone())
            };
            let size = serde_json::to_vec(m).map(|json| json.len()).unwrap_or(usize::MAX);
            let used = usage.entry(pair).or_insert(2); // JSON array brackets.
            if used.saturating_add(size).saturating_add(usize::from(*used > 2)) > LOCAL_CHAT_MAX_BYTES {
                return false;
            }
            *used += size + usize::from(*used > 2);
            true
        }).collect();
        self.data.messages.reverse();
        self.data.messages != before
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
        let account = self.get(&normalized).ok_or("Usuario o contraseña incorrectos.")?;
        let hash = PasswordHash::new(&account.password_hash)
            .map_err(|_| "No se pudo verificar la cuenta.")?;
        Argon2::default().verify_password(password.as_bytes(), &hash)
            .map_err(|_| "Usuario o contraseña incorrectos.")?;
        Ok(normalized)
    }
    pub fn prefs(&self, name: &str) -> PlayerPrefs {
        let path = self.root.join("users").join(format!("{name}.json"));
        fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }
    pub fn save_prefs(&self, name: &str, prefs: &PlayerPrefs) -> Result<(), String> {
        if self.get(name).is_none() && !valid_offline_owner(name) {
            return Err("Perfil local inexistente".into());
        }
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
        if body.is_empty() || body.chars().count() > 1500 || body.len() > LOCAL_MESSAGE_MAX_BYTES ||
            serde_json::to_vec(body).map(|json|json.len()>1750).unwrap_or(true) {
            return Err("El mensaje excede el límite del chat ligero de 2 KB.".into());
        }
        if !self.friends(from).iter().any(|friend| friend == to) {return Err("Ese usuario todavía no es tu amigo.".into());}
        let message = LocalMessage { from: from.into(), to: to.into(), body: body.into(),
            created: now_ms().to_string() };
        if serde_json::to_vec(&[&message]).map(|json|json.len()>LOCAL_CHAT_MAX_BYTES).unwrap_or(true) {
            return Err("El mensaje no cabe en el log de 2 KB.".into());
        }
        self.data.messages.push(message);
        self.prune_local_chat_messages();
        self.save()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn offline_nick_has_isolated_persistent_preferences_without_registration() {
        let root=std::env::temp_dir().join(format!("vis-guest-preferences-{}-{}",
            std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let mut store=LocalStore::load(root.clone());
        store.register("player","password-123","password-123").unwrap();
        let guest=offline_pref_owner("Guest_03").unwrap();
        assert_eq!(guest,"offline--guest_03");
        assert_eq!(guest,offline_pref_owner("guest_03").unwrap());
        assert!(offline_pref_owner("../unsafe").is_err());
        assert!(offline_pref_owner("ab").is_err());
        assert!(store.get(&guest).is_none());
        let mut prefs=store.prefs(&guest);
        prefs.instances.push(Instance{name:"Sin cuenta".into(),project_id:"__personal__".into(),
            version:"1.21.4".into(),..Instance::default()});
        store.save_prefs(&guest,&prefs).unwrap();
        assert!(store.save_prefs("offline--../../bad",&prefs).is_err());
        assert_eq!(store.prefs(&guest).instances.len(),1);
        assert!(store.prefs("player").instances.is_empty());
        let _=fs::remove_dir_all(root);
    }
    #[test]
    fn project_pauses_are_profile_local_and_persisted() {
        let root = std::env::temp_dir().join(format!("vis-paused-projects-{}-{}",
            std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let mut store=LocalStore::load(root.clone());
        store.register("owner","password-123","password-123").unwrap();
        store.register("player","password-123","password-123").unwrap();
        let mut prefs=store.prefs("player");
        prefs.disabled_projects.insert("survival".into());
        store.save_prefs("player",&prefs).unwrap();
        assert!(store.prefs("player").disabled_projects.contains("survival"));
        assert!(!store.prefs("owner").disabled_projects.contains("survival"));
        let _=fs::remove_dir_all(root);
    }
    #[test]
    fn local_chat_caps_each_pair_at_2kb_and_prunes_old_messages() {
        let root = std::env::temp_dir().join(format!("vis-chat-ttl-{}-{}",
            std::process::id(), now_ms()));
        let mut store = LocalStore::load(root.clone());
        store.register("alice", "password-123", "password-123").unwrap();
        store.register("bobby", "password-123", "password-123").unwrap();
        store.request_friend("alice", "bobby").unwrap();
        store.accept_friend("bobby", "alice").unwrap();
        for _ in 0..70 {
            store.send_message("alice", "bobby", "Hola mundo de VIS Nexo!").unwrap();
        }
        let conversation: Vec<_> = store.data.messages.iter()
            .filter(|m|m.from=="alice" && m.to=="bobby").collect();
        assert!(!conversation.is_empty() && conversation.len() < 70);
        assert!(serde_json::to_vec(&conversation).unwrap().len() <= LOCAL_CHAT_MAX_BYTES);
        assert!(store.send_message("alice", "bobby", &"🔥".repeat(500)).is_err());
        store.data.messages.push(LocalMessage {from:"alice".into(),to:"bobby".into(),
            body:"Expirado".into(),created:(now_ms()-LOCAL_CHAT_RETENTION_MS-1000).to_string()});
        store.save().unwrap();
        let reloaded=LocalStore::load(root.clone());
        assert!(reloaded.data.messages.iter().all(|m|m.body!="Expirado"));
        assert!(reloaded.data.messages.iter().all(|m|recent_local_message(m,now_ms())));
        let _=fs::remove_dir_all(root);
    }

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
        store.request_friend("admin","player").unwrap();
        assert!(store.send_message("admin","player","Antes de aceptar").is_err());
        store.accept_friend("player","admin").unwrap();
        store.send_message("admin","player","Hola").unwrap();
        assert_eq!(LocalStore::load(root.clone()).data.messages.len(),1);
        let _=fs::remove_dir_all(root);
    }
}
