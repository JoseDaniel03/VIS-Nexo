# VIS Nexo — tanda de cinco sistemas (sin builds)

Rama: `feature/five-systems-no-builds`. Mantener separada de `main`; **no abrir PR** ni hacer merge hasta que se autorice una compilación de la siguiente tanda grande. La workflow `vis-nexo-build.yml` se dispara con `push main` o `pull_request main`. No se generaron archivos de juego, imágenes de sistema, snapshots ni ejecutables.

## 1. Protección de mundos entre procesos

`src-tauri/src/instance_lock.rs` usa bloqueos nativos del sistema (flock en Unix y LockFileEx en Windows) sobre `.vis/instance-running.lock`, además del bloqueo en memoria existente. Una sola instancia de juego puede escribir su carpeta de datos a la vez. El bloqueo se libera cuando Minecraft sale, se cierra el handle o el proceso termina. También cubre copias, restauraciones y recuperación de servidores. Una cuenta Premium mantiene sus propias credenciales aunque comparta mundos y lista de servidores.

## 2. Copias de seguridad y restauración

`src-tauri/src/instance_backup.rs`: acciones explícitas en **Instancias → Datos**. Copia solo `saves/`, `servers.dat`, `options.txt`, `optionsof.txt`, `resourcepacks/`, `shaderpacks/`, `config/` y `mods/`. No incluye Microsoft, VIS Social, JDK, binarios, logs, temporales ni motor. Los ZIP se escriben primero a un archivo parcial y solo se publican al finalizar. Máximo 16 GiB descomprimidos, 40.000 archivos, 26 niveles. Rechaza rutas extrañas, symlinks, entradas repetidas y ZIP excesivos.

La restauración requiere escribir **RESTAURAR**. Por defecto solo incorpora archivos ausentes; al activar reemplazo, mueve versiones anteriores a `.vis/backups/.rollback-...` para recuperarlas. Los respaldos **no se producen automáticamente** ni ahora ni al abrir el launcher. La restauración parcial interrumpida puede requerir intervención; conserva originales reemplazados en rollback.

## 3. Fusionar servidores guardados

`src-tauri/src/server_list.rs` lee NBT binario no comprimido de Minecraft Java. Unifica servidores antiguos de perfiles VIS por dirección `ip`, compara sin distinguir mayúsculas, no duplica entradas y preserva etiquetas NBT desconocidas. Previsualiza cuántas entradas existen, cuántas agregaría y cuántas omitiría; **no hace nada sin confirmación**. Al aplicar, guarda el `servers.dat` original bajo `.vis/server-list-backups/` antes de sustituirlo.

Se conserva el archivo de origen. No es una fusión de mundos NBT ni maneja conflictos de nombres; se preserva la primera entrada de una misma dirección. Para el motor Horizon es necesaria una prueba en juego de su formato de lista de servidores: si es diferente a NBT Java, la operación reportará error sin tocar datos.

## 4. Administración múltiple, incluidas instancias compartidas

En **Instancias → Seleccionar**, los perfiles pueden seleccionar tanto instalaciones propias como instalaciones visibles de otro usuario. Los elementos propios se quitan de su biblioteca. Los compartidos se **ocultan exclusivamente** en el perfil activo; su carpeta, mundos y registro del propietario no se borran. Es obligatorio escribir **CONFIRMAR**. Si hay un elemento compartido seleccionado, se deshabilita el borrado físico en el cuadro de diálogo y el backend lo rechaza aunque se manipule la UI.

## 5. Diagnóstico y reparación de carpetas

`src-tauri/src/instance_health.rs` examina la estructura del juego sin modificarla. Identifica carpetas ausentes, enlaces simbólicos inseguros, rutas con tipo inesperado y mundos sin `level.dat`. Muestra conteos de mundos y resource packs. La reparación de la carpeta propia **solo crea rutas que faltan**; se niega si detecta rutas inseguras. No elimina mundos ni repara contenido corrupto automáticamente.

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
