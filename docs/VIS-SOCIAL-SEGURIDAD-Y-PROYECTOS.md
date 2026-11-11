# VIS Social — seguridad, cuentas y proyectos (11/11/2026)

## Estado real

La API `vis-social` utiliza Cloudflare Workers y la base D1 `vis-social-db`.
Las migraciones `0001`, `0002` y `0003` forman el esquema 3.
Los permisos de Internet **no** se heredan de los permisos de administrador
del almacenamiento local de VIS Nexo. Un PIN local de cuatro dígitos nunca
autoriza por sí solo un endpoint privilegiado de Cloudflare.

### Roles del servidor

| Rol | Facultades |
| --- | --- |
| `user` | Amigos, estados, mensajes cifrados y seguir proyectos publicados |
| `moderator` | Rol reservado para futuras herramientas de moderación; no dispone de endpoints administrativos en esta versión |
| `project_manager` | Rol reservado para futuras herramientas específicas de proyectos; no tiene acceso global a la API administrativa |
| `super_admin` | Registrar proyectos, publicar/despublicar, conceder personal, asignar roles no privilegiados y bloquear/desbloquear usuarios |

Todas las operaciones privilegiadas verifican el rol directamente en D1
en **cada petición**, registran un evento de auditoría y fallan con HTTP 403
cuando no se poseen los permisos. El navegador no puede asignarse a sí
mismo roles ni crear proyectos como administrador mediante parámetros
de `register`.

Los responsables de proyecto `editor` y `manager` se registran en
`project_staff`, pero **todavía no se les conceden escrituras** en VIS
Universe ni en las configuraciones centrales de los proyectos. Es una
preparación de permisos, no autorización para publicar contenidos reales.

## Alta de la primera supercuenta (NO automática)

1. En una instalación de VIS Nexo, crear/iniciar una cuenta local con
   contraseña o PIN local.
2. Esperar a que la cuenta quede registrada en VIS Social.
3. Abrir **VIS Portals → Proyectos → Identidad de este dispositivo**.
   Se mostrará la clave **pública** Ed25519 y su huella SHA-256.
   **Nunca compartir ni copiar la clave privada**, el PIN ni secretos de
   Cloudflare. La clave pública no es una contraseña.
4. Revisar la identidad y su huella desde el dispositivo que será
   administrador.
5. Abrir [VIS Social - Provision First Super Administrator](https://github.com/JoseDaniel03/VIS-Nexo/actions/workflows/vis-social-superadmin.yml)
   en GitHub Actions, elegir `main`, introducir el nombre de cuenta, la
   clave pública y marcar la confirmación.
6. La operación usa el entorno `vis-social-production` y solamente concede
   el rol cuando coincide el usuario **y** su clave pública, y no existe ya
   otro `super_admin`. Verifica la asignación al terminar.
7. Salir y volver a ingresar al launcher para actualizar el estado social;
   el panel de proyectos mostrará controles exclusivos de la supercuenta.

Recomendación: configurar **aprobación de revisores** y protección de rama
en el entorno de producción de GitHub. Esta operación es privilegiada y no
debe estar disponible para colaboradores sin autorización.

No se establece nombre de propietario, PIN, contraseña, token ni clave
privada por defecto en el código o la base de datos. No se deben
generar supercuentas automáticamente durante el primer registro.

## Proyectos y VIS Universe

- `social_projects` conserva `id`, título, descripción y visibilidad.
- `project_subscriptions` conserva las suscripciones voluntarias.
- `project_staff` conserva los permisos de personal; solo super-admin
  puede concederlos.
- La vista `Proyectos` en VIS Portals permite seguir/dejar de seguir
  proyectos publicados. La lista de contactos por proyecto solo revela
  proyectos que ambos amigos siguen.
- El propietario puede registrar un proyecto en D1, usando el mismo
  identificador que el proyecto publicado en **VIS Universe**.
- **Importante:** añadir un proyecto a D1 no sube assets, diseños,
  modpacks ni manifiestos de instalación. La autoridad para publicar
  en VIS Universe permanece separada. Nunca confiar en un ID de proyecto
  escrito por cualquier usuario para conceder permisos sobre R2.

## Protecciones implementadas

- Sesiones temporales con token aleatorio; D1 solo guarda SHA-256 del token.
- Ed25519 de desafío único y caducidad de 120 segundos.
- Contraseña/PIN solo local; los secretos de Cloudflare solo en GitHub.
- Cuenta suspendida: acceso denegado y revocación de sesiones.
- Límites básicos para registro, inicio, solicitudes, mensajes y cambios.
- Restricción de tamaños, IDs, tipos y listas en entradas HTTP.
- Los cambios privilegiados se acompañan por auditoría en transacciones D1.
- Mensajes cifrados ECDH P-256/AES-GCM; cola temporal en D1,
  confirmaciones controladas por destinatario.
- Historial local limitado a 2 KiB por conversación y 30 días de
  antigüedad.
- Claves de contactos fijadas con **TOFU** (*trust on first use*). Un
  cambio posterior de clave genera advertencia y detiene el mensaje,
  sin sustituir la clave guardada automáticamente.
- Endpoints administrativos nunca concedidos por rol de UI local.

## Riesgos pendientes, antes de un lanzamiento público grande

1. **Registro de nombres**: quien registra primero un nombre con una clave
   válida puede ocuparlo. Falta verificar identidad/propiedad del usuario
   mediante un proveedor de identidad externo o un flujo de recuperación
   confiable; el super-admin no se concede por nombre.
2. **Recuperación y multidispositivo**: cada cuenta remota está ligada a
   una única clave de dispositivo; recuperar o trasladar una cuenta requiere
   un flujo administrativo adicional con prueba de identidad.
3. **TOFU no autentica el primer encuentro**: aún falta comparación externa
   de huellas entre contactos o verificación de claves para resistir
   ataques al primer intercambio.
4. **Claves locales**: la clave de firma se guarda en un archivo restringido
   al perfil del sistema; no hay integración todavía con Secret Service/
   libsecret ni con Windows Credential Manager. Revisar seguridad de backups.
5. **Rate limits operativos**: los límites básicos D1 no sustituyen Cloudflare
   WAF/Turnstile, observabilidad, protección contra bots y cargas reales.
6. **Administrador local legado**: la primera cuenta de la instalación
   conserva permisos para editar el catálogo local. No significa que sea
   `super_admin` en la nube ni autoriza operaciones administrativas D1.
7. **Roles de proyecto no ejecutan contenido**: aún hay que definir y
   vincular permisos de publicación de manifiestos, archivos y mods en
   VIS Universe mediante una política separada de autenticación.
8. **Prueba de dos PC**: la prueba automatizada hace dos clientes
   criptográficos reales sobre Cloudflare, no reemplaza la comprobación
   con dos instalaciones físicas, reconexión y pérdida de red.

## Comprobaciones

```bash
npm run test:social
npm run validate
cargo check -p vslauncher-tauri --all-targets --locked
```

Para producción, revisar las ejecuciones de GitHub Actions:
[VIS Social - Cloudflare D1](https://github.com/JoseDaniel03/VIS-Nexo/actions/workflows/vis-social-deploy.yml).

Una prueba de despliegue verde no equivale a una auditoría de seguridad
independiente. Evitar afirmar que el software es invulnerable o
apto para manejar datos de alta sensibilidad sin esa evaluación.
