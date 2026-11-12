//! VSUI project schema. Independent of egui, GPU and any web technology.
use serde::{Deserialize, Serialize};
use std::{collections::{BTreeMap, HashSet}, fs, path::Path};

pub const CANVAS_W: f32 = 1280.0;
pub const CANVAS_H: f32 = 720.0;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub enum Action {
    None,
    Navigate(String),
    OpenProject(usize),
    NextVersion,
    PreviousVersion,
    Play,
    Install,
    Back,
}
impl Default for Action { fn default() -> Self { Self::None } }

// Use this constructor for literal screen IDs so callers do not need to
// convert `&str` into `String` manually (prevents E0308 regression).
impl Action {
    pub fn navigate(screen: impl Into<String>) -> Self { Self::Navigate(screen.into()) }
}


/// A native declarative interaction. Old Action remains as a legacy click fallback.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum Trigger { #[default] Click, HoverEnter, HoverLeave }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub enum Condition {
    #[default]
    Always,
    Installed(bool),
    ProjectIs(usize),
    VersionIs(usize),
    FlagEquals { key: String, value: bool },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub enum Response {
    Action(Action),
    SetFlag { key: String, value: bool },
    ToggleFlag(String),
    Message(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct InteractionRule {
    pub name: String,
    pub enabled: bool,
    pub trigger: Trigger,
    pub condition: Condition,
    pub responses: Vec<Response>,
}
impl Default for InteractionRule {
    fn default() -> Self {
        Self { name: "Nueva interacción".into(), enabled: true, trigger: Trigger::Click,
            condition: Condition::Always, responses: vec![Response::Message("Interacción de prueba".into())] }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ElementKind { Panel, Text, Button, Hero, ArtTile, Divider, Dot, Image }

/// Layout is optional and defaults to Free for documents created before v0.3.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum LayoutMode { #[default] Free, Row, Column }

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct LayoutSettings {
    pub mode: LayoutMode,
    pub gap: f32,
    pub padding: f32,
}
impl Default for LayoutSettings {
    fn default() -> Self { Self { mode: LayoutMode::Free, gap: 12.0, padding: 16.0 } }
}

/// Motion Studio v0.7. Animated values use absolute canvas coordinates.
/// Missing motion fields in older .vsui.json files preserve their static appearance.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum MotionEasing { Step, #[default] Linear, EaseIn, EaseOut, EaseInOut }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MotionKeyframe {
    pub time_ms: u32,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub opacity: f32,
    #[serde(default)]
    pub easing: MotionEasing,
}
impl MotionKeyframe {
    pub fn from_element(element: &Element, time_ms: u32) -> Self {
        Self { time_ms, x: element.x, y: element.y, w: element.w, h: element.h,
            opacity: element.opacity, easing: MotionEasing::EaseInOut }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct MotionClip {
    pub name: String,
    pub duration_ms: u32,
    pub looped: bool,
    pub autoplay: bool,
    pub keyframes: Vec<MotionKeyframe>,
}
impl Default for MotionClip {
    fn default() -> Self {
        Self { name: "Entrada".into(), duration_ms: 1200, looped: false,
            autoplay: true, keyframes: Vec::new() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Element {
    pub id: u64,
    pub name: String,
    pub kind: ElementKind,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub text: String,
    pub color: String,
    pub fill: String,
    pub font_size: f32,
    pub opacity: f32,
    #[serde(default)]
    pub asset_path: String,
    pub visible: bool,
    pub locked: bool,
    #[serde(default)]
    pub action: Action,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub interactions: Vec<InteractionRule>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub motion: Option<MotionClip>,
    #[serde(default)]
    pub variant: u8,
    /// Parent references another element in the *same scene*. Coordinates stay in canvas space.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<u64>,
    #[serde(default)]
    pub layout: LayoutSettings,
    /// Present on the outer frame of a reusable component instance.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub component_key: Option<String>,
    /// Master element id; used when synchronizing component instances.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub component_source_id: Option<u64>,
}

impl Element {
    pub fn new(id: u64, kind: ElementKind, name: impl Into<String>, x: f32, y: f32, w: f32, h: f32) -> Self {
        Self { id, name: name.into(), kind, x, y, w, h, text: String::new(),
            color: "#F4F1E9".into(), fill: "#1C2027".into(), font_size: 22.0,
            opacity: 1.0, asset_path: String::new(), visible: true, locked: false, action: Action::None, interactions: Vec::new(), motion: None, variant: 0,
            parent_id: None, layout: LayoutSettings::default(), component_key: None, component_source_id: None }
    }
    pub fn with_text(mut self, text: impl Into<String>, font_size: f32) -> Self {
        self.text = text.into(); self.font_size = font_size; self
    }
    pub fn with_fill(mut self, fill: &str) -> Self { self.fill = fill.into(); self }
    pub fn with_color(mut self, color: &str) -> Self { self.color = color.into(); self }
    pub fn with_action(mut self, action: Action) -> Self { self.action = action; self }
    pub fn with_variant(mut self, variant: u8) -> Self { self.variant = variant; self }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Scene { pub id: String, pub title: String, pub elements: Vec<Element> }
/// Public, administrator-authored content shared by the designer and the client.
/// The launcher treats this document as READ ONLY; end-user RAM settings live elsewhere.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum PostKind { #[default] News, Patch, Update, Community }

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct ProjectPost {
    pub kind: PostKind,
    pub title: String,
    pub body: String,
    /// Free-form display date, e.g. 2026-11-09 (not a scheduler).
    pub date: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct ProjectEvent {
    pub title: String,
    pub date: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct GameProject {
    pub id: String,
    pub title: String,
    pub subtitle: String,
    pub description: String,
    /// Installer/instance labels available in the version selector.
    pub versions: Vec<String>,
    /// Optional project-specific page, e.g. a page created from Template Studio.
    pub page_scene_id: Option<String>,
    pub mc_version: String,
    /// Chosen by VIS Studios at publication time. Legacy projects default to Java Vanilla.
    #[serde(default="default_project_engine")] pub engine: String,
    #[serde(default="default_project_loader")] pub loader: String,
    #[serde(default)] pub loader_version: String,
    /// Curated Modrinth project IDs; only Java + Fabric supports these mods.
    /// Serialized with the project so new installations and updates agree.
    #[serde(default)] pub modrinth_mods: Vec<String>,
    pub banner_path: String,
    pub logo_path: String,
    pub icon_path: String,
    /// Missing keys default to visible for older catalogues.
    pub visible_sections: BTreeMap<String, bool>,
    pub notes: String,
    pub community_url: String,
    /// False means listed and browseable, but cannot be installed or played.
    pub installable: bool,
    pub posts: Vec<ProjectPost>,
    pub calendar: Vec<ProjectEvent>,
}
fn default_project_engine() -> String { "java".into() }
fn default_project_loader() -> String { "vanilla".into() }
impl Default for GameProject {
    fn default() -> Self {
        Self { id: String::new(), title: String::new(), subtitle: String::new(),
            description: String::new(), versions: Vec::new(), page_scene_id: None,
            mc_version: String::new(), engine: default_project_engine(), loader: default_project_loader(), loader_version: String::new(), modrinth_mods: Vec::new(), banner_path: String::new(), logo_path: String::new(),
            icon_path: String::new(), visible_sections: BTreeMap::new(), notes: String::new(), community_url: String::new(),
            installable: true, posts: Vec::new(), calendar: Vec::new() }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SketchGuide { pub path: String, pub opacity: f32, pub visible: bool }

/// Optional manual alignment guides. New fields have serde defaults for v0.1-v0.3 compatibility.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct BlueprintSettings {
    pub horizontal: Vec<f32>,
    pub vertical: Vec<f32>,
    pub show_guides: bool,
    pub show_rulers: bool,
    pub magnetic: bool,
}
impl Default for BlueprintSettings {
    fn default() -> Self { Self { horizontal:Vec::new(), vertical:Vec::new(),
        show_guides:true, show_rulers:true, magnetic:true } }
}

/// A portable, source-independent reusable component master.
/// Coordinates within elements are relative to the component frame.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComponentDefinition {
    pub id: String,
    pub name: String,
    pub width: f32,
    pub height: f32,
    pub elements: Vec<Element>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DesignDocument {
    pub format_version: u32,
    pub name: String,
    pub width: f32,
    pub height: f32,
    pub projects: Vec<GameProject>,
    pub scenes: Vec<Scene>,
    #[serde(default)]
    pub components: Vec<ComponentDefinition>,
    #[serde(default)]
    pub guides: BTreeMap<String, SketchGuide>,
    #[serde(default)]
    pub blueprints: BTreeMap<String, BlueprintSettings>,
}

impl DesignDocument {
    pub fn scene(&self, id: &str) -> Option<&Scene> { self.scenes.iter().find(|s| s.id == id) }
    pub fn scene_mut(&mut self, id: &str) -> Option<&mut Scene> { self.scenes.iter_mut().find(|s| s.id == id) }
    pub fn next_id(&self) -> u64 { self.scenes.iter().flat_map(|s| s.elements.iter().map(|e| e.id)).max().unwrap_or(0) + 1 }
    pub fn save(&self, path: &Path) -> Result<(), String> {
        self.validate()?;
        if let Some(parent) = path.parent() { if !parent.as_os_str().is_empty() { fs::create_dir_all(parent).map_err(|e| e.to_string())?; } }
        let body = serde_json::to_vec_pretty(self).map_err(|e| e.to_string())?;
        let tmp = path.with_extension("tmp");
        fs::write(&tmp, body).map_err(|e| e.to_string())?;
        fs::rename(&tmp, path).map_err(|e| e.to_string())
    }
    pub fn load(path: &Path) -> Result<Self, String> {
        let body = fs::read(path).map_err(|e| e.to_string())?;
        let doc: Self = serde_json::from_slice(&body).map_err(|e| e.to_string())?;
        doc.validate()?;
        Ok(doc)
    }
    pub fn validate(&self) -> Result<(), String> {
        if self.format_version != 1 { return Err("Formato VSUI no compatible (se requiere v1)".into()); }
        if !(320.0..=8192.0).contains(&self.width) || !(200.0..=8192.0).contains(&self.height) { return Err("Resolucion invalida".into()); }
        if self.scenes.is_empty() { return Err("El proyecto no contiene pantallas".into()); }
        let mut ids = HashSet::new();
        let mut names = HashSet::new();
        for scene in &self.scenes {
            if !names.insert(scene.id.as_str()) { return Err(format!("Pantalla duplicada: {}", scene.id)); }
            let scene_ids: HashSet<u64> = scene.elements.iter().map(|e| e.id).collect();
            for elem in &scene.elements {
                if !ids.insert(elem.id) { return Err(format!("ID duplicado: {}", elem.id)); }
                if ![elem.x, elem.y, elem.w, elem.h, elem.opacity].iter().all(|x| x.is_finite()) { return Err(format!("Coordenadas invalidas: {}", elem.name)); }
                if elem.w <= 0.0 || elem.h <= 0.0 || !(0.0..=1.0).contains(&elem.opacity) { return Err(format!("Tamano/opacidad invalida: {}", elem.name)); }
                if ![elem.font_size, elem.layout.gap, elem.layout.padding].iter().all(|v| v.is_finite())
                    || elem.layout.gap < 0.0 || elem.layout.padding < 0.0 { return Err(format!("Layout invalido: {}", elem.name)); }
                if let Some(clip) = &elem.motion {
                    if !(100..=60000).contains(&clip.duration_ms) || clip.name.trim().is_empty() || clip.name.len() > 96 {
                        return Err(format!("Animación inválida: {}", elem.name));
                    }
                    if clip.keyframes.len() < 2 || clip.keyframes.len() > 128 {
                        return Err(format!("La animación necesita entre 2 y 128 keyframes: {}", elem.name));
                    }
                    let mut last = None;
                    for key in &clip.keyframes {
                        if key.time_ms > clip.duration_ms || last.is_some_and(|t| key.time_ms <= t)
                            || ![key.x, key.y, key.w, key.h, key.opacity].iter().all(|v| v.is_finite())
                            || key.w <= 0.0 || key.h <= 0.0 || !(0.0..=1.0).contains(&key.opacity) {
                            return Err(format!("Keyframes inválidos en {}", elem.name));
                        }
                        last = Some(key.time_ms);
                    }
                }
                if elem.interactions.len() > 64 {
                    return Err(format!("Demasiadas interacciones en {}", elem.name));
                }
                for rule in &elem.interactions {
                    if rule.name.trim().is_empty() || rule.name.len() > 120 || rule.responses.is_empty() || rule.responses.len() > 16 {
                        return Err(format!("Regla de interacción inválida en {}", elem.name));
                    }
                    let valid_flag = |key: &str| !key.is_empty() && key.len() <= 48 &&
                        key.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-');
                    match &rule.condition {
                        Condition::ProjectIs(index) if *index >= self.projects.len() =>
                            return Err(format!("Proyecto inexistente en regla: {}", rule.name)),
                        Condition::VersionIs(index) if !self.projects.iter().any(|p| *index < p.versions.len()) =>
                            return Err(format!("Versión inexistente en regla: {}", rule.name)),
                        Condition::FlagEquals { key, .. } if !valid_flag(key) =>
                            return Err(format!("Bandera inválida en regla: {}", rule.name)),
                        _ => (),
                    }
                    for response in &rule.responses {
                        match response {
                            Response::Action(Action::Navigate(dest)) if !self.scenes.iter().any(|s| s.id.as_str() == dest.as_str()) =>
                                return Err(format!("Destino inexistente en regla: {}", rule.name)),
                            Response::Action(Action::OpenProject(index)) if *index >= self.projects.len() =>
                                return Err(format!("Proyecto inexistente en regla: {}", rule.name)),
                            Response::SetFlag { key, .. } | Response::ToggleFlag(key) if !valid_flag(key) =>
                                return Err(format!("Bandera inválida en respuesta: {}", rule.name)),
                            Response::Message(message) if message.len() > 512 =>
                                return Err(format!("Mensaje demasiado largo en regla: {}", rule.name)),
                            _ => (),
                        }
                    }
                }
                if let Some(parent) = elem.parent_id {
                    if !scene_ids.contains(&parent) || parent == elem.id { return Err(format!("Padre invalido: {}", elem.name)); }
                    if scene.elements.iter().find(|p| p.id == parent).is_some_and(|p| p.kind != ElementKind::Panel) {
                        return Err(format!("El padre no es un contenedor: {}", elem.name));
                    }
                    let mut cursor = Some(parent);
                    let mut visited = HashSet::new();
                    while let Some(current) = cursor {
                        if current == elem.id || !visited.insert(current) { return Err(format!("Jerarquia ciclica: {}", elem.name)); }
                        cursor = scene.elements.iter().find(|p| p.id == current).and_then(|p| p.parent_id);
                    }
                }
            }
        }
        let mut component_ids = HashSet::new();
        for component in &self.components {
            if component.id.is_empty() || !component_ids.insert(component.id.as_str()) { return Err("ID de componente duplicado o vacio".into()); }
            if !(component.width.is_finite() && component.height.is_finite() && component.width > 0.0 && component.height > 0.0) {
                return Err(format!("Dimension de componente invalida: {}", component.id));
            }
            let own_ids: HashSet<_> = component.elements.iter().map(|e| e.id).collect();
            if own_ids.len() != component.elements.len() { return Err(format!("IDs de componente duplicados: {}", component.id)); }
            for e in &component.elements {
                if e.w <= 0.0 || e.h <= 0.0 || ![e.x,e.y,e.w,e.h].iter().all(|v|v.is_finite()) {
                    return Err(format!("Elemento invalido en componente: {}",component.id));
                }
                if let Some(parent) = e.parent_id { if !own_ids.contains(&parent) || parent == e.id { return Err(format!("Padre invalido en componente: {}", component.id)); } }
            }
        }
        for scene in &self.scenes { for e in &scene.elements {
            if let Some(key)=&e.component_key { if !component_ids.contains(key.as_str()) { return Err(format!("Componente desconocido: {key}")); } }
        }}
        let mut project_ids = HashSet::new();
        for project in &self.projects {
            if project.id.trim().is_empty() || !project_ids.insert(project.id.as_str())
                || project.id.len() > 64 || !project.id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
                return Err(format!("ID de proyecto vacío, duplicado o inválido: {}", project.id));
            }
            if project.title.trim().is_empty() || project.title.len()>100 || project.versions.len()>64
                || project.notes.len()>8000 || project.description.len()>8000 || project.posts.len()>100
                || project.calendar.len()>100 {
                return Err(format!("Contenido demasiado grande o proyecto inválido: {}", project.id));
            }
            for post in &project.posts {
                if post.title.trim().is_empty() || post.title.len()>150 || post.body.len()>5000 || post.date.len()>40 {
                    return Err(format!("Publicación inválida: {}",project.id));
                }
            }
            for event in &project.calendar {
                if event.title.trim().is_empty() || event.title.len()>150 || event.description.len()>2000 || event.date.len()>40 {
                    return Err(format!("Evento inválido: {}",project.id));
                }
            }
            if let Some(id) = &project.page_scene_id {
                if !names.contains(id.as_str()) {
                    return Err(format!("Pagina de proyecto desconocida: {}", id));
                }
            }
        }
        for scene in &self.scenes { for elem in &scene.elements {
            if let Action::Navigate(dest) = &elem.action { if !names.contains(dest.as_str()) { return Err(format!("Accion apunta a pantalla desconocida: {}", dest)); } }
        }}
        for (scene_id, settings) in &self.blueprints {
            if !names.contains(scene_id.as_str()) {return Err(format!("Blueprint para pantalla inexistente: {scene_id}"));}
            if settings.vertical.iter().any(|v|!v.is_finite() || !(0.0..=self.width).contains(v)) ||
                settings.horizontal.iter().any(|v|!v.is_finite() || !(0.0..=self.height).contains(v)) {
                return Err(format!("Guia de alineacion fuera del lienzo: {scene_id}"));
            }
        }
        for (scene_id, guide) in &self.guides {
            if !names.contains(scene_id.as_str()) {return Err(format!("Boceto para pantalla inexistente: {scene_id}"));}
            if !guide.opacity.is_finite() || !(0.0..=1.0).contains(&guide.opacity) {
                return Err(format!("Opacidad de boceto invalida: {scene_id}"));
            }
        }
        Ok(())
    }
}

/// Local prototype data. Artwork is drawn procedurally by the renderer, not copied from Riot.
pub fn demo_document() -> DesignDocument {
    use ElementKind::*;
    fn make(id:&mut u64,kind:ElementKind,name:impl Into<String>,x:f32,y:f32,w:f32,h:f32)->Element {
        *id+=1;Element::new(*id,kind,name,x,y,w,h)
    }
    let mut id = 0u64;
    let mut home = vec![];
    home.push(make(&mut id,Panel,"Fondo",0.,0.,1280.,720.).with_fill("#0D0F12"));
    home.push(make(&mut id,Panel,"TopBar",0.,0.,1280.,74.).with_fill("#0B0C0E"));
    home.push(make(&mut id,Text,"Logo",28.,21.,146.,36.).with_text("VIRGOLAND",23.).with_color("#E6C28A"));
    home.push(make(&mut id,Button,"Home",203.,21.,92.,31.).with_text("INICIO",14.).with_fill("#0B0C0E").with_action(Action::navigate("home")));
    home.push(make(&mut id,Button,"Proyectos",313.,21.,123.,31.).with_text("PROYECTOS",14.).with_fill("#0B0C0E").with_action(Action::navigate("library")));
    home.push(make(&mut id,Text,"Comunidad",462.,25.,170.,28.).with_text("COMUNIDAD",14.).with_color("#9A9DA5"));
    home.push(make(&mut id,Text,"Usuario",1060.,22.,177.,30.).with_text("VSC  •  Invitado",15.));
    home.push(make(&mut id,Hero,"Banner principal",24.,87.,963.,355.).with_fill("#13252A").with_variant(0));
    home.push(make(&mut id,Text,"Etiqueta de portada",57.,119.,560.,30.).with_text("EL MUNDO TE ESPERA",17.).with_color("#EDC995"));
    home.push(make(&mut id,Text,"Titulo principal",55.,161.,800.,95.).with_text("VIRGOLAND",68.).with_color("#FFF5E4"));
    home.push(make(&mut id,Text,"Descripcion",59.,266.,625.,32.).with_text("Explora, construye y crea tu propia historia.",22.).with_color("#D5D6D3"));
    home.push(make(&mut id,Button,"Jugar destacado",59.,335.,202.,55.).with_text("EXPLORAR",19.).with_fill("#D6AD76").with_color("#171511").with_action(Action::OpenProject(0)));
    home.push(make(&mut id,Text,"Novedades",26.,471.,250.,35.).with_text("Novedades",21.));
    home.push(make(&mut id,Text,"Ver novedades",854.,479.,129.,24.).with_text("VER TODAS",13.).with_color("#9D9FA6"));
    for (i, x, title) in [(0,24.,"NUEVA TEMPORADA"),(1,344.,"EVENTOS"),(2,665.,"ACTUALIZACIONES")] {
        home.push(make(&mut id,ArtTile,format!("Noticia {}",i+1),x,516.,302.,135.).with_variant(i as u8));
        home.push(make(&mut id,Text,format!("Texto noticia {}",i+1),x,660.,300.,29.).with_text(title,15.));
    }
    home.push(make(&mut id,Panel,"Panel social",1004.,74.,276.,646.).with_fill("#17191D"));
    home.push(make(&mut id,Text,"Social",1026.,97.,216.,27.).with_text("COMUNIDAD",16.));
    home.push(make(&mut id,Panel,"Buscar",1022.,144.,233.,34.).with_fill("#272A30"));
    home.push(make(&mut id,Text,"Buscar texto",1033.,151.,190.,22.).with_text("Buscar jugador...",13.).with_color("#8C919D"));
    for i in 0..7 {
        let y = 204. + i as f32 * 66.;
        home.push(make(&mut id,Dot,format!("Avatar {}",i+1),1028.,y,32.,32.).with_variant(i as u8));
        home.push(make(&mut id,Text,format!("Jugador {}",i+1),1072.,y-1.,180.,21.).with_text(format!("Jugador {:02}",i+1),15.));
        home.push(make(&mut id,Text,format!("Estado {}",i+1),1072.,y+20.,180.,18.).with_text(if i<4{"Conectado"}else{"Ausente"},12.).with_color(if i<4 {"#6EBE9B"} else {"#888D93"}));
    }
    let home = Scene { id:"home".into(), title:"Inicio / Portal".into(), elements:home };

    let mut library = vec![];
    library.push(make(&mut id,Panel,"Fondo",0.,0.,1280.,720.).with_fill("#0D0F12"));
    library.push(make(&mut id,Panel,"Cabecera",0.,0.,1280.,75.).with_fill("#111317"));
    library.push(make(&mut id,Button,"Volver",28.,22.,125.,36.).with_text("‹ INICIO",16.).with_fill("#24272D").with_action(Action::navigate("home")));
    library.push(make(&mut id,Text,"Titulo biblioteca",50.,112.,760.,58.).with_text("TUS PROYECTOS",44.).with_color("#F8EFE0"));
    library.push(make(&mut id,Text,"Subtitulo biblioteca",52.,174.,760.,26.).with_text("Selecciona un mundo para abrir su pagina general",19.).with_color("#A8ADB4"));
    for (i,x) in [(0,51.),(1,656.)] {
        library.push(make(&mut id,ArtTile,format!("Portada proyecto {}",i+1),x,242.,563.,298.).with_variant((i+3) as u8).with_action(Action::OpenProject(i)));
        library.push(make(&mut id,Text,format!("Nombre proyecto {}",i+1),x+16.,560.,450.,42.).with_text(if i==0{"VIRGOLAND ORIGINAL"}else{"VIRGOLAND SURVIVAL"},26.));
        library.push(make(&mut id,Button,format!("Abrir proyecto {}",i+1),x+16.,616.,202.,49.).with_text("ABRIR PROYECTO",16.).with_fill("#D6AD76").with_color("#151414").with_action(Action::OpenProject(i)));
    }
    let library = Scene { id:"library".into(), title:"Biblioteca de proyectos".into(), elements:library };

    let mut project = vec![];
    project.push(make(&mut id,Panel,"Fondo",0.,0.,1280.,720.).with_fill("#0E1117"));
    project.push(make(&mut id,Hero,"Banner administrable",0.,0.,1280.,467.).with_variant(1));
    if let Some(banner)=project.last_mut() {banner.asset_path="{project_banner}".into();}
    project.push(make(&mut id,Panel,"Barra superior",0.,0.,1280.,74.).with_fill("#12151C"));
    project.push(make(&mut id,Button,"Volver al inicio",25.,19.,138.,38.).with_text("‹  INICIO",16.).with_fill("#26282D").with_action(Action::navigate("home")));
    project.push(make(&mut id,Text,"Identificador",47.,118.,420.,30.).with_text("VIRGOLAND  /  PROYECTO",17.).with_color("#D9B880"));
    project.push(make(&mut id,Text,"Nombre proyecto",44.,170.,960.,92.).with_text("{project_name}",64.).with_color("#FFF6E5"));
    project.push(make(&mut id,Image,"Logo del proyecto",960.,138.,230.,96.));
    if let Some(logo)=project.last_mut(){logo.asset_path="{project_logo}".into();}
    project.push(make(&mut id,Text,"Descripcion proyecto",48.,264.,915.,75.).with_text("{project_description}",19.).with_color("#E2E2E4"));
    project.push(make(&mut id,Button,"Boton Jugar",47.,360.,236.,65.).with_text("JUGAR",22.).with_fill("#D9B47B").with_color("#101010").with_action(Action::Play));
    // Sample from Interaction Studio: one button, two conditions, different responses.
    if let Some(play_button) = project.last_mut() {
        play_button.interactions = vec![
            InteractionRule { name: "Jugar cuando esté instalado".into(), enabled: true, trigger: Trigger::Click,
                condition: Condition::Installed(true), responses: vec![Response::Action(Action::Play)] },
            InteractionRule { name: "Instalar si falta".into(), enabled: true, trigger: Trigger::Click,
                condition: Condition::Installed(false), responses: vec![Response::Action(Action::Install),
                    Response::Message("Instalación simulada completada. Ya podés jugar.".into())] },
        ];
    }
    project.push(make(&mut id,Button,"Version anterior",320.,371.,48.,48.).with_text("‹",29.).with_fill("#30353D").with_action(Action::PreviousVersion));
    project.push(make(&mut id,Text,"Version actual",386.,381.,242.,28.).with_text("{version}",18.).with_color("#E8E1D4"));
    project.push(make(&mut id,Button,"Version siguiente",605.,371.,48.,48.).with_text("›",29.).with_fill("#30353D").with_action(Action::NextVersion));
    project.push(make(&mut id,Text,"Titulo detalles",47.,485.,800.,40.).with_text("NOVEDADES Y ACTUALIZACIONES",24.));
    project.push(make(&mut id,Text,"Detalle uno",49.,542.,580.,30.).with_text("{news_title}",18.).with_color("#EAD1A6"));
    project.push(make(&mut id,Text,"Detalle dos",49.,586.,1010.,33.).with_text("PARCHE: {patch_title} | UPDATE: {update_title}",16.).with_color("#CED0D8"));
    project.push(make(&mut id,Text,"Calendario y notas",49.,634.,1145.,42.).with_text("{event_date} {event_title}     |     MC {mc_version}     |     {availability}",15.).with_color("#A5B4C5"));
    let project = Scene { id:"project".into(), title:"Pagina general del proyecto".into(), elements:project };

    let mut login = vec![];
    login.push(make(&mut id,Panel,"Fondo",0.,0.,1280.,720.).with_fill("#101219"));
    login.push(make(&mut id,Hero,"Arte del login",0.,0.,750.,720.).with_variant(2));
    login.push(make(&mut id,Panel,"Panel de acceso",750.,0.,530.,720.).with_fill("#181B20"));
    login.push(make(&mut id,Text,"Marca",812.,126.,406.,53.).with_text("VIRGOLAND",43.).with_color("#E2C08E"));
    login.push(make(&mut id,Text,"Bienvenida",813.,221.,386.,38.).with_text("Bienvenido de nuevo",25.));
    login.push(make(&mut id,Panel,"Campo nick",812.,301.,387.,57.).with_fill("#2A2E36"));
    login.push(make(&mut id,Text,"Indicacion nick",827.,315.,355.,31.).with_text("VSC NICK  /  Invitado",17.).with_color("#A9AFB9"));
    login.push(make(&mut id,Panel,"Campo PIN",812.,384.,387.,57.).with_fill("#2A2E36"));
    login.push(make(&mut id,Text,"Indicacion PIN",827.,398.,355.,31.).with_text("PIN (demo: no se autentica)",17.).with_color("#A9AFB9"));
    login.push(make(&mut id,Button,"Entrar",812.,485.,387.,65.).with_text("ENTRAR A LA DEMO",19.).with_fill("#D9B47B").with_color("#151414").with_action(Action::navigate("home")));
    login.push(make(&mut id,Text,"Aviso demo",813.,577.,388.,53.).with_text("Pantalla visual. La autenticacion real\nse integrara en VSLauncher.",14.).with_color("#959BA8"));
    let login = Scene { id:"login".into(), title:"Login VSC".into(), elements:login };

    DesignDocument { format_version:1, name:"VSLauncher / Portal Dark Gaming".into(), width:CANVAS_W, height:CANVAS_H,
        projects: vec![
            GameProject { id:"virgoland".into(), title:"VIRGOLAND".into(), subtitle:"Original".into(),
                description:"Un universo para descubrir, construir y compartir. Explora mundos, misiones y nuevas experiencias.".into(),
                versions:vec!["26.3 / Principal".into(),"26.3 / Experimental".into(),"1.21 / Legacy".into()],
                mc_version:"26.3".into(),notes:"Mundo principal de Virgoland. Elegí una instalación y ajustá tu memoria RAM.".into(),
                community_url:"https://discord.com/".into(),
                posts:vec![ProjectPost{kind:PostKind::News,title:"Bienvenido al nuevo Virgoland".into(),body:"Conocé el servidor y las próximas novedades".into(),date:"2026-11-09".into()},
                    ProjectPost{kind:PostKind::Patch,title:"Ajustes de estabilidad".into(),body:"Registro de parches de prueba".into(),date:"2026-11-09".into()}],
                calendar:vec![ProjectEvent{title:"Próximo evento".into(),date:"Por anunciar".into(),description:"El equipo publicará aquí los próximos eventos.".into()}],..GameProject::default() },
            GameProject { id:"survival".into(), title:"VIRGOLAND SURVIVAL".into(), subtitle:"Supervivencia".into(),
                description:"Una aventura de supervivencia donde cada construccion cuenta. Un mundo persistente para tu comunidad.".into(),
                versions:vec!["26.3 / Survival".into(),"26.3 / Pruebas".into()],
                mc_version:"26.3".into(),notes:"Proyecto en preparación; visible en el cliente aunque no haya descarga.".into(),
                installable:false,..GameProject::default() }
        ], scenes:vec![home,library,project,login], components:Vec::new(), guides:BTreeMap::new(), blueprints:BTreeMap::new() }
}

#[derive(Debug, Clone)]
pub struct Session {
    pub screen: String,
    pub project: usize,
    pub version: usize,
    pub simulated_installed: bool,
    pub message: String,
    /// Ephemeral flags used by Interaction Studio, never saved as credentials or game state.
    pub flags: BTreeMap<String, bool>,
}
impl Default for Session { fn default() -> Self { Self { screen:"home".into(), project:0, version:0, simulated_installed:true, message:String::new(), flags:BTreeMap::new() } } }
impl Session {
    pub fn interpolated(&self, source:&str, doc:&DesignDocument) -> String {
        let proj = doc.projects.get(self.project).or_else(||doc.projects.first());
        let project_name = proj.map(|p| p.title.as_str()).unwrap_or("Proyecto");
        let description = proj.map(|p| p.description.as_str()).unwrap_or("Sin descripcion");
        let version = proj.and_then(|p|p.versions.get(self.version)).map(String::as_str).unwrap_or("Sin version");
        let first_post=|kind:PostKind|proj.and_then(|p|p.posts.iter().find(|post|post.kind==kind));
        let event=proj.and_then(|p|p.calendar.first());
        let mc_version=proj.map(|p|p.mc_version.as_str()).unwrap_or("");
        let banner=proj.map(|p|p.banner_path.as_str()).unwrap_or("");
        let logo=proj.map(|p|p.logo_path.as_str()).unwrap_or("");
        let icon=proj.map(|p|p.icon_path.as_str()).unwrap_or("");
        let avail=if proj.is_some_and(|p|p.installable) {"Instalación disponible (demo)"} else {"Próximamente"};
        let mut rendered = source.replace("{project_banner}",banner).replace("{project_logo}",logo)
              .replace("{project_icon}",icon)
              .replace("{project_subtitle}",proj.map(|p|p.subtitle.as_str()).unwrap_or(""))
              .replace("{mc_version}",mc_version)
              .replace("{project_notes}",proj.map(|p|p.notes.as_str()).unwrap_or(""))
              .replace("{community}",proj.map(|p|p.community_url.as_str()).unwrap_or(""))
              .replace("{availability}",avail)
              .replace("{news_title}",first_post(PostKind::News).map(|p|p.title.as_str()).unwrap_or("Sin novedades"))
              .replace("{patch_title}",first_post(PostKind::Patch).map(|p|p.title.as_str()).unwrap_or("Sin parches"))
              .replace("{update_title}",first_post(PostKind::Update).map(|p|p.title.as_str()).unwrap_or("Sin updates"))
              .replace("{event_title}",event.map(|p|p.title.as_str()).unwrap_or("Sin eventos"))
              .replace("{event_date}",event.map(|p|p.date.as_str()).unwrap_or(""))
              .replace("{project_name}",project_name)
              .replace("{project_description}",description)
              .replace("{version}",version)
              .replace("{status}",if self.simulated_installed {"Listo para jugar (demo)"} else {"No instalado (demo)"});
        for (key, value) in &self.flags {
            rendered = rendered.replace(&format!("{{flag:{key}}}"), if *value { "Activo" } else { "Inactivo" });
        }
        rendered
    }
    pub fn apply(&mut self, action:&Action, doc:&DesignDocument) {
        match action {
            Action::None => (),
            Action::Navigate(screen) => { if doc.scene(screen).is_some() { self.screen=screen.clone(); } },
            Action::OpenProject(index) => {
                if let Some(project) = doc.projects.get(*index) {
                    self.project=*index;
                    self.version=0;
                    self.screen=project.page_scene_id.as_ref()
                        .filter(|id|doc.scene(id).is_some())
                        .cloned()
                        .or_else(||doc.scene("project").map(|_|"project".to_string()))
                        .unwrap_or_else(||doc.scenes[0].id.clone());
                }
            },
            Action::NextVersion => { if let Some(p)=doc.projects.get(self.project) { if !p.versions.is_empty() {self.version=(self.version+1)%p.versions.len(); } } },
            Action::PreviousVersion => { if let Some(p)=doc.projects.get(self.project) { if !p.versions.is_empty() {self.version=(self.version+p.versions.len()-1)%p.versions.len(); } } },
            Action::Play => self.message=if doc.projects.get(self.project).is_some_and(|p|p.installable) {
                "DEMO: Jugar no inicia Minecraft. Falta integrar motor de instalaciones.".into()
            } else {"Este proyecto está publicado, pero todavía no permite instalar ni jugar.".into()},
            Action::Install => {
                if doc.projects.get(self.project).is_some_and(|p|p.installable) {
                    self.simulated_installed=!self.simulated_installed;
                    self.message="Estado de instalacion simulado".into();
                } else {self.message="Instalación todavía no habilitada por los administradores.".into();}
            },
            Action::Back => self.screen=if doc.scene("home").is_some(){"home".into()}else{doc.scenes[0].id.clone()},
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn template_valid() { let doc=demo_document(); assert!(doc.validate().is_ok()); assert_eq!(doc.scenes.len(),4); }
    #[test] fn navigation_preserves_selection() { let doc=demo_document(); let mut s=Session::default(); s.apply(&Action::OpenProject(1),&doc); assert_eq!(s.screen,"project"); assert_eq!(s.project,1); s.apply(&Action::NextVersion,&doc); assert_eq!(s.version,1); }
    #[test] fn interpolation() { let doc=demo_document(); let s=Session::default(); assert!(s.interpolated("{project_name} {version}",&doc).contains("26.3")); }
    #[test] fn reject_bad_action() { let mut doc=demo_document(); doc.scenes[0].elements[0].action=Action::navigate("missing"); assert!(doc.validate().is_err()); }
    #[test] fn navigation_constructor_accepts_str_and_string() {
        assert_eq!(Action::navigate("home"), Action::Navigate(String::from("home")));
        assert_eq!(Action::navigate(String::from("library")), Action::Navigate(String::from("library")));
    }
    #[test] fn all_template_actions_resolve() {
        let doc = demo_document();
        for scene in &doc.scenes {
            for item in &scene.elements {
                match &item.action {
                    Action::Navigate(target) => assert!(doc.scene(target).is_some()),
                    Action::OpenProject(index) => assert!(*index < doc.projects.len()),
                    _ => {}
                }
            }
        }
    }
    #[test] fn old_json_without_layout_or_components_still_loads() {
        let doc = demo_document();
        let mut value = serde_json::to_value(&doc).unwrap();
        value.as_object_mut().unwrap().remove("components");
        let first = &mut value["scenes"][0]["elements"][0];
        first.as_object_mut().unwrap().remove("layout");
        first.as_object_mut().unwrap().remove("parent_id");
        first.as_object_mut().unwrap().remove("component_key");
        first.as_object_mut().unwrap().remove("component_source_id");
        let recovered: DesignDocument = serde_json::from_value(value).unwrap();
        assert!(recovered.validate().is_ok());
        assert_eq!(recovered.components.len(), 0);
        assert_eq!(recovered.scenes[0].elements[0].layout.mode, LayoutMode::Free);
    }
    #[test] fn reject_parent_cycles() {
        let mut doc = demo_document();
        doc.scenes[0].elements[0].parent_id = Some(2);
        doc.scenes[0].elements[1].parent_id = Some(1);
        assert!(doc.validate().is_err());
    }
    #[test] fn legacy_project_without_scene_binding_still_loads() {
        let mut json=serde_json::to_value(demo_document()).unwrap();
        for project in json["projects"].as_array_mut().unwrap() {
            project.as_object_mut().unwrap().remove("page_scene_id");
        }
        let doc:DesignDocument=serde_json::from_value(json).unwrap();
        assert!(doc.projects.iter().all(|p|p.page_scene_id.is_none()));
        doc.validate().unwrap();
    }
    #[test] fn invalid_custom_project_page_is_rejected() {
        let mut doc=demo_document();
        doc.projects[0].page_scene_id=Some("no_existe".into());
        assert!(doc.validate().is_err());
    }
    #[test] fn legacy_projects_keep_installation_enabled() {
        let mut data=serde_json::to_value(demo_document()).unwrap();
        for project in data["projects"].as_array_mut().unwrap() {
            for key in ["mc_version","banner_path","logo_path","icon_path","notes","community_url","installable","posts","calendar"] {
                project.as_object_mut().unwrap().remove(key);
            }
        }
        let old:DesignDocument=serde_json::from_value(data).unwrap();
        old.validate().unwrap();
        assert!(old.projects.iter().all(|p|p.installable));
    }
    #[test] fn catalog_projects_remain_visible_without_installation() {
        let mut doc=demo_document();
        doc.projects.push(GameProject{id:"nuevo".into(),title:"Próximamente".into(),
            versions:vec![],installable:false,..Default::default()});
        doc.validate().unwrap();
        let mut session=Session::default();
        session.apply(&Action::OpenProject(2),&doc);
        assert_eq!(session.project,2);
        session.apply(&Action::Install,&doc);
        assert!(session.message.contains("no habilitada"));
    }
    #[test] fn metadata_tokens_use_selected_project() {
        let doc=demo_document();
        let session=Session::default();
        assert!(session.interpolated("{mc_version}/{news_title}",&doc).contains("Bienvenido"));
    }
    #[test] fn json_round_trip() { let doc=demo_document(); let text=serde_json::to_string(&doc).unwrap(); let copy:DesignDocument=serde_json::from_str(&text).unwrap(); assert_eq!(copy.scenes.len(),doc.scenes.len()); }
}

#[cfg(test)]
mod blueprint_compat_tests {
    use super::*;
    #[test] fn older_json_without_blueprints_loads() {
        let doc=demo_document();
        let mut raw=serde_json::to_value(&doc).unwrap();
        raw.as_object_mut().unwrap().remove("blueprints");
        let recovered:DesignDocument=serde_json::from_value(raw).unwrap();
        assert!(recovered.blueprints.is_empty());
        recovered.validate().unwrap();
    }
    #[test] fn persisted_guides_survive_roundtrip() {
        let mut doc=demo_document();
        doc.blueprints.insert("home".into(),BlueprintSettings{
            vertical:vec![120.0,640.0],horizontal:vec![160.0],..Default::default()
        });
        let saved=serde_json::to_string(&doc).unwrap();
        let restored:DesignDocument=serde_json::from_str(&saved).unwrap();
        restored.validate().unwrap();
        assert_eq!(restored.blueprints["home"].vertical,vec![120.0,640.0]);
    }
}

#[cfg(test)]
mod interaction_schema_tests {
    use super::*;
    #[test]
    fn interaction_roundtrip_does_not_change_legacy_format() {
        let doc=demo_document();
        assert_eq!(doc.format_version,1);
        let json=serde_json::to_string_pretty(&doc).unwrap();
        let copy:DesignDocument=serde_json::from_str(&json).unwrap();
        copy.validate().unwrap();
        assert_eq!(copy.scene("project").unwrap().elements.iter()
            .find(|e|e.name=="Boton Jugar").unwrap().interactions.len(),2);
    }
    #[test]
    fn invalid_rule_destination_is_rejected() {
        let mut doc=demo_document();
        let element=doc.scene_mut("project").unwrap().elements.iter_mut()
            .find(|e|e.name=="Boton Jugar").unwrap();
        element.interactions[0].responses=vec![Response::Action(Action::navigate("pantalla_inexistente"))];
        assert!(doc.validate().unwrap_err().contains("Destino inexistente"));
    }
    #[test]
    fn invalid_flag_names_are_rejected() {
        let mut doc=demo_document();
        let element=doc.scene_mut("project").unwrap().elements.iter_mut()
            .find(|e|e.name=="Boton Jugar").unwrap();
        element.interactions[0].responses=vec![Response::ToggleFlag("flag con espacios".into())];
        assert!(doc.validate().unwrap_err().contains("Bandera inválida"));
    }
    #[test]
    fn flags_interpolate_as_labels() {
        let doc=demo_document(); let mut session=Session::default();
        session.flags.insert("noticias".into(),true);
        assert_eq!(session.interpolated("Estado: {flag:noticias}",&doc),"Estado: Activo");
    }
}

#[cfg(test)]
mod motion_schema_tests {
    use super::*;
    fn doc_with_motion() -> DesignDocument {
        let mut doc=demo_document();
        let element=doc.scenes[0].elements.first_mut().unwrap();
        let mut start=MotionKeyframe::from_element(element,0);
        start.opacity=0.0;
        let end=MotionKeyframe::from_element(element,600);
        element.motion=Some(MotionClip {
            name:"Fundido".into(),duration_ms:600,looped:false,autoplay:true,
            keyframes:vec![start,end] });
        doc
    }
    #[test]
    fn motion_roundtrip_does_not_bump_format_version() {
        let doc=doc_with_motion();
        assert_eq!(doc.format_version,1);
        doc.validate().unwrap();
        let json=serde_json::to_string(&doc).unwrap();
        let restored:DesignDocument=serde_json::from_str(&json).unwrap();
        restored.validate().unwrap();
        assert_eq!(restored.scenes[0].elements[0].motion,doc.scenes[0].elements[0].motion);
    }
    #[test]
    fn old_documents_without_motion_field_still_load() {
        let doc=demo_document();
        let json=serde_json::to_string(&doc).unwrap();
        assert!(!json.contains("\"motion\""));
        let restored:DesignDocument=serde_json::from_str(&json).unwrap();
        restored.validate().unwrap();
        assert!(restored.scenes[0].elements.iter().all(|e|e.motion.is_none()));
    }
    #[test]
    fn duplicate_keyframe_times_are_rejected() {
        let mut doc=doc_with_motion();
        doc.scenes[0].elements[0].motion.as_mut().unwrap().keyframes[1].time_ms=0;
        assert!(doc.validate().is_err());
    }
    #[test]
    fn invalid_opacity_is_rejected() {
        let mut doc=doc_with_motion();
        doc.scenes[0].elements[0].motion.as_mut().unwrap().keyframes[0].opacity=1.5;
        assert!(doc.validate().is_err());
    }
    #[test]
    fn shorter_duration_than_keyframe_is_rejected() {
        let mut doc=doc_with_motion();
        doc.scenes[0].elements[0].motion.as_mut().unwrap().duration_ms=250;
        assert!(doc.validate().is_err());
    }
}
