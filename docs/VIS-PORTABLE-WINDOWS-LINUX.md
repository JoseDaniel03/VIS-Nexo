# VIS Nexo — Portable Windows + Linux (sin instalación)

**Objetivo:** descargar, extraer y abrir VIS Nexo. Sin NSIS, MSI, DEB, RPM,
sudo, ni instalación de Rust, Node.js o Java para utilizar el launcher.
El motor de Rust Edition se compila desde el código oficial en CI y se publica como descarga opcional separada.

## Windows 10 y 11 x64

Archivo: **VIS-Nexo-Windows-x64-Portable.zip**

1. Descomprimí todo el ZIP en una carpeta de tu elección.
2. Abrí **VIS Nexo.exe** con doble clic.
3. No hace falta la carpeta Horizon. Rust Edition descarga el motor cuando lo elegís.
4. SmartScreen puede mostrar advertencias si Windows no reconoce la firma
   del ejecutable. No es necesario desactivar sus protecciones globalmente.
5. Tauri necesita Microsoft Edge WebView2 Runtime. Windows 10/11 actualizados
   lo incluyen normalmente; Windows viejos o modificados pueden carecer de él.
   El ZIP no ejecuta ni incluye un instalador para WebView2.

El empaquetador Windows verifica el archivo PE y el manifiesto SHA-256 del motor Rust Edition opcional. El marcador .vis-portable bloquea los
intentos de actualización mediante instaladores NSIS.

## Linux x86_64 — CachyOS, Arch, Ubuntu y otros

Archivo: **VIS-Nexo-Linux-x86_64-Portable.tar.gz**

1. Extraé todo el TAR.GZ conservando permisos de ejecución.
2. Abrí **VIS-Nexo.AppImage**. No es un instalador.
3. Alternativa: abrí **Abrir VIS Nexo.sh**. Si FUSE no está disponible,
   utiliza el modo --appimage-extract-and-run sin instalar FUSE.
4. La AppImage contiene el frontend; el motor Rust Edition se descarga por separado.
5. Si el gestor de archivos no permite ejecutar el script desde la GUI,
   abrilo en una terminal (sin privilegios de administrador).

El empaquetador Linux no requiere incluir los binarios del motor Rust. El paquete del motor tiene su propio manifiesto de hashes fijados en VIS. El TAR.GZ conserva
los bits de ejecución de AppImage y del script.

**Límite técnico:** AppImage reduce las dependencias del sistema pero no es
un sistema operativo entero. Algunas distros antiguas o configuraciones
gráficas pueden requerir ajustes, por incompatibilidad de glibc, kernel,
gráficos o arquitecturas. No se garantiza ejecución en toda distro sin
haberla probado.

## ¿Dónde se guardan los mundos y las cuentas?

**El launcher es portable, pero los datos de usuario aún no viajan dentro
del ZIP o TAR.GZ.** Las cuentas VIS, configuraciones, instancias y mundos
continúan en los directorios de usuario del sistema operativo. Esto permite
reemplazar la carpeta del launcher sin borrar los mundos.

Para trasladar una cuenta y todos sus mundos a otra computadora por USB,
será necesario un exportador o migrador de perfiles. Copiar solamente el
launcher no mueve esos datos; no se deben sobrescribir mundos ajenos.

## Actualizar sin instalador

1. Cerrá VIS Nexo.
2. Descargá el siguiente ZIP de Windows o TAR.GZ de Linux.
3. Reemplazá los archivos portables, dejando intactos los directorios de datos.
4. Abrí la nueva versión. No utiliza instaladores para actualizarse.

## Flujos GitHub

- .github/workflows/vis-nexo-build.yml: artefactos Windows y Linux portables.
- .github/workflows/vis-release.yml: publica ZIP Windows y TAR.GZ Linux por tag.
- tools/test_windows_portable.py: regresiones Windows sin instalador.
- tools/test_linux_portable.py: permisos, rutas y seguridad de Horizon Linux.
- No se publica .deb, .rpm, MSI, NSIS ni un instalador adicional.
- Los usuarios no necesitan instalar Rust, Cargo, Node o JDK para abrir VIS.

Rust Edition se obtiene la primera vez desde GitHub Releases y después se guarda en los datos de VIS. El juego continúa basándose en el cliente Rust del proyecto Horizon, pero Horizon Launcher no es necesario. Ver docs/VIS-RUST-EDITION-MODULAR.md.

Los chats de VIS Humile/Ceibo se conectan por Internet al servicio Cloudflare;
no se instala un servidor social en el dispositivo del jugador.
