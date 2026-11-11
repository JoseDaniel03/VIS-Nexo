# VIS Ceibo + VIS Humile — Cloudflare D1 / Durable Objects

Cloud-based VIS Social backend. It is separate from the local-only friends state and
does **not** grant cloud identity to local or offline nicknames. Deployment is manual.

## Architecture

- Ceibo: D1 accounts, PBKDF2-SHA256 password verifiers with independent salts,
  seven-day sessions with hashed tokens, account disable flags and rate limits.
- Humile: requests, acceptance, cancellation, removal, blocks, group and direct
  chat routing. **Message bodies are never stored in D1**; they are relayed to
  connected recipient WebSockets, then saved by each player's VIS Nexo device.
  Each conversation log is capped at 2048 UTF-8 bytes and content expires
  30 days after the message timestamp. Unread flags are local too.
- Durable Object SocialHub: hibernatable WebSockets for user notifications and presence.
  D1 remains authoritative for membership, blocks, accounts and chat metadata,
  **not for message history**.
- Presencia: preferencia conectado/ausente/ocupado/invisible; estado personalizado
  de hasta 80 caracteres; difusión de juego activable o desactivable.
  El launcher publica automáticamente Minecraft Java o Rust Edition y el nombre
  opcional del proyecto mediante POST /v1/activity.
- Seguridad de actividad: solo amigos aceptados, visibles y conectados pueden ver
  la actividad. Invisible y Desconectado ocultan actividad y texto; bloquear
  elimina la amistad. El registro del juego caduca en 4 minutos sin heartbeat
  (cada 75 segundos mientras el proceso está activo).
- El Worker borra estados de juego vencidos diariamente; la API filtra registros
  caducados en cada consulta, sin depender de la tarea periódica.
- VIS desktop: dedicated online UI in the existing social sidebar. Cloud Ceibo identity
  requires separate signup/login until a trusted remote identity bridge exists.

## Initial provisioning

Using Wrangler in the services/social directory:

1. Install dependencies: npm install
2. Log in: npx wrangler login
3. Create the D1 database: npx wrangler d1 create vis-social
4. Copy its UUID into the database_id field of wrangler.toml, replacing
   REPLACE_WITH_D1_DATABASE_ID.
5. Apply remote migrations: npx wrangler d1 migrations apply vis-social --remote
6. Deploy Worker and Durable Object: npx wrangler deploy
7. Open the launcher social sidebar and enter the resulting
   https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev address.
   Its /health endpoint should return status ok.

**Cloud resources and account binding have NOT been deployed by this branch.**
Once you know the public Worker URL, set the GitHub Actions repository variable
`VIS_SOCIAL_URL` to that HTTPS `*.workers.dev` address. Future Windows and Linux
launchers then open the online panel without asking every player to paste the
Worker address. Old builds and local development keep manual configuration.

The Worker also runs one daily cron at 04:00 UTC to delete expired authentication
sessions, expired WebSocket tickets and spent request-limit counters. This job
does not need to remove conversation content: none is stored in D1. 
The old PostgreSQL drafts in services/ceibo and services/humile are not D1 migrations.
Do not run them against D1. VIS Universe R2 remains untouched.

## Despliegue desde GitHub Actions (opcional, manual)

Se añadió `.github/workflows/vis-social-deploy.yml`. No se ejecuta automáticamente
ni desde este PR: está restringido a `main`, requiere confirmación manual y usa
el entorno protegido `vis-social-production`. Configurá el entorno con aprobación
manual para evitar despliegues accidentales.

1. Creá D1 **una sola vez** mediante `npx wrangler d1 create vis-social`
   (o reutilizá una D1 propia con el nombre indicado en la configuración).
2. En GitHub → Settings → Secrets and variables → Actions, guardá:
   - Secret `CLOUDFLARE_API_TOKEN`: token Cloudflare acotado a esta cuenta, con
     permisos para Workers scripts, Durable Objects y D1.
   - Secret `CLOUDFLARE_ACCOUNT_ID`: ID de cuenta de Cloudflare.
   - Variable `VIS_SOCIAL_D1_ID`: UUID devuelto al crear la base D1.
3. Tras fusionar el PR en `main`, en Actions → VIS Social — deploy Cloudflare
   (manual) → Run workflow, elegí `main` y marcá la confirmación.
4. El workflow valida variables, ejecuta las migraciones D1 en local y remoto,
   y despliega el Worker y Durable Object.
5. Comprobá `/health`, registrá dos cuentas de prueba y verificá un chat entre
   ambas. Solo entonces configurá VIS Nexo con la URL del Worker.

**Ningún token debe pegarse en este repositorio, en un issue o en el chat.**
Si usás la cuenta gratuita de Workers, verificá que el cálculo PBKDF2 de los
inicios de sesión no exceda el límite de CPU de la cuenta. No publiques el
servicio para usuarios hasta comprobar ese punto en Cloudflare.

## Endpoints de estado y actividad

Todos requieren sesión Ceibo mediante el mismo token Bearer de los chats.

