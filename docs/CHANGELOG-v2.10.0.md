# VIS Nexo 2.10.0 — Worlds, mods y rendimiento

- Rust: SHA-1 de caché por streaming y checks de tamaño/validez antes de reutilizar.
- Rust: descargas en paralelo limitadas a 4 y adaptadas a CPU.
- Rust: memoización TTL de versiones Mojang/Fabric; selector de todas las releases + 60 snapshots recientes.
- Rust: resolver Modrinth en dos fases, ordenación topológica, fallos de ciclos, pins conflictivos e incompatibilidad Fabric.
- Rust/Tauri: proceso Minecraft, importación/eliminación/lista de recursos y mantenimiento en tareas separadas del UI/estado bloqueado.
- UI: filtro de canal de versiones y búsqueda de releases históricas con máximo 100 elementos del datalist.
- UI: duplicar configuración de instancia sin tocar carpetas de datos existentes.
- UI: mostrar chats de 100 en 100 mensajes.
- Tests: unit tests de hashing y topología (Rust no ejecutados sin compilador), fuente/contratos JS y Chromium.

**Estado:** el código Rust NO se compiló ni el juego se probó nativamente en este entorno. El launcher sigue en desarrollo y Ceibo/Humile no están desplegados.
