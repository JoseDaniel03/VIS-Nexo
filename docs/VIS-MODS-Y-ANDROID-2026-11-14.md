# Mods y Android: investigación e implementación

## Decisión

Nexo unifica el descubrimiento por proveedor, pero no confunde procedencia con
compatibilidad. Un JAR de Fabric no se vuelve ejecutable en Rust por renombrarlo.
Es preferible usar primero un port nativo ya disponible y después evaluar el
contenido que puede trasladar `horizon-port-pack`. Convertir lógica exige revisar
las dependencias, las funciones omitidas y el motor exacto, y probar el resultado.

El registro público de Horizon consultado contiene mods de contenido y nativos,
además de otros recursos. Los resultados nativos requieren compilación; su presencia
en el registro no demuestra que funcionen en nuestro fork o en Android ARM64.

## Herramientas investigadas

- [Horizon Translator](https://github.com/merenotnoonereal/Horizon-Translator):
  convierte Fabric a proyectos Rust; el propio autor describe resultados parciales
  y trabajo manual pendiente. Está ligado a una revisión concreta del motor. No se
  copió ni se empaquetó su código en Nexo.
- [horizon-port-pack y formatos oficiales](https://github.com/horizon-rust/horizon/blob/main/docs/modpacks.md):
  inspección y traslado de contenido, con informe de lo que queda sin portar.
- [Registro Horizon](https://github.com/horizon-rust/horizon-mods): catálogo de
  proyectos con versiones, firmas, capacidades y revisiones/API.
- [Puente Java comunitario](https://github.com/iaxivers/horizon-java-bridge): ruta
  distinta de la traducción a Rust; se presenta como beta opcional. No está
  incorporado ni validado en nuestro fork o en Android.
- [Modrinth](https://docs.modrinth.com/api/operations/searchprojects/) y
  [CurseForge](https://docs.curseforge.com/rest-api/): metadatos por versión/loader;
  encontrar el proyecto no prueba compatibilidad con Horizon.

## Backend incorporado

`mods_catalog_search`: búsqueda Modrinth, registro Horizon y CurseForge. El último
usa `/v1/mods/search`, una ruta autenticada en VIS Social. La clave queda en el
Worker como `CURSEFORGE_API_KEY`, cargada desde el secreto Actions
`VIS_CURSEFORGE_API_KEY` al desplegar. Si falta, el proveedor informa configuración
pendiente. No se usa un proxy ajeno ni se incrusta una clave en el launcher.

`mods_assess_local`: lee ZIP/JAR sin ejecutar código. Calcula SHA-256, limita cantidad
y tamaño de entradas, rechaza rutas inseguras y duplicadas, recoge dependencias
Fabric y distingue clases, mixins, recursos y bibliotecas nativas. Devuelve candidato
a port de contenido, port manual, compilación nativa o validación pendiente. No
marca nada como instalado o compatible sin la validación posterior del runtime.

No se ejecuta un conversor arbitrario, no se decompilan mods automáticamente y no
se redistribuyen resultados. Tampoco se emparejan proyectos de distintos proveedores
sólo porque sus nombres se parecen. Las verificaciones de licencia, revisión/API,
firmas, dependencias y pruebas siguen siendo necesarias antes de activar un port.

Se refuerza además el instalador Fabric existente: requiere motor Java y loader
Fabric; una instancia Horizon no puede recibir JARs a través de esa ruta.

## Hotfixes Android

- Las comprobaciones automáticas HTTPS/nube actualizan el estado sin avisos de éxito
  ni ventanas repetitivas. El botón Actualizar conserva la confirmación explícita.
- Respuestas de una cuenta anterior se descartan; un backend sin migraciones listas
  no dispara consultas sucesivas a servicios incompatibles.
- Tocar la barra rápida usa las mismas acciones de selección de objetos que PC.
- Los campos del menú inicial solicitan teclado táctil y aceptan texto IME.
- Un fallo temprano del host nativo cierra la actividad en vez de dejarla negra.

## Lo que falta validar

Se requieren CI ARM64, APK final y dispositivo Android real para confirmar el teclado
con distintos fabricantes, controles, suspensión, recursos oficiales e instalación.
No se afirma que un emulador o un teléfono haya completado una partida. El panel
social Android dentro del juego y la sesión premium completa siguen pendientes.
La consulta pública previa a VIS Social aún respondía esquema 8 frente al 15 requerido;
estas rutas nuevas requieren despliegue del Worker y migraciones existentes.
