# VIS Nexo v2.8.0 — Proyectos públicos, actualizaciones y arranque Minecraft

> Primera implementación de estas funciones. **Sin compilación Rust/instaladores verificados en este entorno.** La publicación de actualizaciones y proyectos requiere configurar el repositorio.

- Se reemplazaron referencias visibles a la marca anterior por **VIS Nexo**, **VIS Portals** y **VIS Universe**. El identificador técnico `com.virgoland.vslauncher` y carpetas de datos heredadas permanecen para no perder perfiles/instancias.
- Panel social mejorado: cabecera Portals, buscador local de contactos, feedback y fecha de los mensajes. **Todavía NO es un chat entre equipos**: backend social local pendiente de Ceibo/Humile cloud.
- **VIS Universe / Nube**: catálogo JSON público desde GitHub Pages o R2 vía HTTPS. Se valida formato, dominio, tamaño y SHA-256 del ZIP descargado. Descargas aisladas en `project-packages`, sin ejecutar ni descomprimir el contenido automáticamente.
- **VIS Nexo / updater**: integración Rust de Tauri updater; comprobación de versiones al abrir y actualización manual confirmada, con firma Ed25519 obligatoria. Solo se activa en builds con `VIS_UPDATER_PUBKEY` y `VIS_UPDATE_MANIFEST_URL` HTTPS.
- Copia local de preferencias previa a instalar la actualización (sin duplicar contraseñas/hashes). Identificador y directorio de datos invariantes, sin borrar mundos, assets o instancias.
- **VIS Worlds**: se añadió botón «Crear, instalar y jugar», versión estable sugerida del catálogo Mojang y aprovisionamiento de Java Temurin JRE si no hay Java compatible. Paquetes Temurin descargados y verificados por SHA-256, Java sin privilegios ni instalación global. Compatible con Linux/Windows en arquitecturas soportadas cuando el proveedor ofrece el runtime.
- GitHub Actions: pruebas y builds unsigned; workflow adicional para publicar releases firmadas en Linux/Windows con `latest.json`.
- Script `tools/create_catalog.py` para calcular hashes y tamaños de ZIPs publicados.

## Límites

- No se configuró una URL pública ni un repositorio nuevo, no se publicaron releases ni se desplegó ningún servidor.
- El launcher Java existente usa nicks de sesión local/offline; para multijugador autenticado/premium necesita OAuth Microsoft (pendiente).
- El catálogo remoto descarga y verifica paquetes, **no realiza una instalación automática de proyectos dentro de Minecraft**.
- El motor Minecraft Rust no pudo compilarse ni probarse ejecutando el juego en este entorno. Considerar su funcionamiento real **pendiente de pruebas**.
