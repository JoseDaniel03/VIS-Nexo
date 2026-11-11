# VIS Nexo — distribución, publicación y actualizaciones (v2.18)

## Qué recibe un usuario

- **Programa:** GitHub Actions `VIS Nexo Native Build` genera un instalador `.deb` y `.AppImage` en Linux, y `.exe` (NSIS) en Windows. No son *Python wheels*. El usuario no necesita Rust, Python, Cargo ni compilar Horizon: el ejecutable `horizon-client` se incluye durante el build.
- **Proyectos:** el launcher consulta al abrir el catálogo público HTTPS configurado en `VIS_CATALOG_URL`. Si hay proyectos completos publicados, VIS los combina en memoria con el catálogo local. La caché `vis-universe-cache.json` permite ver el último catálogo válido sin conexión y NO reemplaza mundos/instancias.
- **Actualizaciones del programa:** la función Tauri Updater solo se habilita con `VIS_UPDATER_PUBKEY` y `VIS_UPDATE_MANIFEST_URL` HTTPS. En pruebas unsigned permanece deshabilitada. Para usuarios externos, el manifiesto y las descargas firmadas deben ser públicos: **un Release de un repositorio GitHub privado no sirve como fuente pública**.

## Preparar el servidor público VIS Universe (Cloudflare Worker + R2)

1. Crear un bucket R2 `vis-universe` dentro de tu cuenta Cloudflare. No subas archivos de Minecraft propietarios ni partidas personales.
2. Desde `services/universe`, instalar Wrangler e iniciar sesión: `npx wrangler login`.
3. Crear un secreto largo y aleatorio (al menos 32 caracteres) y guardarlo solamente en Cloudflare: `npx wrangler secret put VIS_PUBLISH_TOKEN`.
4. Ejecutar `npx wrangler deploy` en `services/universe`, revisar el nombre/subdominio asignado y abrir `https://<tu-worker>.workers.dev/catalog.json`. Al principio la respuesta es una lista vacía.
5. Configurar **GitHub Repository Variable** `VIS_CATALOG_URL` con esa URL y volver a generar los instaladores. En un VIS ya instalado, un administrador local puede configurar la URL desde Ajustes, pero eso solo afecta a esa computadora.
6. Iniciar VIS con la cuenta local de VIS STUDIOS, editar proyectos, elegir Configuración → Publicación de VIS Universe, ingresar la misma credencial privada del Worker y pulsar **Publicar proyectos y novedades**. La credencial no se guarda en archivo, proyecto ni GitHub.
7. Los clientes que estén configurados para ese catálogo reciben los nuevos datos al iniciar o pulsar Actualizar catálogo. Cada jugador elige su carpeta y RAM para instalar la versión de Minecraft definida en el proyecto.

**Seguridad:** Ser admin local NO demuestra identidad en Internet. El Worker valida su propia credencial de publicación. No publicar ese secreto en código, screenshots, frontend, repositorio ni archivos de distribución. La cuenta VIS STUDIOS remota con sesiones centralizadas y roles verificados requerirá desplegar VIS Ceibo; la autenticación Microsoft de Minecraft es otro sistema separado.

**Archivos publicados:** títulos, motor y versión de Minecraft, modloader, noticias, calendario, notas y banners/logos/iconos importados a la biblioteca de recursos de VIS. Las imágenes se almacenan por SHA-256 bajo `/assets/`; no se exportan rutas de archivos privados. **No** publica automáticamente mods/resource packs: el catálogo de paquetes ZIP con checksum sigue siendo un canal distinto; su instalación segura automática en el proyecto necesita una fase específica de integración.

## Compilación y publicación del ejecutable

- Revisar [GitHub Actions](../../.github/workflows/vis-nexo-build.yml): las builds sin firma de desarrollo se generan en un push a `main` o PR. Descargar `vis-nexo-linux` y `vis-nexo-windows` de la pestaña Artifacts cuando ambos trabajos estén verdes.
- Para una release pública firmada, configurar `TAURI_SIGNING_PRIVATE_KEY` (secret), `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (si la clave tiene contraseña), `VIS_UPDATER_PUBKEY`, `VIS_HORIZON_COMMIT` (SHA completo del juego) y un **feed público** `VIS_UPDATE_MANIFEST_URL`. Publicar un tag `nexo-vX.Y.Z`. Nunca compilar dos versiones distintas con el mismo número.
- El repositorio actual es **privado**. Si los usuarios no tendrán acceso, subir instaladores firmados y `latest.json` a un repositorio de descargas público o Cloudflare R2 y configurar ese manifiesto como feed de actualización. No se automatiza esa subida hasta que existan el destino y las credenciales de CI.

## Estado de esta integración

El Worker y la sincronización funcionan desde el código y tienen pruebas Node. Deben superar GitHub Actions nativo en Windows/Linux y el despliegue real en una cuenta Cloudflare para considerarse disponibles a otros jugadores. La publicación no se produce solo por iniciar sesión: el administrador debe confirmar **Publicar proyectos y novedades**. Tampoco instala Minecraft sin los recursos oficiales y, para uso premium, la sesión Microsoft válida.
