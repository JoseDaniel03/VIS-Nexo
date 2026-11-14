# VIS Nexo Android — launcher + instalador del motor McRust compartido

**Estado (14/11/2026): implementación en PR, todavía sin una release completa de PC/Android ni prueba física.** El código de esta rama reemplaza el antiguo handoff experimental con un instalador que usa el manifiesto `vis-mcrust-release.json` del fork `JoseDaniel03/horizon-VISNEXO`. Solo acepta paquetes provenientes del **mismo commit de motor** que Windows/Linux; nunca descarga el viejo `com.visstudios.mcrust.preview`.

**Flujo previsto:** iniciá sesión VIS Ceibo, creá una instancia `Horizon / 26.3 / Vanilla` en Mundos y tocá **Jugar McRust**. Nexo verificará el catálogo GitHub, la huella SHA-256 del APK, y solicitará permiso y confirmación Android para instalar `com.visstudios.mcrust`. Al tocar Jugar nuevamente abrirá esa instancia. Los mundos se guardan dentro del sandbox privado de la app McRust, separados por usuario e instancia; la carpeta de metadatos del launcher no es donde se guardan las partidas.

**Bloqueo actual:** todavía no hay un release del fork con Windows, Linux y Android firmados bajo el mismo manifiesto. Mientras falte ese release, el launcher muestra un error descriptivo y no intenta usar otro motor. Para publicarlo hay que fusionar el PR del fork, configurar los cuatro secretos de firma Android persistente y pasar el workflow de las tres plataformas. Las acciones de cargo-check no prueban el APK ni el inicio real.

**Identidad:** el juego Android recibe solo nombre offline, propietario, ID de instancia y SHA de motor. No recibe contraseñas, tokens o rutas. VIS Ceibo **no equivale** a autenticación oficial Minecraft Premium; todavía falta OAuth Microsoft/Minecraft en Android para servidores Java con `online-mode=true`. Tampoco están listos Java Edition Android, chat E2EE entre dispositivos, voicechat ni sincronización de partidas PC↔Android.

Más detalles y criterios de aceptación: [integración PC/Android](../docs/ANDROID-PC-INTEGRATION.md).

## Funciones sociales heredadas

## Qué funciona (Android companion v0.2.0)
- Conexión HTTPS con el Worker de VIS Ceibo (endpoint `/health`).
- Registro, contraseña Argon2id→Ed25519, MFA TOTP y códigos de emergencia,
  recuperación de cuenta, cambio de contraseña con prueba de la anterior.
- Tokens bearer y tickets MFA **solo en memoria Rust**, no se exponen
  al WebView ni se escriben en almacenamiento persistente.
- Portals: amigos, solicitudes recibidas/enviadas, aceptación, apodos, estados
  (online/ausente/ocupado/invisible/offline), estado personalizado y presencia.
- Ceibo: correo verificado y cambio dual, nombre visible, @ID pública, inicio
  y administración MFA, códigos de rescate, ver/revocar sesiones, avatar WebP,
  skins PNG y borrado de skin.
- Universe: catálogo, suscripciones, miembros, notas de ingreso, políticas
  de admisión, solicitudes y moderación comunitaria, videos/enlaces.
- Usuarios autorizados: metadatos de proyectos, miembros y equipos,
  permisos de superadministración (roles, admin global, deshabilitar cuentas).
  **Todas las decisiones se autorizan en Cloudflare**, no por la UI móvil.
- VIS Worlds: creación y listado de instancias locales Java/Horizon,
  elección de versión y loader, vinculación opcional a proyecto VIS Universe,
  carpetas sandboxed de mundos, mods, configuración, packs y backups. Quitar
  una instancia de la lista **conserva todas sus carpetas**.
- UI touch-first con formularios, avatar/skin y botones accesibles;
  scripts ES modules; pruebas de contrato nativas y de la interfaz.

**Servidor requerido:** las funciones MFA y recuperación por correo solo son
operativas cuando el Worker real despliega el esquema D1 0013 y cuando Resend
está configurado con un dominio verificado. La APK no despliega los servicios.

