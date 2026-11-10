# VIS Nexo · Plan de transición hacia VIS 3.0

## Estado de esta entrega: v2.7 (primera fase, NO 3.0 estable)

- Se conserva VSLauncher 2.6 como base y se mantiene su identificador de aplicación (`com.virgoland.vslauncher`) para no perder datos locales existentes.
- Nombre público inicial actualizado a **VIS Nexo**. Conserva la marca personalizada cuando difiere del valor por defecto antiguo.
- Nuevo acceso directo permanente **VIS Portals** al lado del engranaje de Configuración. El chat existente **aún es local** y no permite hablar entre dos PCs.
- **VIS Maintenance**: previsualiza archivos elegibles y solo borra tras confirmación explícita; protege los datos de cuentas, proyectos y Minecraft.
- Se agrega el primer esquema PostgreSQL de **Ceibo** (identidad/sesiones/invitaciones) y **Humile** (amigos, grupos y mensajes) como preparación para migrar a la nube. **No existe todavía un servidor Rust desplegable ni conexión a estas tablas.**
- Workflow GitHub Actions para intentar compilar instaladores Windows/Linux; **no son binarios ya creados ni verificados**.

## Retención propuesta

| Subsistema | Objeto | Política | Estado |
|---|---|---|---|
| Nexo local | runtime-temp | extensiones temporales, 3 días | Funcional vía Maintenance |
| Nexo local | downloads-tmp | descargas parciales, 7 días | Funcional vía Maintenance |
| Nexo local | logs | `.log`, `.txt`, 30 días | Funcional vía Maintenance |
| Nexo local | diagnostics | `.log`, `.txt`, `.json`, 90 días | Funcional vía Maintenance |
| Ceibo cloud | sesiones caducadas | revisión diaria; revocación inmediata | Diseño SQL, sin servidor |
| Humile cloud | mensajes | 12 meses, exportación + aviso previo | Diseño SQL, NO automático |
| Humile cloud | presencia/escribiendo | efímero, sin persistencia en DB | Por implementar |
| Ombú cloud | adjuntos temporales | propuesta 90 días | Por implementar |
| Universe cloud | proyectos | conservar mientras estén activos o tengan referencias | Por implementar |

### Seguridad de eliminación local

Solo se inspeccionan 4 subcarpetas bajo el `app_data_dir()` de Tauri. No se siguen symlinks. No se borran carpetas, `.jar`, `.zip`, `.json` de usuarios, carpetas de instancias, mods, saves, assets o Java. Las reglas de extensión y antigüedad son explícitas y se analizan todos los candidatos antes de empezar. Las carpetas que no existen sencillamente contabilizan cero.

La limpieza local se ejecuta **manualmente** en esta entrega. No hay scheduler residente ni acceso a los servicios cloud. La retención de chats **no** debe activarse hasta habilitar exportaciones de usuario, avisos de vencimiento y backups restaurables.

## A implementar para VIS 3.0

1. Servicio Humile en Rust (Axum + WebSockets) y conexión TLS pública, autorizado por Ceibo.
2. Servicio Ceibo en Rust con autenticación remota, recuperación, Argon2id y creación de administradores por tokens de invitación de un solo uso; sin bootstrap por usuarios no verificados.
3. Migración explícita de cuentas, amigos y mensajes locales con autorización del usuario. No duplicar roles `admin` locales en la nube.
4. Chat de dos PCs con historial paginado, enviar/editar/eliminar/cancelar, grupos, favoritos y presencia.
5. Scheduler cloud para limpieza periódica e informe anual, más respaldos y cuotas por servicio.
6. Prueba real de Minecraft Java/Fabric en CachyOS y Windows; verificar licencias Microsoft antes de declarar acceso a servidores oficiales.
7. Compilar y probar instaladores nativos Linux y Windows y configurar actualización segura.
8. Revisar Horizon Rust y su compatibilidad real antes de ofrecerlo como instalador.

## Despliegue sugerido

Servidor Linux (Oracle Always Free si hay capacidad) para Ceibo/Humile y PostgreSQL en la nube, R2 para recursos distribuidos de Ombú, HTTPS / WebSocket TLS y backups cifrados. Mantener mundos y bibliotecas Minecraft en cada PC. No alojar contraseñas ni tokens en archivos frontend. Restringir puertos de PostgreSQL a la red privada del backend.
