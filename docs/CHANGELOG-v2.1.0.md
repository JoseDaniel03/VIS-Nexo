# VSLauncher v2.1.0 — Portales, avatar y motion

- UI de Inicio y proyectos reformulada con composición inspirada en la navegación del Riot Client actual, utilizando recursos originales.
- Hero principal más amplio, navegación lateral compacta y fichas de proyecto con estados.
- Animaciones de entrada, transiciones y hover con Web Animations API nativa, que se detienen al ocultar la ventana y respetan `prefers-reduced-motion`. Evaluado Motion (motion.dev): no se introduce una dependencia para efectos equivalentes más simples.
- Editor de proyectos con vista previa lateral, pasos editables, importación y gestión de publicaciones y eventos. Los cambios de título, subtítulo y versión se reflejan inmediatamente.
- Perfil renovado; selector de cinco emblemas avatar persistentes para cuentas locales, validado en backend Rust, e importación de avatares tradicionales.
- Chat, amigos y presencia local mantienen su backend previo; pestaña Proyectos muestra amigos globales mientras no exista pertenencia al servidor.
- Catálogo sin proyectos ficticios, archivo `vsui` y cuentas locales compatibles con v2.0.
- Prueba de interfaz con Chromium a 880x600, 1024x768, 1366x768, 1920x1080. Sin validación de Cargo/Rust en el entorno de entrega.
- Pendiente: Microsoft OAuth, instalación/ejecución de Minecraft, chat/presencia global por red y sincronización remota.
