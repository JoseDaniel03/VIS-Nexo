# VIS Nexo 2.18 — Horizon compilado desde el repositorio Rust oficial

## Verificación local — 10 de noviembre de 2026

Corregidos los errores E0308/E0599 en `bundled_source_path`: la resolución de la carpeta y la verificación de integridad se realizan por separado.

Verificado en Linux: `cargo check --workspace --all-targets --offline`, `cargo test --workspace --offline` (53 pruebas), `npm run validate`, `npm run check:release` y `npm run build -- --no-bundle --config src-tauri/tauri.unsigned.json`. Se generó el ejecutable de producción `target/release/vslauncher-tauri`; la preparación reutilizó y verificó Horizon compilado del commit `1405044d0996`.

Prueba real adicional: Minecraft Java Vanilla 1.21.1 se instaló mediante las funciones de producción de `minecraft.rs` y llegó al menú principal, confirmado por el usuario. Los registros muestran carga de texturas e inicio del motor de sonido. Se usó el perfil local `VisTest`, 2 GiB de RAM y la carpeta aislada `.vis-smoke-test/`, sin crear mundos ni modificar perfiles existentes. El diagnóstico se puede repetir con `cargo run -p vslauncher-tauri --example minecraft_smoke`; requiere escritorio y conexión a los servidores de descarga. La prueba no recorre los botones del launcher. Cerrar Minecraft finaliza el diagnóstico.

Prueba real de Horizon: la instancia `HorizonSmoke` (Minecraft 26.3) descargó sus recursos oficiales, completó `horizon-prepare --complete` y pasó `--check`. El cliente Rust inició con gráficos y sonido y el usuario confirmó que el juego se veía correctamente, sin el aviso de recursos faltantes. Se usaron las funciones nativas de instalación/preparación de VIS y el cliente del juego directamente, sin Horizon Launcher ni sesiones ficticias. La instancia está en `.vis-smoke-test/minecraft-instances/VisTest/smoke-test/HorizonSmoke/`. El diagnóstico reproducible es `cargo run -p vslauncher-tauri --example horizon_smoke`; usa el modo local del cliente, no la autenticación Microsoft del launcher.

Correcciones de esta prueba: conservar el manifiesto exacto fijado en `research-lock.json` y su índice de recursos, incluir los exportadores Java de Horizon en el paquete, reutilizar un JDK 25 completo existente y escribir la caché de preparación dentro de la instancia. En este equipo se usó `/usr/lib/jvm/java-25-openjdk`. El descargador de Temurin acepta enlaces relativos internos de su TAR y sigue rechazando destinos absolutos o que escapen de la raíz del JDK.

### Crear y jugar desde VIS Nexo

Las instalaciones nuevas requieren elegir una carpeta. Los archivos de Minecraft se guardan dentro de ella: mundos, mods, opciones y logs; bibliotecas/assets en `.vis/runtime` (o `.vis/minecraft-base` para Horizon); Java privado en `.vis/java-runtimes` del runtime base; motor Rust en `.vis/horizon-engine`; recursos preparados y caché del preparador en `.vis/horizon-resources` y `.vis/horizon-preparation`. El proceso del juego recibe rutas de caché y temporales dentro de la instancia, también para APPDATA/LOCALAPPDATA en Windows. VIS conserva sus cuentas, catálogo y referencias de instancias en sus propios datos de aplicación; esta opción no convierte todo el launcher en una aplicación portable.

Instalar/Reparar una instancia existente incorpora el motor fuente y Java privados sin borrar los mundos. Las partidas de perfiles visitantes que estaban en `shared-player-data` se copian a `.vis/players` al usarse; se conserva el original. Las instancias antiguas siguen teniendo compatibilidad de lectura con sus rutas anteriores hasta repararlas. Una copia de la configuración de la instancia se escribe en `.vis/instance.json` tras instalar desde VIS. Mover una carpeta entre equipos puede requerir volver a registrarla/repararla: las referencias del launcher aún usan rutas absolutas.

