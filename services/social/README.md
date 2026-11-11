# VIS Ceibo + VIS Humile — Cloudflare D1 / Durable Objects

Cloud-based VIS Social backend. It is separate from the local-only friends state and
does **not** grant cloud identity to local or offline nicknames. Deployment is manual.

## Architecture

- Ceibo: D1 accounts, PBKDF2-SHA256 password verifiers with independent salts,
  seven-day sessions with hashed tokens, account disable flags and rate limits.
- Humile: requests, acceptance, cancellation, removal, blocks, groups, private chats,
  persisted messages with cursor pagination, unread counters.
- Durable Object SocialHub: hibernatable WebSockets for user notifications and presence.
  The database is the source of truth for authorizations and history.
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
does not remove conversation content. 
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
- Real-time tickets expire after 30 seconds and are single-use. WebSocket events
  merely trigger refetches; they cannot modify data directly.
- The Worker records 12-month retention timestamps. Actual cleanup, account
  erasure/export, moderation/reporting, attachments and message editing are not yet
  implemented. Configure backup/export and policy before scheduling deletion.
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
