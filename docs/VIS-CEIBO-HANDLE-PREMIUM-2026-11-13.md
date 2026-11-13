# VIS Ceibo — identidad permanente, @usuario editable y Minecraft Premium

**Código integrado a `main` (13/11/2026); no desplegado a Cloudflare ni compilado
como distribución final.** Migración D1 `0010_public_handles.sql`, esquema
`/health:10`. El workflow de producción `VIS Social - Cloudflare D1` solo se
ejecuta manualmente, después de aprobar las pruebas y revisar la migración.

## Tres identificadores distintos

| Identificador | Ejemplo | ¿Puede cambiar? | Función |
| --- | --- | --- | --- |
| Identidad interna de Ceibo (`social_users.id`) | UUID no visible | **Nunca** | Relaciones, permisos, amigos, mensajes y DO |
| ID pública (`public_id`) | 24 caracteres hex | **Nunca** | Referencia compartible permanente y alternativa para iniciar sesión |
| @usuario VIS (`public_handle`) | `@danieldev` | **Sí, cada 7 días** | Perfil, invitaciones, búsqueda, login VIS Cloud |
| Nombre visible | `Daniel` | Sí | Presentación cosmética |
| Minecraft Java | `JoseDaniel03` | Lo gestiona Mojang | Nick oficial del juego; no identifica una cuenta VIS |

El antiguo campo `social_users.username` queda **inmutable y técnico** por
compatibilidad con cifrado ECDH/AES-GCM, firma Ed25519, historial local IndexedDB y
perfiles existentes. Aunque no es una ID sustituible por el usuario final,
mantenerlo permite migrar en el futuro referencias legadas a `social_users.id`
sin perder chats históricos.

## Cambio de @usuario

- Se elige en **Mi perfil → Editar perfil → @usuario público**. El nombre visible
  y el @usuario son controles independientes.
- Se acepta `a-z`, `0-9` y `_` (3–24 caracteres, no distingue mayúsculas).
- El backend comprueba **sesión autorizada**, unicidad frente a los usuarios
  técnicos y las IDs públicas, alias actuales e históricos, nombres reservados y
  limitación de cambios (7 días, máximo 5 nombres distintos reservados).
- Un @usuario anterior queda asociado de manera permanente a la misma cuenta.
  Por eso ni un atacante ni una nueva cuenta pueden hacerse pasar por un
  contacto que cambió de nombre. Las búsquedas con nombres anteriores resuelven
  a la cuenta original.
- Un cambio no mueve relaciones entre amigos, roles, proyectos, suscripciones,
  claves de cifrado, mensajes ni instancias portables. Las invitaciones nuevas
  pueden enviarse al @usuario actual o a la ID pública.
- La firma de contraseña en VIS Cloud continúa ligada al **usuario técnico
  original**, aunque el formulario ahora acepta `@usuario`, usuario antiguo o
  ID pública para encontrar la cuenta.
- Ni el @usuario ni el nombre visible son prueba de poseer una cuenta Premium.
  La insignia Premium solo debe proceder de una autenticación oficial válida.

## Estado del inicio de sesión Premium

Actualmente VIS Nexo sí valida Microsoft → Xbox/XSTS → Minecraft Services, y
crea automáticamente **un perfil local** a partir del UUID oficial de Minecraft
mediante `ensure_microsoft_profile`. Un cambio de nombre de Minecraft no
cambia ese perfil local. El cliente intenta conectar VIS Social tras el inicio
de sesión oficial.

**Limitación pendiente de resolver:** la conexión VIS Social existente usa una
firma Ed25519 por dispositivo. Ese mecanismo no demuestra ante Cloudflare que
dos equipos distintos pertenecen a la misma cuenta Microsoft. Por tanto, el
inicio de sesión Premium **aún no proporciona una cuenta VIS Cloud multiplataforma
recuperable exclusivamente con Microsoft**. No debe equipararse una coincidencia
de nick/UUID enviada por el cliente con una prueba segura de identidad.

Para terminar la federación Premium sin pedir una segunda contraseña VIS, el
siguiente módulo debe utilizar autenticación de identidad Microsoft validada
por el backend (por ejemplo, OIDC con comprobación de firma, emisor, audiencia,
caducidad y nonce), un enlace seguro por cuenta, protección contra vinculaciones
conflictivas, soporte de múltiples dispositivos y un flujo de recuperación. No
se debe enviar a VIS Social el token de acceso de Minecraft o el refresh token
de Microsoft ni registrar credenciales en la WebView o Cloudflare.

## Validación

- `tools/test_social_worker.mjs`: prueba con D1/SQLite, cambio único y
  duplicado, nombre reservado, restricción de cadencia, estabilidad de ID,
  búsqueda de amigos con alias, alias antiguos protegidos y login cloud por
  alias con prueba firmada usando la identidad original.
- `tools/check_vis_identity.py`: contratos estáticos de identidad,
  inmutabilidad, cifrado, control de permisos y lógica Premium UUID.
- La distribución nativa requiere `npm run validate`, `npm run check:release`
  y `cargo check --all-targets --locked` en Windows/Linux. **No se generó build.**
- Para habilitar esta función remotamente hay que aplicar la migración 0010
  a D1 y desplegar el Worker desde el workflow manual. Antes de eso la versión
  antigua de producción no tendrá el endpoint de cambio de @usuario.

## Seguridad futura

El próximo objetivo de Ceibo es compartir **una identidad única** entre
Microsoft Premium y VIS Cloud, comprobada en el servidor, sin crear un segundo
perfil por dispositivo y sin migraciones destructivas de amistades. No
autovincular cuentas online a partir del nombre de Minecraft o de valores
suministrados desde JavaScript.