Verificado en la ventana nativa: se reparó `Rust desde VIS` y se pulsó Jugar. La instancia `.vis-smoke-test/Desde-VIS-Rust` quedó instalada con las rutas de Java, motor, Minecraft base y server JAR dentro de su carpeta. El Java privado 25.0.5 inició correctamente, `horizon-prepare --check` devolvió 0 y el cliente cargó gráficos, sonido y generación de mundo. La inspección de `.vis` no encontró enlaces simbólicos hacia fuera de la instancia; caché y temporales locales estaban presentes.

Iniciá sesión con tu cuenta local, abrí Instancias y creá una nueva. Seleccioná **Minecraft Rust Edition — Horizon**, elegí la carpeta del juego y pulsá **Crear, instalar y jugar**. VIS fija Minecraft 26.3 y su motor, guarda la instancia y prepara los recursos oficiales automáticamente. También podés guardar primero y usar **Instalar** y luego **Jugar** en su tarjeta. Las rutas manuales del motor y de Minecraft quedan en opciones avanzadas.

Jugar utiliza el modo local nativo de Horizon, sin pedir un archivo de sesión Microsoft. La integración Microsoft y el acceso a servidores que exigen autenticación oficial siguen pendientes. Se conserva la vía de sesión temporal para clientes que invoquen explícitamente esa opción. Las pruebas de interfaz verifican selección de carpeta y secuencia guardar → instalar → jugar en 880 y 1366 px con backend simulado; no equivalen a manejar la ventana nativa.

Prueba nativa posterior: se inició sesión con una cuenta administradora local en la ventana real de VIS, se creó `Rust desde VIS`, se escribió la carpeta `.vis-smoke-test/Desde-VIS-Rust` en el formulario, se pulsaron Guardar, Instalar y Jugar, y los comandos se ejecutaron contra Rust sin mocks. La instancia quedó persistida como instalada. `horizon-launch.log` confirmó gráficos, sonido, 35.723 estados de bloques, 1.658 objetos y 67 biomas cargados. Esta prueba usó la entrada de ruta del formulario; no automatizó el selector de carpetas del sistema operativo. El controlador temporal de prueba y las credenciales se retiraron del código y de los archivos temporales al finalizar.

Esto actualiza las notas históricas de compilación pendiente que aparecen más abajo. No se verificaron instaladores, Windows ni Microsoft OAuth. Persisten advertencias de código sin uso, principalmente del instalador antiguo de Nightlies; la biblioteca de builds antiguos aún utiliza parte de ese módulo.

Limpieza: las capturas `preview-*.png` son resultados regenerables de pruebas y se excluyen del fuente; la copia original y el hotfix 2.11 se conservan en `docs/history/`. `legacy/crates/vsui-core` continúa siendo una dependencia activa.

---

Esta revisión configura VIS Nexo para clonar automáticamente el repositorio **horizon-rust/horizon** al iniciar la compilación del launcher, compilar el juego (`horizon-client`) y el preparador (`horizon-prepare`) como un workspace Rust independiente y empaquetarlos dentro de VIS. **No utiliza Horizon Launcher ni descarga una Nightly precompilada para nuevas instalaciones.**

La primera compilación requiere conexión, Git, Python 3.10+, Rust 1.90+, cabeceras nativas y espacio disponible. En la computadora del jugador **no se necesita instalar Rust/Cargo**. Minecraft y sus recursos no están incluidos: requieren la copia legítima y los requisitos de Microsoft de Horizon.

```bash
npm install
npm run tauri dev
# o para el instalador Linux:
npm run build -- --bundles appimage,deb --config src-tauri/tauri.unsigned.json
```

Más detalles en `docs/VIS-HORIZON-DESDE-REPOSITORIO-v2.18.md`. El juego real aún requiere compilación y validación nativa en CachyOS/Windows; el ZIP adjunto es solo fuente VIS con automatización.

---

# VIS Nexo 2.17 — Universe → Worlds y motor Horizon

> **Código fuente.** No se ha compilado nativamente con Cargo ni se ha probado Minecraft en este entorno.

## Cambios 2.17

