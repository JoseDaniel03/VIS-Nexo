# VIS Social — Cloudflare D1, autenticación y chats cifrados

Estado técnico: el código del Worker y del cliente Tauri está implementado en GitHub,
pero **no se debe anunciar un despliegue real** hasta que GitHub Actions complete
satisfactoriamente `VIS Social - Cloudflare D1` y el endpoint `/health` responda listo.

## Infraestructura

- D1: `vis-social-db` (`3f1a6ccf-2d84-4233-bde3-d3887d1ea60a`).
- Worker aislado: `vis-social`, binding `DB`.
- URL por defecto del cliente: `https://vis-social.defreitascarranza-845.workers.dev`.
- URL alternativa en compilación: variable pública `VIS_SOCIAL_URL`.
- No afecta a `vis-universe` ni a sus R2/KV.
- Las migraciones `0001_social_core.sql`, `0002_device_auth.sql` y
  `0003_roles_projects.sql` se aplican mediante Wrangler antes de desplegar el Worker.

## GitHub Actions y credenciales

El workflow `.github/workflows/vis-social-deploy.yml` requiere:

| Tipo | Nombre | Contenido |
| --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | API Token Cloudflare para Workers y D1 |
| Secret o variable | `CLOUDFLARE_ACCOUNT_ID` | Account ID de Cloudflare (no secreto) |

Si el token anterior está guardado con **otro nombre** o en **otro repositorio**,
vincularlo o cambiar el nombre leído por el workflow. El `GITHUB_TOKEN`
automático no concede acceso a Cloudflare. Nunca pegar tokens en commits,
configuración del launcher, scripts, documentación o conversaciones.

El workflow verifica el token, ejecuta las migraciones remotas y publica el
Worker. Las pruebas contra Cloudflare con dos identidades independientes
se ejecutan automáticamente y borran sus usuarios temporales.
La prueba con dos equipos físicos sigue pendiente.
La URL final aparecerá en el log del despliegue de Wrangler.

Comprobar:
```sh
curl -fsS https://vis-social.defreitascarranza-845.workers.dev/health
# Esperado: {"service":"vis-social","status":"ready","schema":3}
```

## Modelo de autenticación

VIS Nexo conserva el PIN local de cuatro dígitos y las cuentas con Argon2id.
Al entrar en una cuenta local, genera una identidad de dispositivo **Ed25519**
persistida en el directorio privado de datos de la aplicación:
`social-device-keys/<usuario>.json`. El secreto nunca sale del proceso Rust.
El servidor registra su clave pública, entrega un desafío temporal de un solo
uso y acepta una firma digital, no el PIN. El token temporal resultante
se guarda solo en memoria del backend Rust, sin pasar al WebView.

**Límite actual**: cada cuenta VIS Social está asociada a su primera clave de
dispositivo; un segundo equipo con el mismo nombre y otra clave recibirá 409.
Para pruebas entre dos equipos crear **dos cuentas diferentes**. No borrar
el archivo de identidad del dispositivo sin copia segura; todavía no hay un
proceso de recuperación o traslado de cuenta a otro equipo.

## Datos remotos/locales

- D1 almacena identidades públicas, solicitudes, amistades, apodos privados,
  presencia y estado personalizado.
- Los mensajes se cifran **en el WebView** mediante ECDH P-256 y AES-GCM
  con una clave privada no exportable guardada en IndexedDB local.
- D1 solo almacena el sobre cifrado de entrega, hasta 2 KiB. Cada mensaje
  se borra tras confirmación y también caduca automáticamente a las 48 horas.
- Cada cliente mantiene **su propio** historial en IndexedDB, con retención de
  30 días y límite de 2 KiB por conversación (mensajes y metadatos). No se mantienen historiales
  permanentes de mensajes de chat en D1.
- Si la clave de IndexedDB se pierde, no se pueden recuperar mensajes
  cifrados pendientes. No hay copias de seguridad de claves en la nube.
- Ed25519 firma sesiones, ECDH cifra mensajes y la identidad del receptor
  es obtenida del servidor de confianza; aún no hay verificación externa
  de huellas digitales de claves ni recuperación de claves entre equipos.

## API autenticada

`GET /health` es público.
`POST /v1/auth/register`, `POST /v1/auth/challenge` y
`POST /v1/auth/session` constituyen el login por firma.
Con bearer temporal: `GET /v1/state` y `POST /v1/keys`,
`/v1/presence`, `/v1/friends/request`, `/v1/friends/accept`,
`/v1/friends/alias`, `/v1/messages/send`, `/v1/messages/ack`.
Se aplican límites básicos de solicitudes para reducir abusos.
Los cuerpos de chat enviados a D1 deben ser sobres cifrados, nunca texto
en claro.

## Validación automatizada

```sh
npm run validate
npm run test:social
cargo check -p vslauncher-tauri --all-targets --locked
```

`tools/test_social_worker.mjs` usa SQLite local para probar migraciones,
sesiones, amistades, privacidad de presencia y colas de mensajería. Esto
**no equivale** a comprobar el despliegue real ni dos computadores distintos.

## Prueba pendiente entre dos equipos físicos

1. GitHub Actions `VIS Social - Cloudflare D1` termina verde.
2. `GET /health` devuelve status `ready`, schema `2`.
3. Instalar el **mismo commit del launcher** en dos equipos distintos.
4. Crear dos cuentas locales con nombres distintos y conectarse a VIS
   Social, ambos con estado `Mensajes cifrados`.
5. Desde PC A solicitar amistad a PC B; B acepta y ambos aparecen como amigos.
6. A envía mensaje; B lo recibe, lo descifra, muestra hora y guarda
   su historial local. B contesta a A.
7. Comprobar reconexión, modo invisible, apodos por clic derecho y estados.
8. Reiniciar ambas aplicaciones y verificar persistencia de los últimos
   mensajes locales. Confirmar que la cola en D1 queda vacía tras ACK.

Importante: si aparece `Modo local · VIS Social desconectado`, **NO** asumir
que se enviaron mensajes por Internet. El botón Cloud permite reintentar.

## Roles administrativos y seguridad

El alta de la primera supercuenta usa una operación separada y manual de
GitHub Actions y la clave pública Ed25519 de la cuenta ya registrada. El primer
usuario local **no** recibe autoridad Cloudflare automáticamente. Las cuentas
sin privilegios no pueden crear proyectos ni asignarse roles.

Consultá [Seguridad, cuentas y proyectos](VIS-SOCIAL-SEGURIDAD-Y-PROYECTOS.md)
para ver el procedimiento de supercuenta, los permisos, las pruebas de seguridad
y los riesgos que todavía requieren revisión antes de distribución masiva.
