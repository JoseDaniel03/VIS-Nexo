# VIS Nexo v2.14 — Integración de Horizon y diagnóstico nativo

## Cambios verificables en el código

- **Horizon sigue siendo el juego, no su launcher:** Rust ejecuta directamente `horizon-client` y `horizon-prepare` desde un build oficial seleccionado por el jugador.
- **Detectar builds de Horizon:** desde el editor de instancias, el botón "Detectar builds oficiales ya instalados" consulta únicamente `~/.local/share/horizon/releases/` (Linux) o `%LOCALAPPDATA%/Horizon/releases/` (Windows). Nunca descarga, inicia ni modifica binarios mediante la detección. Devuelve hasta 20 rutas de carpetas que contienen `horizon-client`, `horizon-prepare` y `research-lock.json`.
- **Diagnóstico previo:** el botón en Centro de Minecraft verifica carpeta del build, compatibilidad de Launch API 0.1.x, versión Minecraft fijada, recursos Java locales, servidor JAR, ruta JDK opcional y sello del preparador. El diagnóstico no obtiene ni lee sesiones Microsoft.
- **Control de compatibilidad:** cliente y preparador deben corresponder al mismo build, Minecraft y API; sus opciones se cotejan contra los `options` publicados por cada `--launch-api`.
- **Evitar preparación obsoleta:** el marcador nuevo guarda el SHA-256 de `research-lock.json`, versión de build, API, schema y output_version. Antes de jugar se ejecuta `horizon-prepare --check`. Marcadores v2.13 antiguos aún pueden leerse. Los mundos y mods no se borran.
- **Progreso sin retrocesos:** los mensajes JSON sin `fraction` no reinician el porcentaje, y se muestra la causa reportada por el preparador cuando falla.
- **Sesiones temporales:** el buffer de bytes se limpia también durante fallos; si no puede entregarse al proceso se termina el hijo. Continúa siendo un flujo de prueba avanzado, no OAuth implementado.
- **UI diferenciada:** el Centro de Minecraft no ofrece buscar mods JAR Fabric dentro de una instancia Horizon. Falta implementar un gestor compatible `.hmod`/`.hnmod`.

## Cómo probar en CachyOS

```bash
npm install
npm run validate
npm run check:release
cargo check -p vslauncher-tauri --all-targets
cargo test --workspace
npm run tauri dev
```

1. Abrí **VIS Worlds**, elegí una instancia Horizon o creá una nueva.
2. Usá **Detectar builds oficiales ya instalados**. Si no aparece ningún build, descargá el archivo del juego de los releases oficiales y elegí manualmente la carpeta extraída.
3. Completá Minecraft Java Edition 26.3 instalado, el JAR del servidor oficial de la misma versión y el JDK indicado por `horizon-prepare --launch-api`.
4. Guardá la instancia y abrí **Mods y archivos** → **Comprobar requisitos y recursos**.
5. Si los requisitos están listos y poseés Minecraft Java con una sesión Microsoft válida, elegí **Instalar/Reparar**, luego **Jugar**. El flujo de sesión temporal todavía es experimental.

**Nota:** la disponibilidad de un build firmado y su verificación no se resuelven automáticamente en esta versión. Horizon todavía documenta la localización de builds firmados como parte no estabilizada de su Launch API. Usá únicamente paquetes oficiales y verificá los archivos publicados antes de seleccionarlos en VIS.

## No implementado todavía

- Descarga/actualización automática con validación de firma Ed25519.
- Inicio de sesión Microsoft integrado en VIS Ceibo.
- Instalación de mods `.hmod` y compilación segura de `.hnmod`.
- Prueba real de ejecución del juego en Linux y Windows; **sin Cargo/Rustc en el entorno de entrega, las pruebas Rust aún no se ejecutaron**.

Fuentes de API: https://github.com/horizon-rust/horizon/blob/main/docs/api/launch.md y https://github.com/horizon-rust/horizon/blob/main/docs/api/launch-guide.md.