- VIS STUDIOS configura motor/versión/loader en el proyecto. Proyectos nuevos habilitan el juego por defecto, salvo bloqueo explícito.
- Jugador: «Instalar y jugar» abre únicamente selector de carpeta y RAM, y crea la instancia con parámetros admin mediante `ensure_project_instance` en Rust.
- Usuarios locales y sesión offline ven las instalaciones verificadas de otros perfiles VIS dentro del **mismo usuario del sistema operativo**; los mundos/opciones/logs de invitados permanecen separados. No se comparten sesiones, contraseñas ni tokens.
- Horizon: instalación del cliente Rust del juego (sin Horizon Launcher), preparación de Minecraft 26.3 oficial y JDK 25 Temurin desde VIS, además de selección de build si ya existe.
- Se mantiene la configuración Microsoft por sesión temporal: Ceibo OAuth no está integrado. Horizon requiere Minecraft Java adquirido legítimamente.
- Nuevas instancias usan la carpeta escogida con su propio runtime; instancias anteriores no se migran ni borran.

## Probar en CachyOS

```sh
npm install
npm run validate
cargo check --manifest-path src-tauri/Cargo.toml --all-targets
cargo test --workspace
npm run tauri dev
```

Los nuevos campos del JSON de proyectos tienen valores por defecto y no cambian el identificador Tauri heredado. Lee `docs/VIS-UNIVERSE-WORLDS-v2.17.md` para limitaciones y migración.

# VIS Nexo 2.16 — Biblioteca de Horizon e integridad

- **Biblioteca local de Nightlies del JUEGO Horizon:** opción **Ver builds instalados** en VIS Worlds. Permite seleccionar una versión específica, volver a un build anterior sin volver a descargarlo y conservar las carpetas de cada instancia.
- **Verificación de archivos tras instalar:** guarda huellas SHA-256 del cliente (`horizon-client`), preparador (`horizon-prepare`) y `research-lock.json`. Antes de preparar/iniciar el juego comprueba estas huellas. Si los archivos cambiaron, bloquea ese build e indica que debe reinstalarse, sin borrar partidas.
- **Compatibilidad:** los builds de VIS 2.15 que no tenían estas huellas se muestran como *Anterior* y no como verificados. Los builds externos piden confirmación; los que están incompletos o modificados no pueden seleccionarse desde la biblioteca.
- **Estabilidad:** consulta `--launch-api` con límite de salida de 1 MiB y espera máxima de 12 segundos para evitar que un ejecutable defectuoso bloquee el diagnóstico o consuma memoria ilimitada.
- **Rendimiento:** biblioteca limitada a las carpetas administradas por VIS; cálculo SHA-256 en streaming de 64 KiB y tareas fuera del hilo de interfaz.
- **Se mantienen cuentas, mundos, instancias y rutas técnicas** de versiones anteriores. No se instala Horizon Launcher.

Validaciones ejecutadas: `npm run validate`, `npm run check:release`, `npm run test:ui:vis216` y regresión de interfaz 2.15. **No se compiló Rust con Cargo ni se ejecutó Horizon real en este entorno**. Las huellas locales detectan cambios accidentales, pero no reemplazan la firma del release original ni protegen frente a un atacante que pueda modificar también los metadatos locales.

Leer `docs/VIS-HORIZON-BIBLIOTECA-v2.16.md` para pruebas y uso.

---

# VIS Nexo 2.15 — Horizon Signed Game Installer

Se agregó instalación automática del **juego Horizon** (`horizon-client` + `horizon-prepare`, NO Horizon Launcher) con firma Ed25519, SHA-256, selección de la Nightly exacta, extracción limitada, barra de progreso y builds separados. Ver `docs/VIS-HORIZON-AUTOINSTALL-v2.15.md`.

**Estado:** fuente sin compilación Rust nativa ni inicio del juego verificados. Se mantienen las cuentas, instancias y los mundos existentes.

# VIS Nexo 2.14 — Diagnóstico Horizon y compatibilidad de builds

