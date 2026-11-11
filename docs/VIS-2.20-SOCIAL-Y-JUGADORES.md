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
- Mensajes directos y grupos de hasta diez usuarios, historial persistente y
  paginación, contadores de mensajes no leídos y notificaciones WebSocket.

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