**La creación de instancias prepara metadatos y carpetas.** Para Horizon 26.3 Vanilla, el botón Jugar ejecuta el instalador y el handoff del motor compartido, siempre que exista un release válido del fork. Java sigue sin motor Android. Eliminar una instancia de la lista no elimina `worlds/` ni `backups/`.

**Todavía pendiente:** validar en teléfono físico la ejecución del port Horizon Android compartido, autenticar Minecraft Premium en Android, instalar Java, respaldar/importar mundos del juego, copiar partidas entre PC/Android, chat E2EE multidispositivo, voz, notificaciones push, sesiones persistentes y passkeys/WebAuthn. No afirmar que se puede jugar hasta verificar instalación de APK, recursos, mundo y conexión a servidor.

### Chat E2EE multidispositivo
El escritorio VIS Portals utiliza una sola clave ECDH P-256 privada por cuenta,
guardada como CryptoKey no extraíble en IndexedDB y anclada con TOFU. D1 publica
una clave de destinatario. Android no puede derivar esa clave de manera segura
y no debe usar un servidor de mensajes en texto plano ni reemplazarla
silenciosamente. Para sincronizar chats en varios dispositivos es necesario
un protocolo de **identidades por dispositivo, fan-out de sobres cifrados,
verificación de huellas/QR y migración de claves** en ambos clientes. Se deja
fuera de esta APK para preservar el cifrado de los mensajes existentes.

## Limitaciones de conexión
El servidor público configurado en Rust es
`https://vis-social.defreitascarranza-845.workers.dev`. Debe ejecutar las
migraciones D1 0012/0013 para aceptar MFA/recuperación; de otro modo la pantalla
muestra el estado pero la autenticación moderna puede no funcionar. Se puede
probar el endpoint `/health` aunque no haya cuenta.

La sesión se pierde al cerrar completamente Android; no se guardan contraseñas,
tokens ni claves E2EE en la carpeta portable o en preferencias de Android. La
contraseña se deriva usando Argon2id y su clave Ed25519 solamente se utiliza en
el proceso nativo. No se envía al servidor en texto plano.

**Android debug APK**: se firma únicamente con una clave de depuración
generada por Android Gradle, válida para instalaciones de prueba. No es firma
de publicación, Google Play ni distribución pública. Nunca usar o enviar el
keystore de depuración como firma oficial VIS Studios.

## Compilación reproducible
La implementación móvil vive exclusivamente en `mobile/`. Su crate Cargo
tiene `[workspace]` propio y no añade paquetes Android al Cargo.lock de
Windows/Linux.

Requisitos: Node 22, Rust estable, Android SDK Platform 35 y build-tools 35,
NDK 27.2, JDK 17 y el objetivo Rust `aarch64-linux-android`.

Comandos desde raíz:

```bash
npm ci
cd mobile
../node_modules/.bin/tauri android init --ci
../node_modules/.bin/tauri android build --debug --apk --target aarch64 --ci
```

CI: `.github/workflows/vis-android-preview.yml` ejecuta
`tools/test_vis_android_features.mjs`, comprobaciones de límites de seguridad,
y genera un APK arm64 de prueba con SHA256SUMS. Rust omite secciones de
depuración DWARF para reducir el tamaño del paquete. El build no se fusiona
automáticamente ni despliega Workers ni modifica los secretos Cloudflare.

## Plan de verificación real
1. Instalar APK de depuración en un teléfono Android arm64.
2. Comprobar conexión y esquema D1 informado, con Wi-Fi y datos móviles.
3. Iniciar sesión en VIS Ceibo (cuenta sin MFA y cuenta con MFA).
4. Revisar nombre, ID, lista de amigos, presencia y proyectos visibles.
5. Recuperar una cuenta con correo verificado **solo después** de configurar
   y probar Resend/Cloudflare; no afirmar que funciona antes del despliegue.
6. Verificar que el token nunca aparezca en WebView, almacenamiento local,
   logs o informes de crash; reiniciar la app y comprobar cierre por diseño.
7. Confirmar comportamiento al revocar la sesión desde escritorio o
   cambiar la contraseña.

Hay que verificar Tauri y el APK en un teléfono físico antes de considerar
lista cualquier release Android. El fork Horizon sigue siendo independiente.
