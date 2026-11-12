# VIS Nexo — Microsoft Premium, Xbox y Minecraft Services

## Qué quedó integrado

VIS Nexo v2.19 incorpora una autenticación Microsoft **real** en Rust
utilizando el Application (client) ID previamente enviado a Mojang:

`35e5d19a-b607-43cf-b22c-a659847b8e44`

La misma AppID puede establecerse mediante la variable de compilación
`VIS_MSA_CLIENT_ID` (siempre debe coincidir con la registrada). No
hay ni se necesita **client secret**, contraseña Microsoft, WebView de
credenciales, ni redirección a una app externa no autorizada.

### Flujo de usuario

1. Iniciar VIS Nexo y pulsar **Microsoft**.
2. El launcher solicita un **código de dispositivo** al tenant
   `/consumers` de Microsoft, con alcance
   `XboxLive.signin offline_access`.
3. Se muestra el código de un solo uso. **Abrir Microsoft** lanza la
   página oficial HTTPS en el navegador del sistema operativo.
4. El usuario se autentica directamente en Microsoft y autoriza la app.
5. VIS verifica la aprobación siguiendo el intervalo indicado por
   Microsoft (respetando `slow_down`, caducidad y cancelación).
6. VIS intercambia el token con Xbox Live → XSTS → Minecraft Services.
7. Consulta `/minecraft/profile` y valida el UUID y nombre oficial.
   **Solo se considera completado el inicio si Minecraft devuelve el
   perfil válido**. Un HTTP 403 de Minecraft Services se informa sin
   fingir que Mojang aprobó nuestra aplicación.
8. Se crea un perfil **local sin privilegios**, derivado del UUID de
   Minecraft (`msa_<20 caracteres del UUID>`). El launcher guarda
   únicamente un indicador de perfil Microsoft, nunca los tokens.
9. Java y Fabric reciben nombre, UUID y token de Minecraft en el proceso
   del juego; Horizon recibe un JSON de sesión temporal, escrito con
   permisos restringidos y entregado por `stdin` en su Launch API 0.1.

**Importante:** Java Edition recibe su token como argumento de proceso
según el contrato de arranque oficial del juego. Esto puede ser visible
a herramientas locales de inspección de procesos del sistema operativo;
por ello el launcher nunca debe incluir el comando completo en logs ni
exportar el token a la interfaz.

## Seguridad

- Auth WebView nunca pide la contraseña Microsoft.
- Las respuestas externas tienen límites de tamaño y tiempos de espera.
- Solo se abre una URL de verificación HTTPS en un dominio Microsoft
  previamente autorizado.
- Los códigos de dispositivo y tokens se guardan solo en memoria Rust.
- No se escribe refresh token ni access token al disco del launcher.
- El archivo Horizon es de un solo uso y se elimina tras la entrega,
  incluso cuando el arranque falla.
- El perfil local Microsoft tiene rol de **usuario**, no de administrador.
- Si una sesión premium expira, VIS exige un nuevo inicio de sesión;
  **nunca degrada silenciosamente al modo offline**.
- Se utiliza el `expires_in` indicado por Minecraft Services, con margen
  de seguridad antes del vencimiento.
- La solicitud Xbox Live y XSTS ocurre siempre sobre TLS, sin URLs
  configurables por contenido remoto.

## Configuración de Entra

En Microsoft Entra, verificar que la AppID indicada arriba sea una
aplicación pública para cuentas personales Microsoft y que permita
**public client flows**. El Device Code Flow no necesita utilizar el
`redirect_uri` `http://localhost` configurado previamente para
Authorization Code, ni exige un secreto.

Este acceso es independiente de la **Cuenta VIS** registrada en
Cloudflare. El login premium no convierte automáticamente una cuenta
Microsoft en cuenta VIS online, ni sincroniza mundos, mods ni claves
cifradas de VIS Social.

## Estado y pruebas pendientes

El correo recibido el 11 de noviembre de 2026 con el título
*AppID Review Complete* **no identifica la AppID aprobada**. La única
confirmación práctica será iniciar sesión con una cuenta propietaria
de Minecraft y recibir el perfil oficial desde Minecraft Services.

**Sin prueba con la cuenta del usuario no es correcto declarar que
Mojang haya habilitado definitivamente el client ID.**

Se comprueba la compilación con:
```bash
npm run check:release
cargo check -p vslauncher-tauri --all-targets --locked
cargo test --workspace --bins --lib --locked
```

Los artefactos se generan en GitHub Actions:
[VIS Nexo Native Build](https://github.com/JoseDaniel03/VIS-Nexo/actions/workflows/vis-nexo-build.yml).
Linux: solo AppImage. Windows: instalador NSIS `.exe`.
