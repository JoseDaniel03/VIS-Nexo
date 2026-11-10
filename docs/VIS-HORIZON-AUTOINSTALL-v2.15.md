# VIS Nexo 2.15 — Horizon: instalación automática del juego (no del launcher)

## Función nueva

En VIS Worlds, crear o editar una instancia **Minecraft Rust Edition — Horizon** y pulsar **Descargar Minecraft Rust Edition (Horizon)**. VIS consulta `https://api.github.com/repos/horizon-rust/horizon/releases?per_page=100`, prioriza la Nightly publicada como `nightly`, consulta un release con el archivo apropiado al sistema (Linux x86-64: `horizon-linux-x86_64.tar.gz`; Windows x64: `horizon-windows-x64.zip`; Windows arm64: `horizon-windows-arm64.zip`) y descarga únicamente el juego.

**No** usa, descarga ni ejecuta `horizon-launcher`. Tampoco distribuye assets de Mojang; esos se preparan desde una copia legítima de Minecraft Java que posea el jugador.

## Verificación antes de ejecutar

1. Sólo URLs del repositorio oficial Horizon sobre HTTPS.
2. Verifica `SHA256SUMS.v2.sig` mediante Ed25519 y la clave pública de Horizon fijada en el código (`crates/horizon-release-sign/release-keys.txt` upstream, consultada el 10-11-2026).
3. Reconstruye la identidad firmada `nightly-<fecha>-<commit>` desde el título del release (no confía en la etiqueta mutable `nightly`).
4. Confirma que el SHA-256 del archivo completo coincide con la lista firmada.
5. Descomprime dentro de un directorio temporal con límites de tamaño, cantidad y profundidad; rechaza enlaces, traversal y archivos especiales.
6. Instala atómicamente bajo el directorio de datos de VIS: `horizon-builds/<nightly-fecha-commit>`. No sobrescribe builds previos, ni mundos, ni instancias.
7. Guarda el identificador de build exacto; VIS deja editar la carpeta manualmente si el usuario posee otro build compatible.

La firma es obligatoria. Si Horizon rota sus claves, actualiza sus convenciones de títulos o no publica la firma v2, VIS **fallará cerrado** hasta actualizar el adaptador. Los builds instalados localmente por el usuario son una opción manual separada y no cuentan como descargas verificadas por VIS.

## Flujo de instalación y juego

1. En CachyOS, compilar VIS (`npm install`, `cargo check --manifest-path src-tauri/Cargo.toml --all-targets`, `npm run tauri dev`).
2. En VIS Worlds crear instancia con motor Horizon (Minecraft 26.3).
3. Pulsar **Descargar Minecraft Rust Edition (Horizon)** y aceptar el release concreto. La barra inferior muestra el progreso.
4. Guardar la instancia para persistir su `horizon_build_dir`.
5. Elegir carpeta oficial de Minecraft Java 26.3, `server.jar` oficial y JDK 25 (si es necesario). Instalar/preparar y ejecutar el diagnóstico.
6. Para jugar, VIS actualmente requiere una sesión temporal Microsoft del propietario y la entrega al proceso `horizon-client` por stdin. VIS Ceibo aún **no integra OAuth Microsoft**; no se genera ni se simula un acceso premium.

## Pruebas y límites de esta entrega

- `npm run validate`: pruebas JS y contratos TS/puente Tauri.
- `npm run check:release`: revisiones anteriores + invariantes del instalador v2.15.
- `npm run test:ui:vis215`: Chromium con respuestas de comandos simuladas, sin descargar/ejecutar binarios.
- Se añadieron tests Rust en `horizon_download.rs`: título/tag, checksums, firma no válida y traversal.
- **No se pudo ejecutar `cargo check` ni `cargo test` en el entorno de preparación**, por no estar disponibles Cargo/Rustc; tampoco se descargó ni arrancó el juego real. La descarga firmada, el desempaquetado y la preparación deben comprobarse nativamente en CachyOS y Windows.

## Política de datos y compatibilidad

No cambia el `identifier` de Tauri (`com.virgoland.vslauncher`), ni el almacenamiento actual de cuentas y mundos. El directorio de juego (`.vis/horizon-resources`, partidas y logs) continúa aislado por instancia. La caché del cliente es compartida por build firmado para evitar descargas duplicadas, y nunca contiene mundos.
