# VIS Nexo — reconciliación de ramas históricas (12/11/2026)

## Decisión
No incorporar automáticamente archivos de dos ramas anteriores a la implementación activa de `main`, porque las ramas se separaron cientos de commits atrás y contienen versiones incompatibles de componentes actuales.

En su lugar:
1. Registrar los commits de ambas ramas como padres adicionales de un commit en `main` que **mantiene exactamente el árbol de archivos de `main`**. Así todo el historial de ambas ramas queda localizable con `git log` y los commits originales no se pierden.
2. Cerrar los PR antiguos y borrar sus ramas una vez verificado que sus commits quedaron como ancestros de `main`.
3. Adaptar a `main` únicamente las funcionalidades todavía necesarias, una a una, sin copiar código antiguo sobre el código más seguro/reciente.

Esto es una **incorporación histórica**, no un merge funcional de todas las implementaciones: algunas funciones documentadas en los PR antiguos pueden no existir o comportarse diferente en `main` actual.

## Ramas a conservar en el historial

- `feature/project-modpacks-instance-controls`: commit `81576371b64ec5051d5ba5d58c675eac3a1cbb4d`, [PR #2](https://github.com/JoseDaniel03/VIS-Nexo/pull/2). Incluye prototipos anteriores de creación/gestión de instancias en modo offline, manifiestos y sincronización de mods, Windows portable y pruebas. Las alternativas actuales de VIS requieren auditoría por funcionalidad; no debe restaurarse su CI anterior.
- `feature/ceibo-humile-cloudflare-social`: commit `6750d3173cf1f0455cad1a390d48cbf3ccb7e2ea`, [PR #3](https://github.com/JoseDaniel03/VIS-Nexo/pull/3). Contiene prototipos de chat WebSocket, apodos, estados, presencia, registros locales y scripts de Cloudflare. No deben reemplazarse los sistemas posteriores de `main`, especialmente el esquema actual de claves de dispositivo, cifrado de mensajes y migraciones D1.

## Funcionalidades antiguas que necesitan cotejo o adaptación, no simple copiado

- Gestión offline completa y creación de instancias por alias: la versión actual de invitado limita varias operaciones. Revisar autorización, aislación de datos y coherencia con Java/Horizon antes de ampliar permisos.
- Apodos privados, grupos, favoritos y estado personalizado/actividad remota en VIS Portals: volver a validar la experiencia con el modelo vigente de Ceibo/Humile y sus claves criptográficas.
- Registro local de hasta 2 KiB por conversación: la implementación moderna ya cuenta con persistencia local cifrada/aislada de 30 días; verificar límites de tamaño sin sustituirla por texto sin cifrar.
- Compilación/distribución Windows portable sin instalador y Modrinth/SmartInstall: conservar las versiones modernas; no restaurar workflows y scripts de empaquetado desactualizados.

## Cómo recuperar trabajo específico

`git show 81576371:<ruta>` y `git show 6750d317:<ruta>` recuperan el contenido exacto de esas ramas mientras sus commits formen parte de `main`. El historial original se conserva incluso tras borrar los nombres de las ramas. Para nuevas tandas de VIS Nexo, trabajar solo sobre `main` y no crear ramas auxiliares.

## Estado de validación

No se generaron builds, snapshots ni ejecutables. Los ajustes recientes de protección de partidas, borrado, restauración y servidores siguen pendientes de pruebas de compilación y de aceptación multiplataforma.