**Nueva entrega de código fuente** sobre VIS Nexo v2.13; preserva cuentas, mundos, bibliotecas y el identificador técnico de Tauri.

- Detecta builds del **juego Horizon** instalados en rutas oficiales Linux/Windows, sin usar ni descargar Horizon Launcher.
- Diagnóstico interactivo de cliente/preparador, versión, Java, Minecraft original y recursos preparados.
- Exige coincidencia de API y versiones entre los ejecutables, guarda hash del `research-lock.json` para detectar cambios y consulta `--check` antes de jugar.
- Mantiene el avance de preparación de Horizon monotónico; los mensajes de progreso incompletos no regresan la barra al 0 %.
- No presenta erróneamente los mods Java/Modrinth como compatibles con Horizon.
- Añade pruebas de interfaz/mocks, invariantes de código y pruebas unitarias Rust (para ejecutarse con Cargo en CachyOS/CI).

Consultar `docs/VIS-HORIZON-DIAGNOSTICO-v2.14.md`.

**Limitaciones:** esta entrega no contiene Horizon, no lo descarga automáticamente, no tiene OAuth Microsoft completo, no está compilada ni se ha probado el inicio real del juego. Requiere verificar el build y una cuenta Microsoft que posea Minecraft Java Edition.

---

# VIS Nexo 2.13 — Horizon Rust Edition + instancias offline compartidas

## Nuevo en esta versión

- **Horizon como motor del juego**: nuevo selector en VIS Worlds, importación manual del build oficial del cliente Rust, prueba de Launch API 0.1.x, preparación de recursos desde una copia legítima de Minecraft 26.3 y lanzamiento directo de `horizon-client` sin abrir el launcher de Horizon.
- **Instancias offline compartidas por perfiles**: opt-in del propietario para compartir su instancia Java administrada por VIS; el usuario invitado ve las instancias habilitadas e inicia el juego con partidas y configuraciones en carpeta separada, sin escribir los mundos originales.
- **Compatibilidad**: se conservan todas las instancias anteriores (campo `engine` ausente se interpreta `java`), el identificador interno de Tauri y las cuentas existentes. Horizon no admite aquí el modo offline ni los mods Fabric.
- **Limitaciones**: VIS Ceibo Microsoft OAuth aún está pendiente. Para la prueba avanzada de Horizon se necesita una sesión Microsoft válida **temporal**, pasada mediante un archivo JSON de un solo uso y eliminada tras entregar los datos al proceso por stdin. Tampoco hay descarga automática de builds hasta poder verificar firmas oficiales.

Guía detallada: `docs/VIS-HORIZON-OFFLINE-v2.13.md`.

**Estado:** validaciones estáticas y UI aprobadas. Sin Cargo/Rustc en este entorno, no se ha compilado Rust ni se ha ejecutado Minecraft/Horizon. Este ZIP contiene **código fuente, no un instalador listo para jugar**.

---

# VIS Nexo 2.12 — Smart Install, Worlds Portable y VIS Ceibo local

## Novedades de esta entrega

- **VIS Smart Install**: reutiliza por copia verificada (SHA-1) las bibliotecas, JARs y assets de Minecraft ya presentes en otros perfiles o launchers de la misma PC; descarga lo que falta.
- **Runtime privado para instancias nuevas** dentro de `.vis/runtime/`; las anteriores siguen siendo compatibles sin mover ni borrar archivos automáticamente.
- **VIS Worlds Portable**: importar/exportar perfiles VIS mediante ZIP, con protección de rutas y extracción segura.
- **Indicador inferior de descargas** con nombre de etapa, porcentaje de archivos de esa etapa y último recurso.
- **VIS STUDIOS**: script independiente para crear la cuenta administradora **local** con contraseña Argon2id, sin incrustar una clave en el binario público.

Documentación nueva: `docs/SMART-INSTALL-PORTABLE-v2.12.md` y `docs/VIS-CEIBO-ADMIN-LOCAL.md`.

**Verificación:** `npm run validate`, `npm run check:release`, `python tools/test_vis212.py` y `python tools/test_vis_admin_local.py`. **Pendiente:** `cargo check`, `cargo test`, compilación Windows/Linux y lanzamiento real de Minecraft; no hay compilador Rust disponible en este entorno.

