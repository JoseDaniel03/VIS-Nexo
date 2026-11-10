# VIS Nexo v2.16 — Hotfix Cargo (E0283 / E0502)

Este parche corrige los errores **reales** del log de Cargo aportado por el usuario.
No renombra la aplicación ni modifica las rutas de datos, instancias o cuentas.

## Cambios

1. `src-tauri/src/horizon.rs` (diagnóstico de JAR): se quita `.into()` de dos ramas `&str` del mismo `if`, para que el compilador infiera el tipo de forma unívoca al llamar a `check(..., detail: impl Into<String>)`. Corrige E0283.
2. `src-tauri/src/horizon_download.rs` (extracción ZIP): se clona el nombre del archivo ZIP en un `String` antes de tomar `&mut item` para extraerlo. Corrige E0502.
3. `src-tauri/src/horizon_download.rs`: se quita el `Response` importado sin usar y el `mut` innecesario de `small_file`.

## Comprobar en CachyOS

```bash
npm install
npm run validate
npm run check:release
cargo check --manifest-path src-tauri/Cargo.toml --all-targets
cargo test --workspace
npm run tauri dev
```

Si aparece `tauri: orden no encontrada`, realizar `npm install` dentro de la carpeta del proyecto. Si continúa, comprobar `node_modules/.bin/tauri` y volver a instalar las dependencias del proyecto. `npm run tauri dev` usa la CLI local incluida en `@tauri-apps/cli`.

## Validación en el entorno de preparación

- `npm run validate`: correcto (43/43 controles estáticos, TypeScript incremental y puente Tauri).
- `npm run check:release`: correcto.
- **Sin comprobación nativa de Rust**: el entorno de preparación no dispone de `cargo` ni `rustc`, así que la compilación real debe hacerse en CachyOS. No afirmar todavía que el juego arranca.
