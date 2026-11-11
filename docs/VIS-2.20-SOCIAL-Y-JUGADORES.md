# VIS Nexo 2.20 — Social, identidad de jugador e iconos

## Social local y social online

El panel de la derecha permite alternar entre **VIS Portals (local)** y
**VIS Humile (online)**. El modo local conserva amistades y conversaciones
locales del perfil y funciona sin un Worker desplegado. Humile exige una cuenta
Ceibo en el servicio cloud: un nickname offline no es una identidad online.

Para desplegar Humile, seguir la guía en services/social/README.md. La base D1
y el Durable Object usan un Worker independiente del servicio VIS Universe.

El servicio online soporta:
- Registro/inicio de sesión Ceibo con contraseña (distinto del acceso local).
- Solicitudes, aceptar, rechazar, cancelar, quitar amistades y bloquear/desbloquear.
- Favoritos, presencia conectado/ausente/ocupado/invisible con privacidad.
- Estado personalizado de hasta 80 caracteres, sincronizado con los amigos.
- Actividad automática de Minecraft Java y Rust Edition (proyecto opcional).
- Casilla para no compartir el juego y modo invisible que oculta toda la actividad.
- Los estados de juego tienen una caducidad automática de cuatro minutos si VIS se
  cierra o pierde conexión; mientras se juega, VIS renueva la actividad.
- Mensajes directos y grupos de hasta diez usuarios, historial persistente y
  paginación, contadores de mensajes no leídos y notificaciones WebSocket.

### Apodos privados y menús contextuales

En **VIS Humile → Amigos**, hacé clic derecho sobre un amigo o pulsá su
botón **⋯**. También funciona la tecla de menú contextual o **Shift+F10**
cuando el elemento tiene el foco. Vas a encontrar:

- **Enviar mensaje:** abre el chat privado del amigo.
- **Cambiar apodo:** muestra un editor en la barra social para establecer
  un nombre personalizado de 1 a 40 caracteres. **Quitar apodo** vuelve
  al nombre de usuario verdadero.
- **Marcar/Quitar favorito:** organiza los amigos principales.
- **Eliminar amigo** o **Bloquear:** solicita confirmación, y elimina
  los apodos asociados cuando termina la relación.

En **Conversaciones**, clic derecho o **⋯** ofrece abrir y marcar como
leída una conversación. En grupos también permite **Salir del grupo**.
Si el chat es directo con un amigo, permite modificar el apodo desde
el mismo menú.

Los apodos son privados y por cuenta: si `ana` llama a `bobby` como
`Bob el builder`, únicamente `ana` verá ese nombre en su lista de amigos,
conversaciones y mensajes. Su identificador Ceibo sigue siendo
`@bobby`; no cambia la cuenta ni afecta a los demás usuarios.
Cada apodo se almacena en D1 en una tabla independiente con permisos
por propietario. Al eliminar o bloquear la amistad, se limpia en ambos
sentidos. El cambio no requiere reiniciar el launcher.

### Configurar tu estado desde Humile

En el panel **VIS Humile (online)**, luego de entrar con Ceibo:

1. Elegí **Conectado / Ausente / Ocupado / Invisible**.
2. Escribí un estado propio, por ejemplo `Construyendo Virgoland`, y pulsá
   **Guardar estado**. El texto se valida, se guarda en D1 y aparece entre
   tus amigos conectados.
3. Marcá o desmarcá **Mostrar el juego a mis amigos**. Es independiente del
   texto personalizado: podés mostrar un mensaje propio sin revelar a qué jugás.
4. Al iniciar Minecraft Java/Rust desde VIS, tus amigos podrán ver
   `Jugando Minecraft Java` o `Jugando Minecraft Rust Edition`, junto al
   nombre del proyecto si corresponde.
5. Cuando el proceso se cierra, VIS elimina esa actividad inmediatamente;
   ante apagones o fallos de conexión, el registro caduca automáticamente.
6. Si elegís **Invisible**, nadie ve tu conexión, mensaje personalizado ni
   actividad, aunque los conserves configurados.

La información del juego se comparte **solo entre amistades aceptadas**;
un desconocido, un usuario bloqueado o alguien fuera de tu lista no puede
consultarla. El servidor valida las peticiones y notifica cambios mediante
Durable Objects; los WebSockets nunca autorizan datos por sí mismos.

Los estados de juego informan sobre procesos iniciados desde VIS Nexo. No
se detectan juegos iniciados por otros launchers. Una declaración recibida
de la API social es un dato de presencia auto-reportado, no prueba de
participación en un servidor Minecraft.

**Limitaciones:** el registro usa autenticación independiente de la cuenta
local. Unir ambas identidades requiere un mecanismo seguro de verificación.
La sincronización de datos antiguos locales con la nube no se hace
automáticamente. Las funciones de moderación, eliminación/exportación de cuenta
y retención efectiva necesitan desarrollo y validación antes de producción.

## Nickname dentro de Minecraft

En Minecraft Java local, el lanzamiento utiliza el campo player_name
cuando está configurado y, en su defecto, el usuario local de VIS.
En Horizon Rust offline, VIS pasa --name con el nickname de la instancia,
o el de la sesión VIS actual si no está configurado; no se deja a Horizon
inventar un Player#### para instancias nuevas.

Desde **Instancias > Editar > Nick dentro de Minecraft** se puede fijar
un nickname entre 3 y 16 caracteres [A-Za-z0-9_]. El botón
**Usar mi nombre VIS** lo sustituye por el perfil actual. Para un
Player#### guardado antiguamente, abrir la instancia, usar ese botón y guardar
la configuración; esto preserva los nombres personalizados del usuario.

Con Microsoft, los juegos deben utilizar el nombre oficial de la sesión
autenticada y no un alias local. No usar las rutas offline para suplantar
cuentas de servidores premium.

## Iconos de instancias

En **Instancias > Cambiar icono**, el propietario puede seleccionar PNG,
JPG o WebP (hasta 3 MB). VIS copia la imagen al almacenamiento privado de
assets de la aplicación y guarda su ruta en el perfil de la instancia. No
modifica la carpeta Minecraft, el mundo ni los mods.

Se muestra en las tarjetas, biblioteca y editor. También se puede quitar para
volver al icono predeterminado. En una instancia nueva, guardar primero y
después elegir su imagen. Las rutas de iconos no deben considerarse archivos
portables entre equipos: para mover un icono hay que importarlo otra vez.

## Estado de validación

Las pruebas locales D1 + Worker + Durable Objects no equivalen a un despliegue
real; también se necesita una prueba en una máquina Windows y Linux de inicio
del juego, nombre visible en Minecraft, persistencia del icono y chat online
entre dos usuarios autenticados.
