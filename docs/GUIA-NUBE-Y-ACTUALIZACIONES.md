# VIS — distribución sin PC encendida

## Separar servicios

- **GitHub Releases público**: instaladores del launcher, bundles firmados de Tauri Updater y ZIPs pequeños de proyectos. Una release pública puede alojar archivos de hasta 2 GiB (VIS aplica límite adicional de 1 GiB por descarga de proyecto).
- **GitHub Pages público**: JSON del catálogo VIS Universe. Barato y estable para metadatos. Ej. `https://TU-USUARIO.github.io/TU-REPO/catalog.json`.
- **Cloudflare R2**: alternativa para packs grandes, assets y descargas (no almacenar secretos de administración en objetos públicos). Usar URL pública `.r2.dev` o Pages.
- **Ceibo / Humile**: servidor de autenticación y chat más PostgreSQL; GitHub Releases no sustituye esto. No incluir tokens de admin ni historiales de chat en el repo.

## 1. Habilitar actualización automática del launcher (una sola vez)

1. Crear un repositorio GitHub para **VIS Nexo** (público si se usa `releases/latest/download/latest.json` sin token).
2. Generar un par de claves **Tauri Updater** con `npm run tauri signer generate -- -w ~/.tauri/vis-nexo.key`. Guardar la clave privada EN SECRETO y la pública para el cliente.
3. Secrets del repositorio: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (si se configuró contraseña).
4. Variables del repositorio: `VIS_UPDATER_PUBKEY` (contenido completo de la clave pública), `VIS_CATALOG_URL` (URL pública del catálogo de proyectos).
5. En los compiladores de Windows/Linux, `.github/workflows/vis-release.yml` establece `VIS_UPDATE_MANIFEST_URL=https://github.com/<owner>/<repo>/releases/latest/download/latest.json`.
6. Hacer `git tag nexo-v2.8.0 && git push origin nexo-v2.8.0`. GitHub Actions intentará compilar y publicar la release con `latest.json` y binarios firmados. Inspeccionar los artifacts y la ejecución del workflow ANTES de distribuirlo a otros.
7. En versiones posteriores incrementar `2.8.0` en `package.json`, `src-tauri/Cargo.toml` y `src-tauri/tauri.conf.json` y publicar un tag más reciente. El launcher consulta el manifiesto al abrir y permite instalar la versión firmada previa confirmación.

**Seguridad:** no subir la clave privada al repositorio, ni como asset, ni en mensajes, ni en ZIP distribuido. La verificación de firma es obligatoria; no la eludas. Para pruebas locales sin secretos, el workflow `vis-nexo-build.yml` usa `tauri.unsigned.json` y el updater queda desactivado.

**Persistencia:** mantener siempre el identificador técnico original `com.virgoland.vslauncher` hasta implementar migración explícita, ya que cambiarlo crea otra carpeta de app-data. El instalador no debe borrar esa carpeta. Los mundos, perfiles y mods no son parte del binario y no se eliminan al actualizar. La copia de preferencias se guarda dentro de `vis-backups`, pero **no reemplaza un respaldo completo de los mundos**.

## 2. Proyectos en la nube

1. Empaquetar los archivos PUBLICABLES del proyecto en un ZIP (sin datos de usuario ni partidas privadas).
2. Subirlo a GitHub Releases (o R2 público) y copiar el enlace HTTPS exacto.
3. Completar `distribution/projects.example.json` con `archive_path` local y `bundle_url` remoto real.
4. Generar el catálogo con `python tools/create_catalog.py --spec distribution/projects.json --output distribution/catalog.json`. El script fija SHA-256 y tamaño real del archivo.
5. Publicar `catalog.json` en GitHub Pages (o R2). Configurar `VIS_CATALOG_URL` al compilar VIS Nexo para que todos reciban el mismo catálogo, o establecer URL en Configuración como administrador local para probar.
6. Al agregar una nueva versión, subir ZIP nuevo con URL nueva y regenerar catálogo. Los clientes reciben la lista actualizada cuando abren la sección en línea; los archivos ya descargados no se borran.

**Aclaración:** por ahora VIS descarga los paquetes verificados pero no los importa en el gestor de instancias. El siguiente paso es un instalador de bundles con manifest por archivo, compatibilidad de loaders, extracción segura y reversión.

## 3. Minecraft Java

- Ir a Mis instancias → Crear instancia → elegir Minecraft Vanilla o Fabric, versión, RAM y nick.
- «Crear, instalar y jugar» guarda el perfil, descarga desde Mojang/Fabric y descarga Temurin automáticamente si se requiere. Los archivos se verifican por sus hashes cuando el proveedor lo publica.
- Este proceso requiere internet, almacenamiento libre y una arquitectura compatible; **no se validó con una sesión gráfica real de Minecraft en la entrega 2.8**.
- El acceso local/offline no concede una licencia Minecraft ni autenticación en servidores premium. Microsoft OAuth queda como requisito previo al lanzamiento estable.
