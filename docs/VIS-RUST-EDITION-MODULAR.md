# VIS Rust Edition — motor independiente del launcher

## Qué significa independiente

VIS Nexo es el único launcher. No instala ni abre Horizon Launcher, ni ejecuta
la preparación del juego al iniciar VIS. Java, VIS Social y las herramientas de
proyectos funcionan aunque nunca descargues Rust Edition.

Minecraft Rust Edition necesita un cliente de juego escrito en Rust. Por ahora
VIS compila ese cliente desde el repositorio público
https://github.com/horizon-rust/horizon (licencia del proyecto original);
NO equivale a un motor nuevo desarrollado desde cero. VIS lo ejecuta
directamente, sin una segunda ventana o gestor externo de Horizon Launcher.

## Distribución ligera

- VIS-Nexo-Windows-x64-Portable.zip: launcher, UI y metadatos de confianza.
- VIS-Nexo-Linux-x86_64-Portable.tar.gz / AppImage: launcher sin motores de juego.
- VIS-Rust-Edition-Windows-x64-Engine.zip: cliente y preparador Rust Edition.
- VIS-Rust-Edition-Linux-x86_64-Engine.tar.gz: los mismos para Linux.
- NO se distribuye Horizon Launcher. NO se incluyen JAR, texturas ni mundos
  protegidos por derechos de Minecraft.

El pipeline compila Horizon CLIENT y PREPARE directamente desde un commit Git
fijado por VIS_HORIZON_COMMIT. Luego crea un paquete de juego separado y deja
dentro del ejecutable VIS solamente su manifiesto:
source_repo, source_commit, URL oficial de nuestra Release, SHA-256 del paquete,
tamaño exacto y SHA-256 de cada recurso.

## Inicio directo desde VIS Nexo (v2.20)

Para el jugador solamente hay **dos motores: Minecraft Java y Minecraft Rust
Edition**. Desde **Mis instancias** se elige un motor y la versión. Al pulsar
**Jugar**, si el juego todavía no está instalado, VIS ejecuta la instalación
verificada y a continuación lo lanza sin otro clic. Si ya está preparado,
se inicia directamente.

Al compilar el cliente Rust oficial, VIS aplica un parche pequeño y verificable
de presentación a la versión exacta de su código fuente. En el lanzamiento
desde VIS configura `VIS_NEXO_DIRECT_START=1`: la ventana de juego permanece
oculta mientras se inicializan los recursos, **sin mostrar la pantalla de
arranque con marca Horizon**, y aparece cuando el renderer y el menú del
juego están listos. La inicialización del motor **no se salta ni se elimina**.
No es una modificación del JAR de Minecraft Java.

La pantalla de menú del juego y las pantallas necesarias de carga de mundos
siguen formando parte del cliente Rust. Este cambio no promete saltar
la carga técnica de mundos o inventarios; solo elimina la presentación
intermedia de Horizon al jugador.

El parche `vis-nexo-direct-game-window-v1` queda registrado en el manifiesto
de compilación; VIS rechaza distribuir o instalar como oficial un motor
sin esa modificación. Las instancias antiguas con un motor externo pueden
seguir mostrando su interfaz propia; para la experiencia unificada, elegí
el motor oficial de VIS.

**Validación pendiente:** comprobar en una GPU real de Windows y CachyOS que
la ventana se vuelve visible al finalizar el render y recibe foco correctamente.
La compilación y las pruebas automáticas no reemplazan esa comprobación.

## Experiencia del usuario

1. Descomprimí y abrí VIS Nexo. No hace falta el motor Rust Edition.
2. Entrá a **Instancias**, elegí Minecraft Rust Edition (VIS Rust).
3. Al elegir Instalar/Reparar o usar la opción avanzada **Instalar motor Rust
   Edition**, VIS descarga nuestro cliente del juego desde GitHub Releases.
4. Verifica HTTPS + URL del proyecto, tamaño máximo, SHA-256 del paquete,
   archivos permitidos y SHA-256 individual. Si falla, cancela sin activar
   ningún binario descargado.
5. El módulo se guarda en los datos VIS del usuario. Las instancias conservan
   sus mundos y reciben una copia local del cliente necesario. Ningún proceso
   del juego se inicia automáticamente con el launcher.
6. Una vez preparados los recursos oficiales para tu copia legítima del juego,
   **Jugar** ejecuta directamente el cliente Rust. No abre Horizon Launcher.

Los builds de PR tienen el enlace de descarga vacío intencionalmente: no se
descarga código nativo desde una Release que todavía no existe. Después de
crear la Release oficial etiquetada nexo-v*, el manifiesto del launcher apunta
a los archivos de motor subidos en esa misma Release. El primer uso necesita
Internet para ese paquete, pero después funciona sin volver a descargarlo.

## Seguridad y compatibilidad

- El motor sigue siendo código de Horizon aunque se distribuya como
  componente opcional de VIS. Eliminar también ese código exigiría implementar
  otro cliente completo de Minecraft en Rust (no incluido en esta etapa).
- Los builds antiguos con motor integrado y las instancias con motor propio
  continúan funcionando; un juego no se sustituye en caliente.
- El compilador Rust y JDK de preparación se utilizan en el CI o se gestionan
  por el instalador de juegos, no se instalan como dependencias del launcher.
- No se permite descargar un runtime arbitrario: la URL debe corresponder a
  nuestras Releases, y el SHA-256 se fija al compilar VIS.
- Un archivo externo manual solo se acepta según las rutas de integridad
  existentes. No se ejecuta automáticamente un Nightly no confiable.

## Comprobaciones de entrega

Pruebas de generación de paquetes: tools/test_vis_rust_engine.py;
regresiones de Windows/Linux portable: tools/test_windows_portable.py y
tools/test_linux_portable.py; validación de runtime Rust: src-tauri/src/rust_runtime.rs.

La compilación y el test no sustituyen una prueba real de descarga, preparación
y juego entre Windows 10/11, CachyOS y Linux. No anunciar producción hasta
aprobar esa prueba y comprobar la publicación de la Release con sus cuatro
archivos.
