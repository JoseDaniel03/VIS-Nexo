# Android 0.4.2: preparación, sesiones y datos

- Primera apertura: pantalla de preparación antes del acceso. Instalación de McRust abre la autorización especial oficial; continuar es opcional. Permisos y publicaciones accesibles desde Cuenta y desde login. HTTPS no tiene un permiso especial. No se solicita acceso general a archivos.
- `Mantener mi sesión iniciada` está desmarcado por defecto en acceso/registro. Solo después de la autenticación completa, incluido MFA, se guarda el bearer nativo con AES-GCM y clave Android Keystore, en noBackupFilesDir usando AtomicFile. Nunca contraseña, desafío MFA ni tokens en WebView/localStorage/Intent. Sin consentimiento la sesión es temporal.
- Restauración: verificación remota de `/v1/account` e identidad exacta antes de activar. Red caída conserva el archivo cifrado; 401/403 lo borra. Logout limpia la sesión local y solicita revocación remota; los cambios de contraseña invalidan también la persistencia. Transiciones de acceso serializadas para evitar que una respuesta tardía resucite una sesión cerrada.
- Microsoft: device-code oficial ya existente, ahora puede conservar su refresh token cifrado con el mismo consentimiento y obtener de nuevo el perfil Minecraft al abrir Nexo. No se traspasan tokens al juego. Microsoft NO reemplaza todavía el login de VIS Ceibo ni habilita servidores premium en Android.
- El botón de actualizaciones abre las publicaciones oficiales; no instala APKs silenciosamente. McRust se verifica/actualiza al pulsar Instalar/Jugar.
- Nuevas instancias: interno o externo específico de McRust. No es un selector libre de carpetas SAF ni una elección de dónde Android instala la APK. El almacenamiento externo puede estar en el mismo dispositivo físico. No se mueven mundos existentes.
- Borrado: confirmación explícita, llamada al proveedor de McRust autorizado solo para UID del paquete Nexo, rechazo con juego activo, validación owner/id y exclusión de enlaces fuera del árbol. Solo se quita el perfil Nexo tras confirmación nativa. Reintento idempotente después de borrado parcial. Un motor viejo no permite borrar datos y debe actualizarse; si McRust no está instalado se limpia el perfil local.

## Verificación y límites

`cargo check --tests` del shell móvil en Linux; comprobación real de JNI/instalador en harness host; pruebas JS de formularios y preparación; generador Android idempotente; pruebas JVM del proveedor real con stubs Android y directorios temporales. Las últimas verifican exclusión con juego activo, autorizaciones, ubicaciones, borrado, reintentos y symlinks.

Compilación APK/Keystore y comportamiento real en Android requieren CI y teléfono. No se ha ejecutado el juego con mundos del usuario. El nuevo proveedor y las rutas deben publicarse junto con el motor actualizado.

Referencias: https://developer.android.com/training/permissions/requesting ; https://developer.android.com/training/data-storage/app-specific ; https://developer.android.com/privacy-and-security/keystore .
