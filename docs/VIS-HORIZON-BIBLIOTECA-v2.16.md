# VIS Nexo v2.16 — Biblioteca, versiones fijadas y verificación de Horizon

## Alcance

Esta versión sigue integrando el **juego** `horizon-client` y `horizon-prepare` directamente. **No instala ni ejecuta Horizon Launcher**. Mantiene Java/Fabric y las rutas de los mundos independientes.

### Flujo para jugar o volver a una Nightly anterior

1. Abrir **VIS Worlds** y editar o crear una instancia con motor **Minecraft Rust Edition — Horizon**.
2. Pulsar **Ver builds instalados**. VIS muestra Nightlies descargadas dentro de su propio directorio `horizon-builds/` y las rutas de builds existentes que detecta de forma acotada.
3. **Verificado** indica que los hashes SHA-256 locales de `horizon-client`, `horizon-prepare` y `research-lock.json` coinciden con los generados al instalar ese build desde un paquete cuya firma fue validada.
4. **Anterior** indica un build sin ese nuevo manifiesto (compatible con instalaciones de VIS 2.15). **Externo** indica un build fuera de VIS; ambos requieren confirmación manual y no se describen como verificados.
5. **Modificado / Incompleto** no se puede escoger desde la biblioteca. Reinstalar el juego desde una Nightly firmada sin borrar la carpeta de la instancia.
6. Pulsar **Utilizar**, guardar la instancia, preparar recursos y comprobar el diagnóstico antes de jugar. Guardar la instancia fija su `horizon_build_dir`: actualizar una Nightly no reemplaza silenciosamente la anterior.

El usuario puede seguir indicando manualmente una carpeta externa y asumir la responsabilidad de verificar su procedencia. La comprobación de huellas se aplica automáticamente a los builds gestionados con el manifiesto 2.16. El instalador de versiones antiguas puede seguir siendo compatible, pero no debe presentarse como una instalación verificada.

## Archivos nuevos y políticas

- `<VIS data>/horizon-builds/<nightly-date-commit>/[subcarpeta del build]/.vis-game-files-sha256.json`: huellas SHA-256 de tres archivos del motor; no contiene sesiones ni tokens.
- `.vis-release-sha256` mantiene el hash del paquete verificado previamente en la raíz del release.
- La nueva biblioteca es una enumeración **solo de lectura**. No borra builds anteriores, mundos, perfiles, recursos ni datos de cuentas.
- No se descargan archivos automáticamente al abrir la biblioteca; la descarga sigue requiriendo confirmación explícita del usuario.
- Los archivos se verifican por streaming en bloques de 64 KiB y se rechazan enlaces simbólicos/tamaños inválidos al comprobarlos.
- La respuesta JSON de `--launch-api` se limita a 1 MiB y el proceso dispone de 12 segundos. Un binario que no responda es terminado y se devuelve un error claro.

## Pruebas automatizadas disponibles

```
npm install
npm run validate
npm run check:release
npm run test:ui:vis216
cargo check -p vslauncher-tauri --all-targets
cargo test --workspace
npm run tauri dev
```

Las pruebas de Chromium simulan las respuestas de Rust y verifican navegación, selección, bloqueo de archivos alterados y escape de cadenas HTML. Las pruebas Rust comprueban huellas correctas y alteradas. Estas pruebas Rust no se pudieron ejecutar en el entorno de preparación por faltar Cargo y acceso a descargarlo.

**Pendientes reales:** compilación nativa Linux/Windows, descarga de una Nightly firmada real, preparación de Minecraft 26.3, OAuth Microsoft en Ceibo y ejecución efectiva de Horizon con una cuenta propietaria. No afirmar jugabilidad hasta completar esas pruebas.
