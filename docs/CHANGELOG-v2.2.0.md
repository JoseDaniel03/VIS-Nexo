# VSLauncher 2.2.0 — Animaciones y transiciones integrales

- Nueva capa `web/motion-v2.2.css` para interacciones y estilos de foco.
- Nuevo motor `web/effects.js` de animaciones nativas WAAPI; no se añaden librerías externas.
- Cambio de sección con salida y entrada; tarjetas escalonadas solo al navegar.
- Login y Registro con animación propia; Inicio, Home y proyectos animados.
- Transición de pestañas de noticias, parches, actualizaciones y calendario.
- Chat y amigos: panel, conversación, mensajes, pestañas y presencia local.
- Configuración: feedback de toggles, animación de avatares y modales.
- Protección de rendimiento: cancelación al ocultarse la ventana, `prefers-reduced-motion`, ajuste propio para deshabilitar movimiento.
- Restauración de scroll dentro de la sección para no perder posición al actualizar paneles.
- Prueba de navegación, formulario, modal, avatar, instancia y configuración en 880×600, 1024×768, 1366×768, 1920×1080; chat local simulado en prueba aparte.
- Se conserva el backend Rust 2.1 y las funcionalidades existentes. No se añade chat remoto ni motor Minecraft.
- Cargo/Tauri nativo no pudo compilarse en el entorno de entrega.
