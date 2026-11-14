# VIS Ceibo Recovery — diseño, despliegue y límites

**Estado:** implementación en rama del PR #5; NO fusionada, NO desplegada,
NO compilada para distribución. El fork Horizon permanece intacto.

## Identidad y confianza
- El identificador inmutable de la cuenta es `social_users.id`. El
  `username`, `@public_handle`, nombre visible y gamertag no dan privilegios.
- Cambiar contraseña desde Mi perfil exige escribir la **contraseña actual** y probarla mediante un nuevo desafío Argon2id/Ed25519. La operación requiere una sesión reciente (máximo 5 minutos) y un código MFA si la cuenta lo tiene habilitado. Cambiarla invalida todas las sesiones.
- Contraseñas VIS Cloud: el cliente Tauri obtiene una clave Ed25519 con
  Argon2id y un salt aleatorio (16 bytes); solo el verificador público se guarda
  en D1. El backend NUNCA recibe la contraseña en texto claro.
- Verificar el correo es voluntario inicialmente para no dejar sin acceso a
  cuentas antiguas mientras no esté configurado el proveedor. **Solo correos
  verificados permiten recuperación por email**.
- Las cuentas solo locales con PIN y las cuentas Microsoft se recuperan por sus
  mecanismos correspondientes. Microsoft no comparte contraseñas con VIS.

## Recuperar cuenta
1. «Olvidé mi usuario» envía el nombre técnico al correo previamente verificado,
   sin revelar en la API si existe el usuario.
2. «Olvidé mi contraseña» envía código aleatorio de 32 bytes, almacenado
   exclusivamente como SHA-256 en D1; caduca en **15 minutos** y se consume
   una vez. No se envían enlaces con tokens en parámetros URL.
3. El nuevo verificador Ed25519 se deriva en Rust y prueba su posesión
   con la firma de registro `VIS-CLOUD-REGISTER-V2`.
4. Recuperar contraseña **revoca todas las sesiones**, desafíos de acceso,
   tickets de tiempo real y autorización anterior del dispositivo.
5. Para recuperar la cuenta superadministradora o administradora global hay que
   presentar **también un código de recuperación MFA** de un solo uso. Si ambos
   factores se perdieron, un operador deberá verificar identidad fuera de la app.
6. Cambiar correo ya verificado exige aprobarlo tanto desde el email anterior
   como desde el nuevo. El cambio no es efectivo hasta ambas confirmaciones
   (vencimiento **20 minutos**).

## MFA
- Se utiliza TOTP RFC 6238, 6 dígitos, pasos de 30 segundos, ventana ±30 s.
- El secreto TOTP se guarda en D1 cifrado con AES-256-GCM y AAD=user_id.
  La clave de cifrado reside exclusivamente en Cloudflare Secrets.
- Al activar MFA se muestran ocho códigos de rescate aleatorios de 100 bits,
  almacenados solo como hashes; se usan una sola vez.
- El acceso a APIs administrativas de cuentas superadmin/globaladmin exige
  MFA habilitado y una verificación reciente (10 minutos). Cambiar correo,
  contraseña y revocar sesiones también exige segundo factor si está habilitado.
- **MFA obligatorio en el login cuando la cuenta tiene TOTP:** después de
  validar contraseña Argon2id/Ed25519 o firma del dispositivo, el Worker no
  emite bearer. Entrega un ticket aleatorio de 32 bytes (solo se almacena SHA-256
  en D1), válido 5 minutos y máximo 5 intentos. La ruta
  `/v1/accounts/login/mfa` acepta TOTP válido o código de emergencia y solo
  entonces emite sesión. Tauri conserva el ticket en Rust, no en WebView.
- Al habilitar MFA, se invalidan las demás sesiones y websockets activos.
  Los bearer antiguos sin segundo factor quedan bloqueados desde el gateway.
- La re-vinculación de dispositivos y cambio de contraseña exigen sesión de
  contraseña reciente (máximo cinco minutos); el reset revoca también todos
  los tickets MFA todavía pendientes.
- No hay passkeys/WebAuthn integrados todavía.

