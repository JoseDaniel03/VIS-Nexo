# VIS Nexo — auditoría de integración Premium / Horizon / Universe / Portals

Fecha: 2026-11-12. Arquitectura: único launcher Tauri 2, Java/Fabric y Horizon `horizon-official` descargado del fork solamente cuando se elige una instancia.

## Verificaciones y errores reportados

- **Probado manualmente por el usuario:** inicio Microsoft mediante navegador externo, código OAuth de dispositivo y arranque de Minecraft Java con identidad Premium.
- **Fallo previo Horizon Premium:** `Protegé el archivo de sesión con chmod 600 antes de usarlo`. La sesión temporal se escribía en `<instancia>/.vis/tmp`, dentro de un disco seleccionado en `/run/media/.../SSD2`; NTFS y otros volúmenes montados pueden no soportar los bits POSIX exigidos. Se movió a `<datos privados VIS>/private-ms-sessions`, con comprobación explícita de directorio 0700, archivo 0600, nombre aleatorio, entrega al juego por stdin y eliminación posterior. **Pendiente de prueba real en CachyOS**.
- Horizon Rust Edition **no es Minecraft Bedrock**: implementa el cliente Horizon para contenido de Minecraft Java 26.3. No se ha agregado protocolo de cuentas o cosméticos de Bedrock.

## Cambios recientes del launcher

- Instancias nuevas: elegir raíz de biblioteca, VIS propone `Instancias/<nombre-normalizado>`. La validación `destination` mantiene separación de mundos, evita rutas globales `.minecraft` y enlaces simbólicos; rutas de instancias antiguas se respetan.
- Cuando una instancia antigua Horizon apunta a un motor desaparecido, la instalación vuelve a buscar el paquete firmado del fork sin sobreescribir los mundos. Si encuentra una carpeta existente manipulada, sigue rechazándola.
- Eliminar instancia: por defecto **quita solo el registro VIS y conserva los archivos**. Borrado de disco opcional exclusivamente para carpetas administradas `Instancias/<nombre>` sin conflictos, exigiendo marca VIS. Los caminos legacy arbitrarios no se borran.
- Instancias creadas por otro usuario local: se pueden **ocultar solo para el perfil actual**, recuperándolas desde Mi perfil; no afecta al propietario.
- VIS Universe: los usuarios normales ven **solo proyectos publicados en el catálogo remoto**, no los borradores locales heredados. El administrador conserva sus borradores; los proyectos publicados reemplazan sus copias en la vista.
- El snapshot indica la URL de catálogo configurada. **Sin un catálogo HTTPS aprobado (`VIS_CATALOG_URL` durante compilación o configuración del administrador) y sin proyectos publicados, la biblioteca online aparecerá vacía.** No se debe inventar ni hardcodear una URL.
- Microsoft Premium inicia conexión separada a VIS Social tras OAuth. La identidad social no es automáticamente el gamertag: se comparte el identificador **VIS**, usando Copiar mi usuario VIS; las claves de Minecraft jamás se envían a VIS Social.
- Perfil Premium: consulta skins y capas que Minecraft Services devuelva, permite equipar capas poseídas y subir PNG 64×64/64×32 bajo condiciones de seguridad. La enumeración de skins antiguas puede estar limitada por Minecraft Services; aún debe probarse el flujo real con una cuenta propietaria.

## Pruebas de aceptación antes de considerar listo

1. Build CI Windows x64 + Linux x64: `npm run validate`, `npm run check:release`, `cargo check --all-targets --locked`, tests Rust, NSIS/portable ZIP y AppImage. Corregir todo error de CI.
2. CachyOS: instalación limpia en SSD2 NTFS y en ext4/btrfs; inicio Java Premium; Horizon 26.3 con cuenta Microsoft, logs y cierre limpio; reinicio del launcher y sesión expirada.
3. Instancia antigua con ruta y datos propios; instancia nueva bajo `Instancias/<nombre>`; conflictos, rutas inválidas, reinstalación y reparación sin perder `saves/`.
4. Separación de perfiles: instancia propia vs compartida, ocultar/restaurar, borrar solo registro, borrado físico con confirmación y bloqueo de carpetas heredadas.
5. Catálogo real configurado y publicado: proyecto nuevo, modificación remota, carga al iniciar, recuperación tras desconexión y ausencia de demos locales en cuentas no administrativas.
6. VIS Social entre dos equipos, amigos por ID VIS, mensajes cifrados, apodos, presencia, avatar remoto, reconexión; vinculación Microsoft/identidad VIS verificada por servidor sigue pendiente.
7. Cosméticos Premium: listar skin/capas, cambio legal de capa, subida real PNG, actualización de vista previa, controles de errores 401/403/red y refresh sin exponer tokens.
8. Robustez: downloads interrumpidas, reanudación, espacio insuficiente, permisos, medios desmontados, rutas `noexec`, crash recovery y logs sin credenciales.
9. Seguridad de lanzamientos: firma de releases propia y actualizador firmado, nunca tokens en repositorios ni cliente. Secrets de Cloudflare exclusivamente en GitHub Actions.

## Límite del alcance

No se realizó una instalación gráfica automatizada ni una prueba de juego con una cuenta propietaria desde CI. Compilar y pasar unit tests no demuestra que Horizon pueda ejecutar una partida real. La publicación y búsqueda pública por gamertag requieren una vinculación de propiedad Microsoft respaldada por el servidor social, no una equivalencia insegura nombre→ID.
