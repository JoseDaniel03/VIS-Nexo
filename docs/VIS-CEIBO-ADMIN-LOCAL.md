# VIS Ceibo — VIS STUDIOS (administrador LOCAL)

La herramienta `tools/vis_ceibo_admin_local.py` registra el usuario **vis_studios** con nombre visible **VIS STUDIOS** y rol `admin` en la base **local** de VIS Nexo. El programa conserva usuarios, amistades y mensajes anteriores, genera un respaldo de `accounts.json` y almacena solamente un hash Argon2id de la clave que se ingresa de manera oculta.

La clave NO está guardada en los fuentes, el ZIP ni GitHub. La clave que se entregue al propietario se utiliza exclusivamente durante el alta; no es un token de administrador de la nube.

## CachyOS

1. Cerrá VIS Nexo y asegurate de haber creado al menos una cuenta local para que exista `accounts.json`.
2. Instalá `argon2-cffi` si no lo tenés en Python: `python -m pip install --user argon2-cffi` (o dentro de un entorno virtual). También es posible instalar el paquete equivalente desde el gestor de paquetes de tu distribución.
3. Desde la carpeta del proyecto ejecutá: `python tools/vis_ceibo_admin_local.py`.
4. Pegá la clave privada cuando se te solicite, y repetila. No la pases como argumento de shell.
5. Abrí VIS Nexo e iniciá sesión con usuario `vis_studios` y la clave usada en el paso anterior.

Si hay más de un almacén de cuentas, el script exige `--accounts-file /ruta/absoluta/accounts.json`. Nunca crea una base nueva por accidente ni sobreescribe una cuenta `vis_studios` existente. Conservá la copia de seguridad.

## Limitaciones

Esto NO crea una cuenta remota. Cuando VIS Ceibo tenga backend de autenticación online, las cuentas y sus roles deberán ser aprovisionados mediante un servicio autorizado y verificados por el servidor, no mediante una clave compartida incluida en el launcher.
