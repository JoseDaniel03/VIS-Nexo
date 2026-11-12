# VIS Nexo Lite + Horizon portátil desde el fork

Motor: https://github.com/JoseDaniel03/horizon-VISNEXO
Compilaciones: https://github.com/JoseDaniel03/horizon-VISNEXO/actions/workflows/vis-nexo-portable.yml

## Arquitectura

**VIS Nexo** es el único launcher para Windows y Linux. Incluye cuentas, Microsoft OAuth, proyectos, Java/Fabric y VIS Portals, pero no empaqueta binarios de Horizon. Se instala una vez y descarga el motor elegido cuando hace falta.

**VIS Horizon** contiene únicamente horizon-client, horizon-prepare, research-lock.json, fuentes exportadoras para la preparación, licencia MIT y avisos de terceros. No contiene Horizon Launcher, Minecraft, mundos ni assets de Mojang.

## Flujo automático

1. Elegir Minecraft Java o Minecraft Rust/Horizon y la carpeta local independiente.
2. En Horizon, seleccionar Minecraft 26.3 (única versión implementada actualmente).
3. Pulsar Instalar. VIS consulta los releases visgame-* del fork, elige el archivo Linux o Windows y descarga en una carpeta temporal dentro de la instancia.
4. Verifica ruta exacta del repositorio, SHA-256 del asset según la API oficial GitHub, commit indicado en el tag y en el manifiesto interno, hashes de ejecutables, fuentes y research-lock. Rechaza enlaces simbólicos, rutas de escape y archivos excesivos.
5. Renombra la instalación comprobada de forma atómica bajo la carpeta de la instancia.
6. Descarga Minecraft 26.3 desde Mojang y JDK 25 desde Temurin para preparar recursos con horizon-prepare.
7. Ejecuta horizon-client desde VIS Nexo. Los mundos y configuraciones permanecen locales.

Estructura aproximada:

    Instancia/
      .vis/
        horizon-engine/visgame-COMMIT/vis-horizon/
          horizon-client[.exe]
          horizon-prepare[.exe]
          research-lock.json
          vis-horizon-source.json
          mods/horizon/src/test/java/dev/horizonlab/parity/
        minecraft-base/
          .vis/runtime/versions/
          .vis/runtime/libraries/
          .vis/runtime/assets/
          .vis/java-runtimes/temurin-25/
        horizon-resources/
        horizon-preparation/
      saves/

No se escribe en AppData/Roaming/.minecraft ni en ~/.minecraft global. VIS puede leer archivos previos verificables para copiar y reducir descargas, pero el juego se ejecuta desde la instancia.

## Distribución de VIS Nexo

https://github.com/JoseDaniel03/VIS-Nexo/actions/workflows/vis-nexo-build.yml

- Windows: instalador NSIS y ZIP de VIS-Nexo.exe portable, sin necesitar ejecutar un instalador (requiere WebView2 Runtime).
- Linux: AppImage solamente, sin incluir Horizon.
- Java/Fabric: archivos y Java dentro de la carpeta elegida para la instancia.

Objetivo de peso del AppImage: aproximadamente 50 MB, pero su cumplimiento debe medirse tras compilar; las bibliotecas AppImage/WebKitGTK podrían impedir llegar a ese tamaño.

## Seguridad

La publicación del fork utiliza HTTPS GitHub, digest SHA-256 servido por la API GitHub y manifiesto SHA-256 de archivos. **No es una firma independiente del desarrollador ni la firma oficial Ed25519 de Horizon**. Para distribución pública conviene añadir una firma propia mantenida fuera de los runners de compilación.

El fork y las Actions de construcción no reciben tokens de Cloudflare ni credenciales VIS Social. No se redistribuye contenido propietario de Minecraft. Para Horizon se necesita una cuenta Microsoft con Minecraft Java Edition.

## Pendientes de validación

- Compilación y publicación real de los dos paquetes en el fork.
- Prueba de instalación y arranque en Windows y Linux con una carpeta totalmente vacía.
- Pruebas con red interrumpida, disco lleno, reparación y archivos modificados.
- Medición del tamaño, consumo RAM y CPU reales del nuevo launcher.
- Comprobación de login Microsoft real con un propietario de Minecraft.