---

# VIS Nexo 2.11 — Descargas seguras, mods e instancias

Código fuente **Tauri 2 + Rust** actualizado sobre la versión 2.10, conservando proyectos, perfiles locales e instancias previas. Esta entrega conserva la distribución en la nube y añade controles de consistencia, tipos TypeScript incrementales y diagnóstico de cierres de Minecraft.

## Novedades 2.11

- **Descargas resilientes:** cada operación usa un archivo parcial único; se verifica el SHA-1 antes de publicar el resultado y se evita sobrescribir enlaces simbólicos. Los reemplazos usan renombrado atómico en Linux o copia recuperable en Windows.
- **Bibliotecas:** se rechazan colisiones de Maven si dos metadatos asignan checksums incompatibles al mismo archivo. Esto evita escoger una variante arbitraria.
- **Mods Modrinth:** todas las dependencias se resuelven antes de descargar; los nuevos archivos se preparan en una carpeta temporal y se integran como lote reversible. Si falla un checksum, descarga o promoción, los mods existentes se conservan.
- **Gestión de mods:** botón para activar/desactivar mods, resource packs y shaders por instancia mediante renombrado `.jar.disabled`/`.zip.disabled`, sin borrar archivos.
- **Instancias:** se rechazan dos perfiles con nombres distintos que resuelven a una misma carpeta local normalizada (por ejemplo, `A B` y `A-B`).
- **Pruebas:** 11 invariantes de seguridad, nuevos tests de interfaz 880/1366 px y tests unitarios Rust nuevos para verificación nativa posterior. Comandos JS/Tauri sincronizados.

Consultar `docs/CHANGELOG-v2.11.0.md` y `docs/RESULTADOS-v2.11.md`. **Cargo/Rustc no están disponibles aquí, así que las pruebas unitarias Rust y la ejecución de Minecraft siguen pendientes.**

## Base de rendimiento 2.10

- Comprobación SHA-1 de archivos existentes **en streaming**, sin leer JARs gigantes enteros a memoria.
- Descargas concurrentes adaptadas a los núcleos disponibles: máximo 4 operaciones simultáneas por lote, en vez de 8 fijas.
- Cachés de catálogo Mojang y Fabric durante diez minutos; acceso a versiones antiguas estables y las últimas 60 snapshots, con un máximo de 100 sugerencias DOM visibles.
- Duplicación de perfiles de Minecraft sin copiar ni alterar partidas, mods o mundos originales. Los archivos compartidos de runtime ya se reutilizan entre instancias.
- Resolución del grafo de mods Modrinth, detección de ciclos/conflictos y **ordenación topológica de Kahn** para descargar dependencias antes del mod principal.
- Inicio de Minecraft, importación y eliminación de archivos y VIS Maintenance movidos fuera del estado bloqueado del backend para evitar congelar la aplicación.
- Ventana de chat paginada: 100 mensajes recientes, con opción de ver anteriores.
- Pruebas adicionales de UI, invariantes y unit tests Rust (estos últimos requieren compilación nativa).

Consultar además `docs/RENDIMIENTO-Y-ALGORITMOS-v2.10.md`.

## Funcionalidad heredada

- **Marca:** VIS Nexo, VIS Universe, VIS Portals, VIS Worlds. Sin etiquetas visibles del nombre antiguo. Se mantiene el identificador técnico heredado durante la migración para **no perder datos**.
- **Minecraft:** crear instancia y elegir «Crear, instalar y jugar», con Vanilla/Fabric, Mojang, Modrinth y aprovisionamiento de Java Temurin si falta. El motor fue ampliado, pero no se ejecutó una compilación nativa ni una partida real en este entorno.
- **VIS Universe / Nube:** galería de catálogos remotos JSON públicos, opción de configurar URL en el panel admin, y descarga de paquetes ZIP verificados con SHA-256 a un directorio aislado. Los ZIP no se instalan ni ejecutan automáticamente en esta etapa.
- **VIS Nexo / actualizaciones:** comprobación al inicio y botón para instalar actualizaciones firmadas con Tauri Updater. Requiere configurar clave pública y una URL HTTPS al compilar una release. No se instaló ni publicó un repositorio remoto en esta entrega.
- **VIS Portals:** cabecera rediseñada, buscador de contactos, fechas del historial y acceso directo junto a Configuración. El chat actual **todavía es local**; la sincronización entre computadoras requiere terminar VIS Ceibo y Humile.
- **Datos:** AppData estable, copia de las preferencias antes de actualizar y mantenimiento seguro. Las actualizaciones de la aplicación no eliminan archivos de Minecraft, mods, mundos o imágenes importadas.

