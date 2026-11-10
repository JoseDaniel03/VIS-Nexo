# VIS Worlds — diseño de rendimiento v2.10

## Límites matemáticos aplicados

**Hash en streaming**: `sha1_reader()` usa un búfer de 64 KiB independientemente del tamaño del archivo; es O(n) en tiempo y O(1) en memoria adicional. La implementación anterior usaba `fs::read` para validar un archivo existente, con memoria O(n): un JAR de 700 MiB podía consumir ~700 MiB de memoria *solo* para verificarlo.

**Paralelismo adaptativo**: para `N` archivos pendientes y `C` unidades de paralelismo disponibles, `P = min(N, max(2, min(C, 4)))`; si N=0, P=0. El máximo de búfer de lectura controlado por la aplicación en transferencias paralelas es `4 × 64 KiB = 256 KiB`. Esta cifra **no incluye** buffers de HTTP/TLS, el runtime o Windows/Linux. Reduce presión de RAM y discos respecto a 8 descargas a la vez; no promete mayor velocidad en todas las redes.

**Memoización temporal**: catálogos Mojang y Fabric se guardan 600 s en memoria con `OnceLock + Mutex`. Se evitan solicitudes repetidas al abrir y cerrar asistentes. Es solo una caché del proceso y nunca guarda contraseñas o claves.

**Catálogo lazy de la interfaz**: el backend devuelve todas las releases oficiales y hasta 60 snapshots recientes. El `datalist` dibuja como máximo 100 coincidencias del canal y texto escrito, manteniendo versiones antiguas buscables. El coste de nodos DOM queda acotado en O(100) en vez de O(n) por render del formulario.

**Modrinth**: se resuelven los nodos y aristas de dependencias requeridas (máximo 32 proyectos y profundidad 6), se comprueba versión Minecraft/Fabric y se ordenan con **Kahn**, O(V + E). Los ciclos y dependencias irresolubles fallan antes de descargar los archivos finales, y se prefieren versiones `release` cuando no existe un pin.

**Chat**: solo se montan 100 mensajes de cada vez (se pueden cargar de 100 en 100), con DOM O(min(n, ventana)); la base prototipo sigue guardando todo el historial local hasta que Humile implemente paginación de servidor.

**Tauri/Mutex**: las operaciones largas se ejecutan con `spawn_blocking` tras copiar la mínima información necesaria y soltar el bloqueo de `Backend`, de modo que no bloquean otras llamadas a comandos.

## Limitaciones honestas

No existe un benchmark de CPU/RAM de ejecutables nativos en esta entrega: no hay Cargo/Rustc disponibles para compilar, ni se arrancó Minecraft real. Especificaciones matemáticas y pruebas de interfaz/estáticas **no prueban** una mejora porcentual real de consumo. El frontend legado todavía se reconstruye completo en algunos `render()`, y el chat local aún carga datos de las cuentas; estos puntos requieren futuras optimizaciones y/o migración a Humile.

Para comprobar rendimiento real en CachyOS: `cargo check --all-targets`, `cargo test`, medir RSS con `ps -o rss= -p <PID>`, uso CPU `pidstat -p <PID> 1`, and test cases with 1/5/50 concurrent file tasks and short/long chat histories. Comparar con 2.9 bajo idénticas condiciones y hardware.
