# VIS Nexo — tanda de cinco sistemas (sin builds)

Integrada a `main` el 12/11/2026. No se generan builds ni snapshots por estos cambios; todas las modificaciones posteriores van directamente a `main` con `[skip ci]`. Los cinco sistemas aún necesitan validación real en Linux/Windows y pruebas con Minecraft.

## 1. Protección de mundos entre procesos

`src-tauri/src/instance_lock.rs` usa bloqueos nativos del sistema (flock en Unix y LockFileEx en Windows) sobre `.vis/instance-running.lock`, además del bloqueo en memoria existente. Una sola instancia de juego puede escribir su carpeta de datos a la vez. El bloqueo se libera cuando Minecraft termina normalmente. En Linux/Unix, el descriptor del bloqueo se hereda a Java y a Horizon para sobrevivir un cierre inesperado del launcher mientras el juego siga abierto; requiere pruebas multiproceso y en juego. En Windows, la herencia/supervisión del bloqueo sigue pendiente. También cubre copias, restauraciones y recuperación de servidores. Una cuenta Premium mantiene sus propias credenciales aunque comparta mundos y lista de servidores.

## 2. Copias de seguridad y restauración

`src-tauri/src/instance_backup.rs`: acciones explícitas en **Instancias → Datos**. Copia solo `saves/`, `servers.dat`, `options.txt`, `optionsof.txt`, `resourcepacks/`, `shaderpacks/`, `config/` y `mods/`. No incluye las credenciales administradas por Microsoft/VIS Social, JDK, binarios, logs, temporales ni motor. **Aviso:** archivos de configuración de mods pueden contener tokens de servicios externos; no compartas estos ZIP públicamente. Los ZIP se escriben primero a un archivo parcial y solo se publican al finalizar. Máximo 16 GiB descomprimidos, 40.000 archivos, 26 niveles. Rechaza rutas extrañas, symlinks, entradas repetidas y ZIP excesivos.

La restauración requiere escribir **RESTAURAR**. Por defecto solo incorpora archivos ausentes; al activar reemplazo, mueve versiones anteriores a `.vis/backups/.rollback-...` para recuperarlas. Las copias **manuales** siguen disponibles y nunca se eliminan por la rotación automática. La opción `auto_backup` (apagada por defecto) crea una copia antes del lanzamiento propio de Java o Horizon, si existen mundos o archivos de ajustes, como máximo cada 24 horas. Guarda hasta **tres archivos automáticos** con prefijo `vis-data-auto-` y no los sube a la nube. Si el respaldo falla, el juego no se inicia, para que la protección solicitada no falle silenciosamente. Es una operación síncrona previa al arranque: un mundo muy grande puede demorar el inicio y consumir disco (límite 16 GiB por copia). Los usuarios invitados/visitantes no activan las copias del propietario. Si una restauración falla por un error de E/S durante la ejecución, intenta revertir los archivos ya aplicados. Si ocurre una caída del proceso o del sistema operativo, podría requerirse recuperación manual; los originales permanecen en `.vis/backups/.rollback-...`. Falta recuperación automática ante cierres abruptos.

## 3. Fusionar servidores guardados

`src-tauri/src/server_list.rs` lee NBT binario no comprimido de Minecraft Java. Unifica servidores antiguos de perfiles VIS por dirección `ip`, compara sin distinguir mayúsculas ni el puerto Java por defecto 25565, no duplica entradas y preserva etiquetas NBT desconocidas. Previsualiza cuántas entradas existen, cuántas agregaría y cuántas omitiría; **no hace nada sin confirmación**. Al aplicar, guarda el `servers.dat` original bajo `.vis/server-list-backups/` antes de sustituirlo.

Se conserva el archivo de origen. No es una fusión de mundos NBT ni maneja conflictos de nombres; se preserva la primera entrada de una misma dirección. Para el motor Horizon es necesaria una prueba en juego de su formato de lista de servidores: si es diferente a NBT Java, la operación reportará error sin tocar datos.

## 4. Administración múltiple, incluidas instancias compartidas

En **Instancias → Seleccionar**, los perfiles pueden seleccionar tanto instalaciones propias como instalaciones visibles de otro usuario. Los elementos propios se quitan de su biblioteca. Los compartidos se **ocultan exclusivamente** en el perfil activo; su carpeta, mundos y registro del propietario no se borran. Es obligatorio escribir **CONFIRMAR**. Si hay un elemento compartido seleccionado, se deshabilita el borrado físico en el cuadro de diálogo y el backend lo rechaza aunque se manipule la UI.

## 5. Diagnóstico y reparación de carpetas

`src-tauri/src/instance_health.rs` examina la estructura del juego sin modificarla. Identifica carpetas ausentes, enlaces simbólicos inseguros, rutas con tipo inesperado y mundos sin `level.dat`. Muestra conteos de mundos, resource packs y reportes de caída, más pistas específicas de fallos de memoria, mods, sesión y GPU a partir de un fragmento limitado de `logs/latest.log`. **No expone líneas del log ni tokens a la interfaz.** Detecta carpetas de restauración `.restore-*` pendientes, presenta el problema como peligroso y permite abrir los logs de la instancia. El borrado físico, cuando está permitido, adquiere el bloqueo de partida antes de eliminar archivos. La reparación de la carpeta propia **solo crea rutas que faltan**; se niega si detecta rutas inseguras. No elimina mundos ni repara contenido corrupto automáticamente.

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

## VIS Reliability — seguimiento (12/11/2026, sin nueva build)

- **Respaldo antes de jugar:** opt-in, por instancia propia, Java/Horizon, periodo mínimo 24 h y tres ZIP automáticos como máximo; se implementa en `instance_backup::create_if_due` y se configura en el editor de instancia. No hay timer ni sincronización remota de partidas.
- **Restauración interrumpida:** el diagnóstico detecta `.vis/backups/.restore-*`, y Java/Horizon se niegan a iniciar cuando existe una restauración pendiente. Una segunda restauración o copia también se bloquea. Si falla la reversión, se preservan staging y rollback para investigar en lugar de borrarlos.
- **Diagnóstico seguro de crashes:** conteo de archivos `crash-reports/*.txt` y clasificación acotada de las últimas 128 KiB de `logs/latest.log`, sin exponer el texto original ni copiar rutas/tokens al frontend. Acceso directo a los logs de la instancia.
- **Pruebas nuevas en código:** intervalo y ausencia de contenido del auto backup; bloqueo por staging pendiente; clasificación sin exponer secretos. **No ejecutadas aún en este commit.**
- **Pendiente:** recuperar automáticamente de forma transaccional tras un apagón (actualmente se protege el mundo bloqueando su uso, requiere revisión manual); mantener el bloqueo de partidas tras cerrar de forma inesperada VIS en Windows; integración real con cuentas Premium/Horizon en hardware Windows y Linux; gestor global de descargas, importadores `.mrpack`, modloaders adicionales, firma de la distribución.
