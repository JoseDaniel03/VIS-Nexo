# VIS Nexo — instancias independientes y mods de proyecto

## Estructura de instalaciones

Las instalaciones **nuevas y reparadas** se guardan bajo la carpeta elegida
para la instancia. No se instalan versiones, bibliotecas, ejecutables ni
recursos en `AppData/Roaming/.minecraft` ni en el runtime compartido de VIS.
Un archivo que esté en `.minecraft` de otro launcher puede reutilizarse como
**origen de copia solo lectura**, siempre que coincida su SHA-1 oficial. La
copia final se almacena dentro de la instancia; no es una dependencia
externa para ejecutar el juego.

Ejemplo de **Java / Fabric**:

```text
Mi instancia/
  .vslauncher/
    install.json
    version.json
    fabric.json
    natives/
    project-mods.json
    retired-mods/            # versiones de mods retiradas
  .vis/
    runtime/
      versions/<version>/<version>.jar
      libraries/
      assets/indexes/
      assets/objects/
      assets/log_configs/
    java-runtimes/
      temurin-<major>/       # JRE/JDK privado y verificado
    config/
    cache/
    tmp/
  mods/
  resourcepacks/
  shaderpacks/
  saves/
  options.txt
```

El punto en `.vis` hace que la carpeta sea oculta en algunos exploradores,
pero **toda esa información pertenece a la carpeta de la instancia**.

**Horizon (Rust Edition)** instala además:

```text
Mi instancia Horizon/
  .vis/
    horizon-engine/<SHA>/     # horizon-client / horizon-prepare y lock
    horizon-preparation/
    horizon-resources/
    minecraft-base/
      .vis/runtime/          # assets, libraries, JAR cliente de Mojang
      .vis/java-runtimes/    # JDK 25 privado
      .vis/minecraft-server.jar
      .vslauncher/version.json
  saves/ ...
```

Horizon **no necesita el Horizon Launcher** ni un Minecraft global. Su
base de Mojang se prepara con los ficheros oficiales de la versión fijada
por `research-lock.json`.

Al importar un ZIP portable, VIS intenta reconstruir y verificar las rutas
de Horizon dentro de la nueva carpeta. Si algún componente falta o no
coincide con las huellas firmadas, la instancia requiere reparación; no
se intenta ejecutar una ruta vieja de otra computadora. Los archivos
personales no se borran durante esta revisión.

Las instalaciones antiguas que dependían del antiguo runtime global de
VIS pasan a **Reparar**, que reconstruye la base dentro de la propia
instancia sin eliminar `saves/`, `config/`, `mods/` ni `options.txt`.

## Cómo administrar mods desde un proyecto

1. Abrir el **Editor de proyectos** → **Datos**.
2. Elegir **Minecraft Java** y **Fabric**, seleccionar versión MC y Fabric Loader.
3. Buscar mods en **Modrinth** desde el panel de mods. Añadir los que quieras,
   hasta 32 identificadores únicos. Quitar un mod elimina solo la selección
   del proyecto, no los archivos del usuario.
4. Guardar el proyecto y publicarlo por VIS Universe para distribuir la lista.
5. Cuando se instale el proyecto, VIS prepara Minecraft y descarga sus mods
   con dependencias requeridas dentro de **esa instancia**.
6. Si se cambia la lista, el jugador puede seleccionar **Actualizar mods**;
   el launcher también revisa la lista antes del próximo inicio del juego.

**Importante:** los mods de Modrinth soportados en esta tanda son para
**Java + Fabric**. Para Horizon hay que establecer un repositorio y
un formato de addons compatibles con su API nativa; intentar cargar
JARs Fabric en Horizon sería incorrecto, así que se rechaza esa combinación.

## Actualización sin borrar datos

- Se consultan versiones compatibles con el Minecraft de la instancia y
  dependencias obligatorias en Modrinth.
- Se verifican los hashes antes de mover nada a `mods/`.
- Las descargas se preparan en una carpeta temporal de esa misma instancia.
- Los mods instalados por el proyecto quedan registrados con nombre y SHA-1.
- Los mods que el jugador importó por su cuenta **no son propiedad del
  proyecto**. Si tienen el mismo archivo que un mod elegido, se conservan
  y no se eliminan al retirar el mod del proyecto.
- Al actualizar, los archivos **administrados** retirados se mueven a
  `.vslauncher/retired-mods/` por seguridad. Nunca se borran partidas,
  configuraciones ni mods ajenos.
- Si hay un choque de nombre con un mod personal distinto, o el jugador
  modificó un archivo administrado, la actualización se detiene en vez de
  sobrescribirlo sin permiso.
- Cuando la configuración y archivos coinciden, iniciar el juego no
  genera descargas adicionales.

Las actualizaciones de contenido (por ejemplo, entre versiones Minecraft
distintas o entre Java y Horizon) generan una instancia diferente; no se
instalan archivos binarios de otra edición encima de los existentes.

## Validación

Las pruebas de Rust cubren compatibilidad y reparación de runtimes
antiguos, rutas de caché hijas, separación de perfiles, formato de IDs,
archivos sospechosos, y retirada de mods administrados preservando mods
personales. GitHub Actions también comprueba el frontend JS y el puente
Tauri en Linux y Windows.

Una compilación verde **no sustituye** una instalación real con una
biblioteca de Minecraft de varios GB, conexión interrumpida, disco lleno,
permisos restringidos y prueba de juego en un PC. Esas pruebas siguen
siendo necesarias antes de publicar una versión estable.

**Linux:** distribución exclusivamente `AppImage`, no `.deb`.
