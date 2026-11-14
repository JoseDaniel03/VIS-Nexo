# VIS Portals — revisión del 14 de noviembre de 2026

## Cambios

El launcher muestra conexión de red y cuenta por separado, contactos ordenados,
búsqueda, estados, solicitudes y conversación. Android adapta los mismos estados
visuales sin presentar el chat cifrado multidispositivo como disponible.

El panel nativo comparte la geometría de dibujo y de pulsación. Moverlo ya no deja
los botones en su posición anterior. El botón Amigos del inicio, cuando existe el
canal VIS, abre el mismo panel que dentro de un mundo. Los controles respetan la
conexión y el estado del mundo. Las cuentas, claves y sesiones siguen en Nexo.

El intercambio con el juego elimina conversaciones ajenas, limita el tamaño real
UTF-8 del mensaje, selecciona el historial de la conversación y descarta respuestas
al cambiar de cuenta o detener el canal. Una sesión con claves locales no se
presenta como prueba de que existe conexión de red.

Android requiere esquema 15 para indicar todos los servicios como preparados.
El instalador informa si el equipo no usa ARM64 o no alcanza Android 9 / API 28.

## Verificaciones

- `npm run validate`: sintaxis, contratos de UI, tipos y comandos nativos.
- `node tools/test_game_portals.mjs`: aislamiento, desconexión y límites UTF-8.
- Pruebas existentes de permisos, invitaciones, voz y UI Android.
- Motor: `cargo check -p horizon-client --no-default-features --features horizon-extras`.
- Dos pruebas de geometría del panel nativo.

## Pendientes de producción y de dispositivo

La consulta pública realizada durante esta revisión a `/health` de VIS Social
respondió `ready` con esquema **8**. El código del Worker implementa **15**.
No equivale a servicios actuales desplegados. El flujo de despliegue existente
`.github/workflows/vis-social-deploy.yml` aplica las migraciones y comprueba el
esquema 15; requiere iniciarlo con las credenciales del entorno de producción.
No se ejecutó ese despliegue en esta revisión.

Existe el release compartido `visgame-4ab9e7f88e86` con Windows, Linux, Android y
manifiesto. Estos cambios nuevos de interfaz necesitan su propia compilación;
no forman parte de ese APK anterior.

La conexión Microsoft Android verifica la cuenta y su nombre, pero no transfiere
una sesión Minecraft al juego. No permite afirmar que el juego autentique contra
servidores `online-mode`. El panel social dentro de McRust Android tampoco tiene
aún el canal equivalente al IPC de PC. Falta comprobar instalación, recursos,
skins, reconexión, cambio de cuenta y juego real PC/Android en dispositivos.

No se realizaron pruebas con cuentas o mundos reales del usuario. No se publican
credenciales, tokens, claves de firma ni datos de jugadores en el informe.
