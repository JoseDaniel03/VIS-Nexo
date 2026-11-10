# VIS Nexo v2.13 — Horizon Rust Edition y biblioteca compartida offline

## Alcance real

- **Horizon es el motor del JUEGO**: se llama a `horizon-client` y `horizon-prepare`, no a `horizon-launcher`.
- El usuario selecciona manualmente una carpeta de un build oficial ya extraído. Debe incluir `horizon-client`, `horizon-prepare`, `research-lock.json` y sus archivos auxiliares.
- Se compara `--launch-api` de ambos binarios (API 0.1.x) y la versión Minecraft fijada por el build, hoy **26.3**.
- La preparación ejecuta `horizon-prepare --prepare --minecraft-dir ... --server-jar ... --output ... --complete --progress json`, registra progreso y comprueba `--check` antes de considerar la instancia instalada.
- Horizon escribe sus partidas, mods, capturas y logs dentro de la carpeta de esa instancia; los recursos preparados se guardan en `.vis/horizon-resources`.
- **El juego solo puede iniciarse con una sesión Microsoft de una cuenta que posea Minecraft Java Edition.** VIS aún no implementa OAuth de Microsoft. Existe un flujo **avanzado de prueba** con un JSON temporal de una sola utilización: debe ser un archivo normal, privado (chmod 600 en Linux), y se elimina tras entregarlo por stdin al cliente. Nunca se guarda en `accounts.json` ni en preferencias. No subas esos JSON a GitHub ni los compartas con otras personas. Este flujo no comprueba desde VIS la propiedad de la cuenta; depende del sistema de autenticación de Minecraft y de Horizon. No sustituye el inicio de sesión Microsoft real que falta implementar.
- **Aún no se descargan automáticamente releases de Horizon**: verificar el archivo publicado y su firma requiere implementar la validación Ed25519 de `SHA256SUMS.sig`. Hasta entonces se importa una copia oficial que el usuario descargó y verificó.
- La integración de formatos `.hmod`/`.hnmod` se trabajará en una entrega posterior. Los mods Java Fabric/Forge no funcionan en Horizon.

Documentación oficial: https://github.com/horizon-rust/horizon/blob/main/docs/api/launch-guide.md

## Procedimiento de prueba en CachyOS

1. Descargá el archivo **del juego** `horizon-linux-x86_64.tar.gz` de los [releases oficiales](https://github.com/horizon-rust/horizon/releases) (no el instalador de Horizon Launcher). Revisá su SHA-256 y firma según las instrucciones oficiales.
2. Extraelo manteniendo el conjunto de binarios y el `research-lock.json` en una misma carpeta. Confirmá que `./horizon-client --launch-api` y `./horizon-prepare --launch-api` devuelven JSON.
3. Disponé de Minecraft Java Edition **26.3**, el server JAR oficial de la misma versión y JDK **25**. Un usuario que no posea Minecraft no puede usar esta integración legítimamente.
4. En VIS Worlds creá una instancia con motor **Minecraft Rust Edition — Horizon**, indicá la carpeta del build, la ruta al Minecraft Java existente, el server JAR y, si es necesario, el directorio del JDK 25.
5. Elegí **Instalar**. VIS ejecutará el preparador desde Rust y verificará la salida. El proceso puede tardar; la barra muestra su progreso informado en JSON.
6. Solo para prueba avanzada, el botón **Jugar** permite seleccionar un archivo `session.json` temporal válido de la cuenta propietaria. La integración de Microsoft de VIS Ceibo está pendiente, por lo que este paso no es automático.
7. Para comprobar versiones y recursos preparados, utilizá **Comprobar versión Horizon y recursos** en el centro de la instancia.

## Instancias de otros perfiles en modo offline

1. Iniciá sesión en la cuenta local propietaria.
2. Editá una instancia **Java** ya instalada, con ruta de carpeta automática de VIS, y activá **Compartir instancia con el modo offline**. No se comparte por defecto.
3. Cerrá sesión; entrá en modo offline con un nick distinto y abrí VIS Worlds. La instancia compartida aparecerá con el nombre del propietario.
4. Cuando el invitado pulse Jugar, se utiliza el Java y los recursos originales **en modo lectura sobre el origen**, pero los mundos, opciones y logs que guarda el juego se dirigen a `offline-guests/<nick>/<propietario>/<proyecto>/<instancia>` en el directorio de datos VIS. No se copia ni altera `saves/` del propietario.
5. Instancias externas con `game_dir` personalizado no se comparten; Horizon tampoco se comparte offline porque requiere sesión Microsoft válida.

**Seguridad:** la separación de carpetas evita compartir partidas accidentalmente. No constituye sandbox de seguridad contra mods Java ejecutables arbitrarios. Usá únicamente mods de confianza.

## Verificaciones y límites

Se ejecutaron comprobaciones estáticas, TypeScript incremental, correspondencia de comandos JS/Tauri y pruebas Chromium a 880/1366 px. **No se compiló Rust** ni se inició Horizon ni Minecraft porque el entorno de entrega no tiene Cargo/rustc ni sesiones Microsoft de prueba. Son tareas pendientes de validación en CachyOS/Windows.

```bash
npm install
npm run validate
npm run check:release
python3 tools/test_vis213.py
cargo check --manifest-path src-tauri/Cargo.toml --all-targets
cargo test --workspace
npm run tauri dev
```
