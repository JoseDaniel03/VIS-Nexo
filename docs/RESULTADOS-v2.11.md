# Pruebas VIS Nexo v2.11 — 10/11/2026

## Ejecutadas en esta entrega

- `npm run validate`: **pasa**. 43/43 comprobaciones históricas JS/recursos, `tsc --project types/tsconfig.json` pasa para el contrato TypeScript incremental (no para todo el JS legado) y puente de 38 comandos registrados / 36 usos UI pasa.
- `npm run check:release`: **pasa**. Once invariantes estáticas nuevas de seguridad del instalador, Modrinth y compatibilidad.
- `python3 tools/check_vis210.py`: **pasa**. Diez invariantes de algoritmos anteriores.
- `python3 tools/test_vis210.py`: **pasa**. Chromium 880/1366: duplicación, filtrado de versiones, paginación chat.
- `python3 tools/test_vis211.py`: **pasa**. Chromium 880/1366: gestión visible de estados activado/desactivado de mods.
- `python3 tools/test_vis29.py`: **pasa**. Chromium 880/1366: diagnóstico de crash y rutas escapadas.
- `python3 tools/test_vis28.py`: **pasa**. Chromium 880/1366: UI cloud, updater, marca y Portals.

## No ejecutadas (no se declara que pasen)

- `cargo check -p vslauncher-tauri --all-targets` y `cargo test --workspace`: no hay `cargo`/`rustc` y el contenedor no tiene acceso a los servidores de descarga del toolchain.
- Compilación Tauri Windows/Linux de instaladores: pendiente de CI en un repositorio autorizado.
- Prueba real de inicio de Minecraft y mods: pendiente en CachyOS y Windows.
- Benchmark RSS/CPU versus 2.10: pendiente de ejecutables nativos comparables.
- Servidor Ceibo/Humile y chat entre dos PCs: no desplegados.

## Siguiente validación recomendada

Ejecutar el workflow `VIS Nexo Native Build` en un repositorio GitHub autorizado. Ante un error del compilador, corregir el log y volver a ejecutar `cargo check`/`cargo test` antes de publicar paquetes como estables.
