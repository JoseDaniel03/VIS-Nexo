# VIS Nexo / Portals — rendimiento y conectividad (13/11/2026)

Cambios integrados a `main`. **Sin nuevos artefactos, builds ni despliegue de Cloudflare en esta tanda.** La mejora de red es una hipótesis técnica basada en eliminar trabajo y operaciones redundantes; **no se dispone todavía de una medición de latencia/RAM comparativa en dos computadoras reales**.

## 1. Mensajería y protección de datos

- `web/social-remote.js`: los mensajes se descifran y se muestran antes de aguardar el POST `/v1/messages/ack`. Si falla el ACK, el servidor conserva el sobre cifrado, que puede retransmitirse; `client_message_id` mantiene el registro local idempotente.
- IndexedDB recupera únicamente las claves de mensajes del usuario activo mediante un rango por prefijo `account:` y hace la depuración de vencidos en **una transacción**. El historial se relee al entrar y cuando llegan/salen mensajes, no cada 2,2 segundos. Las respuestas de lectura atrasadas no pueden sobreescribir un historial más reciente.
- Se conservan el cifrado **ECDH P-256 / AES-GCM**, la autenticación de metadatos (AAD), la verificación TOFU y el rechazo explícito de cambios inesperados de clave. Los `CryptoKey` derivados se reutilizan por amigo solo durante la sesión, con una caché máxima de 64; los registros de claves públicas verificadas se mantienen acotados a 128.
- Las operaciones asíncronas de cifrado, envío y recepción verifican la generación y el usuario antes de escribir en la base local o emitir solicitudes. Un resultado viejo no puede contaminar los chats de una cuenta nueva.
- Se conservan los límites existentes de 30 días de historial y aproximadamente 2 KiB por conversación; sin subir texto plano a Cloudflare.

## 2. Conexión y recuperación

- `src-tauri/src/social.rs`: un único cliente HTTP Reqwest reutilizable conserva el pool de conexiones y sesiones TLS entre el login y la sincronización del chat. Timeouts, HTTPS estricto, ausencia de redirecciones y tokens solo en Rust permanecen sin cambios.
- Temporizador adaptativo de VIS Portals: **2.200 ms** con conversación activa y **8.500 ms** cuando está inactivo. Los fallos de red aumentan la espera exponencialmente, con máximo **45 segundos**, y el evento `online`/retorno a primer plano desencadena una sincronización anticipada.
- Cuando la ventana está oculta se detienen los sondeos periódicos. Si el servidor devuelve `HTTP 401`, el cliente deja de realizar solicitudes con ese token y requiere un nuevo inicio/reconexión autenticado.
- No se introduce WebSocket ni afirmaciones de entrega en tiempo real instantánea: el sistema sigue siendo **polling**; una mensajería push futura debe construirse con Durable Objects o infraestructura equivalente y pruebas reales.

## 3. Login y memoria del launcher

- Después de que Rust/Cloudflare valida las credenciales, la aplicación **renderiza Inicio de inmediato** y carga portadas, logos y avatares en segundo término. También la inicialización en frío evita esperar por todas las previsualizaciones antes de mostrar la UI.
- La caché web de previsualizaciones contiene como máximo **64 imágenes** o **32 MiB de texto codificado**, y no retiene una imagen individual que supere ese presupuesto. La navegación carga primero las imágenes del proyecto **efectivamente seleccionado**, sin precargar toda la biblioteca.
- Al cambiar de cuenta se descartan historial visual de chats, referencias de imagen anteriores, cargas pendientes y respuestas obsoletas.
- Avatares y skins de VIS Social usan hasta **tres peticiones simultáneas**, cachés acotadas y verificaciones de cuenta en respuestas. Se priorizan la cuenta propia, los primeros contactos y el chat seleccionado; los contactos restantes muestran su fallback hasta implementar carga por visibilidad.

## 4. Cloudflare Worker

- `services/social/worker.mjs`: las consultas de invitaciones, amigos, bandeja cifrada y proyectos se coordinan en paralelo donde son independientes, y la autorización de desarrollador se consulta una vez para la vista en lugar de repetir el mismo chequeo.
- Sigue siendo obligatorio autenticar cada request con `getSession`, comprobar permisos y no permitir solicitudes web con cabecera `Origin`.
- **Este cambio necesita un despliegue aparte del Worker** para mejorar la respuesta del servicio publicado; editar GitHub no actualiza automáticamente la infraestructura de Cloudflare.

## 5. Comprobaciones y pruebas pendientes

Verificaciones de sintaxis revisadas en `web/app.js`, `web/social-remote.js` y el Worker; verificación del cálculo de backoff con 6 casos. El paquete incluye `tools/check_vis_network_perf.py` en `npm run check:release` y amplía `tools/test_social_peer_key.mjs` con pruebas de cadencia y compatibilidad con pinning.

Antes del próximo lanzamiento se debe ejecutar:

1. `npm run validate`, `npm run check:release` y `cargo check --all-targets --locked` en Linux y Windows.
2. `npm run test:social` y pruebas integradas de Cloudflare después de desplegar el Worker con migraciones correctas, sin credenciales dentro de commits.
3. Abrir el mismo chat en dos PC y medir percentiles de recepción, tiempos desde envío hasta UI, peticiones D1/minuto y errores después de cortes de Wi-Fi.
4. Medir memoria privada/PSS o Working Set del launcher en frío, con 10/100/500 amigos, 20/100 proyectos y fondos grandes. Confirmar que no suba indefinidamente al cambiar de cuentas.
5. Verificar claves ECDH cambiadas, desconexión 401, duplicados en ACK, reintentos, al alternar usuarios durante el cifrado y al minimizar el WebView.
6. Probar pantallas pequeñas y los avatares de amigos fuera del conjunto precargado.

## Decisiones no alteradas

No se redujo el coste de Argon2id, la validez de contraseñas ni las verificaciones Microsoft. No se almacenan tokens en `localStorage`, no se exponen al frontend los tokens de VIS Social, y el usuario continúa autenticándose ante Microsoft/Minecraft para funciones oficiales. No se modificaron los motores Java y Horizon ni sus archivos de mundo.
