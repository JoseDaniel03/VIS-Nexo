# VIS Nexo v2.12 — VIS Smart Install y Worlds Portable

## Objetivo

Reducir tráfico y dejar que una instancia nueva contenga sus propios archivos de Minecraft, de forma parecida a la biblioteca de CurseForge, sin alterar las instalaciones del launcher oficial ni de terceros.

### Estrategia de reutilización

1. Recibir el manifiesto de la versión de Mojang y, para Fabric, sus metadatos específicos.
2. Preparar tareas deterministas `versions/`, `libraries/`, `assets/indexes/` y `assets/objects/`.
3. Validar el archivo de destino si ya existe.
4. Revisar rutas conocidas: `.minecraft` (Windows, Linux, macOS), caches Prism/Modrinth/CurseForge detectables, `minecraft-runtime` heredado y runtimes privados de otras instancias VIS guardadas. El usuario puede elegir una fuente adicional desde el formulario. **No se hacen recorridos recursivos del disco**.
5. Copiar el archivo en bloques de 64 KiB a un nombre temporal único, calculando SHA-1 **sobre los bytes efectivamente copiados**.
6. Promover el archivo a destino solamente si coincide exactamente con el SHA-1 declarado. Si no coincide, eliminar el temporal y continuar con las fuentes restantes o descargar desde la fuente oficial.
7. Respetar restricciones de tamaño, hashes y nombres ya existentes; nunca escribir sobre una instalación ajena. Archivos sin SHA-1 verificable se descargan normalmente.

La reutilización ahorra ancho de banda, pero tiene un costo de lectura y escritura local: no implica una reducción garantizada del tiempo total, especialmente en HDD.

### Carpetas de instancia

- **Nueva instalación** (carpeta elegida o VIS auto): `<instancia>/.vis/runtime/versions`, `libraries`, `assets`; mundos y mods en `<instancia>/saves` y `<instancia>/mods`.
- **Instancia 2.11 o anterior**: conserva el runtime compartido de VIS para evitar romper instalaciones. Al reparar/reinstalar se prepara un runtime privado de v2.12 sin borrar la caché vieja.
- **Java Temurin**: por ahora es un runtime común del launcher y puede seguir en el directorio de datos de la aplicación. No es lo mismo que los JARs/versiones de Minecraft.

### Importación/exportación

- `Exportar`: paquete ZIP con `VIS-INSTANCE.json`, metadatos de Minecraft y archivos del perfil (incluidos mods, mundos y runtime privado si lo contiene).
- `Importar`: elegir ZIP y carpeta biblioteca, validar manifiesto/rutas/límites, extraer a staging y mover la carpeta resultante de una vez. Nunca se fusiona con una instancia existente. Conflictos de nombre generan otro nombre.
- Los ZIPs de CurseForge/Modrinth/Prism no son el mismo formato y **todavía no se importan como perfiles VIS**. Por ahora solo se reutilizan archivos verificados presentes en sus caches.
- Algunos mods pueden contener configuración personal. Revisar el paquete antes de compartir públicamente.

### Progreso

La barra inferior muestra la etapa actual, `N/M` archivos de esa etapa, porcentaje de la etapa y último archivo completado. No es una ETA temporal ni un porcentaje global de bytes. Se actualiza por eventos de Tauri sin reconstruir toda la pantalla.

### Compatibilidad y pruebas

- Compilador Rust: `cargo check --manifest-path src-tauri/Cargo.toml --all-targets`.
- Tests Rust: `cargo test --workspace` (incluidos tests de copiar con hash, runtime anterior y ZIP portátil).
- Frontend: `npm run validate`, `npm run check:release`, `npm run test:ui:vis212`.
- Probar una instalación Vanilla nueva, reutilización de una versión existente, Fabric, instalación con origen corrupto, importación/exportación y cierre/crash real del juego.

**Estado:** código fuente implementado y comprobado estáticamente/mediante Chromium; no se generó un ejecutable ni se confirmó el arranque real de Minecraft en este entorno, porque no hay Cargo/Rustc instalado.
