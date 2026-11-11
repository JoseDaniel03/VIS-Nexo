# VIS Nexo — login VIS, avatares y VIS Portals v2.20

## Métodos de acceso

**Cuenta VIS (por defecto):** registro con nombre de usuario y contraseña online
de 10 a 128 caracteres. Cloudflare D1 genera una ID pública aleatoria de 24
caracteres hexadecimales; se puede iniciar sesión usando **usuario o ID**.
La contraseña **nunca se envía a Cloudflare**: Rust deriva una clave privada
efímera mediante **Argon2id** y firma un desafío Ed25519. D1 solo almacena
la ID, el nombre, la clave pública verificadora, una sal y los parámetros
de derivación. No contiene contraseñas en texto plano ni hashes reutilizables
directamente como bearer tokens. Las operaciones sociales siguen guardando
amistades, estados, roles y colas cifradas en tablas separadas.

**Cuenta local:** conserva el PIN de cuatro dígitos o una contraseña Argon2id
local, sin registrarla en la nube. Continúa disponible explícitamente.
El botón **Vincular contraseña online** en VIS Portals, si la sesión social
del dispositivo está conectada y el usuario aún no dispone de credencial online,
habilita login por usuario/ID y contraseña. La conversión **no** altera ni
destruye la clave pública y datos sociales existentes.

**Offline:** nick temporal, sin autenticación ni contactos online.

Para las cuentas que tienen exactamente el mismo nombre local y remoto
en una computadora, VIS Nexo **evita reutilizar automáticamente el perfil
local** durante el login online: esto impide acceder a configuraciones o
permisos locales de otra persona con la sola contraseña online.
Una cuenta local ya existente puede seguir ingresando por Cuenta local;
el mecanismo de fusión segura de perfiles todavía no está disponible.

El primer usuario local puede seguir administrando **solo** los proyectos
locales según la configuración anterior. Nunca recibe permisos
`super_admin` sobre D1 por ese hecho.

## Dónde se guardan los datos

| Dato | Ubicación |
| --- | --- |
| ID pública, usuario, verificador online | D1 `social_users` |
| Clave de firma del login online | Derivada de contraseña en Rust, **no persistida** |
| Sesiones online | Token en memoria Rust / hash de token en D1 |
| Amigos, solicitudes, presencia, roles | D1 |
| Mensajes en tránsito | D1, cifrados y con caducidad |
| Historial de chat | IndexedDB local, máximo 2 KiB por conversación, 30 días |
| Fotos de perfil | D1 `social_avatars`: WebP de máximo 24 KiB, visibles a amistades |
| Instancias, RAM, rutas, packs, configuraciones | **Solo en el equipo local** |

Las cuentas online tienen una referencia mínima de perfil local (nombre,
rol local de usuario **sin** privilegios y ruta de instancias). Nunca se
guarda una copia de la contraseña online.

Las fotos se recortan y comprimen a 128 × 128 en el cliente. Se rechazan
SVG, HTML y cargas superiores al límite. D1 es adecuado como almacén de
miniaturas pequeño para la primera etapa; para escalado masivo se recomienda
migrar a R2 independiente, no reutilizar el bucket de VIS Universe sin
políticas y permisos específicos.

## Chat y VIS Portals

- Conversación en panel desplegable **a la izquierda** de los contactos;
  navegación por chats recientes en columna separada.
- Polling de **2,6 segundos cuando hay chat abierto**, 8,5 segundos en
  otras secciones, con sincronización al volver a mostrar la ventana.
- Apodos privados y contactos Global/Proyectos conservados.
- Estado editable dentro del recuadro del perfil mediante un lápiz;
  no hay otro selector redundante.
- Ícono de personas y contador de nuevas solicitudes de amistad
  junto a «Mis contactos».
- Mensajes cifrados AES-GCM con claves ECDH. Claves de los contactos
  fijadas localmente y alerta cuando cambian inesperadamente.
- Las conversaciones recientes son **solo locales** y no se suben como
  historial al servidor.

## Instalador Linux

GitHub Actions genera exclusivamente **AppImage** para Linux. Se eliminó
la generación `.deb`. La matriz de Windows mantiene NSIS como instalador
independiente.

## Limitaciones importantes

- No se ha realizado todavía la prueba visual en dos computadoras físicas.
- La identidad de cifrado del chat todavía se vincula al primer dispositivo;
  iniciar la misma cuenta online desde otra computadora requiere un flujo
  seguro de migración/recuperación de claves para leer y enviar mensajes
  cifrados de esa identidad. **No** se resuelve copiando contraseñas.
- La supercuenta se aprovisiona por operación protegida desde GitHub
  vinculada a la clave pública del dispositivo, sin contraseña predeterminada.
- Protección contra bots, recuperación de credenciales, validación cruzada
  de claves y auditoría independiente siguen siendo requisitos antes de
  abrir registro público a gran escala.

## Pruebas técnicas

GitHub Actions despliega `vis-social` en Cloudflare, aplica las
migraciones D1 y ejecuta pruebas locales y en producción de registro,
autenticación Ed25519, solicitudes, mensajes y acceso a fotos.
Revisar los resultados verdes de:
[VIS Social - Cloudflare D1](https://github.com/JoseDaniel03/VIS-Nexo/actions/workflows/vis-social-deploy.yml)
y [VIS Nexo Native Build](https://github.com/JoseDaniel03/VIS-Nexo/actions/workflows/vis-nexo-build.yml).
