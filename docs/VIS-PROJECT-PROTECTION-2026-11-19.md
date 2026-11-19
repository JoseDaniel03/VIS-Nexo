# VIS Nexo — Protección de proyectos y versiones propias (fase 1)

Implementación de `main` del 19 de noviembre de 2026. Esta fase modifica el launcher Tauri 2 de Windows/Linux. **No genera un nuevo ejecutable** y no declara completada la integración con el juego Android.

## Editor de proyectos

En **Editor → Datos → Seguridad del proyecto** hay opciones independientes:

- Bloquear mods, texture packs, shaders, datapacks globales o archivos de `config/` y `defaultconfigs/`.
- Fijar motor, versión Minecraft y loader de la instancia.
- Solicitar verificación SHA-256 antes de iniciar.
- Establecer `release_version` propio, por ejemplo `1.2.0`, separado de la versión Minecraft.

El backend Rust rechaza `install_modrinth`, `import_instance_file`, `toggle_instance_file` y `remove_instance_file` para categorías bloqueadas a cuentas no administradoras. El frontend muestra los botones deshabilitados, pero **el permiso se impone en Rust**.

## Cómo distribuir una versión protegida

1. Ingresar como administrador local o con una sesión VIS Cloud cuyo rol `super_admin` esté confirmado mediante `GET /v1/state` autenticado.
2. Crear el proyecto, seleccionar Minecraft, loader, etiqueta de release y políticas. Guardar.
3. Instalar una instancia **propia** con ese mismo motor, versión y loader. Añadir los recursos aprobados.
4. Volver a **Editor → Revisar**, pulsar **Sellar** sobre esa instancia. Rust lee y calcula SHA-256 para las carpetas seleccionadas. No utiliza un manifiesto suministrado por el WebView.
5. Si se cambian versión de Minecraft, loader, lista de mods, release o casillas, el sello se invalida. Hay que revisar, guardar y sellar de nuevo.
6. Distribuir el catálogo y, si se necesitan recursos compartidos, usar **Configuración → VIS Team** con una instancia administradora y la credencial autorizada de publicación R2.
7. Los jugadores importan/aplican el paquete de equipo con verificación de ZIP + hashes de archivos; al jugar VIS comprueba la coincidencia con el sello del proyecto si `verify_on_launch` está activado.

**Importante:** un proyecto con verificación activa y carpetas bloqueadas pero todavía sin sello **no se puede ejecutar**. Esto es deliberado: falla de forma cerrada hasta que el administrador publique la versión aprobada.

## Recursos propios

VIS Team incluye carpetas compartibles de configuración y, con la casilla correspondiente, resource packs, shaders y datapacks globales. La nueva casilla **Mods propios (JAR)** permite agregar únicamente archivos planos `mods/*.jar`, con nombres limitados, a proyectos Java + Fabric y únicamente si existe autorización de redistribución. Los ZIP utilizan SHA-256 por archivo y verificación del paquete completo. Continúan los topes existentes: 16 MiB por archivo, 32 MiB por ZIP, 96 MiB descomprimidos y 1.500 archivos como máximo. Los cambios nunca sobrescriben archivos personales existentes durante la importación aditiva.

La etiqueta `release_version` se valida en el manifiesto `.bsconfig`, además de motor, Minecraft, loader y mods Modrinth. El sistema **no** sustituye todavía el historial de versiones con rollback ni admite varias releases instaladas simultáneamente bajo el mismo ID de proyecto: para eso se requiere un catálogo de releases independiente con hashes y migraciones.

## VIS Ceibo y permisos

Una cuenta VIS Cloud solo obtiene permisos locales de administración cuando la sesión Rust ha confirmado contra VIS Ceibo la identidad y el rol `super_admin` mediante bearer autenticado. La concesión dura como máximo 15 minutos desde la última comprobación correcta de `/v1/state`, se asocia al nombre autenticado y nunca queda registrada como rol de administrador local. Se limpia al cerrar sesión. El backend cloud verifica la autorización para las acciones remotas por separado. Si la conexión falla o el permiso expira, volver a conectar/iniciar sesión para renovar.

**No basta escribir `VIS STUDIOS`, reutilizar un nombre local, cambiar el HTML o falsificar un rol en JavaScript.** La primera supercuenta debe crearse mediante el workflow de aprovisionamiento protegido y registrarse previamente en la nube.

## Límites de seguridad y pendientes

- Los archivos siguen perteneciendo al usuario del sistema operativo: VIS no aplica ACL de solo lectura, y el jugador puede cambiar archivos fuera del launcher. Un servidor competitivo requiere comprobación propia y un modelo de confianza del lado del servidor.
- La integridad se mide en las rutas globales seleccionadas. `saves/`, mundos personales y datapacks **internos a los mundos** no se inspeccionan ni alteran; los últimos requieren una política diferenciada.
- Las configuraciones o mods que reescriban sus propios archivos pueden invalidar el sello. Probar en instalaciones de evaluación antes de activar `lock_config` en producción.
- SHA-256 prueba coincidencia con el catálogo recibido, **no demuestra la identidad del publicador**. Queda pendiente firmar manifiestos/release con claves de VIS Studios y realizar pruebas ante modificaciones concurrentes.
- Java/Rust siguen necesitando pruebas de escritorio y builds verificadas. Android Companion no implementa instalación ni protección real de Minecraft.
- Importar/modificar archivos por el administrador y volver a sellar crea una nueva versión aprobada; la revisión de licencias y seguridad de archivos propios sigue siendo responsabilidad de la persona que publica.
