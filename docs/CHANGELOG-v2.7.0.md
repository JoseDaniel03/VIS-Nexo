# VIS Nexo 2.7 — primera fase de infraestructura

Basado en VSLauncher 2.6, **sin rehacer el frontend**.

- Nombre visible VIS Nexo y versión 2.7, manteniendo identificador Tauri de la instalación antigua por compatibilidad.
- Botón de VIS Portals visible en la barra superior al lado de ajustes a todos los anchos de pantalla.
- Nueva pantalla VIS Maintenance en Configuración, disponible a cualquier cuenta local iniciada (no a invitados).
- Vista previa de limpieza y eliminación confirmada mediante comandos Rust.
- Mantenimiento restringido a cuatro carpetas descartables del directorio de datos de Tauri; nunca se recorren cuentas, chats, saves, mods, versiones, resource packs ni proyectos.
- Esquemas de DB Ceibo/Humile y procedimiento de retención manual (NO programado) como base de futura nube.
- Workflow de compilación Github Actions y nueva prueba Chromium v2.7.

**Aún pendiente**: compilar el backend Rust en una máquina con Cargo y dependencias Tauri, publicar Ceibo/Humile, conectar chat remoto, verificar arranque real Minecraft y generar/validar binarios de Windows y CachyOS.
