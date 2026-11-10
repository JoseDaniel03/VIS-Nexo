# VIS Nexo 2.9 — Resultados de esta entrega

## Ejecutadas y aprobadas

- `npm run validate`: 43 comprobaciones históricas, sintaxis JS, contrato TypeScript estricto incremental y consistencia de 37 comandos Tauri registrados con 35 referencias directas identificadas en JavaScript.
- Validación de versiones en `Cargo.toml` raíz, `src-tauri/Cargo.toml`, `package.json` y `src-tauri/tauri.conf.json` (2.9.0).
- Catálogo de Universe: test de SHA-256 y privacidad de rutas internas (`tools/test_cloud_release.py`).
- Chromium: UI general a 880, 1024, 1366 y 1920 píxeles; Minecraft, Modrinth, editor de proyectos, personalización, modo offline y panel social.
- Chromium: `tools/test_vis28.py` (Universe, updater y Portals); `tools/test_vis29.py` (diagnóstico de crash, cierre y escape HTML).
- Archivos GitHub Actions: YAML interpretado por PyYAML y comandos ampliados a `cargo check --all-targets` + `cargo test --workspace`.

## No ejecutadas / pendientes de validación en runner nativo

- Rust compiler: faltan `rustc`, `cargo` y dependencias de WebKit en este entorno. No se pudo ejecutar `cargo check`, `cargo test` ni construir `.exe` o AppImage. Los tests CI se declararon, pero no se ejecutaron en GitHub Actions.
- No se ha lanzado Minecraft real. No afirmar que la descarga completa o Java Temurin funcionan en un PC hasta una prueba nativa de punta a punta.
- No hay servidores Ceibo/Humile desplegados: el chat y las cuentas todavía son locales.
- La versión 3.0 estable, Microsoft OAuth y proyectos instalables directamente desde catálogo continúan pendientes.
- El `web/app.js` heredado (JS dinámico) todavía no supera una comprobación TypeScript estricta global; el nuevo contrato `types/vis-commands.ts` sí pasa. No se han silenciado globalmente los diagnósticos del código legado.

## Comandos recomendados en CachyOS

```bash
npm install
npm run validate
cargo check --workspace --all-targets
cargo test --workspace
npm run build -- --bundles appimage,deb --config src-tauri/tauri.unsigned.json
```

En Windows compilar con `--bundles nsis` y dependencias de WebView2. Las claves privadas de Tauri Updater deben permanecer fuera del ZIP y del repositorio.
