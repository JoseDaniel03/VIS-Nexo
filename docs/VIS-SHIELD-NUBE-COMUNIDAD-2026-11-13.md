# VIS Nexo — Seguridad, comunidad y Nube por mundo (tanda de revisión)

## Alcance
Solo **JoseDaniel03/VIS-Nexo**. El fork **horizon-VISNEXO** NO se modificó.
Rama aislada, sin merge, sin generar EXE/AppImage/JAR y sin desplegar D1 ni Workers.

## Nube de mundos: primera integración sin credenciales
En Instancias → Datos aparece la sección **Nube**, con lista de mundos válidos (level.dat).
El jugador elige una carpeta YA sincronizada mediante la aplicación oficial de
OneDrive, Google Drive, Dropbox, Nextcloud u otro proveedor. VIS no accede al
OAuth ni guarda contraseña, refresh token o secreto de esa nube.

Al vincular una carpeta, cada mundo puede respaldarse independientemente en ZIP,
con límites de tamaño, cantidad, profundidad, rechazo de symlinks, SHA-256
y bloqueo del juego durante la copia. Para recuperar se valida el SHA-256
y se crea otro directorio `-restaurado-...` sin sobrescribir el mundo original.

Estados de interfaz:
- **Gris:** no vinculada a carpeta sincronizada.
- **Naranja:** primera copia pendiente o se detectaron cambios en archivos locales.
- **Verde:** archivo de copia presente y con el tamaño esperado en la carpeta
  sincronizada; **NO** equivale a confirmación remota del proveedor.
- **Rojo:** carpeta desaparecida, respaldo perdido/alterado o fallo al inspeccionar el mundo.

La actualización se inicia manualmente. Los respaldos anteriores no se eliminan.
Los archivos ZIP no llevan cifrado extremo a extremo propio; la confidencialidad
depende de los permisos locales y de la cuenta del proveedor.
**Siguiente integración necesaria:** OAuth PKCE por proveedor, subida reanudable,
confirmación remota, cuotas y cifrado propio optativo, sin perder el modo portable.

## VIS Ceibo y administración
La supercuenta aprovisionada vía el workflow de GitHub puede conceder/revocar
`global_admin_grants` en D1 a identidades VIS Cloud existentes; no se añade
contraseña maestra ni se cambia el identificador técnico. Los @handles y apodos
siguen siendo cosméticos. Las cuentas `global_admin` no pueden crear ni
otorgar `super_admin`.

## Proyectos, invitaciones, roles y medios
D1 guarda:
- 7 roles visuales: creator, helper, content_creator, participant, guest,
  collaborator y mention (Creadores/Ayudantes/Creadores de contenido/
  Participantes/Invitados/Colaboradores/Menciones).
- Permiso independiente `can_play` por miembro.
- Política de solicitudes `open`, `request` e `invite_only`.
- Aprobación/rechazo de solicitudes con registro de actividad.
- Medios oficiales YouTube/Twitch, con URLs canonizadas y permisos de autor/
  gestor. La UI usa tarjetas compactas con vista previa YouTube y abre los
  reproductores oficiales externamente; **no** reproduce Twitch embebido todavía.

**Límite importante:** `can_play` hoy es un permiso autoritativo de VIS Social,
pero Minecraft Java/Horizon y los servidores necesitan verificarlo antes de
permitir entrada. No basta con esconder el botón Jugar en la interfaz.
La conexión segura al hosteo la está desarrollando otra tanda; integrar ahí
esta comprobación antes de considerar restringidos los servidores.

## Publicación segura
- GitHub CODEOWNERS, Dependabot, SECURITY.md y un workflow de análisis de
  npm, RustSec y pruebas Social/Universe sin compilar el launcher.
- Se inmovilizó el workflow antiguo de release (generaba instaladores, no
  ejecutables portables). Sustituirlo por canal manual firmado con SignPath
  y claves del updater protegidas mediante GitHub Environments.
- El workflow de Cloudflare requiere migración D1 0011 antes de desplegar
  el nuevo Worker y comprueba el esquema 11.
- No se modificaron configuraciones administrativas del repo: aún deben
  habilitarse desde GitHub Settings reglas de rama/etiqueta, aprobación de
  ambientes, restricciones de Actions y Secret Scanning/Push Protection.

## Revisión obligatoria antes de merge
1. CI sintaxis JS, pruebas SQLite/D1 y `cargo check` de Tauri.
2. Prueba local de Windows y Linux con mundos existentes y carteras compartidas.
3. Subida a carpeta de sincronización y verificación por el cliente del proveedor.
4. Migración D1 0011 en staging; probar cambios de roles y solicitudes con dos cuentas.
5. Integración de permisos de juego con el backend/servidor del otro desarrollo.
6. Revisión de conflictos con cambios concurrentes sobre main antes de fusionar.
7. Decidir licencia OSS e iniciar solicitud de SignPath Foundation, sin publicar
   ni copiar claves privadas al repositorio.
