import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
const root=new URL('../',import.meta.url);
const get=async p=>readFile(new URL(p,root),'utf8');
const js=await get('web/app.js'),css=await get('web/styles.css'),rust=await get('src-tauri/src/main.rs');
const config=JSON.parse(await get('src-tauri/tauri.conf.json'));
const cap=JSON.parse(await get('src-tauri/capabilities/default.json'));
const projects=await get('web/project-v2.3.css');
const effects=await get('web/effects.js'),visual=await get('web/visual-v2.1.css'),motion=await get('web/motion-v2.2.css');
const checks=[
  ['Tauri 2 nativo',config.app.withGlobalTauri===true && config.build.frontendDist==='../web'],
  ['Login centrado y sólido',css.includes('.auth-screen')&&css.includes('background:#120b27')&&css.includes('.auth-glass')],
  ['Pantallas del launcher',['homePage','projectPage','profilePage','instancesPage','settingsPage','assetsPage'].every(x=>js.includes(`function ${x}`))],
  ['Menú administrativo',js.includes('data-context')&&rust.includes('fn save_project')&&rust.includes('s.admin()?')],
  ['Login Argon2id', (await get('src-tauri/src/accounts.rs')).includes('Argon2::default()')],
  ['Social local seguro',rust.includes('fn request_friend')&&rust.includes('fn send_message')],
  ['Instancias locales',rust.includes('fn save_instance')&&rust.includes('minecraft::installed')],
  ['Importador visual',rust.includes('fn import_asset')&&js.includes('T.dialog.open')],
  ['Sin proyectos de muestra',js.includes('projects:[]')&&(await get('src-tauri/src/main.rs')).includes('projects: vec![]')],
  ['Permisos acotados',cap.permissions.includes('dialog:default')&&!cap.permissions.includes('fs:default')],
  ['Animaciones de bajo consumo',effects.includes('visibilitychange')&&effects.includes('prefers-reduced-motion')&&visual.includes('portal-feature')],
  ['Editor con vista previa',js.includes('wizard-live-preview')&&js.includes('data-live-title')],
  ['Panel social y avatar',js.includes('function avatarDialog')&&js.includes('social-global')&&js.includes('social-projects')],
  ['Avatar seguro persistente',rust.includes('fn set_avatar_preset')&&rust.includes('s.storage.save()?')],
  ['Portadas tipo portal',js.includes('portal-project-hero')&&js.includes('portal-game-card')],
  ['Animación de navegación',effects.includes('beginSectionChange')&&js.includes('beginSectionChange(root')],
  ['Transición de Login y Registro',effects.includes('animateAuthSwap')&&js.includes('animateAuthSwap(root')],
  ['Animaciones de chat y mensajes',effects.includes('animateChat')&&effects.includes('freshMessage')&&js.includes('animateChat(root')],
  ['Social Global/Proyectos',effects.includes('animateSocialTab')&&js.includes('animateSocialTab(root')],
  ['Configuración animada',effects.includes('animateSetting')&&js.includes('animateSetting(root')],
  ['Modales con entrada/salida',effects.includes('beginSurfaceDismiss')&&js.includes('beginSurfaceDismiss(root')],
  ['Avatares y editor animados',effects.includes('animateAvatar')&&effects.includes('animateModalStep')],
  ['Accesibilidad: foco y movimiento reducido',motion.includes('focus-visible')&&motion.includes('prefers-reduced-motion')&&effects.includes('visibilitychange')],
  ['Hoja Motion cargada en Tauri',(await get('web/index.html')).includes('motion-v2.2.css')],
  ['Portada degradada a fondo',projects.includes('.cinematic-project-hero::before')&&js.includes('projectHeroPhoto')],
  ['Publicación directa con permisos admin',js.includes('quickPublishDialog')&&js.includes('saveQuickPublish')&&rust.includes('s.admin()?')],
  ['Editar y eliminar publicaciones',js.includes('edit-publication')&&js.includes('remove-publication')],
  ['Recorte y zoom no destructivo',js.includes('paintCrop')&&js.includes('saveCrop')&&rust.includes('fn save_cropped_asset')],
  ['Rutas de imágenes persistentes',js.includes("document.querySelectorAll('input[data-field],select[data-field],textarea[data-field]')")],
  ['Hoja de proyecto 2.3 cargada', (await get('web/index.html')).includes('project-v2.3.css')],
  ['Motor de Minecraft Java', (await get('src-tauri/src/minecraft.rs')).includes('pub fn install(')&& (await get('src-tauri/src/minecraft.rs')).includes('pub fn launch(')],
  ['Descargas con hash SHA1', (await get('src-tauri/src/minecraft.rs')).includes('Sha1::digest')&&(await get('src-tauri/src/minecraft.rs')).includes('expected_sha1')],
  ['Versiones Mojang y Fabric', (await get('src-tauri/src/minecraft.rs')).includes('piston-meta.mojang.com')&&(await get('src-tauri/src/minecraft.rs')).includes('meta.fabricmc.net')],
  ['Modrinth con filtros', (await get('src-tauri/src/minecraft.rs')).includes('project_type:mod')&&js.includes('modrinth-search-form')],
  ['Permisos de ejecución de proyectos',rust.includes('fn set_project_execution')&&rust.includes('checked_instance')&&js.includes('toggle-project-execution')],
  ['Importación de JAR, ZIP', rust.includes('fn import_instance_file')&&(await get('src-tauri/src/minecraft.rs')).includes('resourcepacks')],
  ['Skin y capa local, avatar con capas', (await get('src-tauri/src/accounts.rs')).includes('avatar_layer')&&rust.includes('"cape" =>')],
  ['Nuevo diseño Minecraft',js.includes('function minecraftPage')&&(await get('web/index.html')).includes('minecraft-v2.4.css')],
  ['Modo offline explícito', (await get('src-tauri/src/minecraft.rs')).includes('OfflinePlayer:')&&js.includes('sin autenticación oficial')],
  ['Dos modos en Home',js.includes('function modeSelector()')&&js.includes('function personalHomePage()')&&js.includes("setLibraryMode('user')")],
  ['Sidebar contextual',js.includes('MIS JUEGOS')&&js.includes('new-personal-instance')&&js.includes('side-projects')],
  ['Instancia independiente en Rust',rust.includes('const PERSONAL_PROJECT_ID: &str = "__personal__"')&&rust.includes('instance.project_id != PERSONAL_PROJECT_ID')&&rust.includes('if project_id != PERSONAL_PROJECT_ID')],
  ['Microsoft compacto sin OAuth ficticio',js.includes('<span>Microsoft</span>')&&!js.includes('<span>Microsoft</span><span class="soon">')&&(await get('web/index.html')).includes('vslauncher-v2.6.css')],
];
let count=0;
for(const [name,success] of checks){console.log(`${success?'OK':'ERROR'} ${name}`);if(!success)count++;}
if(count)process.exit(1);
console.log(`Checks estáticos: ${checks.length}/${checks.length}. No equivalen a cargo check ni a pruebas de Tauri instalado.`);