- `POST /v1/presence` con `{"visibility":"away"}`, o
  `{"custom_status":"En la base de Virgoland"}`, o
  `{"share_game":false}`. Los campos no especificados conservan su valor.
- `POST /v1/activity` con `{"engine":"java","project":"Virgoland"}`
  o `{"engine":"rust","project":""}`. El nombre de proyecto puede omitirse.
- `POST /v1/activity` con `{"engine":null}` elimina el estado de juego.
- `GET /v1/social` devuelve `me.custom_status`, `me.share_game`,
  `me.activity` y, para amistades en línea visibles, los mismos datos
  públicos. El servidor nunca revela actividad de usuarios invisibles.

En el cliente VIS, los usuarios pueden escribir estados personalizados y
desactivar compartir actividad desde el panel Humile. VIS detecta los PID de
Minecraft Java/Rust al lanzar y al recibir `minecraft-process-exited`.
El estado se renueva mientras el juego sigue ejecutándose.

**El estado de juego es presencia auto-reportada por el cliente y no acredita
que una persona esté jugando en un servidor específico.** Para mostrar un
servidor público o permitir invitaciones haría falta autorización adicional.

## Historial de chat local (máximo 2 KB por conversación)

El cliente de VIS Nexo guarda cada conversación en un registro compacto
`localStorage` de su WebView, separado por endpoint Cloudflare, cuenta Ceibo
e ID del chat. El registro completo, **incluidos metadatos**, no supera
**2.048 bytes UTF-8 por conversación**. Cuando se llena, se descartan primero
los mensajes más antiguos para poder conservar los más recientes.

Los mensajes caducan a los **30 días**. El cliente elimina registros caducados
al abrir los chats o iniciar sesión. Si el programa permanece cerrado durante
ese período, la eliminación física se ejecuta al abrirlo nuevamente.

- Los mensajes de texto individuales tienen un límite de **1.536 bytes UTF-8**
  para permitir almacenar al menos un mensaje reciente en el registro pequeño.
  Emoji y otros caracteres Unicode pueden ocupar varios bytes.
- El Worker comprueba la membresía y los bloqueos, retransmite por WebSocket
  y no escribe ningún texto del mensaje en D1.
- Los destinatarios tienen que estar **conectados**: el servidor devuelve HTTP
  409 cuando nadie puede recibir. No hay una bandeja offline.
  Si un grupo incluye usuarios desconectados, recibirán el mensaje solo
  los integrantes conectados. No hay entrega diferida.
- El historial **no se sincroniza entre computadoras**, no es un backup en
  Cloudflare y se pierde si se borran los datos del WebView/launcher.
- El menú contextual de cada chat ofrece **Borrar historial en este equipo**.
- Esto es almacenamiento local, **no cifrado de extremo a extremo**; el
  Worker puede ver los mensajes mientras los retransmite. El WebView los
  guarda sin cifrado de aplicación. Requiere auditoría antes de producción.

### Migración 0005: destrucción del historial antiguo en D1

`0005_local_messages_only.sql` elimina `humile_messages` y el historial
central previamente almacenado. **Es irreversible**. Antes de aplicar en una
instalación existente, exportá la tabla antigua con las herramientas D1 y
guardá el respaldo según la política de datos vigente; después de la
migración no habrá una copia de los mensajes de ese servidor.
Las cuentas, chats/grupos, amigos y estados no se eliminan.

## Security and limitations

- Social passwords must contain 12 to 128 characters. Local launcher accounts
  and offline nicknames do not become authenticated cloud accounts automatically.
- The token is held in application memory only, not localStorage. On restart the
  cloud user may need to log in again.
- Only listed ALLOWED_ORIGINS are accepted by the Worker for browser requests.
  Desktop CSP permits HTTPS and WSS *.workers.dev. Custom domains require a CSP
  update. Never use a wildcard CORS origin for bearer-authenticated operations.
- On every message operation the Worker verifies chat membership and blocking.
  Direct messaging also requires accepted friendship.
- Real-time tickets expire after 30 seconds and are single-use. Notifications
  request a refetch; chat messages contain transient content sent directly to
  authorized recipient WebSockets and immediately saved on the recipient device.
  No message bodies remain in D1.
- The cloud retains accounts, friendships and chat membership, not messages.
  Device-only log cleanup occurs when the account starts or opens its chats.
  Account erasure/export, moderation, attachments and message editing remain
  outside this feature.
- Password hashing uses 600,000 PBKDF2 iterations. Workers Free has a 10ms CPU
  limit; verify signup/login on a real Cloudflare deployment. If that limit is
  reached, use a suitable paid plan or managed identity rather than weakening hashes.
- The backend has basic rate limits. Production requires a security review, load
  testing, spam controls, operational monitoring and Windows/Linux end-to-end tests.

## Checks

Run from the services/social directory:

    node --check worker.mjs
    node --check ../../web/social-cloud.js
    node --test test_social.mjs

For local smoke tests use:

    npx wrangler d1 migrations apply vis-social --local
    npx wrangler dev

These checks do not prove that the Worker is live or that registration and chat have
worked on actual remote D1. Do not publish VIS Social as production-ready until real
deployment and integration tests pass.