## Sesiones y dispositivos
- Los tokens bearer de sesión solo viven en memoria del proceso nativo.
- `auth_sessions.session_id` es un identificador opaco para enumerar y revocar,
  no es un token de autenticación. Se muestran hasta 40 sesiones.
- Después de recuperar/cambiar contraseña, el contador
  `device_credential_epoch` se incrementa; los logins Ed25519 del dispositivo
  anterior quedan revocados. «Autorizar este dispositivo» requiere sesión
  iniciada con contraseña VIS + MFA si está inscrito.
- Limitación: actualmente se registra una clave de dispositivo principal por
  cuenta; la gestión de varias claves independientes necesita una tabla de
  dispositivos autorizados y pruebas multi-PC antes del lanzamiento final.

## Proveedor de correo y secrets

**Requisitos:** dominio de envío verificado en Resend, DNS SPF/DKIM correcto y
cuenta Resend autorizada a enviar al público. No sirve un correo de prueba que
solo envíe a un destinatario restringido.

En el GitHub Environment **vis-social-production** configurar:
- Secret `VIS_CEIBO_RESEND_API_KEY`: API key de Resend con alcance mínimo.
- Secret `VIS_CEIBO_MFA_ENCRYPTION_KEY`: cadena base64 de **32 bytes de
  entropía criptográfica** (generada localmente mediante un CSPRNG).
- Variable `VIS_CEIBO_FROM_EMAIL`: dirección del dominio verificado,
  por ejemplo `cuentas@tu-dominio.example` (ejemplo, no reutilizar literalmente).
- Ya existentes: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

**No** guardar estas claves en la app, un `.env` versionado, un archivo de
migración, un mensaje de chat o el propio repositorio. La workflow manual
validará la presencia de los valores, aplicará D1 migration 0012 y configurará
los secretos del Worker. Sin esos datos no se debe desplegar.

## Passkeys / WebAuthn
- **Pendiente, no implementado:** el flujo de passkeys requiere un dominio
  HTTPS verificado (Relying Party ID), una interfaz de autenticación en
  navegador vinculada a ese dominio y un intercambio seguro de resultados con
  el cliente Tauri. No es seguro atribuir passkeys al origen `tauri://localhost`
  ni guardar claves privadas WebAuthn en D1.
- Hasta establecer el dominio y verificar Windows/Linux, esta versión usa
  TOTP más códigos de recuperación como segundo factor obligatorio para
  cuentas que lo habilitaron. No mostrar botones de passkey ficticios.

**NO regenerar ni rotar `VIS_CEIBO_MFA_ENCRYPTION_KEY` sin migrar antes
todos los secretos TOTP cifrados:** hacerlo invalidaría la verificación MFA
de los usuarios existentes, incluidos administradores. Conservá respaldo
cifrado en un gestor de secretos y prepará una migración de claves.

## API implementada
Públicas (POST, nativas): `/v1/accounts/login/mfa`, `/v1/recovery/start`,
`/v1/recovery/introspect`, `/v1/recovery/reset`,
`/v1/recovery/email/verify`.
Autenticadas: `/v1/account/email/request`,
`/v1/account/mfa/{status,setup,confirm,verify,rotate-codes}`,
`/v1/account/sessions`, `/v1/account/sessions/revoke`,
`/v1/account/password/change`, `/v1/account/devices/rebind`.

## Verificación antes del merge
- Ejecutar `node tools/test_social_worker.mjs` y tests existentes (schema 13).
- Validar tickets MFA de 5 intentos, acceso sin bearer previo, login por
  dispositivo, TOTP de un uso y bloqueo de sesiones antiguas.
- Comprobar npm audit, RustSec, CodeQL y `cargo check --all-targets --locked`.
- Configurar secrets y dominio Resend en un entorno de pruebas de Cloudflare, con migración D1 **0013**.
- Probar cuentas normales y administradoras reales con dos dispositivos.
- Revisar fallo de mailer, pérdida de dispositivo, correo antiguo no accesible,
  agotamiento/replay de códigos y revocación concurrente de sesiones.
- Probar la interfaz en Windows/Linux portable; no crear nueva release todavía.
- Confirmar que la recuperación de cuenta NO recupera claves E2EE del historial
  de chat que solo están en el dispositivo anterior.
