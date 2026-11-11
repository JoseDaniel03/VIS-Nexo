# VIS Social — Cloudflare D1

## Despliegue inicial (2026-11-11)

La base D1 fue creada previamente en la cuenta Cloudflare del proyecto:

- Base: `vis-social-db`
- Database ID: `3f1a6ccf-2d84-4233-bde3-d3887d1ea60a`
- Worker: `vis-social` (separado de `vis-universe`)
- Binding en el Worker: `DB`

El archivo `services/social/wrangler.toml` contiene solo los identificadores
públicos de la base, **no** contiene credenciales.

## GitHub Actions

El workflow `.github/workflows/vis-social-deploy.yml` se ejecuta al
modificar `services/social/**` o manualmente desde GitHub Actions.
Primero ejecuta pruebas locales, después migra D1 y despliega el Worker.

Se esperan:
- Secret `CLOUDFLARE_API_TOKEN`: token limitado a Workers y D1.
- Secret o variable `CLOUDFLARE_ACCOUNT_ID`: identificador de cuenta Cloudflare.

Si la integración de ayer utiliza nombres distintos, adaptar el workflow
a esos nombres; **no** agregar tokens en el repositorio, en logs o en VIS Nexo.
GitHub no permite consultar el valor de los secretos existentes.

Para despliegues manuales fuera de CI (con credenciales proporcionadas mediante
variables de entorno locales seguras):
```sh
cd services/social
npx --yes wrangler@4 d1 migrations apply DB --remote
npx --yes wrangler@4 deploy
```

## Validación

```sh
node tools/test_social_worker.mjs
```

Tras ejecutar el workflow, usar la URL HTTPS del Worker mostrada por Wrangler:
`GET /health` debe responder `{"service":"vis-social","status":"ready","database":"vis-social-db","schema":1}`.
Un estado `migration_required` o `database_error` significa que hay que
corregir la migración o el enlace a D1, no que el chat ya funciona.

## Datos y privacidad

La migración prepara usuarios, solicitudes, amistades, apodos privados, presencia,
estado personalizado, juego actual y una cola de tránsito de mensajes.
Los mensajes de la cola deben ser payloads opacos cifrados (máximo 2 KiB), con
caducidad y borrado tras confirmación de entrega. **No** usar D1 como historial
de conversaciones de 30 días: ese historial reside en cada cliente y se purga
localmente tras 30 días.

Este primer Worker deliberadamente solo expone `GET /health`: todavía
**no** implementa login, sesiones, escrituras, mensajería ni WebSockets.
Esos endpoints requieren autenticación de usuarios real, autorización por
amistad, protección ante fuerza bruta (especialmente PIN de 4 dígitos),
cifrado y gestión de datos expirados. No conectar el launcher a un endpoint
anónimo de mensajería.

## Pruebas entre dos PC

Cuando estén implementadas la autenticación y las rutas protegidas,
probar dos cuentas reales, solicitudes, estados, mensajes y reconexión,
además de verificar que no se guardan conversaciones permanentes en D1.
