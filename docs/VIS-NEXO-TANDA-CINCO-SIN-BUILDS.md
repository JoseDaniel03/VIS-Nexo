# VIS Nexo — tanda de cinco sistemas (sin builds)

Integrada a `main` el 12/11/2026. No se generan builds ni snapshots por estos cambios; todas las modificaciones posteriores van directamente a `main` con `[skip ci]`. Los cinco sistemas aún necesitan validación real en Linux/Windows y pruebas con Minecraft.

## 1. Protección de mundos entre procesos

`src-tauri/src/instance_lock.rs` usa bloqueos nativos del sistema (flock en Unix y LockFileEx en Windows) sobre `.vis/instance-running.lock`, además del bloqueo en memoria existente. Una sola instancia de juego puede escribir su carpeta de datos a la vez. El bloqueo se libera cuando Minecraft termina normalmente. En Linux/Unix, el descriptor del bloqueo se hereda a Java y a Horizon para sobrevivir un cierre inesperado del launcher mientras el juego siga abierto; requiere pruebas multiproceso y en juego. En Windows, la herencia/supervisión del bloqueo sigue pendiente. También cubre copias, restauraciones y recuperación de servidores. Una cuenta Premium mantiene sus propias credenciales aunque comparta mundos y lista de servidores.

## 2. Copias de seguridad y restauración

`src-tauri/src/instance_backup.rs`: acciones explícitas en **Instancias → Datos**. Copia solo `saves/`, `servers.dat`, `options.txt`, `optionsof.txt`, `resourcepacks/`, `shaderpacks/`, `config/` y `mods/`. No incluye las credenciales administradas por Microsoft/VIS Social, JDK, binarios, logs, temporales ni motor. **Aviso:** archivos de configuración de mods pueden contener tokens de servicios externos; no compartas estos ZIP públicamente. Los ZIP se escriben primero a un archivo parcial y solo se publican al finalizar. Máximo 16 GiB descomprimidos, 40.000 archivos, 26 niveles. Rechaza rutas extrañas, symlinks, entradas repetidas y ZIP excesivos.

La restauración requiere escribir **RESTAURAR**. Por defecto solo incorpora archivos ausentes; al activar reemplazo, mueve versiones anteriores a `.vis/backups/.rollback-...` para recuperarlas. Los respaldos **no se producen automáticamente** ni ahora ni al abrir el launcher. Si una restauración falla por un error de E/S durante la ejecución, intenta revertir los archivos ya aplicados. Si ocurre una caída del proceso o del sistema operativo, podría requerirse recuperación manual; los originales permanecen en `.vis/backups/.rollback-...`. Falta recuperación automática ante cierres abruptos.

## 3. Fusionar servidores guardados

`src-tauri/src/server_list.rs` lee NBT binario no comprimido de Minecraft Java. Unifica servidores antiguos de perfiles VIS por dirección `ip`, compara sin distinguir mayúsculas ni el puerto Java por defecto 25565, no duplica entradas y preserva etiquetas NBT desconocidas. Previsualiza cuántas entradas existen, cuántas agregaría y cuántas omitiría; **no hace nada sin confirmación**. Al aplicar, guarda el `servers.dat` original bajo `.vis/server-list-backups/` antes de sustituirlo.

Se conserva el archivo de origen. No es una fusión de mundos NBT ni maneja conflictos de nombres; se preserva la primera entrada de una misma dirección. Para el motor Horizon es necesaria una prueba en juego de su formato de lista de servidores: si es diferente a NBT Java, la operación reportará error sin tocar datos.

## 4. Administración múltiple, incluidas instancias compartidas

En **Instancias → Seleccionar**, los perfiles pueden seleccionar tanto instalaciones propias como instalaciones visibles de otro usuario. Los elementos propios se quitan de su biblioteca. Los compartidos se **ocultan exclusivamente** en el perfil activo; su carpeta, mundos y registro del propietario no se borran. Es obligatorio escribir **CONFIRMAR**. Si hay un elemento compartido seleccionado, se deshabilita el borrado físico en el cuadro de diálogo y el backend lo rechaza aunque se manipule la UI.

## 5. Diagnóstico y reparación de carpetas

`src-tauri/src/instance_health.rs` examina la estructura del juego sin modificarla. Identifica carpetas ausentes, enlaces simbólicos inseguros, rutas con tipo inesperado y mundos sin `level.dat`. Muestra conteos de mundos y resource packs. El borrado físico, cuando está permitido, adquiere el bloqueo de partida antes de eliminar archivos. La reparación de la carpeta propia **solo crea rutas que faltan**; se niega si detecta rutas inseguras. No elimina mundos ni repara contenido corrupto automáticamente.

## Pruebas pendientes (se exige autorización antes de builds)

- `cargo check`, `cargo test` y empaquetado multiplataforma en la siguiente tanda autorizada.
- Java Vanilla + Fabric: dos cuentas VIS comparten mundos y servidores; intentos de ejecutar concurrentemente el mismo juego se rechazan incluso desde dos procesos de VIS.
- Horizon 26.3: validar el mismo acceso y la navegación a carpetas en CachyOS.
- Guardar copia → cambiar datos → restaurar ausentes → restaurar con sustitución → recuperar desde rollback.
- Fusionar dos `servers.dat` válidos y confirmar que el original sigue recuperable.
- Selección mixta: una instalación propia y otra compartida, sin borrar archivos de un tercero.
- Probar selector y diálogos en ventanas de 1024×768 y tamaños reducidos.
- Confirmar que no se crean builds automáticamente por esta rama.

## Alcance y límites

Estas funcionalidades operan sobre una computadora. **No** sincronizan mundos entre distintas computadoras, no conceden permisos Premium a cuentas offline, no permiten seleccionar rutas arbitrarias desde JavaScript y no borran instalaciones ajenas. La implementación del código sin compilar no equivale a una versión jugable o a pruebas reales superadas.

## Revisiones incrementales (sin compilación)

- Borrado individual y por lotes: se adquieren bloqueos de ejecución antes de modificar las carpetas.
- Java/Horizon en Linux: descriptor `flock` heredado por el proceso del juego; falta validación externa.
- Restauración: rollback automático ante errores ordinarios durante el proceso; un apagado abrupto aún puede requerir recuperación manual.
- `servers.dat`: direcciones con `:25565` se tratan como el mismo servidor que el hostname sin puerto, sin eliminar sufijos de IPv6 no delimitados.
- Ninguna de estas correcciones ha sido compilada ni validada en juego. Quedan pendientes compatibilidad real de Horizon con el formato de servidores y Windows.
