# VIS Nexo Android — launcher + instalador del motor McRust compartido

**Estado (14/11/2026): motor compartido publicado para PC y Android, pendiente la validación en teléfono físico.** El código de esta rama reemplaza el antiguo handoff experimental con un instalador que usa el manifiesto `vis-mcrust-release.json` del fork `JoseDaniel03/horizon-VISNEXO`. Solo acepta paquetes provenientes del **mismo commit de motor** que Windows/Linux; nunca descarga el viejo `com.visstudios.mcrust.preview`.

**Flujo previsto:** iniciá sesión VIS Ceibo, ingresá solo el nombre de la instancia en Mundos y tocá **Instalar / Jugar**. Android fija automáticamente `Horizon / 26.3 / Vanilla`. Nexo verificará el catálogo GitHub, la huella SHA-256 del APK, y solicitará permiso y confirmación Android para instalar `com.visstudios.mcrust`. Al tocar Jugar nuevamente abrirá esa instancia. Los mundos se guardan dentro del sandbox privado de la app McRust, separados por usuario e instancia; la carpeta de metadatos del launcher no es donde se guardan las partidas.

**Publicación actual:** el fork ya publica `visgame-4ab9e7f88e86` con Windows, Linux, Android firmado y el manifiesto común. El launcher verifica el catálogo y los hashes. **Pendiente:** probar de extremo a extremo permisos Android, instalación, NativeActivity, mundo y servidor en un teléfono real. Una compilación aprobada no equivale a gameplay probado.

**Identidad:** el juego Android recibe solo nombre offline, propietario, ID de instancia y SHA de motor. No recibe contraseñas, tokens o rutas. VIS Ceibo **no equivale** a autenticación oficial Minecraft Premium; todavía falta OAuth Microsoft/Minecraft en Android para servidores Java con `online-mode=true`. Tampoco están listos Java Edition Android, chat E2EE entre dispositivos, voicechat ni sincronización de partidas PC↔Android.

Más detalles y criterios de aceptación: [integración PC/Android](../docs/ANDROID-PC-INTEGRATION.md).

## Identidad compartida VIS / Minecraft

- **VIS Ceibo** autentica la cuenta del launcher. Sus cuentas, roles, presencia, amigos,
  Universe, apodos y skins se consultan por HTTPS con permisos del Worker VIS Social.
- La pantalla **Cuenta** consulta automáticamente el avatar WebP y la skin PNG de VIS.
  Esto **no implica que la skin esté aplicada dentro del renderizador de McRust**:
  el port Android aún debe implementar la textura local de cada jugador y las
  reglas de distribución de cosméticos VIS a otros usuarios autorizados.
- **Microsoft Premium (Android)**: se inicia por código de dispositivo desde Cuenta.
  La aplicación ejecuta Microsoft OAuth -> Xbox Live -> XSTS -> Minecraft Profile
  en el proceso nativo Rust; el WebView solo recibe código temporal, estado,
  nombre y UUID públicos. Los tokens no se guardan en disco, no se transfieren
  a VIS Social ni van en el Intent que abre McRust. La sesión se desvincula
  al cerrar VIS Ceibo y expira automáticamente.
- **Nombre en McRust**: cuando el perfil Microsoft esté verificado, Nexo utiliza
  el nombre oficial como etiqueta local; de lo contrario utiliza el @handle
  VIS válido para Minecraft, o un alias corto determinista derivado de la cuenta.
  Esto NO convierte una etiqueta en autenticación premium para servidores online-mode.
- **Pendiente para la integración real**: canal de sesión premium protegido,
  skin VIS renderizada en juego, estados/eventos de Portals durante la partida,
  acceso a SD desde el sandbox de McRust y compatibilidad probada en teléfono.
  No transferir contraseñas ni tokens OAuth por Intent o archivos públicos.
- **Diagnóstico Android**: la API de instalación de Nexo informa en qué paso
  falló (permisos, FileProvider, firma, Activity) sin mostrar excepciones JNI
  con datos privados. Un error reportado por un usuario todavía necesita
  verificación con el teléfono real.

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
- VIS Worlds: creación de perfiles **solo Horizon Rust 26.3 Vanilla**,
  con versión y motor fijados por el backend nativo y un único campo de nombre.
  Se prepara el perfil local mínimo y se conserva el almacenamiento anterior;
  los mundos reales se guardan en el sandbox privado de McRust.
  Quitar un perfil de la lista **no elimina sus datos**.
- UI touch-first con formularios, avatar/skin y botones accesibles;
  scripts ES modules; pruebas de contrato nativas y de la interfaz.

**Servidor requerido:** las funciones MFA y recuperación por correo solo son
operativas cuando el Worker real despliega el esquema D1 0013 y cuando Resend
está configurado con un dominio verificado. La APK no despliega los servicios.

**La creación de instancias solo prepara metadatos y un directorio local mínimo.** El botón Instalar / Jugar ejecuta la descarga, validación e instalación del APK Android compartido. No se presentan opciones Java ni loaders alternativos. Los perfiles Java anteriores se preservan, aunque se ocultan del listado móvil. Eliminar un perfil del launcher no desinstala el juego ni borra mundos.

**Todavía pendiente:** validar en teléfono físico la ejecución del port Horizon Android compartido, pasar una sesión Minecraft Premium verificada al juego de manera segura, respaldar/importar mundos del juego, copiar partidas entre PC/Android, chat E2EE multidispositivo, voz, notificaciones push, sesiones persistentes y passkeys/WebAuthn. No afirmar que se puede jugar hasta verificar instalación de APK, recursos, mundo y conexión a servidor.

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
