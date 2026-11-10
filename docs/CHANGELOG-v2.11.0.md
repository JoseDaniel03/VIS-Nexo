# VIS Nexo 2.11.0 — Seguridad de instalación y gestión de mods

## Cambios funcionales

- Archivos parciales únicos, sin conflictos entre descargas simultáneas; atomicidad en reemplazo según plataforma y recuperación con respaldo en Windows.
- Protección contra escritura sobre enlaces simbólicos y carpetas mediante el gestor de descargas.
- Plan de descargas sin descartes silenciosos de hashes Maven conflictivos.
- Resolver Modrinth con fase de prevalidación, SHA-1 obligatorio y staging. Promoción en lote con restauración si falla una operación.
- Nueva operación Tauri `toggle_instance_file`, aplicada a `.jar` / `.zip` y variantes `.disabled`. El usuario puede activar/desactivar sin eliminar archivos.
- Lista de recursos solo enumera formatos admitidos y expone `enabled` al frontend.
- Detectar colisiones de rutas de instancias diferentes causadas por normalización del nombre.
- Workflows de compilación verifican las invariantes de 2.11 antes de `cargo check`/`cargo test`.

## Compatibilidad

Se preserva el identificador Tauri `com.virgoland.vslauncher` para no separar los datos antiguos. No se borran mundos, instancias, cuentas, chats ni mods existentes; se añade el campo `enabled` solo a respuestas transitorias de listados de archivos. Los archivos `.disabled` se reconocen y se pueden reactivar.

## Límites

No se instalaron ni probaron binarios Rust, ni se inició Minecraft en CachyOS/Windows. La integridad de código se revisó por tests estáticos y Chromium; se requiere ejecución de CI para descartar errores de tipado y linkado nativos.
