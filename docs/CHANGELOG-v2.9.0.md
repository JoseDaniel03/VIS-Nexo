# VIS Nexo v2.9.0 — Calidad, diagnósticos y contratos

- Corrige versiones dispares (workspace, Tauri, npm) y deja una prueba automática de consistencia y puente JS/Rust.
- Compilaciones CI verifican `cargo check --all-targets` y `cargo test --workspace` en Windows y Linux antes del empaquetado.
- Tipos TypeScript estrictos incrementales en `types/vis-commands.ts`; el `app.js` heredado todavía no está completamente tipado.
- Minecraft: descargas grandes con 600 segundos de timeout y conexión de 20 segundos; evita el corte total de 60 segundos.
- Minecraft: rechaza hashes SHA-1 mal formados en assets y segmentos de versión no seguros, guarda metadatos con escritura atómica.
- Minecraft: espera la salida del proceso Java en un hilo independiente, avisa del estado final y expone el log cuando falla.
- VIS Universe: catálogos rechazan identificadores duplicados y versiones inválidas antes de descargarse.
- UI: panel de diagnóstico tras un crash de Minecraft; no borra instancias ni mundos.
- La release manual en CI solo se ejecuta cuando existe un tag `nexo-v*`.

## Verificaciones pendientes

No hay Cargo/Rustc en el entorno que generó este ZIP. Las verificaciones estáticas no pueden garantizar que compile el backend nativo. Ejecutar en un runner con Rust:

```bash
npm install
npm run validate
cargo check -p vslauncher-tauri --all-targets
cargo test --workspace
npm run build -- --bundles appimage,deb --config src-tauri/tauri.unsigned.json
```

En Windows reemplazar bundles por `nsis`. Sin OAuth Microsoft, Minecraft solo funciona en modo local/offline y no permite acceso a servidores premium. Ceibo y Humile cloud siguen pendientes.
