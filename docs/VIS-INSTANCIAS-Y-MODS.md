# VIS Nexo — Instancias y contenido por proyecto

## Alcance de esta entrega

VIS STUDIOS configura el motor, la versión Minecraft, el loader y los recursos requeridos de cada proyecto.
Los jugadores pueden crear sus instancias personales y, para los proyectos publicados, elegir carpeta y RAM sin alterar la configuración oficial.

En **Editor de proyectos → Datos → Mods y contenido**, el administrador carga IDs o slugs de **Modrinth** separados por coma en:
- `required_mods`: mods para **Fabric**, con resolución de dependencias requerida por Modrinth.
- `required_resourcepacks`: resource packs ZIP de Minecraft Java.
- `required_shaders`: shader packs ZIP; requieren un cargador de shaders compatible como Iris para funcionar en el juego.

Se permiten 32 recursos como máximo por proyecto, sin duplicados, con IDs ASCII alfanuméricos, guion y guion bajo.
Vanilla no admite mods Fabric; Horizon no admite packs Modrinth Java. Las versiones se resuelven para la versión de Minecraft del proyecto, y pueden fallar si no hay una versión compatible.

## Flujo jugador

1. El administrador guarda el proyecto local, revisa el contenido y **publica VIS Universe** por Cloudflare Worker. El Worker valida el manifiesto antes de almacenarlo en R2.
2. El jugador actualiza el catálogo, abre el proyecto y usa **Instalar y jugar** para crear la instancia de ese proyecto. El backend valida versión y loader, prepara Minecraft y después descarga recursos Modrinth requeridos.
3. El jugador puede entrar en Instancias, o en Centro Minecraft, para **sincronizar** mods/packs de un proyecto ya instalado. También puede importar, activar o desactivar archivos individuales sin eliminarlos.
4. **Pausar en mi biblioteca** afecta solamente a ese perfil local; bloquea jugar e instalar desde ese perfil, **sin borrar** proyectos, archivos ni mundos. Se puede reanudar en cualquier momento. Es distinto de **Bloquear ejecución**, el control administrativo existente.

## Limitaciones y seguridad

- La instalación inicial de los recursos declarados está automatizada, pero **no existe todavía sincronización diferencial automática del pack al iniciar cada partida**. Tras una actualización de contenido del administrador, hay que usar **Sincronizar contenido** o **Reparar**.
- No se instalan automáticamente ZIP privados, datapacks por mundo, mapas ni mods externos a Modrinth. La instalación segura de paquetes VIS Ombú con manifiestos SHA-256 y rollback es una etapa posterior.
- Cada proyecto mantiene su carpeta, y los perfiles comparten los archivos del juego únicamente donde ya está permitido; no se mezclan mundos deliberadamente.
- La descarga se realiza desde Modrinth, con la validación de hashes y compatibilidad implementada por el instalador existente. Puede requerir conexión y fallar ante dependencias incompatibles o archivos que ya fueron desactivados manualmente.
- **No se implementa Microsoft OAuth** en esta entrega; el modo local no concede acceso a servidores premium.
- El chat, amigos y presencia por Internet quedan fuera de alcance.

## Verificación recomendada

- Probar en Linux y Windows crear un proyecto Fabric con `fabric-api` y `sodium`, más un pack compatible, publicarlo, actualizar catálogo en otro perfil, crear una instancia en carpeta independiente e instalar.
- Desde Centro Minecraft desactivar/activar un JAR y un ZIP y verificar que no se borran sus bytes.
- Pausar proyecto en cuenta A y comprobar que cuenta B no se vea afectada; reanudar y jugar.
- Editar el proyecto, añadir un mod compatible, republicar y utilizar **Sincronizar contenido**.
- Confirmar que Horizon rechace mods Modrinth y Vanilla rechace mods Fabric.
- Revisar logs de arranque del juego; una CI verde valida Rust/JS pero **no equivale** a ejecutar Minecraft en un entorno gráfico real.

## Modo offline: creación y gestión de instancias

Los jugadores que eligen **Offline** en el login no necesitan registrar una cuenta VIS para usar **VIS Worlds**. Las instalaciones creadas quedan asociadas al nickname local, en preferencias con prefijo `offline--`. El nickname se normaliza a minúsculas para conservar el mismo UUID offline y los datos del jugador al volver a entrar. No hay contraseña para ese nickname: cualquier persona que tenga acceso al mismo equipo y escriba el mismo nick puede usar ese perfil.

**Disponible en modo offline:**
- Crear, editar, duplicar configuración, importar/exportar y eliminar de la lista las instancias propias.
- Instalar, reparar e iniciar Minecraft Java Vanilla/Fabric en carpetas locales separadas.
- Buscar mods compatibles en Modrinth, importar JAR/ZIP, activar/desactivar mods, texturas y shaders por instancia.
- Instalar proyectos Java publicados en VIS Universe con carpeta y RAM propios; pausar o reanudar esos proyectos por nickname.
- Jugar instancias Java previamente instaladas en cuentas locales del mismo equipo con guardados separados, pero sin modificar sus archivos como si fueran propias.

**No disponible:** privilegios de administrador ni edición de proyectos oficiales; sincronización de amigos/chat; autenticación Microsoft; servidores premium/online-mode; instalación/ejecución de Horizon en un perfil offline. El modo offline no demuestra titularidad de Minecraft.

**Seguridad y persistencia:** las preferencias offline se guardan fuera de los perfiles registrados. Los mundos no se borran al eliminar una entrada de la lista. El backend rechaza directorios raíz y carpetas que se superponen con instalaciones de cuentas registradas. Al cambiar el nickname cambia el perfil offline; para transferir instancias, exportá/importá un ZIP de VIS Worlds.

**Validación:** `python3 tools/check_vis_offline.py` comprueba los contratos del código en CI, y `cargo test --workspace --bins --lib --locked` incluye la prueba de persistencia y aislamiento en `accounts.rs`. Los tests fuente no sustituyen una sesión real de Minecraft.
