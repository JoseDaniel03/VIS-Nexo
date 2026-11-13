# VIS Portals — WebSocket en tiempo real (fase de integración)

Estado: código integrado a `main` el **13/11/2026**. **Sin despliegue de Cloudflare ni nueva build** de VIS Nexo en esta tanda. La versión de producción seguirá usando polling hasta desplegar el Worker con el nuevo Durable Object y hasta que el jugador actualice VIS Nexo.

## Arquitectura

- Cloudflare **D1** continúa siendo la fuente de verdad de amistades, cuentas, presencia, roles y **sobres cifrados** pendientes. La historia local sigue en IndexedDB durante 30 días, con el límite aproximado de 2 KiB por conversación.
- `VisRealtimeRoom`: Durable Object SQLite-backed, uno por `social_users.id`, usa la API de WebSocket de **hibernación**. Mantiene un máximo de **seis conexiones por usuario**. El WebSocket solo acepta ping opcional y notifica el JSON `{"type":"wakeup"}`; nunca transmite texto, identidades de amigos, avatares, skins, tokens ni sobres cifrados.
- El Worker notifica al Durable Object destinatario tras insertar el mensaje cifrado en D1, enviar una solicitud de amistad o aceptarla. En producción usa `ctx.waitUntil` para no hacer esperar al remitente por la señalización. Una avería del WebSocket no hace fallar la entrega: D1 + ACK + polling siguen siendo la vía fiable.
- Rust sigue siendo el único poseedor del **bearer de VIS Social**. La nueva orden `social_realtime_ticket` pide un ticket de **32 bytes aleatorios, de un solo uso y válido por 20 segundos**. Solo se guarda SHA-256 del ticket en D1; el ticket presentado por la WebView solo autoriza **una actualización de WebSocket de notificaciones de lectura**, no envíos, lectura de D1, cambios de estado ni inicio de sesión.
- La URL WSS proviene exclusivamente de la URL HTTPS autorizada por el código Rust. El servidor admite la cabecera Origin solo para el upgrade, exclusivamente desde orígenes Tauri admitidos y el puerto de desarrollo local 1420. Todos los demás endpoints siguen rechazando solicitudes originadas en navegadores.
- El cliente abre un WebSocket y, al recibir `wakeup`, ejecuta el flujo ya probado `/v1/state` → ECDH/AES-GCM → IndexedDB → ACK. Relee el estado tras abrir el socket para evitar la carrera entre el primer GET y la conexión.
- Mientras el WebSocket esté activo reduce los GET de respaldo a uno cada **45 segundos** para mantener presencia. Si el socket se corta o falla el upgrade, reintenta con espera exponencial acotada a 60 segundos mientras continúa con el polling existente (2,2 s con chat visible, 8,5 s fuera del chat, con backoff por error).
- Al minimizar el cliente, cambiar de cuenta, cerrar sesión o recibir HTTP 401, cierra y limpia el WebSocket y los temporizadores para evitar fugas.

## Seguridad y límites

- La ruta `/v1/realtime/connect` se valida antes de consumir el ticket: método GET, Upgrade WebSocket, origen permitido y token base64url de 43 caracteres. D1 hace un único `DELETE ... RETURNING user_id` para impedir replay incluso con conexiones simultáneas.
- **NUNCA** se debe enviar el bearer de VIS Social ni los tokens de Microsoft/Minecraft a la WebView, a la URL del WebSocket o al Durable Object.
- Los tickets de upgrade son capacidades muy limitadas, aunque sí son secretos efímeros. Nunca deben aparecer en logs de diagnóstico, almacenamiento web, mensajes de error o analytics.
- Las notificaciones del socket no son confirmaciones de entrega; el ACK cifrado ya existente marca la recepción del mensaje.
- Los WebSockets pueden desconectarse por suspensión, cambio de red o agotamiento de límites. El polling es obligatorio.
- La nueva CSP solo autoriza `wss://vis-social.defreitascarranza-845.workers.dev`. Si en el futuro VIS Social usa un dominio personalizado o una URL alternativa, será necesario actualizar explícitamente la CSP, sin abrirla a todos los dominios.
- **Todavía no es una medición real de latencia** ni un canal bidireccional de chat; es push de **avisos**. Los mensajes siguen pasando por el puente nativo y D1.

## Archivos y migraciones

- `services/social/wrangler.toml`: binding `REALTIME` y migración `new_sqlite_classes = ["VisRealtimeRoom"]`.
- `services/social/migrations/0009_realtime_tickets.sql`: tickets hashed y expiración. La limpieza horaria elimina los caducados.
- `services/social/worker.mjs`: tickets, upgrade, aislamiento por cuenta, avisos y cierre hibernante; `/health` responde `schema:9` solo si existe la tabla de tickets.
- `src-tauri/src/social.rs`: comando nativo; `src-tauri/src/main.rs`: registro; `src-tauri/tauri.conf.json`: CSP WSS.
- `web/social-remote.js`: reconexión, sincronización al recibir push, limpieza de recursos, fallback.
- `tools/test_social_worker.mjs`: test unitario de tickets, Origin, replay, señalización y limpieza con DO simulado. El WebSocket HTTP 101 y la hibernación **no se pueden validar con ese mock**, requieren Workers/Miniflare o entorno real.
- `tools/check_vis_realtime.py`: verificador estático añadido a `npm run check:release`.

## Validación antes del despliegue

1. Ejecutar `npm run validate`, `npm run check:release`, `npm run test:social` y `cargo check --all-targets --locked` en Linux y Windows; comprobar el comando Tauri.
2. Probar `VisRealtimeRoom` con Wrangler/Miniflare, asegurando HTTP 101, que la hibernación conserva el socket, máximo 6 dispositivos y cierre ante mensajes ajenos a `ping`.
3. Usar Secrets de GitHub Actions (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`). Aplicar migración D1 0009 y desplegar el Worker/DO **solo mediante `workflow_dispatch` manual** de `VIS Social - Cloudflare D1`, una vez autorizada la publicación. Eliminamos el despliegue automático por push para impedir que futuras revisiones publiquen migraciones sin pruebas. La automatización comprueba `/health schema:9`.
4. En dos PCs, verificar recepción A→B y B→A con latencia medida, repetición/ACK, cambio de cuenta y uso offline. Asegurar que solo el destinatario recibe un wakeup.
5. Probar que el mismo ticket falla al usarse por segunda vez, con Origin ajeno, sin Upgrade o tras vencer; que los tickets no quedan en logs y que la desconexión vuelve al polling.
6. Si falta binding `REALTIME` o el Worker aún no está publicado, comprobar que la interfaz funciona con el antiguo polling sin mostrar errores repetidos al usuario.

Cloudflare recomienda DO SQLite para nuevas clases y WebSockets con hibernación para coste y estabilidad, según la documentación oficial de Cloudflare de 2026.
