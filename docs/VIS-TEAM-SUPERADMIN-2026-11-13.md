# VIS Team + Ceibo — distribución protegida de proyectos y superadministrador

Integrado al código fuente de `main` el 13/11/2026. **Sin publicación en producción de Cloudflare y sin nuevo ejecutable ni instalador.** El Worker R2 y el flujo de proyecto requieren verificación real de dos dispositivos y `cargo check` antes de una versión de prueba.

## 1. Cuenta superadministradora VIS STUDIOS

Una cuenta VIS Cloud es diferente de una cuenta local de VIS. No se puede declarar una cuenta remota existente ni crearla con una contraseña predeterminada desde GitHub sin registrarla; tampoco se promueve la primera cuenta que se registre.

**Preparación real para el primer alta:**

1. En la aplicación VIS Nexo, registrá una **cuenta VIS Cloud** dedicada, por ejemplo `visstudios` si ese nombre está libre y no coincide con otra cuenta local del equipo. Su nombre público visible puede ser `VIS STUDIOS`.
2. Usá una contraseña larga y única. Ceibo genera desde Argon2id una credencial Ed25519; **la contraseña y la clave privada no salen de Rust**. Guardá los factores de recuperación por medios seguros.
3. En VIS Portals elegí **Identidad para superadmin**. Copiá el usuario y el **verificador público Ed25519**. Este último no es la contraseña ni una clave de acceso.
4. Un mantenedor autorizado ingresa a [VIS Social - Provision First Super Administrator](https://github.com/JoseDaniel03/VIS-Nexo/actions/workflows/vis-social-superadmin.yml), elige `main`, verifica la identidad y el verificador por un medio independiente, y autoriza el workflow usando el entorno `vis-social-production` con revisión obligatoria cuando esté disponible.
5. El workflow protegido usa los **GitHub Secrets del entorno**, comprueba que existe una cuenta VIS Cloud normal y activa con exactamente ese verificador, que todavía no exista otra cuenta `super_admin`, y promociona **solo esa cuenta**. Una consulta posterior exige el rol y el mismo verificador antes de anunciar éxito.

La cuenta **no se creó ni se ascendió en la base real en esta sesión**: faltan registro humano, selección de identidad y autorización explícita del workflow de producción. No se deben compartir contraseñas, claves privadas ni tokens de Cloudflare en esta conversación.

Superadmin remoto permite administrar roles de VIS Social y autorizaciones de proyecto. No se confunde con el primer admin **local** de una computadora. La publicación de archivos en R2 continúa protegida por su propia credencial `VIS_PUBLISH_TOKEN`; una cuenta con rol social alto no recibe automáticamente acceso a los secretos de R2.

## 2. Carpeta de equipo: qué se comparte

VIS Team usa el formato propio `ZIP + .bsconfig` y un manifiesto de integridad **SHA-256 por archivo**, más SHA-256 y tamaño del ZIP publicados en VIS Universe. El ZIP se guarda por hash en Cloudflare R2 y el catálogo lo referencia mediante `bundle_url`, `sha256` y `size_bytes`.

| Contenido | Regla de publicación |
| --- | --- |
| `.bsconfig` | Siempre; incluye ID del proyecto, motor, Minecraft, loader, fecha, hashes y lista de mods Modrinth |
| `config/`, `defaultconfigs/` | Incluidos por defecto, solo archivos seguros dentro de la instancia |
| `kubejs/`, `scripts/`, `patchouli_books/` | Incluidos por defecto para recetas, scripts y contenido de misiones |
| `resourcepacks/`, `shaderpacks/`, `datapacks/` | **Opcionales**, con permiso de redistribución y límite de tamaño |
| `servers.dat` | **Opcional**, requiere revisión previa y aprobación para publicar las IP/direcciones guardadas |
| `XaeroWaypoints/`, `journeymap/` | **Opcionales**, pueden revelar puntos/ubicaciones privadas |
| Mods | Por sus **ID de Modrinth** existentes en la ficha del proyecto; VIS los resolverá desde la fuente autorizada cuando instale/sincronice la instancia, no republica JARs de terceros |

**Siempre excluidos:** `saves/` (mundos privados), `options.txt`, `logs/`, `crash-reports/`, `screenshots/`, `.vis/`, `.vslauncher/`, `usercache.json`, datos de autenticación, claves, sesiones y ejecutables ajenos. Archivos de configuración con nombres sensibles o patrones comunes de claves/tokens son bloqueados automáticamente; la inspección textual no puede garantizar detectar todos los secretos: **la revisión humana de la vista previa es obligatoria**.

Un mundo plantilla publicado debe ser una función separada, con respaldo, confirmación e identidad legal de contenido. No se incluyen automáticamente carpetas personales del juego.

## 3. Publicar desde VIS Nexo

1. Iniciá sesión con un perfil **administrador local** que posea el proyecto y una instancia instalada, con el mismo motor, loader y versión.
2. Entrá en **Configuración → VIS Team · Proyecto compartido**. Elegí la instancia y marcá únicamente las categorías que quieras compartir.
3. Pulsá **Revisar archivos a compartir**. VIS enumera la lista seleccionada, exclusiones y advertencias; el tamaño máximo es 96 MiB sin comprimir y 32 MiB como ZIP. Ningún archivo individual puede superar 16 MiB; máximo 1.500 archivos.
4. Ingresá el token privado del **Worker VIS Universe** solo en el formulario de publicación y confirmá. El backend hace la copia con la instancia bloqueada para impedir cambios durante la lectura, y verifica hashes SHA-256.
5. Rust transmite el ZIP como streaming a `PUT /packs/{id}/{sha256}.zip` con autorización del publicador. El Worker verifica tamaño, el prefijo ZIP y SHA-256, guarda el archivo en R2 y registra el puntero del proyecto. Después se republica el catálogo VIS Universe, que ya incluye el enlace inmutable del paquete.

Si Cloudflare no está desplegado o el catálogo apunta a GitHub Pages, no es posible publicar paquetes directamente; nunca se considera éxito una transferencia que no fue confirmada por el Worker.

## 4. Recibir y aplicar el paquete

En **VIS Universe → Proyectos en la nube**, el usuario elige una instancia **propia** del proyecto y **Aplicar archivos nuevos**. El cliente baja el ZIP HTTPS desde el catálogo y **verifica el SHA-256 total y tamaño**. Luego:

- exige `.bsconfig` y valida ID, motor, versión de Minecraft, loader y referencias de mods;
- rechaza rutas `..`, directorios fuera de la lista permitida, nombres incompatibles Windows/Linux, enlaces simbólicos, entradas de ZIP duplicadas o no declaradas, archivos descomprimidos de tamaño peligroso y hashes incorrectos;
- extrae primero a staging dentro de la instancia, compara SHA-256 por archivo y **solo crea archivos que no existan**. Los ya presentes se conservan completos; no se borran mods, partidas ni ajustes;
- solo importa servidores y waypoints si el jugador activa por separado esas casillas. Aceptar la publicación en R2 no concede permiso para publicar ni importar sus archivos personales.

**Limitación consciente de fase 1:** no se reescriben configuraciones existentes ni se sincronizan cambios conflictivos. El gestor de versiones, actualización diferencial y detección de archivos modificados por el jugador requerirá un manifiesto persistente de propiedad y un sistema de copias/rollback. Esta fase sirve para instalar una plantilla de equipo, sin pérdida de datos.

## 5. Gestión de permisos de equipo (pendiente)

La subida todavía está limitada a un **administrador local con credencial de publicación R2**. No se conceden secretos del bucket a todos los compañeros. Para permitir que varios editores publiquen sin conocer ese secreto, hay que vincular roles por proyecto de **VIS Social** con **VIS Universe**, emitir credenciales temporales de subida por proyecto con auditoría y límites, y revisar las licencias de recursos. El nuevo `.bsconfig` ya es la base de esa sincronización, pero **no se debe anunciar un editor multiusuario simultáneo todavía**.

## 6. Validación

- `tools/test_universe_worker.mjs`: autenticación del endpoint, SHA-256, rutas seguras, lectura de R2 y enlace con el catálogo.
- `tools/test_social_superadmin_bootstrap.py`: prueba de SQL de promoción cloud bajo condiciones de rol único, cuenta activa, clave verificada e intentos de inyección.
- `src-tauri/src/team_pack.rs`: pruebas Rust de filtros de rutas/secretos y ciclo local de crear/aplicar ZIP sin sobrescribir archivos.
- `tools/check_vis_team.py`: contratos estáticos del puente, UI, permisos, Cloudflare y seguridad.
- `.github/workflows/vis-team-tests.yml`: **Node + Python + análisis sintáctico Rust, sin builds ni despliegue**.

Antes de habilitar producción debe aprobar `cargo check --all-targets --locked` y `cargo test` Linux/Windows, la carga real en Worker/R2, una importación desde otra computadora y pruebas de suspensión y disco lleno. No está validada todavía la escritura multiusuario ni el despliegue productivo.
