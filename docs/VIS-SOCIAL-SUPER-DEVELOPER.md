# VIS Social — Superdesarrollador de proyectos

El permiso **Superdesarrollador** no es una cuenta compartida ni una
contraseña maestra. Es una capacidad explícita de una cuenta VIS ya
registrada, gestionada por la base D1 y validada en **cada solicitud**.

## Alta o revocación

1. Crear una cuenta **VIS online** normal e iniciar sesión en VIS Nexo.
2. En **VIS Portals → Proyectos → Identidad de desarrollador** copiar el
   nombre de cuenta y su clave **pública** Ed25519. La clave pública es un
   identificador, **no una contraseña**. No compartir el PIN, la contraseña
   ni claves privadas.
3. Confirmar por un canal independiente la identidad de quien solicita
   el permiso y revisar su cuenta. Configurar revisores obligatorios
   (*Required reviewers*) para `vis-social-production` en GitHub si el
   plan de GitHub permite esta protección.
4. Abrir
   [VIS Social - Super Developer](https://github.com/JoseDaniel03/VIS-Nexo/actions/workflows/vis-social-developer.yml)
   y pulsar **Run workflow**, seleccionando `main`.
5. Introducir `username`, `public_key`, elegir `grant` y marcar
   `confirmed`. GitHub Actions usa los secretos ya configurados dentro
   del entorno `vis-social-production`; **nunca** se piden tokens al
   usuario en el launcher.
6. El workflow comprueba que la cuenta existe, no está desactivada y
   su verificador online coincide con la clave pública suministrada.
   Añade el permiso en `developer_grants` y verifica el resultado.
7. Para retirarlo, ejecutar nuevamente el mismo workflow con `revoke`.
   La revocación tiene efecto en la próxima petición al servidor,
   incluso para una sesión ya iniciada.

**Ninguna cuenta se vuelve superdesarrollador por registrarse primero,
por conocer un ID, por modificar el WebView ni por utilizar un PIN local.**

## Alcance del permiso

- Puede crear, actualizar, publicar, archivar y describir entradas de
  proyectos en VIS Social.
- Puede asignar o retirar colaboradores de proyectos en VIS Social.
- Puede consultar borradores del catálogo social.

No puede suspender usuarios, asignar roles de superadministrador,
leer chats cifrados, acceder a los secretos de Cloudflare ni publicar
directamente archivos en R2 de VIS Universe. Los diseños completos de
VIS Studios siguen sujetos a las reglas propias del catálogo local;
asignar este permiso **no** lo convierte automáticamente en
administrador local del dispositivo.

La supercuenta **super_admin** es diferente y permanece disponible para
las operaciones administrativas que requieren mayor privilegio.

## Seguridad y mantenimiento

- SQL generada mediante `tools/prepare_social_developer.py` con
  validación estricta del identificador y de la clave pública.
- Identificador de cuenta comprobado también contra
  `social_users.password_hash` con formato `ed25519:<clave pública>`.
- Sin contraseñas o PIN predeterminados.
- Sin endpoints HTTP que permitan autoconceder este permiso.
- Tabla D1 `developer_grants` creada con la migración
  `0006_super_developer.sql`.
- Las operaciones sobre proyectos registran eventos en `admin_audit`.

Antes de una apertura pública, completar la revisión de protección de
GitHub Actions, identidad del titular, recuperación de credenciales y
vinculación de los proyectos sociales con los manifiestos firmados que
publica VIS Universe. Son sistemas de autorización distintos.
