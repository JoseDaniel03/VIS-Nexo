# VIS Nexo: instalación Android, marca y amigos

El error recibido durante FileProvider ocurre antes de abrir el instalador. El permiso de instalar aplicaciones ya se había consultado. El mensaje anterior ocultaba el tipo de excepción, por lo que no identifica por sí solo la causa exacta en el teléfono.

La nueva versión carga AndroidX FileProvider mediante el ClassLoader de la Activity al entrar desde Rust/JNI, genera un proveedor propio (`McRustFileProvider`) para evitar colisiones de manifiestos y entrega al instalador un permiso temporal de lectura mediante URI/ClipData. La raíz compartida sigue limitada a `cache/mcrust/`. No se comparten carpetas de cuentas, mundos ni datos privados. La configuración repara entradas anteriores y es idempotente. El diagnóstico distingue clases ausentes, configuración de URI y rechazo de permisos sin copiar mensajes Java que puedan contener rutas.

Pruebas: dos regresiones del generador de manifiesto, comprobación Rust/JNI del instalador sin ejecutar el APK, contratos Android y pruebas de publicación del launcher. La prueba final en un teléfono requiere instalar este nuevo Nexo; el APK anterior no puede incorporar la corrección por actualizar solo McRust. No se afirma haber reproducido el fallo original en un dispositivo.

El puente de amigos usa la lista del estado autenticado de la nube aunque una operación de instancias haya reemplazado la copia local del launcher. Rechaza una identidad remota distinta de la cuenta activa. Una alerta de clave de un contacto no equivale a desconectar toda la red; las verificaciones de claves siguen activas. Reconectar desde el juego pide una sincronización y los errores de red se muestran en la pantalla. No se simulan amigos ni estados conectados.

La pantalla del juego usa fondo/separadores de Minecraft, título centrado y controles nativos, sin la tarjeta violeta arrastrable anterior. La marca visible de la versión es VIS Nexo; los identificadores de motor, protocolo Minecraft y datos guardados conservan su compatibilidad.

Discord requiere el Application ID público de una aplicación propia. El motor acepta `VIS_DISCORD_APPLICATION_ID` desde las variables de compilación del repositorio, y usa el asset opcional `vis_nexo`. No se necesita un token de bot. Hasta configurar una identidad válida no publica la actividad bajo la aplicación de otro proyecto. El nombre visible de la aplicación y sus imágenes se administran en Discord; no se presenta como un cambio ya aplicado allí.
