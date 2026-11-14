# VIS Nexo Android — preview de conexión (Tauri 2)

Este proyecto es un **compañero móvil** deliberadamente separado del
launcher Tauri de Windows/Linux. No compila ni modifica el fork
`JoseDaniel03/horizon-VISNEXO`. Comparte el protocolo VIS Ceibo,
Portals y Universe, **no el subsistema de Minecraft**.

## Qué funciona
- Conexión HTTPS con el Worker de VIS Ceibo (endpoint `/health`).
- Registro de cuenta, login Argon2id→Ed25519 y MFA de segundo paso (TOTP o
  código de emergencia) mediante comandos Tauri ejecutados en Rust.
- Tokens bearer, secretos de contraseña y tickets MFA solo en **memoria Rust**,
  nunca expuestos al WebView ni guardados en localStorage.
- Recuperación por correo verificado con código temporal cuando el servidor
  esté desplegado y configurado con Resend.
- Vista de identidad, correo verificado, amigos/presencia, catálogo de
  proyectos y miembros de comunidades.
- UI móvil responsive, menú táctil y botón de comprobación de conexión.

**No implementado en esta preview:** ejecutar, instalar o descargar Minecraft,
Java, Horizon Rust, mods, chat E2EE de dos vías, voice chat, notificaciones push,
persistencia de sesión, autenticación Microsoft ni passkeys/WebAuthn. No se leen
ni modifican mundos de ninguna plataforma. No es todavía un launcher de juegos.

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

CI: `.github/workflows/vis-android-preview.yml` genera un APK arm64 de
prueba, publica un artefacto y adjunta SHA256SUMS. Este build no se fusiona
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