## Descargas y pruebas

Este ZIP es **código fuente, no un instalador compilado**. El entorno de entrega no cuenta con Cargo ni Rustc. Se han verificado JavaScript, el contrato TypeScript incremental, los enlaces de comandos JS/Rust, comprobaciones estáticas y la interfaz en Chromium; compilar y ejecutar Minecraft requiere pruebas adicionales en Linux/Windows.

```bash
npm install
npm run validate
npm run check:release
python3 tools/test_vis211.py  # requiere Playwright/Chromium
cargo check -p vslauncher-tauri --all-targets
cargo test --workspace
npm run dev
```

Para generar instaladores locales **sin updater** (no hacen falta claves de firma):

```bash
npm run build -- --config src-tauri/tauri.unsigned.json
```

Los workflows `.github/workflows/vis-nexo-build.yml` y `.github/workflows/vis-release.yml` están preparados para compilar Linux/Windows en GitHub Actions al copiar este fuente a un repositorio y configurar las variables/secretos adecuados. Los trabajos no han sido ejecutados ni verificados en esta entrega.

**Documentación principal:**

- `docs/GUIA-NUBE-Y-ACTUALIZACIONES.md`: paso a paso para GitHub Pages, GitHub Releases, R2 y Tauri Updater.
- `docs/CHANGELOG-v2.11.0.md`: descargas y mods seguros (versión actual).
- `docs/RESULTADOS-v2.11.md`: alcance real de las pruebas.
- `docs/CHANGELOG-v2.10.0.md`: mejoras de rendimiento de la versión anterior.
- `docs/CHANGELOG-v2.9.0.md`: auditoría técnica previa.
- `docs/CHANGELOG-v2.8.0.md`: entrega anterior.
- `docs/VIS-3.0-PLAN-AND-RETENTION.md`: ruta hacia Ceibo/Humile cloud y mantenimiento.
- `distribution/projects.example.json`: definición de un proyecto publicable.
- `tools/create_catalog.py`: genera un catálogo público con tamaño y SHA-256 de los paquetes.

## Compatibilidad

No cambiar aún el identificador de aplicación existente ni el nombre técnico del ejecutable Rust sin una migración verificada. Es deliberado que las rutas internas puedan conservar sus identificadores históricos: cambiar la marca visual no debe borrar los datos existentes. El login Microsoft y el chat remoto no están listos y deben probarse antes de presentar VIS Nexo 3.0 como estable.

## Revisión 2.9 — pruebas y advertencias

- `npm run validate`: JavaScript, 43 chequeos estáticos, contrato TypeScript estricto, 37 comandos Tauri registrados y versiones sincronizadas.
- `python3 tools/test_vis29.py`: aviso de crash sin inyección HTML y cierre del diagnóstico.
- `python3 tools/test_vis28.py`: Portals, Universe y actualización (interfaz).
- `cargo check`/`cargo test`: **aún no ejecutables en este entorno**. Los workflows intentarán correr ambas pruebas por SO antes de empaquetar.
- TypeScript `checkJs` global sobre la UI legada aún señala tipos DOM inferidos incorrectamente: la migración de la totalidad de `app.js` a tipos estrictos se hará gradualmente, sin introducir falsos casts globales.

**Importante:** este ZIP no constituye un instalador jugable verificado ni sincroniza amistades en internet.
