# VSLauncher 2.6 · Dos modos y Minecraft personal

- Home: selector **Virgoland** / **Usuario**. El modo se recuerda localmente, sin modificar roles ni cuentas.
- Sidebar contextual: proyectos oficiales en Virgoland; perfiles Minecraft del jugador en modo Usuario.
- Instancias personales Vanilla/Fabric independientes de la publicación de un proyecto oficial. Se guardan en el namespace reservado `__personal__` y la carpeta local gestionada por VSLauncher.
- Home Usuario incluye listado y acciones de instalar, jugar, administrar mods y crear.
- Editor de instancias permite seleccionar la biblioteca personal o un proyecto Virgoland.
- Backend Rust autoriza la instalación y ejecución de perfiles personales asociados **exclusivamente a la cuenta autenticada**; conserva bloqueos administrativos para proyectos oficiales. El modo nick temporal sigue sin instalar/reparar recursos.
- Login Microsoft: el botón deshabilitado deja de añadir la etiqueta larga «PRONTO», que provocaba solapamientos; layout responsive.
- Estado: sintaxis de JavaScript y verificadores estáticos ejecutados. El ejecutable Rust y la instalación real de Minecraft necesitan `cargo check` y prueba en CachyOS.
