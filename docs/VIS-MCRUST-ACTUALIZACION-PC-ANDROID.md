# Probar la nueva revisión común desde Nexo

El motor incorporado en esta tanda está en la rama de integración de `horizon-VISNEXO`, commit `9a793bee14861ba991093b4356b8c3e74c5c54e9`. Incluye editor táctil, gestión térmica/memoria y checkpoint al suspender. La comprobación ARM64 con audio pasó localmente. Las compilaciones Windows/Linux/APK deben corresponder a ese commit o uno posterior que contenga los ajustes.

## PC

En VIS Worlds, crear una instancia Horizon Rust 26.3 e instalarla. En una instancia ya instalada, usar **Actualizar / reparar**. Esa acción consulta el último release compartido verificado, conserva los mundos/configuraciones y vuelve a preparar los recursos si hace falta. No se debe actualizar con esa instancia abierta; Nexo lo bloquea. Jugar normalmente mantiene la revisión instalada y no obliga a descargar por cada inicio.

## Android

Crear la instancia Rust 26.3 Vanilla en Nexo y tocar **Instalar / Jugar**. Confirmar la instalación que abre Android y volver a tocar el botón para iniciar. Se comprueban hash del APK y certificado del paquete instalado; una firma distinta requiere una decisión manual con respaldo de mundos, no una desinstalación automática.

## Qué publicación se elige

PC y Android leen el mismo manifiesto `vis-mcrust-release.json` del fork. Solo aceptan publicaciones completas de las tres plataformas, con una misma revisión, protocolo y formatos. Subir código al PR o construir un APK de prueba no cambia automáticamente ese catálogo estable.

La nueva revisión aún no está disponible en Nexo hasta que termine su compilación firmada y se publique el release compartido. Los artefactos de CI de prueba usan firma temporal y no reemplazan silenciosamente una instalación firmada. No usar un release anterior para afirmar que se probaron estos ajustes.

La sesión premium y el canal social dentro del juego Android siguen pendientes. Las pruebas físicas de controles, ciclo de vida, red y rendimiento también. Este documento no declara una versión definitiva ni certifica servidores online-mode.
