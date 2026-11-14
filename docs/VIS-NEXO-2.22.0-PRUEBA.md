# VIS Nexo 2.22.0 / Android 0.4.0 — integración Horizon

Fecha: 2026-11-14. Esta es una **compilación de prueba** desde la rama `codex/vis-portals-worlds`. No declara paridad de juego móvil ni release final.

## Distribuciones del launcher

- **Windows x64:** ZIP portable `VIS-Nexo-Windows-Portable.zip` (contiene `VIS-Nexo.exe`). No necesita instalar el launcher. Requiere WebView2 Runtime.
- **Linux x86_64:** AppImage de VIS Nexo. En CachyOS, permitir ejecución del archivo AppImage; cada instancia usa sus propios archivos y runtimes.
- **Android ARM64:** `VIS-Nexo-Android-ARM64-Debug.apk`, firmado con clave de depuración de Actions. La clave puede cambiar entre builds; respaldar datos antes de desinstalar una APK anterior.

Build de escritorio: https://github.com/JoseDaniel03/VIS-Nexo/actions/runs/43613399534

Build Android: https://github.com/JoseDaniel03/VIS-Nexo/actions/runs/43613022887

**No se incluye Horizon en los binarios del launcher**: su instalación se realiza desde Nexo para cada instancia. Esto mantiene pequeño el launcher, respeta archivos de Minecraft y evita usar Horizon Launcher por separado.

## Recorrido de prueba Windows/Linux

1. Iniciar sesión en VIS Nexo. Para acceder a servidores Java Premium, usar Microsoft con propiedad del juego. Las cuentas VIS offline no acreditan propiedad de Minecraft.
2. Abrir Instancias, crear una de tipo **Minecraft Rust / Horizon** y seleccionar Minecraft **26.3** y carpeta portable.
3. Instalar: Nexo consulta la release de `JoseDaniel03/horizon-VISNEXO`, comprueba el contrato de tres plataformas, descarga el ejecutable correspondiente con SHA-256, obtiene recursos oficiales Mojang y prepara `horizon-prepare`.
4. Jugar: Nexo lanza el ejecutable nativo del juego, sin ejecutar Horizon Launcher. Comprobar que el usuario, la carpeta `saves`, las opciones y los servidores permanezcan al reiniciar.
5. Probar Reparar tras interrupción de descarga y dos perfiles VIS en una misma instancia. No borrar mundos al quitar la instancia del registro.

## Recorrido Android

1. Instalar la APK de VIS Nexo ARM64 de prueba.
2. Iniciar sesión con la identidad VIS Ceibo, crear instancia **Horizon 26.3 Vanilla** y tocar **Jugar McRust**.
3. Nexo **solo** aceptará una release de Horizon que incluya APK firmado y manifiesto `vis-mcrust-release.json` del mismo SHA que Windows/Linux. Pedirá permiso y confirmación de Android para instalar el juego.
4. Tras confirmar, pulsar Jugar nuevamente. El APK de McRust recibe únicamente propietario, ID de instancia, nombre offline y SHA del motor. No recibe tokens ni contraseñas.
5. Comprobar en móvil real: instalación, permisos, inicio, recursos, mundo nuevo, guardado, segundo plano, reanudación y conexión a servidor de pruebas.

## Bloqueo de publicación del juego Android unificado

El fork todavía no posee una release que cumpla el contrato compartido. Su PR `codex/vis-portals-worlds` (https://github.com/JoseDaniel03/horizon-VISNEXO/pull/1) requiere las cuatro variables de firma privada en GitHub Actions: `VIS_MCRUST_ANDROID_KEYSTORE_B64`, `VIS_MCRUST_ANDROID_STORE_PASSWORD`, `VIS_MCRUST_ANDROID_KEY_PASSWORD` y `VIS_MCRUST_ANDROID_KEY_ALIAS`. No guardarlas en archivos del repo. Se publicará el manifest solo cuando Windows, Linux y Android compile y se verifique el APK.

Hasta que exista esta release, el botón de Nexo fallará intencionalmente con un error claro de **motor compartido aún no publicado**, en lugar de instalar el port Android antiguo.

## Límites de esta prueba

- El login Ceibo Android no sustituye una sesión Microsoft Premium para servidores Java `online-mode=true`. OAuth Minecraft Premium Android sigue pendiente.
- No se ha probado el port de McRust en teléfono físico ni el multiplayer PC↔Android real.
- Java Edition Android, sincronización de mundos, audio de voz e identidad E2EE entre dispositivos no están completados.
- El login/proyecto social puede depender de Cloudflare D1 migraciones 0011–0015 y servicios externos desplegados. Compilar no los activa.
- Estas compilaciones de Actions son vistas previas sin firma de editor de Windows/Linux; no constituyen una versión estable pública.

## Diagnóstico de esta tanda

GitHub CI verifica `npm run validate`, `npm run check:release`, `cargo check --all-targets --locked` y tests del workspace antes de publicar los artefactos del launcher. Cada build debe indicar `success` y aportar su SHA-256. La prueba física se realiza por separado, nunca se infiere solo por la compilación.
