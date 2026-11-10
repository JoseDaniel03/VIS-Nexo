# VSLauncher v2.4.0 — Minecraft Engine

## Funcionalidad añadida

- Biblioteca de Minecraft Java y nuevas instancias Vanilla / Fabric.
- Versiones Mojang, perfiles Fabric oficiales, biblioteca compartida, SHA-1 de descargas y progreso.
- Arranque local Java con selección de Java, argumentos de JVM según manifest y log de salida.
- Gestión Modrinth con filtros, descarga por versión, dependencias requeridas, importaciones manuales y eliminación.
- Habilitación/bloqueo administrativo de instalaciones y arranques por proyecto, validado en Rust.
- Capa Minecraft local y superposición de avatar PNG, sin alterar las cuentas anteriores.
- Interfaz de Minecraft/Mods/Recursos y versión 2.4 en frontend y backend.
- Pruebas de frontend para cuatro resoluciones y ampliación a 39 comprobaciones estáticas.

## Restricciones

La compilación del backend Rust/Tauri y el arranque real del cliente Java no están verificados en el entorno de creación. Microsoft OAuth, autenticación online, asignación oficial de skins/capas y descarga automática de Java siguen pendientes. La vista previa web no instala ni ejecuta Minecraft.
