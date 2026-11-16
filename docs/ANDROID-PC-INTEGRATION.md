# VIS Nexo + VIS McRust: integración PC/Android (14/11/2026)

## Objetivo y código ya disponible

VIS Nexo es el launcher de Windows/Linux y Android. La rama `codex/vis-portals-worlds` del launcher incluye el instalador Android, y la rama del mismo nombre en `JoseDaniel03/horizon-VISNEXO` incluye un host Android `NativeActivity` que enlaza **el mismo crate `horizon-client` y los hooks `horizon-official` que PC**. No se usa el port antiguo `com.visstudios.mcrust.preview` ni se instala Horizon Launcher.

- **PC:** el usuario crea su instancia Horizon 26.3, Nexo descarga el ejecutable del fork y recursos oficiales, verifica los archivos, prepara la instancia y lanza el juego. La sesión Premium se pasa por stdin; los mundos quedan en la carpeta de la instancia.
- **Android:** el usuario inicia sesión VIS Ceibo en Nexo, crea una instancia Horizon 26.3 Vanilla y pulsa Jugar McRust. Nexo consulta la release del fork y su manifiesto `vis-mcrust-release.json`, descarga el APK correspondiente, comprueba SHA-256, el certificado de firma y la versión instalada, y solicita **confirmación de instalación Android**. Después, al pulsar Jugar, envía usuario/ID de instancia/revisión de motor a la actividad nativa.
- **Motor Android:** utiliza el mismo código de juego/red/mundos que PC, pero emplea adaptación específica para ventana, entrada táctil, almacenamiento aislado y preparación de recursos. Los recursos originales provienen de Mojang, no del APK público.
- **Seguridad:** no se envían tokens VIS/Microsoft ni rutas arbitrarias al juego. Los datos de las partidas Android se almacenan en el sandbox privado de McRust, separados por cuenta e instancia.

## Una misma versión, sin fallback experimental

El manifiesto publicado exige Windows x64, Linux x64 y Android ARM64 desde un **único SHA completo de fuente**, misma versión Minecraft, protocolo, versión de datos y formatos de packs. El launcher valida los tres artefactos con su SHA-256 y rechaza releases incompletas, manipuladas o preliminares.

Esto permite distribución consistente, pero **no demuestra todavía compatibilidad de juego ni paridad total entre plataformas**.

## Bloqueos actuales de publicación

1. Estas modificaciones siguen en PRs abiertos y no están incorporadas a `main`: [launcher #4](https://github.com/JoseDaniel03/VIS-Nexo/pull/4) y [fork #1](https://github.com/JoseDaniel03/horizon-VISNEXO/pull/1).
2. El fork solo tiene releases antiguas de escritorio (`visgame-9aa089251f86` y `visgame-2d5c6e56a7ba`). Ninguna incluye un APK Android del mismo motor ni el nuevo manifiesto; por diseño, las nuevas instalaciones compartidas no hacen fallback.
3. Para publicar se necesita un certificado de firma **estable y privado** en GitHub Actions del fork: `VIS_MCRUST_ANDROID_KEYSTORE_B64`, `VIS_MCRUST_ANDROID_STORE_PASSWORD`, `VIS_MCRUST_ANDROID_KEY_PASSWORD` y `VIS_MCRUST_ANDROID_KEY_ALIAS`. Solo colocarlos en Secrets; jamás commitearlos ni incluirlos en el APK como recursos.
4. El workflow del fork compila PC en PR; compila/valida/firma el APK Android y publica la release de tres plataformas **solo desde `main`**, cuando todos los jobs funcionan. Las verificaciones de Android de PR son de compilación de código, no prueba de instalación real.
5. En Android **todavía no está implementada la autenticación Microsoft/Minecraft Premium para el cliente McRust**: Ceibo por sí solo permite identidad VIS, no acceso a servidores Java online-mode. Java Edition Android, chat E2EE multidispositivo, voicechat, overlays y sincronización de mundos entre dispositivos también requieren trabajo adicional.

## Comprobaciones antes de declarar jugable

- Test de instalación limpia desde Nexo PC Linux/Windows y Nexo Android, sin Horizon Launcher y sin tener Minecraft preinstalado.
- Comprobar permiso de fuentes desconocidas, confirmación/cancelación, firma inesperada, caché corrupta y reiteración de Jugar.
- Preparar mundos locales en Android, guardar/cerrar/reabrir, enviar app a segundo plano y retomar sin bloquear la interfaz.
- Ejecutar un servidor de prueba con PC y Android del mismo commit, probar inventarios, chunks, entidades, dimensiones, packs y multiplayer.
- Incorporar login Microsoft en Android mediante un flujo oficial y probar una cuenta propietaria en servidores con autenticación online.
- Validar fallback ante redes interrumpidas, espacio insuficiente, permisos y medios externos, sin pérdida de saves.
- Ejecutar pruebas de dispositivos ARM64 físicos, aparte del cargo check y GitHub Actions.

## Backend social

La rama del launcher incluye Portals, invitaciones, server voice y migraciones Cloudflare D1 `0011`–`0015`. Este trabajo no ejecuta despliegues de Cloudflare; la federación Premium entre distintos dispositivos y voz Android siguen pendientes. Los secretos de Cloudflare/TURN permanecen exclusivamente en entornos de GitHub Actions.
