# VIS Nexo 2.17 — Universe + Worlds, acceso compartido y Horizon

## Qué cambia

- **VIS STUDIOS**, desde el editor administrativo de Universe, configura una vez por proyecto: motor de Minecraft (Java/Horizon), versión, modloader (Vanilla/Fabric en Java) y versión de Fabric cuando corresponde. También habilita o deshabilita la ejecución.
- Un usuario normal abre un proyecto publicado y presiona **Instalar y jugar**. Para una instalación nueva, únicamente elige **carpeta absoluta de instalación** y **memoria RAM** (1024 a 32768 MiB). La selección de motor/versión/loader viene exclusivamente del proyecto, se valida nuevamente en Rust y no se puede sobrescribir con una llamada Tauri falsificada.
- **VIS Worlds compartido en un mismo usuario del sistema operativo:** todos los perfiles de VIS creados sobre el **mismo almacenamiento local** encuentran instancias instaladas de otros perfiles. Los paquetes de Minecraft, assets, librerías y mods son reutilizados en solo lectura; los mundos, opciones y logs de quien entra con otro perfil se guardan en un árbol diferente. Se puede configurar su RAM de forma individual. No se comparten contraseñas, sesiones Microsoft ni cuentas Ceibo.
- **Minecraft Rust Edition (Horizon):** VIS busca o descarga directamente el *juego* firmado `horizon-client` + `horizon-prepare`; obtiene los recursos oficiales Minecraft 26.3 y un JDK 25 administrado por VIS y prepara Horizon. No instala ni ejecuta Horizon Launcher. La autenticación Microsoft y la posesión legítima de Minecraft siguen siendo obligatorias y aún deben aportarse mediante la sesión temporal compatible; el OAuth Microsoft dentro de VIS todavía no está finalizado.
- Las instalaciones antiguas y sus datos se mantienen; el juego/version de proyectos nuevos obtiene un identificador propio. Cambiar un proyecto no destruye una versión anterior ni mueve mundos automáticamente.

## Guía: creación de un proyecto jugable

1. Ingresar como administrador `vis_studios` y abrir el editor de VIS Universe.
2. Elegir motor Java o Horizon; para Java, versión Minecraft y Vanilla/Fabric; habilitar juego y guardar proyecto.
3. Iniciar sesión con otro perfil VIS en la misma computadora, abrir el proyecto y pulsar **Instalar y jugar**.
4. Elegir carpeta exclusiva y RAM. El launcher registra la instancia, usa Smart Install para buscar archivos existentes, descarga los faltantes, prepara el runtime y, si todas las condiciones se cumplen, inicia el juego.
5. Al volver a abrir el proyecto debería ofrecer **Jugar** si coincide motor, versión y loader y la instalación continúa íntegra.

## Carpetas y protección de datos

- Cada instancia nueva lleva su runtime bajo su directorio específico, en `.vis/runtime/`.
- Las instalaciones de otros usuarios VIS se identifican por `source_owner` y **no** se reescriben desde otro perfil.
- Los visitantes Java juegan con partidas/opciones/logs aislados en `shared-player-data/<visitante>/<propietario>/<proyecto>/<instancia>/`. Horizon también tiene una ruta propia para el visitante y exige su **propia** sesión Microsoft.
- El uso compartido es **entre perfiles VIS que usan la misma cuenta de Windows o Linux y raíz de datos de la aplicación**, no entre cuentas separadas del sistema operativo o entre computadoras diferentes. No es sincronización cloud.
- Los mundos y las configuraciones existentes no se mueven de forma implícita. Si se quiere cambiar una carpeta ya instalada, utilizar exportar/importar; no sobrescribirla.

## Limitaciones importantes

- **No se ha compilado Rust ni se ha ejecutado Minecraft/Horizon en esta entrega**: la comprobación `cargo check`, los tests Rust, la instalación real del JDK/Mojang/Horizon y la autenticación Microsoft requieren pruebas en Linux/Windows con Internet.
- Horizon tiene API experimental; sus argumentos y empaquetado pueden cambiar. El integrador necesita revisar el release instalado si aparece un error.
- Forge, NeoForge y Quilt no están implementados aquí, salvo planificación. Java soporta Vanilla/Fabric en el código.
- VIS Ceibo/Humile remotos todavía no están desplegados; el hecho de compartir una instalación entre perfiles VIS locales no significa cuentas en la nube.
- El modo offline Java utiliza nick/UUID local y **no** ofrece autenticación oficial en servidores premium. Horizon requiere Microsoft.

## Compilación y tests en CachyOS

```sh
npm install
npm run validate
npm run check:release
python3 tools/test_vis217.py
cargo check --manifest-path src-tauri/Cargo.toml --all-targets
cargo test --workspace
npm run tauri dev
```

Los tests estáticos y Chromium usan un puente Tauri simulado para verificar la interfaz; **no** demuestran que el proceso de Minecraft se lance en una instalación real. Para publicar, probar un lanzamiento limpio Vanilla, uno Fabric, uno Horizon firmado con cuenta Microsoft, y una segunda cuenta VIS entrando a una instancia compartida, manteniendo los mundos separados.
