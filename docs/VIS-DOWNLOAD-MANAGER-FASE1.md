# VIS Download Manager — fase 1 (Java y Horizon)

Integrado al código fuente de `main` el 13 de noviembre de 2026. **No hay build nueva de esta tanda**: la comprobación de Cargo, los tests Rust y la aceptación real en Windows/Linux siguen pendientes.

## Qué se implementó

- **Operación nativa registrada:** `src-tauri/src/download_manager.rs` gestiona **una instalación activa** por proceso del launcher; identifica usuario, título, etapa, progreso, estado y petición de cancelación. Una segunda instalación se rechaza con un mensaje claro hasta que finalice la anterior, en lugar de descargar simultáneamente al mismo destino.
- **Estados:** `running`, `cancelling`, `completed`, `cancelled` y `failed`; la interfaz escucha `vis-download-state` y conserva una ventana de hasta ocho operaciones finalizadas **solo en memoria**, filtradas por propietario. No hay almacenamiento de sesiones Microsoft ni de credenciales de repositorios.
- **Interfaz:** barra inferior existente con título, porcentaje **de la etapa actual** y botón **Cancelar instalación**. En **Configuración → VIS Download Manager** se consulta el estado y el historial de la sesión. El botón exige confirmación. La cancelación se solicita al backend mediante un identificador de tarea y verifica el usuario activo.
- **Java/Fabric/Mojang:** se consulta el indicador de cancelación antes y después de cada archivo de la descarga paralela, y antes de cada lectura de bloques de 64 KiB de los archivos obtenidos en la instalación principal. El descargador Java Temurin consulta el indicador durante cada bloque; el instalador no registra una instalación como exitosa si la operación fue cancelada antes de terminar.
- **Horizon:** la descarga desde el fork propio consulta cancelación antes de cada bloque y antes de descomprimir/publicar el motor verificado. También se revisa la cancelación entre las fases de motor, recursos Minecraft, JDK y preparación.
- **Seguridad:** los orígenes de Mojang/Fabric y los límites por archivo, hashes SHA-1/SHA-256, extracción limitada y publicación atómica existentes **siguen vigentes**. Cancelar no elimina ni sobrescribe mundos ni recursos instalados y verificados. Los temporales de la transferencia interrumpida se eliminan según la lógica existente de cada descargador.

## Limitaciones explícitas

- **No hay cola de trabajos**: existe una operación activa y un historial, no un planificador que ordene múltiples instalaciones pendientes.
- **No hay pausa/reanudación HTTP**: una transferencia cancelada vuelve a comenzar cuando se reintenta, salvo archivos completos que SmartInstall ya pueda verificar y reutilizar. No conservaremos parciales sin validar su identidad, rango, ETag y checksum.
- Las descargas **independientes** de Modrinth, los paquetes de Universe y el actualizador de Tauri todavía no están registrados en este gestor. Los mods del proyecto ejecutados como fase de instalación Java forman parte de su tarea, pero esa fase no puede cortarse a mitad de una promoción transaccional.
- La cancelación es cooperativa: durante una lectura de red bloqueada, extracción o preparación nativa larga, puede demorar hasta alcanzar el siguiente punto seguro. No se mata un subproceso de Horizon sin comprobar su estado.
- Los porcentajes existentes miden **etapas**, no bytes totales del plan, y todavía no hay cálculo confiable de velocidad ni tiempo restante.
- El historial es efímero: un cierre inesperado no preserva las tareas en curso como un registro durable. Los archivos parciales solo se podrán recuperar cuando se añada un protocolo de reanudación seguro.

## Verificación previa a una distribución pública

1. `npm run validate` y `npm run check:release` (incluye `tools/check_vis_downloads.py`).
2. `cargo check --all-targets --locked` y `cargo test --locked` en Windows/Linux; compilar también `examples/minecraft_smoke.rs` y `examples/horizon_smoke.rs`.
3. Instalar Java Vanilla/Fabric y Horizon en discos separados; cancelar al descargar bibliotecas, assets, Temurin y motor Rust; confirmar que reintenta sin tocar `saves/`, `servers.dat` ni los mods personales.
4. Intentar iniciar una segunda instalación mientras hay una activa; verificar rechazo, no dos escrituras simultáneas. Verificar progreso/confirmación en ventanas reducidas.
5. Cambiar de cuenta mientras hay una tarea activa; comprobar que solo su propietario puede consultar y cancelar la descarga.
6. Provocar fallo de checksum y apagado inesperado; comprobar que ninguna instalación parcialmente escrita se marca como lista para jugar.

## Siguiente fase

Extender el registro a Modrinth y VIS Universe, crear cola con control de concurrencia por disco/instancia, reanudación HTTP condicionada a `Accept-Ranges`/`ETag` y verificación final; centralizar estimación de bytes y velocidad. Incorporar publicación segura de descargas de proyectos desde VIS Productions/Universe.
