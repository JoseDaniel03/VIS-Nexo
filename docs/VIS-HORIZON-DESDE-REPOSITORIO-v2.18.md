# VIS Nexo 2.18 — Minecraft Horizon compilado desde su repositorio

**Objetivo:** el usuario NO instala Horizon Launcher, Rust ni Cargo. Quienes compilan VIS
clonan el repositorio OFICIAL del juego Rust `https://github.com/horizon-rust/horizon.git`
y compilan exclusivamente `horizon-client` y `horizon-prepare` desde ese código.

## Primer build (desarrollador, Linux CachyOS)

Requiere Git, Rust estable >= 1.90, Python >=3.10, herramientas de C/C++,
headers ALSA (`alsa-lib` en Arch), udev (`systemd` en Arch), y las librerías
Tauri/WebKit habituales. Para preparar los recursos del juego se necesita un JDK 25:
VIS puede aprovisionarlo al instalar una instancia. No es necesario para *ejecutar*
el cliente Rust ya preparado.

```bash
npm install
npm run tauri dev
# o crear un instalador
npm run build -- --bundles appimage,deb --config src-tauri/tauri.unsigned.json
```

Tauri ejecuta `node tools/prepare_horizon.mjs build` ANTES de compilar/empaquetar la app.
Eso hace lo siguiente:

1. Clona el código de `horizon-rust/horizon` en `.vis-build-cache/horizon/source/`.
2. Resuelve el **commit exacto** con Git y lo reutiliza en compilaciones siguientes.
3. Compila con Cargo el juego y preparador en un **workspace separado** del Tauri.
4. Incorpora `horizon-client`, `horizon-prepare`, `research-lock.json`, la licencia
   y un manifiesto SHA-256 en `src-tauri/resources/horizon/`.
5. El empaquetado Tauri incluye esa carpeta y VIS verifica los ejecutables al usarlos.

La primera compilación puede tardar y consumir bastante disco, pero los builds
posteriores reutilizan el checkout, Cargo `target` y el manifiesto de huellas.
La variable `CARGO_BUILD_JOBS=2` limita por defecto el paralelismo al compilar Horizon.

## Modo reproductible y actualizaciones

Por defecto se usa la revisión `main` en el primer clonado y queda cacheada;
**no se actualiza silenciosamente** durante cada build. Para avanzar a una revisión
más reciente ejecutá `npm run horizon:update` y después recompilá VIS.

Para seleccionar explícitamente un commit oficial:

```bash
VIS_HORIZON_REF=<SHA_COMPLETO_DE_40_CARACTERES> npm run horizon:source
```

En las releases firmadas para Windows/Linux, GitHub Actions requiere la variable
`VIS_HORIZON_COMMIT` con un SHA completo, así ambos instaladores incluyen el
mismo código y no dos revisiones distintas de `main`.

También podés trabajar con un checkout que ya tengas:

```bash
VIS_HORIZON_SOURCE_DIR=/ruta/al/horizon npm run horizon:source
```

`npm run horizon:verify` valida que los ejecutables empaquetados coincidan con
sus SHA-256. El manifiesto permite rastrear el commit de código fuente exacto.

## VIS Worlds

Una instancia nueva usa el ID especial `vis:source`: VIS busca el cliente Rust
incluido en sus recursos, sin consultar GitHub Releases en tiempo de uso. El
administrador configura el motor, versión y modloader del proyecto; los usuarios
normales eligen la carpeta y RAM, como antes. Las instalaciones externas
anteriores pueden seguir con su carpeta manual para preservar compatibilidad,
pero las nuevas usan el binario compilado con VIS.

El repositorio Horizon **no incluye Minecraft ni sus assets de Mojang**. La primera
instalación sigue necesitando un propietario de Minecraft: Java Edition 26.3,
los archivos oficiales (cliente y servidor) y su preparación con JDK 25.
La autenticación Microsoft integrada de VIS sigue pendiente: **no afirmar que el
juego está listo para ejecutarse con cuentas de VIS por sí solas**.

## Alcance y pruebas

- `python3 tools/check_vis218.py`: contratos estáticos.
- `python3 tools/test_horizon_from_source.py`: simula un repositorio local y
  salida de Cargo para probar empaquetado, caché y SHA-256 sin una red externa.
- `cargo check -p vslauncher-tauri --all-targets && cargo test --workspace`:
  compilación real en una computadora con Rust.
- Pruebas finales de cliente/servidor/licencia/recursos en Linux y Windows:
  necesarias antes de declarar la integración jugable.

**Este ZIP contiene código VIS, NO una copia del repositorio Horizon ni los
binarios nativos generados**. Se obtienen y compilan automáticamente al construir VIS.
No subas `src-tauri/resources/horizon` compilado ni `.vis-build-cache` a Git;
no publiques `Minecraft` JARs ni assets propietarios.
